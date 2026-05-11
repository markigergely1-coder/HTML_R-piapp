/**
 * Firebase Authentication — Google sign-in + admin ellenőrzés.
 *
 * FONTOS: A kliens-oldali admin check CSAK UI-hoz használandó.
 * Az igazi védelem a Firestore Security Rules-ban van (lásd README).
 */

import {
  onAuthStateChanged,
  signInWithPopup,
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

export function getAuthState(): AuthState {
  return currentState;
}

export function onAuthChange(cb: (state: AuthState) => void): () => void {
  listeners.add(cb);
  // azonnal hívjuk a callback-ot a jelenlegi állapottal
  cb(currentState);
  return () => listeners.delete(cb);
}

export async function signIn(): Promise<void> {
  await signInWithPopup(auth, googleProvider);
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}
