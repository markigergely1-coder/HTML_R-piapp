/**
 * Alkalmak Áttekintése oldal — Claude Design implementáció.
 * - Hero kártya: nagy dátum, létszám, "Jelentkezés" gomb (placeholder)
 * - DateChip scroller (pill stílus, accent jelölés)
 * - Résztvevők kártya-grid layout
 * - Lemondott / üres állapot
 * - UpcomingTeaser info strip
 */

import {
  pastTuesdaysForDisplay,
  formatMonthShortHu,
  dayOf,
  formatDateHuLong,
} from '../lib/dates';
import {
  getAttendeesByDates,
  getCancelledSessions,
  getMemberByEmail,
  upsertSelfRegistration,
  deleteAttendanceForPlayerOnDate,
  type CancelledSession,
  type Member,
} from '../lib/firestore';
import { getAuthState } from '../lib/auth';
import { getInitials } from '../lib/avatar';
import { renderHeader } from '../components/header';

interface OverviewState {
  dates: string[];
  upcoming: string;
  selected: string;
  attendeesByDate: Map<string, string[]>;
  cancelled: Map<string, CancelledSession>;
  selfMember: Member | null;
  selfRegistering: boolean;
  editMode: boolean;
  pendingDelete: { name: string; date: string } | null;
  deleting: boolean;
}

// ─── Belépési pont ───
export async function renderOverviewPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderLoadingShell();

  // Csak múltbeli (és kedd 21:00 után aznapi) alkalmak.
  const dates = pastTuesdaysForDisplay(9);
  const authState = getAuthState();
  const [attendeesByDate, cancelled, selfMember] = await Promise.all([
    getAttendeesByDates(dates),
    getCancelledSessions(),
    authState.user?.email ? getMemberByEmail(authState.user.email) : Promise.resolve(null),
  ]);
  // A legutóbbi alkalom van alapból kiválasztva.
  const mostRecent = dates[dates.length - 1] ?? '';

  const state: OverviewState = {
    dates,
    upcoming: mostRecent,  // a "soron lévő" most a legutóbbi (nincs jövőbeli)
    selected: mostRecent,
    attendeesByDate,
    cancelled,
    selfMember,
    selfRegistering: false,
    editMode: false,
    pendingDelete: null,
    deleting: false,
  };

  container.innerHTML = renderShell(state);
  attachHandlers(container, state);

  // Ha az auth állapot megváltozik (bejelentkezés / kijelentkezés) a router már
  // újra-renderi az oldalt — nem kell itt külön kezelni.
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
// Mobile (< lg): hero → scroller → résztvevők (stacked)
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
        <!-- Középső oszlop: scroller (csak mobil) + Résztvevők -->
        <div class="lg:min-w-0">
          <div class="lg:hidden">
            ${renderDateScroller(state)}
          </div>
          <div id="result-main" class="px-5 pt-3 pb-10 lg:px-0 lg:pt-0 lg:pb-2">
            ${renderResult(state)}
          </div>
        </div>
        <!-- Jobb oszlop: Dátum-lista (csak desktop, sticky) -->
        <div class="hidden lg:block lg:sticky lg:top-[110px]">
          ${renderDateRail(state)}
        </div>
      </div>
      ${renderDeleteConfirmModal(state)}
    </div>`;
}

// ─── Hero kártya ───
function renderHero(state: OverviewState): string {
  const date = state.selected;
  const isCancelled = state.cancelled.has(date);
  const attendees = state.attendeesByDate.get(date) ?? [];
  const count = isCancelled ? 0 : attendees.length;
  const idealMin = 8;
  const isPast = isDateInPast(date);
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

  // Státusz szöveg: múltbéli alkalomnál "Volt játék" / "Nem volt játék",
  // jövőbenire "Lesz edzés ✓" vagy "Még X fő kell"
  let statusText: string;
  if (isPast) {
    statusText = count > 0 ? 'Volt játék' : 'Nem volt játék';
  } else {
    statusText = isReady ? 'Lesz edzés ✓' : `Még ${idealMin - count} fő kell`;
  }
  const statusIsGood = isPast ? count > 0 : isReady;

  const countSection = isCancelled
    ? `<div class="mt-4">
        <p class="text-[14px] font-semibold text-fg-1">Elmarad</p>
        <p class="text-[12px] text-fg-2 mt-0.5">${eh(state.cancelled.get(date)?.reason ?? '')}</p>
       </div>`
    : `<div class="mt-4 flex items-center gap-3">
        <div class="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
             style="background:${statusIsGood ? 'color-mix(in oklab,#10b981 16%,transparent)' : 'color-mix(in oklab,var(--accent) 14%,transparent)'};border:1px solid color-mix(in oklab,currentColor 20%,transparent);color:${statusIsGood ? '#047857' : 'var(--accent-ink)'}">
          <span class="font-mono-tnum font-bold text-[18px] num-display">${count}</span>
        </div>
        <div class="min-w-0">
          <p class="text-[14px] font-semibold text-fg-1">${count} fő ${isPast ? 'volt jelen' : 'jelentkezett'}</p>
          <p class="text-[12px] text-fg-2">${statusText}</p>
        </div>
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
          ${!isCancelled && !isPast && state.selfMember ? renderSelfRegButton(state) : ''}
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
  return renderAttendeesSection(attendees, state);
}

