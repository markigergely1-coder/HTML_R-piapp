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
  pastTuesdaysForDisplay,
  formatDateHuLong,
  formatMonthShortHu,
  dayOf,
  todayInHungary,
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
  dateMenuOpen: boolean;
  entries: Map<string, AdminEntry>;
  toast: { kind: 'success' | 'error'; msg: string } | null;
  saving: boolean;
  // Vendég history dropdown adatai — lazy load (csak Step 2-höz kell).
  // Üres listával indul → az Admin oldal cold-boot-ja nem vár a full
  // attendance kollekció letöltésére.
  historicalAll: RawAttendance[];
  historicalLoading: boolean;
}

let toastTimer: number | null = null;

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderAdminPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  // Csak múltbeli keddek. Az aznapi kedd csak 21:00 (magyar idő) után számít
  // "múltbelinek" — addig még a hét előzőjét mutatja legutóbbiként.
  const dates = pastTuesdaysForDisplay(9);
  const mostRecent = dates[dates.length - 1] ?? '';

  const entries = new Map<string, AdminEntry>();
  for (const n of MAIN_NAME_LIST) {
    entries.set(n, { present: false, guestCount: 0, guestNames: [] });
  }

  const state: AdminState = {
    step: 1,
    date: mostRecent,
    dates,
    dateMenuOpen: false,
    entries,
    toast: null,
    saving: false,
    historicalAll: [],
    historicalLoading: false,
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

// ─── Custom dátum-választó (elegáns dropdown) ───
function diffDays(iso: string): number {
  const today = todayInHungary();
  const a = new Date(today + 'T12:00:00Z').getTime();
  const b = new Date(iso + 'T12:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

function relativeLabel(iso: string): string | null {
  const d = diffDays(iso);
  if (d === 0)  return 'Ma';
  if (d === 1)  return 'Holnap';
  if (d === -1) return 'Tegnap';
  if (d > 1   && d <= 14) return `${d} nap múlva`;
  if (d < -1  && d >= -14) return `${-d} napja`;
  return null;
}

// Dátum-választó színek a brand --accent (smaragdzöld) változóra épülnek
const DP_COLOR      = 'var(--accent)';
const DP_COLOR_DARK = 'var(--accent-ink)';
const DP_TINT_HOVER = 'color-mix(in oklab, var(--accent) 10%, transparent)';
const DP_TINT_SOFT  = 'color-mix(in oklab, var(--accent) 14%, transparent)';

function renderDatePicker(state: AdminState): string {
  const sortedDates = state.dates.slice().sort((a, b) => b.localeCompare(a)); // legújabb fent
  const open = state.dateMenuOpen;
  const sel = state.date;
  const selDay = dayOf(sel);
  const selMonth = formatMonthShortHu(sel);
  const fullLabel = formatDateHuLong(sel);
  const relSel = relativeLabel(sel);

  const items = sortedDates.map((d) => {
    const isSel = d === sel;
    const day = dayOf(d);
    const month = formatMonthShortHu(d);
    const long = formatDateHuLong(d);
    // long: "2026. május 26., kedd" → szétszedjük évre + napra
    const parts = long.split(',');
    const yearPart = parts[0]?.split('.')[0]?.trim() ?? '';
    const weekday = parts[1]?.trim() ?? 'kedd';
    const rel = relativeLabel(d);
    const relPill = rel
      ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
            style="background:${isSel ? 'rgba(255,255,255,0.18)' : DP_TINT_SOFT};color:${isSel ? '#fff' : DP_COLOR_DARK}">${rel}</span>`
      : '';
    return `
      <button type="button" data-date-pick="${d}"
        class="admin-date-row w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors"
        data-selected="${isSel ? '1' : '0'}"
        style="background:${isSel ? DP_COLOR : 'transparent'};color:${isSel ? '#fff' : 'inherit'};${isSel ? '' : 'border-top:1px solid var(--line);'}">
        <div class="flex flex-col items-center flex-shrink-0" style="min-width:34px">
          <span class="text-[9px] font-semibold uppercase tracking-widest"
                style="color:${isSel ? 'rgba(255,255,255,0.85)' : 'var(--fg-3)'}">${month}</span>
          <span class="font-mono-tnum font-semibold text-[19px] leading-tight"
                style="color:${isSel ? '#fff' : 'var(--fg-1)'}">${day}</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[12.5px] font-semibold leading-tight" style="color:${isSel ? '#fff' : 'var(--fg-1)'}">${weekday}</p>
          <p class="text-[10.5px] font-mono-tnum mt-0.5" style="color:${isSel ? 'rgba(255,255,255,0.75)' : 'var(--fg-3)'}">${yearPart}</p>
        </div>
        ${relPill}
        ${isSel ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
      </button>`;
  }).join('');

  return `
    <div id="admin-datepicker" class="relative fade-up" style="z-index:20">
      <span class="eyebrow mb-1.5 block">Dátum</span>
      <button id="admin-date-trigger" type="button" aria-expanded="${open ? 'true' : 'false'}"
        class="card w-full flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-[color:var(--bg-elev)]"
        style="border-radius:14px;border-color:${open ? DP_COLOR : 'var(--line-strong)'}">
        <div class="rounded-xl flex items-center justify-center flex-shrink-0"
             style="width:42px;height:42px;background:${DP_TINT_SOFT}">
          <div class="flex flex-col items-center leading-none">
            <span class="text-[7px] font-bold uppercase tracking-widest" style="color:${DP_COLOR_DARK}">${selMonth}</span>
            <span class="font-mono-tnum font-bold text-[16px] mt-0.5" style="color:${DP_COLOR_DARK}">${selDay}</span>
          </div>
        </div>
        <div class="flex-1 min-w-0 text-left">
          <p class="text-[14px] font-semibold text-fg-1 truncate">${eh(fullLabel)}</p>
          ${relSel ? `<p class="text-[11px] font-medium mt-0.5" style="color:${DP_COLOR_DARK}">${relSel}</p>` : `<p class="text-[11px] text-fg-3 mt-0.5">Válassz másikat ha kell</p>`}
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             style="color:var(--fg-3);flex:none;transition:transform 200ms;transform:rotate(${open ? '180deg' : '0deg'})">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <input type="hidden" id="admin-date-select" value="${sel}" />
      </button>

      ${open ? `
        <style>
          .admin-date-row[data-selected="0"]:hover { background: ${DP_TINT_HOVER} !important; }
        </style>
        <div id="admin-date-menu"
          class="card overflow-hidden"
          style="position:absolute;top:calc(100% + 6px);left:0;right:0;border-radius:14px;box-shadow:var(--shadow-lg);max-height:340px;overflow-y:auto;animation:fadeUp 160ms ease both">
          ${items}
        </div>
      ` : ''}
    </div>`;
}

// ─── Step 1: jelenlét + vendég-szám ───
function renderStep1(state: AdminState): string {
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
    ${renderDatePicker(state)}

    <!-- Statisztika sáv -->
    <div class="grid grid-cols-2 gap-2 fade-up">
      <div class="card p-3.5">
        <p class="eyebrow text-[10px] mb-1">Jelen</p>
        <p id="admin-stat-present" class="font-mono-tnum font-semibold text-[24px] leading-none text-fg-1 num-display">${presentCount}</p>
      </div>
      <div class="card p-3.5">
        <p class="eyebrow text-[10px] mb-1">Vendégek</p>
        <p id="admin-stat-guests" class="font-mono-tnum font-semibold text-[24px] leading-none text-fg-1 num-display">${totalGuestCount}</p>
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
    : 'background:color-mix(in oklab,var(--danger) 14%,var(--bg-card));border:1px solid color-mix(in oklab,var(--danger) 30%,var(--line));color:var(--danger-ink)';
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

/**
 * Lazy load: a guest history dropdown adatait csak akkor tölti be, amikor
 * a user először lép a Step 2-re. Egyszer fut, utána memóriában marad.
 * Nem blokkolja a Step 2 render-t — a dropdownok kezdetben üres history-val
 * jelennek meg, majd amikor megérkezik az adat, automatikusan újrarendereződik.
 */
function ensureHistoricalLoaded(container: HTMLElement, state: AdminState) {
  if (state.historicalAll.length > 0 || state.historicalLoading) return;
  state.historicalLoading = true;
  getAllAttendanceRecords()
    .then((records) => {
      state.historicalAll = records;
      state.historicalLoading = false;
      // Csak akkor re-render, ha még mindig a Step 2-n vagyunk
      if (state.step === 2) rerender(container, state);
    })
    .catch(() => { state.historicalLoading = false; });
}

/** Csak a dátum-pickert renderezi újra (nem zavarja a stats bar / row state-et). */
function rerenderDatePicker(container: HTMLElement, state: AdminState) {
  const dp = container.querySelector<HTMLElement>('#admin-datepicker');
  if (!dp) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderDatePicker(state);
  const fresh = tmp.firstElementChild as HTMLElement | null;
  if (!fresh) return;
  dp.replaceWith(fresh);
  attachDatePickerHandlers(container, state);
}

// Document-szintű listener-eket egy helyen tartjuk, hogy elkerüljük a duplikációt.
let datePickerOutsideHandler: ((e: MouseEvent) => void) | null = null;
let datePickerKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function attachDatePickerHandlers(container: HTMLElement, state: AdminState) {
  // Korábbi document listenerek leszedése (mindig, hogy ne halmozódjon)
  if (datePickerOutsideHandler) document.removeEventListener('click', datePickerOutsideHandler);
  if (datePickerKeyHandler)     document.removeEventListener('keydown', datePickerKeyHandler);
  datePickerOutsideHandler = null;
  datePickerKeyHandler = null;

  const trigger = container.querySelector<HTMLButtonElement>('#admin-date-trigger');
  trigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.dateMenuOpen = !state.dateMenuOpen;
    rerenderDatePicker(container, state);
  });
  container.querySelectorAll<HTMLButtonElement>('[data-date-pick]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = btn.dataset.datePick;
      if (d) state.date = d;
      state.dateMenuOpen = false;
      rerenderDatePicker(container, state);
    });
  });

  // Outside click + ESC — csak ha nyitva van a menü
  if (state.dateMenuOpen) {
    datePickerOutsideHandler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('#admin-datepicker')) {
        state.dateMenuOpen = false;
        rerenderDatePicker(container, state);
      }
    };
    datePickerKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        state.dateMenuOpen = false;
        rerenderDatePicker(container, state);
      }
    };
    document.addEventListener('click', datePickerOutsideHandler);
    document.addEventListener('keydown', datePickerKeyHandler);
  }
}

/**
 * In-place stats bar + "Tovább" gomb állapotának frissítése.
 * Sokkal kevésbé zavaró mint a teljes oldal-rerender minden stepper-kattintáskor.
 */
function updateStatsAndNext(container: HTMLElement, state: AdminState) {
  const presentEntries = [...state.entries.values()].filter((e) => e.present);
  const presentCount = presentEntries.length;
  const totalGuestCount = presentEntries.reduce((s, e) => s + e.guestCount, 0);

  const presentEl = container.querySelector<HTMLElement>('#admin-stat-present');
  const guestsEl = container.querySelector<HTMLElement>('#admin-stat-guests');
  if (presentEl) presentEl.textContent = String(presentCount);
  if (guestsEl) guestsEl.textContent = String(totalGuestCount);

  const nextBtn = container.querySelector<HTMLButtonElement>('#admin-next-1');
  if (nextBtn) {
    const disabled = presentCount === 0;
    nextBtn.disabled = disabled;
    nextBtn.classList.toggle('opacity-50', disabled);
    nextBtn.classList.toggle('cursor-not-allowed', disabled);
  }
}

function attachHandlers(container: HTMLElement, state: AdminState) {
  attachDatePickerHandlers(container, state);

  // In-place stepper csere: csak az adott row stepper-jét cseréli + handler re-bind
  const replaceStepperInRow = (li: HTMLElement, entry: AdminEntry) => {
    const old = li.querySelector<HTMLElement>('.admin-guest-stepper');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = renderGuestStepper(entry.guestCount, entry.present);
    const fresh = tmp.firstElementChild as HTMLElement | null;
    if (!fresh) return;
    old.replaceWith(fresh);
    bindStepperButtons(li, entry);
  };

  // Egy adott sor stepper-gombjaihoz hozzáköti az event handlereket
  const bindStepperButtons = (li: HTMLElement, entry: AdminEntry) => {
    const applyGuestCount = (next: number) => {
      const clamped = Math.max(0, Math.min(MAX_GUESTS, next));
      if (clamped === entry.guestCount) return;
      entry.guestCount = clamped;
      while (entry.guestNames.length < entry.guestCount) entry.guestNames.push('');
      entry.guestNames.length = entry.guestCount;
      replaceStepperInRow(li, entry);
      updateStatsAndNext(container, state);
    };
    li.querySelector<HTMLButtonElement>('.admin-guest-dec')?.addEventListener('click', () => {
      if (!entry.present) return;
      applyGuestCount(entry.guestCount - 1);
    });
    li.querySelector<HTMLButtonElement>('.admin-guest-inc')?.addEventListener('click', () => {
      if (!entry.present) return;
      applyGuestCount(entry.guestCount + 1);
    });
  };

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
      // In-place: csak a stepper és a stat sáv frissül, nincs flash
      replaceStepperInRow(li, entry);
      updateStatsAndNext(container, state);
    });
    bindStepperButtons(li, entry);
  });

  container.querySelector<HTMLButtonElement>('#admin-next-1')?.addEventListener('click', () => {
    state.step = 2;
    rerender(container, state);
    ensureHistoricalLoaded(container, state);
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
    ensureHistoricalLoaded(container, state);
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
