import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging';

// Firebase config — public, biztonságos publikálni
// (a tényleges biztonságot Firestore Security Rules adja)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

/**
 * Firestore offline persistence (IndexedDB) — minden lekérdezés a helyi
 * cache-ből szolgálódik ki ha van érvényes adat, párhuzamosan frissül a
 * háttérben a szerverről. Mobil hálózaton drasztikusan gyorsabb betöltés.
 *
 * persistentMultipleTabManager: egyszerre több tab is használhatja
 * (egyébként csak az első tab tudna persistence-t).
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

/**
 * Firebase Cloud Messaging — lazy, csak akkor inicializál ha a böngésző támogatja.
 * iOS Safari nem-PWA módban nem támogat web push-t → itt null-t kapunk és graceful
 * degradációval kezeljük a UI-ban (notification toggle disabled marad).
 *
 * NOTE: az isSupported() Promise-t ad vissza, ezért top-level await kell. A Vite
 * build-time-ban kezeli a module-szintű awaits-eket (ES2022 target).
 */
let _messaging: Messaging | null = null;
try {
  if (typeof window !== 'undefined' && (await isSupported())) {
    _messaging = getMessaging(app);
  }
} catch {
  _messaging = null;
}
export const messaging: Messaging | null = _messaging;
export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
