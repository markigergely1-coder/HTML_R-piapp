/**
 * Push notification — frontend API.
 *
 * - Permission kérés a böngészőtől
 * - FCM token lekérése (VAPID key-jel)
 * - Subscription mentése Firestore-ba (`push_subscriptions` collection)
 * - Subscription lekérdezés + törlés
 *
 * iOS Safari nem-PWA módban a `messaging` null lesz — minden helper graceful
 * `{ ok: false, error: 'unsupported' }`-tel tér vissza.
 */

import { getToken, deleteToken, onMessage } from 'firebase/messaging';
import {
  addDoc,
  collection,
  getDocs,
  query,
  where,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, messaging, VAPID_KEY, app } from './firebase';

const FUNCTIONS_REGION = 'europe-west1';

export interface TestPushResult {
  sent: number;
  failed: number;
  devices: { device: string; ok: boolean; reason?: string }[];
}

/**
 * Admin-only: teszt push küldése egy megadott member összes engedélyezett
 * eszközére. Hívja a `sendTestPush` Cloud Function-t.
 */
export async function sendTestPush(memberId: string): Promise<TestPushResult> {
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const fn = httpsCallable<{ memberId: string }, TestPushResult>(functions, 'sendTestPush');
  const res = await fn({ memberId });
  return res.data;
}

const PUSH_SUBS = 'push_subscriptions';

export interface PushSubscription {
  id: string;
  memberId: string;
  memberEmail: string;
  token: string;
  device: string;              // ember-olvasható eszköz név
  enabled: boolean;
  createdAt?: string;
}

/** A böngésző + Firebase támogatja-e a Web Push-t? */
export async function isPushSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!messaging) return false;
  if (!VAPID_KEY) return false;
  return true;
}

/** A jelenlegi engedély állapota: 'granted' | 'denied' | 'default'. */
export function currentPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission;
}

/**
 * Subscribe-olja a jelenlegi user-t push-ra.
 *  1. permission prompt (ha még nincs)
 *  2. FCM token (a Firebase Messaging SW-vel)
 *  3. push_subscriptions doc létrehozása (vagy frissítése ha már volt ilyen token)
 *
 * Visszatérés: { ok: true } sikernél, vagy { ok: false, error: kód } hibánál.
 */
export async function subscribeToPush(
  memberId: string,
  memberEmail: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!(await isPushSupported())) {
    return { ok: false, error: 'unsupported' };
  }
  // Permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, error: 'permission-denied' };
  }

  // FCM service worker regisztráció (külön a vite-plugin-pwa SW-jétől).
  // 1) Először megnézzük van-e már aktív registration ezen a scope-on, és
  //    csak akkor regisztrálunk, ha nincs. Az iOS Safari néha nem szereti az
  //    .update()-ot egy aktív SW-re.
  // 2) Megvárjuk hogy a SW aktív state-be kerüljön mielőtt token-t kérünk.
  let swReg: ServiceWorkerRegistration;
  try {
    const existing = await navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope');
    if (existing) {
      swReg = existing;
    } else {
      swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/firebase-cloud-messaging-push-scope',
      });
    }
    // Wait for activation
    if (swReg.installing || swReg.waiting) {
      await new Promise<void>((resolve) => {
        const sw = swReg.installing ?? swReg.waiting;
        if (!sw) { resolve(); return; }
        if (sw.state === 'activated') { resolve(); return; }
        sw.addEventListener('statechange', () => {
          if (sw.state === 'activated') resolve();
        });
      });
    }
  } catch (err) {
    console.warn('[notifications] FCM SW register failed:', err);
    return { ok: false, error: errorWithDetails('sw-register-failed', err) };
  }

  // FCM token
  let token: string;
  try {
    token = await getToken(messaging!, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
  } catch (err) {
    console.warn('[notifications] getToken failed:', err);
    return { ok: false, error: errorWithDetails('get-token-failed', err) };
  }
  if (!token) return { ok: false, error: 'no-token' };

  // Eszköz név (ember-olvasható, UA alapján)
  const device = parseDeviceLabel(navigator.userAgent);

  // Firestore-ba mentés. Először nézzük, van-e már doc ezzel a tokennel.
  const existing = await getDocs(query(
    collection(db, PUSH_SUBS),
    where('token', '==', token),
  ));

  if (existing.empty) {
    await addDoc(collection(db, PUSH_SUBS), {
      memberId,
      memberEmail,
      token,
      device,
      enabled: true,
      createdAt: serverTimestamp(),
    });
  } else {
    // ha már létezik, csak frissítjük (enabled=true + device + memberId — utóbbi ha changed)
    const ref = existing.docs[0].ref;
    await updateDoc(ref, {
      memberId,
      memberEmail,
      device,
      enabled: true,
    });
  }

  // Foreground message listener (ha az app aktív, mi mutatjuk a toast-ot)
  setupForegroundListener();

  return { ok: true, token };
}

