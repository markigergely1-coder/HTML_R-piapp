/**
 * Alkalmak Áttekintése oldal — Variáns A design.
 * - Sticky header
 * - Vízszintesen görgethető dátum-gombok (létszámokkal)
 * - Eredmény: kártyarács színes avatar-okkal / üres / lemondott állapot
 */

import {
  generateTuesdayDates,
  upcomingTuesday,
  formatMonthShortHu,
  dayOf,
  formatDateHuLong,
} from '../lib/dates';
import { getAttendeesByDates, getCancelledSessions, type CancelledSession } from '../lib/firestore';
import { getInitials, getAvatarColor } from '../lib/avatar';

interface OverviewState {
  dates: string[];
  upcoming: string;
  selected: string;
  attendeesByDate: Map<string, string[]>;
  cancelled: Map<string, CancelledSession>;
}

export async function renderOverviewPage(container: HTMLElement): Promise<void> {
  // Kezdeti loading state
  container.innerHTML = renderLoadingShell();

  // Adatok lekérése párhuzamosan
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

// ─────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────

function renderLoadingShell(): string {
  return `
    <div class="bg-zinc-50 min-h-screen flex items-center justify-center">
      <div class="text-zinc-400 text-sm">Betöltés…</div>
    </div>
  `;
}

function renderShell(state: OverviewState): string {
  return `
    <div class="bg-zinc-50 min-h-screen">
      <div class="max-w-md mx-auto">
        ${renderHeader()}
        ${renderDateSelector(state)}
        <main id="result-main" class="px-4 py-5">
          ${renderResult(state)}
        </main>
      </div>
    </div>
  `;
}

function renderHeader(): string {
  return `
    <header class="bg-white border-b border-zinc-200 sticky top-0 z-20">
      <div class="px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xl" aria-hidden="true">🏐</span>
          <span class="text-[15px] font-semibold text-zinc-900">Röpi</span>
        </div>
        <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">
          Alkalmak
        </span>
      </div>
    </header>
  `;
}

function renderDateSelector(state: OverviewState): string {
  // Görgesés végén legyen a soron következő — a kronológikus sorrend ezt biztosítja,
  // és JS-ben görgetünk a kiválasztotthoz mount után
  const buttons = state.dates
    .map((date) => renderDateButton(date, state))
    .join('');

  return `
    <div class="bg-white border-b border-zinc-200 px-4 pt-3 pb-3">
      <p class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2.5">
        Válassz alkalmat
      </p>
      <div id="date-scroller" class="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
        ${buttons}
      </div>
    </div>
  `;
}

function renderDateButton(date: string, state: OverviewState): string {
  const isCancelled = state.cancelled.has(date);
  const isSelected = date === state.selected;
  const isUpcoming = date === state.upcoming;
  const count = state.attendeesByDate.get(date)?.length ?? 0;

  // Class kombinációk a 4 lehetséges állapotra
  let baseClass =
    'date-btn flex-none flex flex-col items-center gap-0.5 px-3.5 py-2 rounded-xl border transition-colors';

  if (isCancelled) {
    baseClass += ' border-zinc-200 bg-zinc-50 opacity-45';
  } else if (isSelected) {
    baseClass += ' border-2 border-brand-600 bg-brand-50 text-brand-700 relative shadow-sm shadow-brand-100';
  } else {
    baseClass += ' border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-100';
  }

  const upcomingDot =
    isUpcoming && !isCancelled
      ? `<span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white animate-pulse" aria-label="Következő alkalom"></span>`
      : '';

  const month = formatMonthShortHu(date);
  const day = dayOf(date);

  const countLabel = isCancelled
    ? `<span class="text-[10px] text-zinc-400">❌</span>`
    : `<span class="text-[9px] ${isSelected ? 'text-brand-700' : 'text-zinc-400'}">${count} fő</span>`;

  const labelClass = isCancelled ? 'line-through text-zinc-400' : '';
  const dayClass = isCancelled ? 'line-through text-zinc-300' : '';

  return `
    <button
      class="${baseClass}"
      data-date="${date}"
      ${isCancelled ? 'aria-disabled="true"' : ''}
    >
      ${upcomingDot}
      <span class="text-[9px] font-semibold uppercase tracking-wider ${labelClass}">${month}</span>
      <span class="text-[19px] font-semibold leading-tight ${dayClass}">${day}</span>
      ${countLabel}
    </button>
  `;
}

function renderResult(state: OverviewState): string {
  if (state.cancelled.has(state.selected)) {
    return renderCancelledState(state.selected, state.cancelled.get(state.selected));
  }
  const attendees = state.attendeesByDate.get(state.selected) ?? [];
  if (attendees.length === 0) {
    return renderEmptyState(state.selected);
  }
  return renderAttendeesState(state.selected, attendees);
}

function renderAttendeesState(date: string, attendees: string[]): string {
  const count = attendees.length;
  const cards = attendees.map(renderAttendeeCard).join('');
  return `
    <div class="flex items-center gap-3 mb-5">
      <div class="w-14 h-14 rounded-full border-2 border-brand-600 bg-brand-50 flex items-center justify-center flex-shrink-0">
        <span class="text-2xl font-bold text-brand-700">${count}</span>
      </div>
      <div>
        <p class="text-[17px] font-semibold text-zinc-900 leading-snug">
          ${count} fő jelentkezett
        </p>
        <p class="text-[13px] text-zinc-500">${formatDateHuLong(date)}</p>
      </div>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
      ${cards}
    </div>
  `;
}

function renderAttendeeCard(name: string): string {
  const initials = getInitials(name);
  const { bg, text } = getAvatarColor(name);
  return `
    <div class="flex items-center gap-2 px-2.5 py-2 bg-white rounded-xl border border-zinc-200 shadow-sm">
      <div class="w-7 h-7 rounded-full ${bg} flex items-center justify-center flex-shrink-0">
        <span class="text-[10px] font-semibold ${text}">${escapeHtml(initials)}</span>
      </div>
      <span class="text-[12px] font-medium text-zinc-800 truncate">${escapeHtml(name)}</span>
    </div>
  `;
}

function renderEmptyState(date: string): string {
  return `
    <div class="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div class="w-16 h-16 rounded-2xl bg-zinc-100 flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-zinc-400" fill="none"
             viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div>
        <p class="text-[16px] font-semibold text-zinc-700 mb-1">Még nincs jelentkező</p>
        <p class="text-[13px] text-zinc-400">${formatDateHuLong(date)}</p>
        <p class="text-[13px] text-zinc-400 mt-0.5">Légy az első, aki jelzi részvételét!</p>
      </div>
    </div>
  `;
}

function renderCancelledState(date: string, cancelled?: CancelledSession): string {
  const reason = cancelled?.reason?.trim();
  return `
    <div class="bg-red-50 border border-red-200 rounded-2xl p-5 flex flex-col items-center text-center gap-3">
      <div class="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7 text-red-500" fill="none"
             viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008z" />
        </svg>
      </div>
      <div>
        <p class="text-[16px] font-semibold text-red-800 mb-1">Ez az alkalom elmarad</p>
        <p class="text-[13px] text-red-600">${formatDateHuLong(date)}</p>
        ${reason ? `<p class="text-[13px] text-red-500 mt-0.5">${escapeHtml(reason)}</p>` : ''}
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────
// Event handling
// ─────────────────────────────────────────────────────────────────────

function attachHandlers(container: HTMLElement, state: OverviewState) {
  const scroller = container.querySelector<HTMLDivElement>('#date-scroller')!;

  // Görgesés a kiválasztott gombhoz (látható legyen mount után)
  requestAnimationFrame(() => {
    const selectedBtn = scroller.querySelector<HTMLButtonElement>(
      `[data-date="${state.selected}"]`,
    );
    selectedBtn?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
  });

  // Dátum-gomb kattintás (event delegation)
  scroller.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.date-btn');
    if (!target) return;
    const date = target.dataset.date;
    if (!date || date === state.selected) return;
    state.selected = date;
    // Csak az érintett gombokat + a result szekciót frissítjük (DOM swap)
    scroller.innerHTML = state.dates
      .map((d) => renderDateButton(d, state))
      .join('');
    const resultEl = container.querySelector<HTMLElement>('#result-main')!;
    resultEl.innerHTML = renderResult(state);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
