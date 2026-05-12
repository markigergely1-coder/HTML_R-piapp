/**
 * 💰 Havi Elszámolás — admin-only.
 *
 * MVP scope:
 *   - Megjeleníti az elmentett settlements + invoices összesítését
 *   - Havonkénti bontás (év szerint csoportosítva)
 *   - "Új elszámolás generálása" még coming soon — komplex számítás (Python verziót portolni kell)
 */

import { renderHeader } from '../components/header';
import { getAuthState, onAuthChange, signIn } from '../lib/auth';
import { getAllSettlements, getAllInvoices, type Settlement, type Invoice } from '../lib/firestore';
import { formatHuf } from '../lib/cost';
import { MONTHS_HU } from '../lib/config';

interface AccState {
  settlements: Settlement[];
  invoices: Invoice[];
  yearFilter: number | 'all';
}

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderAccountingPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const auth = getAuthState();
  if (auth.loading) return;
  if (!auth.user)        return showSignInGate(container);
  if (!auth.isAdmin)     return showNoPermissionGate(container, auth.user.email ?? '');

  const [settlements, invoices] = await Promise.all([getAllSettlements(), getAllInvoices()]);

  const state: AccState = {
    settlements,
    invoices,
    yearFilter: 'all',
  };

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
  const yearsFromInvoices = [...new Set(state.invoices.map((i) => i.target_year).filter(Boolean))].sort((a, b) => b - a);
  const yearsFromSettlements = [...new Set(state.settlements.map((s) => s.year).filter(Boolean))].sort((a, b) => b - a);
  const allYears = [...new Set([...yearsFromInvoices, ...yearsFromSettlements])].sort((a, b) => b - a);

  // Csoportosítás év → hónap → {invoice?, settlement?}
  const groups = new Map<number, Map<number, { invoice?: Invoice; settlement?: Settlement }>>();
  for (const inv of state.invoices) {
    if (state.yearFilter !== 'all' && inv.target_year !== state.yearFilter) continue;
    if (!groups.has(inv.target_year)) groups.set(inv.target_year, new Map());
    const yearMap = groups.get(inv.target_year)!;
    if (!yearMap.has(inv.target_month)) yearMap.set(inv.target_month, {});
    yearMap.get(inv.target_month)!.invoice = inv;
  }
  for (const s of state.settlements) {
    if (state.yearFilter !== 'all' && s.year !== state.yearFilter) continue;
    if (!groups.has(s.year)) groups.set(s.year, new Map());
    const yearMap = groups.get(s.year)!;
    if (!yearMap.has(s.month)) yearMap.set(s.month, {});
    yearMap.get(s.month)!.settlement = s;
  }

  const sortedYears = [...groups.keys()].sort((a, b) => b - a);

  const yearOptions = [
    `<option value="all" ${state.yearFilter === 'all' ? 'selected' : ''}>Mind</option>`,
    ...allYears.map((y) => `<option value="${y}" ${state.yearFilter === y ? 'selected' : ''}>${y}</option>`),
  ].join('');

  return `
    <div class="px-5 pt-5 pb-12 lg:px-6 lg:pt-5 space-y-4">
      <!-- Stat sáv -->
      <div class="grid grid-cols-3 gap-2 fade-up">
        ${statCard('Számlák',    state.invoices.length,    'red')}
        ${statCard('Elszámolás', state.settlements.length, 'sky')}
        ${statCard('Össz.',      totalAmount,              'emerald', true)}
      </div>

      <!-- Coming soon banner -->
      <div class="card-soft p-3.5 flex items-center gap-3 fade-up" style="border-radius:16px">
        <span class="text-xl">🚧</span>
        <div class="flex-1 min-w-0">
          <p class="text-[12.5px] font-semibold text-fg-1">Új elszámolás generálása — hamarosan</p>
          <p class="text-[11px] text-fg-3">A számítási logika portolása folyamatban (Python → TypeScript).</p>
        </div>
      </div>

      <!-- Év szűrő -->
      <div class="card flex items-center gap-2 p-3 fade-up" style="border-radius:16px">
        <span class="eyebrow text-[10px]">Év:</span>
        <select id="acc-year-filter"
          class="select-native rounded-[10px] border px-2.5 py-1.5 text-[12px] font-medium text-fg-1 focus:outline-none"
          style="border-color:var(--line-strong); background:var(--bg-card)">
          ${yearOptions}
        </select>
      </div>

      <!-- Csoportok év szerint -->
      ${sortedYears.length === 0
        ? `<div class="card-soft p-8 text-center fade-up" style="border-radius:22px">
            <div class="text-3xl mb-2">📭</div>
            <p class="text-[14px] font-semibold text-fg-1">Nincs adat</p>
            <p class="text-[12px] text-fg-3 mt-1">Még nincsenek mentett elszámolások vagy számlák.</p>
          </div>`
        : sortedYears.map((y) => renderYearGroup(y, groups.get(y)!)).join('')}
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

function renderYearGroup(year: number, months: Map<number, { invoice?: Invoice; settlement?: Settlement }>): string {
  const sortedMonths = [...months.keys()].sort((a, b) => b - a);

  const totalYear = sortedMonths.reduce((s, m) => s + (months.get(m)!.invoice?.amount ?? 0), 0);

  const rows = sortedMonths.map((m) => {
    const { invoice, settlement } = months.get(m)!;
    const monthName = MONTHS_HU[m - 1] ?? `${m}. hó`;
    return `
      <li class="px-4 py-3 flex items-center gap-3" style="border-top:1px solid var(--line)">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
             style="background:color-mix(in oklab,var(--accent) 10%,transparent);color:var(--accent-ink)">
          <span class="text-[11px] font-bold">${m.toString().padStart(2, '0')}</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[13px] font-semibold text-fg-1 truncate">${eh(monthName)}</p>
          <div class="flex items-center gap-2 mt-0.5">
            ${invoice
              ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded" style="background:color-mix(in oklab,var(--accent) 12%,transparent);color:var(--accent-ink)">Számla</span>`
              : ''}
            ${settlement
              ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded" style="background:rgba(16,185,129,0.14);color:#047857">Elszámolt</span>`
              : ''}
            ${!invoice && !settlement ? '<span class="text-[10.5px] text-fg-3">Nincs adat</span>' : ''}
          </div>
        </div>
        ${invoice ? `<span class="font-mono-tnum font-semibold text-[13px] text-fg-1">${eh(formatHuf(invoice.amount))}</span>` : ''}
      </li>`;
  }).join('');

  return `
    <div class="card overflow-hidden fade-up" style="border-radius:22px">
      <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
        <div>
          <p class="eyebrow text-[10px] mb-0.5">Év</p>
          <p class="text-[16px] font-bold text-fg-1">${year}</p>
        </div>
        <div class="text-right">
          <p class="eyebrow text-[10px] mb-0.5">Összesen</p>
          <p class="font-mono-tnum font-semibold text-[14px] text-fg-1">${eh(formatHuf(totalYear))}</p>
        </div>
      </div>
      <ul>${rows}</ul>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────

function rerender(container: HTMLElement, state: AccState) {
  const body = container.querySelector<HTMLElement>('#acc-body')!;
  body.innerHTML = renderBody(state);
  attachHandlers(container, state);
}

function attachHandlers(container: HTMLElement, state: AccState) {
  const yearSel = container.querySelector<HTMLSelectElement>('#acc-year-filter');
  yearSel?.addEventListener('change', () => {
    state.yearFilter = yearSel.value === 'all' ? 'all' : Number(yearSel.value);
    rerender(container, state);
  });
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function eh(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
