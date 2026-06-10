<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
  import { getAllAttendanceRecords, type RawAttendance } from '../lib/firestore';
  import { getInitials } from '../lib/avatar';
  import { formatDateHu } from '../lib/dates';

  const MONTH_SHORT = ['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];

  // State
  let records = $state<RawAttendance[]>([]);
  let yearFilter = $state<number | 'all'>('all');
  let chartYear = $state<number>(new Date().getFullYear());
  let recordFilter = $state<string>('');
  let recordSort = $state<'date_desc' | 'date_asc' | 'name'>('date_desc');
  let loading = $state(true);

  // Derived Values
  let yesRecords = $derived(records.filter((r) => r.status === 'Yes'));
  let uniqueNamesCount = $derived(new Set(yesRecords.map((r) => r.name)).size);
  let uniqueDatesCount = $derived(new Set(yesRecords.filter(r => r.event_date).map((r) => r.event_date)).size);

  let sessionDates = $derived(new Set(yesRecords.filter(r => r.event_date).map(r => r.event_date as string)));
  let totalSessions = $derived(sessionDates.size);

  let avgAttendees = $derived.by(() => {
    if (totalSessions === 0) return 0;
    const countByDate = new Map<string, number>();
    for (const r of yesRecords) {
      if (r.event_date) countByDate.set(r.event_date, (countByDate.get(r.event_date) ?? 0) + 1);
    }
    return Math.round([...countByDate.values()].reduce((s, v) => s + v, 0) / totalSessions);
  });

  let topYearMonthInfo = $derived.by(() => {
    if (totalSessions === 0) return { label: '—', count: 0 };
    const byYearMonth = new Map<string, Set<string>>();
    for (const d of sessionDates) {
      const ym = d.slice(0, 7);
      if (!byYearMonth.has(ym)) byYearMonth.set(ym, new Set());
      byYearMonth.get(ym)!.add(d);
    }
    let topYM = ''; let topCount = 0;
    for (const [ym, dates] of byYearMonth) {
      if (dates.size > topCount) { topCount = dates.size; topYM = ym; }
    }
    const [topY, topM] = topYM.split('-').map(Number);
    return {
      label: topYM ? `${topY}. ${MONTH_SHORT[topM - 1]}` : '—',
      count: topCount
    };
  });

  let availableYears = $derived([...new Set(records.map((r) => Number((r.event_date ?? '').slice(0, 4))).filter(Number.isFinite))].sort((a, b) => b - a));

  let monthlyData = $derived.by(() => {
    const sDates = new Set(
      records
        .filter((r) => r.status === 'Yes' && (r.event_date ?? '').slice(0, 4) === String(chartYear))
        .map((r) => r.event_date)
    );
    const byMonth = new Array(12).fill(0);
    for (const d of sDates) {
      if (!d) continue;
      const m = Number(d.slice(5, 7));
      if (m >= 1 && m <= 12) byMonth[m - 1]++;
    }
    const max = Math.max(...byMonth, 1);
    return { byMonth, max };
  });

  let yearlyData = $derived.by(() => {
    const byYear = new Map<number, Set<string>>();
    for (const r of records) {
      if (r.status !== 'Yes' || !r.event_date) continue;
      const y = Number(r.event_date.slice(0, 4));
      if (!Number.isFinite(y)) continue;
      if (!byYear.has(y)) byYear.set(y, new Set());
      byYear.get(y)!.add(r.event_date);
    }
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const counts = years.map((y) => byYear.get(y)!.size);
    const max = Math.max(...counts, 1);
    return { years, counts, max };
  });

  let top5Players = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const r of yesRecords) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'hu'))
      .slice(0, 5);
  });

  let ranking = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const r of yesRecords) {
      if (yearFilter !== 'all') {
        const y = Number((r.event_date ?? '').slice(0, 4));
        if (y !== yearFilter) continue;
      }
      counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'hu'));
  });

  let filteredRecords = $derived.by(() => {
    let rows = records.slice();
    const f = recordFilter.trim().toLowerCase();
    if (f) {
      rows = rows.filter((r) => r.name.toLowerCase().includes(f) || (r.event_date ?? '').includes(f));
    }
    rows.sort((a, b) => {
      if (recordSort === 'name') return a.name.localeCompare(b.name, 'hu');
      if (recordSort === 'date_asc') return (a.event_date ?? '').localeCompare(b.event_date ?? '');
      return (b.event_date ?? '').localeCompare(a.event_date ?? '');
    });
    return rows;
  });

  onMount(async () => {
    records = await getAllAttendanceRecords();
    loading = false;
  });

  function avatarHue(name: string): number {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return Math.abs(h) % 360;
  }
