<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
  import { getAuthState, onAuthChange, signIn } from '../lib/auth';
  import { getAppLogs, pingFirestore, getAllMembers, getMemberByEmail, type AppLog, type Member } from '../lib/firestore';
  import { sendTestPush, type TestPushResult } from '../lib/notifications';

  // State
  let authState = $state(getAuthState());
  let loading = $state(true);

  let logs = $state<AppLog[]>([]);
  let testingFs = $state(false);
  let testResultFs = $state<{ ok: boolean; msg: string } | null>(null);
  let levelFilter = $state<'all' | 'INFO' | 'WARNING' | 'ERROR'>('all');
  
  let members = $state<Member[]>([]);
  
  let emailTestRecipient = $state('');
  let emailTesting = $state(false);
  let emailTestResult = $state<{ ok: boolean; msg: string } | null>(null);
  
  let pushTargetMemberId = $state('');
  let pushTesting = $state(false);
  let pushTestResult = $state<TestPushResult | { error: string } | null>(null);

  // Derived
  let filteredLogs = $derived(
    levelFilter === 'all' ? logs : logs.filter((l) => l.level === levelFilter)
  );

  onMount(() => {
    const unsub = onAuthChange((s) => {
      authState = s;
    });

    initData();

    return () => {
      unsub();
    };
  });

  async function initData() {
    if (!authState.user || !authState.isAdmin) {
      loading = false;
      return;
    }

    try {
      const [_logs, _members, selfMember] = await Promise.all([
        getAppLogs(100),
        getAllMembers(),
        authState.user?.email ? getMemberByEmail(authState.user.email) : Promise.resolve(null),
      ]);
      logs = _logs;
      members = _members.filter((m) => m.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
      if (selfMember) {
        pushTargetMemberId = selfMember.id!;
      }
      if (authState.user?.email) {
        emailTestRecipient = authState.user.email;
      }
    } catch (e) {
      console.warn('[diagnostics] lekérés hiba:', e);
    } finally {
      loading = false;
    }
  }

  async function handleFsTest() {
    if (testingFs) return;
    testingFs = true;
    testResultFs = null;
    try {
      const ok = await pingFirestore();
      testResultFs = { ok, msg: ok ? 'Firestore OK (írás + olvasás + törlés).' : 'A teszt sikertelen.' };
    } catch (e) {
      testResultFs = { ok: false, msg: String(e) };
    } finally {
      testingFs = false;
    }
  }

  async function handlePushTest() {
    if (pushTesting || !pushTargetMemberId) return;
    pushTesting = true;
    pushTestResult = null;
    try {
      const result = await sendTestPush(pushTargetMemberId);
      pushTestResult = result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushTestResult = { error: msg };
    } finally {
      pushTesting = false;
    }
  }

  async function handleEmailTest() {
    if (emailTesting) return;
    const to = emailTestRecipient.trim();
    if (!to) return;
    emailTesting = true;
    emailTestResult = null;
    try {
      const { sendBillingEmails } = await import('../lib/email');
      const now = new Date();
      const result = await sendBillingEmails({
        year: now.getFullYear(),
        monthName: 'Teszt hónap',
        personal: [{ to, name: 'Teszt felhasználó', count: 3, amount: 6900 }],
      });
      const ok = result.personalSent > 0;
      emailTestResult = { ok, msg: ok ? `Email elküldve: ${to}` : `Küldés sikertelen: ${result.personalFailed[0]?.reason ?? 'ismeretlen hiba'}` };
    } catch (e) {
      emailTestResult = { ok: false, msg: String(e) };
    } finally {
      emailTesting = false;
    }
  }

  function handleSignIn() {
    signIn().catch(console.warn);
  }

  function getLogLevelStyle(lvl: string) {
    if (lvl === 'ERROR') return { bg: 'rgba(239,68,68,0.10)', text: '#b91c1c' };
    if (lvl === 'WARNING') return { bg: 'rgba(245,158,11,0.10)', text: '#b45309' };
    return { bg: 'rgba(14,165,233,0.10)', text: '#0369a1' };
  }
</script>

<div class="device">
  <Header currentPage="diagnostics" />
  <main id="diag-body">
    {#if loading || authState.loading}
      <!-- Loading -->
      <div class="px-5 pt-5 space-y-3">
        <div class="grid grid-cols-2 gap-2.5">
          <div class="h-24 rounded-2xl animate-pulse" style="background:var(--line)"></div>
          <div class="h-24 rounded-2xl animate-pulse" style="background:var(--line)"></div>
        </div>
        <div class="h-12 rounded-2xl animate-pulse" style="background:var(--line)"></div>
        {#each Array(5) as _}
          <div class="h-12 rounded-2xl animate-pulse" style="background:var(--line)"></div>
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
      <!-- Main Content -->
      <div class="lg:grid lg:grid-cols-[340px_1fr] lg:gap-6 lg:p-6 lg:pt-5 lg:items-start">
        <aside class="lg:sticky lg:top-[110px] space-y-3 px-5 pt-5 lg:px-0 lg:pt-0">
          
          <!-- Kapcsolatok -->
          <div class="card p-4 fade-up">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-xl">🔥</span>
              <div>
                <p class="eyebrow text-[10px]">Adatbázis</p>
                <p class="text-[15px] font-semibold text-fg-1">Firestore</p>
              </div>
            </div>
            <p class="text-[12px] text-fg-3 mb-3">Test ír/olvas/töröl egy ideiglenes dokumentumot.</p>
            <button onclick={handleFsTest}
              class="w-full px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors {testingFs ? 'opacity-60 cursor-not-allowed' : ''}"
              style="background:color-mix(in oklab,var(--accent) 14%,transparent);color:var(--accent-ink)"
              disabled={testingFs}>
              {testingFs ? 'Tesztelés…' : 'Kapcsolat teszt'}
            </button>
            {#if testResultFs}
              <div class="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold"
                   style="background:{testResultFs.ok ? 'color-mix(in oklab,#10b981 14%,transparent)' : 'color-mix(in oklab,var(--accent) 14%,transparent)'};color:{testResultFs.ok ? '#047857' : 'var(--accent-ink)'}">
                {testResultFs.ok ? '✓' : '✗'} {testResultFs.msg}
              </div>
            {/if}
          </div>

          <!-- Hitelesítés -->
          <div class="card p-4 fade-up">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-xl">🔐</span>
              <div>
                <p class="eyebrow text-[10px]">Hitelesítés</p>
                <p class="text-[15px] font-semibold text-fg-1">Auth állapot</p>
              </div>
            </div>
            <ul class="space-y-1.5 text-[12px]">
              <li class="flex justify-between"><span class="text-fg-3">Email:</span><span class="text-fg-1 font-mono-tnum">{authState.user?.email ?? '–'}</span></li>
              <li class="flex justify-between"><span class="text-fg-3">UID:</span><span class="text-fg-1 font-mono-tnum truncate ml-2 text-right">{(authState.user?.uid ?? '–').slice(0, 12)}…</span></li>
              <li class="flex justify-between"><span class="text-fg-3">Provider:</span><span class="text-fg-1">{authState.user?.providerData[0]?.providerId ?? '–'}</span></li>
              <li class="flex justify-between"><span class="text-fg-3">Admin:</span>
                <span class="font-semibold {authState.isAdmin ? 'text-[color:#047857]' : 'text-[color:var(--fg-2)]'}">{authState.isAdmin ? '✓ Igen' : '✗ Nem'}</span>
              </li>
            </ul>
          </div>

          <!-- Push Test -->
          <div class="card p-4 fade-up">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-xl">🔔</span>
              <div>
                <p class="eyebrow text-[10px]">Push</p>
                <p class="text-[15px] font-semibold text-fg-1">Teszt értesítés</p>
              </div>
            </div>
            <p class="text-[12px] text-fg-3 mb-3">Küld egy teszt push-t a kiválasztott tag minden engedélyezett eszközére. A prefs-eket figyelmen kívül hagyja.</p>
            <label class="block mb-2">
              <span class="text-[10px] font-semibold text-fg-3 block mb-1">Címzett tag</span>
              <select bind:value={pushTargetMemberId} class="select-native w-full rounded-[12px] border px-3 py-2 text-[13px] font-medium text-fg-1 focus:outline-none"
                style="border-color:var(--line-strong); background:var(--bg-card)">
                {#if members.length === 0}
                  <option value="">Nincs tag</option>
                {/if}
                {#each members as m}
                  <option value={m.id}>{m.name}</option>
                {/each}
              </select>
            </label>
            <button onclick={handlePushTest}
              class="w-full px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors {pushTesting ? 'opacity-60 cursor-not-allowed' : ''}"
              style="background:var(--accent);color:white"
              disabled={pushTesting || !pushTargetMemberId}>
              {pushTesting ? 'Küldés…' : 'Push küldése'}
            </button>
            {#if pushTestResult}
              {#if 'error' in pushTestResult}
                <div class="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold"
                     style="background:color-mix(in oklab,var(--danger) 14%,transparent);color:var(--danger-ink)">
                  ✗ {pushTestResult.error}
                </div>
              {:else}
                {@const r = pushTestResult}
                {@const overallOk = r.sent > 0 && r.failed === 0}
                {@const lineColor = overallOk ? 'background:color-mix(in oklab,#10b981 14%,transparent);color:#047857' : r.sent > 0 ? 'background:color-mix(in oklab,#f59e0b 14%,transparent);color:#b45309' : 'background:color-mix(in oklab,var(--danger) 14%,transparent);color:var(--danger-ink)'}
                <div class="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold" style="{lineColor}">
                  {overallOk ? '✓' : r.sent > 0 ? '⚠' : '✗'} {r.devices.length === 0 ? 'Nincs regisztrált eszköze ennek a tagnak.' : `Sikeres: ${r.sent} · Hiba: ${r.failed}`}
                </div>
                {#if r.devices.length > 0}
                  <ul class="mt-2 space-y-1">
                    {#each r.devices as d}
                      <li class="flex items-center justify-between text-[11px] font-mono-tnum">
                        <span class="text-fg-2 truncate">{d.ok ? '✓' : '✗'} {d.device}</span>
                        {#if d.reason}<span class="text-fg-3 ml-2">{d.reason}</span>{/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            {/if}
          </div>

          <!-- Email Test -->
          <div class="card p-4 fade-up">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-xl">📧</span>
              <div>
                <p class="eyebrow text-[10px]">Email</p>
                <p class="text-[15px] font-semibold text-fg-1">Teszt email</p>
              </div>
            </div>
            <p class="text-[12px] text-fg-3 mb-3">Elküld egy teszt elszámolás emailt a megadott címre.</p>
            <input type="email" bind:value={emailTestRecipient}
              class="w-full px-3 py-2 rounded-xl border text-[13px] text-fg-1 focus:outline-none mb-2"
              style="background:var(--bg-elev);border-color:var(--line-strong)"
              placeholder="email@example.com" />
            <button onclick={handleEmailTest}
              class="w-full px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors {emailTesting ? 'opacity-60 cursor-not-allowed' : ''}"
              style="background:color-mix(in oklab,#0ea5e9 14%,transparent);color:#0369a1"
              disabled={emailTesting}>
              {emailTesting ? 'Küldés…' : 'Teszt küldése'}
            </button>
            {#if emailTestResult}
              <div class="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold"
                   style="background:{emailTestResult.ok ? 'color-mix(in oklab,#10b981 14%,transparent)' : 'color-mix(in oklab,var(--accent) 14%,transparent)'};color:{emailTestResult.ok ? '#047857' : 'var(--accent-ink)'}">
                {emailTestResult.ok ? '✓' : '✗'} {emailTestResult.msg}
              </div>
            {/if}
          </div>
        </aside>

        <!-- Logok -->
        <section class="px-5 pt-3 pb-12 lg:px-0 lg:pt-0">
          <div class="card overflow-hidden fade-up" style="border-radius:22px">
            <div class="px-4 py-3 flex items-center justify-between gap-2" style="border-bottom:1px solid var(--line)">
              <div class="flex items-center gap-2">
                <span class="text-base">📜</span>
                <span class="eyebrow">Logok</span>
              </div>
              <div class="flex items-center gap-1">
                {#each [{ v: 'all', label: 'Mind' }, { v: 'INFO', label: 'INFO' }, { v: 'WARNING', label: 'WARN' }, { v: 'ERROR', label: 'ERROR' }] as l}
                  {@const active = levelFilter === l.v}
                  <button onclick={() => levelFilter = l.v as typeof levelFilter}
                    class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                    style="background:{active ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'var(--bg-elev)'};color:{active ? 'var(--accent-ink)' : 'var(--fg-2)'}">
                    {l.label}
                  </button>
                {/each}
              </div>
            </div>
            {#if filteredLogs.length === 0}
              <div class="p-8 text-center text-[13px] text-fg-3">Nincs naplóbejegyzés.</div>
            {:else}
              <ul style="max-height:60vh;overflow-y:auto">
                {#each filteredLogs as log, idx}
                  {@const lvl = log.level || 'INFO'}
                  {@const t = getLogLevelStyle(lvl)}
                  <li class="px-4 py-2.5 flex gap-3" style="{idx === 0 ? '' : 'border-top:1px solid var(--line);'}">
                    <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 self-start mt-0.5"
                          style="background:{t.bg};color:{t.text}">{lvl}</span>
                    <div class="flex-1 min-w-0">
                      <p class="text-[12.5px] font-medium text-fg-1 truncate">{log.message}</p>
                      <p class="text-[10.5px] font-mono-tnum mt-0.5" style="color:var(--fg-3)">
                        {log.created_at_local ?? '–'}{#if log.user_name} · {log.user_name}{/if}{#if log.ip_address} · {log.ip_address}{/if}
                      </p>
                      {#if log.details}
                        <p class="text-[10.5px] mt-1 font-mono-tnum truncate" style="color:var(--fg-3)">
                          {typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details)}
                        </p>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </section>
      </div>
    {/if}
  </main>
</div>
