/**
 * Firestore lekérdezések — direkt browser-ből.
 * A kollekció nevek tükrözik a Python `modules/config.py` értékeit.
 */

import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
} from 'firebase/firestore';
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
  mode: string;
  timestamp?: unknown;
}

export interface CancelledSession {
  date: string;
  reason?: string;
}

/**
 * Egyszerre lekérdezi az összes megadott alkalom regisztrációit, és csoportosítja:
 * - "teszt" mód kihagyva
 * - megerősített résztvevő: aki "Yes"-t adott ÉS nem adott "No"-t
 * - eredmény: Map(eventDate → sortolt nevek)
 *
 * Firestore `in` lekérdezés legfeljebb 30 értéket támogat — 9 keddi dátumnál ez bőven elég.
 */
export async function getAttendeesByDates(
  dates: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (dates.length === 0) return result;

  const q = query(
    collection(db, COLLECTIONS.ATTENDANCE),
    where('event_date', 'in', dates),
  );
  const snap = await getDocs(q);

  // Csoportosítás dátum szerint, Yes/No halmazokkal
  const yesByDate = new Map<string, Set<string>>();
  const noByDate = new Map<string, Set<string>>();
  for (const date of dates) {
    yesByDate.set(date, new Set());
    noByDate.set(date, new Set());
  }

  snap.forEach((doc) => {
    const d = doc.data();
    const mode = (d.mode ?? 'valós').toString().toLowerCase();
    if (mode === 'teszt') return;
    const name = (d.name ?? '').toString().trim();
    if (!name) return;
    const status = (d.status ?? '').toString().trim();
    const eventDate = d.event_date;
    if (status === 'Yes') yesByDate.get(eventDate)?.add(name);
    else if (status === 'No') noByDate.get(eventDate)?.add(name);
  });

  for (const date of dates) {
    const yes = yesByDate.get(date)!;
    const no = noByDate.get(date)!;
    const confirmed = [...yes]
      .filter((n) => !no.has(n))
      .sort((a, b) => a.localeCompare(b, 'hu'));
    result.set(date, confirmed);
  }
  return result;
}

export interface RawAttendance {
  name: string;
  status: string;
  event_date: string;
  mode: string;
}

/** Az ÖSSZES attendance record (csak a profil oldalhoz; teszt mód kihagyva). */
export async function getAllAttendanceRecords(): Promise<RawAttendance[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.ATTENDANCE));
  const records: RawAttendance[] = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const mode = (d.mode ?? 'valós').toString().toLowerCase();
    if (mode === 'teszt') return;
    const name = (d.name ?? '').toString().trim();
    if (!name) return;
    records.push({
      name,
      status: (d.status ?? '').toString().trim(),
      event_date: d.event_date ?? '',
      mode,
    });
  });
  return records;
}

// ─────────────────────────────────────────────────────────────────
// Members CRUD
// ─────────────────────────────────────────────────────────────────

export interface Member {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

export async function getAllMembers(): Promise<Member[]> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.MEMBERS), orderBy('name')));
  const members: Member[] = [];
  snap.forEach((d) => {
    const data = d.data();
    members.push({
      id: d.id,
      name: (data.name ?? '').toString(),
      email: (data.email ?? '').toString(),
      active: data.active ?? true,
    });
  });
  return members;
}

export async function addMember(input: { name: string; email: string; active: boolean }): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.MEMBERS), {
    name: input.name.trim(),
    email: input.email.trim(),
    active: input.active,
  });
  return ref.id;
}

export async function updateMember(id: string, updates: Partial<Omit<Member, 'id'>>): Promise<void> {
  const clean: Record<string, unknown> = {};
  if (updates.name !== undefined) clean.name = updates.name.trim();
  if (updates.email !== undefined) clean.email = updates.email.trim();
  if (updates.active !== undefined) clean.active = updates.active;
  await updateDoc(doc(db, COLLECTIONS.MEMBERS, id), clean);
}

export async function deleteMember(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.MEMBERS, id));
}

// ─────────────────────────────────────────────────────────────────
// Cancelled sessions
// ─────────────────────────────────────────────────────────────────

/** Lemondott alkalmak: dátum → opcionális indoklás. */
export async function getCancelledSessions(): Promise<Map<string, CancelledSession>> {
  const snap = await getDocs(collection(db, COLLECTIONS.CANCELLED));
  const map = new Map<string, CancelledSession>();
  snap.forEach((doc) => {
    const data = doc.data();
    if (data.date) {
      map.set(data.date, { date: data.date, reason: data.reason });
    }
  });
  return map;
}
