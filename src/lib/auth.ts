/**
 * Firebase Authentication — Google sign-in REDIRECT módon + admin ellenőrzés.
 *
 * Miért redirect és nem popup?
 * Modern böngészők (Chrome/Edge 2024+, Brave, Safari) a Cross-Origin-Opener-Policy
 * és/vagy third-party cookie korlátozások miatt nem engedik a popup-nak hogy
 * visszaüzenjen a parent ablaknak. A popup felvillan, majd bezáródik, eredmény nélkül.
 * A redirect ezt megkerüli: az egész oldal navigál Google-re, majd vissza.
 *
 * FONTOS: A kliens-oldali admin check CSAK UI-hoz használandó.
 * Az igazi védelem a Firestore Security Rules-ban van (lásd README).
 */

import {
  onAuthStateChanged,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from './firebase';

/** Admin email-ek — szinkronban a Streamlit secrets-szel. */
export const ADMIN_EMAILS = [
  'markigergely1@gmail.com',
  'annemaryaf@gmail.com',
];

export interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
}

let currentState: AuthState = { user: null, isAdmin: false, loading: true };
const listeners = new Set<(state: AuthState) => void>();

onAuthStateChanged(auth, (user) => {
  const email = user?.email?.toLowerCase() ?? '';
  currentState = {
    user,
    isAdmin: !!user && ADMIN_EMAILS.includes(email),
    loading: false,
  };
  for (const l of listeners) l(currentState);
});

// Modulbetöltéskor egyszer kikéri a függő redirect eredményt (ha van).
// A Firebase magától is feldolgozza, de ez biztos hogy futott egy "rendet rak" passz.
getRedirectResult(auth).catch((err) => {
  console.warn('[auth] getRedirectResult error:', err);
});

export function getAuthState(): AuthState {
  return currentState;
}

export function onAuthChange(cb: (state: AuthState) => void): () => void {
  listeners.add(cb);
  // azonnal hívjuk a callback-ot a jelenlegi állapottal
  cb(currentState);
  return () => listeners.delete(cb);
}

/**
 * Google bejelentkezés redirect módon.
 *
 * A popup mód (signInWithPopup) hosztolt környezetben (pl. Vercel) megbízhatatlan:
 * a popup `firebaseapp.com` origin-re nyílik, és a böngészők third-party cookie
 * blokkolása miatt a popup nem tud visszaüzenni — felvillan, bezáródik, semmi.
 *
 * A redirect ezt megkerüli: az egész oldal navigál Google-re, majd vissza,
 * és a getRedirectResult() modulbetöltéskor felveszi az eredményt.
 */
export async function signIn(): Promise<void> {
  await signInWithRedirect(auth, googleProvider);
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}
