<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
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

  let loading = $state(true);
  let yearStats = $state<YearStats[]>([]);
  let allTimeSessions = $state(0);
  let allTimePlayers = $state(0);

  onMount(() => {
    initData();
  });

  async function initData() {
    try {
      const records = await getAllAttendanceRecords();
      buildState(records);
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  function buildState(records: RawAttendance[]) {
    const yes = records.filter((r) => r.status === 'Yes' && r.event_date);

    allTimeSessions = new Set(yes.map((r) => r.event_date)).size;
    allTimePlayers = new Set(yes.map((r) => r.name)).size;

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

    yearStats = [...byYear.entries()]
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
  }

  function avatarHue(name: string): number {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return Math.abs(h) % 360;
  }
</script>

<div class="device">
  <Header currentPage="yearly" />
  <main>
    {#if loading}
      <div class="px-5 pt-5 space-y-3">
        <div class="grid grid-cols-2 gap-2.5">
          <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
          <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        </div>
        {#each Array(4) as _}
          <div class="h-32 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        {/each}
      </div>
    {:else if yearStats.length === 0}
      <div class="px-5 pt-12 text-center fade-up">
        <p class="text-[16px] font-semibold text-fg-1 mb-1">Nincs adat</p>
        <p class="text-[13px] text-fg-3">Még nincs rögzített részvétel.</p>
      </div>
    {:else}
      <div class="px-5 pt-5 pb-12 space-y-4 fade-up">
        <!-- Summary Cards -->
        <div class="grid grid-cols-2 gap-2.5">
          <div class="card relative p-4 overflow-hidden lift">
            <div class="absolute -top-3 -right-3 w-16 h-16 rounded-full" style="background:color-mix(in oklab,var(--accent) 10%,transparent);filter:blur(10px)"></div>
            <div class="relative">
              <div class="flex items-center justify-between mb-2">
                <span class="eyebrow text-[10px]">Összes alkalom</span>
                <span class="w-1.5 h-1.5 rounded-full" style="background:var(--accent)"></span>
              </div>
              <p class="font-mono-tnum font-semibold text-[28px] leading-none num-display text-fg-1">{allTimeSessions}</p>
              <p class="text-[11px] text-fg-3 mt-1">
                {yearStats.length > 1 ? `${yearStats[yearStats.length - 1].year}–${yearStats[0].year}` : yearStats[0]?.year}
              </p>
            </div>
          </div>
          
          <div class="card relative p-4 overflow-hidden lift">
            <div class="absolute -top-3 -right-3 w-16 h-16 rounded-full" style="background:rgba(14,165,233,0.10);filter:blur(10px)"></div>
            <div class="relative">
              <div class="flex items-center justify-between mb-2">
                <span class="eyebrow text-[10px]">Egyedi játékos</span>
                <span class="w-1.5 h-1.5 rounded-full" style="background:#0ea5e9"></span>
              </div>
              <p class="font-mono-tnum font-semibold text-[28px] leading-none num-display text-fg-1">{allTimePlayers}</p>
              <p class="text-[11px] text-fg-3 mt-1">összesen</p>
            </div>
          </div>
        </div>

        <!-- Year Cards -->
        {#each yearStats as ys}
          {@const maxMonth = Math.max(...ys.byMonth, 1)}
          {@const hue = avatarHue(ys.topPlayer)}
          <div class="card p-4 fade-up" style="border-radius:22px">
            <div class="flex items-start justify-between mb-3">
              <div>
                <p class="font-mono-tnum font-semibold text-[26px] leading-none num-display text-fg-1">{ys.year}</p>
                <p class="eyebrow text-[10px] mt-1">{ys.sessions} alkalom · ~{ys.avgAttendees} fő / alkalom</p>
              </div>
              {#if ys.topPlayer}
                <div class="flex items-center gap-2">
                  <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[9px]"
                       style="width:28px;height:28px;background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                    {getInitials(ys.topPlayer)}
                  </div>
                  <div>
                    <p class="text-[11px] font-semibold text-fg-1">{ys.topPlayer}</p>
                    <p class="text-[10px] text-fg-3">{ys.topPlayerCount} alkalom</p>
                  </div>
                </div>
              {/if}
            </div>
            
            <div class="flex items-end gap-1" style="min-height:62px">
              {#each ys.byMonth as v, i}
                {@const h = v > 0 ? Math.max(2, Math.round((v / maxMonth) * 48)) : 2}
                {@const cls = v === 0 ? 'bar-empty' : 'bar-emerald'}
                <div class="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                  <div class="bar-fill w-full max-w-[14px] rounded-t-[4px] {cls}" style="height:{h}px;animation-delay:{i*30}ms"></div>
                  <span class="text-[8px] text-fg-3">{MONTH_SHORT[i]?.slice(0, 1)}</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>
