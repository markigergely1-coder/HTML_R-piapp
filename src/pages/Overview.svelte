<script lang="ts">
  import { onMount } from 'svelte';
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
  import Header from '../components/Header.svelte';

  let dates = $state<string[]>(pastTuesdaysForDisplay(9));
  let upcoming = $state(dates[dates.length - 1] ?? '');
  let selected = $state(dates[dates.length - 1] ?? '');
  
  let attendeesByDate = $state<Map<string, string[]>>(new Map());
  let cancelled = $state<Map<string, CancelledSession>>(new Map());
  let selfMember = $state<Member | null>(null);
  let selfRegistering = $state(false);
  let editMode = $state(false);
  let pendingDelete = $state<{ name: string; date: string } | null>(null);
  let deleting = $state(false);

  // Derived state
  let selectedIsCancelled = $derived(cancelled.has(selected));
  let dataLoaded = $derived(attendeesByDate.has(selected));
  let selectedAttendees = $derived(attendeesByDate.get(selected) ?? []);
  let count = $derived(selectedIsCancelled ? 0 : selectedAttendees.length);
  let isPast = $derived(isDateInPast(selected));
  let isReady = $derived(count >= 8);

  // Auth & Load
  let authState = $state(getAuthState());

  onMount(() => {
    // 1) Cancelled sessions
    getCancelledSessions().then(c => cancelled = c).catch(() => {});

    // 2) Attendees
    getAttendeesByDates(dates).then(a => attendeesByDate = a).catch(() => {});

    // 3) Self member
    if (authState.user?.email) {
      getMemberByEmail(authState.user.email).then(m => selfMember = m).catch(() => {});
    }

    // Scroll selected chip into view shortly after mount
    setTimeout(() => scrollDateChipIntoView(selected, false), 100);
  });

  // Effects
  $effect(() => {
    if (selected) {
      scrollDateChipIntoView(selected, true);
    }
  });

  // Utils
  function isDateInPast(iso: string): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    target.setHours(0, 0, 0, 0);
    return target.getTime() < today.getTime();
  }

  function avatarHue(name: string): number {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return Math.abs(h) % 360;
  }

  function getRelativeLabel(iso: string): string | null {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1, d));
    const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return 'Ma';
    if (diff === 1) return 'Holnap';
    if (diff === -1) return 'Tegnap';
    if (diff > 1 && diff < 7) return `${diff} nap múlva`;
    if (diff < -1 && diff > -7) return `${-diff} napja`;
    return null;
  }

  function scrollDateChipIntoView(date: string, smooth: boolean) {
    const scroller = document.getElementById('date-scroller');
    if (!scroller) return;
    const chip = scroller.querySelector(`[data-date="${date}"]`) as HTMLElement;
    if (!chip) return;
    const targetLeft = chip.offsetLeft - (scroller.offsetWidth - chip.offsetWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, targetLeft), behavior: smooth ? 'smooth' : 'instant' });
  }

  // Actions
  function selectDate(d: string) {
    if (cancelled.has(d)) return;
    selected = d;
    editMode = false;
  }

  async function handleSelfReg() {
    if (!selfMember || selfRegistering) return;
    const isGoing = selectedAttendees.includes(selfMember.name);
    selfRegistering = true;
    try {
      await upsertSelfRegistration(selfMember.name, selected, isGoing ? 'No' : 'Yes');
      const fresh = await getAttendeesByDates([selected]);
      attendeesByDate.set(selected, fresh.get(selected) ?? []);
      attendeesByDate = new Map(attendeesByDate); // trigger reactivity
    } finally {
      selfRegistering = false;
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    const { name, date } = pendingDelete;
    deleting = true;
    try {
      await deleteAttendanceForPlayerOnDate(name, date);
      const fresh = await getAttendeesByDates([date]);
      attendeesByDate.set(date, fresh.get(date) ?? []);
      attendeesByDate = new Map(attendeesByDate);
    } catch (err) {
      console.warn('[overview] Delete failed:', err);
    } finally {
      deleting = false;
      pendingDelete = null;
    }
  }

  // Snippets helper variables
  let dayNames = ['vasárnap','hétfő','kedd','szerda','csütörtök','péntek','szombat'];
  let monthNames = ['január','február','március','április','május','június','július','augusztus','szeptember','október','november','december'];

  // Hero calculations
  $effect(() => {
    // Just to keep reactivity tracking clean
  });
</script>

<div class="device relative">
  <Header currentPage="overview" />
  
  <div class="lg:grid lg:grid-cols-[300px_1fr_260px] lg:gap-6 lg:p-6 lg:pt-5 lg:items-start">
    <!-- Bal oszlop: Hero -->
    <div id="hero-wrapper" class="lg:sticky lg:top-[110px]">
      <section class="relative px-5 pt-5 pb-2 fade-up">
        <div class="halo"></div>
        <div class="relative card noise lift overflow-hidden" style="border-radius:28px">
          <!-- Volleyball Art -->
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
          </div>
          
          <div class="relative p-5">
            <div class="flex items-center justify-between mb-3">
              <span class="eyebrow">Kiválasztott alkalom</span>
              {#if selectedIsCancelled}
                <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full" style="background:rgba(120,120,120,0.14);color:var(--fg-2)">Elmarad</span>
              {:else if getRelativeLabel(selected)}
                <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full" style="background:color-mix(in oklab,var(--accent) 14%,transparent);color:var(--accent-ink)">{getRelativeLabel(selected)}</span>
              {/if}
            </div>

            {#if true}
            {@const [y, m, d] = selected.split('-').map(Number)}
            {@const dt = new Date(Date.UTC(y, m - 1, d))}
            {@const dayName = dayNames[dt.getUTCDay()]}
            {@const monthLong = monthNames[m - 1]}

            <div class="flex items-baseline gap-3 mb-1">
              <p class="font-mono-tnum num-display font-semibold text-[64px] leading-none text-fg-1"
                 style={selectedIsCancelled ? 'text-decoration:line-through;text-decoration-color:var(--fg-3)' : ''}>{d}</p>
              <div class="leading-tight">
                <p class="text-[15px] font-semibold text-fg-1 capitalize">{monthLong}</p>
                <p class="text-[12px] text-fg-3 capitalize">{dayName} · {y}</p>
              </div>
            </div>

            {#if selectedIsCancelled}
              <div class="mt-4">
                <p class="text-[14px] font-semibold text-fg-1">Elmarad</p>
                <p class="text-[12px] text-fg-2 mt-0.5">{cancelled.get(selected)?.reason ?? ''}</p>
              </div>
            {:else}
              {#if true}
              {@const statusText = !dataLoaded ? 'Betöltés…' : isPast ? (count > 0 ? 'Volt játék' : 'Nem volt játék') : (isReady ? 'Lesz edzés ✓' : `Még ${8 - count} fő kell`)}
              {@const statusIsGood = !dataLoaded ? false : isPast ? count > 0 : isReady}
              {@const peopleSubtext = dataLoaded ? `${count} fő ${isPast ? 'volt jelen' : 'jelentkezett'}` : 'Adatok betöltése'}
              
              <div class="mt-4 flex items-center gap-3">
                <div class="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                     style="background:{statusIsGood ? 'color-mix(in oklab,#10b981 16%,transparent)' : 'color-mix(in oklab,var(--fg-3) 12%,transparent)'};border:1px solid color-mix(in oklab,currentColor 20%,transparent);color:{statusIsGood ? '#047857' : 'var(--fg-2)'}">
                  <span class="font-mono-tnum font-bold text-[18px] num-display">{dataLoaded ? count : '·'}</span>
                </div>
                <div class="min-w-0">
                  <p class="text-[14px] font-semibold text-fg-1">{peopleSubtext}</p>
                  <p class="text-[12px] text-fg-2">{statusText}</p>
                </div>
              </div>
            {/if}

            <!-- Önregisztráció gomb -->
            {#if !selectedIsCancelled && !isPast && selfMember}
              {#if selfRegistering}
                <div class="mt-3 flex items-center gap-2 px-3 py-2">
                  <div class="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0" style="border-color:var(--accent) var(--line) var(--line) var(--line)"></div>
                  <span class="text-[12px] text-fg-3">Mentés…</span>
                </div>
              {:else if selectedAttendees.includes(selfMember.name)}
                <button onclick={handleSelfReg} class="mt-3 w-full py-2.5 rounded-2xl text-[13px] font-semibold transition-colors"
                  style="border:1.5px solid var(--accent);color:var(--accent-ink);background:color-mix(in oklab,var(--accent) 8%,transparent)">
                  ✓ Megyek — visszavonás
                </button>
              {:else}
                <button onclick={handleSelfReg} class="mt-3 w-full py-2.5 rounded-2xl text-[13px] font-semibold text-white transition-colors"
                  style="background:var(--accent)">
                  Megyek →
                </button>
              {/if}
              {/if}
            {/if}
            {/if}
          </div>
        </div>
      </section>
    </div>

    <!-- Középső oszlop -->
    <div class="lg:min-w-0">
      <!-- Scroller (mobil) -->
      <div class="lg:hidden">
        <section class="px-5 pt-4 pb-1 lg:px-0 lg:pt-0">
          <div class="flex items-end justify-between mb-2">
            <span class="eyebrow">Válassz alkalmat</span>
            <span class="eyebrow text-[10px]">{dates.length} alkalom</span>
          </div>
          <div id="date-scroller" class="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 pb-2 lg:mx-0 lg:px-0">
            {#each dates as date}
              {@const isCancelled = cancelled.has(date)}
              {@const isSelected = date === selected}
              {@const isUpcoming = date === upcoming}
              {@const loaded = attendeesByDate.has(date)}
              {@const c = attendeesByDate.get(date)?.length ?? 0}
              {@const d = dayOf(date)}
              {@const monthShort = formatMonthShortHu(date)}
              
              <button onclick={() => selectDate(date)} class="date-btn relative flex-none flex flex-col items-center px-3.5 py-2.5 rounded-2xl border transition-colors"
                data-date={date}
                style="background:{isCancelled ? 'color-mix(in oklab,var(--fg-3) 8%,transparent)' : isSelected ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'var(--bg-card)'}; border-color:{isSelected ? 'var(--accent)' : 'var(--line)'}; min-width:60px; opacity:{isCancelled ? '0.55' : '1'};"
                disabled={isCancelled}>
                {#if isUpcoming && !isCancelled}
                  <span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style="background:#10b981;box-shadow:0 0 0 2px var(--bg-card)"></span>
                {/if}
                <span class="text-[9px] font-semibold uppercase tracking-widest"
                      style="color:{isSelected ? 'var(--accent-ink)' : 'var(--fg-3)'}; {isCancelled ? 'text-decoration:line-through' : ''}">
                  {monthShort}
                </span>
                <span class="font-mono-tnum font-semibold text-[20px] leading-tight mt-0.5"
                      style="color:{isSelected ? 'var(--accent-ink)' : 'var(--fg-1)'}; {isCancelled ? 'text-decoration:line-through' : ''}">
                  {d}
                </span>
                <span class="text-[10px] mt-0.5 font-mono-tnum"
                      style="color:{isSelected ? 'var(--accent-ink)' : 'var(--fg-3)'}">
                  {isCancelled ? '—' : loaded ? `${c} fő` : '·'}
                </span>
              </button>
            {/each}
          </div>
        </section>
      </div>

      <!-- Résztvevők -->
      <div id="result-main" class="px-5 pt-3 pb-10 lg:px-0 lg:pt-0 lg:pb-2">
        {#if selectedIsCancelled}
          <!-- Cancelled State -->
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
                <p class="text-[12px] text-fg-2 mt-0.5">{formatDateHuLong(selected)}</p>
                {#if cancelled.get(selected)?.reason}
                  <p class="text-[12px] text-fg-3 mt-1">{cancelled.get(selected)?.reason}</p>
                {/if}
              </div>
            </div>
          </div>
        {:else if selectedAttendees.length === 0}
          <!-- Empty State -->
          <div class="fade-up">
            <div class="card-soft p-8 text-center" style="border-radius:22px">
              <div class="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3"
                   style="background:color-mix(in oklab,var(--fg-3) 14%,transparent)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-fg-2">
                  <circle cx="12" cy="12" r="9"/><path d="M3 12c4.5-1.5 13.5-1.5 18 0M12 3c-2.5 4.5-2.5 13.5 0 18M12 3c2.5 4.5 2.5 13.5 0 18"/>
                </svg>
              </div>
              <p class="text-[15px] font-semibold text-fg-1">{isPast ? 'Nem volt játék' : 'Még nincs jelentkező'}</p>
              <p class="text-[12px] text-fg-3 mt-1">{formatDateHuLong(selected)}</p>
            </div>
          </div>
        {:else}
          <!-- Grid -->
          <div class="fade-up" style="animation-delay:80ms">
            <div class="flex items-end justify-between mb-3 gap-2">
              <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Résztvevők</h2>
              <div class="flex items-center gap-2">
                <span class="eyebrow">{count} fő</span>
                <button type="button" onclick={() => editMode = !editMode}
                  class="text-[11px] font-semibold px-2.5 py-1.5 rounded-full"
                  style="background:{editMode ? 'var(--danger)' : 'var(--bg-elev)'};color:{editMode ? '#fff' : 'var(--fg-2)'};border:1px solid {editMode ? 'var(--danger)' : 'var(--line)'};transition:transform 120ms ease,background 180ms ease,color 180ms ease;cursor:pointer;-webkit-tap-highlight-color:rgba(0,0,0,0.08);user-select:none;-webkit-user-select:none"
                  ontouchstart={(e) => e.currentTarget.style.transform='scale(0.9)'} ontouchend={(e) => e.currentTarget.style.transform=''} onmousedown={(e) => e.currentTarget.style.transform='scale(0.9)'} onmouseup={(e) => e.currentTarget.style.transform=''}>
                  {editMode ? '✓ Kész' : '✎ Szerkesztés'}
                </button>
              </div>
            </div>
            <div id="attendees-grid" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {#each selectedAttendees as name}
                {@const hue = avatarHue(name)}
                {@const initials = getInitials(name)}
                {#if editMode}
                  <button type="button" onclick={() => pendingDelete = { name, date: selected }}
                    class="attendee-edit card relative flex items-center gap-2.5 px-3 py-2.5 transition-transform"
                    style="border-radius:16px;color:inherit;text-align:left;border:1px solid var(--danger);animation:jiggle 0.6s ease-in-out infinite alternate">
                    <span aria-hidden="true"
                      class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[12px] font-bold shadow-md"
                      style="background:var(--danger);line-height:1">×</span>
                    <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
                         style="width:28px;height:28px;flex-shrink:0;background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                      {initials}
                    </div>
                    <span class="text-[12.5px] font-medium text-fg-1 break-words leading-tight">{name}</span>
                  </button>
                {:else}
                  <a href="#/profile?name={encodeURIComponent(name)}"
                     class="attendee-card card flex items-center gap-2.5 px-3 py-2.5 lift no-underline transition-colors hover:bg-[color:var(--bg-elev)]"
                     style="border-radius:16px;color:inherit;text-decoration:none">
                    <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[10px]"
                         style="width:28px;height:28px;flex-shrink:0;background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                      {initials}
                    </div>
                    <span class="text-[12.5px] font-medium text-fg-1 break-words leading-tight">{name}</span>
                  </a>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Jobb oszlop: Rail -->
    <div class="hidden lg:block lg:sticky lg:top-[110px]">
      <section class="card overflow-hidden fade-up" style="border-radius:20px">
        <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
          <span class="eyebrow">Alkalmak</span>
          <span class="eyebrow text-[10px]">{dates.length}</span>
        </div>
        <ul>
          {#each dates as date}
            {@const isCancelled = cancelled.has(date)}
            {@const isSelected = date === selected}
            {@const isUpcoming = date === upcoming}
            {@const loaded = attendeesByDate.has(date)}
            {@const c = attendeesByDate.get(date)?.length ?? 0}
            {@const d = dayOf(date)}
            {@const monthShort = formatMonthShortHu(date)}
            {@const relLabel = getRelativeLabel(date)}
            
            <li>
              <button onclick={() => selectDate(date)} class="date-rail-btn relative w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[color:var(--bg-elev)]"
                disabled={isCancelled}
                style="background:{isSelected ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'transparent'}; opacity:{isCancelled ? '0.55' : '1'}; border-top:1px solid var(--line)">
                {#if isSelected}
                  <span style="position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--accent)"></span>
                {/if}
                <div class="flex flex-col items-center" style="min-width:36px">
                  <span class="text-[9px] font-semibold uppercase tracking-widest"
                        style="color:{isSelected ? 'var(--accent-ink)' : 'var(--fg-3)'}; {isCancelled ? 'text-decoration:line-through' : ''}">{monthShort}</span>
                  <span class="font-mono-tnum font-semibold text-[19px] leading-tight"
                        style="color:{isSelected ? 'var(--accent-ink)' : 'var(--fg-1)'}; {isCancelled ? 'text-decoration:line-through' : ''}">{d}</span>
                </div>
                <div class="flex-1 min-w-0 flex flex-col">
                  <div class="flex items-center gap-1.5">
                    {#if isUpcoming && !isCancelled}
                      <span class="w-1.5 h-1.5 rounded-full" style="background:#10b981;flex:none"></span>
                    {/if}
                    {#if !isCancelled && relLabel}
                      <span class="text-[10px] font-medium" style="color:{isSelected ? 'var(--accent-ink)' : 'var(--fg-3)'}">{relLabel}</span>
                    {:else}
                      <span class="text-[10px]" style="color:{isSelected ? 'var(--accent-ink)' : 'var(--fg-3)'}">{formatDateHuLong(date).split(',')[1]?.trim() ?? ''}</span>
                    {/if}
                  </div>
                  {#if isCancelled}
                    <span class="text-[11px] font-medium" style="color:var(--fg-3); text-decoration:line-through">Elmarad</span>
                  {:else}
                    <span class="text-[11px] font-mono-tnum font-medium" style="color:{isSelected ? 'var(--accent-ink)' : 'var(--fg-2)'}">{loaded ? `${c} fő` : '·'}</span>
                  {/if}
                </div>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  </div>

  <!-- Törlés megerősítő -->
  {#if pendingDelete}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div id="delete-confirm-overlay" onclick={(e) => { if (e.target === e.currentTarget && !deleting) pendingDelete = null; }}
      class="fixed inset-0 z-50 flex items-center justify-center px-5 fade-up"
      style="background:rgba(15,12,10,0.45);backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%);animation-duration:160ms">
      <div role="dialog" aria-modal="true" class="card relative overflow-hidden noise"
        style="border-radius:24px;max-width:380px;width:100%;box-shadow:var(--shadow-lg);border:1px solid var(--line-strong)">
        <div class="relative p-6">
          <div class="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center"
            style="background:color-mix(in oklab,var(--danger) 14%,transparent)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/>
              <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </div>
          <h3 class="text-[17px] font-semibold text-fg-1 text-center mb-2">Játékos törlése?</h3>
          <p class="text-[13px] text-fg-2 text-center leading-relaxed mb-1">
            Biztosan törlöd <span class="font-semibold text-fg-1">{pendingDelete.name}</span> jelenlétét erről az alkalomról:
          </p>
          <p class="text-[13px] text-fg-1 font-semibold text-center mb-5 font-mono-tnum">{formatDateHuLong(pendingDelete.date)}</p>
          <div class="flex flex-col gap-2">
            <button onclick={confirmDelete} type="button" disabled={deleting}
              class="w-full px-4 py-2.5 rounded-full text-white text-[14px] font-semibold transition-colors {deleting ? 'opacity-60 cursor-not-allowed' : ''}"
              style="background:var(--danger)">
              {deleting ? 'Törlés…' : 'Igen, törlés'}
            </button>
            <button onclick={() => pendingDelete = null} type="button" disabled={deleting}
              class="w-full px-4 py-2.5 rounded-full text-[14px] font-semibold transition-colors"
              style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)">
              Mégse
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
