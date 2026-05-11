/**
 * Alkalmak Áttekintése oldal — Claude Design implementáció.
 * - Hero kártya: nagy dátum, létszám, "Jelentkezés" gomb (placeholder)
 * - DateChip scroller (pill stílus, accent jelölés)
 * - Résztvevők kártya-grid layout
 * - Lemondott / üres állapot
 * - UpcomingTeaser info strip
 */

import {
  generateTuesdayDates,
  upcomingTuesday,
  formatMonthShortHu,
  dayOf,
  formatDateHuLong,
} from '../lib/dates';
import { getAttendeesByDates, getCancelledSessions, type CancelledSession } from '../lib/firestore';
import { getInitials } from '../lib/avatar';
import { renderHeader } from '../components/header';

interface OverviewState {
  dates: string[];
  upcoming: string;
  selected: string;
  attendeesByDate: Map<string, string[]>;
  cancelled: Map<string, CancelledSession>;
}

// ─── Belépési pont ───
export async function renderOverviewPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderLoadingShell();

  const dates = generateTuesdayDates(8, 1);
  const [attendeesByDate, cancelled] = await Promise.all([
    getAttendeesByDates(dates),
    getCancelledSessions(),
  ]);
  const upcoming = upcomingTuesday(dates);

  const state: OverviewState = {
    dates,
    upcoming,
    selected: upcoming,
    attendeesByDate,
    cancelled,
  };

  container.innerHTML = renderShell(state);
  attachHandlers(container, state);
}

// ─── Loading ───
function renderLoadingShell(): string {
  return `
    <div class="device">
      <div style="height:88px;background:var(--bg-glass);border-bottom:1px solid var(--line)"></div>
      <div class="px-5 pt-5 space-y-4">
        <div class="h-44 rounded-[28px] animate-pulse" style="background:var(--line)"></div>
        <div class="flex gap-2">
          ${Array(6).fill(0).map(() => `<div class="h-20 w-16 rounded-2xl animate-pulse flex-none" style="background:var(--line)"></div>`).join('')}
        </div>
        <div class="h-48 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
      </div>
    </div>`;
}

// ─── Shell ───
// Mobile (< lg): hero → scroller → résztvevők → teaser (stacked)
// Desktop (lg+): 3-col grid — hero (sticky) | résztvevők | dátum-lista (sticky)
function renderShell(state: OverviewState): string {
  return `
    <div class="device">
      ${renderHeader('overview')}
      <div class="lg:grid lg:grid-cols-[300px_1fr_260px] lg:gap-6 lg:p-6 lg:pt-5 lg:items-start">
        <!-- Bal oszlop: Hero (sticky desktop-on) -->
        <div id="hero-wrapper" class="lg:sticky lg:top-[110px]">
          ${renderHero(state)}
        </div>
        <!-- Középső oszlop: scroller (csak mobil) + Résztvevők + Teaser -->
        <div class="lg:min-w-0">
          <div class="lg:hidden">
            ${renderDateScroller(state)}
          </div>
          <div id="result-main" class="px-5 pt-3 lg:px-0 lg:pt-0">
            ${renderResult(state)}
          </div>
          ${renderUpcomingTeaser()}
        </div>
        <!-- Jobb oszlop: Dátum-lista (csak desktop, sticky) -->
        <div class="hidden lg:block lg:sticky lg:top-[110px]">
          ${renderDateRail(state)}
        </div>
      </div>
    </div>`;
}

