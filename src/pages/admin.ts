/**
 * 🛠️ Admin Regisztráció oldal — admin-only.
 * 3-lépéses wizard (a Python `admin.py` flow-ja):
 *   1) Dátum + jelenlét + vendég-darabszám
 *   2) Vendég nevek megadása
 *   3) Összesítés + mentés
 */

import { renderHeader } from '../components/header';
import { MAIN_NAME_LIST } from '../lib/config';

const MAX_GUESTS = 10;
import {
  generateTuesdayDates,
  upcomingTuesday,
  formatDateHuLong,
} from '../lib/dates';
import {
  addAttendanceBatch,
  getAllAttendanceRecords,
  type RawAttendance,
  type NewAttendanceRow,
} from '../lib/firestore';

interface AdminEntry {
  present: boolean;
  guestCount: number;
  guestNames: string[];   // hossza = guestCount
}

interface AdminState {
  step: 1 | 2 | 3;
  date: string;
  dates: string[];
  entries: Map<string, AdminEntry>;
  toast: { kind: 'success' | 'error'; msg: string } | null;
  saving: boolean;
  // gyors visszakeresés vendéglistához
  historicalAll: RawAttendance[];
}

let toastTimer: number | null = null;

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderAdminPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const dates = generateTuesdayDates(8, 2);
  const upcoming = upcomingTuesday(dates);
  const historicalAll = await getAllAttendanceRecords();

  const entries = new Map<string, AdminEntry>();
  for (const n of MAIN_NAME_LIST) {
    entries.set(n, { present: false, guestCount: 0, guestNames: [] });
  }

  const state: AdminState = {
    step: 1,
    date: upcoming,
    dates,
    entries,
    toast: null,
    saving: false,
    historicalAll,
  };

  rerender(container, state);
}

// ─────────────────────────────────────────────────────────────────
// Shell + loading + gate-ek (közös)
// ─────────────────────────────────────────────────────────────────

function renderShell(body: string): string {
  return `
    <div class="device">
      ${renderHeader('admin')}
      <main id="admin-body">${body}</main>
    </div>`;
}

