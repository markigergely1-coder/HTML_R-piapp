/**
 * Firestore lekérdezések — direkt browser-ből.
 * A kollekció nevek tükrözik a Python `modules/config.py` értékeit.
 */

import {
  collection,
  getDocs,
  getDoc,
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
    // Python `month_num` mezőt használ, korábbi TS kód `month`-ot — mindkettőre tűrünk
    list.push({
      id: d.id,
      year: Number(data.year ?? 0),
      month: Number(data.month_num ?? data.month ?? 0),
      month_name: data.month_name,
      saved_at: data.saved_at,
    });
  });
  return list.sort((a, b) => (b.year - a.year) || (b.month - a.month));
}

// ─────────────────────────────────────────────────────────────────
// Settlement teljes részletek (kalkuláció eredménye) — Python kompat
// ─────────────────────────────────────────────────────────────────

/**
 * Egy elmentett elszámolás teljes részletei (mind a per-session, mind
 * a per-person tábla).
 *
 * Python kompatibilis Firestore formátum:
 *   - `df_elszamolas`: JSON string, magyar oszlopnevekkel
 *   - `df_osszesito`: JSON string, magyar oszlopnevekkel
 */
export interface SettlementBreakdownRow {
  date: string;
  costPerSession: number;
  attendeeCount: number;
  costPerPerson: number;
}

export interface SettlementPersonRow {
  name: string;
  count: number;
  amount: number;
}

export interface FullSettlement {
  id: string;
  year: number;
  month: number;
  monthName: string;
  breakdown: SettlementBreakdownRow[];
  perPerson: SettlementPersonRow[];
}

function docIdFor(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Letölt egy mentett elszámolást (Python format is kompatibilis). */
export async function getSettlement(year: number, month: number): Promise<FullSettlement | null> {
  const ref = doc(db, COLLECTIONS.SETTLEMENTS, docIdFor(year, month));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  const monthName = (data.month_name ?? '').toString();

  // df_elszamolas és df_osszesito Python json string formátumban
  let breakdown: SettlementBreakdownRow[] = [];
  let perPerson: SettlementPersonRow[] = [];

  try {
    if (typeof data.df_elszamolas === 'string') {
      const arr = JSON.parse(data.df_elszamolas) as Array<Record<string, string | number>>;
      breakdown = arr.map((row) => ({
        date: String(row['Dátum'] ?? ''),
        costPerSession: parseNumberLikeHuf(row['Költség \\ alkalom']),
        attendeeCount: parseNumberLikeFo(row['Létszám']),
        costPerPerson: parseNumberLikeHuf(row['Költség \\ Fő']),
      }));
    } else if (Array.isArray(data.breakdown)) {
      breakdown = data.breakdown as SettlementBreakdownRow[];
    }
    if (typeof data.df_osszesito === 'string') {
      const arr = JSON.parse(data.df_osszesito) as Array<Record<string, string | number>>;
      perPerson = arr.map((row) => ({
        name: String(row['Név'] ?? ''),
        count: Number(row['Részvétel száma'] ?? 0),
        amount: Number(row['Fizetendő (Ft)'] ?? 0),
      }));
    } else if (Array.isArray(data.perPerson)) {
      perPerson = data.perPerson as SettlementPersonRow[];
    }
  } catch (err) {
    console.warn('[getSettlement] parse error:', err);
  }

  return {
    id: snap.id,
    year: Number(data.year ?? year),
    month: Number(data.month_num ?? data.month ?? month),
    monthName,
    breakdown,
    perPerson,
  };
}

/**
 * Elmenti egy elszámolás teljes részleteit. Python formátumban tárol,
 * hogy a Streamlit oldal is olvashassa.
 */
export async function saveSettlement(input: {
  year: number;
  month: number;
  monthName: string;
  breakdown: SettlementBreakdownRow[];
  perPerson: SettlementPersonRow[];
}): Promise<string> {
  const id = docIdFor(input.year, input.month);
  const df_elszamolas = input.breakdown.map((b) => ({
    'Dátum': b.date,
    'Költség \\ alkalom': `${Math.round(b.costPerSession)} Ft`,
    'Létszám': `${b.attendeeCount} fő`,
    'Költség \\ Fő': `${Math.round(b.costPerPerson)} Ft`,
  }));
  const df_osszesito = input.perPerson.map((p) => ({
    'Név': p.name,
    'Részvétel száma': p.count,
    'Fizetendő (Ft)': p.amount,
  }));
  await setDoc(doc(db, COLLECTIONS.SETTLEMENTS, id), {
    year: input.year,
    month_num: input.month,
    month_name: input.monthName,
    df_elszamolas: JSON.stringify(df_elszamolas),
    df_osszesito: JSON.stringify(df_osszesito),
    saved_at: serverTimestamp(),
  });
  return id;
}

/** "1234 Ft" / 1234 / "1234.5" → 1234.5 */
function parseNumberLikeHuf(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.replace(/Ft/gi, '').replace(/\s/g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** "12 fő" → 12 */
function parseNumberLikeFo(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/-?\d+/);
    return m ? Number(m[0]) : 0;
  }
  return 0;
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
