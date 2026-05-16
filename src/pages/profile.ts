/**
 * 📊 Játékos Profil oldal — Claude Design implementáció.
 * Activity rings, hero kártya, stat grid, pénzügy, éves/havi chart, timeline.
 */

import { renderHeader } from '../components/header';
import { getAllMembers, getAttendanceForPlayer, getSettlementsForPlayer, type RawAttendance, type PlayerSettlementRow } from '../lib/firestore';
import { getAuthState } from '../lib/auth';
import { getInitials } from '../lib/avatar';
import { estimateCost, formatHuf } from '../lib/cost';
import { formatDateHuLong } from '../lib/dates';

interface ProfileSession { date: string; year: number; month: number; }

interface ProfileState {
  // Csak az aktuálisan kiválasztott játékos rekordjai — nem a teljes
  // attendance kollekció. Indexelt firestore query (where name == X).
  playerRecords: RawAttendance[];
  playerNames: string[];
  availableYears: number[];
  currentYear: number;
  currentMonth: number;
  selectedName: string;
  selectedYear: number;
  playerSessions: ProfileSession[];
  isAdmin: boolean;
  settlementRows: PlayerSettlementRow[];
  settlementsLoading: boolean;
  recordsLoading: boolean;
}

const MONTH_SHORT = ['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];

// ─── Avatar szín determinisztikusan névből ───
function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(h) % 360;
}

/** Hash-be ágyazott query string olvasása: pl. "#/profile?name=Kiss" → {name: "Kiss"} */
function readHashQuery(): URLSearchParams {
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  return new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '');
}

// ─── Belépési pont ───
export async function renderProfilePage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  // Player lista a members kollekcióból (~20 dokumentum) — sokkal gyorsabb mint
  // a teljes attendance scan-ből egyedi neveket képezni.
  const members = await getAllMembers();
  const playerNames = uniqueSorted(members.map((m) => m.name));
  if (playerNames.length === 0) {
    container.querySelector<HTMLElement>('#profile-body')!.innerHTML = renderEmptyState();
    return;
  }

  // URL-ből érkező név preselect (pl. Alkalmak oldalról linkkel)
  const queryName = readHashQuery().get('name');
  const initialName = queryName && playerNames.includes(queryName) ? queryName : playerNames[0];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const state: ProfileState = {
    playerRecords: [],
    playerNames,
    availableYears: [currentYear],
    currentYear, currentMonth,
    selectedName: initialName,
    selectedYear: currentYear,
    playerSessions: [],
    isAdmin: getAuthState().isAdmin,
    settlementRows: [],
    settlementsLoading: false,
    recordsLoading: true,
  };
  // Initial render with loading state for the player section
  container.innerHTML = renderShell(renderBody(state));
  attachHandlers(container, state);

  // Background: a kiválasztott játékos rekordjainak betöltése
  loadPlayerRecords(container, state);
  if (state.isAdmin) loadSettlementsForPlayer(container, state);
}

/**
 * A kiválasztott játékos jelenléti rekordjait tölti be indexelt query-vel
 * (where name == X). Sokkal gyorsabb mint a teljes attendance kollekció.
 * Az availableYears-t is az adott játékos rekordjaiból építi.
 */
function loadPlayerRecords(container: HTMLElement, state: ProfileState) {
  const name = state.selectedName;
  state.recordsLoading = true;
  getAttendanceForPlayer(name)
    .then((records) => {
      if (state.selectedName !== name) return; // stale: player változott közben
      state.playerRecords = records;
      // Csak az aktuális player éveiből építjük az év-választót
      const years = uniqueSorted(
        records.filter((r) => r.status === 'Yes' && r.event_date)
          .map((r) => Number(r.event_date.slice(0, 4))).filter(Number.isFinite).map(String),
      ).map(Number).sort((a, b) => b - a);
      state.availableYears = years.length ? years : [state.currentYear];
      if (!state.availableYears.includes(state.selectedYear)) {
        state.selectedYear = state.availableYears.includes(state.currentYear)
          ? state.currentYear
          : state.availableYears[0];
      }
      state.recordsLoading = false;
      recomputePlayerSessions(state);
      const body = container.querySelector<HTMLElement>('#profile-body');
      if (body) { body.innerHTML = renderBody(state); attachHandlers(container, state); }
    })
    .catch(() => { state.recordsLoading = false; });
}

