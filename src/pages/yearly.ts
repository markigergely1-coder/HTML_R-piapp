/**
 * 📊 Éves Statisztikák — publikus.
 * Évenként összesített adatok: alkalmak száma, átlag létszám, havi bontás,
 * legtöbbet részt vevő játékos.
 */

import { renderHeader } from '../components/header';
import { getAllAttendanceRecords, type RawAttendance } from '../lib/firestore';
import { getInitials } from '../lib/avatar';

const MONTH_SHORT = ['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];

interface YearStats {
  year: number;
  sessions: number;
  totalAttendees: number;
  avgAttendees: number;
  byMonth: number[];    // sessions per month [0..11]
  topPlayer: string;
  topPlayerCount: number;
}

interface YearlyState {
  records: RawAttendance[];
  yearStats: YearStats[];
  allTimeSessions: number;
  allTimePlayers: number;
}

export async function renderYearlyPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());
  const records = await getAllAttendanceRecords();
  const state = buildState(records);
  container.innerHTML = renderShell(renderBody(state));
}

function buildState(records: RawAttendance[]): YearlyState {
  const yes = records.filter((r) => r.status === 'Yes' && r.event_date);

  // All-time stats
  const allTimeSessions = new Set(yes.map((r) => r.event_date)).size;
  const allTimePlayers = new Set(yes.map((r) => r.name)).size;

  // Per-year stats
  const byYear = new Map<number, { dates: Set<string>; countByDate: Map<string, number>; playerCounts: Map<string, number> }>();
  for (const r of yes) {
    const y = Number(r.event_date.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    if (!byYear.has(y)) byYear.set(y, { dates: new Set(), countByDate: new Map(), playerCounts: new Map() });
    const s = byYear.get(y)!;
    s.dates.add(r.event_date);
    s.countByDate.set(r.event_date, (s.countByDate.get(r.event_date) ?? 0) + 1);
    s.playerCounts.set(r.name, (s.playerCounts.get(r.name) ?? 0) + 1);
  }

  const yearStats: YearStats[] = [...byYear.entries()]
    .map(([year, s]) => {
      const sessions = s.dates.size;
      const totalAttendees = [...s.countByDate.values()].reduce((a, b) => a + b, 0);
      const avgAttendees = sessions > 0 ? Math.round(totalAttendees / sessions) : 0;
      const byMonth = new Array(12).fill(0);
      for (const d of s.dates) {
        const m = Number(d.slice(5, 7));
        if (m >= 1 && m <= 12) byMonth[m - 1]++;
      }
      let topPlayer = ''; let topPlayerCount = 0;
      for (const [name, count] of s.playerCounts) {
        if (count > topPlayerCount) { topPlayer = name; topPlayerCount = count; }
      }
      return { year, sessions, totalAttendees, avgAttendees, byMonth, topPlayer, topPlayerCount };
    })
    .sort((a, b) => b.year - a.year);

  return { records, yearStats, allTimeSessions, allTimePlayers };
}

function renderShell(body: string): string {
  return `
    <div class="device">
      ${renderHeader('yearly')}
      <main>${body}</main>
    </div>`;
}

function renderLoadingBody(): string {
  return `
    <div class="px-5 pt-5 space-y-3">
      <div class="grid grid-cols-2 gap-2.5">
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
      </div>
      ${Array(4).fill(0).map(() => `<div class="h-32 rounded-[22px] animate-pulse" style="background:var(--line)"></div>`).join('')}
    </div>`;
}

function renderBody(state: YearlyState): string {
  if (state.yearStats.length === 0) {
    return `
      <div class="px-5 pt-12 text-center fade-up">
        <p class="text-[16px] font-semibold text-fg-1 mb-1">Nincs adat</p>
        <p class="text-[13px] text-fg-3">Még nincs rögzített részvétel.</p>
      </div>`;
  }

  const summaryCards = renderSummaryCards(state);
  const yearCards = state.yearStats.map((ys) => renderYearCard(ys)).join('');

  return `
    <div class="px-5 pt-5 pb-12 space-y-4 fade-up">
      ${summaryCards}
      ${yearCards}
    </div>`;
}

function renderSummaryCards(state: YearlyState): string {
  const card = (label: string, value: string | number, sub: string, tone: 'red' | 'sky' | 'emerald') => {
    const tones = {
      red:     { dot: 'var(--accent)',  tint: 'color-mix(in oklab,var(--accent) 10%,transparent)' },
      sky:     { dot: '#0ea5e9',        tint: 'rgba(14,165,233,0.10)' },
      emerald: { dot: '#10b981',        tint: 'rgba(16,185,129,0.10)' },
    };
    const t = tones[tone];
    return `
      <div class="card relative p-4 overflow-hidden lift">
        <div class="absolute -top-3 -right-3 w-16 h-16 rounded-full" style="background:${t.tint};filter:blur(10px)"></div>
        <div class="relative">
          <div class="flex items-center justify-between mb-2">
            <span class="eyebrow text-[10px]">${label}</span>
            <span class="w-1.5 h-1.5 rounded-full" style="background:${t.dot}"></span>
          </div>
          <p class="font-mono-tnum font-semibold text-[28px] leading-none num-display text-fg-1">${value}</p>
          <p class="text-[11px] text-fg-3 mt-1">${sub}</p>
        </div>
      </div>`;
  };

  const yearRange = state.yearStats.length > 1
    ? `${state.yearStats[state.yearStats.length - 1].year}–${state.yearStats[0].year}`
    : String(state.yearStats[0]?.year ?? '');

  return `
    <div class="grid grid-cols-2 gap-2.5">
      ${card('Összes alkalom', state.allTimeSessions, yearRange, 'red')}
      ${card('Egyedi játékos', state.allTimePlayers, 'összesen', 'sky')}
    </div>`;
}

function renderYearCard(ys: YearStats): string {
  const maxMonth = Math.max(...ys.byMonth, 1);
  const BAR = 48;
  const hue = avatarHue(ys.topPlayer);
  const initials = getInitials(ys.topPlayer);

  const miniBar = ys.byMonth.map((v, i) => {
    const h = v > 0 ? Math.max(2, Math.round((v / maxMonth) * BAR)) : 2;
    const cls = v === 0 ? 'bar-empty' : 'bar-emerald';
    return `
      <div class="flex-1 flex flex-col items-center gap-0.5 min-w-0">
        <div class="bar-fill w-full max-w-[14px] rounded-t-[4px] ${cls}" style="height:${h}px;animation-delay:${i*30}ms"></div>
        <span class="text-[8px] text-fg-3">${MONTH_SHORT[i]?.slice(0, 1)}</span>
      </div>`;
  }).join('');

  return `
    <div class="card p-4 fade-up" style="border-radius:22px">
      <div class="flex items-start justify-between mb-3">
        <div>
          <p class="font-mono-tnum font-semibold text-[26px] leading-none num-display text-fg-1">${ys.year}</p>
          <p class="eyebrow text-[10px] mt-1">${ys.sessions} alkalom · ~${ys.avgAttendees} fő / alkalom</p>
        </div>
        ${ys.topPlayer ? `
          <div class="flex items-center gap-2">
            <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[9px]"
                 style="width:28px;height:28px;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
              ${eh(initials)}
            </div>
            <div>
              <p class="text-[11px] font-semibold text-fg-1">${eh(ys.topPlayer)}</p>
              <p class="text-[10px] text-fg-3">${ys.topPlayerCount} alkalom</p>
            </div>
          </div>` : ''}
      </div>
      <div class="flex items-end gap-1" style="min-height:${BAR+14}px">${miniBar}</div>
    </div>`;
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
