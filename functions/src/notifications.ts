/**
 * Push notification küldés a Cloud Functions oldalról.
 *
 * Exportált funkciók:
 *   - tuesdayReminder      — schedulált: kedd 9:00 Magyarország
 *   - onCancellation       — Firestore trigger: cancelled_sessions/{id}
 *   - onAttendanceFullTeam — Firestore trigger: attendance_records/{id}
 *
 * Belső helper:
 *   - sendPushToMember(memberId, payload, eventKey) — végzi a preference-check
 *     + quiet hours + token-cleanup logikát.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

// ─── Típusok (a frontend `firestore.ts`-szel egyezően) ───

interface MemberNotificationPrefs {
  enabled: boolean;
  events: {
    tuesdayReminder: boolean;
    cancellation: boolean;
    fullTeam: boolean;
    newRegistration: boolean;
    payment: boolean;
  };
  reminderTime: string;
  quietHours: { enabled: boolean; from: string; to: string };
}

type EventKey = keyof MemberNotificationPrefs['events'];

interface PushPayload {
  title: string;
  body: string;
  eventDate?: string;          // pl. '2026-05-19' (deep link-hez)
  actions?: { action: string; title: string }[];
  tag?: string;
  url?: string;                // egyedi target URL (alapból /me)
}

// ─── Időkezelés (Magyarország) ───

function getHungaryTimeHHmm(): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(new Date()); // "HH:mm"
}

function todayInHungary(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // "YYYY-MM-DD"
}

/** A jelenlegi idő benne van-e a csendes órák intervallumban?
 *  Kezeli az éjszakai átívelést (pl. 22:00–07:00). */
function isInQuietHours(prefs: MemberNotificationPrefs, currentHHmm: string): boolean {
  if (!prefs.quietHours.enabled) return false;
  const { from, to } = prefs.quietHours;
  // Ha from < to: normál ablak (pl. 13:00-15:00)
  // Ha from > to: éjszakai átívelés (pl. 22:00-07:00)
  if (from <= to) {
    return currentHHmm >= from && currentHHmm < to;
  }
  return currentHHmm >= from || currentHHmm < to;
}

// ─── Push küldő helper ───

/**
 * Push küldés egy member összes engedélyezett eszközére.
 * - Ellenőrzi: prefs.enabled, prefs.events[eventKey], quiet hours
 * - Lekéri a push_subscriptions doc-okat (memberId alapján, enabled=true)
 * - Stale token-eket törli (UNREGISTERED, INVALID_ARGUMENT, etc.)
 */
async function sendPushToMember(
  memberId: string,
  payload: PushPayload,
  eventKey: EventKey,
): Promise<{ sent: number; failed: number }> {
  const db = admin.firestore();

  // 1. Load member + prefs
  const memberSnap = await db.collection('members').doc(memberId).get();
  if (!memberSnap.exists) {
    console.warn(`[sendPushToMember] Member ${memberId} not found`);
    return { sent: 0, failed: 0 };
  }
  const data = memberSnap.data() ?? {};
  const prefs: MemberNotificationPrefs | undefined = data.prefs?.notifications;
  if (!prefs) return { sent: 0, failed: 0 }; // még nem állított be semmit
  if (!prefs.enabled) return { sent: 0, failed: 0 };
  if (!prefs.events[eventKey]) return { sent: 0, failed: 0 };

  // 2. Csendes órák
  const currentTime = getHungaryTimeHHmm();
  if (isInQuietHours(prefs, currentTime)) {
    console.log(`[sendPushToMember] Skipping ${memberId} (quiet hours @ ${currentTime})`);
    return { sent: 0, failed: 0 };
  }

  // 3. Push subscription-ek (csak az enabled-eket)
  const subsSnap = await db
    .collection('push_subscriptions')
    .where('memberId', '==', memberId)
    .where('enabled', '==', true)
    .get();

  if (subsSnap.empty) return { sent: 0, failed: 0 };

  // 4. FCM message-ek küldése
  let sent = 0;
  let failed = 0;
  const staleRefs: FirebaseFirestore.DocumentReference[] = [];

  for (const subDoc of subsSnap.docs) {
    const sub = subDoc.data();
    const token = sub.token as string;
    if (!token) continue;
    try {
      // Data-only message — a service worker rajzolja ki a notification-t,
      // így az `actions` mezőt is támogatja (a notification payload nem támogatja).
      await admin.messaging().send({
        token,
        data: {
          title: payload.title,
          body: payload.body,
          ...(payload.eventDate ? { eventDate: payload.eventDate } : {}),
          ...(payload.tag ? { tag: payload.tag } : {}),
          ...(payload.actions ? { actions: JSON.stringify(payload.actions) } : {}),
          ...(payload.url ? { url: payload.url } : {}),
        },
        webpush: {
          headers: { Urgency: 'high' },
          fcmOptions: { link: payload.url ?? '/#/me' },
        },
      });
      sent++;
    } catch (err: unknown) {
      failed++;
      const code = (err as { code?: string })?.code ?? '';
      // FCM error codes: messaging/registration-token-not-registered, messaging/invalid-argument
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        staleRefs.push(subDoc.ref);
      } else {
        console.warn(`[sendPushToMember] Send error for ${memberId}/${token.slice(0, 8)}:`, code, err);
      }
    }
  }

  // 5. Stale token-ek törlése
  for (const ref of staleRefs) {
    await ref.delete().catch(() => {});
  }
  if (staleRefs.length > 0) {
    console.log(`[sendPushToMember] Cleaned ${staleRefs.length} stale tokens for ${memberId}`);
  }

  return { sent, failed };
}

