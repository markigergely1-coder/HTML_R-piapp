/**
 * Revolut CSV kivonat parser + befizetés-egyeztetés.
 * Port a Python `modules/utils.py::parse_revolut_csv` + `pages/payments.py` logikából.
 *
 * Tipikus Revolut kivonat oszlopok (HU):
 *   Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance
 *   vagy magyarul: Típus, Termék, Indítva, Elvégezve, Leírás, Összeg, Díj, Pénznem, Állapot, Egyenleg
 *
 * Bejövő átutalások (positive amount) leírása tipikusan:
 *   "Átutalás tőle: KISS JÁNOS" / "Transfer from KISS JÁNOS" / "From KISS JÁNOS"
 */

import type { SettlementPersonRow } from './firestore';

export interface RevolutTransaction {
  /** Tisztított név (a leírásból kinyerve) */
  name: string;
  /** Bejövő összeg Ft-ban */
  amount: number;
  /** Eredeti leírás (debug céllal) */
  rawDescription: string;
}

export interface RevolutParseResult {
  transactions: RevolutTransaction[];
  /** Az összes felismert oszlop, hibakezelési segítségre */
  columns: string[];
  error?: string;
}

export interface PaymentMatchResult {
  systemName: string;
  expected: number;
  paid: number | null;
  matchedRevolutName: string | null;
  diff: number | null;
  status: PaymentStatus;
}

export type PaymentStatus =
  | 'paid'           // ✅ Pontosan vagy ±tolerance-en belül
  | 'overpaid'       // ✅ Többet fizetett (> tolerance)
  | 'underpaid'      // ⚠️ Kevesebbet fizetett (< -tolerance)
  | 'unpaid';        // ❌ Nem találtunk fizetést

// ─────────────────────────────────────────────────────────────────
// CSV parser
// ─────────────────────────────────────────────────────────────────

/**
 * Minimális CSV parser ami kezeli az idézőjeles mezőket és a megadott elválasztót.
 * Visszaadja a sorokat string[][] formában.
 */
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Idézőjel-escape: ""
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        current.push(field);
        field = '';
      } else if (ch === '\n') {
        current.push(field);
        rows.push(current);
        current = [];
        field = '';
      } else if (ch === '\r') {
        // CRLF: nem csinálunk semmit, a következő \n elintézi
      } else {
        field += ch;
      }
    }
  }
  // Utolsó sor (ha nincs trailing newline)
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}

/**
 * Detektálja az elválasztó karaktert (`,` vagy `;`).
 * A több oszlopot adó elválasztó nyer.
 */
function detectSeparator(firstLine: string): string {
  const comma = (firstLine.match(/,/g) ?? []).length;
  const semi = (firstLine.match(/;/g) ?? []).length;
  return semi > comma ? ';' : ',';
}

/**
 * Bejövő átutalás-e? A Python verzió ezt a leírásból szűri:
 * "tőle | tole | transfer from | from" + amount > 0.
 */
function isIncoming(description: string): boolean {
  const lower = description.toLowerCase();
  return /(t[őo]le|transfer\s+from|^from\s|from\s+\w)/.test(lower);
}

/**
 * Név kinyerése a leírásból:
 *   "Átutalás tőle: KISS JÁNOS" → "KISS JÁNOS"
 *   "Transfer from KISS JÁNOS" → "KISS JÁNOS"
 *   ha nem talál prefixet, visszaadja az egész leírást
 */
function extractName(description: string): string {
  const lower = description.toLowerCase();
  const prefixes = ['átutalás tőle:', 'atutalas tole:', 'transfer from:', 'transfer from', 'from:', 'from '];
  for (const p of prefixes) {
    const idx = lower.indexOf(p);
    if (idx >= 0) {
      return description.slice(idx + p.length).trim();
    }
  }
  return description.trim();
}

/** Magyar+nemzetközi nyelvi oszlopnevek felismerése. */
function findColumn(columns: string[], substrings: string[]): string | null {
  for (const c of columns) {
    const lower = c.toLowerCase();
    if (substrings.some((s) => lower.includes(s.toLowerCase()))) return c;
  }
  return null;
}