// ─── Hero kártya ───
function renderHero(state: OverviewState): string {
  const date = state.selected;
  const isCancelled = state.cancelled.has(date);
  const attendees = state.attendeesByDate.get(date) ?? [];
  const count = isCancelled ? 0 : attendees.length;
  const idealMin = 8;
  const isReady = count >= idealMin;

  // Dátum parse
  const [y, m, d] = date.split('-').map(Number);
  const dayNames = ['vasárnap','hétfő','kedd','szerda','csütörtök','péntek','szombat'];
  const monthNames = ['január','február','március','április','május','június','július','augusztus','szeptember','október','november','december'];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayName = dayNames[dt.getUTCDay()];
  const monthLong = monthNames[m - 1];

  // Relatív időcímke
  const relLabel = getRelativeLabel(date);

  const relBadge = isCancelled
    ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full" style="background:rgba(120,120,120,0.14);color:var(--fg-2)">Elmarad</span>`
    : relLabel
      ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full" style="background:color-mix(in oklab,var(--accent) 14%,transparent);color:var(--accent-ink)">${relLabel}</span>`
      : '';

  const countSection = isCancelled
    ? `<div class="mt-4">
        <p class="text-[14px] font-semibold text-fg-1">Elmarad</p>
        <p class="text-[12px] text-fg-2 mt-0.5">${eh(state.cancelled.get(date)?.reason ?? '')}</p>
       </div>`
    : `<div class="mt-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-full flex items-center justify-center"
               style="background:${isReady ? 'color-mix(in oklab,#10b981 16%,transparent)' : 'color-mix(in oklab,var(--accent) 14%,transparent)'};border:1px solid color-mix(in oklab,currentColor 20%,transparent);color:${isReady ? '#047857' : 'var(--accent-ink)'}">
            <span class="font-mono-tnum font-bold text-[18px] num-display">${count}</span>
          </div>
          <div>
            <p class="text-[14px] font-semibold text-fg-1">${count} fő jelentkezett</p>
            <p class="text-[12px] text-fg-2">${isReady ? 'Lesz edzés ✓' : `Még ${idealMin - count} fő kell`}</p>
          </div>
        </div>
        <button id="btn-jelentkezes"
          class="px-3.5 py-2 rounded-full text-[12px] font-semibold text-white shadow-sm cursor-not-allowed opacity-60"
          title="Hamarosan elérhető"
          style="background:var(--accent)">
          Jelentkezés
        </button>
       </div>`;

  return `
    <section class="relative px-5 pt-5 pb-2 fade-up">
      <div class="halo"></div>
      <div class="relative card noise lift overflow-hidden" style="border-radius:28px">
        ${renderVolleyballArt()}
        <div class="relative p-5">
          <div class="flex items-center justify-between mb-3">
            <span class="eyebrow">Kiválasztott alkalom</span>
            ${relBadge}
          </div>
          <div class="flex items-baseline gap-3 mb-1">
            <p class="font-mono-tnum num-display font-semibold text-[64px] leading-none text-fg-1"
               style="${isCancelled ? 'text-decoration:line-through;text-decoration-color:var(--fg-3)' : ''}">${d}</p>
            <div class="leading-tight">
              <p class="text-[15px] font-semibold text-fg-1 capitalize">${monthLong}</p>
              <p class="text-[12px] text-fg-3 capitalize">${dayName} · ${y}</p>
            </div>
          </div>
          ${countSection}
        </div>
      </div>
    </section>`;
}

// ─── Date scroller ───
function renderDateScroller(state: OverviewState): string {
  const chips = state.dates.map((date) => renderDateChip(date, state)).join('');
  return `
    <section class="px-5 pt-4 pb-1 lg:px-0 lg:pt-0">
      <div class="flex items-end justify-between mb-2">
        <span class="eyebrow">Válassz alkalmat</span>
        <span class="eyebrow text-[10px]">${state.dates.length} alkalom</span>
      </div>
      <div id="date-scroller" class="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 pb-2 lg:mx-0 lg:px-0">
        ${chips}
      </div>
    </section>`;
}

