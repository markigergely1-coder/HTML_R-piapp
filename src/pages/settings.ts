/**
 * ⚙️ Beállítások (Kivételek) — admin-only.
 * Lemondott edzések kezelése: dátum + opcionális indok.
 * Egyszerű CRUD a `cancelled_sessions` kollekción.
 */

import { renderHeader } from '../components/header';
import { getAuthState, onAuthChange, signIn } from '../lib/auth';
import { logEvent } from '../lib/logger';
import { formatDateHuLong, todayInHungary } from '../lib/dates';
import {
  getCancelledSessionsWithIds,
  addCancelledSession,
  deleteCancelledSession,
  getAppConfig,
  saveAppConfig,
  type CancelledSessionWithId,
  type AppConfig,
} from '../lib/firestore';

interface SettingsState {
  cancelled: CancelledSessionWithId[];
  newDate: string;
  newReason: string;
  toast: { kind: 'success' | 'error'; msg: string } | null;
  appConfig: AppConfig;
  configSaving: boolean;
}

let toastTimer: number | null = null;

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderSettingsPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const auth = getAuthState();
  if (auth.loading) return;
  if (!auth.user)        return showSignInGate(container);
  if (!auth.isAdmin)     return showNoPermissionGate(container, auth.user.email ?? '');

  const [cancelled, appConfig] = await Promise.all([
    getCancelledSessionsWithIds(),
    getAppConfig(),
  ]);
  const state: SettingsState = {
    cancelled,
    newDate: todayInHungary(),
    newReason: '',
    toast: null,
    appConfig,
    configSaving: false,
  };

  rerender(container, state);

  const unsub = onAuthChange((s) => {
    if (!s.user || !s.isAdmin) { unsub(); renderSettingsPage(container); }
  });
}

// ─────────────────────────────────────────────────────────────────
// Shell + gate-ek
// ─────────────────────────────────────────────────────────────────

function renderShell(body: string): string {
  return `
    <div class="device">
      ${renderHeader('settings')}
      <main id="settings-body">${body}</main>
    </div>`;
}

