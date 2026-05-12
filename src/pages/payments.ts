/**
 * 💳 Befizetések Ellenőrzése — admin-only.
 *
 * MVP scope:
 *   - Megjeleníti a meglévő számlákat (invoices)
 *   - "Új befizetések feldolgozása" — Revolut CSV import — még coming soon
 *     (PDF generálás + name mapping + befizetés-egyezés komplex, külön fázisban)
 */

import { renderHeader } from '../components/header';
import { getAuthState, onAuthChange, signIn } from '../lib/auth';
import { getAllInvoices, type Invoice } from '../lib/firestore';
import { formatHuf } from '../lib/cost';
import { MONTHS_HU } from '../lib/config';

interface PayState {
  invoices: Invoice[];
  filter: string;
}

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderPaymentsPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const auth = getAuthState();
  if (auth.loading) return;
  if (!auth.user)        return showSignInGate(container);
  if (!auth.isAdmin)     return showNoPermissionGate(container, auth.user.email ?? '');

  const invoices = await getAllInvoices();
  const state: PayState = { invoices, filter: '' };
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
  const total = state.invoices.length;
  const totalAmount = state.invoices.reduce((s, i) => s + i.amount, 0);

  return `
    <div class="px-5 pt-5 pb-12 lg:px-6 lg:pt-5 space-y-4">
      <!-- Hero stat -->
      <div class="grid grid-cols-2 gap-2 fade-up">
        <div class="card relative p-4 overflow-hidden lift">
          <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:color-mix(in oklab,var(--accent) 10%,transparent);filter:blur(8px)"></div>
          <p class="eyebrow text-[10px] mb-1">Számlák</p>
          <p class="relative font-mono-tnum font-semibold text-[24px] leading-none num-display text-fg-1">${total}</p>
        </div>
        <div class="card relative p-4 overflow-hidden lift">
          <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:rgba(16,185,129,0.10);filter:blur(8px)"></div>
          <p class="eyebrow text-[10px] mb-1">Összesen</p>
          <p class="relative font-mono-tnum font-semibold text-[18px] leading-none num-display text-fg-1">${eh(formatHuf(totalAmount))}</p>
        </div>
      </div>

      <!-- Coming soon banner -->
      <div class="card-soft p-4 flex items-start gap-3 fade-up" style="border-radius:18px">
        <span class="text-2xl mt-0.5">🚧</span>
        <div class="flex-1 min-w-0">
          <p class="text-[14px] font-semibold text-fg-1 mb-1">Revolut import — hamarosan</p>
          <p class="text-[12px] text-fg-3">
            A Revolut CSV/PDF feldolgozása + befizetés-egyeztetés a Streamlit verzióban már működik;
            a webes verzióba portolás folyamatban (egyezés-toleranciával, név-mapping-gel).
          </p>
        </div>
      </div>

      <!-- Kereső -->
      <div class="card flex items-center gap-2.5 px-3.5 py-2 fade-up" style="border-radius:16px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--fg-3);flex:none">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <input id="pay-filter" type="search" placeholder="Keresés év, hónap vagy fájlnév alapján…"
          value="${ea(state.filter)}"
          class="flex-1 bg-transparent text-[13.5px] text-fg-1 placeholder-fg-3 focus:outline-none py-1.5" />
      </div>

      ${renderInvoiceList(state)}
    </div>`;
}

function renderInvoiceList(state: PayState): string {
  let invoices = state.invoices.slice();
  const f = state.filter.trim().toLowerCase();
  if (f) {
    invoices = invoices.filter((i) =>
      String(i.target_year).includes(f) ||
      String(i.target_month).includes(f) ||
      (i.filename ?? '').toLowerCase().includes(f) ||
      (MONTHS_HU[i.target_month - 1] ?? '').toLowerCase().includes(f),
    );
  }

  if (invoices.length === 0) {
    return `
      <div class="card-soft p-8 text-center fade-up" style="border-radius:22px">
        <div class="text-3xl mb-2">${f ? '🔍' : '🧾'}</div>
        <p class="text-[14px] font-semibold text-fg-1">${f ? 'Nincs találat' : 'Nincs számla'}</p>
      </div>`;
  }

  const items = invoices.map((inv, idx) => {
    const monthName = MONTHS_HU[inv.target_month - 1] ?? `${inv.target_month}. hó`;
    return `
      <li class="px-4 py-3 flex items-center gap-3" style="${idx === 0 ? '' : 'border-top:1px solid var(--line);'}">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
             style="background:color-mix(in oklab,var(--accent) 12%,transparent);color:var(--accent-ink)">
          <span class="text-[10px] font-bold">${inv.target_year}</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[13px] font-semibold text-fg-1">${eh(monthName)} <span class="font-normal text-fg-3">${inv.target_year}</span></p>
          <p class="text-[11px] font-mono-tnum text-fg-3 truncate">${eh(inv.inv_date)}${inv.filename ? ` · ${eh(inv.filename)}` : ''}</p>
        </div>
        <span class="font-mono-tnum font-semibold text-[14px] text-fg-1 flex-shrink-0">${eh(formatHuf(inv.amount))}</span>
      </li>`;
  }).join('');

  return `
    <div class="card overflow-hidden fade-up" style="border-radius:22px">
      <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
        <span class="eyebrow">Számlák</span>
        <span class="text-[11px] font-mono-tnum text-fg-3">${invoices.length}</span>
      </div>
      <ul>${items}</ul>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────

function rerender(container: HTMLElement, state: PayState) {
  const body = container.querySelector<HTMLElement>('#pay-body')!;
  body.innerHTML = renderBody(state);
  attachHandlers(container, state);
}

function attachHandlers(container: HTMLElement, state: PayState) {
  const inp = container.querySelector<HTMLInputElement>('#pay-filter');
  inp?.addEventListener('input', () => {
    state.filter = inp.value;
    rerender(container, state);
    const after = container.querySelector<HTMLInputElement>('#pay-filter');
    after?.focus();
    if (after) after.setSelectionRange(after.value.length, after.value.length);
  });
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function eh(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function ea(s: string): string { return eh(s); }
