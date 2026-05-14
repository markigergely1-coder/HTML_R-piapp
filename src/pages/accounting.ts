/**
 * 💰 Havi Elszámolás — admin-only.
 *
 * Funkcionalitás (Python `accounting.py` port):
 *   - Számla (invoice) kiválasztása
 *   - "Elszámolás Kalkulálása" → kalkuláció + automatikus mentés Firestore-ba
 *   - Mentett elszámolás betöltése (ha létezik)
 *   - Bontás alkalmanként + személyenkénti összesítő
 *   - Tömeges elszámolás-generálás az összes számlára
 */

import { renderHeader } from '../components/header';
import { getAuthState, onAuthChange, signIn } from '../lib/auth';
import { logEvent } from '../lib/logger';
import {
  getAllSettlements,
  getAllInvoices,
  getAllAttendanceRecords,
  getAllMembers,
  getCancelledSessions,
  getSettlement,
  saveSettlement,
  type Settlement,
  type Invoice,
  type FullSettlement,
  type Member,
} from '../lib/firestore';
import { calculateMonthlyAccounting, type AccountingResult } from '../lib/accounting';
import { formatHuf } from '../lib/cost';
import { MONTHS_HU } from '../lib/config';

interface EmailRecipient {
  systemName: string;
  email: string;
  count: number;       // saját + vendég összesen
  amount: number;      // saját + vendég Ft összesen
  ownCount: number;
  ownAmount: number;
  guests: { name: string; count: number; amount: number }[];
  selected: boolean;   // pipálva → küldjük neki
}

interface AccState {
  settlements: Settlement[];
  invoices: Invoice[];
  members: Member[];
  selectedInvoiceId: string | null;
  loadedCalc: AccountingResult | FullSettlement | null;
  loadedFromCache: boolean;
  calculating: boolean;
  bulkRunning: boolean;
  bulkForce: boolean;
  bulkResult: BulkResult | null;
  // Email küldés
  emailRecipients: EmailRecipient[];
  emailAdminToggle: boolean;
  emailSending: boolean;
  emailResult: { sent: number; failed: { to: string; reason: string }[]; adminSent: boolean } | null;
  toast: { kind: 'success' | 'error' | 'info'; msg: string } | null;
}

interface BulkResult {
  ok: { label: string; year: number; month: number; people: number; total: number }[];
  skipped: { label: string }[];
  failed: { label: string; reason: string }[];
  total: number;
}

let toastTimer: number | null = null;

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderAccountingPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const auth = getAuthState();
  if (auth.loading) return;
  if (!auth.user)        return showSignInGate(container);
  if (!auth.isAdmin)     return showNoPermissionGate(container, auth.user.email ?? '');

  const [settlements, invoices, members] = await Promise.all([
    getAllSettlements(),
    getAllInvoices(),
    getAllMembers().catch(() => [] as Member[]),
  ]);

  const state: AccState = {
    settlements,
    invoices,
    members,
    selectedInvoiceId: invoices[0]?.id ?? null,
    loadedCalc: null,
    loadedFromCache: false,
    calculating: false,
    bulkRunning: false,
    bulkForce: false,
    bulkResult: null,
    emailRecipients: [],
    emailAdminToggle: true,
    emailSending: false,
    emailResult: null,
    toast: null,
  };

  // Ha van első invoice és van hozzá mentett elszámolás, betöltjük előre
  if (state.selectedInvoiceId) {
    const inv = invoices.find((i) => i.id === state.selectedInvoiceId)!;
    const existing = await getSettlement(inv.target_year, inv.target_month);
    if (existing) {
      state.loadedCalc = existing;
      state.loadedFromCache = true;
    }
  }
  recomputeEmailRecipients(state);

  rerender(container, state);

  const unsub = onAuthChange((s) => {
    if (!s.user || !s.isAdmin) { unsub(); renderAccountingPage(container); }
  });
}

// ─────────────────────────────────────────────────────────────────
// Shell + gate-ek (közös)
// ─────────────────────────────────────────────────────────────────

function renderShell(body: string): string {
  return `
    <div class="device">
      ${renderHeader('accounting')}
      <main id="acc-body">${body}</main>
    </div>`;
}

