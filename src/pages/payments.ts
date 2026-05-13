/**
 * 💳 Befizetések Ellenőrzése — admin-only.
 *
 * Funkcionalitás (Python `payments.py` port):
 *   - Hónap (mentett elszámolás) kiválasztása
 *   - Tab "Kivonat": Revolut CSV feltöltés → automatikus egyeztetés → riport tábla
 *     + emlékeztető üzenet generálása nem fizetőknek
 *   - Tab "Név párosítások": Revolut név ↔ rendszer név mapping CRUD
 */

import { renderHeader } from '../components/header';
import { getAuthState, onAuthChange, signIn } from '../lib/auth';
import {
  getAllSettlements,
  getAllInvoices,
  getAllNameMappings,
  addNameMapping,
  deleteNameMapping,
  getSettlement,
  type Settlement,
  type Invoice,
  type NameMapping,
  type FullSettlement,
} from '../lib/firestore';
import {
  parseRevolutCsv,
  matchPayments,
  type RevolutTransaction,
  type PaymentMatchResult,
} from '../lib/revolut';
import { formatHuf } from '../lib/cost';
import { MONTHS_HU, TOLERANCE } from '../lib/config';

interface PayState {
  // Adatok
  invoices: Invoice[];
  settlements: Settlement[];
  mappings: NameMapping[];
  // Kiválasztott hónap
  selectedKey: string | null;     // "YYYY-MM"
  loadedSettlement: FullSettlement | null;
  // CSV feldolgozás
  csvName: string | null;
  csvTransactions: RevolutTransaction[];
  csvParseError: string | null;
  // Egyeztetés
  matchResults: PaymentMatchResult[];
  unmatchedTransactions: RevolutTransaction[];
  // UI állapot
  activeTab: 'check' | 'mappings';
  // Mapping form
  newRevName: string;
  newSysName: string;
  // Toast
  toast: { kind: 'success' | 'error' | 'info'; msg: string } | null;
}

let toastTimer: number | null = null;

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderPaymentsPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const auth = getAuthState();
  if (auth.loading) return;
  if (!auth.user)        return showSignInGate(container);
  if (!auth.isAdmin)     return showNoPermissionGate(container, auth.user.email ?? '');

  const [settlements, invoices, mappings] = await Promise.all([
    getAllSettlements(),
    getAllInvoices(),
    getAllNameMappings().catch(() => []),
  ]);

  // Alapból a legfrissebb elszámolt hónap
  const first = settlements[0];
  const selectedKey = first ? `${first.year}-${String(first.month).padStart(2, '0')}` : null;

  const state: PayState = {
    invoices,
    settlements,
    mappings,
    selectedKey,
    loadedSettlement: null,
    csvName: null,
    csvTransactions: [],
    csvParseError: null,
    matchResults: [],
    unmatchedTransactions: [],
    activeTab: 'check',
    newRevName: '',
    newSysName: '',
    toast: null,
  };

  if (first) {
    state.loadedSettlement = await getSettlement(first.year, first.month);
  }

  rerender(container, state);

  const unsub = onAuthChange((s) => {
    if (!s.user || !s.isAdmin) { unsub(); renderPaymentsPage(container); }
  });
}

// ─────────────────────────────────────────────────────────────────
// Shell + gate-ek
// ─────────────────────────────────────────────────────────────────

function renderShell(body: string): string {
  return `
    <div class="device">
      ${renderHeader('payments')}
      <main id="pay-body">${body}</main>
    </div>`;
}