function renderLoadingBody(): string {
  return `
    <div class="px-5 pt-5 space-y-3">
      <div class="h-32 rounded-2xl animate-pulse" style="background:var(--line)"></div>
      ${Array(3).fill(0).map(() => `<div class="h-14 rounded-2xl animate-pulse" style="background:var(--line)"></div>`).join('')}
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

function renderBody(state: SettingsState): string {
  // weekday warning, ha nem kedd
  const isTuesday = isDateTuesday(state.newDate);

  return `
    <div class="lg:grid lg:grid-cols-[400px_1fr] lg:gap-6 lg:p-6 lg:pt-5 lg:items-start">
      <!-- Új kivétel form -->
      <aside class="lg:sticky lg:top-[110px] space-y-3 px-5 pt-5 lg:px-0 lg:pt-0">
        ${renderEmailSettingsCard(state)}
        <div class="card p-4 fade-up">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-xl">📅</span>
            <div>
              <p class="eyebrow text-[10px]">Új kivétel</p>
              <p class="text-[15px] font-semibold text-fg-1">Lemondott edzés</p>
            </div>
          </div>
          <div class="space-y-2.5">
            <label class="block">
              <span class="text-[10px] font-semibold text-fg-3 block mb-1">Dátum</span>
              <input id="new-cancel-date" type="date" value="${ea(state.newDate)}"
                class="w-full rounded-[12px] border px-3 py-2.5 text-[14px] text-fg-1 focus:outline-none"
                style="border-color:var(--line-strong); background:var(--bg-card)" />
              ${isTuesday ? '' : `<p class="text-[11px] mt-1" style="color:#d97706">⚠️ Ez nem keddi nap</p>`}
            </label>
            <label class="block">
              <span class="text-[10px] font-semibold text-fg-3 block mb-1">Indok (opcionális)</span>
              <input id="new-cancel-reason" type="text" value="${ea(state.newReason)}" placeholder="pl. Ünnepnap"
                class="w-full rounded-[12px] border px-3 py-2.5 text-[14px] text-fg-1 placeholder-fg-3 focus:outline-none"
                style="border-color:var(--line-strong); background:var(--bg-card)" />
            </label>
            <button id="new-cancel-save"
              class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-colors"
              style="background:var(--accent)">
              Hozzáadás
            </button>
          </div>
        </div>
      </aside>

      <!-- Lemondott edzések listája -->
      <section class="px-5 pt-3 pb-12 lg:px-0 lg:pt-0">
        ${renderCancelledList(state)}
      </section>
    </div>
    ${state.toast ? renderToast(state.toast) : ''}`;
}

function renderEmailSettingsCard(state: SettingsState): string {
  return `
    <div class="card p-4 fade-up">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xl">📧</span>
        <div>
          <p class="eyebrow text-[10px]">Email</p>
          <p class="text-[15px] font-semibold text-fg-1">Email beállítások</p>
        </div>
      </div>
      <div class="space-y-2.5">
        <label class="block">
          <span class="text-[10px] font-semibold text-fg-3 block mb-1">Feladó neve</span>
          <input id="cfg-sender-name" type="text" value="${ea(state.appConfig.senderName)}"
            placeholder="pl. Röpi Edzés"
            class="w-full rounded-[12px] border px-3 py-2.5 text-[14px] text-fg-1 placeholder-fg-3 focus:outline-none"
            style="border-color:var(--line-strong); background:var(--bg-card)" />
        </label>
        <label class="block">
          <span class="text-[10px] font-semibold text-fg-3 block mb-1">Email lábléc</span>
          <textarea id="cfg-email-footer" rows="3"
            placeholder="pl. Kérdés esetén írj vissza erre az emailre."
            class="w-full rounded-[12px] border px-3 py-2.5 text-[14px] text-fg-1 placeholder-fg-3 focus:outline-none resize-none"
            style="border-color:var(--line-strong); background:var(--bg-card)">${ea(state.appConfig.emailFooter)}</textarea>
        </label>
        <button id="cfg-save"
          class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-colors ${state.configSaving ? 'opacity-60 cursor-not-allowed' : ''}"
          style="background:var(--accent)"
          ${state.configSaving ? 'disabled' : ''}>
          ${state.configSaving ? 'Mentés…' : 'Mentés'}
        </button>
      </div>
    </div>`;
}

function renderCancelledList(state: SettingsState): string {
  if (state.cancelled.length === 0) {
    return `
      <div class="card-soft p-8 text-center fade-up" style="border-radius:22px">
        <div class="text-3xl mb-2">✅</div>
        <p class="text-[14px] font-semibold text-fg-1">Nincs lemondott edzés</p>
        <p class="text-[12px] text-fg-3 mt-1">Minden megtartott marad.</p>
      </div>`;
  }

  const items = state.cancelled.map((c, i) => `
    <li data-id="${ea(c.id)}" class="flex items-center gap-3 px-4 py-3" style="${i === 0 ? '' : 'border-top:1px solid var(--line);'}">
      <div class="rounded-full flex items-center justify-center flex-shrink-0"
           style="width:36px;height:36px;background:color-mix(in oklab,var(--accent) 14%,transparent)">
        <span class="text-[14px]">❌</span>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-[13.5px] font-semibold text-fg-1 truncate">${eh(formatDateHuLong(c.date))}</p>
        ${c.reason ? `<p class="text-[11.5px] text-fg-3 truncate">${eh(c.reason)}</p>` : ''}
      </div>
      <button class="row-delete p-2 rounded-lg transition-colors hover:bg-[color:var(--bg-elev)]"
        title="Törlés" style="color:var(--fg-3)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
      </button>
    </li>
  `).join('');

  return `
    <div class="card overflow-hidden fade-up" style="border-radius:22px">
      <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
        <span class="eyebrow">Lemondott edzések</span>
        <span class="text-[11px] font-mono-tnum text-fg-3">${state.cancelled.length}</span>
      </div>
      <ul>${items}</ul>
    </div>`;
}

function renderToast(toast: NonNullable<SettingsState['toast']>): string {
  const palette = toast.kind === 'success'
    ? 'background:color-mix(in oklab,#10b981 14%,var(--bg-card));border:1px solid color-mix(in oklab,#10b981 30%,var(--line));color:#047857'
    : 'background:color-mix(in oklab,var(--accent) 14%,var(--bg-card));border:1px solid color-mix(in oklab,var(--accent) 30%,var(--line));color:var(--accent-ink)';
  return `
    <div id="toast" class="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full shadow-lg text-[12.5px] font-semibold fade-up"
      style="bottom:24px;${palette}">${eh(toast.msg)}</div>`;
}

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────

function rerender(container: HTMLElement, state: SettingsState) {
  const body = container.querySelector<HTMLElement>('#settings-body')!;
  body.innerHTML = renderBody(state);
  attachHandlers(container, state);
  if (state.toast) {
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      state.toast = null;
      rerender(container, state);
    }, 2500);
  }
}

function attachHandlers(container: HTMLElement, state: SettingsState) {
  container.querySelector<HTMLInputElement>('#cfg-sender-name')?.addEventListener('input', (e) => {
    state.appConfig.senderName = (e.target as HTMLInputElement).value;
  });
  container.querySelector<HTMLTextAreaElement>('#cfg-email-footer')?.addEventListener('input', (e) => {
    state.appConfig.emailFooter = (e.target as HTMLTextAreaElement).value;
  });
  container.querySelector<HTMLButtonElement>('#cfg-save')?.addEventListener('click', async () => {
    if (state.configSaving) return;
    state.configSaving = true;
    rerender(container, state);
    try {
      await saveAppConfig(state.appConfig);
      void logEvent('info', 'App config saved', { senderName: state.appConfig.senderName });
      state.toast = { kind: 'success', msg: '✓ Email beállítások mentve' };
    } catch (e) {
      state.toast = { kind: 'error', msg: `Hiba: ${String(e)}` };
    } finally {
      state.configSaving = false;
      rerender(container, state);
    }
  });

  const dateInput = container.querySelector<HTMLInputElement>('#new-cancel-date');
  const reasonInput = container.querySelector<HTMLInputElement>('#new-cancel-reason');
  dateInput?.addEventListener('input', () => {
    state.newDate = dateInput.value;
    // Csak a "nem-kedd" warning kell legyen az érzékeny — teljes re-render
    rerender(container, state);
    // Fókusz vissza
    const inp = container.querySelector<HTMLInputElement>('#new-cancel-date');
    inp?.focus();
  });
  reasonInput?.addEventListener('input', () => {
    state.newReason = reasonInput.value;
  });

  container.querySelector<HTMLButtonElement>('#new-cancel-save')?.addEventListener('click', async () => {
    const date = state.newDate.trim();
    if (!date) {
      state.toast = { kind: 'error', msg: 'Adj meg dátumot.' };
      return rerender(container, state);
    }
    if (state.cancelled.some((c) => c.date === date)) {
      state.toast = { kind: 'error', msg: 'Ez a dátum már szerepel.' };
      return rerender(container, state);
    }
    try {
      await addCancelledSession(date, state.newReason);
      void logEvent('info', 'Cancelled session added', { date, reason: state.newReason });
      state.cancelled = await getCancelledSessionsWithIds();
      state.newReason = '';
      state.toast = { kind: 'success', msg: '✓ Hozzáadva' };
      rerender(container, state);
    } catch (e) {
      state.toast = { kind: 'error', msg: `Hiba: ${String(e)}` };
      rerender(container, state);
    }
  });

  // Törlés
  container.querySelectorAll<HTMLLIElement>('[data-id]').forEach((li) => {
    const id = li.dataset.id!;
    li.querySelector<HTMLButtonElement>('.row-delete')?.addEventListener('click', async () => {
      const item = state.cancelled.find((x) => x.id === id);
      if (!item) return;
      if (!confirm(`Biztosan törlöd?\n\n${formatDateHuLong(item.date)}`)) return;
      try {
        await deleteCancelledSession(id);
        void logEvent('warn', 'Cancelled session deleted', { date: item.date });
        state.cancelled = state.cancelled.filter((x) => x.id !== id);
        state.toast = { kind: 'success', msg: '🗑️ Törölve' };
        rerender(container, state);
      } catch (e) {
        state.toast = { kind: 'error', msg: `Hiba: ${String(e)}` };
        rerender(container, state);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function isDateTuesday(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.getUTCDay() === 2; // 0=vas, 2=kedd
}

function eh(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function ea(s: string): string { return eh(s); }