function renderLoadingBody(): string {
  return `
    <div class="px-5 pt-5 space-y-3">
      <div class="grid grid-cols-3 gap-2.5">
        ${Array(3).fill(0).map(() => `<div class="h-20 rounded-2xl animate-pulse" style="background:var(--line)"></div>`).join('')}
      </div>
      ${Array(4).fill(0).map(() => `<div class="h-16 rounded-2xl animate-pulse" style="background:var(--line)"></div>`).join('')}
    </div>`;
}

function showSignInGate(container: HTMLElement): void {
  container.innerHTML = renderShell(`
    <div class="px-5 pt-5 pb-12 fade-up">
      <div class="card relative p-6 text-center overflow-hidden" style="border-radius:24px">
        <div class="halo"></div>
        <div class="relative">
          <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
               style="background:color-mix(in oklab,var(--accent) 14%,transparent)">
            <span class="text-3xl">🔒</span>
          </div>
          <p class="text-[17px] font-semibold text-fg-1 mb-1">Csak admin oldal</p>
          <button id="gate-signin"
            class="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm"
            style="background:var(--accent)">
            Bejelentkezés
          </button>
        </div>
      </div>
    </div>`);
  container.querySelector<HTMLButtonElement>('#gate-signin')?.addEventListener('click', () => {
    signIn().catch((e) => console.warn(e));
  });
}

function showNoPermissionGate(container: HTMLElement, email: string): void {
  container.innerHTML = renderShell(`
    <div class="px-5 pt-5 pb-12 fade-up">
      <div class="card-soft p-6 text-center" style="border-radius:24px">
        <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4" style="background:color-mix(in oklab,#f59e0b 14%,transparent)">
          <span class="text-3xl">⛔</span>
        </div>
        <p class="text-[17px] font-semibold text-fg-1 mb-1">Nincs admin jogosultság</p>
        <p class="text-[13px] text-fg-3">${eh(email)}</p>
      </div>
    </div>`);
}

// ─────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────

function renderBody(state: AccState): string {
  const totalAmount = state.invoices.reduce((s, i) => s + i.amount, 0);

  if (state.invoices.length === 0) {
    return `
      <div class="px-5 pt-5 pb-12">
        <div class="card-soft p-8 text-center" style="border-radius:22px">
          <div class="text-3xl mb-2">📭</div>
          <p class="text-[14px] font-semibold text-fg-1">Nincs számla</p>
          <p class="text-[12px] text-fg-3 mt-1">Először szinkronizáld a számlákat az Adatbázis oldalról.</p>
        </div>
      </div>`;
  }

  const invoiceOptions = state.invoices.map((inv) => {
    const monthName = MONTHS_HU[inv.target_month - 1] ?? `${inv.target_month}. hó`;
    const label = `${inv.target_year}. ${monthName} (Számla: ${inv.inv_date} · ${formatHuf(inv.amount)})`;
    return `<option value="${eh(inv.id)}" ${inv.id === state.selectedInvoiceId ? 'selected' : ''}>${eh(label)}</option>`;
  }).join('');

  return `
    <div class="px-5 pt-5 pb-12 lg:px-6 lg:pt-5 space-y-4">
      <!-- Stat sáv -->
      <div class="grid grid-cols-3 gap-2 fade-up">
        ${statCard('Számlák',    state.invoices.length,    'red')}
        ${statCard('Elszámolás', state.settlements.length, 'sky')}
        ${statCard('Össz.',      totalAmount,              'emerald', true)}
      </div>

      <!-- Invoice kiválasztó + Kalkulálás -->
      <div class="card p-4 fade-up" style="border-radius:18px">
        <p class="eyebrow text-[10px] mb-2">Hónap kiválasztása</p>
        <select id="acc-invoice-sel"
          class="select-native w-full rounded-[10px] border px-3 py-2 text-[13px] font-medium text-fg-1 focus:outline-none"
          style="border-color:var(--line-strong); background:var(--bg-card)">
          ${invoiceOptions}
        </select>
        <button id="acc-calc-btn"
          class="mt-3 w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors ${state.calculating ? 'opacity-60 cursor-not-allowed' : ''}"
          style="background:var(--accent)"
          ${state.calculating ? 'disabled' : ''}>
          ${state.calculating ? 'Kalkulálás…' : 'Elszámolás Kalkulálása 🚀'}
        </button>
      </div>

      <!-- Mentett elszámolás eredménye -->
      ${state.loadedCalc ? renderCalcResult(state) : ''}

      <!-- Email küldés szekció -->
      ${state.loadedCalc ? renderEmailSection(state) : ''}

      <!-- Tömeges szekció -->
      ${renderBulkSection(state)}

      ${state.toast ? renderToast(state.toast) : ''}
    </div>`;
}

