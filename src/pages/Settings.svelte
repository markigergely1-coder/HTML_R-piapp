<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
  import { getAuthState, onAuthChange, signIn } from '../lib/auth';
  import { logEvent } from '../lib/logger';
  import { formatDateHuLong, todayInHungary } from '../lib/dates';
  import {
    getCancelledSessionsWithIds,
    addCancelledSession,
    deleteCancelledSession,
    getAppConfig,
    saveAppConfig,
    type CancelledSessionWithId,
    type AppConfig,
  } from '../lib/firestore';

  // State
  let authState = $state(getAuthState());
  let loading = $state(true);
  
  let cancelled = $state<CancelledSessionWithId[]>([]);
  let newDate = $state(todayInHungary());
  let newReason = $state('');
  
  let appConfig = $state<AppConfig>({ senderName: '', emailFooter: '' });
  let configSaving = $state(false);
  
  let toast = $state<{ kind: 'success' | 'error'; msg: string } | null>(null);
  let toastTimer: number | null = null;

  // Derived
  let isTuesday = $derived(checkIsTuesday(newDate));

  onMount(() => {
    const unsub = onAuthChange((s) => {
      authState = s;
    });

    initData();

    return () => {
      unsub();
      if (toastTimer) clearTimeout(toastTimer);
    };
  });

  async function initData() {
    if (!authState.user || !authState.isAdmin) {
      loading = false;
      return;
    }
    try {
      const [c, config] = await Promise.all([
        getCancelledSessionsWithIds(),
        getAppConfig(),
      ]);
      cancelled = c;
      appConfig = config;
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }

  function showToast(kind: 'success' | 'error', msg: string) {
    toast = { kind, msg };
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
    }, 2500);
  }

  function checkIsTuesday(dateStr: string): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr + 'T12:00:00Z');
    return d.getUTCDay() === 2;
  }

  async function handleConfigSave() {
    if (configSaving) return;
    configSaving = true;
    try {
      await saveAppConfig(appConfig);
      void logEvent('info', 'App config saved', { senderName: appConfig.senderName });
      showToast('success', '✓ Email beállítások mentve');
    } catch (e) {
      showToast('error', `Hiba: ${String(e)}`);
    } finally {
      configSaving = false;
    }
  }

  async function handleAddCancel() {
    const d = newDate.trim();
    if (!d) return showToast('error', 'Adj meg dátumot.');
    if (cancelled.some((c) => c.date === d)) return showToast('error', 'Ez a dátum már szerepel.');

    try {
      await addCancelledSession(d, newReason);
      void logEvent('info', 'Cancelled session added', { date: d, reason: newReason });
      cancelled = await getCancelledSessionsWithIds();
      newReason = '';
      showToast('success', '✓ Hozzáadva');
    } catch (e) {
      showToast('error', `Hiba: ${String(e)}`);
    }
  }

  async function handleDeleteCancel(item: CancelledSessionWithId) {
    if (!confirm(`Biztosan törlöd?\n\n${formatDateHuLong(item.date)}`)) return;
    try {
      await deleteCancelledSession(item.id);
      void logEvent('warn', 'Cancelled session deleted', { date: item.date });
      cancelled = cancelled.filter((x) => x.id !== item.id);
      showToast('success', '🗑️ Törölve');
    } catch (e) {
      showToast('error', `Hiba: ${String(e)}`);
    }
  }

  function handleSignIn() {
    signIn().catch(console.warn);
  }
</script>

