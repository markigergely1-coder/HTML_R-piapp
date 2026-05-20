/**
 * 🛠️ Rendszer Diagnosztika — admin-only.
 *  - Firestore kapcsolat teszt
 *  - Auth állapot
 *  - App logok megtekintése (legutóbbi 100)
 */

import { renderHeader } from '../components/header';
import { getAuthState, onAuthChange, signIn } from '../lib/auth';
import { getAppLogs, pingFirestore, getAllMembers, getMemberByEmail, type AppLog, type Member } from '../lib/firestore';
import { sendTestPush, type TestPushResult } from '../lib/notifications';

interface DiagState {
  logs: AppLog[];
  testing: boolean;
  testResult: { ok: boolean; msg: string } | null;
  levelFilter: 'all' | 'INFO' | 'WARNING' | 'ERROR';
  emailTestRecipient: string;
  emailTesting: boolean;
  emailTestResult: { ok: boolean; msg: string } | null;
  // Push teszt
  members: Member[];
  pushTargetMemberId: string;
  pushTesting: boolean;
  pushTestResult: TestPushResult | { error: string } | null;
}

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderDiagnosticsPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const auth = getAuthState();
  if (auth.loading) return;
  if (!auth.user)        return showSignInGate(container);
  if (!auth.isAdmin)     return showNoPermissionGate(container, auth.user.email ?? '');

  let logs: AppLog[] = [];
  let members: Member[] = [];
  let selfMember: Member | null = null;
  try {
    [logs, members, selfMember] = await Promise.all([
      getAppLogs(100),
      getAllMembers(),
      auth.user?.email ? getMemberByEmail(auth.user.email) : Promise.resolve(null),
    ]);
  } catch (e) {
    console.warn('[diagnostics] lekérés hiba:', e);
  }
  const state: DiagState = {
    logs,
    testing: false,
    testResult: null,
    levelFilter: 'all',
    emailTestRecipient: getAuthState().user?.email ?? '',
    emailTesting: false,
    emailTestResult: null,
    members: members.filter((m) => m.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'hu')),
    pushTargetMemberId: selfMember?.id ?? '',
    pushTesting: false,
    pushTestResult: null,
  };
  rerender(container, state);

  const unsub = onAuthChange((s) => {
    if (!s.user || !s.isAdmin) { unsub(); renderDiagnosticsPage(container); }
  });
}

// ─────────────────────────────────────────────────────────────────
// Shell + gate-ek
// ─────────────────────────────────────────────────────────────────

function renderShell(body: string): string {
  return `
    <div class="device">
      ${renderHeader('diagnostics')}
      <main id="diag-body">${body}</main>
    </div>`;
}

function renderLoadingBody(): string {
  return `
    <div class="px-5 pt-5 space-y-3">
      <div class="grid grid-cols-2 gap-2.5">
        <div class="h-24 rounded-2xl animate-pulse" style="background:var(--line)"></div>
        <div class="h-24 rounded-2xl animate-pulse" style="background:var(--line)"></div>
      </div>
      <div class="h-12 rounded-2xl animate-pulse" style="background:var(--line)"></div>
      ${Array(5).fill(0).map(() => `<div class="h-12 rounded-2xl animate-pulse" style="background:var(--line)"></div>`).join('')}
    </div>`;
}

function showSignInGate(container: HTMLElement): void {
  container.innerHTML = renderShell(`
    <div class="px-5 pt-5 pb-12 fade-up">
      <div class="card relative p-6 text-center overflow-hidden" style="border-radius:24px">
        <div class="halo"></div>
        <div class="relative">
          <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
               style="background:color-mix(in oklab,var(--accent) 14%,transparent)">
            <span class="text-3xl">🔒</span>
          </div>
          <p class="text-[17px] font-semibold text-fg-1 mb-1">Csak admin oldal</p>
          <button id="gate-signin"
            class="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm"
            style="background:var(--accent)">
            Bejelentkezés
          </button>
        </div>
      </div>
    </div>`);
  container.querySelector<HTMLButtonElement>('#gate-signin')?.addEventListener('click', () => {
    signIn().catch((e) => console.warn(e));
  });
}

function showNoPermissionGate(container: HTMLElement, email: string): void {
  container.innerHTML = renderShell(`
    <div class="px-5 pt-5 pb-12 fade-up">
      <div class="card-soft p-6 text-center" style="border-radius:24px">
        <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4" style="background:color-mix(in oklab,#f59e0b 14%,transparent)">
          <span class="text-3xl">⛔</span>
        </div>
        <p class="text-[17px] font-semibold text-fg-1 mb-1">Nincs admin jogosultság</p>
        <p class="text-[13px] text-fg-3">${eh(email)}</p>
      </div>
    </div>`);
}

// ─────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────