function renderLoadingBody(): string {
  return `
    <div class="px-5 pt-5 space-y-3">
      <div class="h-24 rounded-2xl animate-pulse" style="background:var(--line)"></div>
      ${Array(5).fill(0).map(() => `<div class="h-14 rounded-2xl animate-pulse" style="background:var(--line)"></div>`).join('')}
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

function renderBody(state: PayState): string {
  if (state.settlements.length === 0) {
    return `
      <div class="px-5 pt-5 pb-12">
        <div class="card-soft p-8 text-center" style="border-radius:22px">
          <div class="text-3xl mb-2">📭</div>
          <p class="text-[14px] font-semibold text-fg-1">Nincs mentett elszámolás</p>
          <p class="text-[12px] text-fg-3 mt-1 max-w-[280px] mx-auto">
            Először futtasd le az elszámolást a <strong>Havi Elszámolás</strong> oldalon.
          </p>
        </div>
      </div>`;
  }

  const sortedSettlements = [...state.settlements].sort((a, b) => (b.year - a.year) || (b.month - a.month));
  const monthOptions = sortedSettlements.map((s) => {
    const key = `${s.year}-${String(s.month).padStart(2, '0')}`;
    const monthName = MONTHS_HU[s.month - 1] ?? `${s.month}. hó`;
    return `<option value="${key}" ${key === state.selectedKey ? 'selected' : ''}>${s.year}. ${eh(monthName)}</option>`;
  }).join('');

  return `
    <div class="px-5 pt-5 pb-12 lg:px-6 lg:pt-5 space-y-4">
      <!-- Hónap kiválasztó -->
      <div class="card p-4 fade-up" style="border-radius:18px">
        <p class="eyebrow text-[10px] mb-2">Elszámolási hónap</p>
        <select id="pay-month-sel"
          class="select-native w-full rounded-[10px] border px-3 py-2 text-[13px] font-medium text-fg-1 focus:outline-none"
          style="border-color:var(--line-strong); background:var(--bg-card)">
          ${monthOptions}
        </select>
        ${state.loadedSettlement
          ? `<p class="text-[11px] text-fg-3 mt-2">${state.loadedSettlement.perPerson.length} fő, összesen ${eh(formatHuf(state.loadedSettlement.perPerson.reduce((s, p) => s + p.amount, 0)))}</p>`
          : ''}
      </div>

      <!-- Tab navigáció -->
      <div class="flex gap-1 fade-up" style="border-bottom:1px solid var(--line)">
        ${tabButton('check', '📤 Kivonat & Ellenőrzés', state.activeTab)}
        ${tabButton('mappings', '🔗 Név párosítások', state.activeTab)}
      </div>

      <!-- Tab content -->
      ${state.activeTab === 'check' ? renderCheckTab(state) : renderMappingsTab(state)}

      ${state.toast ? renderToast(state.toast) : ''}
    </div>`;
}

function tabButton(tab: PayState['activeTab'], label: string, active: PayState['activeTab']): string {
  const isActive = tab === active;
  return `
    <button class="pay-tab-btn px-3.5 py-2.5 text-[13px] font-medium relative"
      data-tab="${tab}"
      style="color:${isActive ? 'var(--fg-1)' : 'var(--fg-3)'}">
      ${label}
      ${isActive ? `<span class="absolute left-3 right-3 bottom-0 h-[2px] rounded-full" style="background:var(--accent)"></span>` : ''}
    </button>`;
}

// ─── Tab 1: Kivonat & Ellenőrzés ─────────────────────────────────

function renderCheckTab(state: PayState): string {
  return `
    <div class="space-y-4 fade-up">
      <!-- File upload -->
      <div class="card p-4" style="border-radius:18px">
        <p class="eyebrow text-[10px] mb-3">Revolut CSV feltöltés</p>
        <label for="pay-csv-input" class="block w-full p-6 rounded-xl border-2 border-dashed cursor-pointer text-center hover:bg-[color:var(--bg-elev)] transition-colors"
          style="border-color:var(--line-strong)">
          ${state.csvName
            ? `<div>
                <p class="text-[14px] font-semibold text-fg-1 mb-1">✅ ${eh(state.csvName)}</p>
                <p class="text-[11.5px] text-fg-3">${state.csvTransactions.length} bejövő átutalás</p>
                <p class="text-[10px] text-fg-3 mt-2">Klikk másik fájl választásához</p>
              </div>`
            : `<div>
                <p class="text-2xl mb-1">📤</p>
                <p class="text-[13.5px] font-semibold text-fg-1">Húzd ide vagy klikkelj</p>
                <p class="text-[11px] text-fg-3 mt-1">Revolut CSV kivonat</p>
              </div>`}
        </label>
        <input id="pay-csv-input" type="file" accept=".csv,text/csv" class="hidden" />
        ${state.csvParseError
          ? `<div class="mt-3 p-2.5 rounded-lg" style="background:rgba(239,68,68,0.10);color:#b91c1c">
              <p class="text-[12px] font-semibold">❌ ${eh(state.csvParseError)}</p>
            </div>`
          : ''}
        ${!state.csvName && !state.csvParseError
          ? `<div class="mt-3 p-3 rounded-lg text-[11.5px] leading-relaxed" style="background:rgba(14,165,233,0.08);color:#075985">
              <p class="font-semibold mb-1">💡 Hogyan exportáld:</p>
              <ol class="list-decimal list-inside space-y-0.5">
                <li>Revolut app → fiókod → Kimutatások / Statements</li>
                <li>Válaszd ki a hónapot → Formátum: <strong>CSV</strong></li>
                <li>Töltsd fel itt</li>
              </ol>
            </div>`
          : ''}
      </div>

      ${state.csvName && state.matchResults.length > 0 ? renderMatchResults(state) : ''}
    </div>`;
}

function renderMatchResults(state: PayState): string {
  const r = state.matchResults;
  const paidCount = r.filter((m) => m.status === 'paid' || m.status === 'overpaid').length;
  const underCount = r.filter((m) => m.status === 'underpaid').length;
  const unpaidCount = r.filter((m) => m.status === 'unpaid').length;

  const rows = r.map((m) => {
    const statusBadge = renderStatusBadge(m.status);
    const diffStr = m.diff !== null
      ? `${m.diff >= 0 ? '+' : ''}${formatHuf(m.diff)}`
      : '—';
    const diffColor = m.diff === null
      ? 'var(--fg-3)'
      : Math.abs(m.diff) <= TOLERANCE
        ? 'var(--fg-2)'
        : m.diff > 0 ? '#047857' : '#b91c1c';

    return `
      <tr style="border-top:1px solid var(--line)">
        <td class="px-3 py-2 text-[12px] font-medium text-fg-1">${eh(m.systemName)}</td>
        <td class="px-3 py-2 text-[11.5px] text-fg-3 truncate" title="${ea(m.matchedRevolutName ?? '')}">${eh(m.matchedRevolutName ?? '— ismeretlen')}</td>
        <td class="px-3 py-2 text-[12px] text-fg-2 text-right font-mono-tnum">${eh(formatHuf(m.expected))}</td>
        <td class="px-3 py-2 text-[12px] text-fg-1 text-right font-mono-tnum">${m.paid !== null ? eh(formatHuf(m.paid)) : '—'}</td>
        <td class="px-3 py-2 text-[12px] text-right font-mono-tnum font-semibold" style="color:${diffColor}">${eh(diffStr)}</td>
        <td class="px-3 py-2 text-[12px]">${statusBadge}</td>
      </tr>`;
  }).join('');

  // Emlékeztető üzenet
  const unpaidNames = r.filter((m) => m.status === 'unpaid').map((m) => m.systemName);
  const underpaidNames = r.filter((m) => m.status === 'underpaid').map((m) => m.systemName);
  const settlement = state.loadedSettlement;
  let reminderText = '';
  if (settlement && (unpaidNames.length > 0 || underpaidNames.length > 0)) {
    const lines: string[] = [`Sziasztok! 🏐\n`, `A ${settlement.year}. ${settlement.monthName} havi röpi befizetéseket ellenőriztem.`];
    if (unpaidNames.length > 0) lines.push(`Nem fizetett: ${unpaidNames.join(', ')}`);
    if (underpaidNames.length > 0) lines.push(`Kevesebbet fizetett: ${underpaidNames.join(', ')}`);
    lines.push(`\nKérlek utaljátok mielőbb! 🙏`);
    reminderText = lines.join('\n');
  }

  // Párosítatlan Revolut tranzakciók
  const unmatchedRows = state.unmatchedTransactions.map((t) => `
    <li class="px-4 py-2.5 flex items-center justify-between" style="border-top:1px solid var(--line)">
      <span class="text-[12px] font-medium text-fg-1 truncate flex-1">${eh(t.name)}</span>
      <span class="font-mono-tnum text-[12px] text-fg-2 ml-3">${eh(formatHuf(t.amount))}</span>
    </li>
  `).join('');

  return `
    <!-- Stat metrics -->
    <div class="grid grid-cols-3 gap-2">
      ${metricCard('✅ Fizetett', paidCount, '#047857', 'rgba(16,185,129,0.12)')}
      ${metricCard('⚠️ Kevesebb', underCount, '#92400e', 'rgba(245,158,11,0.14)')}
      ${metricCard('❌ Nem fizetett', unpaidCount, '#b91c1c', 'rgba(239,68,68,0.12)')}
    </div>

    <!-- Riport tábla -->
    <div class="card overflow-hidden" style="border-radius:20px">
      <div class="px-4 py-3" style="border-bottom:1px solid var(--line)">
        <p class="eyebrow text-[10px]">Befizetések egyeztetése</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full" style="border-collapse:collapse;min-width:600px">
          <thead style="background:var(--bg-elev)">
            <tr>
              <th class="px-3 py-2 text-[10.5px] text-left font-semibold text-fg-3 uppercase tracking-wider">Név</th>
              <th class="px-3 py-2 text-[10.5px] text-left font-semibold text-fg-3 uppercase tracking-wider">Revolut</th>
              <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Fizetendő</th>
              <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Befizetett</th>
              <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Diff</th>
              <th class="px-3 py-2 text-[10.5px] text-left font-semibold text-fg-3 uppercase tracking-wider">Státusz</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <!-- Emlékeztető szöveg -->
    ${reminderText
      ? `<div class="card p-4" style="border-radius:18px">
          <div class="flex items-center justify-between mb-2">
            <p class="eyebrow text-[10px]">💬 Emlékeztető üzenet</p>
            <button id="pay-copy-reminder"
              class="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
              style="background:color-mix(in oklab,var(--accent) 14%,transparent);color:var(--accent-ink)">
              Másolás
            </button>
          </div>
          <pre id="pay-reminder-text" class="text-[12px] text-fg-1 whitespace-pre-wrap font-mono-tnum p-3 rounded-lg" style="background:var(--bg-elev)">${eh(reminderText)}</pre>
        </div>`
      : ''}

    <!-- Párosítatlan Revolut -->
    ${state.unmatchedTransactions.length > 0
      ? `<div class="card overflow-hidden" style="border-radius:20px">
          <div class="px-4 py-3" style="border-bottom:1px solid var(--line)">
            <p class="eyebrow text-[10px] mb-0.5">🔍 Párosítatlan Revolut befizetők</p>
            <p class="text-[11px] text-fg-3">Ezek nem lettek senkihez rendelve. Párosítsd a "Név párosítások" tabon.</p>
          </div>
          <ul>${unmatchedRows}</ul>
        </div>`
      : ''}
  `;
}

function metricCard(label: string, value: number, color: string, bg: string): string {
  return `
    <div class="card relative p-3.5 overflow-hidden lift">
      <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:${bg};filter:blur(8px)"></div>
      <p class="relative eyebrow text-[10px] mb-1">${label}</p>
      <p class="relative font-mono-tnum font-semibold text-[22px] leading-none num-display" style="color:${color}">${value}</p>
    </div>`;
}

function renderStatusBadge(status: PaymentMatchResult['status']): string {
  const map: Record<PaymentMatchResult['status'], { text: string; bg: string; color: string }> = {
    paid:      { text: '✅ Fizetett',           bg: 'rgba(16,185,129,0.14)', color: '#047857' },
    overpaid:  { text: '✅ Többet fizetett',    bg: 'rgba(16,185,129,0.14)', color: '#047857' },
    underpaid: { text: '⚠️ Kevesebbet',         bg: 'rgba(245,158,11,0.14)', color: '#92400e' },
    unpaid:    { text: '❌ Nem fizetett',       bg: 'rgba(239,68,68,0.12)',  color: '#b91c1c' },
  };
  const s = map[status];
  return `<span class="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style="background:${s.bg};color:${s.color}">${s.text}</span>`;
}

