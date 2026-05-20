/* eslint-disable */
/**
 * Firebase Cloud Messaging service worker.
 *
 * Ezt a fájlt a böngésző a / scope-ban regisztrálja (FCM követelmény).
 * Külön él a vite-plugin-pwa által generált /sw.js mellett — más scope,
 * más cél: a /sw.js a caching-et csinálja, ez itt csak push-t.
 *
 * A Firebase config értékek itt PUBLIKUSAK (az apiKey is) — Firebase
 * Hosting-on amúgy is kliens-oldali és a security a Firestore Rules-ban van.
 */

importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBuSQjdRaLkp7631mwMrfybpJD8NEuKgko',
  authDomain: 'attendanceapp-473208.firebaseapp.com',
  projectId: 'attendanceapp-473208',
  storageBucket: 'attendanceapp-473208.firebasestorage.app',
  messagingSenderId: '439983311477',
  appId: '1:439983311477:web:51ca3e7a6eaca1a054463c',
});

const messaging = firebase.messaging();

/**
 * Background message handler — akkor fut le, ha az app NEM aktív / nem nyitva van.
 *
 * Az FCM payload két fő része:
 *   - notification: { title, body, icon }  → ezt automatikusan kirajzolja
 *   - data: { ... }                        → custom adat amit a click handler használ
 *
 * Mi a `data`-ra hagyatkozunk, mert az `actions` mezőt csak így tudjuk küldeni
 * (a `notification` payload nem támogatja). Ezért data-only message-eket küldünk
 * a Cloud Function-ből, és itt rajzoljuk ki a notification-t.
 */
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || 'Röpi App';
  const body  = data.body  || '';

  // Action gombok (Phase D): data.actions JSON string-ként érkezik
  let actions = [];
  try {
    if (data.actions) actions = JSON.parse(data.actions);
  } catch (e) {
    actions = [];
  }

  self.registration.showNotification(title, {
    body,
    icon:  '/pwa-192x192.png',
    badge: '/pwa-64x64.png',
    tag:   data.tag || 'ropi-app',     // ha többször jön ugyanaz, csak az utolsó marad
    renotify: data.renotify === 'true',
    actions,
    data,                              // továbbadjuk a click handler-nek
  });
});

/**
 * Notification kattintás kezelő.
 * - action nélkül: alap nyitás (/me)
 * - action='join':       quick-join (Phase D — háttérben Cloud Function)
 * - action='join-guest': /me?action=add-guest (deep link a vendég-formhoz)
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  const data = event.notification.data || {};

  let target = '/#/me';
  if (action === 'join-guest') {
    const date = data.eventDate ? `&date=${data.eventDate}` : '';
    target = `/#/me?action=add-guest${date}`;
  } else if (action === 'join') {
    // Phase D: itt majd egy fetch() lesz egy callable function-höz
    // Phase B/C: csak megnyitjuk az appot
    target = '/#/me?action=quick-join' + (data.eventDate ? `&date=${data.eventDate}` : '');
  } else if (data.url) {
    target = data.url;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Ha már nyitva van az app, focus + URL update
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate?.(target);
          return w.focus();
        }
      }
      // Egyébként új ablak
      return clients.openWindow(target);
    })
  );
});
