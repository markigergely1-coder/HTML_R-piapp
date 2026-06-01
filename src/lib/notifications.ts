/**
 * Push notification — frontend API.
 *
 * - Permission kérés a böngészőtől
 * - FCM token lekérése (VAPID key-jel)
 * - Subscription mentése Firestore-ba (`push_subscriptions` collection)
 * - Subscription lekérdezés + törlés
 * - Token frissítés minden app-indításkor (megbízhatóság)
 * - Subscription health-check: ha permission granted de nincs aktív sub → auto-resubscribe
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
// Token frissítés & health-check (megbízhatóság)
// ─────────────────────────────────────────────────────────────────

/**
 * App-indításkor hívandó: frissíti az FCM tokent és szinkronizálja a
 * Firestore-ral. Ha a token megváltozott (FCM rotálta, böngésző újragenerálta),
 * automatikusan frissíti a `push_subscriptions` dokumentumot.
 *
 * Ha a permission granted de nincs aktív subscription (pl. a user törölte a
 * böngésző adatait, vagy a token stale-lé vált és a Cloud Function kitörölte),
 * automatikusan újra-feliratkoztatja.
 *
 * Ezt minden app-indításkor meg kell hívni a bejelentkezett user-re.
 */
export async function refreshPushToken(
  memberId: string,
  memberEmail: string,
): Promise<{ action: 'none' | 'updated' | 'resubscribed' | 'skipped'; reason?: string }> {
  // Alap feltételek
  if (!(await isPushSupported())) return { action: 'skipped', reason: 'unsupported' };
  if (currentPermission() !== 'granted') return { action: 'skipped', reason: 'no-permission' };

  // SW registration
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
    // Megvárjuk az aktiválódást
    if (swReg.installing || swReg.waiting) {
      await new Promise<void>((resolve) => {
        const sw = swReg.installing ?? swReg.waiting;
        if (!sw || sw.state === 'activated') { resolve(); return; }
        sw.addEventListener('statechange', () => {
          if (sw.state === 'activated') resolve();
        });
      });
    }
  } catch (err) {
    console.warn('[notifications] refreshPushToken: SW reg failed:', err);
    return { action: 'skipped', reason: 'sw-error' };
  }

  // Aktuális FCM token lekérése
  let currentToken: string;
  try {
    currentToken = await getToken(messaging!, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
  } catch (err) {
    console.warn('[notifications] refreshPushToken: getToken failed:', err);
    return { action: 'skipped', reason: 'token-error' };
  }
  if (!currentToken) return { action: 'skipped', reason: 'empty-token' };

  // Firestore-ban tárolt subscription-ek lekérdezése
  const existingSubs = await getDocs(query(
    collection(db, PUSH_SUBS),
    where('memberId', '==', memberId),
    where('enabled', '==', true),
  ));

  // Eset A: nincs egyetlen aktív subscription sem → újra-feliratkozás
  if (existingSubs.empty) {
    console.log('[notifications] refreshPushToken: no active subs found, resubscribing…');
    const device = parseDeviceLabel(navigator.userAgent);
    await addDoc(collection(db, PUSH_SUBS), {
      memberId,
      memberEmail,
      token: currentToken,
      device,
      enabled: true,
      createdAt: serverTimestamp(),
    });
    setupForegroundListener();
    return { action: 'resubscribed' };
  }

  // Eset B: van subscription — nézzük meg egyezik-e a token
  // Az aktuális eszköz label-je alapján keressük a matching doc-ot
  const device = parseDeviceLabel(navigator.userAgent);
  let matchedDoc: typeof existingSubs.docs[0] | null = null;

  // Először token alapján keresünk (ha van ilyen → nincs frissítés szükséges)
  for (const d of existingSubs.docs) {
    if (d.data().token === currentToken) {
      matchedDoc = d;
      break;
    }
  }

  if (matchedDoc) {
    // Token egyezik, de lehet hogy a device label változott (pl. browser update)
    const storedDevice = matchedDoc.data().device ?? '';
    if (storedDevice !== device) {
      await updateDoc(matchedDoc.ref, { device });
    }
    setupForegroundListener();
    return { action: 'none' };
  }

  // Token nem egyezik egyikkel sem → keressük device alapján az aktuálisat
  let deviceDoc: typeof existingSubs.docs[0] | null = null;
  for (const d of existingSubs.docs) {
    if (d.data().device === device) {
      deviceDoc = d;
      break;
    }
  }

  if (deviceDoc) {
    // Ugyanaz az eszköz, de más a token → FCM rotálta → frissítjük
    console.log('[notifications] refreshPushToken: token rotated, updating…');
    await updateDoc(deviceDoc.ref, {
      token: currentToken,
      device,
    });
    setupForegroundListener();
    return { action: 'updated' };
  }

  // Teljesen új eszköz / token kombináció → új doc
  console.log('[notifications] refreshPushToken: new device detected, adding…');
  await addDoc(collection(db, PUSH_SUBS), {
    memberId,
    memberEmail,
    token: currentToken,
    device,
    enabled: true,
    createdAt: serverTimestamp(),
  });
  setupForegroundListener();
  return { action: 'resubscribed' };
}

/**
 * Automatikus push token keepalive: auth állapot változásra figyel,
 * és bejelentkezett user esetén minden app-indításkor frissíti a tokent.
 *
 * Ezt a main.ts-ben kell egyszer meghívni.
 */
export function setupPushTokenKeepAlive(): void {
  // Késleltetett import az auth modulból (ciklikus import elkerülése)
  import('./auth').then(({ onAuthChange }) => {
    let lastRefreshedUid = '';
    onAuthChange(async (state) => {
      if (state.loading || !state.user) {
        lastRefreshedUid = '';
        return;
      }
      // Ugyanazt a user-t ne frissítsük többször egy session-ben
      if (lastRefreshedUid === state.user.uid) return;
      lastRefreshedUid = state.user.uid;

      // Kis késleltetés: ne lassítsa az első renderelést
      await new Promise((r) => setTimeout(r, 2000));

      try {
        // Member adatok kellenek a push token frissítéshez
        const { getMemberByEmail } = await import('./firestore');
        const email = state.user!.email ?? '';
        if (!email) return;
        const member = await getMemberByEmail(email);
        if (!member) return;

        const result = await refreshPushToken(member.id, email);
        if (result.action !== 'none' && result.action !== 'skipped') {
          console.log(`[notifications] pushTokenKeepAlive: ${result.action}`);
        }
      } catch (err) {
        // Graceful — token refresh hiba nem szabad hogy az appot elrontsa
        console.warn('[notifications] pushTokenKeepAlive error:', err);
      }
    });
  }).catch((err) => {
    console.warn('[notifications] setupPushTokenKeepAlive: dynamic import failed:', err);
  });
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