function renderDateChip(date: string, state: OverviewState): string {
  const isCancelled = state.cancelled.has(date);
  const isSelected = date === state.selected;
  const isUpcoming = date === state.upcoming;
  const count = state.attendeesByDate.get(date)?.length ?? 0;

  const d = dayOf(date);
  const monthShort = formatMonthShortHu(date);

  const upcomingDot = isUpcoming && !isCancelled
    ? `<span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style="background:#10b981;box-shadow:0 0 0 2px var(--bg-card)"></span>`
    : '';

  return `
    <button class="date-btn relative flex-none flex flex-col items-center px-3.5 py-2.5 rounded-2xl border transition-colors"
      data-date="${date}"
      style="
        background:${isCancelled ? 'color-mix(in oklab,var(--fg-3) 8%,transparent)' : isSelected ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'var(--bg-card)'};
        border-color:${isSelected ? 'var(--accent)' : 'var(--line)'};
        min-width:60px;
        opacity:${isCancelled ? '0.55' : '1'};
      "
      ${isCancelled ? 'aria-disabled="true"' : ''}
    >
      ${upcomingDot}
      <span class="text-[9px] font-semibold uppercase tracking-widest"
            style="color:${isSelected ? 'var(--accent-ink)' : 'var(--fg-3)'};${isCancelled ? 'text-decoration:line-through' : ''}">
        ${monthShort}
      </span>
      <span class="font-mono-tnum font-semibold text-[20px] leading-tight mt-0.5"
            style="color:${isSelected ? 'var(--accent-ink)' : 'var(--fg-1)'};${isCancelled ? 'text-decoration:line-through' : ''}">
        ${d}
      </span>
      <span class="text-[10px] mt-0.5 font-mono-tnum"
            style="color:${isSelected ? 'var(--accent-ink)' : 'var(--fg-3)'}">
        ${isCancelled ? '—' : `${count} fő`}
      </span>
    </button>`;
}

// ─── Date rail (desktop, függőleges lista) ───
function renderDateRail(state: OverviewState): string {
  return `
    <section class="card overflow-hidden fade-up" style="border-radius:20px">
      <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
        <span class="eyebrow">Alkalmak</span>
        <span class="eyebrow text-[10px]">${state.dates.length}</span>
      </div>
      <ul id="date-rail">
        ${renderDateRailItems(state)}
      </ul>
    </section>`;
}

function renderDateRailItems(state: OverviewState): string {
  return state.dates.map((d) => renderDateRailItem(d, state)).join('');
}

function renderDateRailItem(date: string, state: OverviewState): string {
  const isCancelled = state.cancelled.has(date);
  const isSelected = date === state.selected;
  const isUpcoming = date === state.upcoming;
  const count = state.attendeesByDate.get(date)?.length ?? 0;
  const d = dayOf(date);
  const monthShort = formatMonthShortHu(date);
  const relLabel = getRelativeLabel(date);

  const rowBg = isSelected
    ? 'color-mix(in oklab,var(--accent) 14%,transparent)'
    : 'transparent';
  const numColor = isSelected ? 'var(--accent-ink)' : 'var(--fg-1)';
  const monthColor = isSelected ? 'var(--accent-ink)' : 'var(--fg-3)';
  const subColor = isSelected ? 'var(--accent-ink)' : 'var(--fg-2)';
  const strike = isCancelled ? 'text-decoration:line-through' : '';

  const upcomingDot = isUpcoming && !isCancelled
    ? `<span class="w-1.5 h-1.5 rounded-full" style="background:#10b981;flex:none"></span>`
    : '';

  const sideAccent = isSelected
    ? `<span style="position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--accent)"></span>`
    : '';

  const status = isCancelled
    ? `<span class="text-[11px] font-medium" style="color:var(--fg-3);${strike}">Elmarad</span>`
    : `<span class="text-[11px] font-mono-tnum font-medium" style="color:${subColor}">${count} fő</span>`;

  const relSub = isCancelled
    ? ''
    : relLabel
      ? `<span class="text-[10px] font-medium" style="color:${isSelected ? 'var(--accent-ink)' : 'var(--fg-3)'}">${relLabel}</span>`
      : '';

  return `
    <li>
      <button class="date-rail-btn relative w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[color:var(--bg-elev)]"
        data-date="${date}"
        ${isCancelled ? 'aria-disabled="true"' : ''}
        style="background:${rowBg};opacity:${isCancelled ? '0.55' : '1'};border-top:1px solid var(--line)">
        ${sideAccent}
        <div class="flex flex-col items-center" style="min-width:36px">
          <span class="text-[9px] font-semibold uppercase tracking-widest"
                style="color:${monthColor};${strike}">${monthShort}</span>
          <span class="font-mono-tnum font-semibold text-[19px] leading-tight"
                style="color:${numColor};${strike}">${d}</span>
        </div>
        <div class="flex-1 min-w-0 flex flex-col">
          <div class="flex items-center gap-1.5">
            ${upcomingDot}
            ${relSub || `<span class="text-[10px]" style="color:${isSelected ? 'var(--accent-ink)' : 'var(--fg-3)'}">${eh(formatDateHuLong(date).split(',')[1]?.trim() ?? '')}</span>`}
          </div>
          ${status}
        </div>
      </button>
    </li>`;
}