function renderLoadingBody(): string {
  return `
    <div class="px-5 pt-5 space-y-3">
      <div class="h-12 rounded-2xl animate-pulse" style="background:var(--line)"></div>
      <div class="h-14 rounded-2xl animate-pulse" style="background:var(--line)"></div>
      ${Array(8).fill(0).map(() => `<div class="h-14 rounded-2xl animate-pulse" style="background:var(--line)"></div>`).join('')}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
// Body — step dispatcher
// ─────────────────────────────────────────────────────────────────

function renderBody(state: AdminState): string {
  return `
    <div class="px-5 pt-5 pb-12 lg:px-6 lg:pt-5 space-y-4">
      ${renderStepBar(state)}
      ${state.step === 1 ? renderStep1(state) : state.step === 2 ? renderStep2(state) : renderStep3(state)}
      ${state.toast ? renderToast(state.toast) : ''}
    </div>`;
}

function renderStepBar(state: AdminState): string {
  const steps = [
    { n: 1, label: 'Jelenlét' },
    { n: 2, label: 'Vendégek' },
    { n: 3, label: 'Mentés' },
  ];
  return `
    <div class="card flex items-center justify-between p-3 fade-up" style="border-radius:18px">
      ${steps.map((s, i) => `
        <div class="flex items-center flex-1 ${i < steps.length - 1 ? 'gap-2' : ''}">
          <div class="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0"
               style="background:${state.step >= s.n ? 'var(--accent)' : 'var(--bg-elev)'};color:${state.step >= s.n ? 'white' : 'var(--fg-3)'}">
            ${s.n}
          </div>
          <span class="text-[12px] font-medium" style="color:${state.step === s.n ? 'var(--fg-1)' : 'var(--fg-3)'}">${s.label}</span>
          ${i < steps.length - 1 ? `<div class="flex-1 h-[2px]" style="background:${state.step > s.n ? 'var(--accent)' : 'var(--line)'}"></div>` : ''}
        </div>
      `).join('')}
    </div>`;
}

// ─── Step 1: jelenlét + vendég-szám ───
function renderStep1(state: AdminState): string {
  const dateOptions = state.dates.slice().reverse().map((d) =>
    `<option value="${d}" ${d === state.date ? 'selected' : ''}>${eh(formatDateHuLong(d))}</option>`
  ).join('');

  const presentCount = [...state.entries.values()].filter((e) => e.present).length;
  const totalGuestCount = [...state.entries.values()].filter((e) => e.present).reduce((s, e) => s + e.guestCount, 0);

  const rows = MAIN_NAME_LIST.map((name) => {
    const entry = state.entries.get(name)!;
    const checked = entry.present;
    const initials = nameInitials(name);
    const hue = avatarHue(name);
    return `
      <li class="flex items-center gap-3 px-4 py-2.5" style="border-top:1px solid var(--line)" data-name="${ea(name)}">
        <label class="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
          <input type="checkbox" class="admin-present w-4 h-4 rounded flex-shrink-0" style="accent-color:var(--accent)" ${checked ? 'checked' : ''} />
          <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
               style="width:30px;height:30px;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
            ${eh(initials)}
          </div>
          <span class="text-[13px] font-medium text-fg-1 truncate">${eh(name)}</span>
        </label>
        ${renderGuestStepper(entry.guestCount, checked)}
      </li>`;
  }).join('');

  return `
    <!-- Dátum választó -->
    <div class="card p-4 fade-up">
      <label class="block">
        <span class="eyebrow mb-1.5 block">Dátum</span>
        <select id="admin-date-select" class="select-native w-full rounded-[12px] border px-3 py-2.5 text-[14px] font-medium text-fg-1 focus:outline-none"
          style="border-color:var(--line-strong);background:var(--bg-card)">
          ${dateOptions}
        </select>
      </label>
    </div>

    <!-- Statisztika sáv -->
    <div class="grid grid-cols-2 gap-2 fade-up">
      <div class="card p-3.5">
        <p class="eyebrow text-[10px] mb-1">Jelen</p>
        <p class="font-mono-tnum font-semibold text-[24px] leading-none text-fg-1 num-display">${presentCount}</p>
      </div>
      <div class="card p-3.5">
        <p class="eyebrow text-[10px] mb-1">Vendégek</p>
        <p class="font-mono-tnum font-semibold text-[24px] leading-none text-fg-1 num-display">${totalGuestCount}</p>
      </div>
    </div>

    <!-- Tagok listája -->
    <div class="card overflow-hidden fade-up" style="border-radius:22px">
      <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
        <span class="eyebrow">Tagok</span>
        <span class="eyebrow">Plusz ember</span>
      </div>
      <ul>${rows}</ul>
    </div>

    <!-- Navigáció -->
    <div class="flex justify-end gap-2 fade-up">
      <button id="admin-next-1"
        class="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-opacity ${presentCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}"
        style="background:var(--accent)"
        ${presentCount === 0 ? 'disabled' : ''}>
        Tovább →
      </button>
    </div>`;
}

// ─── Vendég stepper — elegáns iOS-style ───
function renderGuestStepper(count: number, enabled: boolean): string {
  const hasGuests = count > 0;
  const atMin = count <= 0;
  const atMax = count >= MAX_GUESTS;

  // Egész elem disabled (ha a tag nincs jelen)
  const enabledStyle = enabled ? '' : 'opacity:0.35;pointer-events:none;filter:saturate(0);';

  // Active variant: warm accent színek, soft glow ring
  // Idle variant: ultra-szubtilis, szinte láthatatlan
  const isActive = hasGuests;
  const stepperClass = isActive ? 'is-active' : '';

  return `
    <div class="admin-guest-stepper ${stepperClass} inline-flex items-center select-none"
      style="${enabledStyle}"
      data-count="${count}">
      <button type="button" class="admin-guest-dec stepper-btn ${atMin ? 'is-disabled' : ''}"
        aria-label="Vendég csökkentés" ${atMin ? 'disabled' : ''}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 8h8"/>
        </svg>
      </button>
      <div class="stepper-num font-mono-tnum num-display">${count}</div>
      <button type="button" class="admin-guest-inc stepper-btn ${atMax ? 'is-disabled' : ''}"
        aria-label="Vendég növelés" ${atMax ? 'disabled' : ''}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 8h8M8 4v8"/>
        </svg>
      </button>
    </div>`;
}

// ─── Step 2: vendég nevek ───
function renderStep2(state: AdminState): string {
  const pg = MAIN_NAME_LIST
    .filter((n) => {
      const e = state.entries.get(n)!;
      return e.present && e.guestCount > 0;
    });

  if (pg.length === 0) {
    return `
      <div class="card-soft p-6 text-center fade-up" style="border-radius:22px">
        <div class="text-3xl mb-2">✨</div>
        <p class="text-[14px] font-semibold text-fg-1">Nincsenek vendégek</p>
        <p class="text-[12px] text-fg-3 mt-1">Mehetünk tovább az összesítésre.</p>
      </div>
      <div class="flex justify-between gap-2">
        <button id="admin-back-2" class="px-5 py-2.5 rounded-full text-[13px] font-semibold transition-colors" style="background:var(--bg-elev);color:var(--fg-2)">
          ← Vissza
        </button>
        <button id="admin-next-2" class="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm" style="background:var(--accent)">
          Tovább →
        </button>
      </div>`;
  }

  const cards = pg.map((host) => {
    const entry = state.entries.get(host)!;
    const history = getHistoricalGuests(state.historicalAll, host);
    const slots = Array.from({ length: entry.guestCount }, (_, i) => i)
      .map((i) => {
        const current = entry.guestNames[i] ?? '';
        const inHistory = history.includes(current);
        const sel = inHistory ? current : current ? '__custom' : '';
        return `
          <div class="space-y-1.5" data-host="${ea(host)}" data-idx="${i}">
            <label class="block">
              <span class="text-[10px] font-semibold text-fg-3 uppercase tracking-wider">${i + 1}. vendég</span>
              <select class="admin-guest-sel select-native mt-1 w-full rounded-[10px] border px-2.5 py-2 text-[13px] focus:outline-none"
                style="border-color:var(--line-strong);background:var(--bg-card)">
                <option value="">— Új név írása —</option>
                ${history.map((h) => `<option value="${ea(h)}" ${sel === h ? 'selected' : ''}>${eh(h)}</option>`).join('')}
                <option value="__custom" ${sel === '__custom' ? 'selected' : ''}>— Egyéni név —</option>
              </select>
            </label>
            <input class="admin-guest-input w-full rounded-[10px] border px-2.5 py-2 text-[13px] focus:outline-none ${sel === '__custom' || (sel === '' && !inHistory && current) ? '' : 'hidden'}"
              style="border-color:var(--line-strong);background:var(--bg-card)"
              type="text" value="${ea(inHistory ? '' : current)}" placeholder="Vendég neve…" />
          </div>`;
      }).join('');

    const initials = nameInitials(host);
    const hue = avatarHue(host);
    return `
      <div class="card p-4 fade-up">
        <div class="flex items-center gap-2.5 mb-3">
          <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
               style="width:28px;height:28px;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
            ${eh(initials)}
          </div>
          <p class="text-[14px] font-semibold text-fg-1 flex-1 min-w-0 truncate">${eh(host)} vendégei (${entry.guestCount})</p>
        </div>
        <div class="space-y-2.5">${slots}</div>
      </div>`;
  }).join('');

  return `
    <div class="space-y-3">${cards}</div>
    <div class="flex justify-between gap-2 fade-up">
      <button id="admin-back-2" class="px-5 py-2.5 rounded-full text-[13px] font-semibold transition-colors" style="background:var(--bg-elev);color:var(--fg-2)">
        ← Vissza
      </button>
      <button id="admin-next-2" class="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm" style="background:var(--accent)">
        Tovább →
      </button>
    </div>`;
}

// ─── Step 3: összesítés + mentés ───
function renderStep3(state: AdminState): string {
  const presentList = MAIN_NAME_LIST.filter((n) => state.entries.get(n)!.present);
  let totalRows = 0;
  const summary = presentList.map((name) => {
    totalRows += 1;
    const entry = state.entries.get(name)!;
    const initials = nameInitials(name);
    const hue = avatarHue(name);
    const guestItems = entry.guestNames
      .slice(0, entry.guestCount)
      .filter((g) => g.trim())
      .map((g) => {
        totalRows += 1;
        return `<li class="text-[12px] text-fg-2 ml-9">↳ ${eh(g.trim())}</li>`;
      }).join('');
    return `
      <li class="px-4 py-2.5" style="border-top:1px solid var(--line)">
        <div class="flex items-center gap-2.5">
          <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
               style="width:28px;height:28px;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
            ${eh(initials)}
          </div>
          <span class="text-[13px] font-semibold text-fg-1">${eh(name)}</span>
        </div>
        ${guestItems ? `<ul class="mt-1.5 space-y-0.5">${guestItems}</ul>` : ''}
      </li>`;
  }).join('');

  return `
    <div class="card p-4 fade-up">
      <p class="eyebrow text-[10px] mb-1">Dátum</p>
      <p class="text-[16px] font-semibold text-fg-1">${eh(formatDateHuLong(state.date))}</p>
      <p class="text-[12px] text-fg-3 mt-2">
        <span class="font-mono-tnum font-semibold text-fg-1">${totalRows}</span> rekord kerül mentésre
      </p>
    </div>

    <div class="card overflow-hidden fade-up" style="border-radius:22px">
      <div class="px-4 py-3" style="border-bottom:1px solid var(--line)">
        <span class="eyebrow">Összesítés</span>
      </div>
      <ul>${summary}</ul>
    </div>

    <div class="flex justify-between gap-2 fade-up">
      <button id="admin-back-3" class="px-5 py-2.5 rounded-full text-[13px] font-semibold transition-colors ${state.saving ? 'opacity-50 cursor-not-allowed' : ''}" style="background:var(--bg-elev);color:var(--fg-2)" ${state.saving ? 'disabled' : ''}>
        ← Vissza
      </button>
      <button id="admin-save" class="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-opacity ${state.saving ? 'opacity-60 cursor-not-allowed' : ''}" style="background:var(--accent)" ${state.saving ? 'disabled' : ''}>
        ${state.saving ? 'Mentés…' : '💾 Mentés'}
      </button>
    </div>`;
}

// ─── Toast ───
function renderToast(toast: NonNullable<AdminState['toast']>): string {
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

function rerender(container: HTMLElement, state: AdminState) {
  const body = container.querySelector<HTMLElement>('#admin-body')!;
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

function attachHandlers(container: HTMLElement, state: AdminState) {
  // Step 1
  const dateSel = container.querySelector<HTMLSelectElement>('#admin-date-select');
  dateSel?.addEventListener('change', () => {
    state.date = dateSel.value;
  });

  container.querySelectorAll<HTMLLIElement>('[data-name]').forEach((li) => {
    const name = li.dataset.name!;
    const entry = state.entries.get(name)!;
    li.querySelector<HTMLInputElement>('.admin-present')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      entry.present = checked;
      if (!checked) {
        entry.guestCount = 0;
        entry.guestNames = [];
      }
      rerender(container, state);
    });
    const applyGuestCount = (next: number) => {
      const clamped = Math.max(0, Math.min(MAX_GUESTS, next));
      if (clamped === entry.guestCount) return;
      entry.guestCount = clamped;
      // Tartsuk meg a már beírt neveket
      while (entry.guestNames.length < entry.guestCount) entry.guestNames.push('');
      entry.guestNames.length = entry.guestCount;
      rerender(container, state);
    };
    li.querySelector<HTMLButtonElement>('.admin-guest-dec')?.addEventListener('click', () => {
      if (!entry.present) return;
      applyGuestCount(entry.guestCount - 1);
    });
    li.querySelector<HTMLButtonElement>('.admin-guest-inc')?.addEventListener('click', () => {
      if (!entry.present) return;
      applyGuestCount(entry.guestCount + 1);
    });
  });

  container.querySelector<HTMLButtonElement>('#admin-next-1')?.addEventListener('click', () => {
    state.step = 2;
    rerender(container, state);
  });

  // Step 2
  container.querySelectorAll<HTMLElement>('[data-host][data-idx]').forEach((slot) => {
    const host = slot.dataset.host!;
    const idx = Number(slot.dataset.idx);
    const entry = state.entries.get(host)!;
    const sel = slot.querySelector<HTMLSelectElement>('.admin-guest-sel');
    const inp = slot.querySelector<HTMLInputElement>('.admin-guest-input');

    sel?.addEventListener('change', () => {
      const val = sel.value;
      if (val === '__custom' || val === '') {
        inp?.classList.remove('hidden');
        entry.guestNames[idx] = inp?.value.trim() ?? '';
      } else {
        inp?.classList.add('hidden');
        entry.guestNames[idx] = val;
      }
    });
    inp?.addEventListener('input', () => {
      entry.guestNames[idx] = inp.value;
    });
  });

  container.querySelector<HTMLButtonElement>('#admin-back-2')?.addEventListener('click', () => {
    state.step = 1;
    rerender(container, state);
  });
  container.querySelector<HTMLButtonElement>('#admin-next-2')?.addEventListener('click', () => {
    state.step = 3;
    rerender(container, state);
  });

  // Step 3
  container.querySelector<HTMLButtonElement>('#admin-back-3')?.addEventListener('click', () => {
    if (state.saving) return;
    state.step = 2;
    rerender(container, state);
  });
  container.querySelector<HTMLButtonElement>('#admin-save')?.addEventListener('click', async () => {
    if (state.saving) return;
    state.saving = true;
    rerender(container, state);

    try {
      const rows: NewAttendanceRow[] = [];
      for (const name of MAIN_NAME_LIST) {
        const e = state.entries.get(name)!;
        if (!e.present) continue;
        rows.push({ name, status: 'Yes', event_date: state.date, mode: 'valós' });
        for (let i = 0; i < e.guestCount; i++) {
          const gName = (e.guestNames[i] ?? '').trim();
          if (gName) {
            rows.push({ name: `${name} - ${gName}`, status: 'Yes', event_date: state.date, mode: 'valós' });
          }
        }
      }
      const saved = await addAttendanceBatch(rows);
      state.toast = { kind: 'success', msg: `✓ ${saved} rekord mentve` };
      // Reset
      state.step = 1;
      for (const e of state.entries.values()) {
        e.present = false;
        e.guestCount = 0;
        e.guestNames = [];
      }
    } catch (err) {
      state.toast = { kind: 'error', msg: `Hiba: ${String(err)}` };
    } finally {
      state.saving = false;
      rerender(container, state);
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function getHistoricalGuests(records: RawAttendance[], host: string): string[] {
  const prefix = `${host} - `;
  const guests = new Set<string>();
  for (const r of records) {
    if (r.name.startsWith(prefix)) {
      const g = r.name.slice(prefix.length).trim();
      if (g) guests.add(g);
    }
  }
  return [...guests].sort((a, b) => a.localeCompare(b, 'hu'));
}

function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(h) % 360;
}

function eh(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function ea(s: string): string { return eh(s); }
