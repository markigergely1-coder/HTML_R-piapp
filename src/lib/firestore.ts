/**
 * Firestore lekérdezések — direkt browser-ből.
 * A kollekció nevek tükrözik a Python `modules/config.py` értékeit.
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

export const COLLECTIONS = {
  ATTENDANCE: 'attendance_records',
  CANCELLED: 'cancelled_sessions',
  MEMBERS: 'members',
  INVOICES: 'invoices',
  SETTLEMENTS: 'settlements',
  DEVICES: 'device_registrations',
  APP_LOGS: 'app_logs',
} as const;

export interface AttendanceRecord {
  id: string;
  name: string;
  status: 'Yes' | 'No' | string;
  event_date: string;
  mode: string; // "valós" | "teszt" | ...
  timestamp?: unknown;
}

/** Egy alkalom regisztrációi (kivéve "teszt" mód). */
export async function getAttendanceForDate(eventDate: string): Promise<AttendanceRecord[]> {
  const q = query(
    collection(db, COLLECTIONS.ATTENDANCE),
    where('event_date', '==', eventDate),
  );
  const snap = await getDocs(q);
  const records: AttendanceRecord[] = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const mode = (d.mode ?? 'valós').toString().toLowerCase();
    if (mode === 'teszt') return;
    records.push({
      id: doc.id,
      name: (d.name ?? '').toString().trim(),
      status: (d.status ?? '').toString().trim(),
      event_date: d.event_date,
      mode: d.mode ?? 'valós',
      timestamp: d.timestamp,
    });
  });
  return records;
}

/**
 * Adott alkalom megerősített résztvevői:
 * - aki adott "Yes"-t ÉS nem adott "No"-t (az utolsó válasz nem számít, ezzel egyezik a Python verzió)
 * - kivéve "teszt" mód
 */
export async function getConfirmedAttendees(eventDate: string): Promise<string[]> {
  const records = await getAttendanceForDate(eventDate);
  const yesSet = new Set<string>();
  const noSet = new Set<string>();
  for (const r of records) {
    if (!r.name) continue;
    if (r.status === 'Yes') yesSet.add(r.name);
    else if (r.status === 'No') noSet.add(r.name);
  }
  return [...yesSet].filter((n) => !noSet.has(n)).sort((a, b) => a.localeCompare(b, 'hu'));
}

/** Lemondott alkalmak dátumai (YYYY-MM-DD set). */
export async function getCancelledSessions(): Promise<Set<string>> {
  const snap = await getDocs(collection(db, COLLECTIONS.CANCELLED));
  const set = new Set<string>();
  snap.forEach((doc) => {
    const date = doc.data().date;
    if (date) set.add(date);
  });
  return set;
}