function statCard(label: string, value: number, tone: 'red' | 'sky' | 'emerald', isMoney = false): string {
  const tones: Record<string, { dot: string; tint: string }> = {
    red:     { dot: 'var(--accent)',  tint: 'color-mix(in oklab,var(--accent) 10%,transparent)' },
    sky:     { dot: '#0ea5e9',        tint: 'rgba(14,165,233,0.10)' },
    emerald: { dot: '#10b981',        tint: 'rgba(16,185,129,0.10)' },
  };
  const t = tones[tone];
  const display = isMoney ? formatHuf(value) : String(value);
  return `
    <div class="card relative p-3.5 overflow-hidden lift">
      <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:${t.tint};filter:blur(8px)"></div>
      <div class="relative flex items-center justify-between mb-2">
        <span class="eyebrow text-[10px]">${label}</span>
        <span class="w-1.5 h-1.5 rounded-full" style="background:${t.dot}"></span>
      </div>
      <p class="relative font-mono-tnum font-semibold leading-none num-display text-fg-1 ${isMoney ? 'text-[16px]' : 'text-[24px]'}">${display}</p>
    </div>`;
}

function renderCalcResult(state: AccState): string {
  const c = state.loadedCalc!;
  const monthName = 'monthName' in c ? c.monthName : '';
  const year = c.year;
  const breakdown = c.breakdown ?? [];
  const perPerson = c.perPerson ?? [];

  const totalPaid = perPerson.reduce((s, p) => s + p.amount, 0);

  const statusBadge = state.loadedFromCache
    ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:rgba(14,165,233,0.14);color:#0369a1">💾 Mentett</span>`
    : `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:rgba(16,185,129,0.14);color:#047857">✅ Most kalkulálva</span>`;

  const breakdownRows = breakdown.map((b) => `
    <tr style="border-top:1px solid var(--line)">
      <td class="px-3 py-2 text-[12px] font-medium text-fg-1">${eh(b.date)}</td>
      <td class="px-3 py-2 text-[12px] text-fg-2 text-right font-mono-tnum">${eh(formatHuf(b.costPerSession))}</td>
      <td class="px-3 py-2 text-[12px] text-fg-2 text-right font-mono-tnum">${b.attendeeCount} fő</td>
      <td class="px-3 py-2 text-[12px] text-fg-1 text-right font-mono-tnum font-semibold">${eh(formatHuf(b.costPerPerson))}</td>
    </tr>
  `).join('');

  const personRows = perPerson.map((p) => `
    <tr style="border-top:1px solid var(--line)">
      <td class="px-3 py-2 text-[12px] font-medium text-fg-1">${eh(p.name)}</td>
      <td class="px-3 py-2 text-[12px] text-fg-2 text-right font-mono-tnum">${p.count}</td>
      <td class="px-3 py-2 text-[12px] text-fg-1 text-right font-mono-tnum font-semibold">${eh(formatHuf(p.amount))}</td>
    </tr>
  `).join('');

  return `
    <div class="card fade-up overflow-hidden" style="border-radius:20px">
      <div class="px-4 py-3 flex items-center justify-between gap-2" style="border-bottom:1px solid var(--line)">
        <div class="min-w-0 flex-1">
          <p class="eyebrow text-[10px] mb-0.5">Elszámolás</p>
          <p class="text-[15px] font-bold text-fg-1 truncate">${eh(year + '. ' + monthName)}</p>
        </div>
        <div class="flex items-center gap-2 flex-none">
          ${statusBadge}
          <button id="acc-download-pdf"
            class="text-[11.5px] font-semibold px-2.5 py-1 rounded-full transition-colors inline-flex items-center gap-1"
            style="background:color-mix(in oklab,var(--accent) 14%,transparent);color:var(--accent-ink)"
            title="PDF letöltése">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 2v9M5 8l3 3 3-3M3 13h10"/>
            </svg>
            PDF
          </button>
        </div>
      </div>

      <!-- Per session breakdown -->
      <div class="px-4 pt-3">
        <p class="eyebrow text-[10px] mb-2">Bontás alkalmanként</p>
        <div class="rounded-lg overflow-hidden" style="border:1px solid var(--line)">
          <table class="w-full" style="border-collapse:collapse">
            <thead style="background:var(--bg-elev)">
              <tr>
                <th class="px-3 py-2 text-[10.5px] text-left font-semibold text-fg-3 uppercase tracking-wider">Dátum</th>
                <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Költség / alk.</th>
                <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Létszám</th>
                <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Költség / fő</th>
              </tr>
            </thead>
            <tbody>${breakdownRows || '<tr><td colspan="4" class="px-3 py-3 text-center text-[12px] text-fg-3">Nincs adat</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <!-- Per person summary -->
      <div class="px-4 pt-4 pb-4">
        <p class="eyebrow text-[10px] mb-2">Személyenkénti összesítő</p>
        <div class="rounded-lg overflow-hidden" style="border:1px solid var(--line)">
          <table class="w-full" style="border-collapse:collapse">
            <thead style="background:var(--bg-elev)">
              <tr>
                <th class="px-3 py-2 text-[10.5px] text-left font-semibold text-fg-3 uppercase tracking-wider">Név</th>
                <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Részvétel</th>
                <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Fizetendő</th>
              </tr>
            </thead>
            <tbody>${personRows || '<tr><td colspan="3" class="px-3 py-3 text-center text-[12px] text-fg-3">Nincs adat</td></tr>'}</tbody>
            ${perPerson.length > 0 ? `
              <tfoot>
                <tr style="border-top:2px solid var(--line-strong);background:var(--bg-elev)">
                  <td class="px-3 py-2 text-[11.5px] font-bold text-fg-1">Összesen</td>
                  <td class="px-3 py-2 text-[11.5px] text-right font-mono-tnum font-bold text-fg-1">${perPerson.reduce((s, p) => s + p.count, 0)}</td>
                  <td class="px-3 py-2 text-[11.5px] text-right font-mono-tnum font-bold text-fg-1">${eh(formatHuf(totalPaid))}</td>
                </tr>
              </tfoot>` : ''}
          </table>
        </div>
      </div>
    </div>
  `;
}

