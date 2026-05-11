/**
 * 📊 Játékos Profil oldal.
 * - Játékos + év kiválasztó
 * - Hero kártya (avatar + név + összegzés)
 * - 4 stat kártya
 * - Pénzügyi összesítő (becsült összegek)
 * - Éves bar chart (CSS-alapú)
 * - Havi bar chart (CSS-alapú)
 * - Utolsó 10 alkalom
 */

import { renderHeader } from '../components/header';
import { getAllAttendanceRecords, type RawAttendance } from '../lib/firestore';
import { getInitials, getAvatarColor } from '../lib/avatar';
import { estimateCost, formatHuf, formatNumber } from '../lib/cost';
import { formatDateHuLong } from '../lib/dates';

interface ProfileSession {
  date: string;
  year: number;
  month: number;
}

interface ProfileState {
  allRecords: RawAttendance[];
  playerNames: string[];
  availableYears: number[];
  currentYear: number;
  currentMonth: number;
  selectedName: string;
  selectedYear: number;
  playerSessions: ProfileSession[];
}

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Már', 'Ápr', 'Máj', 'Jún',
  'Júl', 'Aug', 'Szep', 'Okt', 'Nov', 'Dec',
];

// ─────────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────────

export async function renderProfilePage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const allRecords = await getAllAttendanceRecords();
  const playerNames = uniqueSorted(allRecords.map((r) => r.name));
  if (playerNames.length === 0) {
    container.querySelector<HTMLElement>('#profile-body')!.innerHTML = renderEmptyAllState();
    return;
  }

  // Elérhető évek a Yes records dátumából
  const availableYears = uniqueSorted(
    allRecords
      .filter((r) => r.status === 'Yes' && r.event_date)
      .map((r) => Number(r.event_date.slice(0, 4)))
      .filter((y) => Number.isFinite(y))
      .map(String),
  )
    .map(Number)
    .sort((a, b) => b - a);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const state: ProfileState = {
    allRecords,
    playerNames,
    availableYears: availableYears.length ? availableYears : [currentYear],
    currentYear,
    currentMonth,
    selectedName: playerNames[0],
    selectedYear: availableYears.includes(currentYear) ? currentYear : availableYears[0] || currentYear,
    playerSessions: [],
  };

  recomputePlayerSessions(state);

  // Render selectors header, then body
  container.innerHTML = renderShell(renderBody(state));
  attachHandlers(container, state);
}

// ─────────────────────────────────────────────────────────────────────
// Page shell + loading
// ─────────────────────────────────────────────────────────────────────

function renderShell(body: string): string {
  return `
    <div class="bg-zinc-50 min-h-screen pb-12">
      <div class="max-w-md mx-auto">
        ${renderHeader('profile')}
        <main id="profile-body">${body}</main>
      </div>
    </div>
  `;
}

function renderLoadingBody(): string {
  return `
    <div class="px-4 py-6 space-y-4">
      <div class="h-12 bg-zinc-100 rounded-2xl animate-pulse"></div>
      <div class="h-24 bg-zinc-100 rounded-2xl animate-pulse"></div>
      <div class="grid grid-cols-2 gap-2">
        <div class="h-20 bg-zinc-100 rounded-2xl animate-pulse"></div>
        <div class="h-20 bg-zinc-100 rounded-2xl animate-pulse"></div>
        <div class="h-20 bg-zinc-100 rounded-2xl animate-pulse"></div>
        <div class="h-20 bg-zinc-100 rounded-2xl animate-pulse"></div>
      </div>
      <div class="h-40 bg-zinc-100 rounded-2xl animate-pulse"></div>
      <div class="h-56 bg-zinc-100 rounded-2xl animate-pulse"></div>
      <div class="h-56 bg-zinc-100 rounded-2xl animate-pulse"></div>
    </div>
  `;
}

