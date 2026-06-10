<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Header from '../components/Header.svelte';
  import { MAIN_NAME_LIST } from '../lib/config';
  import {
    pastTuesdaysForDisplay,
    formatDateHuLong,
    formatMonthShortHu,
    dayOf,
    todayInHungary,
  } from '../lib/dates';
  import {
    addAttendanceBatch,
    getAllAttendanceRecords,
    type RawAttendance,
    type NewAttendanceRow,
  } from '../lib/firestore';

  const MAX_GUESTS = 10;

  interface AdminEntry {
    present: boolean;
    guestCount: number;
    guestNames: string[];
  }

  // State
  let step = $state<1 | 2 | 3>(1);
  let dates = $state<string[]>([]);
  let selectedDate = $state<string>('');
  let dateMenuOpen = $state(false);
  let toast = $state<{ kind: 'success' | 'error'; msg: string } | null>(null);
  let saving = $state(false);

  // Map state for entries
  let entries = $state<Map<string, AdminEntry>>(new Map());
  
  // Historical data for guests
  let historicalAll = $state<RawAttendance[]>([]);
  let historicalLoading = $state(false);

  // Derived / Computed
  let presentCount = $derived([...entries.values()].filter((e) => e.present).length);
  let totalGuestCount = $derived([...entries.values()].filter((e) => e.present).reduce((s, e) => s + e.guestCount, 0));
  let step1Valid = $derived(presentCount > 0);
  
  let sortedDates = $derived([...dates].sort((a, b) => b.localeCompare(a)));

  // Setup
  onMount(() => {
    const ds = pastTuesdaysForDisplay(9);
    dates = ds;
    selectedDate = ds[ds.length - 1] ?? '';

    const initialEntries = new Map<string, AdminEntry>();
    for (const n of MAIN_NAME_LIST) {
      initialEntries.set(n, { present: false, guestCount: 0, guestNames: [] });
    }
    entries = initialEntries;

    // Handle outside click for datepicker
    const handleOutsideClick = (e: MouseEvent) => {
      if (dateMenuOpen && !(e.target as Element).closest('#admin-datepicker')) {
        dateMenuOpen = false;
      }
    };
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dateMenuOpen) {
        dateMenuOpen = false;
      }
    };
    
    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleKeydown);
    };
  });

  function showToast(kind: 'success' | 'error', msg: string) {
    toast = { kind, msg };
    setTimeout(() => { if (toast?.msg === msg) toast = null; }, 2500);
  }

  async function ensureHistoricalLoaded() {
    if (historicalAll.length > 0 || historicalLoading) return;
    historicalLoading = true;
    try {
      historicalAll = await getAllAttendanceRecords();
    } catch {
      // ignore
    } finally {
      historicalLoading = false;
    }
  }

  // Actions
  function togglePresent(name: string, checked: boolean) {
    const e = entries.get(name)!;
    e.present = checked;
    if (!checked) {
      e.guestCount = 0;
      e.guestNames = [];
    }
    entries.set(name, e);
    entries = new Map(entries); // trigger reactivity
  }

  function applyGuestCount(name: string, next: number) {
    const e = entries.get(name)!;
    if (!e.present) return;
    const clamped = Math.max(0, Math.min(MAX_GUESTS, next));
    if (clamped === e.guestCount) return;
    e.guestCount = clamped;
    while (e.guestNames.length < e.guestCount) e.guestNames.push('');
    e.guestNames.length = e.guestCount;
    entries.set(name, e);
    entries = new Map(entries);
  }

  function handleGuestNameChange(name: string, idx: number, val: string, isCustom: boolean) {
    const e = entries.get(name)!;
    if (isCustom) {
      e.guestNames[idx] = val;
    } else {
      e.guestNames[idx] = val;
    }
    entries.set(name, e);
    entries = new Map(entries);
  }

  async function handleSave() {
    if (saving) return;
    saving = true;
    try {
      const rows: NewAttendanceRow[] = [];
      for (const name of MAIN_NAME_LIST) {
        const e = entries.get(name)!;
        if (!e.present) continue;
        rows.push({ name, status: 'Yes', event_date: selectedDate, mode: 'valós' });
        for (let i = 0; i < e.guestCount; i++) {
          const gName = (e.guestNames[i] ?? '').trim();
          if (gName) {
            rows.push({ name: `${name} - ${gName}`, status: 'Yes', event_date: selectedDate, mode: 'valós' });
          }
        }
      }
      const saved = await addAttendanceBatch(rows);
      showToast('success', `✓ ${saved} rekord mentve`);
      
      // Reset
      step = 1;
      const nextEntries = new Map(entries);
      for (const e of nextEntries.values()) {
        e.present = false;
        e.guestCount = 0;
        e.guestNames = [];
      }
      entries = nextEntries;
    } catch (err) {
      showToast('error', `Hiba: ${String(err)}`);
    } finally {
      saving = false;
    }
  }

  // Utils
  function diffDays(iso: string): number {
    const today = todayInHungary();
    const a = new Date(today + 'T12:00:00Z').getTime();
    const b = new Date(iso + 'T12:00:00Z').getTime();
    return Math.round((b - a) / 86400000);
  }

  function relativeLabel(iso: string): string | null {
    const d = diffDays(iso);
    if (d === 0) return 'Ma';
    if (d === 1) return 'Holnap';
    if (d === -1) return 'Tegnap';
    if (d > 1 && d <= 14) return `${d} nap múlva`;
    if (d < -1 && d >= -14) return `${-d} napja`;
    return null;
  }

  function getHistoricalGuests(host: string): string[] {
    const prefix = `${host} - `;
    const guests = new Set<string>();
    for (const r of historicalAll) {
      if (r.name.startsWith(prefix)) {
        const g = r.name.slice(prefix.length).trim();
        if (g) guests.add(g);
      }
    }
    return [...guests].sort((a, b) => a.localeCompare(b, 'hu'));
  }

  function nameInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  }

  function avatarHue(name: string): number {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return Math.abs(h) % 360;
  }