// ─── Result (state-függő) ───
function renderResult(state: OverviewState): string {
  if (state.cancelled.has(state.selected)) {
    return renderCancelledCard(state.selected, state.cancelled.get(state.selected));
  }
  const attendees = state.attendeesByDate.get(state.selected) ?? [];
  if (attendees.length === 0) return renderEmptyCard(state.selected);
  return renderAttendeesSection(attendees);
}

function renderAttendeesSection(attendees: string[]): string {
  const cards = attendees.map((name) => {
    const hue = avatarHue(name);
    const initials = getInitials(name);
    return `
      <div class="card flex items-center gap-2.5 px-3 py-2.5 lift" style="border-radius:16px">
        <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
             style="width:28px;height:28px;flex-shrink:0;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
          ${eh(initials)}
        </div>
        <span class="text-[12.5px] font-medium text-fg-1">${eh(name)}</span>
      </div>`;
  }).join('');

  return `
    <div class="fade-up" style="animation-delay:80ms">
      <div class="flex items-end justify-between mb-3">
        <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Résztvevők</h2>
        <span class="eyebrow">${attendees.length} fő</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        ${cards}
      </div>
    </div>`;
}

function renderEmptyCard(date: string): string {
  return `
    <div class="fade-up">
      <div class="card-soft p-8 text-center" style="border-radius:22px">
        <div class="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3"
             style="background:color-mix(in oklab,var(--fg-3) 14%,transparent)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-fg-2">
            <circle cx="12" cy="12" r="9"/><path d="M3 12c4.5-1.5 13.5-1.5 18 0M12 3c-2.5 4.5-2.5 13.5 0 18M12 3c2.5 4.5 2.5 13.5 0 18"/>
          </svg>
        </div>
        <p class="text-[15px] font-semibold text-fg-1">Még nincs jelentkező</p>
        <p class="text-[12px] text-fg-2 mt-1 max-w-[280px] mx-auto">
          Légy az első, aki jelzi a részvételét erre az alkalomra!
        </p>
        <p class="text-[12px] text-fg-3 mt-0.5">${eh(formatDateHuLong(date))}</p>
        <button id="btn-jelentkezes-empty"
          class="mt-4 px-4 py-2 rounded-full text-[13px] font-semibold text-white cursor-not-allowed opacity-60"
          title="Hamarosan elérhető"
          style="background:var(--accent)">
          Jelentkezem
        </button>
      </div>
    </div>`;
}

function renderCancelledCard(date: string, info?: CancelledSession): string {
  return `
    <div class="fade-up">
      <div class="card-soft p-6 text-center relative overflow-hidden" style="border-radius:22px">
        <div class="absolute inset-0 opacity-50"
             style="background:radial-gradient(80% 60% at 50% 0%,rgba(120,120,120,0.10),transparent 70%)"></div>
        <div class="relative">
          <div class="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3"
               style="background:color-mix(in oklab,var(--fg-3) 18%,transparent)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-fg-2">
              <circle cx="12" cy="12" r="9"/><path d="m8 8 8 8M16 8l-8 8"/>
            </svg>
          </div>
          <p class="text-[15px] font-semibold text-fg-1">Ez az alkalom elmarad</p>
          <p class="text-[12px] text-fg-2 mt-0.5">${eh(formatDateHuLong(date))}</p>
          ${info?.reason ? `<p class="text-[12px] text-fg-3 mt-1">${eh(info.reason)}</p>` : ''}
        </div>
      </div>
    </div>`;
}