function renderBody(state: DiagState): string {
  return `
    <div class="lg:grid lg:grid-cols-[340px_1fr] lg:gap-6 lg:p-6 lg:pt-5 lg:items-start">
      <!-- Kapcsolatok + Auth tesztek -->
      <aside class="lg:sticky lg:top-[110px] space-y-3 px-5 pt-5 lg:px-0 lg:pt-0">
        ${renderConnectionsCard(state)}
        ${renderAuthCard()}
        ${renderPushTestCard(state)}
        ${renderEmailTestCard(state)}
      </aside>

      <!-- Logok -->
      <section class="px-5 pt-3 pb-12 lg:px-0 lg:pt-0">
        ${renderLogsCard(state)}
      </section>
    </div>`;
}

function renderConnectionsCard(state: DiagState): string {
  const resultBlock = state.testResult
    ? `<div class="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold"
          style="background:${state.testResult.ok ? 'color-mix(in oklab,#10b981 14%,transparent)' : 'color-mix(in oklab,var(--accent) 14%,transparent)'};color:${state.testResult.ok ? '#047857' : 'var(--accent-ink)'}">
        ${state.testResult.ok ? '✓' : '✗'} ${eh(state.testResult.msg)}
      </div>`
    : '';

  return `
    <div class="card p-4 fade-up">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xl">🔥</span>
        <div>
          <p class="eyebrow text-[10px]">Adatbázis</p>
          <p class="text-[15px] font-semibold text-fg-1">Firestore</p>
        </div>
      </div>
      <p class="text-[12px] text-fg-3 mb-3">Test ír/olvas/töröl egy ideiglenes dokumentumot.</p>
      <button id="test-fs"
        class="w-full px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors ${state.testing ? 'opacity-60 cursor-not-allowed' : ''}"
        style="background:color-mix(in oklab,var(--accent) 14%,transparent);color:var(--accent-ink)"
        ${state.testing ? 'disabled' : ''}>
        ${state.testing ? 'Tesztelés…' : 'Kapcsolat teszt'}
      </button>
      ${resultBlock}
    </div>`;
}

function renderAuthCard(): string {
  const auth = getAuthState();
  const user = auth.user;
  return `
    <div class="card p-4 fade-up">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xl">🔐</span>
        <div>
          <p class="eyebrow text-[10px]">Hitelesítés</p>
          <p class="text-[15px] font-semibold text-fg-1">Auth állapot</p>
        </div>
      </div>
      <ul class="space-y-1.5 text-[12px]">
        <li class="flex justify-between"><span class="text-fg-3">Email:</span><span class="text-fg-1 font-mono-tnum">${eh(user?.email ?? '–')}</span></li>
        <li class="flex justify-between"><span class="text-fg-3">UID:</span><span class="text-fg-1 font-mono-tnum truncate ml-2 text-right">${eh((user?.uid ?? '–').slice(0, 12))}…</span></li>
        <li class="flex justify-between"><span class="text-fg-3">Provider:</span><span class="text-fg-1">${eh(user?.providerData[0]?.providerId ?? '–')}</span></li>
        <li class="flex justify-between"><span class="text-fg-3">Admin:</span>
          <span class="font-semibold ${auth.isAdmin ? 'text-[color:#047857]' : 'text-[color:var(--fg-2)]'}">${auth.isAdmin ? '✓ Igen' : '✗ Nem'}</span>
        </li>
      </ul>
    </div>`;
}

function renderPushTestCard(state: DiagState): string {
  const opts = state.members.map((m) =>
    `<option value="${eh(m.id)}" ${state.pushTargetMemberId === m.id ? 'selected' : ''}>${eh(m.name)}</option>`,
  ).join('');

  let resultBlock = '';
  if (state.pushTestResult) {
    if ('error' in state.pushTestResult) {
      resultBlock = `
        <div class="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold"
             style="background:color-mix(in oklab,var(--danger) 14%,transparent);color:var(--danger-ink)">
          ✗ ${eh(state.pushTestResult.error)}
        </div>`;
    } else {
      const r = state.pushTestResult;
      const overallOk = r.sent > 0 && r.failed === 0;
      const lineColor = overallOk
        ? 'background:color-mix(in oklab,#10b981 14%,transparent);color:#047857'
        : r.sent > 0
          ? 'background:color-mix(in oklab,#f59e0b 14%,transparent);color:#b45309'
          : 'background:color-mix(in oklab,var(--danger) 14%,transparent);color:var(--danger-ink)';
      const summary = r.devices.length === 0
        ? 'Nincs regisztrált eszköze ennek a tagnak.'
        : `Sikeres: ${r.sent} · Hiba: ${r.failed}`;
      const deviceList = r.devices.length === 0 ? '' : `
        <ul class="mt-2 space-y-1">
          ${r.devices.map((d) => `
            <li class="flex items-center justify-between text-[11px] font-mono-tnum">
              <span class="text-fg-2 truncate">${d.ok ? '✓' : '✗'} ${eh(d.device)}</span>
              ${d.reason ? `<span class="text-fg-3 ml-2">${eh(d.reason)}</span>` : ''}
            </li>
          `).join('')}
        </ul>`;
      resultBlock = `
        <div class="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold" style="${lineColor}">
          ${overallOk ? '✓' : r.sent > 0 ? '⚠' : '✗'} ${eh(summary)}
        </div>
        ${deviceList}`;
    }
  }

  return `
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
        <select id="push-test-member" class="select-native w-full rounded-[12px] border px-3 py-2 text-[13px] font-medium text-fg-1 focus:outline-none"
          style="border-color:var(--line-strong); background:var(--bg-card)">
          ${opts || '<option value="">Nincs tag</option>'}
        </select>
      </label>
      <button id="push-test-btn"
        class="w-full px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors ${state.pushTesting ? 'opacity-60 cursor-not-allowed' : ''}"
        style="background:var(--accent);color:white"
        ${state.pushTesting || !state.pushTargetMemberId ? 'disabled' : ''}>
        ${state.pushTesting ? 'Küldés…' : 'Push küldése'}
      </button>
      ${resultBlock}
    </div>`;
}