// ─── Email recipients derivation ─────────────────────────────────

function recomputeEmailRecipients(state: AccState) {
  const calc = state.loadedCalc;
  if (!calc) {
    state.emailRecipients = [];
    return;
  }
  const emailByName = new Map<string, { email: string; active: boolean }>();
  for (const m of state.members) {
    if (m.name) emailByName.set(m.name.trim(), { email: m.email, active: m.active });
  }

  const recipients: EmailRecipient[] = [];
  // Csak főtagok (ne tartalmazza " - "-t)
  const mainRows = calc.perPerson.filter((p) => !p.name.includes(' - '));
  for (const main of mainRows) {
    const lookup = emailByName.get(main.name);
    if (!lookup || !lookup.email || !lookup.active) continue;

    // Vendég sorok: pontosan ezzel a prefix-szel
    const prefix = `${main.name} - `;
    const guests = calc.perPerson
      .filter((p) => p.name.startsWith(prefix))
      .map((p) => ({
        name: p.name.slice(prefix.length),
        count: p.count,
        amount: p.amount,
      }));
    const guestTotalCount = guests.reduce((s, g) => s + g.count, 0);
    const guestTotalAmount = guests.reduce((s, g) => s + g.amount, 0);

    const total = main.amount + guestTotalAmount;
    if (total <= 0) continue;

    recipients.push({
      systemName: main.name,
      email: lookup.email,
      count: main.count + guestTotalCount,
      amount: total,
      ownCount: main.count,
      ownAmount: main.amount,
      guests,
      selected: true,
    });
  }
  state.emailRecipients = recipients;
}

// ─── Email szekció rendering ─────────────────────────────────────