// ─── Shell ───
function renderShell(body: string): string {
  return `
    <div class="device">
      ${renderHeader('profile')}
      <main id="profile-body">${body}</main>
    </div>`;
}

function renderLoadingBody(): string {
  return `
    <div class="px-5 pt-5 space-y-4">
      <div class="h-12 rounded-2xl animate-pulse" style="background:var(--line)"></div>
      <div class="h-36 rounded-[28px] animate-pulse" style="background:var(--line)"></div>
      <div class="grid grid-cols-2 gap-2.5">
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
      </div>
      <div class="h-48 rounded-[24px] animate-pulse" style="background:var(--line)"></div>
    </div>`;
}

function renderEmptyState(): string {
  return `
    <div class="flex flex-col items-center justify-center py-20 px-6 text-center gap-3">
      <div class="w-16 h-16 rounded-2xl flex items-center justify-center" style="background:var(--line)">
        <span class="text-2xl">👥</span>
      </div>
      <p class="text-[16px] font-semibold text-fg-1">Nincs még játékos</p>
      <p class="text-[13px] text-fg-3">Először regisztrálj egy alkalomra!</p>
    </div>`;
}

// ─── Body ───
function renderBody(state: ProfileState): string {
  return `
    <div class="px-5 pt-5 pb-12 space-y-5">
      ${renderSelectors(state)}
      ${renderHeroRings(state)}
      ${renderStatGrid(state)}
      ${renderFinancial(state)}
      ${renderYearlyChart(state)}
      ${renderMonthlyChart(state)}
      ${renderRecent(state)}
    </div>`;
}

// ─── Selectors ───
function renderSelectors(state: ProfileState): string {
  const nameOpts = state.playerNames
    .map((n) => `<option value="${ea(n)}" ${n === state.selectedName ? 'selected' : ''}>${eh(n)}</option>`)
    .join('');
  const yearOpts = state.availableYears
    .map((y) => `<option value="${y}" ${y === state.selectedYear ? 'selected' : ''}>${y}</option>`)
    .join('');
  return `
    <div class="grid grid-cols-[1fr_auto] gap-2.5 fade-up">
      <label class="flex flex-col gap-1.5">
        <span class="eyebrow">Játékos</span>
        <select id="player-select"
          class="select-native w-full rounded-[14px] border px-3.5 py-3 text-[15px] font-medium text-fg-1 focus:outline-none"
          style="border-color:var(--line-strong); background:var(--bg-card)">
          ${nameOpts}
        </select>
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="eyebrow">Év</span>
        <select id="year-select"
          class="select-native rounded-[14px] border px-3.5 py-3 text-[15px] font-medium text-fg-1 focus:outline-none"
          style="border-color:var(--line-strong); background:var(--bg-card)">
          ${yearOpts}
        </select>
      </label>
    </div>`;
}