function renderEmailTestCard(state: DiagState): string {
  const resultBlock = state.emailTestResult
    ? `<div class="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold"
          style="background:${state.emailTestResult.ok ? 'color-mix(in oklab,#10b981 14%,transparent)' : 'color-mix(in oklab,var(--accent) 14%,transparent)'};color:${state.emailTestResult.ok ? '#047857' : 'var(--accent-ink)'}">
        ${state.emailTestResult.ok ? '✓' : '✗'} ${eh(state.emailTestResult.msg)}
      </div>`
    : '';
  return `
    <div class="card p-4 fade-up">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xl">📧</span>
        <div>
          <p class="eyebrow text-[10px]">Email</p>
          <p class="text-[15px] font-semibold text-fg-1">Teszt email</p>
        </div>
      </div>
      <p class="text-[12px] text-fg-3 mb-3">Elküld egy teszt elszámolás emailt a megadott címre.</p>
      <input id="email-test-recipient" type="email"
        class="w-full px-3 py-2 rounded-xl border text-[13px] text-fg-1 focus:outline-none mb-2"
        style="background:var(--bg-elev);border-color:var(--line-strong)"
        value="${eh(state.emailTestRecipient)}"
        placeholder="email@example.com" />
      <button id="email-test-btn"
        class="w-full px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors ${state.emailTesting ? 'opacity-60 cursor-not-allowed' : ''}"
        style="background:color-mix(in oklab,#0ea5e9 14%,transparent);color:#0369a1"
        ${state.emailTesting ? 'disabled' : ''}>
        ${state.emailTesting ? 'Küldés…' : 'Teszt küldése'}
      </button>
      ${resultBlock}
    </div>`;
}

function renderLogsCard(state: DiagState): string {
  const filtered = state.levelFilter === 'all'
    ? state.logs
    : state.logs.filter((l) => l.level === state.levelFilter);

  const levelOptions: { v: DiagState['levelFilter']; label: string }[] = [
    { v: 'all',     label: 'Mind' },
    { v: 'INFO',    label: 'INFO' },
    { v: 'WARNING', label: 'WARN' },
    { v: 'ERROR',   label: 'ERROR' },
  ];

  const pills = levelOptions.map((l) => {
    const active = state.levelFilter === l.v;
    return `<button data-level="${l.v}" class="diag-level-btn px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
      style="background:${active ? 'color-mix(in oklab,var(--accent) 14%,transparent)' : 'var(--bg-elev)'};color:${active ? 'var(--accent-ink)' : 'var(--fg-2)'}">${l.label}</button>`;
  }).join('');

  return `
    <div class="card overflow-hidden fade-up" style="border-radius:22px">
      <div class="px-4 py-3 flex items-center justify-between gap-2" style="border-bottom:1px solid var(--line)">
        <div class="flex items-center gap-2">
          <span class="text-base">📜</span>
          <span class="eyebrow">Logok</span>
        </div>
        <div class="flex items-center gap-1">${pills}</div>
      </div>
      ${filtered.length === 0
        ? `<div class="p-8 text-center text-[13px] text-fg-3">Nincs naplóbejegyzés.</div>`
        : `<ul style="max-height:60vh;overflow-y:auto">${filtered.map((l, i) => renderLogRow(l, i)).join('')}</ul>`}
    </div>`;
}

