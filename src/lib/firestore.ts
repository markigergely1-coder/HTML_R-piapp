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
  limit,
  serverTimestamp,
  writeBatch,
  setDoc,
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

export interface CancelledSessionWithId extends CancelledSession {
  id: string;
}

/** Lemondott alkalmak ID-vel együtt (admin CRUD-hoz). */
export async function getCancelledSessionsWithIds(): Promise<CancelledSessionWithId[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.CANCELLED));
  const list: CancelledSessionWithId[] = [];
  snap.forEach((d) => {
    const data = d.data();
    if (data.date) list.push({ id: d.id, date: data.date, reason: data.reason });
  });
  return list.sort((a, b) => b.date.localeCompare(a.date)); // legújabb előre
}

export async function addCancelledSession(date: string, reason?: string): Promise<string> {
  const payload: Record<string, unknown> = { date };
  if (reason && reason.trim()) payload.reason = reason.trim();
  const ref = await addDoc(collection(db, COLLECTIONS.CANCELLED), payload);
  return ref.id;
}

export async function deleteCancelledSession(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.CANCELLED, id));
}

// ─────────────────────────────────────────────────────────────────
// Attendance records — admin írás (registration)
// ─────────────────────────────────────────────────────────────────

/** Egy regisztráció (1 név, 1 alkalom). */
export interface NewAttendanceRow {
  name: string;
  status: 'Yes' | 'No';
  event_date: string;
  mode: 'valós' | 'teszt';
}

/** Batch írás: több regisztráció egyszerre. */
export async function addAttendanceBatch(rows: NewAttendanceRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const batch = writeBatch(db);
  let count = 0;
  for (const r of rows) {
    const ref = doc(collection(db, COLLECTIONS.ATTENDANCE));
    batch.set(ref, {
      name: r.name,
      status: r.status,
      event_date: r.event_date,
      mode: r.mode,
      timestamp: serverTimestamp(),
    });
    count++;
  }
  await batch.commit();
  return count;
}

// ─────────────────────────────────────────────────────────────────
// Invoices (számlák)
// ─────────────────────────────────────────────────────────────────

export interface Invoice {
  id: string;
  inv_date: string;       // "YYYY-MM-DD"
  target_year: number;
  target_month: number;
  amount: number;
  filename?: string;
}

export async function getAllInvoices(): Promise<Invoice[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.INVOICES));
  const list: Invoice[] = [];
  snap.forEach((d) => {
    const data = d.data();
    list.push({
      id: d.id,
      inv_date: (data.inv_date ?? '').toString(),
      target_year: Number(data.target_year ?? 0),
      target_month: Number(data.target_month ?? 0),
      amount: Number(data.amount ?? 0),
      filename: data.filename,
    });
  });
  // legújabb előre (év, hónap)
  return list.sort((a, b) => (b.target_year - a.target_year) || (b.target_month - a.target_month));
}

// ─────────────────────────────────────────────────────────────────
// Settlements (elszámolások)
// ─────────────────────────────────────────────────────────────────

export interface Settlement {
  id: string;
  year: number;
  month: number;
  month_name?: string;
  saved_at?: string;
}

export async function getAllSettlements(): Promise<Settlement[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.SETTLEMENTS));
  const list: Settlement[] = [];
  snap.forEach((d) => {
    const data = d.data();
    list.push({
      id: d.id,
      year: Number(data.year ?? 0),
      month: Number(data.month ?? 0),
      month_name: data.month_name,
      saved_at: data.saved_at,
    });
  });
  return list.sort((a, b) => (b.year - a.year) || (b.month - a.month));
}

// ─────────────────────────────────────────────────────────────────
// App logs (diagnosztika)
// ─────────────────────────────────────────────────────────────────

export interface AppLog {
  id: string;
  level: string; // INFO / WARNING / ERROR
  message: string;
  user_name?: string;
  ip_address?: string;
  created_at_local?: string;
  details?: Record<string, unknown> | string;
}

export async function getAppLogs(maxItems = 200): Promise<AppLog[]> {
  // A 'timestamp' field szerint csökkenő — Firestore order_by-jal
  let q;
  try {
    q = query(
      collection(db, COLLECTIONS.APP_LOGS),
      orderBy('timestamp', 'desc'),
      limit(maxItems),
    );
  } catch {
    q = query(collection(db, COLLECTIONS.APP_LOGS), limit(maxItems));
  }
  const snap = await getDocs(q);
  const logs: AppLog[] = [];
  snap.forEach((d) => {
    const data = d.data();
    logs.push({
      id: d.id,
      level: (data.level ?? 'INFO').toString(),
      message: (data.message ?? '').toString(),
      user_name: data.user_name,
      ip_address: data.ip_address,
      created_at_local: data.created_at_local,
      details: data.details,
    });
  });
  return logs;
}

// ─────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────

/** Egyszerű kapcsolat-teszt: ír/olvas/töröl egy ping doc-ot. */
export async function pingFirestore(): Promise<boolean> {
  const ref = doc(db, 'test_ping', 'ping');
  await setDoc(ref, { timestamp: serverTimestamp() });
  const snap = await getDocs(query(collection(db, 'test_ping'), limit(1)));
  let ok = !snap.empty;
  await deleteDoc(ref);
  return ok;
}

// ─────────────────────────────────────────────────────────────────
// Lekérdezés egy adott napra történt jelenléteket (admin reg ellenőrzéshez)
// ─────────────────────────────────────────────────────────────────

export async function getAttendanceForDate(date: string): Promise<string[]> {
  const map = await getAttendeesByDates([date]);
  return map.get(date) ?? [];
}