// ─── Hero + Activity Rings ───
function renderHeroRings(state: ProfileState): string {
  const total = state.playerSessions.length;
  const yearCount = state.playerSessions.filter((s) => s.year === state.selectedYear).length;
  const monthCount = state.playerSessions.filter(
    (s) => s.year === state.currentYear && s.month === state.currentMonth
  ).length;

  const yearGoal = 40; const monthGoal = 4; const careerGoal = 100;
  const cp = Math.min(1, total / careerGoal);
  const yp = Math.min(1, yearCount / yearGoal);
  const mp = Math.min(1, monthCount / monthGoal);

  const initials = getInitials(state.selectedName);
  const hue = avatarHue(state.selectedName);

  const ring = (size: number, stroke: number, progress: number, color: string, delay: number, offset: number) => {
    const r = (size - stroke) / 2 - offset;
    const c = 2 * Math.PI * r;
    const dash = c * progress;
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="absolute inset-0">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="${stroke}" class="ring-track" stroke-linecap="round"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
          stroke-linecap="round"
          stroke-dasharray="${dash} ${c}"
          transform="rotate(-90 ${size/2} ${size/2})"
          class="ring-arc"
          style="--from-offset:${c};--to-offset:0;animation-delay:${delay}ms;stroke-dashoffset:0"/>
      </svg>`;
  };

  const ringStat = (color: string, label: string, value: number, sub: string, border = false) => `
    <div class="px-3 py-3 ${border ? 'border-l border-r' : ''}" style="border-color:var(--line)">
      <div class="flex items-center gap-1.5 mb-1">
        <span class="w-1.5 h-1.5 rounded-full" style="background:${color}"></span>
        <span class="eyebrow text-[10px]">${label}</span>
      </div>
      <p class="leading-none">
        <span class="font-mono-tnum font-semibold text-[20px] text-fg-1 num-display">${value}</span>
        <span class="font-mono-tnum text-[11px] text-fg-3 ml-1">${sub}</span>
      </p>
    </div>`;

  return `
    <section class="relative fade-up" style="animation-delay:40ms">
      <div class="halo"></div>
      <div class="relative card noise lift overflow-hidden" style="border-radius:28px">
        <div class="relative p-5 flex items-center gap-5">
          <div class="relative flex-shrink-0" style="width:124px;height:124px">
            ${ring(124, 9, cp, 'var(--hue-ring-1)', 0,   0)}
            ${ring(102, 9, yp, 'var(--hue-ring-2)', 120, 11)}
            ${ring(80,  9, mp, 'var(--hue-ring-3)', 240, 22)}
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="w-[54px] h-[54px] rounded-full flex items-center justify-center font-semibold text-[18px]"
                   style="background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
                ${eh(initials)}
              </div>
            </div>
          </div>
          <div class="flex-1 min-w-0">
            <p class="eyebrow mb-1">Játékos · ${state.selectedYear}</p>
            <h1 class="text-[26px] font-bold tracking-tight leading-[1.05] text-fg-1 truncate">${eh(state.selectedName)}</h1>
            <p class="text-[13px] text-fg-2 mt-1.5">
              <span class="font-mono-tnum font-semibold text-fg-1">${total}</span> alkalom összesen
            </p>
          </div>
        </div>
        <div class="grid grid-cols-3 border-t hairline">
          ${ringStat('var(--hue-ring-1)', 'Karrier', total,      `/ ${careerGoal}`)}
          ${ringStat('var(--hue-ring-2)', 'Idei év', yearCount,  `/ ${yearGoal}`, true)}
          ${ringStat('var(--hue-ring-3)', 'Ez a hó', monthCount, `/ ${monthGoal}`)}
        </div>
      </div>
    </section>`;
}

// ─── Stat Grid ───
function renderStatGrid(state: ProfileState): string {
  const total      = state.playerSessions.length;
  const thisYear   = state.playerSessions.filter((s) => s.year === state.currentYear).length;
  const thisMonth  = state.playerSessions.filter(
    (s) => s.year === state.currentYear && s.month === state.currentMonth
  ).length;
  const selYear    = state.playerSessions.filter((s) => s.year === state.selectedYear).length;
  const monthLabel = `${state.currentYear}/${String(state.currentMonth).padStart(2,'0')}`;

  const TONE: Record<string,{dot:string;tint:string}> = {
    red:     { dot:'#ef4444', tint:'rgba(239,68,68,0.10)' },
    amber:   { dot:'#f59e0b', tint:'rgba(245,158,11,0.10)' },
    emerald: { dot:'#10b981', tint:'rgba(16,185,129,0.10)' },
    violet:  { dot:'#8b5cf6', tint:'rgba(139,92,246,0.10)' },
  };

  const card = (label: string, value: number, tone: string) => {
    const t = TONE[tone];
    return `
      <div class="card relative p-3.5 overflow-hidden lift">
        <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:${t.tint};filter:blur(8px)"></div>
        <div class="relative flex items-center justify-between mb-3">
          <span class="eyebrow text-[10px] truncate">${label}</span>
          <span class="w-1.5 h-1.5 rounded-full" style="background:${t.dot}"></span>
        </div>
        <p class="relative font-mono-tnum font-semibold text-[28px] leading-none num-display text-fg-1">${value}</p>
      </div>`;
  };

  return `
    <section class="fade-up" style="animation-delay:80ms">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        ${card('Összes', total, 'red')}
        ${card(String(state.currentYear), thisYear, 'amber')}
        ${card(monthLabel, thisMonth, 'emerald')}
        ${card(String(state.selectedYear), selYear, 'violet')}
      </div>
    </section>`;
}

// ─── Financial ───
function renderFinancial(state: ProfileState): string {
  const yearCount = state.playerSessions.filter((s) => s.year === state.selectedYear).length;
  if (yearCount === 0) return '';

  const est = estimateCost(yearCount, state.selectedYear);

  const settlementsSection = state.isAdmin ? renderSettlementsTable(state) : '';

  return `
    <section class="fade-up" style="animation-delay:120ms">
      <div class="flex items-end justify-between mb-3">
        <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Pénzügy</h2>
        <span class="eyebrow">${state.selectedYear}</span>
      </div>
      <div class="card relative p-5 overflow-hidden lift" style="border-radius:24px">
        <div class="absolute inset-0 opacity-90"
             style="background:radial-gradient(120% 80% at 90% 0%,rgba(56,189,248,0.18) 0%,transparent 60%)"></div>
        <div class="relative">
          <div class="flex items-center justify-between">
            <span class="eyebrow">Becsült összeg</span>
            <span class="text-[10px] font-mono-tnum text-fg-3">${est.hourlyRate.toLocaleString('hu-HU')} Ft/h · ${est.duration}h · ${Math.round(est.avgAttendees)} fő</span>
          </div>
          <p class="font-mono-tnum num-display font-semibold text-[44px] leading-none mt-2 text-fg-1">
            ~${formatHuf(est.precise)}
          </p>
          <p class="text-[12px] text-fg-2 mt-2 font-mono-tnum">
            ${formatHuf(est.costPerSessionPrecise)} / alkalom · ${yearCount} alkalom
          </p>
          <div class="mt-4 pt-4 border-t hairline flex items-center justify-between">
            <div>
              <p class="eyebrow text-[10px] mb-0.5">Egyszerű becslés</p>
              <p class="text-[11px] text-fg-3 font-mono-tnum">2 300 Ft × ${yearCount}</p>
            </div>
            <p class="font-mono-tnum font-semibold text-[18px] num-display text-fg-1">${formatHuf(est.simple)}</p>
          </div>
        </div>
      </div>
      ${settlementsSection}
    </section>`;
}

function renderSettlementsTable(state: ProfileState): string {
  if (state.settlementsLoading) {
    return `
      <div class="mt-3 card p-4 flex items-center gap-3" style="border-radius:20px">
        <div class="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0" style="border-color:var(--accent) var(--line) var(--line) var(--line)"></div>
        <span class="text-[12px] text-fg-3">Elszámolások betöltése…</span>
      </div>`;
  }

  if (state.settlementRows.length === 0) {
    return `
      <div class="mt-3 card-soft p-4 text-center" style="border-radius:20px">
        <p class="text-[12px] text-fg-3">Nincs mentett elszámolás erre a játékosra.</p>
      </div>`;
  }

  const totalCount = state.settlementRows.reduce((s, r) => s + r.count, 0);
  const totalAmount = state.settlementRows.reduce((s, r) => s + r.amount, 0);

  const rows = state.settlementRows.map((r, i) => {
    const isSelected = r.year === state.selectedYear;
    return `
      <tr style="${i > 0 ? 'border-top:1px solid var(--line)' : ''}${isSelected ? ';background:color-mix(in oklab,var(--accent) 6%,transparent)' : ''}">
        <td class="px-3 py-2 text-[11.5px] font-mono-tnum ${isSelected ? 'font-semibold text-fg-1' : 'text-fg-2'}">${r.year}. ${r.monthName}</td>
        <td class="px-3 py-2 text-[11.5px] font-mono-tnum text-right ${isSelected ? 'font-semibold text-fg-1' : 'text-fg-2'}">${r.count}</td>
        <td class="px-3 py-2 text-[11.5px] font-mono-tnum text-right ${isSelected ? 'font-semibold text-fg-1' : 'text-fg-2'}">${formatHuf(r.amount)}</td>
      </tr>`;
  }).join('');

  return `
    <div class="mt-3 card overflow-hidden" style="border-radius:20px">
      <div class="px-3 py-2.5 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
        <span class="eyebrow text-[10px]">Mentett elszámolások</span>
        <span class="text-[10px] font-mono-tnum text-fg-3">${state.settlementRows.length} hónap</span>
      </div>
      <table class="w-full">
        <thead>
          <tr style="border-bottom:1px solid var(--line)">
            <th class="px-3 py-2 text-left eyebrow text-[9px]">Hónap</th>
            <th class="px-3 py-2 text-right eyebrow text-[9px]">Alkalom</th>
            <th class="px-3 py-2 text-right eyebrow text-[9px]">Összeg</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--line-strong)">
            <td class="px-3 py-2 text-[11px] font-semibold text-fg-1">Összesen</td>
            <td class="px-3 py-2 text-[11px] font-mono-tnum font-semibold text-fg-1 text-right">${totalCount}</td>
            <td class="px-3 py-2 text-[11px] font-mono-tnum font-semibold text-fg-1 text-right">${formatHuf(totalAmount)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

// ─── Éves Chart ───
function renderYearlyChart(state: ProfileState): string {
  const byYear = new Map<number, number>();
  for (const s of state.playerSessions) byYear.set(s.year, (byYear.get(s.year) ?? 0) + 1);
  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (years.length === 0) return chartEmpty('Éves összesítő', 'Nincs még részvétel.');
  const max = Math.max(...byYear.values());
  const BAR = 140;

  const bars = years.map((y, i) => {
    const v = byYear.get(y) ?? 0;
    const h = Math.max(8, Math.round((v / max) * BAR));
    const sel = y === state.selectedYear;
    return `
      <div class="flex-1 flex flex-col items-center gap-2 min-w-0">
        <span class="font-mono-tnum text-[12px] ${sel ? 'font-semibold text-fg-1' : 'text-fg-2'}">${v}</span>
        <div class="w-full max-w-[52px] relative">
          <div class="bar-fill w-full rounded-t-[10px] ${sel ? 'bar-brand' : ''}"
               style="height:${h}px;animation-delay:${i*80}ms;${sel ? '' : 'background:color-mix(in oklab,var(--line-strong) 70%,transparent)'}"></div>
        </div>
        <span class="text-[11px] font-mono-tnum ${sel ? 'font-semibold text-fg-1' : 'text-fg-3'}">${y}</span>
      </div>`;
  }).join('');

  return `
    <section class="fade-up" style="animation-delay:160ms">
      <div class="flex items-end justify-between mb-3">
        <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Éves összesítő</h2>
        <span class="eyebrow">${years[0]}–${years[years.length-1]}</span>
      </div>
      <div class="card p-5" style="border-radius:24px">
        <div class="flex items-end gap-4" style="min-height:${BAR+44}px">${bars}</div>
      </div>
    </section>`;
}

// ─── Havi Chart ───
function renderMonthlyChart(state: ProfileState): string {
  const byMonth = new Array(12).fill(0);
  for (const s of state.playerSessions) {
    if (s.year === state.selectedYear) byMonth[s.month - 1]++;
  }
  const max = Math.max(...byMonth);
  const total = byMonth.reduce((a, b) => a + b, 0);
  if (total === 0) return chartEmpty(`Havi bontás — ${state.selectedYear}`, `${state.selectedYear}-ben nincs részvétel.`);
  const BAR = 100;

  const bars = byMonth.map((v, i) => {
    const h = max > 0 ? Math.max(4, Math.round((v / max) * BAR)) : 4;
    const isCurrent = state.selectedYear === state.currentYear && i + 1 === state.currentMonth;
    const empty = v === 0;
    const cls = empty ? 'bar-empty' : isCurrent ? 'bar-brand' : 'bar-emerald';
    return `
      <div class="flex-1 flex flex-col items-center gap-1.5 min-w-0">
        <span class="text-[10px] font-mono-tnum ${empty ? 'text-fg-3 opacity-60' : 'font-semibold text-fg-1'}">${v || '·'}</span>
        <div class="bar-fill w-full max-w-[20px] rounded-t-[6px] ${cls}"
             style="height:${h}px;animation-delay:${i*40}ms"></div>
        <span class="text-[10px] text-fg-3">${MONTH_SHORT[i]}</span>
      </div>`;
  }).join('');

  return `
    <section class="fade-up" style="animation-delay:200ms">
      <div class="flex items-end justify-between mb-3">
        <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Havi bontás</h2>
        <span class="eyebrow">${state.selectedYear} · ${total} alkalom</span>
      </div>
      <div class="card p-5" style="border-radius:24px">
        <div class="flex items-end gap-1.5" style="min-height:${BAR+36}px">${bars}</div>
      </div>
    </section>`;
}

// ─── Recent Sessions ───
function renderRecent(state: ProfileState): string {
  if (state.playerSessions.length === 0) return chartEmpty('Utolsó alkalmak', 'Nincs még regisztrált alkalom.');
  const recent = state.playerSessions.slice(0, 10);

  const items = recent.map((s) => {
    const isCurrent = s.year === state.currentYear && s.month === state.currentMonth;
    const [,m,d] = s.date.split('-').map(Number);
    return `
      <li class="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hairline">
        <div class="w-11 h-11 rounded-[12px] flex flex-col items-center justify-center flex-shrink-0"
             style="background:${isCurrent ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'color-mix(in oklab,var(--fg-3) 12%,transparent)'}">
          <span class="eyebrow text-[8px]" style="${isCurrent ? 'color:var(--accent-ink)' : ''}">${MONTH_SHORT[m-1]}</span>
          <span class="font-mono-tnum font-semibold text-[15px] leading-none mt-0.5"
                style="${isCurrent ? 'color:var(--accent-ink)' : 'color:var(--fg-1)'}">${d}</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[14px] font-medium text-fg-1">${eh(formatDateHuLong(s.date))}</p>
          <p class="text-[11px] text-fg-3 font-mono-tnum">${s.year} · ${String(m).padStart(2,'0')}. hónap</p>
        </div>
        <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style="background:rgba(16,185,129,0.12);color:#047857">✓ Részt vett</span>
      </li>`;
  }).join('');

  return `
    <section class="fade-up" style="animation-delay:240ms">
      <div class="flex items-end justify-between mb-3">
        <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Utolsó ${recent.length} alkalom</h2>
        <a href="#/" class="text-[12px] font-medium" style="color:var(--accent)">Összes →</a>
      </div>
      <div class="card overflow-hidden" style="border-radius:24px">
        <ol>${items}</ol>
      </div>
    </section>`;
}

function chartEmpty(title: string, msg: string): string {
  return `
    <section class="fade-up">
      <h2 class="text-[20px] font-semibold tracking-tight text-fg-1 mb-3">${title}</h2>
      <div class="card-soft p-5 text-center" style="border-radius:24px">
        <p class="text-[14px] text-fg-3">${msg}</p>
      </div>
    </section>`;
}

// ─── Computations ───
function recomputePlayerSessions(state: ProfileState) {
  const seen = new Set<string>();
  const sessions: ProfileSession[] = [];
  for (const r of state.playerRecords) {
    if (r.status !== 'Yes' || !r.event_date) continue;
    if (seen.has(r.event_date)) continue;
    seen.add(r.event_date);
    const [y, m] = r.event_date.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
    sessions.push({ date: r.event_date, year: y, month: m });
  }
  sessions.sort((a, b) => b.date.localeCompare(a.date));
  state.playerSessions = sessions;
}

function loadSettlementsForPlayer(container: HTMLElement, state: ProfileState) {
  const name = state.selectedName;
  state.settlementRows = [];
  state.settlementsLoading = true;
  const body = container.querySelector<HTMLElement>('#profile-body');
  if (body) { body.innerHTML = renderBody(state); attachHandlers(container, state); }
  getSettlementsForPlayer(name)
    .then((rows) => {
      if (state.selectedName !== name) return; // player changed — discard stale result
      state.settlementRows = rows;
      state.settlementsLoading = false;
      const b = container.querySelector<HTMLElement>('#profile-body');
      if (b) { b.innerHTML = renderBody(state); attachHandlers(container, state); }
    })
    .catch(() => { state.settlementsLoading = false; });
}

function attachHandlers(container: HTMLElement, state: ProfileState) {
  const playerSel = container.querySelector<HTMLSelectElement>('#player-select')!;
  const yearSel   = container.querySelector<HTMLSelectElement>('#year-select')!;
  const body      = container.querySelector<HTMLElement>('#profile-body')!;

  const refresh = () => {
    recomputePlayerSessions(state);
    body.innerHTML = renderBody(state);
    attachHandlers(container, state);
  };

  playerSel.addEventListener('change', () => {
    state.selectedName = playerSel.value;
    // Üres playerRecords-zal indítjuk a refresh-t, hogy ne mutasson stale adatot.
    state.playerRecords = [];
    state.playerSessions = [];
    state.recordsLoading = true;
    refresh();
    loadPlayerRecords(container, state);
    if (state.isAdmin) loadSettlementsForPlayer(container, state);
  });
  yearSel.addEventListener('change', () => { state.selectedYear = Number(yearSel.value); refresh(); });
}

// ─── Utils ───
function uniqueSorted(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'hu'));
}
function eh(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function ea(s: string): string { return eh(s); }
