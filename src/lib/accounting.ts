/**
 * Havi elszámolás kalkuláció — port a Python `modules/utils.py`-ból.
 *
 * Logika:
 *  1. Adott hónap összes keddi dátuma (`getTuesdaysInMonth`)
 *  2. Lemondott napok kiszűrése → érvényes edzésnapok
 *  3. cost_per_session = total_amount / num_sessions
 *  4. Per session: yes_set − no_set = résztvevők → cost_per_session / fő
 *  5. Per ember: az összes részvétel költségének összege
 */

import { getTuesdaysInMonth } from './dates';
import type { Invoice, RawAttendance, CancelledSession } from './firestore';

export interface AccountingBreakdownRow {
  date: string;          // YYYY-MM-DD
  costPerSession: number;
  attendeeCount: number;
  costPerPerson: number;
}

export interface AccountingPersonRow {
  name: string;
  count: number;
  amount: number;
}

export interface AccountingResult {
  monthName: string;
  year: number;
  totalAmount: number;
  sessionDates: string[];
  breakdown: AccountingBreakdownRow[];
  perPerson: AccountingPersonRow[];
}

/**
 * Kiszámolja egy adott számla (havi terembér) elszámolását.
 * Hibát dob ha nincs érvényes edzésnap (pl. mindegyik le van mondva).
 */
export function calculateMonthlyAccounting(
  invoice: Invoice,
  attendance: RawAttendance[],
  cancelled: Map<string, CancelledSession>,
  monthNamesHu: string[],
): AccountingResult {
  const year = invoice.target_year;
  const month = invoice.target_month;
  const totalAmount = invoice.amount;
  const monthName = monthNamesHu[month - 1] ?? `${month}. hónap`;

  const allTuesdays = getTuesdaysInMonth(year, month);
  const sessionDates = allTuesdays.filter((d) => !cancelled.has(d));

  if (sessionDates.length === 0) {
    throw new Error(`Nincsenek érvényes edzésnapok ${year}. ${monthName} hónapban.`);
  }

  const costPerSession = totalAmount / sessionDates.length;

  // Csoportosítás dátum + Yes/No szerint (csak valós mód)
  const yesByDate = new Map<string, Set<string>>();
  const noByDate = new Map<string, Set<string>>();
  for (const d of sessionDates) {
    yesByDate.set(d, new Set());
    noByDate.set(d, new Set());
  }
  for (const rec of attendance) {
    const mode = (rec.mode ?? 'valós').toLowerCase();
    if (mode === 'teszt') continue;
    const name = rec.name?.trim();
    if (!name) continue;
    const date = rec.event_date;
    if (!sessionDates.includes(date)) continue;
    if (rec.status === 'Yes') yesByDate.get(date)!.add(name);
    else if (rec.status === 'No') noByDate.get(date)!.add(name);
  }

  const breakdown: AccountingBreakdownRow[] = [];
  const personTotals = new Map<string, number>();
  const personCounts = new Map<string, number>();

  for (const date of sessionDates) {
    const yes = yesByDate.get(date)!;
    const no = noByDate.get(date)!;
    // Final attendees: aki Yes-t adott és nem adott No-t
    const finalAttendees = [...yes].filter((n) => !no.has(n));
    const attendeeCount = finalAttendees.length;
    const costPerPerson = attendeeCount > 0 ? costPerSession / attendeeCount : 0;

    breakdown.push({ date, costPerSession, attendeeCount, costPerPerson });

    for (const n of finalAttendees) {
      personTotals.set(n, (personTotals.get(n) ?? 0) + costPerPerson);
      personCounts.set(n, (personCounts.get(n) ?? 0) + 1);
    }
  }

  const perPerson: AccountingPersonRow[] = [...personTotals.keys()]
    .sort((a, b) => a.localeCompare(b, 'hu'))
    .map((name) => ({
      name,
      count: personCounts.get(name) ?? 0,
      amount: personTotals.get(name) ?? 0,
    }));

  return { monthName, year, totalAmount, sessionDates, breakdown, perPerson };
}
