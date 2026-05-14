/**
 * 🗂️ Adatbázis oldal — publikus.
 * Két fő szekció:
 *  - Ranglista (összes részvétel év szerint szűrve)
 *  - Jelenléti rekordok listája (kereshető)
 *
 * Mobile: stacked, Desktop: 2-oszlop (ranglista | rekordok)
 */

import { renderHeader } from '../components/header';
import { getAllAttendanceRecords, type RawAttendance } from '../lib/firestore';
import { getInitials } from '../lib/avatar';
import { formatDateHu } from '../lib/dates';

interface DbState {
  records: RawAttendance[];
  yearFilter: number | 'all';
  chartYear: number;
  recordFilter: string;
  recordSort: 'date_desc' | 'date_asc' | 'name';
}

const MONTH_SHORT = ['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderDatabasePage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const records = await getAllAttendanceRecords();
  const state: DbState = {
    records,
    yearFilter: 'all',
    chartYear: new Date().getFullYear(),
    recordFilter: '',
    recordSort: 'date_desc',
  };

  rerender(container, state);
}

// ─────────────────────────────────────────────────────────────────
// Shell + loading
// ─────────────────────────────────────────────────────────────────

function renderShell(body: string): string {
  return `
    <div class="device">
      ${renderHeader('database')}
      <main id="db-body">${body}</main>
    </div>`;
}

