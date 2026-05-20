/**
 * Firebase Authentication — Google sign-in popup-first + redirect fallback.
 *
 * Firebase Hosting alatt (jelenlegi setup) az app és az authDomain ugyanaz
 * az origin → a popup megbízhatóan működik (nincs third-party cookie probléma).
 * Ha mégis blokkolva van (popup blocker, COOP), automatikusan átvált redirect-re.
 *
 * FONTOS: A kliens-oldali admin check CSAK UI-hoz használandó.
 * Az igazi védelem a Firestore Security Rules-ban van.
 */

import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { logEvent } from './logger';
import { getMemberByEmail, addMember } from './firestore';

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
  const wasLoggedOut = !currentState.user && !currentState.loading;
  currentState = {
    user,
    isAdmin: !!user && ADMIN_EMAILS.includes(email),
    loading: false,
  };
  if (user && wasLoggedOut) {
    void logEvent('info', 'User signed in', { email: user.email });
    void ensureMemberExists(user.email ?? '', user.displayName ?? '');
  }
  for (const l of listeners) l(currentState);
});

/**
 * Az első bejelentkezéskor automatikusan létrehoz egy member rekordot
 * a Google email + displayName alapján, ha még nincs ilyen email a `members` collection-ben.
 * Idempotens: ha már van member, nem csinál semmit.
 */
async function ensureMemberExists(email: string, displayName: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return;
  try {
    const existing = await getMemberByEmail(normalizedEmail);
    if (existing) return;
    // Név forrás: Google displayName, vagy email előtti rész fallback-ként
    const name = displayName.trim() || normalizedEmail.split('@')[0];
    await addMember({ name, email: normalizedEmail, active: true });
    void logEvent('info', 'Member auto-created from login', { name, email: normalizedEmail });
  } catch (err) {
    console.warn('[auth] ensureMemberExists failed:', err);
  }
}

// Modulbetöltéskor egyszer kikéri a függő redirect eredményt (ha van).
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
 * Google bejelentkezés — popup-tal (modern UX), redirect fallback-kel.
 *
 * Firebase Hostingon az app és authDomain ugyanaz a *.firebaseapp.com origin,
 * így a popup-nek nincs cross-origin storage problémája. Ha a böngésző mégis
 * blokkolja (popup blocker, COOP fejléc, vagy más környezeti probléma), a
 * redirect fallback automatikusan elindul.
 */
export async function signIn(): Promise<void> {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    // Felhasználó szándékosan zárta be? Ne erőltessük a redirectet.
    if (code === 'auth/cancelled-popup-request') return;
    console.warn('[auth] popup failed, falling back to redirect:', code, err);
    await signInWithRedirect(auth, googleProvider);
  }
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}