export function parseRevolutCsv(text: string): RevolutParseResult {
  if (!text || text.trim().length === 0) {
    return { transactions: [], columns: [], error: 'A fájl üres.' };
  }

  // Első sor alapján detektáljuk az elválasztót, de ha az első próba kevés
  // oszlopot ad (< 3), próbáljuk a másikat.
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  let sep = detectSeparator(firstLine);

  let rows = parseCsv(text, sep);
  if ((rows[0]?.length ?? 0) < 3) {
    const altSep = sep === ',' ? ';' : ',';
    const altRows = parseCsv(text, altSep);
    if ((altRows[0]?.length ?? 0) > (rows[0]?.length ?? 0)) {
      rows = altRows;
      sep = altSep;
    }
  }

  if (rows.length === 0) return { transactions: [], columns: [], error: 'Nem sikerült értelmezni a CSV-t.' };

  const header = (rows[0] ?? []).map((c) => c.trim());
  const dataRows = rows.slice(1).filter((r) => r.length === header.length || r.length > 1);

  const descCol  = findColumn(header, ['leírás', 'leiras', 'description']);
  const amountCol = findColumn(header, ['összeg', 'osszeg', 'amount']);
  const stateCol  = findColumn(header, ['állapot', 'allapot', 'state']);

  if (!descCol || !amountCol) {
    return {
      transactions: [],
      columns: header,
      error: `Nem találom a "Leírás" vagy "Összeg" oszlopot. Talált oszlopok: ${header.join(', ')}`,
    };
  }

  const descIdx = header.indexOf(descCol);
  const amountIdx = header.indexOf(amountCol);
  const stateIdx = stateCol ? header.indexOf(stateCol) : -1;

  const transactions: RevolutTransaction[] = [];
  for (const row of dataRows) {
    const state = stateIdx >= 0 ? (row[stateIdx] ?? '').toString().toUpperCase().trim() : '';
    if (stateIdx >= 0 && state !== 'ELVÉGEZVE' && state !== 'COMPLETED') continue;

    const rawAmount = (row[amountIdx] ?? '').toString().replace(',', '.').replace(/\s/g, '');
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const desc = (row[descIdx] ?? '').toString();
    if (!isIncoming(desc)) continue;

    const name = extractName(desc);
    if (!name) continue;

    transactions.push({ name, amount, rawDescription: desc });
  }

  // Ha ugyanaz a név többször előfordul (több utalás), összeadjuk
  const merged = new Map<string, RevolutTransaction>();
  for (const t of transactions) {
    const key = t.name.toUpperCase();
    const existing = merged.get(key);
    if (existing) {
      existing.amount += t.amount;
    } else {
      merged.set(key, { ...t });
    }
  }

  return { transactions: [...merged.values()], columns: header };
}

// ─────────────────────────────────────────────────────────────────
// Befizetés-egyeztetés
// ─────────────────────────────────────────────────────────────────

/**
 * Egyezteti a Revolut tranzakciókat a settlement osszesito-jával.
 *
 * Algoritmus tagonként:
 *  1) Ha van mentett név-mapping (revolut→system), próbálkozunk azzal
 *  2) Ha nincs vagy nem talált, próbáljuk a saját néven (case-insensitive)
 *  3) Fuzzy fallback: a rendszerbeli első/utolsó név egyezik-e a Revolut névben
 *     (csak akkor egyezik, ha PONTOSAN EGY ilyen jelölt van)
 *  4) Státusz: paid / overpaid / underpaid / unpaid (tolerance figyelembevételével)
 */
export function matchPayments(
  perPerson: SettlementPersonRow[],
  transactions: RevolutTransaction[],
  nameMappings: Map<string, string>, // revolut_name (upper) → system_name
  tolerance: number,
): { results: PaymentMatchResult[]; matchedRevolutNames: Set<string> } {
  const txByName = new Map<string, RevolutTransaction>();
  for (const t of transactions) txByName.set(t.name.toUpperCase(), t);

  // system_name → revolut_name fordítás (utánanézésre)
  const systemToRev = new Map<string, string>(); // system_name lower → revolut_name upper
  for (const [revUpper, sys] of nameMappings) {
    systemToRev.set(sys.toLowerCase(), revUpper);
  }

  // Csak fő tagok (vendégek "Foo - Bar" formátum, kihagyjuk)
  const mainMembers = perPerson.filter((p) => !p.name.includes(' - '));

  const results: PaymentMatchResult[] = [];
  const matchedRevolutNames = new Set<string>();

  for (const m of mainMembers) {
    const sysName = m.name;
    const expected = m.amount;
    let paid: number | null = null;
    let matchedRev: string | null = null;

    // 1) Manuális mapping
    const mappedRevUpper = systemToRev.get(sysName.toLowerCase());
    if (mappedRevUpper) {
      const t = txByName.get(mappedRevUpper);
      if (t) {
        paid = t.amount;
        matchedRev = t.name;
        matchedRevolutNames.add(t.name);
      }
    }

    // 2) Direct név egyezés (case-insensitive)
    if (paid === null) {
      const direct = txByName.get(sysName.toUpperCase());
      if (direct) {
        paid = direct.amount;
        matchedRev = direct.name;
        matchedRevolutNames.add(direct.name);
      }
    }

    // 3) Fuzzy: első/utolsó névrész egyezés
    if (paid === null) {
      const parts = sysName.split(/\s+/).filter(Boolean);
      const first = (parts[0] ?? '').toLowerCase();
      const last = (parts[parts.length - 1] ?? '').toLowerCase();
      const candidates: RevolutTransaction[] = [];
      for (const t of transactions) {
        if (matchedRevolutNames.has(t.name)) continue;
        const tLower = t.name.toLowerCase();
        if ((first && tLower.includes(first)) || (last && last !== first && tLower.includes(last))) {
          candidates.push(t);
        }
      }
      if (candidates.length === 1) {
        const c = candidates[0]!;
        paid = c.amount;
        matchedRev = c.name;
        matchedRevolutNames.add(c.name);
      }
    }

    let diff: number | null = null;
    let status: PaymentStatus;
    if (paid === null) {
      status = 'unpaid';
    } else {
      diff = paid - expected;
      if (Math.abs(diff) <= tolerance) status = 'paid';
      else if (diff > tolerance) status = 'overpaid';
      else status = 'underpaid';
    }

    results.push({
      systemName: sysName,
      expected,
      paid,
      matchedRevolutName: matchedRev,
      diff,
      status,
    });
  }

  return { results, matchedRevolutNames };
}