function renderEmptyAllState(): string {
  return `
    <div class="flex flex-col items-center justify-center py-20 px-6 text-center gap-3">
      <div class="w-16 h-16 rounded-2xl bg-zinc-100 flex items-center justify-center">
        <span class="text-2xl">👥</span>
      </div>
      <p class="text-[16px] font-semibold text-zinc-700">Nincs még játékos</p>
      <p class="text-[13px] text-zinc-500">Először regisztrálj egy alkalomra!</p>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────
// Body — kiválasztó + szekciók
// ─────────────────────────────────────────────────────────────────────

function renderBody(state: ProfileState): string {
  return `
    <div class="px-4 py-5 space-y-5">
      ${renderSelectors(state)}
      ${renderHero(state)}
      ${renderStats(state)}
      ${renderFinancialCard(state)}
      ${renderYearlyChart(state)}
      ${renderMonthlyChart(state)}
      ${renderRecent(state)}
    </div>
  `;
}

function renderSelectors(state: ProfileState): string {
  const nameOptions = state.playerNames
    .map((n) => `<option value="${escapeAttr(n)}" ${n === state.selectedName ? 'selected' : ''}>${escapeHtml(n)}</option>`)
    .join('');
  const yearOptions = state.availableYears
    .map((y) => `<option value="${y}" ${y === state.selectedYear ? 'selected' : ''}>${y}</option>`)
    .join('');

  return `
    <div class="grid grid-cols-[1fr_auto] gap-2">
      <label class="block">
        <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">👤 Játékos</span>
        <select id="player-select"
          class="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-[14px] font-medium text-zinc-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
          ${nameOptions}
        </select>
      </label>
      <label class="block">
        <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">📅 Év</span>
        <select id="year-select"
          class="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-[14px] font-medium text-zinc-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
          ${yearOptions}
        </select>
      </label>
    </div>
  `;
}

function renderHero(state: ProfileState): string {
  const total = state.playerSessions.length;
  const { bg, text } = getAvatarColor(state.selectedName);
  const initials = getInitials(state.selectedName);
  return `
    <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 flex items-center gap-4">
      <div class="w-16 h-16 rounded-full ${bg} flex items-center justify-center flex-shrink-0">
        <span class="text-xl font-bold ${text}">${escapeHtml(initials)}</span>
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-[18px] font-bold text-zinc-900 truncate">${escapeHtml(state.selectedName)}</p>
        <p class="text-[13px] text-zinc-500 mt-0.5">
          ${total > 0 ? `Összesen <span class="font-semibold text-zinc-700">${total}</span> alkalmon vett részt` : 'Még nincs részvétele'}
        </p>
      </div>
    </div>
  `;
}

function renderStats(state: ProfileState): string {
  const total = state.playerSessions.length;
  const thisYearCount = state.playerSessions.filter((s) => s.year === state.currentYear).length;
  const thisMonthCount = state.playerSessions.filter(
    (s) => s.year === state.currentYear && s.month === state.currentMonth,
  ).length;
  const yearCount = state.playerSessions.filter((s) => s.year === state.selectedYear).length;

  const monthLabel = `${state.currentYear}/${String(state.currentMonth).padStart(2, '0')}`;

  const cards = [
    { icon: '🏆', label: 'Összes', value: total, accent: 'brand' },
    { icon: '📅', label: `${state.currentYear}`, value: thisYearCount, accent: 'sky' },
    { icon: '🗓️', label: monthLabel, value: thisMonthCount, accent: 'emerald' },
    { icon: '📌', label: `${state.selectedYear}`, value: yearCount, accent: 'violet' },
  ];

  const accentClass = (a: string) =>
    ({
      brand: 'bg-brand-50 text-brand-700',
      sky: 'bg-sky-50 text-sky-700',
      emerald: 'bg-emerald-50 text-emerald-700',
      violet: 'bg-violet-50 text-violet-700',
    })[a] ?? 'bg-zinc-50 text-zinc-700';

  return `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      ${cards
        .map(
          (c) => `
        <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-3.5">
          <div class="flex items-center gap-2 mb-2">
            <span class="w-7 h-7 rounded-lg flex items-center justify-center text-sm ${accentClass(c.accent)}">${c.icon}</span>
            <span class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider truncate">${c.label}</span>
          </div>
          <p class="text-[24px] font-bold text-zinc-900 leading-none">${c.value}</p>
        </div>`,
        )
        .join('')}
    </div>
  `;
}

function renderFinancialCard(state: ProfileState): string {
  const yearCount = state.playerSessions.filter((s) => s.year === state.selectedYear).length;
  if (yearCount === 0) {
    return `
      <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
        <h2 class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">💰 Pénzügy — ${state.selectedYear}</h2>
        <div class="text-center py-6 text-[13px] text-zinc-400">
          ${state.selectedYear}-ben nincs részvétele — nincs számolnivaló.
        </div>
      </div>
    `;
  }

  const est = estimateCost(yearCount, state.selectedYear);
  return `
    <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div class="px-5 pt-5 pb-3">
        <h2 class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">💰 Becsült fizetendő — ${state.selectedYear}</h2>
      </div>
      <!-- Precise -->
      <div class="px-5 pb-4">
        <div class="bg-gradient-to-br from-sky-50 to-sky-100/50 border border-sky-200 rounded-xl p-4">
          <div class="flex items-baseline justify-between mb-1">
            <span class="text-[11px] font-semibold text-sky-700 uppercase tracking-wider">Pontosabb becslés</span>
            <span class="text-[10px] text-sky-600/80">${formatNumber(est.hourlyRate)} Ft/h · ${est.duration}h · ${est.avgAttendees.toFixed(0)} fő</span>
          </div>
          <p class="text-[28px] font-bold text-sky-900 leading-tight">${formatHuf(est.precise)}</p>
          <p class="text-[11px] text-sky-700/70 mt-1">
            ≈ ${formatHuf(est.costPerSessionPrecise)} / alkalom · ${yearCount} alkalom
          </p>
        </div>
      </div>
      <!-- Simple -->
      <div class="px-5 pb-5">
        <div class="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3">
          <div class="flex items-baseline justify-between">
            <div>
              <p class="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Egyszerű becslés</p>
              <p class="text-[10px] text-emerald-600/70">2 300 Ft × ${yearCount} alkalom</p>
            </div>
            <p class="text-[20px] font-bold text-emerald-700">${formatHuf(est.simple)}</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderYearlyChart(state: ProfileState): string {
  // Year → count
  const byYear = new Map<number, number>();
  for (const s of state.playerSessions) {
    byYear.set(s.year, (byYear.get(s.year) ?? 0) + 1);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (years.length === 0) {
    return chartCardEmpty('📈 Éves összesítő', 'Nincs még részvétel.');
  }
  const max = Math.max(...byYear.values());
  const BAR_AREA = 140; // px

  const bars = years
    .map((y) => {
      const count = byYear.get(y) ?? 0;
      const h = max > 0 ? Math.max(4, Math.round((count / max) * BAR_AREA)) : 4;
      const isSelected = y === state.selectedYear;
      const barColor = isSelected ? 'bg-brand-500' : 'bg-brand-300';
      return `
        <div class="flex flex-col items-center gap-1.5 flex-1 min-w-0">
          <span class="text-[11px] font-bold ${isSelected ? 'text-brand-700' : 'text-zinc-600'}">${count}</span>
          <div class="w-full max-w-[44px] rounded-t-lg ${barColor} transition-all" style="height: ${h}px"></div>
          <span class="text-[11px] ${isSelected ? 'font-semibold text-brand-700' : 'text-zinc-500'}">${y}</span>
        </div>`;
    })
    .join('');

  return `
    <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
      <h2 class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-4">📈 Éves összesítő</h2>
      <div class="flex items-end gap-3 px-1" style="min-height: ${BAR_AREA + 36}px">
        ${bars}
      </div>
    </div>
  `;
}

function renderMonthlyChart(state: ProfileState): string {
  // Month → count for selected year
  const byMonth = new Array(12).fill(0);
  for (const s of state.playerSessions) {
    if (s.year === state.selectedYear) {
      byMonth[s.month - 1]++;
    }
  }
  const max = Math.max(...byMonth);
  const total = byMonth.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return chartCardEmpty(`🗂️ Havi bontás — ${state.selectedYear}`, `${state.selectedYear}-ben nincs részvétel.`);
  }
  const BAR_AREA = 110;

  const bars = MONTH_NAMES_SHORT.map((mn, i) => {
    const count = byMonth[i];
    const h = max > 0 ? Math.max(2, Math.round((count / max) * BAR_AREA)) : 2;
    const isCurrent =
      state.selectedYear === state.currentYear && i + 1 === state.currentMonth;
    const barColor =
      count === 0
        ? 'bg-zinc-200'
        : isCurrent
          ? 'bg-emerald-500'
          : 'bg-emerald-400';
    return `
      <div class="flex flex-col items-center gap-1 flex-1 min-w-0">
        <span class="text-[10px] font-bold ${count > 0 ? 'text-zinc-700' : 'text-zinc-300'}">${count}</span>
        <div class="w-full max-w-[22px] rounded-t-md ${barColor} transition-all" style="height: ${h}px"></div>
        <span class="text-[9px] text-zinc-500 truncate">${mn}</span>
      </div>`;
  }).join('');

  return `
    <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
      <h2 class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-4">🗂️ Havi bontás — ${state.selectedYear}</h2>
      <div class="flex items-end gap-1.5" style="min-height: ${BAR_AREA + 32}px">
        ${bars}
      </div>
    </div>
  `;
}

function chartCardEmpty(title: string, msg: string): string {
  return `
    <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
      <h2 class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">${title}</h2>
      <p class="text-center py-6 text-[13px] text-zinc-400">${msg}</p>
    </div>
  `;
}

function renderRecent(state: ProfileState): string {
  if (state.playerSessions.length === 0) {
    return chartCardEmpty('🕐 Utolsó alkalmak', 'Nincs még regisztrált alkalom.');
  }
  const recent = state.playerSessions.slice(0, 10); // already sorted desc
  const items = recent
    .map((s) => {
      const isCurrentMonth = s.year === state.currentYear && s.month === state.currentMonth;
      return `
        <li class="flex items-center gap-3 py-2.5 px-3 hover:bg-zinc-50 transition-colors">
          <div class="w-9 h-9 rounded-lg ${isCurrentMonth ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'} flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span class="text-[13px] font-medium text-zinc-800 flex-1">${escapeHtml(formatDateHuLong(s.date))}</span>
        </li>`;
    })
    .join('');

  return `
    <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <h2 class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-5 pt-5 pb-2">🕐 Utolsó ${recent.length} alkalom</h2>
      <ul class="divide-y divide-zinc-100">${items}</ul>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────
// Computations + handlers
// ─────────────────────────────────────────────────────────────────────

function recomputePlayerSessions(state: ProfileState) {
  const seen = new Set<string>();
  const sessions: ProfileSession[] = [];
  for (const r of state.allRecords) {
    if (r.name !== state.selectedName) continue;
    if (r.status !== 'Yes') continue;
    if (!r.event_date) continue;
    if (seen.has(r.event_date)) continue;
    seen.add(r.event_date);
    const [y, m] = r.event_date.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
    sessions.push({ date: r.event_date, year: y, month: m });
  }
  sessions.sort((a, b) => b.date.localeCompare(a.date)); // legújabb először
  state.playerSessions = sessions;
}

function attachHandlers(container: HTMLElement, state: ProfileState) {
  const playerSel = container.querySelector<HTMLSelectElement>('#player-select')!;
  const yearSel = container.querySelector<HTMLSelectElement>('#year-select')!;
  const body = container.querySelector<HTMLElement>('#profile-body')!;

  const refresh = () => {
    recomputePlayerSessions(state);
    body.innerHTML = renderBody(state);
    attachHandlers(container, state); // re-bind after innerHTML swap
  };

  playerSel.addEventListener('change', () => {
    state.selectedName = playerSel.value;
    refresh();
  });
  yearSel.addEventListener('change', () => {
    state.selectedYear = Number(yearSel.value);
    refresh();
  });
}

// ─────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────

function uniqueSorted(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'hu'));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