function renderLoadingBody(): string {
  return `
    <div class="px-5 pt-5 space-y-3">
      <div class="h-12 rounded-2xl animate-pulse" style="background:var(--line)"></div>
      <div class="grid grid-cols-3 gap-2.5">
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
      </div>
      ${Array(6).fill(0).map(() => `<div class="h-12 rounded-2xl animate-pulse" style="background:var(--line)"></div>`).join('')}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────

function renderBody(state: DbState): string {
  return `
    <div class="lg:grid lg:grid-cols-[400px_1fr] lg:gap-6 lg:p-6 lg:pt-5 lg:items-start">
      <!-- Ranglista (bal/sticky desktop, felül mobil) -->
      <aside class="lg:sticky lg:top-[110px] space-y-3 px-5 pt-5 lg:px-0 lg:pt-0">
        ${renderStats(state)}
        ${renderTeamStats(state)}
        ${renderChartsSection(state)}
        ${renderRanking(state)}
      </aside>

      <!-- Jelenléti rekordok -->
      <section class="px-5 pt-3 pb-12 lg:px-0 lg:pt-0 space-y-3">
        ${renderRecordControls(state)}
        ${renderRecordsList(state)}
      </section>
    </div>`;
}

// ─── Stat kártyák ───
function renderStats(state: DbState): string {
  const all = state.records.filter((r) => r.status === 'Yes').length;
  const uniqueNames = new Set(state.records.filter((r) => r.status === 'Yes').map((r) => r.name)).size;
  const uniqueDates = new Set(state.records.filter((r) => r.status === 'Yes' && r.event_date).map((r) => r.event_date)).size;

  const card = (label: string, value: number, tone: 'red' | 'sky' | 'emerald') => {
    const tones: Record<string, { dot: string; tint: string }> = {
      red:     { dot: 'var(--accent)',  tint: 'color-mix(in oklab,var(--accent) 10%,transparent)' },
      sky:     { dot: '#0ea5e9',        tint: 'rgba(14,165,233,0.10)' },
      emerald: { dot: '#10b981',        tint: 'rgba(16,185,129,0.10)' },
    };
    const t = tones[tone];
    return `
      <div class="card relative p-3.5 overflow-hidden lift">
        <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:${t.tint};filter:blur(8px)"></div>
        <div class="relative flex items-center justify-between mb-2">
          <span class="eyebrow text-[10px]">${label}</span>
          <span class="w-1.5 h-1.5 rounded-full" style="background:${t.dot}"></span>
        </div>
        <p class="relative font-mono-tnum font-semibold text-[24px] leading-none num-display text-fg-1">${value}</p>
      </div>`;
  };

  return `
    <div class="grid grid-cols-3 gap-2 fade-up">
      ${card('Részvétel',  all,          'red')}
      ${card('Játékos',    uniqueNames,  'sky')}
      ${card('Alkalom',    uniqueDates,  'emerald')}
    </div>`;
}

// ─── Csapat statisztikák ───
function renderTeamStats(state: DbState): string {
  const yes = state.records.filter((r) => r.status === 'Yes' && r.event_date);
  const sessionDates = new Set(yes.map((r) => r.event_date));
  const totalSessions = sessionDates.size;
  if (totalSessions === 0) return '';

  // Átlag létszám / alkalom
  const countByDate = new Map<string, number>();
  for (const r of yes) countByDate.set(r.event_date, (countByDate.get(r.event_date) ?? 0) + 1);
  const avgAttendees = Math.round([...countByDate.values()].reduce((s, v) => s + v, 0) / totalSessions);

  // Legtöbb résztvevős hónap (YYYY-MM)
  const byYearMonth = new Map<string, Set<string>>();
  for (const d of sessionDates) {
    const ym = (d ?? '').slice(0, 7);
    if (!byYearMonth.has(ym)) byYearMonth.set(ym, new Set());
    byYearMonth.get(ym)!.add(d!);
  }
  let topYM = ''; let topCount = 0;
  for (const [ym, dates] of byYearMonth) {
    if (dates.size > topCount) { topCount = dates.size; topYM = ym; }
  }
  const [topY, topM] = topYM.split('-').map(Number);
  const topLabel = topYM ? `${topY}. ${MONTH_SHORT[topM - 1]}` : '—';

  const cell = (label: string, value: string, sub?: string) => `
    <div class="flex-1 min-w-0">
      <p class="eyebrow text-[9px] mb-1">${label}</p>
      <p class="font-mono-tnum font-semibold text-[20px] leading-none num-display text-fg-1">${value}</p>
      ${sub ? `<p class="text-[10px] text-fg-3 mt-0.5">${sub}</p>` : ''}
    </div>`;

  return `
    <div class="card p-4 fade-up" style="border-radius:22px">
      <p class="eyebrow text-[10px] mb-3">Csapat összesítő</p>
      <div class="flex gap-4">
        ${cell('Összes alkalom', String(totalSessions))}
        ${cell('Átlag létszám', String(avgAttendees), 'fő / alkalom')}
        ${cell('Legaktívabb hó', topLabel, `${topCount} alkalom`)}
      </div>
    </div>`;
}

// ─── Statisztikák (diagramok) ───
function renderChartsSection(state: DbState): string {
  const years = [...new Set(
    state.records
      .map((r) => Number((r.event_date ?? '').slice(0, 4)))
      .filter(Number.isFinite),
  )].sort((a, b) => b - a);

  if (years.length === 0) return '';

  const yearOptions = years.map((y) =>
    `<option value="${y}" ${state.chartYear === y ? 'selected' : ''}>${y}</option>`,
  ).join('');

  return `
    <div class="card overflow-hidden fade-up" style="border-radius:22px">
      <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
        <div>
          <p class="eyebrow text-[10px] mb-1">Statisztikák</p>
          <p class="text-[15px] font-semibold text-fg-1">Részvételi diagramok</p>
        </div>
        <select id="db-chart-year"
          class="select-native rounded-[12px] border px-3 py-1.5 text-[12px] font-medium text-fg-1 focus:outline-none"
          style="border-color:var(--line-strong); background:var(--bg-card)">
          ${yearOptions}
        </select>
      </div>
      <div class="p-4 space-y-5">
        ${renderMonthlyAttendanceChart(state)}
        ${renderYearlyTrendChart(state)}
        ${renderTop5Card(state)}
      </div>
    </div>`;
}

function renderMonthlyAttendanceChart(state: DbState): string {
  // Count unique session dates per month for chartYear
  const sessionDates = new Set(
    state.records
      .filter((r) => r.status === 'Yes' && (r.event_date ?? '').slice(0, 4) === String(state.chartYear))
      .map((r) => r.event_date),
  );
  const byMonth = new Array(12).fill(0);
  for (const d of sessionDates) {
    const m = Number((d ?? '').slice(5, 7));
    if (m >= 1 && m <= 12) byMonth[m - 1]++;
  }
  const max = Math.max(...byMonth, 1);
  const BAR = 80;
  const currentMonth = new Date().getMonth(); // 0-based
  const isCurrentYear = state.chartYear === new Date().getFullYear();

  const bars = byMonth.map((v, i) => {
    const h = v > 0 ? Math.max(4, Math.round((v / max) * BAR)) : 4;
    const isCurrent = isCurrentYear && i === currentMonth;
    const cls = v === 0 ? 'bar-empty' : isCurrent ? 'bar-brand' : 'bar-emerald';
    return `
      <div class="flex-1 flex flex-col items-center gap-1 min-w-0">
        <span class="text-[9px] font-mono-tnum ${v === 0 ? 'text-fg-3 opacity-50' : 'font-semibold text-fg-1'}">${v || '·'}</span>
        <div class="bar-fill w-full max-w-[18px] rounded-t-[5px] ${cls}" style="height:${h}px;animation-delay:${i*35}ms"></div>
        <span class="text-[9px] text-fg-3">${MONTH_SHORT[i]}</span>
      </div>`;
  }).join('');

  return `
    <div>
      <p class="eyebrow text-[10px] mb-3">Havi részvétel — ${state.chartYear}</p>
      <div class="flex items-end gap-1" style="min-height:${BAR+32}px">${bars}</div>
    </div>`;
}

function renderYearlyTrendChart(state: DbState): string {
  // Count unique session dates per year
  const byYear = new Map<number, Set<string>>();
  for (const r of state.records) {
    if (r.status !== 'Yes' || !r.event_date) continue;
    const y = Number(r.event_date.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    if (!byYear.has(y)) byYear.set(y, new Set());
    byYear.get(y)!.add(r.event_date);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (years.length === 0) return '';
  const currentYear = new Date().getFullYear();
  const counts = years.map((y) => byYear.get(y)!.size);
  const max = Math.max(...counts, 1);
  const BAR = 80;

  const bars = years.map((y, i) => {
    const v = counts[i];
    const h = Math.max(4, Math.round((v / max) * BAR));
    const isCurrent = y === currentYear;
    return `
      <div class="flex-1 flex flex-col items-center gap-1.5 min-w-0">
        <span class="text-[9px] font-mono-tnum ${isCurrent ? 'font-semibold text-fg-1' : 'text-fg-2'}">${v}</span>
        <div class="bar-fill w-full max-w-[32px] rounded-t-[6px] ${isCurrent ? 'bar-brand' : ''}"
             style="height:${h}px;animation-delay:${i*60}ms;${isCurrent ? '' : 'background:color-mix(in oklab,var(--line-strong) 70%,transparent)'}"></div>
        <span class="text-[9px] font-mono-tnum ${isCurrent ? 'font-semibold text-fg-1' : 'text-fg-3'}">${y}</span>
      </div>`;
  }).join('');

  return `
    <div style="border-top:1px solid var(--line);padding-top:16px">
      <p class="eyebrow text-[10px] mb-3">Éves trend — alkalmak száma</p>
      <div class="flex items-end gap-2" style="min-height:${BAR+32}px">${bars}</div>
    </div>`;
}

function renderTop5Card(state: DbState): string {
  // Top 5 players all-time
  const counts = new Map<string, number>();
  for (const r of state.records) {
    if (r.status === 'Yes') counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  }
  const top5 = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'hu'))
    .slice(0, 5);
  if (top5.length === 0) return '';

  const rows = top5.map((p, i) => {
    const hue = avatarHue(p.name);
    const initials = getInitials(p.name);
    return `
      <div class="flex items-center gap-2.5" style="${i > 0 ? 'margin-top:8px' : ''}">
        <span class="text-[11px] font-mono-tnum text-fg-3 w-4 text-right">${i + 1}</span>
        <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[9px]"
             style="width:24px;height:24px;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
          ${eh(initials)}
        </div>
        <span class="flex-1 text-[12px] font-medium text-fg-1 truncate">${eh(p.name)}</span>
        <span class="font-mono-tnum text-[12px] font-semibold text-fg-1">${p.count}</span>
      </div>`;
  }).join('');

  return `
    <div style="border-top:1px solid var(--line);padding-top:16px">
      <p class="eyebrow text-[10px] mb-3">Top 5 legaktívabb</p>
      ${rows}
    </div>`;
}

// ─── Ranglista ───
function renderRanking(state: DbState): string {
  // Csak Yes-eket számoljuk, év szerint szűrve
  const counts = new Map<string, number>();
  for (const r of state.records) {
    if (r.status !== 'Yes') continue;
    if (state.yearFilter !== 'all') {
      const y = Number((r.event_date ?? '').slice(0, 4));
      if (y !== state.yearFilter) continue;
    }
    counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  }

  const ranking = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'hu'));

  // Évek a select-hez
  const years = [...new Set(state.records.map((r) => Number((r.event_date ?? '').slice(0, 4))).filter(Number.isFinite))]
    .sort((a, b) => b - a);

  const yearOptions = [
    `<option value="all" ${state.yearFilter === 'all' ? 'selected' : ''}>Mind</option>`,
    ...years.map((y) => `<option value="${y}" ${state.yearFilter === y ? 'selected' : ''}>${y}</option>`),
  ].join('');

  // Top 3 medálok + többiek
  const maxCount = ranking[0]?.count ?? 1;
  const medals = ['🥇', '🥈', '🥉'];

  const rows = ranking.slice(0, 20).map((r, i) => {
    const isTop = i < 3;
    const widthPct = Math.max(8, (r.count / maxCount) * 100);
    const hue = avatarHue(r.name);
    const initials = getInitials(r.name);
    return `
      <li class="px-3 py-2 flex items-center gap-3" style="${i === 0 ? '' : 'border-top:1px solid var(--line);'}">
        <div class="w-6 text-center text-[12px] font-bold" style="color:${isTop ? 'var(--fg-1)' : 'var(--fg-3)'}">
          ${isTop ? medals[i] : (i + 1)}
        </div>
        <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
             style="width:28px;height:28px;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
          ${eh(initials)}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[12.5px] font-semibold text-fg-1 truncate">${eh(r.name)}</p>
          <div class="mt-1 h-1.5 rounded-full overflow-hidden" style="background:var(--bg-elev)">
            <div class="h-full rounded-full" style="width:${widthPct}%;background:${isTop ? 'var(--accent)' : 'color-mix(in oklab,var(--accent) 50%,transparent)'}"></div>
          </div>
        </div>
        <span class="font-mono-tnum font-semibold text-[14px] text-fg-1 num-display">${r.count}</span>
      </li>`;
  }).join('');

  return `
    <div class="card overflow-hidden fade-up" style="border-radius:22px">
      <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
        <div>
          <p class="eyebrow text-[10px] mb-1">Ranglista</p>
          <p class="text-[15px] font-semibold text-fg-1">Top részvevők</p>
        </div>
        <select id="db-year-filter"
          class="select-native rounded-[12px] border px-3 py-1.5 text-[12px] font-medium text-fg-1 focus:outline-none"
          style="border-color:var(--line-strong); background:var(--bg-card)">
          ${yearOptions}
        </select>
      </div>
      ${ranking.length === 0
        ? `<div class="p-8 text-center text-[13px] text-fg-3">Nincs adat ehhez az évhez.</div>`
        : `<ul>${rows}</ul>`}
      ${ranking.length > 20 ? `<div class="px-4 py-2 text-[11px] text-fg-3 text-center" style="border-top:1px solid var(--line)">+${ranking.length - 20} további játékos</div>` : ''}
    </div>`;
}

// ─── Record vezérlők (kereső + rendezés) ───
function renderRecordControls(state: DbState): string {
  return `
    <div class="space-y-2 fade-up">
      <div class="card flex items-center gap-2.5 px-3.5 py-2" style="border-radius:16px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--fg-3);flex:none">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <input id="db-record-filter" type="search" placeholder="Keresés név vagy dátum alapján…"
          value="${ea(state.recordFilter)}"
          class="flex-1 bg-transparent text-[13.5px] text-fg-1 placeholder-fg-3 focus:outline-none py-1.5" />
        ${state.recordFilter ? `<button id="db-filter-clear" class="text-[11px] font-semibold transition-colors" style="color:var(--accent)">Töröl</button>` : ''}
      </div>
      <div class="flex items-center gap-2">
        <span class="eyebrow text-[10px]">Rendezés:</span>
        <button data-sort="date_desc" class="db-sort-btn px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
          style="background:${state.recordSort === 'date_desc' ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'var(--bg-elev)'};color:${state.recordSort === 'date_desc' ? 'var(--accent-ink)' : 'var(--fg-2)'}">
          Legújabb
        </button>
        <button data-sort="date_asc" class="db-sort-btn px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
          style="background:${state.recordSort === 'date_asc' ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'var(--bg-elev)'};color:${state.recordSort === 'date_asc' ? 'var(--accent-ink)' : 'var(--fg-2)'}">
          Legrégebbi
        </button>
        <button data-sort="name" class="db-sort-btn px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
          style="background:${state.recordSort === 'name' ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'var(--bg-elev)'};color:${state.recordSort === 'name' ? 'var(--accent-ink)' : 'var(--fg-2)'}">
          Név
        </button>
      </div>
    </div>`;
}

// ─── Rekordok lista ───
function renderRecordsList(state: DbState): string {
  let rows = state.records.slice();
  const f = state.recordFilter.trim().toLowerCase();
  if (f) {
    rows = rows.filter((r) => r.name.toLowerCase().includes(f) || (r.event_date ?? '').includes(f));
  }
  rows.sort((a, b) => {
    if (state.recordSort === 'name') return a.name.localeCompare(b.name, 'hu');
    if (state.recordSort === 'date_asc') return (a.event_date ?? '').localeCompare(b.event_date ?? '');
    return (b.event_date ?? '').localeCompare(a.event_date ?? '');
  });

  // Limit a renderelt sorokra hogy ne fojtsa a böngészőt (de jelezzük az összeset)
  const MAX = 200;
  const total = rows.length;
  rows = rows.slice(0, MAX);

  if (total === 0) {
    return `
      <div class="card-soft p-8 text-center fade-up" style="border-radius:22px">
        <div class="text-3xl mb-2">${state.recordFilter ? '🔍' : '📭'}</div>
        <p class="text-[14px] font-semibold text-fg-1">${state.recordFilter ? 'Nincs találat' : 'Nincs rekord'}</p>
      </div>`;
  }

  const items = rows.map((r, i) => {
    const hue = avatarHue(r.name);
    const initials = getInitials(r.name);
    const yesBg = r.status === 'Yes' ? 'rgba(16,185,129,0.14)' : 'rgba(160,160,160,0.14)';
    const yesColor = r.status === 'Yes' ? '#047857' : '#737373';
    return `
      <li class="flex items-center gap-3 px-3.5 py-2.5" style="${i === 0 ? '' : 'border-top:1px solid var(--line);'}">
        <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
             style="width:28px;height:28px;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
          ${eh(initials)}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[12.5px] font-semibold text-fg-1 truncate">${eh(r.name)}</p>
          <p class="text-[10.5px] text-fg-3 font-mono-tnum">${r.event_date ? eh(formatDateHu(r.event_date)) : '—'}${r.mode === 'legacy' ? ' · legacy' : r.mode === 'teszt' ? ' · teszt' : ''}</p>
        </div>
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:${yesBg};color:${yesColor}">
          ${r.status || '—'}
        </span>
      </li>`;
  }).join('');

  return `
    <div class="card overflow-hidden fade-up" style="border-radius:22px">
      <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
        <span class="eyebrow text-[10px]">Rekordok</span>
        <span class="text-[11px] font-mono-tnum text-fg-3">${total}${total > MAX ? ` (első ${MAX})` : ''}</span>
      </div>
      <ul>${items}</ul>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────

function rerender(container: HTMLElement, state: DbState) {
  const body = container.querySelector<HTMLElement>('#db-body')!;
  body.innerHTML = renderBody(state);
  attachHandlers(container, state);
}

function attachHandlers(container: HTMLElement, state: DbState) {
  // Diagram év szűrő
  container.querySelector<HTMLSelectElement>('#db-chart-year')?.addEventListener('change', (e) => {
    state.chartYear = Number((e.target as HTMLSelectElement).value);
    rerender(container, state);
  });

  // Ranglista év szűrő
  const yearSel = container.querySelector<HTMLSelectElement>('#db-year-filter');
  yearSel?.addEventListener('change', () => {
    state.yearFilter = yearSel.value === 'all' ? 'all' : Number(yearSel.value);
    rerender(container, state);
  });

  // Kereső
  const filterInput = container.querySelector<HTMLInputElement>('#db-record-filter');
  filterInput?.addEventListener('input', () => {
    state.recordFilter = filterInput.value;
    rerender(container, state);
    // Fókusz vissza
    container.querySelector<HTMLInputElement>('#db-record-filter')?.focus();
    const inp = container.querySelector<HTMLInputElement>('#db-record-filter');
    if (inp) inp.setSelectionRange(inp.value.length, inp.value.length);
  });
  container.querySelector<HTMLButtonElement>('#db-filter-clear')?.addEventListener('click', () => {
    state.recordFilter = '';
    rerender(container, state);
  });

  // Rendezés gombok
  container.querySelectorAll<HTMLButtonElement>('.db-sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sort = btn.dataset.sort as DbState['recordSort'];
      if (sort && sort !== state.recordSort) {
        state.recordSort = sort;
        rerender(container, state);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

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