// ─── Tab 2: Név párosítások ──────────────────────────────────────

function renderMappingsTab(state: PayState): string {
  const sysNames = (state.loadedSettlement?.perPerson ?? [])
    .filter((p) => !p.name.includes(' - '))
    .map((p) => p.name);

  const alreadyMapped = new Set(state.mappings.map((m) => m.revolutName.toUpperCase()));
  const unpairedRevolut = state.csvTransactions
    .map((t) => t.name)
    .filter((n) => !alreadyMapped.has(n.toUpperCase()))
    .sort();

  const sysOpts = sysNames.map((n) =>
    `<option value="${ea(n)}" ${n === state.newSysName ? 'selected' : ''}>${eh(n)}</option>`
  ).join('');

  const revOpts = unpairedRevolut.map((n) =>
    `<option value="${ea(n)}" ${n === state.newRevName ? 'selected' : ''}>${eh(n)}</option>`
  ).join('');

  const mappingRows = state.mappings.map((m) => `
    <li class="px-4 py-2.5 flex items-center gap-3" style="border-top:1px solid var(--line)">
      <div class="flex-1 min-w-0">
        <p class="text-[12px] font-semibold text-fg-1 truncate">${eh(m.revolutName)}</p>
        <p class="text-[10.5px] text-fg-3">→ ${eh(m.systemName)}</p>
      </div>
      <button class="pay-mapping-del text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
        data-id="${ea(m.id)}"
        style="background:rgba(239,68,68,0.10);color:#b91c1c">
        Törlés
      </button>
    </li>
  `).join('');

  return `
    <div class="space-y-4 fade-up">
      <!-- Új mapping form -->
      <div class="card p-4" style="border-radius:18px">
        <p class="eyebrow text-[10px] mb-3">Új párosítás hozzáadása</p>
        <div class="space-y-3">
          <label class="block">
            <span class="text-[11.5px] font-medium text-fg-2 mb-1 block">Revolut név</span>
            ${unpairedRevolut.length > 0
              ? `<select id="pay-new-rev-sel"
                  class="select-native w-full rounded-[10px] border px-3 py-2 text-[13px] font-medium text-fg-1 focus:outline-none"
                  style="border-color:var(--line-strong); background:var(--bg-card)">
                  <option value="">— Válassz vagy gépeld lentebb —</option>
                  ${revOpts}
                </select>`
              : '<p class="text-[11.5px] text-fg-3 mb-2">Nincs feltöltött CSV, vagy minden név párosítva van.</p>'}
            <input id="pay-new-rev-input" type="text" placeholder="Vagy gépeld be manuálisan…"
              value="${ea(state.newRevName)}"
              class="w-full mt-2 rounded-[10px] border px-3 py-2 text-[13px] text-fg-1 focus:outline-none"
              style="border-color:var(--line-strong); background:var(--bg-card)" />
          </label>
          <label class="block">
            <span class="text-[11.5px] font-medium text-fg-2 mb-1 block">Rendszer név</span>
            <select id="pay-new-sys-sel"
              class="select-native w-full rounded-[10px] border px-3 py-2 text-[13px] font-medium text-fg-1 focus:outline-none"
              style="border-color:var(--line-strong); background:var(--bg-card)">
              <option value="">— Válassz —</option>
              ${sysOpts}
            </select>
          </label>
          <button id="pay-add-mapping"
            class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors"
            style="background:var(--accent)">
            💾 Párosítás mentése
          </button>
        </div>
      </div>

      <!-- Mentett párosítások -->
      <div class="card overflow-hidden" style="border-radius:20px">
        <div class="px-4 py-3" style="border-bottom:1px solid var(--line)">
          <p class="eyebrow text-[10px]">Mentett párosítások</p>
        </div>
        ${state.mappings.length === 0
          ? '<div class="px-4 py-6 text-center text-[12px] text-fg-3">Még nincsenek mentett párosítások.</div>'
          : `<ul>${mappingRows}</ul>`}
      </div>
    </div>`;
}

