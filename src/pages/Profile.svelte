<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
  import { getAllMembers, getAttendanceForPlayer, getSettlementsForPlayer, type RawAttendance, type PlayerSettlementRow } from '../lib/firestore';
  import { getAuthState } from '../lib/auth';
  import { getInitials } from '../lib/avatar';
  import { estimateCost, formatHuf } from '../lib/cost';
  import { formatDateHuLong } from '../lib/dates';

  interface ProfileSession { date: string; year: number; month: number; }

  const MONTH_SHORT = ['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  let playerRecords = $state<RawAttendance[]>([]);
  let playerNames = $state<string[]>([]);
  let availableYears = $state<number[]>([currentYear]);
  let selectedName = $state<string>('');
  let selectedYear = $state<number>(currentYear);
  let playerSessions = $state<ProfileSession[]>([]);
  let isAdmin = $state<boolean>(false);
  let settlementRows = $state<PlayerSettlementRow[]>([]);
  let settlementsLoading = $state<boolean>(false);
  let recordsLoading = $state<boolean>(true);
  let initialLoaded = $state<boolean>(false);

  // Computed / derived state for stats
  let totalSessions = $derived(playerSessions.length);
  let thisYearCount = $derived(playerSessions.filter(s => s.year === currentYear).length);
  let thisMonthCount = $derived(playerSessions.filter(s => s.year === currentYear && s.month === currentMonth).length);
  let selYearCount = $derived(playerSessions.filter(s => s.year === selectedYear).length);

  const careerGoal = 100;
  const yearGoal = 40;
  const monthGoal = 4;

  let cp = $derived(Math.min(1, totalSessions / careerGoal));
  let yp = $derived(Math.min(1, thisYearCount / yearGoal));
  let mp = $derived(Math.min(1, thisMonthCount / monthGoal));

  // Avatar hue
  let hue = $derived(avatarHue(selectedName));
  let initials = $derived(getInitials(selectedName));

  onMount(async () => {
    isAdmin = getAuthState().isAdmin;
    const members = await getAllMembers();
    playerNames = [...new Set(members.map(m => m.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'hu'));

    if (playerNames.length > 0) {
      const queryName = readHashQuery().get('name');
      selectedName = queryName && playerNames.includes(queryName) ? queryName : playerNames[0];
      await loadPlayerData(selectedName);
    }
    initialLoaded = true;
  });

  async function loadPlayerData(name: string) {
    recordsLoading = true;
    playerRecords = [];
    playerSessions = [];
    
    try {
      const records = await getAttendanceForPlayer(name);
      if (selectedName !== name) return; // stale

      playerRecords = records;
      
      const years = [...new Set(
        records.filter((r) => r.status === 'Yes' && r.event_date)
          .map((r) => Number(r.event_date.slice(0, 4))).filter(Number.isFinite)
      )].sort((a, b) => b - a);
      
      availableYears = years.length ? years : [currentYear];
      if (!availableYears.includes(selectedYear)) {
        selectedYear = availableYears.includes(currentYear) ? currentYear : availableYears[0];
      }

      recomputePlayerSessions();
      recordsLoading = false;
    } catch {
      recordsLoading = false;
    }

    if (isAdmin) {
      settlementsLoading = true;
      try {
        const rows = await getSettlementsForPlayer(name);
        if (selectedName === name) {
          settlementRows = rows;
        }
      } finally {
        if (selectedName === name) {
          settlementsLoading = false;
        }
      }
    }
  }

  function handleNameChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    if (val !== selectedName) {
      selectedName = val;
      loadPlayerData(val);
    }
  }

  function handleYearChange(e: Event) {
    selectedYear = Number((e.target as HTMLSelectElement).value);
  }

  function recomputePlayerSessions() {
    const seen = new Set<string>();
    const sessions: ProfileSession[] = [];
    for (const r of playerRecords) {
      if (r.status !== 'Yes' || !r.event_date) continue;
      if (seen.has(r.event_date)) continue;
      seen.add(r.event_date);
      const [y, m] = r.event_date.split('-').map(Number);
      if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
      sessions.push({ date: r.event_date, year: y, month: m });
    }
    sessions.sort((a, b) => b.date.localeCompare(a.date));
    playerSessions = sessions;
  }

  function avatarHue(name: string): number {
    if (!name) return 0;
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return Math.abs(h) % 360;
  }

  function readHashQuery(): URLSearchParams {
    const hash = window.location.hash || '';
    const qIdx = hash.indexOf('?');
    return new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '');
  }

  function ringParams(size: number, stroke: number, progress: number, offset: number) {
    const r = (size - stroke) / 2 - offset;
    const c = 2 * Math.PI * r;
    const dash = c * progress;
    return { size, r, c, dash };
  }

  let byYearMap = $derived.by(() => {
    const m = new Map<number, number>();
    for (const s of playerSessions) m.set(s.year, (m.get(s.year) ?? 0) + 1);
    return m;
  });
  let byYearKeys = $derived([...byYearMap.keys()].sort((a, b) => a - b));
  let byYearMax = $derived(Math.max(0, ...byYearMap.values()));

  let byMonthArr = $derived.by(() => {
    const arr = new Array(12).fill(0);
    for (const s of playerSessions) {
      if (s.year === selectedYear) arr[s.month - 1]++;
    }
    return arr;
  });
  let byMonthMax = $derived(Math.max(0, ...byMonthArr));
  let byMonthTotal = $derived(byMonthArr.reduce((a, b) => a + b, 0));
