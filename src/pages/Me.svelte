<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
  import { getAuthState, signIn } from '../lib/auth';
  import { getInitials } from '../lib/avatar';
  import {
    pastTuesdaysForDisplay,
    generateTuesdayDates,
    upcomingTuesday,
    formatDateHuLong,
    formatMonthShortHu,
    dayOf,
    todayInHungary,
    weekdayOf,
    currentHourInHungary,
  } from '../lib/dates';
  import {
    getMemberByEmail,
    getAttendanceForPlayer,
    updateMember,
    updateMemberPrefs,
    addAttendanceBatch,
    upsertSelfRegistration,
    deleteAttendanceForPlayerOnDate,
    DEFAULT_NOTIFICATION_PREFS,
    type Member,
    type MemberNotificationPrefs,
    type NewAttendanceRow,
  } from '../lib/firestore';
  import {
    isPushSupported,
    currentPermission,
    subscribeToPush,
    unsubscribeFromPush,
    getMySubscriptions,
    setSubscriptionEnabled,
    deleteSubscription,
    type PushSubscription,
  } from '../lib/notifications';

  let authState = $state(getAuthState());

  let member = $state<Member | null>(null);
  let myAttendance = $state<Set<string>>(new Set());
  let myDeclined = $state<Set<string>>(new Set());
  let nextDate = $state<string>('');
  let pastDate = $state<string | null>(null);

  // Guest Forms
  let guestMode = $state(false);
  let guestCount = $state(1);
  let guestNames = $state<string[]>(['']);
  
  let pastGuestMode = $state(false);
  let pastGuestCount = $state(1);
  let pastGuestNames = $state<string[]>(['']);

  // Profile Edit
  let nameEdit = $state('');
  
  // Notification Prefs
  let prefs = $state<MemberNotificationPrefs>({ ...DEFAULT_NOTIFICATION_PREFS });
  
  // Push state
  let pushSupported = $state(false);
  let pushPermission = $state<NotificationPermission>('default');
  let subscriptions = $state<PushSubscription[]>([]);
  let pushSubscribing = $state(false);
  let showPushOptIn = $state(false);

  // UI State
  let saving = $state(false);
  let toast = $state<{ kind: 'success' | 'error' | 'info'; msg: string } | null>(null);
  let loading = $state(true);

  // Computed
  let hue = $derived(member ? avatarHue(member.name) : 0);
  let initials = $derived(member ? getInitials(member.name) : '');
  let pushEnabled = $derived(prefs.enabled && subscriptions.length > 0);

  // Mount logic
  onMount(async () => {
    // Determine dates
    const futureCandidates = generateTuesdayDates(0, 2);
    const today = todayInHungary();
    const isTuesday = weekdayOf(today) === 2;
    const hour = currentHourInHungary();
    nextDate = (isTuesday && hour < 21) ? today : upcomingTuesday(futureCandidates);

    const pastDates = pastTuesdaysForDisplay(1);
    const lastPast = pastDates[pastDates.length - 1] ?? null;
    pastDate = lastPast && lastPast !== nextDate ? lastPast : null;

    if (authState.user?.email) {
      await loadMemberData(authState.user.email);
    }
    
    // Check deep link
    const hashParams = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    if (hashParams.get('action') === 'add-guest') {
      guestMode = true;
      guestCount = 1;
      guestNames = [''];
    }

    loading = false;
  });

  async function loadMemberData(email: string) {
    const m = await getMemberByEmail(email);
    if (!m) return;
    
    member = m;
    nameEdit = m.name;
    if (m.prefs?.notifications) {
      prefs = JSON.parse(JSON.stringify(m.prefs.notifications));
    }

    const records = await getAttendanceForPlayer(m.name);
    myAttendance = new Set(records.filter((r) => r.status === 'Yes' && r.event_date).map((r) => r.event_date));
    myDeclined = new Set(records.filter((r) => r.status === 'No' && r.event_date).map((r) => r.event_date));

    // Parallel push check
    const [supported, subs] = await Promise.all([
      isPushSupported(),
      getMySubscriptions(m.id).catch(() => [] as PushSubscription[])
    ]);
    pushSupported = supported;
    pushPermission = currentPermission();
    subscriptions = subs;
  }

  // Auth actions
  async function handleSignIn() {
    try {
      await signIn();
      authState = getAuthState();
      if (authState.user?.email) {
        loading = true;
        await loadMemberData(authState.user.email);
        loading = false;
      }
    } catch (e) {
      console.warn(e);
    }
  }

  // Toast helper
  function showToast(kind: 'success' | 'error' | 'info', msg: string) {
    toast = { kind, msg };
    setTimeout(() => { if (toast?.msg === msg) toast = null; }, 2500);
  }

  // Event handlers
  async function handleRegister(date: string, status: 'Yes' | 'No', isPast: boolean) {
    if (!member || saving) return;
    saving = true;
    try {
      await upsertSelfRegistration(member.name, date, status);
      if (status === 'Yes') {
        myAttendance.add(date);
        myDeclined.delete(date);
      } else {
        myAttendance.delete(date);
        myDeclined.add(date);
      }
      // Force reactivity
      myAttendance = new Set(myAttendance);
      myDeclined = new Set(myDeclined);
      showToast('success', status === 'Yes' ? 'Jelentkezés mentve' : 'Lemondás mentve');
    } catch (err) {
      showToast('error', `Hiba a mentés során: ${String(err)}`);
    } finally {
      saving = false;
    }
  }

  async function handleGuestSave(mode: 'future' | 'past') {
    if (!member || saving) return;
    const isFuture = mode === 'future';
    const date = isFuture ? nextDate : pastDate;
    if (!date) return;
    
    const count = isFuture ? guestCount : pastGuestCount;
    const names = isFuture ? guestNames : pastGuestNames;
    const validNames = names.slice(0, count).map(n => n.trim()).filter(Boolean);
    
    if (validNames.length === 0) {
      showToast('error', 'Add meg a vendég nevét!');
      return;
    }

    saving = true;
    try {
      const rows: NewAttendanceRow[] = validNames.map(n => ({
        name: `${member!.name} vendége (${n})`,
        event_date: date,
        status: 'Yes',
        is_guest: true
      }));
      await addAttendanceBatch(rows);
      
      // Auto register the user as Yes if not already
      if (!myAttendance.has(date)) {
        await upsertSelfRegistration(member.name, date, 'Yes');
        myAttendance.add(date);
        myDeclined.delete(date);
        myAttendance = new Set(myAttendance);
        myDeclined = new Set(myDeclined);
      }

      showToast('success', `${validNames.length} vendég hozzáadva`);
      if (isFuture) { guestMode = false; guestNames = ['']; guestCount = 1; }
      else { pastGuestMode = false; pastGuestNames = ['']; pastGuestCount = 1; }
    } catch (err) {
      showToast('error', `Hiba a mentés során: ${String(err)}`);
    } finally {
      saving = false;
    }
  }

  async function savePrefs() {
    if (!member) return;
    try {
      await updateMemberPrefs(member.id, { notifications: prefs });
    } catch (err) {
      showToast('error', 'Beállítások mentése sikertelen');
    }
  }

  async function saveName() {
    if (!member || saving) return;
    const newName = nameEdit.trim();
    if (newName.length < 3) {
      showToast('error', 'A név túl rövid');
      return;
    }
    saving = true;
    try {
      await updateMember(member.id, { name: newName });
      member.name = newName;
      showToast('success', 'Név frissítve');
    } catch (err) {
      showToast('error', 'Név mentése sikertelen');
    } finally {
      saving = false;
    }
  }

  // Push notifications
  async function handlePushToggle(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) {
      showPushOptIn = true;
    } else {
      if (!member) return;
      pushSubscribing = true;
      try {
        await unsubscribeFromPush(member.id);
        subscriptions = await getMySubscriptions(member.id);
        prefs.enabled = false;
        await savePrefs();
        showToast('info', 'Értesítések kikapcsolva az eszközön');
      } catch (err) {
        showToast('error', 'Hiba az értesítések kikapcsolásakor');
      } finally {
        pushSubscribing = false;
      }
    }
  }

  async function handlePushSubscribe() {
    if (!member) return;
    pushSubscribing = true;
    showPushOptIn = false;
    try {
      await subscribeToPush(member.id);
      subscriptions = await getMySubscriptions(member.id);
      pushPermission = currentPermission();
      if (subscriptions.length > 0) {
        prefs.enabled = true;
        await savePrefs();
        showToast('success', 'Értesítések bekapcsolva');
      } else {
        showToast('error', 'Nem sikerült regisztrálni az eszközt');
      }
    } catch (err) {
      showToast('error', 'A böngésző elutasította az engedélyt');
      pushPermission = currentPermission();
    } finally {
      pushSubscribing = false;
    }
  }

  async function toggleSubEnabled(subId: string, checked: boolean) {
    try {
      await setSubscriptionEnabled(subId, checked);
      const sub = subscriptions.find(s => s.id === subId);
      if (sub) sub.enabled = checked;
      prefs.enabled = subscriptions.some(s => s.enabled);
      await savePrefs();
      showToast('success', checked ? 'Eszköz aktiválva' : 'Eszköz kikapcsolva');
    } catch (err) {
      showToast('error', 'Hiba: ' + String(err));
    }
  }

  async function deleteSub(subId: string) {
    if (!confirm('Biztosan eltávolítod ezt az eszközt a push listából?')) return;
    try {
      await deleteSubscription(subId);
      subscriptions = subscriptions.filter(s => s.id !== subId);
      prefs.enabled = subscriptions.some(s => s.enabled);
      await savePrefs();
      showToast('info', 'Eszköz eltávolítva');
    } catch (err) {
      showToast('error', 'Hiba: ' + String(err));
    }
  }

  // Utils
  function avatarHue(name: string): number {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return Math.abs(h) % 360;
  }