<div class="device">
  <Header currentPage="settings" />
  <main id="settings-body">
    {#if loading || authState.loading}
      <!-- Loading -->
      <div class="px-5 pt-5 space-y-3">
        <div class="h-32 rounded-2xl animate-pulse" style="background:var(--line)"></div>
        {#each Array(3) as _}
          <div class="h-14 rounded-2xl animate-pulse" style="background:var(--line)"></div>
        {/each}
      </div>
    {:else if !authState.user}
      <!-- Gate: Sign in -->
      <div class="px-5 pt-5 pb-12 fade-up">
        <div class="card relative p-6 text-center overflow-hidden" style="border-radius:24px">
          <div class="halo"></div>
          <div class="relative">
            <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
                 style="background:color-mix(in oklab,var(--accent) 14%,transparent)">
              <span class="text-3xl">🔒</span>
            </div>
            <p class="text-[17px] font-semibold text-fg-1 mb-1">Csak admin oldal</p>
            <button onclick={handleSignIn}
              class="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm"
              style="background:var(--accent)">
              Bejelentkezés
            </button>
          </div>
        </div>
      </div>
    {:else if !authState.isAdmin}
      <!-- Gate: No permission -->
      <div class="px-5 pt-5 pb-12 fade-up">
        <div class="card-soft p-6 text-center" style="border-radius:24px">
          <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4" style="background:color-mix(in oklab,#f59e0b 14%,transparent)">
            <span class="text-3xl">⛔</span>
          </div>
          <p class="text-[17px] font-semibold text-fg-1 mb-1">Nincs admin jogosultság</p>
          <p class="text-[13px] text-fg-3">{authState.user.email}</p>
        </div>
      </div>
    {:else}
      <div class="lg:grid lg:grid-cols-[400px_1fr] lg:gap-6 lg:p-6 lg:pt-5 lg:items-start">
        <!-- Új kivétel form -->
        <aside class="lg:sticky lg:top-[110px] space-y-3 px-5 pt-5 lg:px-0 lg:pt-0">
          <div class="card p-4 fade-up">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-xl">📧</span>
              <div>
                <p class="eyebrow text-[10px]">Email</p>
                <p class="text-[15px] font-semibold text-fg-1">Email beállítások</p>
              </div>
            </div>
            <div class="space-y-2.5">
              <label class="block">
                <span class="text-[10px] font-semibold text-fg-3 block mb-1">Feladó neve</span>
                <input type="text" bind:value={appConfig.senderName}
                  placeholder="pl. Röpi Edzés"
                  class="w-full rounded-[12px] border px-3 py-2.5 text-[14px] text-fg-1 placeholder-fg-3 focus:outline-none"
                  style="border-color:var(--line-strong); background:var(--bg-card)" />
              </label>
              <label class="block">
                <span class="text-[10px] font-semibold text-fg-3 block mb-1">Email lábléc</span>
                <textarea rows="3" bind:value={appConfig.emailFooter}
                  placeholder="pl. Kérdés esetén írj vissza erre az emailre."
                  class="w-full rounded-[12px] border px-3 py-2.5 text-[14px] text-fg-1 placeholder-fg-3 focus:outline-none resize-none"
                  style="border-color:var(--line-strong); background:var(--bg-card)"></textarea>
              </label>
              <button onclick={handleConfigSave}
                class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-colors {configSaving ? 'opacity-60 cursor-not-allowed' : ''}"
                style="background:var(--accent)"
                disabled={configSaving}>
                {configSaving ? 'Mentés…' : 'Mentés'}
              </button>
            </div>
          </div>

          <div class="card p-4 fade-up">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-xl">📅</span>
              <div>
                <p class="eyebrow text-[10px]">Új kivétel</p>
                <p class="text-[15px] font-semibold text-fg-1">Lemondott edzés</p>
              </div>
            </div>
            <div class="space-y-2.5">
              <label class="block">
                <span class="text-[10px] font-semibold text-fg-3 block mb-1">Dátum</span>
                <input type="date" bind:value={newDate}
                  class="w-full rounded-[12px] border px-3 py-2.5 text-[14px] text-fg-1 focus:outline-none"
                  style="border-color:var(--line-strong); background:var(--bg-card)" />
                {#if !isTuesday}
                  <p class="text-[11px] mt-1" style="color:#d97706">⚠️ Ez nem keddi nap</p>
                {/if}
              </label>
              <label class="block">
                <span class="text-[10px] font-semibold text-fg-3 block mb-1">Indok (opcionális)</span>
                <input type="text" bind:value={newReason} placeholder="pl. Ünnepnap"
                  class="w-full rounded-[12px] border px-3 py-2.5 text-[14px] text-fg-1 placeholder-fg-3 focus:outline-none"
                  style="border-color:var(--line-strong); background:var(--bg-card)" />
              </label>
              <button onclick={handleAddCancel}
                class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-colors"
                style="background:var(--accent)">
                Hozzáadás
              </button>
            </div>
          </div>
        </aside>

        <!-- Lemondott edzések listája -->
        <section class="px-5 pt-3 pb-12 lg:px-0 lg:pt-0">
          {#if cancelled.length === 0}
            <div class="card-soft p-8 text-center fade-up" style="border-radius:22px">
              <div class="text-3xl mb-2">✅</div>
              <p class="text-[14px] font-semibold text-fg-1">Nincs lemondott edzés</p>
              <p class="text-[12px] text-fg-3 mt-1">Minden megtartott marad.</p>
            </div>
          {:else}
            <div class="card overflow-hidden fade-up" style="border-radius:22px">
              <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--line)">
                <span class="eyebrow">Lemondott edzések</span>
                <span class="text-[11px] font-mono-tnum text-fg-3">{cancelled.length}</span>
              </div>
              <ul>
                {#each cancelled as c, i}
                  <li class="flex items-center gap-3 px-4 py-3" style="{i === 0 ? '' : 'border-top:1px solid var(--line);'}">
                    <div class="rounded-full flex items-center justify-center flex-shrink-0"
                         style="width:36px;height:36px;background:color-mix(in oklab,var(--accent) 14%,transparent)">
                      <span class="text-[14px]">❌</span>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-[13.5px] font-semibold text-fg-1 truncate">{formatDateHuLong(c.date)}</p>
                      {#if c.reason}
                        <p class="text-[11.5px] text-fg-3 truncate">{c.reason}</p>
                      {/if}
                    </div>
                    <button onclick={() => handleDeleteCancel(c)}
                      class="row-delete p-2 rounded-lg transition-colors hover:bg-[color:var(--bg-elev)]"
                      title="Törlés" style="color:var(--fg-3)">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </section>
      </div>
    {/if}
  </main>

  <!-- Toast -->
  {#if toast}
    <div class="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full shadow-lg text-[12.5px] font-semibold fade-up"
      style="bottom:24px;{toast.kind === 'success' ? 'background:color-mix(in oklab,#10b981 14%,var(--bg-card));border:1px solid color-mix(in oklab,#10b981 30%,var(--line));color:#047857' : 'background:color-mix(in oklab,var(--danger) 14%,var(--bg-card));border:1px solid color-mix(in oklab,var(--danger) 30%,var(--line));color:var(--danger-ink)'}">
      {toast.msg}
    </div>
  {/if}
</div>