/**
 * Unsubscribe — törli a token-t mindkét helyről (FCM + Firestore).
 */
export async function unsubscribeFromPush(memberId: string): Promise<void> {
  if (!messaging) return;
  try {
    // Aktuális token kitörlése FCM-ből
    await deleteToken(messaging);
  } catch (err) {
    console.warn('[notifications] deleteToken failed:', err);
  }
  // Firestore-ból a member összes subscription-jét töröljük
  const snap = await getDocs(query(
    collection(db, PUSH_SUBS),
    where('memberId', '==', memberId),
  ));
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
  }
}

/**
 * A jelenlegi member összes push subscription-je.
 * UI-hoz használjuk (eszköz lista a Saját oldalon).
 */
export async function getMySubscriptions(memberId: string): Promise<PushSubscription[]> {
  const snap = await getDocs(query(
    collection(db, PUSH_SUBS),
    where('memberId', '==', memberId),
  ));
  const list: PushSubscription[] = [];
  snap.forEach((d) => {
    const data = d.data();
    list.push({
      id: d.id,
      memberId: data.memberId,
      memberEmail: data.memberEmail,
      token: data.token,
      device: data.device || 'Ismeretlen eszköz',
      enabled: data.enabled !== false,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.(),
    });
  });
  return list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Egy adott subscription enabled/disabled flag módosítása. */
export async function setSubscriptionEnabled(subId: string, enabled: boolean): Promise<void> {
  await updateDoc(doc(db, PUSH_SUBS, subId), { enabled });
}

/** Egy subscription törlése (eszköz eltávolítása listából). */
export async function deleteSubscription(subId: string): Promise<void> {
  await deleteDoc(doc(db, PUSH_SUBS, subId));
}

// ─────────────────────────────────────────────────────────────────
// Belsős helperek
// ─────────────────────────────────────────────────────────────────

let foregroundListenerSetup = false;
function setupForegroundListener() {
  if (foregroundListenerSetup || !messaging) return;
  foregroundListenerSetup = true;
  onMessage(messaging, (payload) => {
    // Foreground: az app épp nyitva van, a böngésző NEM rajzolja ki a notification-t.
    // Egyszerű: kihozunk egy native notification-t magunktól. (Ha SW már aktív és van
    // permission, ez működik.)
    const data = payload.data || {};
    const title = data.title || payload.notification?.title || 'Röpi App';
    const body  = data.body  || payload.notification?.body  || '';
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope')
        .then((reg) => reg?.showNotification(title, { body, icon: '/pwa-192x192.png', badge: '/pwa-64x64.png' }))
        .catch(() => {});
    }
  });
}

/** Firebase / browser error → kód + magyarázó string. */
function errorWithDetails(prefix: string, err: unknown): string {
  // FirebaseError tartalmaz egy .code mezőt, pl. 'messaging/permission-blocked'
  const e = err as { code?: string; name?: string; message?: string };
  const code = e?.code ?? e?.name ?? '';
  const msg = e?.message ?? String(err);
  // Csak a fő részt vesszük (a Firebase error message-ek hosszúak)
  const shortMsg = msg.split('(')[0]?.trim() ?? msg;
  if (code) return `${prefix}: ${code}`;
  return `${prefix}: ${shortMsg.slice(0, 120)}`;
}

/** UA → ember-olvasható eszköz név. */
function parseDeviceLabel(ua: string): string {
  // Kis logika: macOS, Windows, iPhone, Android, Linux + browser
  let os = 'Eszköz';
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iPhone';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'Mac';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';

  let browser = '';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';

  return browser ? `${os} · ${browser}` : os;
}