// ─── Upcoming teaser strip ───
function renderUpcomingTeaser(): string {
  return `
    <section class="px-5 pt-5 pb-10 lg:px-0 lg:pt-5 lg:pb-2">
      <div class="card-soft px-4 py-3 flex items-center gap-3" style="border-radius:18px">
        <div class="w-8 h-8 rounded-full flex items-center justify-center"
             style="background:color-mix(in oklab,var(--accent) 14%,transparent)">
          <span class="text-[13px]">📅</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[12.5px] font-medium text-fg-1">Heti emlékeztető</p>
          <p class="text-[11px] text-fg-3">Minden kedden, 19:00 — Sportcsarnok B terem</p>
        </div>
        <button id="btn-reszletek"
          class="text-[12px] font-semibold cursor-not-allowed opacity-60"
          title="Hamarosan elérhető"
          style="color:var(--accent)">
          Részletek →
        </button>
      </div>
    </section>`;
}

// ─── Volleyball art SVG ───
function renderVolleyballArt(): string {
  return `
    <div class="absolute inset-0 overflow-hidden pointer-events-none" style="opacity:0.07">
      <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="1.2"
           style="position:absolute;right:-20px;top:-20px;width:180px;height:180px;color:var(--fg-1)">
        <circle cx="100" cy="100" r="92"/>
        <path d="M8 100 Q60 60 100 100 T192 100"/>
        <path d="M100 8 Q60 60 100 100 T100 192"/>
        <path d="M100 8 Q140 60 100 100 T100 192"/>
        <path d="M8 100 Q60 140 100 100 T192 100"/>
        <circle cx="100" cy="100" r="74" opacity="0.4"/>
      </svg>
    </div>`;
}

// ─── Event handling ───
function attachHandlers(container: HTMLElement, state: OverviewState) {
  const scroller = container.querySelector<HTMLDivElement>('#date-scroller')!;
  const rail = container.querySelector<HTMLElement>('#date-rail'); // null desktop alatt is, mert hidden

  // Scroller horizontális scroll — csak a scroller-t scrollozzuk, nem az oldalt
  const scrollToSelected = (smooth = false) => {
    const chip = scroller.querySelector<HTMLButtonElement>(`[data-date="${state.selected}"]`);
    if (!chip) return;
    const targetLeft = chip.offsetLeft - (scroller.offsetWidth - chip.offsetWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, targetLeft), behavior: smooth ? 'smooth' : 'instant' });
  };

  requestAnimationFrame(() => scrollToSelected(false));

  // Központosított dátum-váltás logika (mind a mobil chip-ekből, mind a desktop rail-ből)
  const selectDate = (date: string) => {
    if (date === state.selected) return;
    state.selected = date;

    // Hero
    const heroWrapper = container.querySelector<HTMLElement>('#hero-wrapper')!;
    heroWrapper.innerHTML = renderHero(state);

    // Mobil chip-ek
    scroller.innerHTML = state.dates.map((d) => renderDateChip(d, state)).join('');

    // Desktop rail
    if (rail) rail.innerHTML = renderDateRailItems(state);

    // Résztvevő-lista
    const resultEl = container.querySelector<HTMLElement>('#result-main')!;
    resultEl.innerHTML = renderResult(state);

    // Scroller középre görget
    requestAnimationFrame(() => scrollToSelected(true));
  };

  // Mobil scroller click
  scroller.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.date-btn');
    if (!target || target.getAttribute('aria-disabled') === 'true') return;
    if (target.dataset.date) selectDate(target.dataset.date);
  });

  // Desktop rail click
  rail?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.date-rail-btn');
    if (!target || target.getAttribute('aria-disabled') === 'true') return;
    if (target.dataset.date) selectDate(target.dataset.date);
  });
}

// ─── Utils ───
function getRelativeLabel(iso: string): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d));
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0)  return 'Ma';
  if (diff === 1)  return 'Holnap';
  if (diff === -1) return 'Tegnap';
  if (diff > 1 && diff < 7)   return `${diff} nap múlva`;
  if (diff < -1 && diff > -7) return `${-diff} napja`;
  return null;
}

function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(h) % 360;
}

function eh(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