/**
 * "Nyers" push küldés egy member-nek: NEM ellenőrzi a prefs-et, csak küld
 * az összes engedélyezett eszközre. Tesztelésre — pl. Diagnosztika oldalról.
 * Visszatérés: { sent, failed, devices: string[] } eszköz-szintű részletekkel.
 */
export async function sendRawPushToMember(
  memberId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; devices: { device: string; ok: boolean; reason?: string }[] }> {
  const db = admin.firestore();
  const subsSnap = await db
    .collection('push_subscriptions')
    .where('memberId', '==', memberId)
    .where('enabled', '==', true)
    .get();

  if (subsSnap.empty) {
    return { sent: 0, failed: 0, devices: [] };
  }

  let sent = 0;
  let failed = 0;
  const devices: { device: string; ok: boolean; reason?: string }[] = [];
  const staleRefs: FirebaseFirestore.DocumentReference[] = [];

  for (const subDoc of subsSnap.docs) {
    const sub = subDoc.data();
    const token = sub.token as string;
    const device = (sub.device as string) || 'Ismeretlen eszköz';
    if (!token) {
      devices.push({ device, ok: false, reason: 'no-token' });
      failed++;
      continue;
    }
    try {
      await admin.messaging().send({
        token,
        data: {
          title: payload.title,
          body: payload.body,
          ...(payload.eventDate ? { eventDate: payload.eventDate } : {}),
          ...(payload.tag ? { tag: payload.tag } : {}),
          ...(payload.url ? { url: payload.url } : {}),
        },
        webpush: {
          headers: { Urgency: 'high' },
          fcmOptions: { link: payload.url ?? '/#/me' },
        },
      });
      sent++;
      devices.push({ device, ok: true });
    } catch (err: unknown) {
      failed++;
      const code = (err as { code?: string })?.code ?? '';
      devices.push({ device, ok: false, reason: code || 'error' });
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        staleRefs.push(subDoc.ref);
      }
    }
  }

  for (const ref of staleRefs) {
    await ref.delete().catch(() => {});
  }

  return { sent, failed, devices };
}

/** Push küldés MINDEN aktív member-nek (a sendPushToMember a prefs alapján szűr). */
async function broadcastToAllMembers(payload: PushPayload, eventKey: EventKey): Promise<void> {
  const db = admin.firestore();
  const membersSnap = await db.collection('members').where('active', '!=', false).get();
  let totalSent = 0;
  let totalFailed = 0;
  for (const memberDoc of membersSnap.docs) {
    const r = await sendPushToMember(memberDoc.id, payload, eventKey);
    totalSent += r.sent;
    totalFailed += r.failed;
  }
  console.log(`[broadcastToAllMembers] event=${eventKey} sent=${totalSent} failed=${totalFailed}`);
}

