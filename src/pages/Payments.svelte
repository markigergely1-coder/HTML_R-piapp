<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
  import { getAuthState, onAuthChange, signIn } from '../lib/auth';
  import { logEvent } from '../lib/logger';
  import {
    getAllSettlements,
    getAllInvoices,
    getAllNameMappings,
    addNameMapping,
    deleteNameMapping,
    getSettlement,
    type Settlement,
    type Invoice,
    type NameMapping,
    type FullSettlement,
  } from '../lib/firestore';
  import {
    parseRevolutCsv,
    matchPayments,
    type RevolutTransaction,
    type PaymentMatchResult,
  } from '../lib/revolut';
  import { formatHuf } from '../lib/cost';
  import { MONTHS_HU, TOLERANCE } from '../lib/config';

  // State
  let authState = $state(getAuthState());
  let loading = $state(true);
  
  let invoices = $state<Invoice[]>([]);
  let settlements = $state<Settlement[]>([]);
  let mappings = $state<NameMapping[]>([]);
  
  let selectedKey = $state<string | null>(null);
  let loadedSettlement = $state<FullSettlement | null>(null);
  
  let csvName = $state<string | null>(null);
  let csvTransactions = $state<RevolutTransaction[]>([]);
  let csvParseError = $state<string | null>(null);
  
  let matchResults = $state<PaymentMatchResult[]>([]);
  let unmatchedTransactions = $state<RevolutTransaction[]>([]);
  
  let activeTab = $state<'check' | 'mappings'>('check');
  
  let newRevName = $state('');
  let newSysName = $state('');
  
  let toast = $state<{ kind: 'success' | 'error' | 'info'; msg: string } | null>(null);
  let toastTimer: number | null = null;

  // Derived values for Check tab
  let paidCount = $derived(matchResults.filter((m) => m.status === 'paid' || m.status === 'overpaid').length);
  let underCount = $derived(matchResults.filter((m) => m.status === 'underpaid').length);
  let unpaidCount = $derived(matchResults.filter((m) => m.status === 'unpaid').length);

  let reminderText = $derived.by(() => {
    const unpaidNames = matchResults.filter((m) => m.status === 'unpaid').map((m) => m.systemName);
    const underpaidNames = matchResults.filter((m) => m.status === 'underpaid').map((m) => m.systemName);
    if (loadedSettlement && (unpaidNames.length > 0 || underpaidNames.length > 0)) {
      const lines = [`Sziasztok! 🏐\n`, `A ${loadedSettlement.year}. ${loadedSettlement.monthName} havi röpi befizetéseket ellenőriztem.`];
      if (unpaidNames.length > 0) lines.push(`Nem fizetett: ${unpaidNames.join(', ')}`);
      if (underpaidNames.length > 0) lines.push(`Kevesebbet fizetett: ${underpaidNames.join(', ')}`);
      lines.push(`\nKérlek utaljátok mielőbb! 🙏`);
      return lines.join('\n');
    }
    return '';
  });

  // Derived values for Mappings tab
  let sysNames = $derived((loadedSettlement?.perPerson ?? [])
    .filter((p) => !p.name.includes(' - '))
    .map((p) => p.name));
  
  let alreadyMapped = $derived(new Set(mappings.map((m) => m.revolutName.toUpperCase())));
  let unpairedRevolut = $derived(csvTransactions
    .map((t) => t.name)
    .filter((n) => !alreadyMapped.has(n.toUpperCase()))
    .sort());

  let sortedSettlements = $derived([...settlements].sort((a, b) => (b.year - a.year) || (b.month - a.month)));

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
      const [s, i, m] = await Promise.all([
        getAllSettlements(),
        getAllInvoices(),
        getAllNameMappings().catch(() => []),
      ]);
      settlements = s;
      invoices = i;
      mappings = m;

      const first = sortedSettlements[0];
      if (first) {
        selectedKey = `${first.year}-${String(first.month).padStart(2, '0')}`;
        loadedSettlement = await getSettlement(first.year, first.month);
      }
    } catch (e) {
      console.error('Initialization error:', e);
    } finally {
      loading = false;
    }
  }

  function showToast(kind: 'success' | 'error' | 'info', msg: string) {
    toast = { kind, msg };
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
    }, 3500);
  }

  function runMatching() {
    if (!loadedSettlement) return;
    const mapMap = new Map<string, string>();
    for (const m of mappings) {
      mapMap.set(m.revolutName.toUpperCase(), m.systemName);
    }
    const { results, matchedRevolutNames } = matchPayments(
      loadedSettlement.perPerson,
      csvTransactions,
      mapMap,
      TOLERANCE,
    );
    matchResults = results;
    unmatchedTransactions = csvTransactions.filter(
      (t) => !matchedRevolutNames.has(t.name) && !mapMap.has(t.name.toUpperCase()),
    );
  }

  async function handleMonthChange(e: Event) {
    selectedKey = (e.currentTarget as HTMLSelectElement).value;
    const [y, m] = selectedKey.split('-').map(Number);
    loadedSettlement = await getSettlement(y, m);
    if (csvTransactions.length > 0 && loadedSettlement) {
      runMatching();
    } else {
      matchResults = [];
      unmatchedTransactions = [];
    }
  }

  async function handleCsvUpload(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseRevolutCsv(text);
      csvName = file.name;
      if (result.error) {
        csvParseError = result.error;
        csvTransactions = [];
        matchResults = [];
        unmatchedTransactions = [];
      } else {
        csvParseError = null;
        csvTransactions = result.transactions;
        void logEvent('info', 'CSV imported', { filename: file.name, count: result.transactions.length });
        if (loadedSettlement) {
          runMatching();
        }
      }
    } catch (err) {
      csvParseError = err instanceof Error ? err.message : String(err);
    }
  }

  async function copyReminder() {
    try {
      await navigator.clipboard.writeText(reminderText);
      showToast('success', 'Másolva a vágólapra');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = reminderText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('success', 'Másolva');
    }
  }

  async function handleAddMapping() {
    const rev = newRevName.trim();
    const sys = newSysName.trim();
    if (!rev || !sys) {
      showToast('error', '⚠️ Mindkét nevet add meg!');
      return;
    }
    try {
      await addNameMapping(rev, sys);
      void logEvent('info', 'Name mapping added', { revolutName: rev, systemName: sys });
      mappings = await getAllNameMappings();
      newRevName = '';
      newSysName = '';
      if (csvTransactions.length > 0 && loadedSettlement) {
        runMatching();
      }
      showToast('success', `✅ ${rev} → ${sys}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `❌ ${msg}`);
    }
  }

  async function handleDeleteMapping(id: string) {
    try {
      await deleteNameMapping(id);
      mappings = await getAllNameMappings();
      if (csvTransactions.length > 0 && loadedSettlement) {
        runMatching();
      }
      showToast('success', '🗑️ Párosítás törölve');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `❌ ${msg}`);
    }
  }

  function handleSignIn() {
    signIn().catch(console.warn);
  }

  function statusBadge(status: PaymentMatchResult['status']) {
    const map = {
      paid:      { text: '✅ Fizetett',           bg: 'rgba(16,185,129,0.14)', color: '#047857' },
      overpaid:  { text: '✅ Többet fizetett',    bg: 'rgba(16,185,129,0.14)', color: '#047857' },
      underpaid: { text: '⚠️ Kevesebbet',         bg: 'rgba(245,158,11,0.14)', color: '#92400e' },
      unpaid:    { text: '❌ Nem fizetett',       bg: 'rgba(239,68,68,0.12)',  color: '#b91c1c' },
    };
    return map[status];
  }
</script>

<div class="device">
  <Header currentPage="payments" />
  <main id="pay-body">
    {#if loading || authState.loading}
      <!-- Loading -->
      <div class="px-5 pt-5 space-y-3">
        <div class="h-24 rounded-2xl animate-pulse" style="background:var(--line)"></div>
        {#each Array(5) as _}
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
    {:else if settlements.length === 0}
      <!-- Empty Settlements -->
      <div class="px-5 pt-5 pb-12">
        <div class="card-soft p-8 text-center" style="border-radius:22px">
          <div class="text-3xl mb-2">📭</div>
          <p class="text-[14px] font-semibold text-fg-1">Nincs mentett elszámolás</p>
          <p class="text-[12px] text-fg-3 mt-1 max-w-[280px] mx-auto">
            Először futtasd le az elszámolást a <strong>Havi Elszámolás</strong> oldalon.
          </p>
        </div>
      </div>
    {:else}
      <!-- Main Content -->
      <div class="px-5 pt-5 pb-12 lg:px-6 lg:pt-5 space-y-4">
        <!-- Hónap kiválasztó -->
        <div class="card p-4 fade-up" style="border-radius:18px">
          <p class="eyebrow text-[10px] mb-2">Elszámolási hónap</p>
          <select value={selectedKey} onchange={handleMonthChange}
            class="select-native w-full rounded-[10px] border px-3 py-2 text-[13px] font-medium text-fg-1 focus:outline-none"
            style="border-color:var(--line-strong); background:var(--bg-card)">
            {#each sortedSettlements as s}
              {@const key = `${s.year}-${String(s.month).padStart(2, '0')}`}
              {@const monthName = MONTHS_HU[s.month - 1] ?? `${s.month}. hó`}
              <option value={key}>{s.year}. {monthName}</option>
            {/each}
          </select>
          {#if loadedSettlement}
            <p class="text-[11px] text-fg-3 mt-2">{loadedSettlement.perPerson.length} fő, összesen {formatHuf(loadedSettlement.perPerson.reduce((s, p) => s + p.amount, 0))}</p>
          {/if}
        </div>

        <!-- Tab navigáció -->
        <div class="flex gap-1 fade-up" style="border-bottom:1px solid var(--line)">
          <button class="px-3.5 py-2.5 text-[13px] font-medium relative" onclick={() => activeTab = 'check'}
            style="color:{activeTab === 'check' ? 'var(--fg-1)' : 'var(--fg-3)'}">
            📤 Kivonat & Ellenőrzés
            {#if activeTab === 'check'}<span class="absolute left-3 right-3 bottom-0 h-[2px] rounded-full" style="background:var(--accent)"></span>{/if}
          </button>
          <button class="px-3.5 py-2.5 text-[13px] font-medium relative" onclick={() => activeTab = 'mappings'}
            style="color:{activeTab === 'mappings' ? 'var(--fg-1)' : 'var(--fg-3)'}">
            🔗 Név párosítások
            {#if activeTab === 'mappings'}<span class="absolute left-3 right-3 bottom-0 h-[2px] rounded-full" style="background:var(--accent)"></span>{/if}
          </button>
        </div>

        {#if activeTab === 'check'}
          <div class="space-y-4 fade-up">
            <!-- File upload -->
            <div class="card p-4" style="border-radius:18px">
              <p class="eyebrow text-[10px] mb-3">Revolut CSV feltöltés</p>
              <label class="block w-full p-6 rounded-xl border-2 border-dashed cursor-pointer text-center hover:bg-[color:var(--bg-elev)] transition-colors"
                style="border-color:var(--line-strong)">
                {#if csvName}
                  <div>
                    <p class="text-[14px] font-semibold text-fg-1 mb-1">✅ {csvName}</p>
                    <p class="text-[11.5px] text-fg-3">{csvTransactions.length} bejövő átutalás</p>
                    <p class="text-[10px] text-fg-3 mt-2">Klikk másik fájl választásához</p>
                  </div>
                {:else}
                  <div>
                    <p class="text-2xl mb-1">📤</p>
                    <p class="text-[13.5px] font-semibold text-fg-1">Húzd ide vagy klikkelj</p>
                    <p class="text-[11px] text-fg-3 mt-1">Revolut CSV kivonat</p>
                  </div>
                {/if}
                <input type="file" accept=".csv,text/csv" class="hidden" onchange={handleCsvUpload} />
              </label>
              
              {#if csvParseError}
                <div class="mt-3 p-2.5 rounded-lg" style="background:rgba(239,68,68,0.10);color:#b91c1c">
                  <p class="text-[12px] font-semibold">❌ {csvParseError}</p>
                </div>
              {/if}
              
              {#if !csvName && !csvParseError}
                <div class="mt-3 p-3 rounded-lg text-[11.5px] leading-relaxed" style="background:rgba(14,165,233,0.08);color:#075985">
                  <p class="font-semibold mb-1">💡 Hogyan exportáld:</p>
                  <ol class="list-decimal list-inside space-y-0.5">
                    <li>Revolut app → fiókod → Kimutatások / Statements</li>
                    <li>Válaszd ki a hónapot → Formátum: <strong>CSV</strong></li>
                    <li>Töltsd fel itt</li>
                  </ol>
                </div>
              {/if}
            </div>

            {#if csvName && matchResults.length > 0}
              <!-- Stat metrics -->
              <div class="grid grid-cols-3 gap-2">
                <div class="card relative p-3.5 overflow-hidden lift">
                  <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:rgba(16,185,129,0.12);filter:blur(8px)"></div>
                  <p class="relative eyebrow text-[10px] mb-1">✅ Fizetett</p>
                  <p class="relative font-mono-tnum font-semibold text-[22px] leading-none num-display" style="color:#047857">{paidCount}</p>
                </div>
                <div class="card relative p-3.5 overflow-hidden lift">
                  <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:rgba(245,158,11,0.14);filter:blur(8px)"></div>
                  <p class="relative eyebrow text-[10px] mb-1">⚠️ Kevesebb</p>
                  <p class="relative font-mono-tnum font-semibold text-[22px] leading-none num-display" style="color:#92400e">{underCount}</p>
                </div>
                <div class="card relative p-3.5 overflow-hidden lift">
                  <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:rgba(239,68,68,0.12);filter:blur(8px)"></div>
                  <p class="relative eyebrow text-[10px] mb-1">❌ Nem fizetett</p>
                  <p class="relative font-mono-tnum font-semibold text-[22px] leading-none num-display" style="color:#b91c1c">{unpaidCount}</p>
                </div>
              </div>

              <!-- Riport tábla -->
              <div class="card overflow-hidden" style="border-radius:20px">
                <div class="px-4 py-3" style="border-bottom:1px solid var(--line)">
                  <p class="eyebrow text-[10px]">Befizetések egyeztetése</p>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full" style="border-collapse:collapse;min-width:600px">
                    <thead style="background:var(--bg-elev)">
                      <tr>
                        <th class="px-3 py-2 text-[10.5px] text-left font-semibold text-fg-3 uppercase tracking-wider">Név</th>
                        <th class="px-3 py-2 text-[10.5px] text-left font-semibold text-fg-3 uppercase tracking-wider">Revolut</th>
                        <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Fizetendő</th>
                        <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Befizetett</th>
                        <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Diff</th>
                        <th class="px-3 py-2 text-[10.5px] text-left font-semibold text-fg-3 uppercase tracking-wider">Státusz</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each matchResults as m}
                        {@const badge = statusBadge(m.status)}
                        {@const diffStr = m.diff !== null ? `${m.diff >= 0 ? '+' : ''}${formatHuf(m.diff)}` : '—'}
                        {@const diffColor = m.diff === null ? 'var(--fg-3)' : Math.abs(m.diff) <= TOLERANCE ? 'var(--fg-2)' : m.diff > 0 ? '#047857' : '#b91c1c'}
                        <tr style="border-top:1px solid var(--line)">
                          <td class="px-3 py-2 text-[12px] font-medium text-fg-1">{m.systemName}</td>
                          <td class="px-3 py-2 text-[11.5px] text-fg-3 truncate" title={m.matchedRevolutName ?? ''}>{m.matchedRevolutName ?? '— ismeretlen'}</td>
                          <td class="px-3 py-2 text-[12px] text-fg-2 text-right font-mono-tnum">{formatHuf(m.expected)}</td>
                          <td class="px-3 py-2 text-[12px] text-fg-1 text-right font-mono-tnum">{m.paid !== null ? formatHuf(m.paid) : '—'}</td>
                          <td class="px-3 py-2 text-[12px] text-right font-mono-tnum font-semibold" style="color:{diffColor}">{diffStr}</td>
                          <td class="px-3 py-2 text-[12px]">
                            <span class="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style="background:{badge.bg};color:{badge.color}">{badge.text}</span>
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Emlékeztető szöveg -->
              {#if reminderText}
                <div class="card p-4" style="border-radius:18px">
                  <div class="flex items-center justify-between mb-2">
                    <p class="eyebrow text-[10px]">💬 Emlékeztető üzenet</p>
                    <button onclick={copyReminder}
                      class="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                      style="background:color-mix(in oklab,var(--accent) 14%,transparent);color:var(--accent-ink)">
                      Másolás
                    </button>
                  </div>
                  <pre class="text-[12px] text-fg-1 whitespace-pre-wrap font-mono-tnum p-3 rounded-lg" style="background:var(--bg-elev)">{reminderText}</pre>
                </div>
              {/if}

              <!-- Párosítatlan Revolut -->
              {#if unmatchedTransactions.length > 0}
                <div class="card overflow-hidden" style="border-radius:20px">
                  <div class="px-4 py-3" style="border-bottom:1px solid var(--line)">
                    <p class="eyebrow text-[10px] mb-0.5">🔍 Párosítatlan Revolut befizetők</p>
                    <p class="text-[11px] text-fg-3">Ezek nem lettek senkihez rendelve. Párosítsd a "Név párosítások" tabon.</p>
                  </div>
                  <ul>
                    {#each unmatchedTransactions as t}
                      <li class="px-4 py-2.5 flex items-center justify-between" style="border-top:1px solid var(--line)">
                        <span class="text-[12px] font-medium text-fg-1 truncate flex-1">{t.name}</span>
                        <span class="font-mono-tnum text-[12px] text-fg-2 ml-3">{formatHuf(t.amount)}</span>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            {/if}
          </div>
        {:else}
          <div class="space-y-4 fade-up">
            <!-- Új mapping form -->
            <div class="card p-4" style="border-radius:18px">
              <p class="eyebrow text-[10px] mb-3">Új párosítás hozzáadása</p>
              <div class="space-y-3">
                <label class="block">
                  <span class="text-[11.5px] font-medium text-fg-2 mb-1 block">Revolut név</span>
                  {#if unpairedRevolut.length > 0}
                    <select bind:value={newRevName}
                      class="select-native w-full rounded-[10px] border px-3 py-2 text-[13px] font-medium text-fg-1 focus:outline-none"
                      style="border-color:var(--line-strong); background:var(--bg-card)">
                      <option value="">— Válassz vagy gépeld lentebb —</option>
                      {#each unpairedRevolut as n}
                        <option value={n}>{n}</option>
                      {/each}
                    </select>
                  {:else}
                    <p class="text-[11.5px] text-fg-3 mb-2">Nincs feltöltött CSV, vagy minden név párosítva van.</p>
                  {/if}
                  <input type="text" placeholder="Vagy gépeld be manuálisan…" bind:value={newRevName}
                    class="w-full mt-2 rounded-[10px] border px-3 py-2 text-[13px] text-fg-1 focus:outline-none"
                    style="border-color:var(--line-strong); background:var(--bg-card)" />
                </label>
                <label class="block">
                  <span class="text-[11.5px] font-medium text-fg-2 mb-1 block">Rendszer név</span>
                  <select bind:value={newSysName}
                    class="select-native w-full rounded-[10px] border px-3 py-2 text-[13px] font-medium text-fg-1 focus:outline-none"
                    style="border-color:var(--line-strong); background:var(--bg-card)">
                    <option value="">— Válassz —</option>
                    {#each sysNames as n}
                      <option value={n}>{n}</option>
                    {/each}
                  </select>
                </label>
                <button onclick={handleAddMapping}
                  class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors"
                  style="background:var(--accent)">
                  💾 Párosítás mentése
                </button>
              </div>
            </div>

            <!-- Mentett párosítások -->
            <div class="card overflow-hidden" style="border-radius:20px">
              <div class="px-4 py-3" style="border-bottom:1px solid var(--line)">
                <p class="eyebrow text-[10px]">Mentett párosítások</p>
              </div>
              {#if mappings.length === 0}
                <div class="px-4 py-6 text-center text-[12px] text-fg-3">Még nincsenek mentett párosítások.</div>
              {:else}
                <ul>
                  {#each mappings as m}
                    <li class="px-4 py-2.5 flex items-center gap-3" style="border-top:1px solid var(--line)">
                      <div class="flex-1 min-w-0">
                        <p class="text-[12px] font-semibold text-fg-1 truncate">{m.revolutName}</p>
                        <p class="text-[10.5px] text-fg-3">→ {m.systemName}</p>
                      </div>
                      <button onclick={() => handleDeleteMapping(m.id!)} class="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                        style="background:rgba(239,68,68,0.10);color:#b91c1c">
                        Törlés
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </main>

  <!-- Toast -->
  {#if toast}
    <div class="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 px-4 py-2.5 rounded-full text-[12.5px] font-semibold shadow-lg fade-up"
         style="background:{toast.kind === 'success' ? 'rgba(16,185,129,0.14)' : toast.kind === 'error' ? 'rgba(239,68,68,0.14)' : 'rgba(14,165,233,0.14)'};color:{toast.kind === 'success' ? '#047857' : toast.kind === 'error' ? '#b91c1c' : '#0369a1'};max-width:90vw">
      {toast.msg}
    </div>
  {/if}
</div>