</script>

<div class="device">
  <Header currentPage="database" />
  
  <main id="db-body">
    {#if loading}
      <div class="px-5 pt-5 space-y-3">
        <div class="h-12 rounded-2xl animate-pulse" style="background:var(--line)"></div>
        <div class="grid grid-cols-3 gap-2.5">
          <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
          <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
          <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        </div>
        {#each Array(6) as _}
          <div class="h-12 rounded-2xl animate-pulse" style="background:var(--line)"></div>
        {/each}
      </div>
    {:else}
      <div class="lg:grid lg:grid-cols-[400px_1fr] lg:gap-6 lg:p-6 lg:pt-5 lg:items-start">
        
        <!-- Ranglista -->
        <aside class="lg:sticky lg:top-[110px] space-y-3 px-5 pt-5 lg:px-0 lg:pt-0">
          
          <!-- Stats -->
          <div class="grid grid-cols-3 gap-2 fade-up">
            {#each [
              { label: 'Részvétel', val: yesRecords.length, dot: 'var(--accent)', tint: 'color-mix(in oklab,var(--accent) 10%,transparent)' },
              { label: 'Játékos', val: uniqueNamesCount, dot: '#0ea5e9', tint: 'rgba(14,165,233,0.10)' },
              { label: 'Alkalom', val: uniqueDatesCount, dot: '#10b981', tint: 'rgba(16,185,129,0.10)' }
            ] as stat}
              <div class="card relative p-3.5 overflow-hidden lift">
                <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:{stat.tint};filter:blur(8px)"></div>
                <div class="relative flex items-center justify-between mb-2">
                  <span class="eyebrow text-[10px]">{stat.label}</span>
                  <span class="w-1.5 h-1.5 rounded-full" style="background:{stat.dot}"></span>
                </div>
                <p class="relative font-mono-tnum font-semibold text-[24px] leading-none num-display text-fg-1">{stat.val}</p>
              </div>
            {/each}
          </div>

          <!-- Team Stats -->
          {#if totalSessions > 0}
            <div class="card p-4 fade-up" style="border-radius:22px">
              <p class="eyebrow text-[10px] mb-3">Csapat összesítő</p>
              <div class="flex gap-4">
                <div class="flex-1 min-w-0">
                  <p class="eyebrow text-[9px] mb-1">Összes alkalom</p>
                  <p class="font-mono-tnum font-semibold text-[20px] leading-none num-display text-fg-1">{totalSessions}</p>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="eyebrow text-[9px] mb-1">Átlag létszám</p>
                  <p class="font-mono-tnum font-semibold text-[20px] leading-none num-display text-fg-1">{avgAttendees}</p>
                  <p class="text-[10px] text-fg-3 mt-0.5">fő / alkalom</p>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="eyebrow text-[9px] mb-1">Legaktívabb hó</p>
                  <p class="font-mono-tnum font-semibold text-[20px] leading-none num-display text-fg-1">{topYearMonthInfo.label}</p>
                  <p class="text-[10px] text-fg-3 mt-0.5">{topYearMonthInfo.count} alkalom</p>
                </div>
              </div>
            </div>
          {/if}

          <!-- Charts -->
          {#if availableYears.length > 0}
            <div class="card overflow-hidden fade-up" style="border-radius:22px">
              <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
                <div>
                  <p class="eyebrow text-[10px] mb-1">Statisztikák</p>
                  <p class="text-[15px] font-semibold text-fg-1">Részvételi diagramok</p>
                </div>
                <select class="select-native rounded-[12px] border px-3 py-1.5 text-[12px] font-medium text-fg-1 focus:outline-none"
                  style="border-color:var(--line-strong); background:var(--bg-card)"
                  bind:value={chartYear}>
                  {#each availableYears as y}
                    <option value={y}>{y}</option>
                  {/each}
                </select>
              </div>
              <div class="p-4 space-y-5">
                <!-- Havi chart -->
                <div>
                  <p class="eyebrow text-[10px] mb-3">Havi részvétel — {chartYear}</p>
                  <div class="flex items-end gap-1" style="min-height:112px">
                    {#each monthlyData.byMonth as v, i}
                      {@const h = v > 0 ? Math.max(4, Math.round((v / monthlyData.max) * 80)) : 4}
                      {@const isCurrent = chartYear === new Date().getFullYear() && i === new Date().getMonth()}
                      {@const cls = v === 0 ? 'bar-empty' : isCurrent ? 'bar-brand' : 'bar-emerald'}
                      <div class="flex-1 flex flex-col items-center gap-1 min-w-0">
                        <span class="text-[9px] font-mono-tnum {v === 0 ? 'text-fg-3 opacity-50' : 'font-semibold text-fg-1'}">{v || '·'}</span>
                        <div class="bar-fill w-full max-w-[18px] rounded-t-[5px] {cls}" style="height:{h}px;animation-delay:{i*35}ms"></div>
                        <span class="text-[9px] text-fg-3">{MONTH_SHORT[i]}</span>
                      </div>
                    {/each}
                  </div>
                </div>
                
                <!-- Éves chart -->
                {#if yearlyData.years.length > 0}
                  <div style="border-top:1px solid var(--line);padding-top:16px">
                    <p class="eyebrow text-[10px] mb-3">Éves trend — alkalmak száma</p>
                    <div class="flex items-end gap-2" style="min-height:112px">
                      {#each yearlyData.years as y, i}
                        {@const v = yearlyData.counts[i]}
                        {@const h = Math.max(4, Math.round((v / yearlyData.max) * 80))}
                        {@const isCurrent = y === new Date().getFullYear()}
                        <div class="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                          <span class="text-[9px] font-mono-tnum {isCurrent ? 'font-semibold text-fg-1' : 'text-fg-2'}">{v}</span>
                          <div class="bar-fill w-full max-w-[32px] rounded-t-[6px] {isCurrent ? 'bar-brand' : ''}"
                               style="height:{h}px;animation-delay:{i*60}ms;{isCurrent ? '' : 'background:color-mix(in oklab,var(--line-strong) 70%,transparent)'}"></div>
                          <span class="text-[9px] font-mono-tnum {isCurrent ? 'font-semibold text-fg-1' : 'text-fg-3'}">{y}</span>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}

                <!-- Top 5 -->
                {#if top5Players.length > 0}
                  <div style="border-top:1px solid var(--line);padding-top:16px">
                    <p class="eyebrow text-[10px] mb-3">Top 5 legaktívabb</p>
                    {#each top5Players as p, i}
                      {@const hue = avatarHue(p.name)}
                      {@const initials = getInitials(p.name)}
                      <div class="flex items-center gap-2.5 {i > 0 ? 'mt-2' : ''}">
                        <span class="text-[11px] font-mono-tnum text-fg-3 w-4 text-right">{i + 1}</span>
                        <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[9px]"
                             style="width:24px;height:24px;background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                          {initials}
                        </div>
                        <span class="flex-1 text-[12px] font-medium text-fg-1 truncate">{p.name}</span>
                        <span class="font-mono-tnum text-[12px] font-semibold text-fg-1">{p.count}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Ranking -->
          <div class="card overflow-hidden fade-up" style="border-radius:22px">
            <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
              <div>
                <p class="eyebrow text-[10px] mb-1">Ranglista</p>
                <p class="text-[15px] font-semibold text-fg-1">Top részvevők</p>
              </div>
              <select class="select-native rounded-[12px] border px-3 py-1.5 text-[12px] font-medium text-fg-1 focus:outline-none"
                style="border-color:var(--line-strong); background:var(--bg-card)" bind:value={yearFilter}>
                <option value="all">Mind</option>
                {#each availableYears as y}
                  <option value={y}>{y}</option>
                {/each}
              </select>
            </div>
            {#if ranking.length === 0}
              <div class="p-8 text-center text-[13px] text-fg-3">Nincs adat ehhez az évhez.</div>
            {:else}
              {@const maxCount = ranking[0]?.count ?? 1}
              {@const medals = ['🥇', '🥈', '🥉']}
              <ul>
                {#each ranking.slice(0, 20) as r, i}
                  {@const isTop = i < 3}
                  {@const widthPct = Math.max(8, (r.count / maxCount) * 100)}
                  {@const hue = avatarHue(r.name)}
                  {@const initials = getInitials(r.name)}
                  <li class="px-3 py-2 flex items-center gap-3" style="{i === 0 ? '' : 'border-top:1px solid var(--line)'}">
                    <div class="w-6 text-center text-[12px] font-bold" style="color:{isTop ? 'var(--fg-1)' : 'var(--fg-3)'}">
                      {isTop ? medals[i] : (i + 1)}
                    </div>
                    <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
                         style="width:28px;height:28px;background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                      {initials}
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-[12.5px] font-semibold text-fg-1 truncate">{r.name}</p>
                      <div class="mt-1 h-1.5 rounded-full overflow-hidden" style="background:var(--bg-elev)">
                        <div class="h-full rounded-full" style="width:{widthPct}%;background:{isTop ? 'var(--accent)' : 'color-mix(in oklab,var(--accent) 50%,transparent)'}"></div>
                      </div>
                    </div>
                    <span class="font-mono-tnum font-semibold text-[14px] text-fg-1 num-display">{r.count}</span>
                  </li>
                {/each}
              </ul>
              {#if ranking.length > 20}
                <div class="px-4 py-2 text-[11px] text-fg-3 text-center" style="border-top:1px solid var(--line)">+{ranking.length - 20} további játékos</div>
              {/if}
            {/if}
          </div>
        </aside>

        <!-- Jelenléti rekordok -->
        <section class="px-5 pt-3 pb-12 lg:px-0 lg:pt-0 space-y-3">
          <!-- Record Controls -->
          <div class="space-y-2 fade-up">
            <div class="card flex items-center gap-2.5 px-3.5 py-2" style="border-radius:16px">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--fg-3);flex:none">
                <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input type="search" placeholder="Keresés név vagy dátum alapján…" bind:value={recordFilter}
                class="flex-1 bg-transparent text-[13.5px] text-fg-1 placeholder-fg-3 focus:outline-none py-1.5" />
              {#if recordFilter}
                <button onclick={() => recordFilter = ''} class="text-[11px] font-semibold transition-colors" style="color:var(--accent)">Töröl</button>
              {/if}
            </div>
            <div class="flex items-center gap-2">
              <span class="eyebrow text-[10px]">Rendezés:</span>
              <button onclick={() => recordSort = 'date_desc'} class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                style="background:{recordSort === 'date_desc' ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'var(--bg-elev)'};color:{recordSort === 'date_desc' ? 'var(--accent-ink)' : 'var(--fg-2)'}">Legújabb</button>
              <button onclick={() => recordSort = 'date_asc'} class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                style="background:{recordSort === 'date_asc' ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'var(--bg-elev)'};color:{recordSort === 'date_asc' ? 'var(--accent-ink)' : 'var(--fg-2)'}">Legrégebbi</button>
              <button onclick={() => recordSort = 'name'} class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                style="background:{recordSort === 'name' ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'var(--bg-elev)'};color:{recordSort === 'name' ? 'var(--accent-ink)' : 'var(--fg-2)'}">Név</button>
            </div>
          </div>

          <!-- Records List -->
          {#if true}
          {@const MAX = 200}
          {@const rows = filteredRecords.slice(0, MAX)}
          {#if filteredRecords.length === 0}
            <div class="card-soft p-8 text-center fade-up" style="border-radius:22px">
              <div class="text-3xl mb-2">{recordFilter ? '🔍' : '📭'}</div>
              <p class="text-[14px] font-semibold text-fg-1">{recordFilter ? 'Nincs találat' : 'Nincs rekord'}</p>
            </div>
          {:else}
            <div class="card overflow-hidden fade-up" style="border-radius:22px">
              <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
                <span class="eyebrow text-[10px]">Rekordok</span>
                <span class="text-[11px] font-mono-tnum text-fg-3">{filteredRecords.length}{filteredRecords.length > MAX ? ` (első ${MAX})` : ''}</span>
              </div>
              <ul>
                {#each rows as r, i}
                  {@const hue = avatarHue(r.name)}
                  {@const initials = getInitials(r.name)}
                  {@const yesBg = r.status === 'Yes' ? 'rgba(16,185,129,0.14)' : 'rgba(160,160,160,0.14)'}
                  {@const yesColor = r.status === 'Yes' ? '#047857' : '#737373'}
                  <li class="flex items-center gap-3 px-3.5 py-2.5" style="{i > 0 ? 'border-top:1px solid var(--line)' : ''}">
                    <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
                         style="width:28px;height:28px;background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                      {initials}
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-[12.5px] font-semibold text-fg-1 truncate">{r.name}</p>
                      <p class="text-[10.5px] text-fg-3 font-mono-tnum">{r.event_date ? formatDateHu(r.event_date) : '—'}{r.mode === 'legacy' ? ' · legacy' : r.mode === 'teszt' ? ' · teszt' : ''}</p>
                    </div>
                    <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:{yesBg};color:{yesColor}">
                      {r.status || '—'}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
          {/if}
        </section>
      </div>
    {/if}
  </main>
</div>