</script>

<div class="device relative">
  <Header currentPage="admin" />
  
  <main id="admin-body">
    <div class="px-5 pt-5 pb-12 lg:px-6 lg:pt-5 space-y-4">
      
      <!-- Step Bar -->
      <div class="card flex items-center justify-between p-3 fade-up" style="border-radius:18px">
        {#each [{n:1, label:'Jelenlét'}, {n:2, label:'Vendégek'}, {n:3, label:'Mentés'}] as s, i}
          <div class="flex items-center flex-1 {i < 2 ? 'gap-2' : ''}">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0"
                 style="background:{step >= s.n ? 'var(--accent)' : 'var(--bg-elev)'};color:{step >= s.n ? 'white' : 'var(--fg-3)'}">
              {s.n}
            </div>
            <span class="text-[12px] font-medium" style="color:{step === s.n ? 'var(--fg-1)' : 'var(--fg-3)'}">{s.label}</span>
            {#if i < 2}
              <div class="flex-1 h-[2px]" style="background:{step > s.n ? 'var(--accent)' : 'var(--line)'}"></div>
            {/if}
          </div>
        {/each}
      </div>

      {#if step === 1}
        <!-- Step 1: Dátum választó -->
        <div id="admin-datepicker" class="relative fade-up" style="z-index:20">
          <span class="eyebrow mb-1.5 block">Dátum</span>
          <button type="button" aria-expanded={dateMenuOpen} onclick={() => dateMenuOpen = !dateMenuOpen}
            class="card w-full flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-[color:var(--bg-elev)]"
            style="border-radius:14px;border-color:{dateMenuOpen ? 'var(--accent)' : 'var(--line-strong)'}">
            <div class="rounded-xl flex items-center justify-center flex-shrink-0"
                 style="width:42px;height:42px;background:color-mix(in oklab, var(--accent) 14%, transparent)">
              <div class="flex flex-col items-center leading-none">
                <span class="text-[7px] font-bold uppercase tracking-widest" style="color:var(--accent-ink)">{formatMonthShortHu(selectedDate)}</span>
                <span class="font-mono-tnum font-bold text-[16px] mt-0.5" style="color:var(--accent-ink)">{dayOf(selectedDate)}</span>
              </div>
            </div>
            <div class="flex-1 min-w-0 text-left">
              <p class="text-[14px] font-semibold text-fg-1 truncate">{formatDateHuLong(selectedDate)}</p>
              {#if true}
              {@const relLabel = relativeLabel(selectedDate)}
              {#if relLabel}
                <p class="text-[11px] font-medium mt-0.5" style="color:var(--accent-ink)">{relLabel}</p>
              {:else}
                <p class="text-[11px] text-fg-3 mt-0.5">Válassz másikat ha kell</p>
              {/if}
              {/if}
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                 style="color:var(--fg-3);flex:none;transition:transform 200ms;transform:rotate({dateMenuOpen ? '180deg' : '0deg'})">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {#if dateMenuOpen}
            <div class="card overflow-hidden"
              style="position:absolute;top:calc(100% + 6px);left:0;right:0;border-radius:14px;box-shadow:var(--shadow-lg);max-height:340px;overflow-y:auto;animation:fadeUp 160ms ease both">
              {#each sortedDates as d}
                {@const isSel = d === selectedDate}
                {@const rel = relativeLabel(d)}
                {@const longParts = formatDateHuLong(d).split(',')}
                {@const yearPart = longParts[0]?.split('.')[0]?.trim() ?? ''}
                {@const weekday = longParts[1]?.trim() ?? 'kedd'}
                <button type="button" onclick={() => { selectedDate = d; dateMenuOpen = false; }}
                  class="w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[color:color-mix(in oklab,var(--accent) 10%,transparent)]"
                  style="background:{isSel ? 'var(--accent)' : 'transparent'};color:{isSel ? '#fff' : 'inherit'};{isSel ? '' : 'border-top:1px solid var(--line);'}">
                  <div class="flex flex-col items-center flex-shrink-0" style="min-width:34px">
                    <span class="text-[9px] font-semibold uppercase tracking-widest"
                          style="color:{isSel ? 'rgba(255,255,255,0.85)' : 'var(--fg-3)'}">{formatMonthShortHu(d)}</span>
                    <span class="font-mono-tnum font-semibold text-[19px] leading-tight"
                          style="color:{isSel ? '#fff' : 'var(--fg-1)'}">{dayOf(d)}</span>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-[12.5px] font-semibold leading-tight" style="color:{isSel ? '#fff' : 'var(--fg-1)'}">{weekday}</p>
                    <p class="text-[10.5px] font-mono-tnum mt-0.5" style="color:{isSel ? 'rgba(255,255,255,0.75)' : 'var(--fg-3)'}">{yearPart}</p>
                  </div>
                  {#if rel}
                    <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style="background:{isSel ? 'rgba(255,255,255,0.18)' : 'color-mix(in oklab,var(--accent) 14%,transparent)'};color:{isSel ? '#fff' : 'var(--accent-ink)'}">{rel}</span>
                  {/if}
                  {#if isSel}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><polyline points="20 6 9 17 4 12"/></svg>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Statisztika -->
        <div class="grid grid-cols-2 gap-2 fade-up">
          <div class="card p-3.5">
            <p class="eyebrow text-[10px] mb-1">Jelen</p>
            <p class="font-mono-tnum font-semibold text-[24px] leading-none text-fg-1 num-display">{presentCount}</p>
          </div>
          <div class="card p-3.5">
            <p class="eyebrow text-[10px] mb-1">Vendégek</p>
            <p class="font-mono-tnum font-semibold text-[24px] leading-none text-fg-1 num-display">{totalGuestCount}</p>
          </div>
        </div>

        <!-- Tagok -->
        <div class="card overflow-hidden fade-up" style="border-radius:22px">
          <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
            <span class="eyebrow">Tagok</span>
            <span class="eyebrow">Plusz ember</span>
          </div>
          <ul>
            {#each MAIN_NAME_LIST as name}
              {@const entry = entries.get(name)!}
              {@const hue = avatarHue(name)}
              {@const initials = nameInitials(name)}
              <li class="flex items-center gap-3 px-4 py-2.5" style="border-top:1px solid var(--line)">
                <label class="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                  <input type="checkbox" checked={entry.present} onchange={(e) => togglePresent(name, e.currentTarget.checked)} class="w-4 h-4 rounded flex-shrink-0" style="accent-color:var(--accent)" />
                  <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
                       style="width:30px;height:30px;background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                    {initials}
                  </div>
                  <span class="text-[13px] font-medium text-fg-1 truncate">{name}</span>
                </label>
                
                <div class="admin-guest-stepper inline-flex items-center select-none {entry.guestCount > 0 ? 'is-active' : ''}"
                     style="{entry.present ? '' : 'opacity:0.35;pointer-events:none;filter:saturate(0)'}">
                  <button type="button" aria-label="Vendég csökkentése" class="stepper-btn {entry.guestCount <= 0 ? 'is-disabled' : ''}" disabled={entry.guestCount <= 0} onclick={() => applyGuestCount(name, entry.guestCount - 1)}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 8h8"/>
                    </svg>
                  </button>
                  <div class="stepper-num font-mono-tnum num-display">{entry.guestCount}</div>
                  <button type="button" aria-label="Vendég növelése" class="stepper-btn {entry.guestCount >= MAX_GUESTS ? 'is-disabled' : ''}" disabled={entry.guestCount >= MAX_GUESTS} onclick={() => applyGuestCount(name, entry.guestCount + 1)}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 8h8M8 4v8"/>
                    </svg>
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        </div>

        <div class="flex justify-end gap-2 fade-up">
          <button class="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-opacity {step1Valid ? '' : 'opacity-50 cursor-not-allowed'}"
            style="background:var(--accent)" disabled={!step1Valid} onclick={() => { step = 2; ensureHistoricalLoaded(); }}>
            Tovább →
          </button>
        </div>

      {:else if step === 2}
        <!-- Step 2: Vendégek nevei -->
        {@const hostsWithGuests = MAIN_NAME_LIST.filter(n => { const e = entries.get(n)!; return e.present && e.guestCount > 0; })}
        
        {#if hostsWithGuests.length === 0}
          <div class="card-soft p-6 text-center fade-up" style="border-radius:22px">
            <div class="text-3xl mb-2">✨</div>
            <p class="text-[14px] font-semibold text-fg-1">Nincsenek vendégek</p>
            <p class="text-[12px] text-fg-3 mt-1">Mehetünk tovább az összesítésre.</p>
          </div>
        {:else}
          <div class="space-y-3">
            {#each hostsWithGuests as host}
              {@const entry = entries.get(host)!}
              {@const history = getHistoricalGuests(host)}
              {@const hue = avatarHue(host)}
              {@const initials = nameInitials(host)}
              <div class="card p-4 fade-up">
                <div class="flex items-center gap-2.5 mb-3">
                  <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
                       style="width:28px;height:28px;background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                    {initials}
                  </div>
                  <p class="text-[14px] font-semibold text-fg-1 flex-1 min-w-0 truncate">{host} vendégei ({entry.guestCount})</p>
                </div>
                <div class="space-y-2.5">
                  {#each Array(entry.guestCount) as _, i}
                    {@const current = entry.guestNames[i] ?? ''}
                    {@const inHistory = history.includes(current)}
                    {@const sel = inHistory ? current : current ? '__custom' : ''}
                    <div class="space-y-1.5">
                      <label class="block">
                        <span class="text-[10px] font-semibold text-fg-3 uppercase tracking-wider">{i + 1}. vendég</span>
                        <select class="select-native mt-1 w-full rounded-[10px] border px-2.5 py-2 text-[13px] focus:outline-none"
                          style="border-color:var(--line-strong);background:var(--bg-card)"
                          value={sel} onchange={(e) => {
                            const val = e.currentTarget.value;
                            if (val !== '__custom' && val !== '') {
                              handleGuestNameChange(host, i, val, false);
                            } else {
                              // If custom selected, keep current value but show input
                              handleGuestNameChange(host, i, current, true);
                            }
                          }}>
                          <option value="">— Új név írása —</option>
                          {#each history as h}
                            <option value={h}>{h}</option>
                          {/each}
                          <option value="__custom">— Egyéni név —</option>
                        </select>
                      </label>
                      <input class="w-full rounded-[10px] border px-2.5 py-2 text-[13px] focus:outline-none {sel === '__custom' || (sel === '' && !inHistory && current) || sel === '' ? '' : 'hidden'}"
                        style="border-color:var(--line-strong);background:var(--bg-card)"
                        type="text" value={inHistory ? '' : current} placeholder="Vendég neve…"
                        oninput={(e) => handleGuestNameChange(host, i, e.currentTarget.value, true)} />
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <div class="flex justify-between gap-2 fade-up">
          <button class="px-5 py-2.5 rounded-full text-[13px] font-semibold transition-colors" style="background:var(--bg-elev);color:var(--fg-2)" onclick={() => step = 1}>
            ← Vissza
          </button>
          <button class="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm" style="background:var(--accent)" onclick={() => step = 3}>
            Tovább →
          </button>
        </div>

      {:else if step === 3}
        <!-- Step 3: Mentés -->
        {@const presentList = MAIN_NAME_LIST.filter((n) => entries.get(n)!.present)}
        <div class="card p-4 fade-up">
          <p class="eyebrow text-[10px] mb-1">Dátum</p>
          <p class="text-[16px] font-semibold text-fg-1">{formatDateHuLong(selectedDate)}</p>
          <p class="text-[12px] text-fg-3 mt-2">
            <span class="font-mono-tnum font-semibold text-fg-1">{presentCount + totalGuestCount}</span> rekord kerül mentésre
          </p>
        </div>

        <div class="card overflow-hidden fade-up" style="border-radius:22px">
          <div class="px-4 py-3" style="border-bottom:1px solid var(--line)">
            <span class="eyebrow">Összesítés</span>
          </div>
          <ul>
            {#each presentList as name}
              {@const entry = entries.get(name)!}
              {@const initials = nameInitials(name)}
              {@const hue = avatarHue(name)}
              {@const validGuests = entry.guestNames.slice(0, entry.guestCount).filter(g => g.trim())}
              <li class="px-4 py-2.5" style="border-top:1px solid var(--line)">
                <div class="flex items-center gap-2.5">
                  <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
                       style="width:28px;height:28px;background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                    {initials}
                  </div>
                  <span class="text-[13px] font-semibold text-fg-1">{name}</span>
                </div>
                {#if validGuests.length > 0}
                  <ul class="mt-1.5 space-y-0.5">
                    {#each validGuests as g}
                      <li class="text-[12px] text-fg-2 ml-9">↳ {g.trim()}</li>
                    {/each}
                  </ul>
                {/if}
              </li>
            {/each}
          </ul>
        </div>

        <div class="flex justify-between gap-2 fade-up">
          <button class="px-5 py-2.5 rounded-full text-[13px] font-semibold transition-colors {saving ? 'opacity-50 cursor-not-allowed' : ''}" style="background:var(--bg-elev);color:var(--fg-2)" disabled={saving} onclick={() => step = 2}>
            ← Vissza
          </button>
          <button class="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-opacity {saving ? 'opacity-60 cursor-not-allowed' : ''}" style="background:var(--accent)" disabled={saving} onclick={handleSave}>
            {saving ? 'Mentés…' : '💾 Mentés'}
          </button>
        </div>
      {/if}
      
    </div>
  </main>

  <!-- Toast -->
  {#if toast}
    <div class="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full shadow-lg text-[12.5px] font-semibold fade-up transition-all"
      style="bottom:24px; {toast.kind === 'success' ? 'background:color-mix(in oklab,#10b981 14%,var(--bg-card));border:1px solid color-mix(in oklab,#10b981 30%,var(--line));color:#047857' : 'background:color-mix(in oklab,var(--danger) 14%,var(--bg-card));border:1px solid color-mix(in oklab,var(--danger) 30%,var(--line));color:var(--danger-ink)'}">
      {toast.msg}
    </div>
  {/if}
</div>
