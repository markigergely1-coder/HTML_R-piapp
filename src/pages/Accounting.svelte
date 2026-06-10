<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Header from '../components/Header.svelte';
  import { getAuthState, onAuthChange, signIn } from '../lib/auth';
  import { logEvent } from '../lib/logger';
  import {
    getAllSettlements,
    getAllInvoices,
    getAllAttendanceRecords,
    getAllMembers,
    getCancelledSessions,
    getSettlement,
    saveSettlement,
    type Settlement,
    type Invoice,
    type FullSettlement,
    type Member,
  } from '../lib/firestore';
  import { calculateMonthlyAccounting, type AccountingResult } from '../lib/accounting';
  import { formatHuf } from '../lib/cost';
  import { MONTHS_HU } from '../lib/config';

  interface EmailRecipient {
    systemName: string;
    email: string;
    count: number;
    amount: number;
    ownCount: number;
    ownAmount: number;
    guests: { name: string; count: number; amount: number }[];
    selected: boolean;
  }

  interface BulkResult {
    ok: { label: string; year: number; month: number; people: number; total: number }[];
    skipped: { label: string }[];
    failed: { label: string; reason: string }[];
    total: number;
  }

  // State
  let authState = $state(getAuthState());
  let loading = $state(true);
  
  let settlements = $state<Settlement[]>([]);
  let invoices = $state<Invoice[]>([]);
  let members = $state<Member[]>([]);
  
  let selectedInvoiceId = $state<string | null>(null);
  let loadedCalc = $state<AccountingResult | FullSettlement | null>(null);
  let loadedFromCache = $state(false);
  let calculating = $state(false);
  
  let bulkRunning = $state(false);
  let bulkForce = $state(false);
  let bulkResult = $state<BulkResult | null>(null);
  
  let emailRecipients = $state<EmailRecipient[]>([]);
  let emailAdminToggle = $state(true);
  let emailSending = $state(false);
  let emailResult = $state<{ sent: number; failed: { to: string; reason: string }[]; adminSent: boolean } | null>(null);
  let toast = $state<{ kind: 'success' | 'error' | 'info'; msg: string } | null>(null);
  let toastTimer: number | null = null;

  // Derived Values
  let totalAmount = $derived(invoices.reduce((s, i) => s + i.amount, 0));
  let selectedCount = $derived(emailRecipients.filter((r) => r.selected).length);

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
        getAllMembers().catch(() => [] as Member[]),
      ]);
      settlements = s;
      invoices = i;
      members = m;

      selectedInvoiceId = invoices[0]?.id ?? null;

      if (selectedInvoiceId) {
        const inv = invoices.find((inv) => inv.id === selectedInvoiceId)!;
        const existing = await getSettlement(inv.target_year, inv.target_month);
        if (existing) {
          loadedCalc = existing;
          loadedFromCache = true;
        }
      }
      recomputeEmailRecipients();
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

  function recomputeEmailRecipients() {
    if (!loadedCalc) {
      emailRecipients = [];
      return;
    }

    const emailByName = new Map<string, { email: string; active: boolean }>();
    for (const m of members) {
      if (m.name) emailByName.set(m.name.trim(), { email: m.email, active: m.active });
    }

    const recipients: EmailRecipient[] = [];
    const mainRows = loadedCalc.perPerson.filter((p) => !p.name.includes(' - '));

    for (const main of mainRows) {
      const lookup = emailByName.get(main.name);
      if (!lookup || !lookup.email || !lookup.active) continue;

      const prefix = `${main.name} - `;
      const guests = loadedCalc.perPerson
        .filter((p) => p.name.startsWith(prefix))
        .map((p) => ({
          name: p.name.slice(prefix.length),
          count: p.count,
          amount: p.amount,
        }));

      const guestTotalCount = guests.reduce((s, g) => s + g.count, 0);
      const guestTotalAmount = guests.reduce((s, g) => s + g.amount, 0);
      const total = main.amount + guestTotalAmount;

      if (total <= 0) continue;

      recipients.push({
        systemName: main.name,
        email: lookup.email,
        count: main.count + guestTotalCount,
        amount: total,
        ownCount: main.count,
        ownAmount: main.amount,
        guests,
        selected: true,
      });
    }

    emailRecipients = recipients;
  }

  async function handleInvoiceChange(e: Event) {
    const val = (e.currentTarget as HTMLSelectElement).value;
    selectedInvoiceId = val;
    loadedCalc = null;
    loadedFromCache = false;
    emailResult = null;

    const inv = invoices.find((i) => i.id === selectedInvoiceId);
    if (inv) {
      const existing = await getSettlement(inv.target_year, inv.target_month);
      if (existing) {
        loadedCalc = existing;
        loadedFromCache = true;
      }
    }
    recomputeEmailRecipients();
  }

  async function handleCalculate() {
    const inv = invoices.find((i) => i.id === selectedInvoiceId);
    if (!inv || calculating) return;

    calculating = true;
    try {
      const [attendance, cancelled] = await Promise.all([
        getAllAttendanceRecords(),
        getCancelledSessions(),
      ]);
      const result = calculateMonthlyAccounting(inv, attendance, cancelled, MONTHS_HU);
      
      await saveSettlement({
        year: result.year,
        month: inv.target_month,
        monthName: result.monthName,
        breakdown: result.breakdown,
        perPerson: result.perPerson,
      });
      
      loadedCalc = result;
      loadedFromCache = false;
      settlements = await getAllSettlements();
      recomputeEmailRecipients();
      emailResult = null;
      
      showToast('success', `✅ Kalkuláció kész: ${result.year}. ${result.monthName}`);
      void logEvent('info', 'Accounting calculated', { year: result.year, month: inv.target_month, monthName: result.monthName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `❌ ${msg}`);
    } finally {
      calculating = false;
    }
  }

  async function handleDownloadPdf() {
    if (!loadedCalc || loadedCalc.perPerson.length === 0) {
      showToast('error', 'Nincs adat a PDF generáláshoz.');
      return;
    }
    try {
      const monthName = 'monthName' in loadedCalc ? loadedCalc.monthName : '';
      const { generateSettlementPdf, downloadPdf } = await import('../lib/pdf');
      const blob = generateSettlementPdf({
        year: loadedCalc.year,
        monthName,
        perPerson: loadedCalc.perPerson,
      });
      const filename = `Havi_Elszamolas_${loadedCalc.year}_${monthName.replace(/\s+/g, '_')}.pdf`;
      downloadPdf(blob, filename);
      showToast('success', '📥 PDF letöltve');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `❌ PDF hiba: ${msg}`);
    }
  }

  async function handleEmailSend() {
    if (!loadedCalc) return;
    const selected = emailRecipients.filter((r) => r.selected);
    if (selected.length === 0 && !emailAdminToggle) {
      showToast('error', 'Nincs kit küldeni.');
      return;
    }

    emailSending = true;
    emailResult = null;

    try {
      const monthName = 'monthName' in loadedCalc ? loadedCalc.monthName : '';
      let pdfBase64: string | undefined;
      
      if (emailAdminToggle) {
        const { generateSettlementPdf } = await import('../lib/pdf');
        const { blobToBase64 } = await import('../lib/email');
        const blob = generateSettlementPdf({
          year: loadedCalc.year,
          monthName,
          perPerson: loadedCalc.perPerson,
        });
        pdfBase64 = await blobToBase64(blob);
      }

      const { sendBillingEmails } = await import('../lib/email');
      const adminEmail = emailAdminToggle ? (authState.user?.email ?? '') : undefined;

      const result = await sendBillingEmails({
        year: loadedCalc.year,
        monthName,
        personal: selected.map((r) => ({
          to: r.email,
          name: r.systemName,
          count: r.count,
          amount: r.amount,
          guestDetails: r.guests.length > 0 ? {
            ownCount: r.ownCount,
            ownCost: r.ownAmount,
            guests: r.guests.map((g) => ({ name: g.name, count: g.count, cost: g.amount })),
          } : undefined,
        })),
        adminEmail,
        adminSummaryRows: emailAdminToggle
          ? loadedCalc.perPerson.map((p) => ({ name: p.name, count: p.count, amount: p.amount }))
          : undefined,
        pdfBase64,
      });

      emailResult = {
        sent: result.personalSent,
        failed: result.personalFailed,
        adminSent: result.adminSent,
      };
      
      const errPart = result.adminError ? ` (admin: ${result.adminError})` : '';
      showToast(result.personalFailed.length === 0 ? 'success' : 'info', `📧 ${result.personalSent}/${result.totalRequested} kiküldve${errPart}`);
      void logEvent('info', 'Billing emails sent', { sent: result.personalSent, failed: result.personalFailed.length, year: loadedCalc.year, monthName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `❌ Email küldési hiba: ${msg}`);
    } finally {
      emailSending = false;
    }
  }

  async function handleBulkGenerate() {
    if (bulkRunning) return;
    bulkRunning = true;
    bulkResult = null;
    void logEvent('info', 'Bulk accounting started', { invoiceCount: invoices.length });
    
    try {
      const [attendance, cancelled] = await Promise.all([
        getAllAttendanceRecords(),
        getCancelledSessions(),
      ]);
      const result: BulkResult = { ok: [], skipped: [], failed: [], total: invoices.length };
      
      for (const inv of invoices) {
        const monthName = MONTHS_HU[inv.target_month - 1] ?? `${inv.target_month}. hó`;
        const label = `${inv.target_year}. ${monthName}`;
        try {
          if (!bulkForce) {
            const existing = await getSettlement(inv.target_year, inv.target_month);
            if (existing) {
              result.skipped.push({ label });
              continue;
            }
          }
          const calc = calculateMonthlyAccounting(inv, attendance, cancelled, MONTHS_HU);
          await saveSettlement({
            year: calc.year,
            month: inv.target_month,
            monthName: calc.monthName,
            breakdown: calc.breakdown,
            perPerson: calc.perPerson,
          });
          const total = calc.perPerson.reduce((s, p) => s + p.amount, 0);
          result.ok.push({ label, year: calc.year, month: inv.target_month, people: calc.perPerson.length, total });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.failed.push({ label, reason: msg });
        }
      }
      bulkResult = result;
    } catch (err) {
      showToast('error', `❌ Bulk fail: ${String(err)}`);
    } finally {
      bulkRunning = false;
      settlements = await getAllSettlements();
    }
  }

  function handleSignIn() {
    signIn().catch(console.warn);
  }
</script>

<div class="device">
  <Header currentPage="accounting" />
  <main id="acc-body">
    {#if loading || authState.loading}
      <!-- Loading -->
      <div class="px-5 pt-5 space-y-3">
        <div class="grid grid-cols-3 gap-2.5">
          {#each Array(3) as _}
            <div class="h-20 rounded-2xl animate-pulse" style="background:var(--line)"></div>
          {/each}
        </div>
        {#each Array(4) as _}
          <div class="h-16 rounded-2xl animate-pulse" style="background:var(--line)"></div>
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
    {:else if invoices.length === 0}
      <!-- Empty Invoices -->
      <div class="px-5 pt-5 pb-12">
        <div class="card-soft p-8 text-center" style="border-radius:22px">
          <div class="text-3xl mb-2">📭</div>
          <p class="text-[14px] font-semibold text-fg-1">Nincs számla</p>
          <p class="text-[12px] text-fg-3 mt-1">Először szinkronizáld a számlákat az Adatbázis oldalról.</p>
        </div>
      </div>
    {:else}
      <!-- Main Content -->
      <div class="px-5 pt-5 pb-12 lg:px-6 lg:pt-5 space-y-4">
        <!-- Stat sáv -->
        <div class="grid grid-cols-3 gap-2 fade-up">
          <div class="card relative p-3.5 overflow-hidden lift">
            <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:color-mix(in oklab,var(--accent) 10%,transparent);filter:blur(8px)"></div>
            <div class="relative flex items-center justify-between mb-2">
              <span class="eyebrow text-[10px]">Számlák</span>
              <span class="w-1.5 h-1.5 rounded-full" style="background:var(--accent)"></span>
            </div>
            <p class="relative font-mono-tnum font-semibold leading-none num-display text-fg-1 text-[24px]">{invoices.length}</p>
          </div>
          <div class="card relative p-3.5 overflow-hidden lift">
            <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:rgba(14,165,233,0.10);filter:blur(8px)"></div>
            <div class="relative flex items-center justify-between mb-2">
              <span class="eyebrow text-[10px]">Elszámolás</span>
              <span class="w-1.5 h-1.5 rounded-full" style="background:#0ea5e9"></span>
            </div>
            <p class="relative font-mono-tnum font-semibold leading-none num-display text-fg-1 text-[24px]">{settlements.length}</p>
          </div>
          <div class="card relative p-3.5 overflow-hidden lift">
            <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:rgba(16,185,129,0.10);filter:blur(8px)"></div>
            <div class="relative flex items-center justify-between mb-2">
              <span class="eyebrow text-[10px]">Össz.</span>
              <span class="w-1.5 h-1.5 rounded-full" style="background:#10b981"></span>
            </div>
            <p class="relative font-mono-tnum font-semibold leading-none num-display text-fg-1 text-[16px]">{formatHuf(totalAmount)}</p>
          </div>
        </div>

        <!-- Invoice kiválasztó + Kalkulálás -->
        <div class="card p-4 fade-up" style="border-radius:18px">
          <p class="eyebrow text-[10px] mb-2">Hónap kiválasztása</p>
          <select value={selectedInvoiceId} onchange={handleInvoiceChange}
            class="select-native w-full rounded-[10px] border px-3 py-2 text-[13px] font-medium text-fg-1 focus:outline-none"
            style="border-color:var(--line-strong); background:var(--bg-card)">
            {#each invoices as inv}
              {@const monthName = MONTHS_HU[inv.target_month - 1] ?? `${inv.target_month}. hó`}
              <option value={inv.id}>{inv.target_year}. {monthName} (Számla: {inv.inv_date} · {formatHuf(inv.amount)})</option>
            {/each}
          </select>
          <button onclick={handleCalculate}
            class="mt-3 w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors {calculating ? 'opacity-60 cursor-not-allowed' : ''}"
            style="background:var(--accent)"
            disabled={calculating}>
            {calculating ? 'Kalkulálás…' : 'Elszámolás Kalkulálása 🚀'}
          </button>
        </div>

        <!-- Mentett elszámolás eredménye -->
        {#if loadedCalc}
          {@const c = loadedCalc}
          {@const totalPaid = c.perPerson.reduce((s, p) => s + p.amount, 0)}
          <div class="card fade-up overflow-hidden" style="border-radius:20px">
            <div class="px-4 py-3 flex items-center justify-between gap-2" style="border-bottom:1px solid var(--line)">
              <div class="min-w-0 flex-1">
                <p class="eyebrow text-[10px] mb-0.5">Elszámolás</p>
                <p class="text-[15px] font-bold text-fg-1 truncate">{'monthName' in c ? c.year + '. ' + c.monthName : ''}</p>
              </div>
              <div class="flex items-center gap-2 flex-none">
                {#if loadedFromCache}
                  <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:rgba(14,165,233,0.14);color:#0369a1">💾 Mentett</span>
                {:else}
                  <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:rgba(16,185,129,0.14);color:#047857">✅ Most kalkulálva</span>
                {/if}
                <button onclick={handleDownloadPdf}
                  class="text-[11.5px] font-semibold px-2.5 py-1 rounded-full transition-colors inline-flex items-center gap-1"
                  style="background:color-mix(in oklab,var(--accent) 14%,transparent);color:var(--accent-ink)"
                  title="PDF letöltése">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M8 2v9M5 8l3 3 3-3M3 13h10"/>
                  </svg>
                  PDF
                </button>
              </div>
            </div>

            <div class="px-4 pt-3">
              <p class="eyebrow text-[10px] mb-2">Bontás alkalmanként</p>
              <div class="rounded-lg overflow-hidden" style="border:1px solid var(--line)">
                <table class="w-full" style="border-collapse:collapse">
                  <thead style="background:var(--bg-elev)">
                    <tr>
                      <th class="px-3 py-2 text-[10.5px] text-left font-semibold text-fg-3 uppercase tracking-wider">Dátum</th>
                      <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Költség / alk.</th>
                      <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Létszám</th>
                      <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Költség / fő</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each c.breakdown as b}
                      <tr style="border-top:1px solid var(--line)">
                        <td class="px-3 py-2 text-[12px] font-medium text-fg-1">{b.date}</td>
                        <td class="px-3 py-2 text-[12px] text-fg-2 text-right font-mono-tnum">{formatHuf(b.costPerSession)}</td>
                        <td class="px-3 py-2 text-[12px] text-fg-2 text-right font-mono-tnum">{b.attendeeCount} fő</td>
                        <td class="px-3 py-2 text-[12px] text-fg-1 text-right font-mono-tnum font-semibold">{formatHuf(b.costPerPerson)}</td>
                      </tr>
                    {:else}
                      <tr><td colspan="4" class="px-3 py-3 text-center text-[12px] text-fg-3">Nincs adat</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>

            <div class="px-4 pt-4 pb-4">
              <p class="eyebrow text-[10px] mb-2">Személyenkénti összesítő</p>
              <div class="rounded-lg overflow-hidden" style="border:1px solid var(--line)">
                <table class="w-full" style="border-collapse:collapse">
                  <thead style="background:var(--bg-elev)">
                    <tr>
                      <th class="px-3 py-2 text-[10.5px] text-left font-semibold text-fg-3 uppercase tracking-wider">Név</th>
                      <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Részvétel</th>
                      <th class="px-3 py-2 text-[10.5px] text-right font-semibold text-fg-3 uppercase tracking-wider">Fizetendő</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each c.perPerson as p}
                      <tr style="border-top:1px solid var(--line)">
                        <td class="px-3 py-2 text-[12px] font-medium text-fg-1">{p.name}</td>
                        <td class="px-3 py-2 text-[12px] text-fg-2 text-right font-mono-tnum">{p.count}</td>
                        <td class="px-3 py-2 text-[12px] text-fg-1 text-right font-mono-tnum font-semibold">{formatHuf(p.amount)}</td>
                      </tr>
                    {:else}
                      <tr><td colspan="3" class="px-3 py-3 text-center text-[12px] text-fg-3">Nincs adat</td></tr>
                    {/each}
                  </tbody>
                  {#if c.perPerson.length > 0}
                    <tfoot>
                      <tr style="border-top:2px solid var(--line-strong);background:var(--bg-elev)">
                        <td class="px-3 py-2 text-[11.5px] font-bold text-fg-1">Összesen</td>
                        <td class="px-3 py-2 text-[11.5px] text-right font-mono-tnum font-bold text-fg-1">{c.perPerson.reduce((s, p) => s + p.count, 0)}</td>
                        <td class="px-3 py-2 text-[11.5px] text-right font-mono-tnum font-bold text-fg-1">{formatHuf(totalPaid)}</td>
                      </tr>
                    </tfoot>
                  {/if}
                </table>
              </div>
            </div>
          </div>

          <!-- Email Section -->
          {#if emailRecipients.length === 0}
            <div class="card p-4 fade-up" style="border-radius:18px">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-lg">📧</span>
                <p class="text-[14px] font-semibold text-fg-1">Email küldés</p>
              </div>
              <p class="text-[11.5px] text-fg-3">Nincs aktív tag email-címmel ehhez az elszámoláshoz. (A Tagok oldalon vegyél fel embereket email-lel.)</p>
            </div>
          {:else}
            <div class="card fade-up overflow-hidden" style="border-radius:20px">
              <div class="px-4 py-3 flex items-center justify-between gap-2" style="border-bottom:1px solid var(--line)">
                <div>
                  <p class="eyebrow text-[10px] mb-0.5">📧 Email küldés</p>
                  <p class="text-[13px] font-semibold text-fg-1">{selectedCount} / {emailRecipients.length} tag kijelölve</p>
                </div>
                <div class="flex items-center gap-2">
                  <button onclick={() => emailRecipients.forEach((r) => r.selected = true)} class="text-[11.5px] font-semibold px-2.5 py-1 rounded-full"
                    style="background:var(--bg-elev);color:var(--fg-2)">Mindet</button>
                  <button onclick={() => emailRecipients.forEach((r) => r.selected = false)} class="text-[11.5px] font-semibold px-2.5 py-1 rounded-full"
                    style="background:var(--bg-elev);color:var(--fg-2)">Egyiket sem</button>
                </div>
              </div>
              <ul>
                {#each emailRecipients as r, idx}
                  <li class="px-3 py-2.5 flex items-center gap-3" style="{idx === 0 ? '' : 'border-top:1px solid var(--line);'}">
                    <input type="checkbox" bind:checked={r.selected}
                      style="width:16px;height:16px;accent-color:var(--accent);flex:none;" />
                    <div class="flex-1 min-w-0">
                      <p class="text-[12.5px] font-semibold text-fg-1 truncate">{r.systemName}</p>
                      <p class="text-[10.5px] text-fg-3 truncate">
                        {r.email}
                        {#if r.guests.length > 0}
                          <span class="text-[10.5px] text-fg-3"> · vendég: {r.guests.map((g) => g.name).join(', ')}</span>
                        {/if}
                      </p>
                    </div>
                    <div class="text-right flex-none">
                      <p class="text-[12px] font-mono-tnum font-semibold text-fg-1">{formatHuf(r.amount)}</p>
                      <p class="text-[10px] text-fg-3 font-mono-tnum">{r.count} alk.</p>
                    </div>
                  </li>
                {/each}
              </ul>
              <div class="px-4 py-3" style="border-top:1px solid var(--line)">
                <label class="flex items-center gap-2 mb-3 cursor-pointer">
                  <input type="checkbox" bind:checked={emailAdminToggle}
                    style="width:16px;height:16px;accent-color:var(--accent);" />
                  <span class="text-[12px] text-fg-2">📊 Admin összesítő küldése PDF-fel (saját email-edre)</span>
                </label>
                <button onclick={handleEmailSend}
                  class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors {emailSending || (selectedCount === 0 && !emailAdminToggle) ? 'opacity-60 cursor-not-allowed' : ''}"
                  style="background:var(--accent)"
                  disabled={emailSending || (selectedCount === 0 && !emailAdminToggle)}>
                  {emailSending ? 'Küldés…' : `📧 Küldés (${selectedCount} fő${emailAdminToggle ? ' + admin' : ''})`}
                </button>
                {#if emailResult}
                  <div class="mt-3 p-2.5 rounded-lg" style="background:{emailResult.failed.length === 0 ? 'rgba(16,185,129,0.10)' : 'rgba(245,158,11,0.10)'};color:{emailResult.failed.length === 0 ? '#047857' : '#92400e'}">
                    <p class="text-[12px] font-semibold">
                      ✅ {emailResult.sent} email kiküldve{emailResult.adminSent ? ' + admin összesítő' : ''}{emailResult.failed.length > 0 ? ` · ${emailResult.failed.length} sikertelen` : ''}
                    </p>
                    {#if emailResult.failed.length > 0}
                      <ul class="mt-1 space-y-0.5 text-[10.5px]" style="color:#7f1d1d">
                        {#each emailResult.failed as f}
                          <li>• {f.to}: {f.reason}</li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {/if}

        <!-- Bulk Section -->
        <div class="card p-4 fade-up" style="border-radius:18px">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-lg">🔄</span>
            <p class="text-[14px] font-semibold text-fg-1">Összes elszámolás generálása</p>
          </div>
          <p class="text-[11.5px] text-fg-3 mb-3 leading-relaxed">
            Lefuttatja az elszámolás kalkulációt az ÖSSZES Firestore-ban lévő számlára,
            és menti az eredményt. A profil oldalon ezután pontos éves összegek jelennek meg.
          </p>
          <label class="flex items-center gap-2 mb-3 cursor-pointer">
            <input type="checkbox" bind:checked={bulkForce} class="rounded" style="accent-color:var(--accent)">
            <span class="text-[12px] text-fg-2">🔁 Már meglévő elszámolások felülírása (újraszámolás)</span>
          </label>
          <button onclick={handleBulkGenerate}
            class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors {bulkRunning ? 'opacity-60 cursor-not-allowed' : ''}"
            style="background:var(--accent)"
            disabled={bulkRunning}>
            {bulkRunning ? 'Feldolgozás…' : '🚀 Összes elszámolás generálása'}
          </button>
          
          {#if bulkResult}
            {#if bulkResult.ok.length > 0}
              <div class="mt-3 p-2.5 rounded-lg" style="background:rgba(16,185,129,0.10)">
                <p class="text-[12px] font-semibold mb-1" style="color:#047857">✅ Sikeresen: {bulkResult.ok.length}/{bulkResult.total}</p>
                <ul class="text-[11px] space-y-0.5" style="color:#065f46">
                  {#each bulkResult.ok as o}
                    <li>• {o.label} — {o.people} fő, {formatHuf(o.total)}</li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if bulkResult.skipped.length > 0}
              <div class="mt-2 p-2.5 rounded-lg" style="background:rgba(14,165,233,0.10)">
                <p class="text-[12px] font-semibold mb-1" style="color:#0369a1">⏭️ Kihagyva: {bulkResult.skipped.length}</p>
                <ul class="text-[11px] space-y-0.5" style="color:#075985">
                  {#each bulkResult.skipped as s}
                    <li>• {s.label}</li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if bulkResult.failed.length > 0}
              <div class="mt-2 p-2.5 rounded-lg" style="background:rgba(239,68,68,0.10)">
                <p class="text-[12px] font-semibold mb-1" style="color:#b91c1c">⚠️ Sikertelen: {bulkResult.failed.length}</p>
                <ul class="text-[11px] space-y-0.5" style="color:#7f1d1d">
                  {#each bulkResult.failed as f}
                    <li>• {f.label}: {f.reason}</li>
                  {/each}
                </ul>
              </div>
            {/if}
          {/if}
        </div>
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