function renderEmailSection(state: AccState): string {
  if (state.emailRecipients.length === 0) {
    return `
      <div class="card p-4 fade-up" style="border-radius:18px">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-lg">📧</span>
          <p class="text-[14px] font-semibold text-fg-1">Email küldés</p>
        </div>
        <p class="text-[11.5px] text-fg-3">Nincs aktív tag email-címmel ehhez az elszámoláshoz. (A Tagok oldalon vegyél fel embereket email-lel.)</p>
      </div>`;
  }

  const selectedCount = state.emailRecipients.filter((r) => r.selected).length;

  const rows = state.emailRecipients.map((r, idx) => {
    const guestSummary = r.guests.length > 0
      ? `<span class="text-[10.5px] text-fg-3"> · vendég: ${eh(r.guests.map((g) => g.name).join(', '))}</span>`
      : '';
    return `
      <li class="px-3 py-2.5 flex items-center gap-3" style="${idx === 0 ? '' : 'border-top:1px solid var(--line);'}">
        <input type="checkbox" class="acc-email-cb" data-idx="${idx}"
          ${r.selected ? 'checked' : ''}
          style="width:16px;height:16px;accent-color:var(--accent);flex:none;" />
        <div class="flex-1 min-w-0">
          <p class="text-[12.5px] font-semibold text-fg-1 truncate">${eh(r.systemName)}</p>
          <p class="text-[10.5px] text-fg-3 truncate">${eh(r.email)}${guestSummary}</p>
        </div>
        <div class="text-right flex-none">
          <p class="text-[12px] font-mono-tnum font-semibold text-fg-1">${eh(formatHuf(r.amount))}</p>
          <p class="text-[10px] text-fg-3 font-mono-tnum">${r.count} alk.</p>
        </div>
      </li>`;
  }).join('');

  return `
    <div class="card fade-up overflow-hidden" style="border-radius:20px">
      <div class="px-4 py-3 flex items-center justify-between gap-2" style="border-bottom:1px solid var(--line)">
        <div>
          <p class="eyebrow text-[10px] mb-0.5">📧 Email küldés</p>
          <p class="text-[13px] font-semibold text-fg-1">${selectedCount} / ${state.emailRecipients.length} tag kijelölve</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="acc-email-all" class="text-[11.5px] font-semibold px-2.5 py-1 rounded-full"
            style="background:var(--bg-elev);color:var(--fg-2)">Mindet</button>
          <button id="acc-email-none" class="text-[11.5px] font-semibold px-2.5 py-1 rounded-full"
            style="background:var(--bg-elev);color:var(--fg-2)">Egyiket sem</button>
        </div>
      </div>
      <ul>${rows}</ul>
      <div class="px-4 py-3" style="border-top:1px solid var(--line)">
        <label class="flex items-center gap-2 mb-3 cursor-pointer">
          <input type="checkbox" id="acc-email-admin"
            ${state.emailAdminToggle ? 'checked' : ''}
            style="width:16px;height:16px;accent-color:var(--accent);" />
          <span class="text-[12px] text-fg-2">📊 Admin összesítő küldése PDF-fel (saját email-edre)</span>
        </label>
        <button id="acc-email-send"
          class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors ${state.emailSending || (selectedCount === 0 && !state.emailAdminToggle) ? 'opacity-60 cursor-not-allowed' : ''}"
          style="background:var(--accent)"
          ${state.emailSending || (selectedCount === 0 && !state.emailAdminToggle) ? 'disabled' : ''}>
          ${state.emailSending ? 'Küldés…' : `📧 Küldés (${selectedCount} fő${state.emailAdminToggle ? ' + admin' : ''})`}
        </button>
        ${state.emailResult ? renderEmailResult(state.emailResult) : ''}
      </div>
    </div>`;
}

function renderEmailResult(r: { sent: number; failed: { to: string; reason: string }[]; adminSent: boolean }): string {
  const failList = r.failed.length > 0
    ? `<ul class="mt-1 space-y-0.5 text-[10.5px]" style="color:#7f1d1d">
        ${r.failed.map((f) => `<li>• ${eh(f.to)}: ${eh(f.reason)}</li>`).join('')}
      </ul>`
    : '';
  return `
    <div class="mt-3 p-2.5 rounded-lg" style="background:${r.failed.length === 0 ? 'rgba(16,185,129,0.10)' : 'rgba(245,158,11,0.10)'};color:${r.failed.length === 0 ? '#047857' : '#92400e'}">
      <p class="text-[12px] font-semibold">
        ✅ ${r.sent} email kiküldve${r.adminSent ? ' + admin összesítő' : ''}${r.failed.length > 0 ? ` · ${r.failed.length} sikertelen` : ''}
      </p>
      ${failList}
    </div>`;
}