</script>

<div class="device">
  <Header currentPage="profile" />
  
  <main id="profile-body">
    {#if !initialLoaded || recordsLoading && !selectedName}
      <!-- Loading Skeleton -->
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
      </div>
    {:else if playerNames.length === 0}
      <!-- Empty State -->
      <div class="flex flex-col items-center justify-center py-20 px-6 text-center gap-3">
        <div class="w-16 h-16 rounded-2xl flex items-center justify-center" style="background:var(--line)">
          <span class="text-2xl">👥</span>
        </div>
        <p class="text-[16px] font-semibold text-fg-1">Nincs még játékos</p>
        <p class="text-[13px] text-fg-3">Először regisztrálj egy alkalomra!</p>
      </div>
    {:else}
      <div class="px-5 pt-5 pb-12 space-y-5">
        
        <!-- Selectors -->
        <div class="grid grid-cols-[1fr_auto] gap-2.5 fade-up">
          <label class="flex flex-col gap-1.5">
            <span class="eyebrow">Játékos</span>
            <select class="select-native w-full rounded-[14px] border px-3.5 py-3 text-[15px] font-medium text-fg-1 focus:outline-none"
                    style="border-color:var(--line-strong); background:var(--bg-card)"
                    value={selectedName} onchange={handleNameChange}>
              {#each playerNames as name}
                <option value={name}>{name}</option>
              {/each}
            </select>
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="eyebrow">Év</span>
            <select class="select-native rounded-[14px] border px-3.5 py-3 text-[15px] font-medium text-fg-1 focus:outline-none"
                    style="border-color:var(--line-strong); background:var(--bg-card)"
                    value={selectedYear} onchange={handleYearChange}>
              {#each availableYears as y}
                <option value={y}>{y}</option>
              {/each}
            </select>
          </label>
        </div>

        <!-- Hero Rings -->
        <section class="relative fade-up" style="animation-delay:40ms">
          <div class="halo"></div>
          <div class="relative card noise lift overflow-hidden" style="border-radius:28px">
            <div class="relative p-5 flex items-center gap-5">
              <div class="relative flex-shrink-0" style="width:124px;height:124px">
                <!-- Ring 1 (Career) -->
                {#if true}
                {@const r1 = ringParams(124, 9, cp, 0)}
                <svg width="124" height="124" viewBox="0 0 124 124" class="absolute inset-0">
                  <circle cx="62" cy="62" r={r1.r} fill="none" stroke-width="9" class="ring-track" stroke-linecap="round"/>
                  <circle cx="62" cy="62" r={r1.r} fill="none" stroke="var(--hue-ring-1)" stroke-width="9" stroke-linecap="round" stroke-dasharray="{r1.dash} {r1.c}" transform="rotate(-90 62 62)" class="ring-arc" style="--from-offset:{r1.c};--to-offset:0;animation-delay:0ms;stroke-dashoffset:0"/>
                </svg>
                {/if}
                <!-- Ring 2 (Year) -->
                {#if true}
                {@const r2 = ringParams(102, 9, yp, 11)}
                <svg width="102" height="102" viewBox="0 0 102 102" class="absolute inset-0" style="left:11px;top:11px">
                  <circle cx="51" cy="51" r={r2.r} fill="none" stroke-width="9" class="ring-track" stroke-linecap="round"/>
                  <circle cx="51" cy="51" r={r2.r} fill="none" stroke="var(--hue-ring-2)" stroke-width="9" stroke-linecap="round" stroke-dasharray="{r2.dash} {r2.c}" transform="rotate(-90 51 51)" class="ring-arc" style="--from-offset:{r2.c};--to-offset:0;animation-delay:120ms;stroke-dashoffset:0"/>
                </svg>
                {/if}
                <!-- Ring 3 (Month) -->
                {#if true}
                {@const r3 = ringParams(80, 9, mp, 22)}
                <svg width="80" height="80" viewBox="0 0 80 80" class="absolute inset-0" style="left:22px;top:22px">
                  <circle cx="40" cy="40" r={r3.r} fill="none" stroke-width="9" class="ring-track" stroke-linecap="round"/>
                  <circle cx="40" cy="40" r={r3.r} fill="none" stroke="var(--hue-ring-3)" stroke-width="9" stroke-linecap="round" stroke-dasharray="{r3.dash} {r3.c}" transform="rotate(-90 40 40)" class="ring-arc" style="--from-offset:{r3.c};--to-offset:0;animation-delay:240ms;stroke-dashoffset:0"/>
                </svg>
                {/if}

                <div class="absolute inset-0 flex items-center justify-center">
                  <div class="w-[54px] h-[54px] rounded-full flex items-center justify-center font-semibold text-[18px]"
                       style="background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                    {initials}
                  </div>
                </div>
              </div>
              <div class="flex-1 min-w-0">
                <p class="eyebrow mb-1">Játékos · {selectedYear}</p>
                <h1 class="text-[26px] font-bold tracking-tight leading-[1.05] text-fg-1 truncate">{selectedName}</h1>
                <p class="text-[13px] text-fg-2 mt-1.5">
                  <span class="font-mono-tnum font-semibold text-fg-1">{totalSessions}</span> alkalom összesen
                </p>
              </div>
            </div>
            <div class="grid grid-cols-3 border-t hairline">
              <div class="px-3 py-3" style="border-color:var(--line)">
                <div class="flex items-center gap-1.5 mb-1"><span class="w-1.5 h-1.5 rounded-full" style="background:var(--hue-ring-1)"></span><span class="eyebrow text-[10px]">Karrier</span></div>
                <p class="leading-none"><span class="font-mono-tnum font-semibold text-[20px] text-fg-1 num-display">{totalSessions}</span><span class="font-mono-tnum text-[11px] text-fg-3 ml-1">/ {careerGoal}</span></p>
              </div>
              <div class="px-3 py-3 border-l border-r" style="border-color:var(--line)">
                <div class="flex items-center gap-1.5 mb-1"><span class="w-1.5 h-1.5 rounded-full" style="background:var(--hue-ring-2)"></span><span class="eyebrow text-[10px]">Idei év</span></div>
                <p class="leading-none"><span class="font-mono-tnum font-semibold text-[20px] text-fg-1 num-display">{thisYearCount}</span><span class="font-mono-tnum text-[11px] text-fg-3 ml-1">/ {yearGoal}</span></p>
              </div>
              <div class="px-3 py-3" style="border-color:var(--line)">
                <div class="flex items-center gap-1.5 mb-1"><span class="w-1.5 h-1.5 rounded-full" style="background:var(--hue-ring-3)"></span><span class="eyebrow text-[10px]">Ez a hó</span></div>
                <p class="leading-none"><span class="font-mono-tnum font-semibold text-[20px] text-fg-1 num-display">{thisMonthCount}</span><span class="font-mono-tnum text-[11px] text-fg-3 ml-1">/ {monthGoal}</span></p>
              </div>
            </div>
          </div>
        </section>

        <!-- Stat Grid -->
        <section class="fade-up" style="animation-delay:80ms">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <!-- Összes -->
            <div class="card relative p-3.5 overflow-hidden lift">
              <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:rgba(239,68,68,0.10);filter:blur(8px)"></div>
              <div class="relative flex items-center justify-between mb-3">
                <span class="eyebrow text-[10px] truncate">Összes</span><span class="w-1.5 h-1.5 rounded-full" style="background:#ef4444"></span>
              </div>
              <p class="relative font-mono-tnum font-semibold text-[28px] leading-none num-display text-fg-1">{totalSessions}</p>
            </div>
            <!-- Idei -->
            <div class="card relative p-3.5 overflow-hidden lift">
              <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:rgba(245,158,11,0.10);filter:blur(8px)"></div>
              <div class="relative flex items-center justify-between mb-3">
                <span class="eyebrow text-[10px] truncate">{currentYear}</span><span class="w-1.5 h-1.5 rounded-full" style="background:#f59e0b"></span>
              </div>
              <p class="relative font-mono-tnum font-semibold text-[28px] leading-none num-display text-fg-1">{thisYearCount}</p>
            </div>
            <!-- E havi -->
            <div class="card relative p-3.5 overflow-hidden lift">
              <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:rgba(16,185,129,0.10);filter:blur(8px)"></div>
              <div class="relative flex items-center justify-between mb-3">
                <span class="eyebrow text-[10px] truncate">{currentYear}/{String(currentMonth).padStart(2,'0')}</span><span class="w-1.5 h-1.5 rounded-full" style="background:#10b981"></span>
              </div>
              <p class="relative font-mono-tnum font-semibold text-[28px] leading-none num-display text-fg-1">{thisMonthCount}</p>
            </div>
            <!-- Kiválasztott -->
            <div class="card relative p-3.5 overflow-hidden lift">
              <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:rgba(139,92,246,0.10);filter:blur(8px)"></div>
              <div class="relative flex items-center justify-between mb-3">
                <span class="eyebrow text-[10px] truncate">{selectedYear}</span><span class="w-1.5 h-1.5 rounded-full" style="background:#8b5cf6"></span>
              </div>
              <p class="relative font-mono-tnum font-semibold text-[28px] leading-none num-display text-fg-1">{selYearCount}</p>
            </div>
          </div>
        </section>

        <!-- Financial -->
        {#if selYearCount > 0}
          {@const est = estimateCost(selYearCount, selectedYear)}
          <section class="fade-up" style="animation-delay:120ms">
            <div class="flex items-end justify-between mb-3">
              <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Pénzügy</h2>
              <span class="eyebrow">{selectedYear}</span>
            </div>
            <div class="card relative p-5 overflow-hidden lift" style="border-radius:24px">
              <div class="absolute inset-0 opacity-90"
                   style="background:radial-gradient(120% 80% at 90% 0%,rgba(56,189,248,0.18) 0%,transparent 60%)"></div>
              <div class="relative">
                <div class="flex items-center justify-between">
                  <span class="eyebrow">Becsült összeg</span>
                  <span class="text-[10px] font-mono-tnum text-fg-3">{est.hourlyRate.toLocaleString('hu-HU')} Ft/h · {est.duration}h · {Math.round(est.avgAttendees)} fő</span>
                </div>
                <p class="font-mono-tnum num-display font-semibold text-[44px] leading-none mt-2 text-fg-1">
                  ~{formatHuf(est.precise)}
                </p>
                <p class="text-[12px] text-fg-2 mt-2 font-mono-tnum">
                  {formatHuf(est.costPerSessionPrecise)} / alkalom · {selYearCount} alkalom
                </p>
                <div class="mt-4 pt-4 border-t hairline flex items-center justify-between">
                  <div>
                    <p class="eyebrow text-[10px] mb-0.5">Egyszerű becslés</p>
                    <p class="text-[11px] text-fg-3 font-mono-tnum">2 300 Ft × {selYearCount}</p>
                  </div>
                  <p class="font-mono-tnum font-semibold text-[18px] num-display text-fg-1">{formatHuf(est.simple)}</p>
                </div>
              </div>
            </div>
            
            {#if isAdmin}
              {#if settlementsLoading}
                <div class="mt-3 card p-4 flex items-center gap-3" style="border-radius:20px">
                  <div class="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0" style="border-color:var(--accent) var(--line) var(--line) var(--line)"></div>
                  <span class="text-[12px] text-fg-3">Elszámolások betöltése…</span>
                </div>
              {:else if settlementRows.length === 0}
                <div class="mt-3 card-soft p-4 text-center" style="border-radius:20px">
                  <p class="text-[12px] text-fg-3">Nincs mentett elszámolás erre a játékosra.</p>
                </div>
              {:else}
                <div class="mt-3 card overflow-hidden" style="border-radius:20px">
                  <div class="px-3 py-2.5 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
                    <span class="eyebrow text-[10px]">Mentett elszámolások</span>
                    <span class="text-[10px] font-mono-tnum text-fg-3">{settlementRows.length} hónap</span>
                  </div>
                  <table class="w-full">
                    <thead>
                      <tr style="border-bottom:1px solid var(--line)">
                        <th class="px-3 py-2 text-left eyebrow text-[9px]">Hónap</th>
                        <th class="px-3 py-2 text-right eyebrow text-[9px]">Alkalom</th>
                        <th class="px-3 py-2 text-right eyebrow text-[9px]">Összeg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each settlementRows as r, i}
                        {@const isSelected = r.year === selectedYear}
                        <tr style="{i > 0 ? 'border-top:1px solid var(--line)' : ''}{isSelected ? ';background:color-mix(in oklab,var(--accent) 6%,transparent)' : ''}">
                          <td class="px-3 py-2 text-[11.5px] font-mono-tnum {isSelected ? 'font-semibold text-fg-1' : 'text-fg-2'}">{r.year}. {r.monthName}</td>
                          <td class="px-3 py-2 text-[11.5px] font-mono-tnum text-right {isSelected ? 'font-semibold text-fg-1' : 'text-fg-2'}">{r.count}</td>
                          <td class="px-3 py-2 text-[11.5px] font-mono-tnum text-right {isSelected ? 'font-semibold text-fg-1' : 'text-fg-2'}">{formatHuf(r.amount)}</td>
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr style="border-top:2px solid var(--line-strong)">
                        <td class="px-3 py-2 text-[11px] font-semibold text-fg-1">Összesen</td>
                        <td class="px-3 py-2 text-[11px] font-mono-tnum font-semibold text-fg-1 text-right">{settlementRows.reduce((s, r) => s + r.count, 0)}</td>
                        <td class="px-3 py-2 text-[11px] font-mono-tnum font-semibold text-fg-1 text-right">{formatHuf(settlementRows.reduce((s, r) => s + r.amount, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {/if}
            {/if}
          </section>
        {/if}

        <!-- Yearly Chart -->
        {#if byYearKeys.length === 0}
          <section class="fade-up">
            <h2 class="text-[20px] font-semibold tracking-tight text-fg-1 mb-3">Éves összesítő</h2>
            <div class="card-soft p-5 text-center" style="border-radius:24px"><p class="text-[14px] text-fg-3">Nincs még részvétel.</p></div>
          </section>
        {:else}
          <section class="fade-up" style="animation-delay:160ms">
            <div class="flex items-end justify-between mb-3">
              <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Éves összesítő</h2>
              <span class="eyebrow">{byYearKeys[0]}–{byYearKeys[byYearKeys.length-1]}</span>
            </div>
            <div class="card p-5" style="border-radius:24px">
              <div class="flex items-end gap-4" style="min-height:184px">
                {#each byYearKeys as y, i}
                  {@const v = byYearMap.get(y) ?? 0}
                  {@const h = Math.max(8, Math.round((v / byYearMax) * 140))}
                  {@const sel = y === selectedYear}
                  <div class="flex-1 flex flex-col items-center gap-2 min-w-0">
                    <span class="font-mono-tnum text-[12px] {sel ? 'font-semibold text-fg-1' : 'text-fg-2'}">{v}</span>
                    <div class="w-full max-w-[52px] relative">
                      <div class="bar-fill w-full rounded-t-[10px] {sel ? 'bar-brand' : ''}"
                           style="height:{h}px;animation-delay:{i*80}ms;{sel ? '' : 'background:color-mix(in oklab,var(--line-strong) 70%,transparent)'}"></div>
                    </div>
                    <span class="text-[11px] font-mono-tnum {sel ? 'font-semibold text-fg-1' : 'text-fg-3'}">{y}</span>
                  </div>
                {/each}
              </div>
            </div>
          </section>
        {/if}

        <!-- Monthly Chart -->
        {#if byMonthTotal === 0}
          <section class="fade-up">
            <h2 class="text-[20px] font-semibold tracking-tight text-fg-1 mb-3">Havi bontás — {selectedYear}</h2>
            <div class="card-soft p-5 text-center" style="border-radius:24px"><p class="text-[14px] text-fg-3">{selectedYear}-ben nincs részvétel.</p></div>
          </section>
        {:else}
          <section class="fade-up" style="animation-delay:200ms">
            <div class="flex items-end justify-between mb-3">
              <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Havi bontás</h2>
              <span class="eyebrow">{selectedYear} · {byMonthTotal} alkalom</span>
            </div>
            <div class="card p-5" style="border-radius:24px">
              <div class="flex items-end gap-1.5" style="min-height:136px">
                {#each byMonthArr as v, i}
                  {@const h = byMonthMax > 0 ? Math.max(4, Math.round((v / byMonthMax) * 100)) : 4}
                  {@const isCurrent = selectedYear === currentYear && i + 1 === currentMonth}
                  {@const empty = v === 0}
                  {@const cls = empty ? 'bar-empty' : isCurrent ? 'bar-brand' : 'bar-emerald'}
                  <div class="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                    <span class="text-[10px] font-mono-tnum {empty ? 'text-fg-3 opacity-60' : 'font-semibold text-fg-1'}">{v || '·'}</span>
                    <div class="bar-fill w-full max-w-[20px] rounded-t-[6px] {cls}"
                         style="height:{h}px;animation-delay:{i*40}ms"></div>
                    <span class="text-[10px] text-fg-3">{MONTH_SHORT[i]}</span>
                  </div>
                {/each}
              </div>
            </div>
          </section>
        {/if}

        <!-- Recent Sessions -->
        {#if playerSessions.length === 0}
          <section class="fade-up">
            <h2 class="text-[20px] font-semibold tracking-tight text-fg-1 mb-3">Utolsó alkalmak</h2>
            <div class="card-soft p-5 text-center" style="border-radius:24px"><p class="text-[14px] text-fg-3">Nincs még regisztrált alkalom.</p></div>
          </section>
        {:else}
          {@const recent = playerSessions.slice(0, 10)}
          <section class="fade-up" style="animation-delay:240ms">
            <div class="flex items-end justify-between mb-3">
              <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Utolsó {recent.length} alkalom</h2>
              <a href="#/" class="text-[12px] font-medium" style="color:var(--accent)">Összes →</a>
            </div>
            <div class="card overflow-hidden" style="border-radius:24px">
              <ol>
                {#each recent as s}
                  {@const isCurrent = s.year === currentYear && s.month === currentMonth}
                  {@const [,m,d] = s.date.split('-').map(Number)}
                  <li class="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hairline">
                    <div class="w-11 h-11 rounded-[12px] flex flex-col items-center justify-center flex-shrink-0"
                         style="background:{isCurrent ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'color-mix(in oklab,var(--fg-3) 12%,transparent)'}">
                      <span class="eyebrow text-[8px]" style="{isCurrent ? 'color:var(--accent-ink)' : ''}">{MONTH_SHORT[m-1]}</span>
                      <span class="font-mono-tnum font-semibold text-[15px] leading-none mt-0.5"
                            style="{isCurrent ? 'color:var(--accent-ink)' : 'color:var(--fg-1)'}">{d}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-[14px] font-medium text-fg-1">{formatDateHuLong(s.date)}</p>
                      <p class="text-[11px] text-fg-3 font-mono-tnum">{s.year} · {String(m).padStart(2,'0')}. hónap</p>
                    </div>
                    <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style="background:rgba(16,185,129,0.12);color:#047857">✓ Részt vett</span>
                  </li>
                {/each}
              </ol>
            </div>
          </section>
        {/if}

      </div>
    {/if}
  </main>
</div>