// ─── Funkció 1: Kedd reggeli emlékeztető ───

/**
 * Kedd 9:00 (Magyarország): minden active member-nek aki még nem regisztrált
 * Yes-szel aznapra → push 'Még nem jelentkeztél!'.
 */
export const tuesdayReminder = onSchedule(
  {
    schedule: '0 9 * * 2',
    timeZone: 'Europe/Budapest',
    region: 'europe-west1',
  },
  async () => {
    const today = todayInHungary();
    const db = admin.firestore();

    // 1. Aktív tagok
    const membersSnap = await db.collection('members').where('active', '!=', false).get();

    // 2. Akik már regisztráltak ma Yes-szel
    const yesSnap = await db
      .collection('attendance_records')
      .where('event_date', '==', today)
      .where('status', '==', 'Yes')
      .get();
    const yesNames = new Set<string>();
    yesSnap.forEach((d) => yesNames.add((d.data().name ?? '').toString()));

    // 3. Lemondva van-e az alkalom?
    const cancelledSnap = await db
      .collection('cancelled_sessions')
      .where('date', '==', today)
      .limit(1)
      .get();
    if (!cancelledSnap.empty) {
      console.log(`[tuesdayReminder] Skipping — ${today} is cancelled`);
      return;
    }

    let totalSent = 0;
    for (const memberDoc of membersSnap.docs) {
      const member = memberDoc.data();
      const name = (member.name ?? '').toString();
      if (yesNames.has(name)) continue; // már regisztrált
      const r = await sendPushToMember(memberDoc.id, {
        title: 'Mai röplabda 🏐',
        body: `Még nem jelentkeztél a ma esti edzésre!`,
        eventDate: today,
        actions: [
          { action: 'join', title: '✓ Jövök' },
          { action: 'join-guest', title: '+ Vendéggel' },
        ],
        tag: `tuesday-${today}`,
        url: '/#/me',
      }, 'tuesdayReminder');
      totalSent += r.sent;
    }
    console.log(`[tuesdayReminder] Date=${today} sent=${totalSent}`);
  },
);

// ─── Funkció 2: Lemondás ───

/**
 * Firestore trigger: amikor admin lemondja a heti edzést → minden member-nek
 * azonnali push.
 */
export const onCancellation = onDocumentCreated(
  {
    document: 'cancelled_sessions/{id}',
    region: 'europe-west1',
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const date = (data.date ?? '').toString();
    const reason = (data.reason ?? '').toString();
    if (!date) return;

    await broadcastToAllMembers({
      title: 'Edzés lemondva ❌',
      body: reason ? `${date} — ${reason}` : `Lemondva: ${date}`,
      eventDate: date,
      tag: `cancellation-${date}`,
      url: '/#/',
    }, 'cancellation');
  },
);

// ─── Funkció 3: Megvan a 8 fő ───

/**
 * Firestore trigger: amikor egy attendance_records doc létrejön, ha az ADOTT
 * dátumra most ért 8-ra (vagy fölé, EXACTLY 8-as átlépés pillanata) → push.
 */
export const onAttendanceFullTeam = onDocumentCreated(
  {
    document: 'attendance_records/{id}',
    region: 'europe-west1',
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    if (data.status !== 'Yes') return;
    const date = (data.event_date ?? '').toString();
    if (!date) return;

    const db = admin.firestore();
    const yesSnap = await db
      .collection('attendance_records')
      .where('event_date', '==', date)
      .where('status', '==', 'Yes')
      .get();
    // Egyedi nevek számolása (duplikátum védelem)
    const uniqueNames = new Set<string>();
    yesSnap.forEach((d) => {
      const name = (d.data().name ?? '').toString().trim();
      if (name) uniqueNames.add(name);
    });

    const FULL = 8;
    if (uniqueNames.size !== FULL) return; // csak a pontos átlépés pillanatában küldünk

    await broadcastToAllMembers({
      title: 'Megvan a csapat! 🎉',
      body: `Összejött a 8 fő ${date}-ra. Találkozunk!`,
      eventDate: date,
      tag: `fullteam-${date}`,
      url: '/#/',
    }, 'fullTeam');
  },
);