function renderAttendeesSection(attendees: string[], state: OverviewState): string {
  const editing = state.editMode;
  const cards = attendees.map((name) => {
    const hue = avatarHue(name);
    const initials = getInitials(name);
    const profileHref = `#/profile?name=${encodeURIComponent(name)}`;

    if (editing) {
      // Szerkesztés mód: nem link, hanem button — kattintás megnyitja a delete dialog-ot
      return `
        <button type="button"
          data-action="remove-attendee" data-name="${ea(name)}"
          class="attendee-edit card relative flex items-center gap-2.5 px-3 py-2.5 transition-transform"
          style="border-radius:16px;color:inherit;text-align:left;border:1px solid var(--accent);animation:jiggle 0.6s ease-in-out infinite alternate">
          <span aria-hidden="true"
            class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[12px] font-bold shadow-md"
            style="background:var(--accent);line-height:1">×</span>
          <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
               style="width:28px;height:28px;flex-shrink:0;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
            ${eh(initials)}
          </div>
          <span class="text-[12.5px] font-medium text-fg-1 break-words leading-tight">${eh(name)}</span>
        </button>`;
    }

    return `
      <a href="${profileHref}"
         data-tooltip="→ Lépés ${ea(name)} profiljára"
         class="attendee-card card flex items-center gap-2.5 px-3 py-2.5 lift no-underline transition-colors hover:bg-[color:var(--bg-elev)]"
         style="border-radius:16px;color:inherit;text-decoration:none">
        <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
             style="width:28px;height:28px;flex-shrink:0;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
          ${eh(initials)}
        </div>
        <span class="text-[12.5px] font-medium text-fg-1 break-words leading-tight">${eh(name)}</span>
      </a>`;
  }).join('');

  const editBtn = `
    <button id="attendees-edit-toggle" type="button"
      class="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
      style="background:${editing ? 'var(--accent)' : 'var(--bg-elev)'};color:${editing ? '#fff' : 'var(--fg-2)'};border:1px solid ${editing ? 'var(--accent)' : 'var(--line)'}">
      ${editing ? 'Kész' : 'Szerkesztés'}
    </button>`;

  return `
    <div class="fade-up" style="animation-delay:80ms">
      <div class="flex items-end justify-between mb-3 gap-2">
        <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Résztvevők</h2>
        <div class="flex items-center gap-2">
          <span class="eyebrow">${attendees.length} fő</span>
          ${editBtn}
        </div>
      </div>
      <div id="attendees-grid" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        ${cards}
      </div>
    </div>`;
}