function renderBulkSection(state: AccState): string {
  return `
    <div class="card p-4 fade-up" style="border-radius:18px">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-lg">🔄</span>
        <p class="text-[14px] font-semibold text-fg-1">Összes elszámolás generálása</p>
      </div>
      <p class="text-[11.5px] text-fg-3 mb-3 leading-relaxed">
        Lefuttatja az elszámolás kalkulációt az ÖSSZES Firestore-ban lévő számlára,
        és menti az eredményt. A profil oldalon ezután pontos éves összegek jelennek meg.
      </p>
      <label class="flex items-center gap-2 mb-3 cursor-pointer">
        <input type="checkbox" id="acc-bulk-force" ${state.bulkForce ? 'checked' : ''}
          class="rounded" style="accent-color:var(--accent)">
        <span class="text-[12px] text-fg-2">🔁 Már meglévő elszámolások felülírása (újraszámolás)</span>
      </label>
      <button id="acc-bulk-btn"
        class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors ${state.bulkRunning ? 'opacity-60 cursor-not-allowed' : ''}"
        style="background:var(--accent)"
        ${state.bulkRunning ? 'disabled' : ''}>
        ${state.bulkRunning ? 'Feldolgozás…' : '🚀 Összes elszámolás generálása'}
      </button>
      ${state.bulkResult ? renderBulkResult(state.bulkResult) : ''}
    </div>
  `;
}

function renderBulkResult(r: BulkResult): string {
  const okList = r.ok.length > 0
    ? `<div class="mt-3 p-2.5 rounded-lg" style="background:rgba(16,185,129,0.10)">
        <p class="text-[12px] font-semibold mb-1" style="color:#047857">✅ Sikeresen: ${r.ok.length}/${r.total}</p>
        <ul class="text-[11px] space-y-0.5" style="color:#065f46">
          ${r.ok.map((o) => `<li>• ${eh(o.label)} — ${o.people} fő, ${eh(formatHuf(o.total))}</li>`).join('')}
        </ul>
      </div>`
    : '';
  const skipList = r.skipped.length > 0
    ? `<div class="mt-2 p-2.5 rounded-lg" style="background:rgba(14,165,233,0.10)">
        <p class="text-[12px] font-semibold mb-1" style="color:#0369a1">⏭️ Kihagyva: ${r.skipped.length}</p>
        <ul class="text-[11px] space-y-0.5" style="color:#075985">
          ${r.skipped.map((s) => `<li>• ${eh(s.label)}</li>`).join('')}
        </ul>
      </div>`
    : '';
  const failList = r.failed.length > 0
    ? `<div class="mt-2 p-2.5 rounded-lg" style="background:rgba(239,68,68,0.10)">
        <p class="text-[12px] font-semibold mb-1" style="color:#b91c1c">⚠️ Sikertelen: ${r.failed.length}</p>
        <ul class="text-[11px] space-y-0.5" style="color:#7f1d1d">
          ${r.failed.map((f) => `<li>• ${eh(f.label)}: ${eh(f.reason)}</li>`).join('')}
        </ul>
      </div>`
    : '';
  return `${okList}${skipList}${failList}`;
}

