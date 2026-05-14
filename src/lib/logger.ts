import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebase';
import { COLLECTIONS } from './firestore';

export type LogLevel = 'info' | 'warn' | 'error';

export async function logEvent(
  level: LogLevel,
  message: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await addDoc(collection(db, COLLECTIONS.APP_LOGS), {
      level: level.toUpperCase(),
      message,
      user_name: auth.currentUser?.email ?? 'anonymous',
      details: payload ?? null,
      timestamp: serverTimestamp(),
    });
  } catch {
    // Never propagate logger errors — swallow silently
  }
}