function renderToast(t: NonNullable<PayState['toast']>): string {
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

function rerender(container: HTMLElement, state: PayState) {
  const body = container.querySelector<HTMLElement>('#pay-body');
  if (body) body.innerHTML = renderBody(state);
  else container.innerHTML = renderShell(renderBody(state));
  attachHandlers(container, state);
}

function attachHandlers(container: HTMLElement, state: PayState) {
  // Hónap kiválasztó
  const monthSel = container.querySelector<HTMLSelectElement>('#pay-month-sel');
  monthSel?.addEventListener('change', async () => {
    state.selectedKey = monthSel.value;
    const [y, m] = state.selectedKey.split('-').map(Number);
    state.loadedSettlement = await getSettlement(y, m);
    // Ha van CSV már feltöltve, újra egyeztetünk
    if (state.csvTransactions.length > 0 && state.loadedSettlement) {
      runMatching(state);
    } else {
      state.matchResults = [];
      state.unmatchedTransactions = [];
    }
    rerender(container, state);
  });

  // Tab váltás
  container.querySelectorAll<HTMLButtonElement>('.pay-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as PayState['activeTab'];
      if (tab && tab !== state.activeTab) {
        state.activeTab = tab;
        rerender(container, state);
      }
    });
  });

  // CSV upload
  const csvInput = container.querySelector<HTMLInputElement>('#pay-csv-input');
  csvInput?.addEventListener('change', async () => {
    const file = csvInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseRevolutCsv(text);
      state.csvName = file.name;
      if (result.error) {
        state.csvParseError = result.error;
        state.csvTransactions = [];
        state.matchResults = [];
        state.unmatchedTransactions = [];
      } else {
        state.csvParseError = null;
        state.csvTransactions = result.transactions;
        if (state.loadedSettlement) {
          runMatching(state);
        }
      }
    } catch (err) {
      state.csvParseError = err instanceof Error ? err.message : String(err);
    }
    rerender(container, state);
  });

  // Emlékeztető másolás
  const copyBtn = container.querySelector<HTMLButtonElement>('#pay-copy-reminder');
  copyBtn?.addEventListener('click', async () => {
    const pre = container.querySelector<HTMLElement>('#pay-reminder-text');
    const text = pre?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      showToast(state, 'success', 'Másolva a vágólapra');
    } catch {
      // Fallback: select + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(state, 'success', 'Másolva');
    }
    rerender(container, state);
  });

  // Mapping form: Revolut név dropdown
  const revSel = container.querySelector<HTMLSelectElement>('#pay-new-rev-sel');
  revSel?.addEventListener('change', () => {
    state.newRevName = revSel.value;
    const input = container.querySelector<HTMLInputElement>('#pay-new-rev-input');
    if (input) input.value = state.newRevName;
  });

  // Mapping form: Revolut név input (manual)
  const revInput = container.querySelector<HTMLInputElement>('#pay-new-rev-input');
  revInput?.addEventListener('input', () => {
    state.newRevName = revInput.value;
  });

  // Mapping form: System név
  const sysSel = container.querySelector<HTMLSelectElement>('#pay-new-sys-sel');
  sysSel?.addEventListener('change', () => {
    state.newSysName = sysSel.value;
  });

  // Mapping add
  const addBtn = container.querySelector<HTMLButtonElement>('#pay-add-mapping');
  addBtn?.addEventListener('click', async () => {
    const rev = state.newRevName.trim();
    const sys = state.newSysName.trim();
    if (!rev || !sys) {
      showToast(state, 'error', '⚠️ Mindkét nevet add meg!');
      rerender(container, state);
      return;
    }
    try {
      await addNameMapping(rev, sys);
      state.mappings = await getAllNameMappings();
      state.newRevName = '';
      state.newSysName = '';
      // Újra egyeztetés ha van CSV
      if (state.csvTransactions.length > 0 && state.loadedSettlement) {
        runMatching(state);
      }
      showToast(state, 'success', `✅ ${rev} → ${sys}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(state, 'error', `❌ ${msg}`);
    }
    rerender(container, state);
  });

  // Mapping törlés
  container.querySelectorAll<HTMLButtonElement>('.pay-mapping-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!id) return;
      try {
        await deleteNameMapping(id);
        state.mappings = await getAllNameMappings();
        if (state.csvTransactions.length > 0 && state.loadedSettlement) {
          runMatching(state);
        }
        showToast(state, 'success', '🗑️ Párosítás törölve');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(state, 'error', `❌ ${msg}`);
      }
      rerender(container, state);
    });
  });
}

function runMatching(state: PayState) {
  if (!state.loadedSettlement) return;
  const mapMap = new Map<string, string>();
  for (const m of state.mappings) {
    mapMap.set(m.revolutName.toUpperCase(), m.systemName);
  }
  const { results, matchedRevolutNames } = matchPayments(
    state.loadedSettlement.perPerson,
    state.csvTransactions,
    mapMap,
    TOLERANCE,
  );
  state.matchResults = results;
  state.unmatchedTransactions = state.csvTransactions.filter(
    (t) => !matchedRevolutNames.has(t.name) && !mapMap.has(t.name.toUpperCase()),
  );
}

function showToast(state: PayState, kind: 'success' | 'error' | 'info', msg: string) {
  state.toast = { kind, msg };
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    const el = document.querySelector('.fixed.bottom-6');
    if (el) el.remove();
  }, 3500);
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function eh(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function ea(s: string): string { return eh(s); }