function renderToast(t: NonNullable<AccState['toast']>): string {
  const palette = t.kind === 'success'
    ? { bg: 'rgba(16,185,129,0.14)', col: '#047857' }
    : t.kind === 'error'
    ? { bg: 'rgba(239,68,68,0.14)', col: '#b91c1c' }
    : { bg: 'rgba(14,165,233,0.14)', col: '#0369a1' };
  return `
    <div class="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 px-4 py-2.5 rounded-full text-[12.5px] font-semibold shadow-lg"
         style="background:${palette.bg};color:${palette.col};max-width:90vw">
      ${eh(t.msg)}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────
// Re-render + handlers
// ─────────────────────────────────────────────────────────────────

function rerender(container: HTMLElement, state: AccState) {
  const body = container.querySelector<HTMLElement>('#acc-body');
  if (body) body.innerHTML = renderBody(state);
  else container.innerHTML = renderShell(renderBody(state));
  attachHandlers(container, state);
}

function attachHandlers(container: HTMLElement, state: AccState) {
  const invSel = container.querySelector<HTMLSelectElement>('#acc-invoice-sel');
  invSel?.addEventListener('change', async () => {
    state.selectedInvoiceId = invSel.value;
    state.loadedCalc = null;
    state.loadedFromCache = false;
    state.emailResult = null;
    // Próbáljuk betölteni a mentett elszámolást
    const inv = state.invoices.find((i) => i.id === state.selectedInvoiceId);
    if (inv) {
      const existing = await getSettlement(inv.target_year, inv.target_month);
      if (existing) {
        state.loadedCalc = existing;
        state.loadedFromCache = true;
      }
    }
    recomputeEmailRecipients(state);
    rerender(container, state);
  });

  const calcBtn = container.querySelector<HTMLButtonElement>('#acc-calc-btn');
  calcBtn?.addEventListener('click', async () => {
    const inv = state.invoices.find((i) => i.id === state.selectedInvoiceId);
    if (!inv) return;
    state.calculating = true;
    rerender(container, state);
    try {
      const [attendance, cancelled] = await Promise.all([
        getAllAttendanceRecords(),
        getCancelledSessions(),
      ]);
      const result = calculateMonthlyAccounting(inv, attendance, cancelled, MONTHS_HU);
      await saveSettlement({
        year: result.year,
        month: inv.target_month,
        monthName: result.monthName,
        breakdown: result.breakdown,
        perPerson: result.perPerson,
      });
      state.loadedCalc = result;
      state.loadedFromCache = false;
      // settlements lista frissítése
      state.settlements = await getAllSettlements();
      recomputeEmailRecipients(state);
      state.emailResult = null;
      showToast(state, 'success', `✅ Kalkuláció kész: ${result.year}. ${result.monthName}`);
      void logEvent('info', 'Accounting calculated', { year: result.year, month: inv.target_month, monthName: result.monthName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(state, 'error', `❌ ${msg}`);
    } finally {
      state.calculating = false;
      rerender(container, state);
    }
  });

  // PDF letöltés — lazy import (jsPDF nagy, csak akkor töltsük be ha kell)
  const pdfBtn = container.querySelector<HTMLButtonElement>('#acc-download-pdf');
  pdfBtn?.addEventListener('click', async () => {
    const c = state.loadedCalc;
    if (!c || c.perPerson.length === 0) {
      showToast(state, 'error', 'Nincs adat a PDF generáláshoz.');
      rerender(container, state);
      return;
    }
    try {
      const monthName = 'monthName' in c ? c.monthName : '';
      const { generateSettlementPdf, downloadPdf } = await import('../lib/pdf');
      const blob = generateSettlementPdf({
        year: c.year,
        monthName,
        perPerson: c.perPerson,
      });
      const filename = `Havi_Elszamolas_${c.year}_${monthName.replace(/\s+/g, '_')}.pdf`;
      downloadPdf(blob, filename);
      showToast(state, 'success', '📥 PDF letöltve');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(state, 'error', `❌ PDF hiba: ${msg}`);
    }
    rerender(container, state);
  });

  // ─── Email checkboxok ───
  container.querySelectorAll<HTMLInputElement>('.acc-email-cb').forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.dataset.idx);
      const r = state.emailRecipients[idx];
      if (r) {
        r.selected = cb.checked;
        rerender(container, state);
      }
    });
  });
  container.querySelector<HTMLButtonElement>('#acc-email-all')?.addEventListener('click', () => {
    state.emailRecipients.forEach((r) => { r.selected = true; });
    rerender(container, state);
  });
  container.querySelector<HTMLButtonElement>('#acc-email-none')?.addEventListener('click', () => {
    state.emailRecipients.forEach((r) => { r.selected = false; });
    rerender(container, state);
  });
  container.querySelector<HTMLInputElement>('#acc-email-admin')?.addEventListener('change', (e) => {
    state.emailAdminToggle = (e.target as HTMLInputElement).checked;
    rerender(container, state);
  });

  // ─── Email küldés ───
  const sendBtn = container.querySelector<HTMLButtonElement>('#acc-email-send');
  sendBtn?.addEventListener('click', async () => {
    const c = state.loadedCalc;
    if (!c) return;
    const monthName = 'monthName' in c ? c.monthName : '';
    const selected = state.emailRecipients.filter((r) => r.selected);
    if (selected.length === 0 && !state.emailAdminToggle) {
      showToast(state, 'error', 'Nincs kit küldeni.');
      rerender(container, state);
      return;
    }

    state.emailSending = true;
    state.emailResult = null;
    rerender(container, state);

    try {
      // PDF generálás csak akkor, ha admin email is megy
      let pdfBase64: string | undefined;
      if (state.emailAdminToggle) {
        const { generateSettlementPdf } = await import('../lib/pdf');
        const { blobToBase64 } = await import('../lib/email');
        const blob = generateSettlementPdf({
          year: c.year,
          monthName,
          perPerson: c.perPerson,
        });
        pdfBase64 = await blobToBase64(blob);
      }

      const { sendBillingEmails } = await import('../lib/email');
      const auth = getAuthState();
      const adminEmail = state.emailAdminToggle ? (auth.user?.email ?? '') : undefined;

      const result = await sendBillingEmails({
        year: c.year,
        monthName,
        personal: selected.map((r) => ({
          to: r.email,
          name: r.systemName,
          count: r.count,
          amount: r.amount,
          guestDetails: r.guests.length > 0 ? {
            ownCount: r.ownCount,
            ownCost: r.ownAmount,
            guests: r.guests.map((g) => ({ name: g.name, count: g.count, cost: g.amount })),
          } : undefined,
        })),
        adminEmail,
        adminSummaryRows: state.emailAdminToggle
          ? c.perPerson.map((p) => ({ name: p.name, count: p.count, amount: p.amount }))
          : undefined,
        pdfBase64,
      });

      state.emailResult = {
        sent: result.personalSent,
        failed: result.personalFailed,
        adminSent: result.adminSent,
      };
      const errPart = result.adminError ? ` (admin: ${result.adminError})` : '';
      showToast(state, result.personalFailed.length === 0 ? 'success' : 'info',
        `📧 ${result.personalSent}/${result.totalRequested} kiküldve${errPart}`);
      void logEvent('info', 'Billing emails sent', { sent: result.personalSent, failed: result.personalFailed.length, year: c.year, monthName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(state, 'error', `❌ Email küldési hiba: ${msg}`);
    } finally {
      state.emailSending = false;
      rerender(container, state);
    }
  });

  const bulkForce = container.querySelector<HTMLInputElement>('#acc-bulk-force');
  bulkForce?.addEventListener('change', () => {
    state.bulkForce = bulkForce.checked;
  });

  const bulkBtn = container.querySelector<HTMLButtonElement>('#acc-bulk-btn');
  bulkBtn?.addEventListener('click', async () => {
    state.bulkRunning = true;
    state.bulkResult = null;
    rerender(container, state);
    void logEvent('info', 'Bulk accounting started', { invoiceCount: state.invoices.length });
    try {
      // Egyszer letöltjük az attendance + cancelled adatokat, és minden invoice-ra használjuk
      const [attendance, cancelled] = await Promise.all([
        getAllAttendanceRecords(),
        getCancelledSessions(),
      ]);
      const result: BulkResult = { ok: [], skipped: [], failed: [], total: state.invoices.length };
      for (const inv of state.invoices) {
        const monthName = MONTHS_HU[inv.target_month - 1] ?? `${inv.target_month}. hó`;
        const label = `${inv.target_year}. ${monthName}`;
        try {
          if (!state.bulkForce) {
            const existing = await getSettlement(inv.target_year, inv.target_month);
            if (existing) {
              result.skipped.push({ label });
              continue;
            }
          }
          const calc = calculateMonthlyAccounting(inv, attendance, cancelled, MONTHS_HU);
          await saveSettlement({
            year: calc.year,
            month: inv.target_month,
            monthName: calc.monthName,
            breakdown: calc.breakdown,
            perPerson: calc.perPerson,
          });
          const total = calc.perPerson.reduce((s, p) => s + p.amount, 0);
          result.ok.push({ label, year: calc.year, month: inv.target_month, people: calc.perPerson.length, total });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.failed.push({ label, reason: msg });
        }
      }
      state.bulkResult = result;
      state.settlements = await getAllSettlements();
      showToast(state, 'success', `🎉 Tömeges feldolgozás kész (${result.ok.length}/${result.total})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(state, 'error', `❌ ${msg}`);
    } finally {
      state.bulkRunning = false;
      rerender(container, state);
    }
  });
}

function showToast(state: AccState, kind: 'success' | 'error' | 'info', msg: string) {
  state.toast = { kind, msg };
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    // Csak ha a toast még a state-ben van, frissítjük az UI-t
    const toastEl = document.querySelector('.fixed.bottom-6');
    if (toastEl) toastEl.remove();
  }, 3500);
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function eh(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