</script>

<div class="device">
  <Header currentPage="me" />
  
  <main id="me-body">
    {#if loading}
      <div class="px-5 pt-5 space-y-3">
        <div class="h-32 rounded-[28px] animate-pulse" style="background:var(--line)"></div>
        <div class="h-40 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        <div class="h-40 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
      </div>
    {:else if !authState.user}
      <div class="px-5 pt-5 pb-12 fade-up">
        <div class="card relative p-6 text-center overflow-hidden" style="border-radius:24px">
          <div class="halo"></div>
          <div class="relative">
            <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
                 style="background:color-mix(in oklab,var(--accent) 14%,transparent)">
              <span class="text-3xl">👤</span>
            </div>
            <p class="text-[17px] font-semibold text-fg-1 mb-1">Saját oldal</p>
            <p class="text-[13px] text-fg-3 mb-4">Jelentkezz be a saját regisztrációhoz és értesítésekhez.</p>
            <button onclick={handleSignIn}
              class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm"
              style="background:var(--accent)">
              Bejelentkezés
            </button>
          </div>
        </div>
      </div>
    {:else if !member}
      <div class="px-5 pt-12 text-center fade-up">
        <div class="text-3xl mb-3">⏳</div>
        <p class="text-[15px] text-fg-1">Profilod készítése folyamatban…</p>
        <p class="text-[12px] text-fg-3 mt-2">Pár másodperc és frissíthetsz.</p>
        <button onclick={() => location.reload()} class="mt-4 px-4 py-2 rounded-full text-white text-[13px] font-semibold" style="background:var(--accent)">
          Frissítés
        </button>
      </div>
    {:else}
      <div class="px-5 pt-5 pb-12 space-y-4">
        
        <!-- Hero -->
        <section class="fade-up">
          <div class="card relative p-5 overflow-hidden" style="border-radius:24px">
            <div class="absolute inset-0 opacity-90"
                 style="background:radial-gradient(120% 80% at 90% 0%,color-mix(in oklab,var(--accent) 14%,transparent) 0%,transparent 60%)"></div>
            <div class="relative flex items-center gap-4">
              <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[20px]"
                   style="width:64px;height:64px;background:linear-gradient(135deg,hsl({hue} 80% 88%) 0%,hsl({(hue+30)%360} 75% 78%) 100%);color:hsl({hue} 60% 30%)">
                {initials}
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[20px] font-semibold tracking-tight text-fg-1 truncate">{member.name}</p>
                <p class="text-[12px] text-fg-3 font-mono-tnum truncate">{member.email}</p>
                {#if authState.isAdmin}
                  <span class="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:color-mix(in oklab,#10b981 14%,transparent);color:#047857">ADMIN</span>
                {/if}
              </div>
            </div>
          </div>
        </section>

        <!-- Következő alkalom -->
        {#if true}
        {@const isGoing = myAttendance.has(nextDate)}
        {@const isDeclined = myDeclined.has(nextDate)}
        {@const statusText = isGoing ? '✓ Már jelentkeztél' : isDeclined ? '✗ Jelezted, hogy nem tudsz jönni' : 'Még nem jelentkeztél'}
        <section class="fade-up" style="animation-delay:80ms">
          <div class="flex items-end justify-between mb-3">
            <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Következő alkalom</h2>
            <span class="eyebrow">{nextDate}</span>
          </div>
          <div class="card p-5" style="border-radius:22px">
            <div class="flex items-center gap-4 mb-4">
              <div class="flex flex-col items-center flex-shrink-0" style="min-width:44px">
                <span class="text-[10px] font-semibold uppercase tracking-widest" style="color:var(--accent-ink)">{formatMonthShortHu(nextDate)}</span>
                <span class="font-mono-tnum font-bold text-[28px] leading-tight text-fg-1">{dayOf(nextDate)}</span>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[14px] font-semibold text-fg-1 capitalize">{formatDateHuLong(nextDate).split(',')[1]?.trim() ?? ''}</p>
                <p class="text-[11px] mt-0.5" style="color:{isDeclined ? 'var(--danger-ink)' : 'var(--fg-3)'}">{statusText}</p>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <button type="button" disabled={saving} onclick={() => handleRegister(nextDate, 'Yes', false)}
                class="px-4 py-3 rounded-full text-[14px] font-semibold transition-colors {saving ? 'opacity-60 cursor-not-allowed' : ''}"
                style="{isGoing ? 'background:#047857;color:white;border:1.5px solid #047857' : 'background:color-mix(in oklab,#10b981 12%,transparent);color:#047857;border:1.5px solid color-mix(in oklab,#10b981 30%,transparent)'}">
                {saving ? '…' : '✓ Jövök'}
              </button>
              <button type="button" disabled={saving} onclick={() => handleRegister(nextDate, 'No', false)}
                class="px-4 py-3 rounded-full text-[14px] font-semibold transition-colors {saving ? 'opacity-60 cursor-not-allowed' : ''}"
                style="{isDeclined ? 'background:var(--danger);color:white;border:1.5px solid var(--danger)' : 'background:color-mix(in oklab,var(--danger) 12%,transparent);color:var(--danger-ink);border:1.5px solid color-mix(in oklab,var(--danger) 30%,transparent)'}">
                {saving ? '…' : '✗ Nem tudok'}
              </button>
            </div>

            <div class="mt-2">
              <button type="button" disabled={saving} onclick={() => guestMode = !guestMode}
                class="w-full px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors"
                style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)">
                {guestMode ? '× Vendéget mégse hozok' : '🙋 Vendéggel jövök'}
              </button>
            </div>

            {#if guestMode}
              <div class="mt-4 pt-4 border-t hairline space-y-3">
                <div class="flex items-center justify-between">
                  <span class="text-[12px] font-semibold text-fg-1">Vendégek</span>
                  <div class="flex items-center gap-2">
                    <button type="button" onclick={() => { if (guestCount > 1) { guestCount--; guestNames.length = guestCount; } }} class="w-7 h-7 rounded-full flex items-center justify-center text-[16px] font-bold transition-colors" style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)" disabled={guestCount <= 1}>−</button>
                    <span class="font-mono-tnum text-[14px] font-semibold text-fg-1 w-6 text-center">{guestCount}</span>
                    <button type="button" onclick={() => { if (guestCount < 5) { guestCount++; guestNames.push(''); } }} class="w-7 h-7 rounded-full flex items-center justify-center text-[16px] font-bold transition-colors" style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)" disabled={guestCount >= 5}>+</button>
                  </div>
                </div>
                <div class="space-y-2">
                  {#each Array(guestCount) as _, i}
                    <input type="text" bind:value={guestNames[i]}
                      class="w-full rounded-[12px] border px-3 py-2 text-[13px] text-fg-1 placeholder-fg-3 focus:outline-none"
                      style="border-color:var(--line-strong); background:var(--bg-card)" placeholder="{i + 1}. vendég neve" />
                  {/each}
                </div>
                <button type="button" disabled={saving} onclick={() => handleGuestSave('future')}
                  class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors {saving ? 'opacity-60 cursor-not-allowed' : ''}" style="background:var(--accent)">
                  {saving ? 'Mentés…' : `Hozzáadás (${guestCount} vendég)`}
                </button>
              </div>
            {/if}
          </div>
        </section>
        {/if}

        <!-- Múltbeli alkalom -->
        {#if pastDate}
          {@const wasThere = myAttendance.has(pastDate)}
          {@const wasDeclined = myDeclined.has(pastDate)}
          {@const statusTextPast = wasThere ? '✓ Voltál ott' : wasDeclined ? '✗ Jelezted, hogy nem voltál ott' : 'Még nem jelezted, ott voltál-e'}
          <section class="fade-up" style="animation-delay:120ms">
            <div class="flex items-end justify-between mb-3">
              <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Múltbeli alkalom</h2>
              <span class="eyebrow">{pastDate}</span>
            </div>
            <div class="card p-5" style="border-radius:22px">
              <div class="flex items-center gap-4 mb-4">
                <div class="flex flex-col items-center flex-shrink-0" style="min-width:44px">
                  <span class="text-[10px] font-semibold uppercase tracking-widest text-fg-3">{formatMonthShortHu(pastDate)}</span>
                  <span class="font-mono-tnum font-bold text-[28px] leading-tight text-fg-2">{dayOf(pastDate)}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-[14px] font-semibold text-fg-1 capitalize">{formatDateHuLong(pastDate).split(',')[1]?.trim() ?? ''}</p>
                  <p class="text-[11px] mt-0.5" style="color:{wasDeclined ? 'var(--danger-ink)' : 'var(--fg-3)'}">{statusTextPast}</p>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <button type="button" disabled={saving} onclick={() => handleRegister(pastDate!, 'Yes', true)}
                  class="px-4 py-3 rounded-full text-[14px] font-semibold transition-colors {saving ? 'opacity-60 cursor-not-allowed' : ''}"
                  style="{wasThere ? 'background:#047857;color:white;border:1.5px solid #047857' : 'background:color-mix(in oklab,#10b981 12%,transparent);color:#047857;border:1.5px solid color-mix(in oklab,#10b981 30%,transparent)'}">
                  {saving ? '…' : '✓ Ott voltam'}
                </button>
                <button type="button" disabled={saving} onclick={() => handleRegister(pastDate!, 'No', true)}
                  class="px-4 py-3 rounded-full text-[14px] font-semibold transition-colors {saving ? 'opacity-60 cursor-not-allowed' : ''}"
                  style="{wasDeclined ? 'background:var(--danger);color:white;border:1.5px solid var(--danger)' : 'background:color-mix(in oklab,var(--danger) 12%,transparent);color:var(--danger-ink);border:1.5px solid color-mix(in oklab,var(--danger) 30%,transparent)'}">
                  {saving ? '…' : '✗ Nem voltam'}
                </button>
              </div>

              <div class="mt-2">
                <button type="button" disabled={saving} onclick={() => pastGuestMode = !pastGuestMode}
                  class="w-full px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors"
                  style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)">
                  {pastGuestMode ? '× Vendéget mégse adok hozzá' : '🙋 Vendéget hoztam'}
                </button>
              </div>

              {#if pastGuestMode}
                <div class="mt-4 pt-4 border-t hairline space-y-3">
                  <div class="flex items-center justify-between">
                    <span class="text-[12px] font-semibold text-fg-1">Vendégek</span>
                    <div class="flex items-center gap-2">
                      <button type="button" onclick={() => { if (pastGuestCount > 1) { pastGuestCount--; pastGuestNames.length = pastGuestCount; } }} class="w-7 h-7 rounded-full flex items-center justify-center text-[16px] font-bold transition-colors" style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)" disabled={pastGuestCount <= 1}>−</button>
                      <span class="font-mono-tnum text-[14px] font-semibold text-fg-1 w-6 text-center">{pastGuestCount}</span>
                      <button type="button" onclick={() => { if (pastGuestCount < 5) { pastGuestCount++; pastGuestNames.push(''); } }} class="w-7 h-7 rounded-full flex items-center justify-center text-[16px] font-bold transition-colors" style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)" disabled={pastGuestCount >= 5}>+</button>
                    </div>
                  </div>
                  <div class="space-y-2">
                    {#each Array(pastGuestCount) as _, i}
                      <input type="text" bind:value={pastGuestNames[i]}
                        class="w-full rounded-[12px] border px-3 py-2 text-[13px] text-fg-1 placeholder-fg-3 focus:outline-none"
                        style="border-color:var(--line-strong); background:var(--bg-card)" placeholder="{i + 1}. vendég neve" />
                    {/each}
                  </div>
                  <button type="button" disabled={saving} onclick={() => handleGuestSave('past')}
                    class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors {saving ? 'opacity-60 cursor-not-allowed' : ''}" style="background:var(--accent)">
                    {saving ? 'Mentés…' : `Hozzáadás (${pastGuestCount} vendég)`}
                  </button>
                </div>
              {/if}
            </div>
          </section>
        {/if}

        <!-- Notification Settings -->
        {#if !pushSupported}
          <section class="fade-up" style="animation-delay:160ms">
            <div class="flex items-end justify-between mb-3">
              <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Értesítések</h2>
            </div>
            <div class="card-soft p-4" style="border-radius:22px">
              <p class="text-[13px] text-fg-1 font-semibold mb-1">⚠️ Ezen az eszközön nem támogatott</p>
              <p class="text-[11.5px] text-fg-3 leading-relaxed">
                iOS-en a push értesítés csak <b>telepített PWA-ban</b> működik (Add to Home Screen),
                Safari böngészőben nem. Asztali Safari-n is hasonló a helyzet — Chrome-mal érdemes
                megpróbálni. Android Chrome / desktop Chrome / Edge / Firefox: támogatva.
              </p>
            </div>
          </section>
        {:else if showPushOptIn}
          <section class="fade-up" style="animation-delay:160ms">
            <div class="flex items-end justify-between mb-3">
              <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Értesítések</h2>
            </div>
            <div class="card p-5" style="border-radius:22px">
              <div class="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3"
                   style="background:color-mix(in oklab,var(--accent) 14%,transparent)">
                <span class="text-3xl">🔔</span>
              </div>
              <p class="text-[16px] font-semibold text-fg-1 text-center mb-2">Engedélyezed az értesítéseket?</p>
              <p class="text-[12.5px] text-fg-3 text-center leading-relaxed mb-4">
                Kedd reggelente emlékeztetünk, ha még nem jelentkeztél az edzésre, és szólunk ha lemondják.
                Bármikor kikapcsolhatod a beállításokban.
              </p>
              <div class="flex flex-col gap-2">
                <button type="button" disabled={pushSubscribing} onclick={handlePushSubscribe}
                  class="w-full px-4 py-2.5 rounded-full text-white text-[14px] font-semibold transition-colors {pushSubscribing ? 'opacity-60 cursor-not-allowed' : ''}"
                  style="background:var(--accent)">
                  {pushSubscribing ? 'Engedélykérés…' : 'Igen, engedélyezem'}
                </button>
                <button type="button" disabled={pushSubscribing} onclick={() => { showPushOptIn = false; }}
                  class="w-full px-4 py-2.5 rounded-full text-[14px] font-semibold transition-colors"
                  style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)">
                  Most nem
                </button>
              </div>
            </div>
          </section>
        {:else}
          <section class="fade-up" style="animation-delay:160ms">
            <div class="flex items-end justify-between mb-3">
              <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Értesítések</h2>
              {#if pushEnabled}
                <span class="eyebrow" style="color:#047857;background:color-mix(in oklab,#10b981 14%,transparent);padding:2px 8px;border-radius:999px">Aktív</span>
              {/if}
            </div>
            <div class="card p-4 space-y-3" style="border-radius:22px">
              <label class="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <p class="text-[14px] font-semibold text-fg-1">Push értesítések</p>
                  <p class="text-[11px] text-fg-3 mt-0.5">{pushEnabled ? 'Aktív ezen az eszközön' : 'Telefonra / asztali appra érkezik értesítés'}</p>
                </div>
                <input type="checkbox" checked={pushEnabled} disabled={pushSubscribing} onchange={handlePushToggle}
                  class="w-5 h-5 rounded" style="accent-color:var(--accent)" />
              </label>

              {#if pushPermission === 'denied' && !pushEnabled}
                <div class="px-3 py-2 rounded-lg text-[11.5px]" style="background:color-mix(in oklab,var(--danger) 12%,transparent);color:var(--danger-ink)">
                   ⚠️ A böngésződ letiltotta az értesítéseket. Engedélyezni a böngésző beállításaiban tudod (címsor melletti zár ikon → Notifications → Allow).
                </div>
              {/if}

              {#if subscriptions.length > 0}
                <div class="pt-3 border-t hairline">
                  <p class="eyebrow text-[10px] mb-2">Eszközök ({subscriptions.length})</p>
                  <ul class="space-y-1.5">
                    {#each subscriptions as s}
                      <li class="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-lg" style="background:var(--bg-elev)">
                        <div class="flex-1 min-w-0">
                          <p class="text-[12px] font-semibold text-fg-1 truncate">{s.device}</p>
                          <p class="text-[10px] text-fg-3 font-mono-tnum truncate">{s.token.slice(0, 16)}…</p>
                        </div>
                        <label class="flex items-center gap-2 cursor-pointer flex-shrink-0">
                          <input type="checkbox" checked={s.enabled} onchange={(e) => toggleSubEnabled(s.id, (e.target as HTMLInputElement).checked)}
                            class="w-4 h-4 rounded" style="accent-color:var(--accent)" />
                        </label>
                        <button type="button" onclick={() => deleteSub(s.id)} class="p-1 rounded-md transition-colors hover:bg-[color:var(--line)]" title="Eszköz eltávolítása" style="color:var(--fg-3)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/>
                          </svg>
                        </button>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}

              <div class="pt-3 border-t hairline {!pushEnabled ? 'opacity-55' : ''}">
                <p class="eyebrow text-[10px] mb-2">Mely eseményről értesüljek?</p>
                <!-- Event toggles -->
                {#each [
                  { key: 'tuesdayReminder', label: 'Kedd reggeli emlékeztető', sub: 'Ha még nem jelentkeztél' },
                  { key: 'cancellation', label: 'Edzés lemondva', sub: 'Azonnali értesítés' },
                  { key: 'fullTeam', label: 'Megvan a 8 fő', sub: 'Amikor összejön a csapat' },
                  { key: 'newRegistration', label: 'Új jelentkező', sub: 'Valaki most regisztrált' },
                  { key: 'payment', label: 'Befizetési emlékeztető', sub: 'Ha még tartozol' }
                ] as { key, label, sub }}
                  <label class="flex items-center justify-between gap-3 py-2 cursor-pointer {!pushEnabled ? 'opacity-55' : ''}">
                    <div>
                      <span class="text-[13px] text-fg-1">{label}</span>
                      <p class="text-[10.5px] text-fg-3 mt-0.5">{sub}</p>
                    </div>
                    <input type="checkbox" disabled={!pushEnabled} bind:checked={prefs.events[key as keyof typeof prefs.events]} onchange={savePrefs}
                      class="w-4 h-4 rounded flex-shrink-0" style="accent-color:var(--accent)" />
                  </label>
                {/each}
              </div>

              <div class="pt-3 border-t hairline space-y-2 {!pushEnabled ? 'opacity-55' : ''}">
                <label class="flex items-center justify-between">
                  <span class="text-[13px] text-fg-1">Csendes órák</span>
                  <input type="checkbox" disabled={!pushEnabled} bind:checked={prefs.quietHours.enabled} onchange={savePrefs}
                    class="w-4 h-4 rounded" style="accent-color:var(--accent)" />
                </label>
                {#if prefs.quietHours.enabled}
                  <div class="flex items-center justify-between gap-2 pl-4">
                    <input type="time" disabled={!pushEnabled} bind:value={prefs.quietHours.from} onchange={savePrefs}
                      class="rounded-[10px] border px-2 py-1 text-[12px] font-mono-tnum text-fg-1 flex-1" style="border-color:var(--line-strong); background:var(--bg-card)" />
                    <span class="text-[11px] text-fg-3">—</span>
                    <input type="time" disabled={!pushEnabled} bind:value={prefs.quietHours.to} onchange={savePrefs}
                      class="rounded-[10px] border px-2 py-1 text-[12px] font-mono-tnum text-fg-1 flex-1" style="border-color:var(--line-strong); background:var(--bg-card)" />
                  </div>
                {/if}
              </div>

              <p class="text-[10.5px] text-fg-3 text-center pt-1">
                Csapatszintű emlékeztető: <b>kedd 09:00</b> (Magyarország).
                Egyénileg csak ki/be kapcsolható.
              </p>
            </div>
          </section>
        {/if}

        <!-- Profile Edit -->
        <section class="fade-up" style="animation-delay:200ms">
          <div class="flex items-end justify-between mb-3">
            <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Profil</h2>
          </div>
          <div class="card p-4" style="border-radius:22px">
            <label class="block">
              <span class="text-[10px] font-semibold text-fg-3 block mb-1">Megjelenítendő név</span>
              <input type="text" bind:value={nameEdit}
                class="w-full rounded-[12px] border px-3 py-2.5 text-[14px] text-fg-1 focus:outline-none"
                style="border-color:var(--line-strong); background:var(--bg-card)" />
            </label>
            {#if nameEdit.trim() !== member.name && nameEdit.trim().length > 0}
              <button type="button" disabled={saving} onclick={saveName}
                class="mt-3 w-full px-4 py-2 rounded-full text-white text-[13px] font-semibold transition-colors {saving ? 'opacity-60 cursor-not-allowed' : ''}" style="background:var(--accent)">
                {saving ? 'Mentés…' : 'Név mentése'}
              </button>
            {/if}
          </div>
        </section>

      </div>
    {/if}
  </main>

  {#if toast}
    <div class="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full shadow-lg text-[12.5px] font-semibold fade-up transition-all"
      style="bottom:24px; {toast.kind === 'success' ? 'background:color-mix(in oklab,#10b981 14%,var(--bg-card));border:1px solid color-mix(in oklab,#10b981 30%,var(--line));color:#047857' : toast.kind === 'error' ? 'background:color-mix(in oklab,var(--danger) 14%,var(--bg-card));border:1px solid color-mix(in oklab,var(--danger) 30%,var(--line));color:var(--danger-ink)' : 'background:color-mix(in oklab,#0ea5e9 14%,var(--bg-card));border:1px solid color-mix(in oklab,#0ea5e9 30%,var(--line));color:#0369a1'}">
      {toast.msg}
    </div>
  {/if}
</div>