function renderLogRow(log: AppLog, idx: number): string {
  const lvl = log.level || 'INFO';
  const tones: Record<string, { bg: string; text: string }> = {
    INFO:    { bg: 'rgba(14,165,233,0.10)', text: '#0369a1' },
    WARNING: { bg: 'rgba(245,158,11,0.10)', text: '#b45309' },
    ERROR:   { bg: 'rgba(239,68,68,0.10)',  text: '#b91c1c' },
  };
  const t = tones[lvl] ?? tones.INFO;
  const detail = typeof log.details === 'object' && log.details
    ? `<p class="text-[10.5px] mt-1 font-mono-tnum truncate" style="color:var(--fg-3)">${eh(JSON.stringify(log.details))}</p>`
    : log.details
      ? `<p class="text-[10.5px] mt-1 font-mono-tnum truncate" style="color:var(--fg-3)">${eh(String(log.details))}</p>`
      : '';
  return `
    <li class="px-4 py-2.5 flex gap-3" style="${idx === 0 ? '' : 'border-top:1px solid var(--line);'}">
      <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 self-start mt-0.5"
            style="background:${t.bg};color:${t.text}">${eh(lvl)}</span>
      <div class="flex-1 min-w-0">
        <p class="text-[12.5px] font-medium text-fg-1 truncate">${eh(log.message)}</p>
        <p class="text-[10.5px] font-mono-tnum mt-0.5" style="color:var(--fg-3)">
          ${eh(log.created_at_local ?? '–')}${log.user_name ? ` · ${eh(log.user_name)}` : ''}${log.ip_address ? ` · ${eh(log.ip_address)}` : ''}
        </p>
        ${detail}
      </div>
    </li>`;
}

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────

function rerender(container: HTMLElement, state: DiagState) {
  const body = container.querySelector<HTMLElement>('#diag-body')!;
  body.innerHTML = renderBody(state);
  attachHandlers(container, state);
}

function attachHandlers(container: HTMLElement, state: DiagState) {
  container.querySelector<HTMLButtonElement>('#test-fs')?.addEventListener('click', async () => {
    if (state.testing) return;
    state.testing = true;
    state.testResult = null;
    rerender(container, state);
    try {
      const ok = await pingFirestore();
      state.testResult = { ok, msg: ok ? 'Firestore OK (írás + olvasás + törlés).' : 'A teszt sikertelen.' };
    } catch (e) {
      state.testResult = { ok: false, msg: String(e) };
    } finally {
      state.testing = false;
      rerender(container, state);
    }
  });

  container.querySelectorAll<HTMLButtonElement>('.diag-level-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lvl = btn.dataset.level as DiagState['levelFilter'];
      if (lvl && lvl !== state.levelFilter) {
        state.levelFilter = lvl;
        rerender(container, state);
      }
    });
  });

  container.querySelector<HTMLInputElement>('#email-test-recipient')?.addEventListener('input', (e) => {
    state.emailTestRecipient = (e.target as HTMLInputElement).value;
  });

  // Push teszt: member dropdown change
  container.querySelector<HTMLSelectElement>('#push-test-member')?.addEventListener('change', (e) => {
    state.pushTargetMemberId = (e.target as HTMLSelectElement).value;
    // Csak a result-blokkot mossuk le, dropdown értéke marad
    state.pushTestResult = null;
    rerender(container, state);
  });
  // Push teszt: küldés
  container.querySelector<HTMLButtonElement>('#push-test-btn')?.addEventListener('click', async () => {
    if (state.pushTesting || !state.pushTargetMemberId) return;
    state.pushTesting = true;
    state.pushTestResult = null;
    rerender(container, state);
    try {
      const result = await sendTestPush(state.pushTargetMemberId);
      state.pushTestResult = result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.pushTestResult = { error: msg };
    } finally {
      state.pushTesting = false;
      rerender(container, state);
    }
  });

  container.querySelector<HTMLButtonElement>('#email-test-btn')?.addEventListener('click', async () => {
    if (state.emailTesting) return;
    const to = state.emailTestRecipient.trim();
    if (!to) return;
    state.emailTesting = true;
    state.emailTestResult = null;
    rerender(container, state);
    try {
      const { sendBillingEmails } = await import('../lib/email');
      const now = new Date();
      const result = await sendBillingEmails({
        year: now.getFullYear(),
        monthName: 'Teszt hónap',
        personal: [{ to, name: 'Teszt felhasználó', count: 3, amount: 6900 }],
      });
      const ok = result.personalSent > 0;
      state.emailTestResult = { ok, msg: ok ? `Email elküldve: ${to}` : `Küldés sikertelen: ${result.personalFailed[0]?.reason ?? 'ismeretlen hiba'}` };
    } catch (e) {
      state.emailTestResult = { ok: false, msg: String(e) };
    } finally {
      state.emailTesting = false;
      rerender(container, state);
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function eh(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