function renderDeleteConfirmModal(state: OverviewState): string {
  if (!state.pendingDelete) return '';
  const { name, date } = state.pendingDelete;
  const dateLabel = formatDateHuLong(date);
  return `
    <div id="delete-confirm-overlay"
      class="fixed inset-0 z-50 flex items-center justify-center px-5 fade-up"
      style="background:rgba(15,12,10,0.45);backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%);animation-duration:160ms">
      <div role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title"
        class="card relative overflow-hidden noise"
        style="border-radius:24px;max-width:380px;width:100%;box-shadow:var(--shadow-lg);border:1px solid var(--line-strong)">
        <div class="relative p-6">
          <div class="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center"
            style="background:color-mix(in oklab,var(--accent) 14%,transparent)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/>
              <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </div>
          <h3 id="delete-confirm-title" class="text-[17px] font-semibold text-fg-1 text-center mb-2">
            Játékos törlése?
          </h3>
          <p class="text-[13px] text-fg-2 text-center leading-relaxed mb-1">
            Biztosan törlöd <span class="font-semibold text-fg-1">${eh(name)}</span> jelenlétét erről az alkalomról:
          </p>
          <p class="text-[13px] text-fg-1 font-semibold text-center mb-5 font-mono-tnum">${eh(dateLabel)}</p>
          <div class="flex flex-col gap-2">
            <button id="delete-confirm-yes" type="button"
              class="w-full px-4 py-2.5 rounded-full text-white text-[14px] font-semibold transition-colors ${state.deleting ? 'opacity-60 cursor-not-allowed' : ''}"
              style="background:var(--accent)"
              ${state.deleting ? 'disabled' : ''}>
              ${state.deleting ? 'Törlés…' : 'Igen, törlés'}
            </button>
            <button id="delete-confirm-no" type="button"
              class="w-full px-4 py-2.5 rounded-full text-[14px] font-semibold transition-colors"
              style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)"
              ${state.deleting ? 'disabled' : ''}>
              Mégse
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function ea(s: string): string {
  // Attribute escape (idézőjel + sortörés-safe)
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;');
}

function renderEmptyCard(date: string): string {
  const past = isDateInPast(date);
  return `
    <div class="fade-up">
      <div class="card-soft p-8 text-center" style="border-radius:22px">
        <div class="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3"
             style="background:color-mix(in oklab,var(--fg-3) 14%,transparent)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-fg-2">
            <circle cx="12" cy="12" r="9"/><path d="M3 12c4.5-1.5 13.5-1.5 18 0M12 3c-2.5 4.5-2.5 13.5 0 18M12 3c2.5 4.5 2.5 13.5 0 18"/>
          </svg>
        </div>
        <p class="text-[15px] font-semibold text-fg-1">${past ? 'Nem volt játék' : 'Még nincs jelentkező'}</p>
        <p class="text-[12px] text-fg-3 mt-1">${eh(formatDateHuLong(date))}</p>
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

// ─── Önregisztráció gomb ───
function renderSelfRegButton(state: OverviewState): string {
  if (!state.selfMember) return '';
  if (state.selfRegistering) {
    return `
      <div class="mt-3 flex items-center gap-2 px-3 py-2">
        <div class="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0" style="border-color:var(--accent) var(--line) var(--line) var(--line)"></div>
        <span class="text-[12px] text-fg-3">Mentés…</span>
      </div>`;
  }
  const isGoing = (state.attendeesByDate.get(state.selected) ?? []).includes(state.selfMember.name);
  if (isGoing) {
    return `
      <button id="self-reg-btn" class="mt-3 w-full py-2.5 rounded-2xl text-[13px] font-semibold transition-colors"
        style="border:1.5px solid var(--accent);color:var(--accent-ink);background:color-mix(in oklab,var(--accent) 8%,transparent)">
        ✓ Megyek — visszavonás
      </button>`;
  }
  return `
    <button id="self-reg-btn" class="mt-3 w-full py-2.5 rounded-2xl text-[13px] font-semibold text-white transition-colors"
      style="background:var(--accent)">
      Megyek →
    </button>`;
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
  attachTooltip(container);

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

  // Szerkesztés mód toggle
  container.querySelector<HTMLButtonElement>('#attendees-edit-toggle')?.addEventListener('click', () => {
    state.editMode = !state.editMode;
    const resultEl = container.querySelector<HTMLElement>('#result-main');
    if (resultEl) resultEl.innerHTML = renderResult(state);
    attachHandlers(container, state);
  });

  // Résztvevő kattintás szerkesztés módban — delete dialog megnyitása
  container.querySelectorAll<HTMLButtonElement>('[data-action="remove-attendee"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      if (!name) return;
      state.pendingDelete = { name, date: state.selected };
      container.querySelector<HTMLElement>('#delete-confirm-overlay')?.remove();
      const device = container.querySelector<HTMLElement>('.device');
      if (device) device.insertAdjacentHTML('beforeend', renderDeleteConfirmModal(state));
      attachHandlers(container, state);
    });
  });

  // Modal: Igen (törlés)
  container.querySelector<HTMLButtonElement>('#delete-confirm-yes')?.addEventListener('click', async () => {
    if (!state.pendingDelete || state.deleting) return;
    const { name, date } = state.pendingDelete;
    state.deleting = true;
    // re-render only the modal
    const overlay = container.querySelector<HTMLElement>('#delete-confirm-overlay');
    if (overlay) overlay.outerHTML = renderDeleteConfirmModal(state);
    attachHandlers(container, state);
    try {
      await deleteAttendanceForPlayerOnDate(name, date);
      // Firestore frissítés — újra le kell kérni az aznapi névsort
      const fresh = await getAttendeesByDates([date]);
      state.attendeesByDate.set(date, fresh.get(date) ?? []);
    } catch (err) {
      console.warn('[overview] Delete failed:', err);
    } finally {
      state.deleting = false;
      state.pendingDelete = null;
      // Teljes újra-render — kártyák, hero count, dátum-rail mind frissül
      const heroWrapper = container.querySelector<HTMLElement>('#hero-wrapper');
      if (heroWrapper) heroWrapper.innerHTML = renderHero(state);
      const resultEl = container.querySelector<HTMLElement>('#result-main');
      if (resultEl) resultEl.innerHTML = renderResult(state);
      const rail = container.querySelector<HTMLElement>('#date-rail');
      if (rail) rail.innerHTML = renderDateRailItems(state);
      const scroller2 = container.querySelector<HTMLElement>('#date-scroller');
      if (scroller2) scroller2.innerHTML = state.dates.map((d) => renderDateChip(d, state)).join('');
      const overlay2 = container.querySelector<HTMLElement>('#delete-confirm-overlay');
      if (overlay2) overlay2.remove();
      attachHandlers(container, state);
    }
  });

  // Modal: Mégse / overlay-re kattintás
  const closeModal = () => {
    if (state.deleting) return;
    state.pendingDelete = null;
    const overlay = container.querySelector<HTMLElement>('#delete-confirm-overlay');
    if (overlay) overlay.remove();
  };
  container.querySelector<HTMLButtonElement>('#delete-confirm-no')?.addEventListener('click', closeModal);
  container.querySelector<HTMLElement>('#delete-confirm-overlay')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'delete-confirm-overlay') closeModal();
  });

  // Önregisztráció
  container.querySelector<HTMLButtonElement>('#self-reg-btn')?.addEventListener('click', async () => {
    if (!state.selfMember || state.selfRegistering) return;
    const heroWrapper = container.querySelector<HTMLElement>('#hero-wrapper')!;
    const isGoing = (state.attendeesByDate.get(state.selected) ?? []).includes(state.selfMember.name);
    state.selfRegistering = true;
    heroWrapper.innerHTML = renderHero(state);
    try {
      await upsertSelfRegistration(state.selfMember.name, state.selected, isGoing ? 'No' : 'Yes');
      // Frissített jelenlétek lekérése
      const fresh = await getAttendeesByDates([state.selected]);
      state.attendeesByDate.set(state.selected, fresh.get(state.selected) ?? []);
    } finally {
      state.selfRegistering = false;
    }
    heroWrapper.innerHTML = renderHero(state);
    attachHandlers(container, state);
    container.querySelector<HTMLElement>('#result-main')!.innerHTML = renderResult(state);
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

/** Múltbéli-e az adott YYYY-MM-DD dátum (a mai naphoz képest, lokális idő szerint)? */
function isDateInPast(iso: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  return target.getTime() < today.getTime();
}

function eh(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ─── Tooltip ─────────────────────────────────────────────────
// Egy globális tooltip elem amit minden [data-tooltip] elem felett
// megjelenít — több másodperces hover-rel jelenik meg.

const TOOLTIP_DELAY_MS = 600;
let tooltipShowTimer: number | null = null;
let tooltipEl: HTMLDivElement | null = null;

function ensureTooltipEl(): HTMLDivElement {
  if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.style.cssText = [
    'position:fixed',
    'z-index:60',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 0.15s ease',
    'background:var(--bg-card, #fff)',
    'color:var(--fg-1, #18181b)',
    'border:1px solid var(--line, rgba(0,0,0,0.1))',
    'border-radius:10px',
    'padding:8px 10px',
    'font-size:11.5px',
    'line-height:1.4',
    'box-shadow:0 6px 22px rgba(0,0,0,0.12)',
    'max-width:260px',
    'white-space:pre-line',
    'font-feature-settings:"tnum"',
  ].join(';');
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function positionTooltip(el: HTMLDivElement, anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  // Próbáljuk a kártya fölé tenni; ha nem fér, alá
  el.style.left = `${Math.min(window.innerWidth - el.offsetWidth - margin, Math.max(margin, r.left + r.width / 2 - el.offsetWidth / 2))}px`;
  const above = r.top - el.offsetHeight - margin;
  if (above > margin) {
    el.style.top = `${above}px`;
  } else {
    el.style.top = `${r.bottom + margin}px`;
  }
}

function showTooltip(anchor: HTMLElement, text: string) {
  const el = ensureTooltipEl();
  el.textContent = text;
  // Két frame: először renderelünk hogy a méret tudható legyen, aztán pozícionálunk
  requestAnimationFrame(() => {
    positionTooltip(el, anchor);
    el.style.opacity = '1';
  });
}

function hideTooltip() {
  if (tooltipShowTimer !== null) {
    window.clearTimeout(tooltipShowTimer);
    tooltipShowTimer = null;
  }
  if (tooltipEl) tooltipEl.style.opacity = '0';
}

function attachTooltip(container: HTMLElement) {
  container.addEventListener('mouseover', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-tooltip]');
    if (!target) return;
    const text = target.getAttribute('data-tooltip') ?? '';
    if (!text) return;
    hideTooltip();
    tooltipShowTimer = window.setTimeout(() => showTooltip(target, text), TOOLTIP_DELAY_MS);
  });
  container.addEventListener('mouseout', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-tooltip]');
    if (!target) return;
    const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
    if (related && target.contains(related)) return;
    hideTooltip();
  });
  // Mobil érintésnél ne ragadjon — scroll/click idején eltüntetjük
  container.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('blur', hideTooltip);
}
