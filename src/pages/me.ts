/**
 * 👤 Saját oldal — bejelentkezett user-eknek.
 *
 * Tartalom:
 *   - Hero kártya (név + email + admin badge)
 *   - Következő alkalom: Jövök / Lemondom + vendéghozzáadás
 *   - Múltbeli alkalom (csak ha 21:00 után): Voltam ott + vendég
 *   - Értesítés beállítások (Phase B-ig greyed out)
 *   - Profil: név átírás
 *
 * Avatar-kattintásból érhető el a header-ből (#/me).
 */

import { renderHeader } from '../components/header';
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
import { logEvent } from '../lib/logger';

interface MeState {
  member: Member;
  myAttendance: Set<string>;        // datok ahol már Yes vagyok
  myDeclined: Set<string>;          // datok ahol explicit No-t jeleztem
  nextDate: string;                 // a következő jövőbeli kedd
  pastDate: string | null;          // a legutóbbi lezárult kedd (kedd 21:00 után), különben null
  guestMode: boolean;               // a következő alkalomhoz nyit a vendég-form
  guestCount: number;               // hány vendég
  guestNames: string[];             // a vendég nevek (hossza = guestCount)
  pastGuestMode: boolean;           // a múltbeli kártyán nyit a vendég-form
  pastGuestCount: number;
  pastGuestNames: string[];
  nameEdit: string;                 // editálás közben
  prefs: MemberNotificationPrefs;
  saving: boolean;
  toast: { kind: 'success' | 'error' | 'info'; msg: string } | null;
  // Push notification state
  pushSupported: boolean;
  pushPermission: NotificationPermission;
  subscriptions: PushSubscription[];
  pushSubscribing: boolean;          // épp engedélykérés / token-szerzés folyik
  showPushOptIn: boolean;            // soft-ask kártya nyitva
}

let toastTimer: number | null = null;

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderMePage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const auth = getAuthState();
  if (auth.loading) return;
  if (!auth.user) return showSignInGate(container);

  // Member rekord (auto-create az auth.ts-ben fut, ide már létrejöttként érkezik)
  const email = auth.user.email ?? '';
  const member = await getMemberByEmail(email);
  if (!member) {
    // Ritka edge case: auth.ts még nem fejezte be az ensureMemberExists-et
    // Néhány másodperc múlva próbáld újra
    container.innerHTML = renderShell(`
      <div class="px-5 pt-12 text-center fade-up">
        <div class="text-3xl mb-3">⏳</div>
        <p class="text-[15px] text-fg-1">Profilod készítése folyamatban…</p>
        <p class="text-[12px] text-fg-3 mt-2">Pár másodperc és frissíthetsz.</p>
        <button onclick="location.reload()" class="mt-4 px-4 py-2 rounded-full text-white text-[13px] font-semibold" style="background:var(--accent)">
          Frissítés
        </button>
      </div>`);
    return;
  }

  // Saját attendance — hogy lássuk hol van már Yes vagy No
  const records = await getAttendanceForPlayer(member.name);
  const myAttendance = new Set(records.filter((r) => r.status === 'Yes' && r.event_date).map((r) => r.event_date));
  const myDeclined = new Set(records.filter((r) => r.status === 'No' && r.event_date).map((r) => r.event_date));

  // Jövőbeli kedd: a következő hét keddje (vagy ma ha kedd 21:00 előtt)
  const futureCandidates = generateTuesdayDates(0, 2);
  const today = todayInHungary();
  const isTuesday = weekdayOf(today) === 2;
  const hour = currentHourInHungary();
  // Ha ma kedd ÉS 21:00 előtt — még jövőbeli (ma este lesz az edzés)
  const nextDate = isTuesday && hour < 21
    ? today
    : upcomingTuesday(futureCandidates);

  // Múltbeli kedd: a legutóbbi LEZÁRULT kedd (csak 21:00 után jelenik meg)
  // Ha ma kedd és >= 21:00 → ma a "lezárult". Egyébként → előző kedd.
  const pastDates = pastTuesdaysForDisplay(1);
  const lastPast = pastDates[pastDates.length - 1] ?? null;
  // A múltbeli kártya csak akkor jelenik meg, ha ténylegesen ELMÚLT alkalom (nem ugyanaz mint nextDate)
  const pastDate = lastPast && lastPast !== nextDate ? lastPast : null;

  // Push notification állapot (párhuzamos lekérés)
  const [pushSupported, subscriptions] = await Promise.all([
    isPushSupported(),
    getMySubscriptions(member.id).catch(() => []),
  ]);

  const state: MeState = {
    member,
    myAttendance,
    myDeclined,
    nextDate,
    pastDate,
    guestMode: false,
    guestCount: 1,
    guestNames: [''],
    pastGuestMode: false,
    pastGuestCount: 1,
    pastGuestNames: [''],
    nameEdit: member.name,
    prefs: member.prefs?.notifications ?? { ...DEFAULT_NOTIFICATION_PREFS },
    saving: false,
    toast: null,
    pushSupported,
    pushPermission: currentPermission(),
    subscriptions,
    pushSubscribing: false,
    showPushOptIn: false,
  };

  // Deep-link param: ?action=add-guest (Phase D-ben jön push-ból)
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  if (params.get('action') === 'add-guest') {
    state.guestMode = true;
    state.guestCount = 1;
    state.guestNames = [''];
  }

  rerender(container, state);
}

// ─────────────────────────────────────────────────────────────────
// Shell + gate
// ─────────────────────────────────────────────────────────────────

function renderShell(body: string): string {
  return `
    <div class="device">
      ${renderHeader('me')}
      <main id="me-body">${body}</main>
    </div>`;
}

function renderLoadingBody(): string {
  return `
    <div class="px-5 pt-5 space-y-3">
      <div class="h-32 rounded-[28px] animate-pulse" style="background:var(--line)"></div>
      <div class="h-40 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
      <div class="h-40 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
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
            <span class="text-3xl">👤</span>
          </div>
          <p class="text-[17px] font-semibold text-fg-1 mb-1">Saját oldal</p>
          <p class="text-[13px] text-fg-3 mb-4">Jelentkezz be a saját regisztrációhoz és értesítésekhez.</p>
          <button id="gate-signin"
            class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm"
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

// ─────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────

function renderBody(state: MeState): string {
  return `
    <div class="px-5 pt-5 pb-12 space-y-4">
      ${renderHero(state)}
      ${renderNextEventCard(state)}
      ${state.pastDate ? renderPastEventCard(state) : ''}
      ${renderNotificationCard(state)}
      ${renderProfileCard(state)}
      ${state.toast ? renderToast(state.toast) : ''}
    </div>`;
}

// ─── Hero ───
function renderHero(state: MeState): string {
  const auth = getAuthState();
  const isAdmin = auth.isAdmin;
  const hue = avatarHue(state.member.name);
  const initials = getInitials(state.member.name);

  return `
    <section class="fade-up">
      <div class="card relative p-5 overflow-hidden" style="border-radius:24px">
        <div class="absolute inset-0 opacity-90"
             style="background:radial-gradient(120% 80% at 90% 0%,color-mix(in oklab,var(--accent) 14%,transparent) 0%,transparent 60%)"></div>
        <div class="relative flex items-center gap-4">
          <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[20px]"
               style="width:64px;height:64px;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
            ${eh(initials)}
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-[20px] font-semibold tracking-tight text-fg-1 truncate">${eh(state.member.name)}</p>
            <p class="text-[12px] text-fg-3 font-mono-tnum truncate">${eh(state.member.email)}</p>
            ${isAdmin ? `<span class="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:color-mix(in oklab,#10b981 14%,transparent);color:#047857">ADMIN</span>` : ''}
          </div>
        </div>
      </div>
    </section>`;
}

// ─── Következő alkalom ───
function renderNextEventCard(state: MeState): string {
  const isGoing = state.myAttendance.has(state.nextDate);
  const isDeclined = state.myDeclined.has(state.nextDate);
  const dateLong = formatDateHuLong(state.nextDate);
  const day = dayOf(state.nextDate);
  const month = formatMonthShortHu(state.nextDate);

  // Vendég-form (ha nyitva van)
  const guestForm = state.guestMode ? renderGuestForm(state, 'future') : '';

  // Státusz szöveg
  const statusText = isGoing
    ? '✓ Már jelentkeztél'
    : isDeclined
      ? '✗ Jelezted, hogy nem tudsz jönni'
      : 'Még nem jelentkeztél';

  return `
    <section class="fade-up" style="animation-delay:80ms">
      <div class="flex items-end justify-between mb-3">
        <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Következő alkalom</h2>
        <span class="eyebrow">${state.nextDate}</span>
      </div>
      <div class="card p-5" style="border-radius:22px">
        <div class="flex items-center gap-4 mb-4">
          <div class="flex flex-col items-center flex-shrink-0" style="min-width:44px">
            <span class="text-[10px] font-semibold uppercase tracking-widest" style="color:var(--accent-ink)">${month}</span>
            <span class="font-mono-tnum font-bold text-[28px] leading-tight text-fg-1">${day}</span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-[14px] font-semibold text-fg-1 capitalize">${eh(dateLong.split(',')[1]?.trim() ?? '')}</p>
            <p class="text-[11px] mt-0.5" style="color:${isDeclined ? 'var(--danger-ink)' : 'var(--fg-3)'}">${statusText}</p>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button id="me-register-next" type="button" ${state.saving ? 'disabled' : ''}
            class="px-4 py-3 rounded-full text-[14px] font-semibold transition-colors ${state.saving ? 'opacity-60 cursor-not-allowed' : ''}"
            style="${isGoing
              ? 'background:#047857;color:white;border:1.5px solid #047857'
              : 'background:color-mix(in oklab,#10b981 12%,transparent);color:#047857;border:1.5px solid color-mix(in oklab,#10b981 30%,transparent)'}">
            ${state.saving ? '…' : '✓ Jövök'}
          </button>
          <button id="me-cancel-next" type="button" ${state.saving ? 'disabled' : ''}
            class="px-4 py-3 rounded-full text-[14px] font-semibold transition-colors ${state.saving ? 'opacity-60 cursor-not-allowed' : ''}"
            style="${isDeclined
              ? 'background:var(--danger);color:white;border:1.5px solid var(--danger)'
              : 'background:color-mix(in oklab,var(--danger) 12%,transparent);color:var(--danger-ink);border:1.5px solid color-mix(in oklab,var(--danger) 30%,transparent)'}">
            ${state.saving ? '…' : '✗ Nem tudok'}
          </button>
        </div>

        <div class="mt-2">
          <button id="me-toggle-guest" type="button" ${state.saving ? 'disabled' : ''}
            class="w-full px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors"
            style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)">
            ${state.guestMode ? '× Vendéget mégse hozok' : '🙋 Vendéggel jövök'}
          </button>
        </div>

        ${guestForm}
      </div>
    </section>`;
}

// ─── Múltbeli alkalom ───
function renderPastEventCard(state: MeState): string {
  if (!state.pastDate) return '';
  const wasThere = state.myAttendance.has(state.pastDate);
  const wasDeclined = state.myDeclined.has(state.pastDate);
  const dateLong = formatDateHuLong(state.pastDate);
  const day = dayOf(state.pastDate);
  const month = formatMonthShortHu(state.pastDate);

  const guestForm = state.pastGuestMode ? renderGuestForm(state, 'past') : '';

  const statusText = wasThere
    ? '✓ Voltál ott'
    : wasDeclined
      ? '✗ Jelezted, hogy nem voltál ott'
      : 'Még nem jelezted, ott voltál-e';

  return `
    <section class="fade-up" style="animation-delay:120ms">
      <div class="flex items-end justify-between mb-3">
        <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Múltbeli alkalom</h2>
        <span class="eyebrow">${state.pastDate}</span>
      </div>
      <div class="card p-5" style="border-radius:22px">
        <div class="flex items-center gap-4 mb-4">
          <div class="flex flex-col items-center flex-shrink-0" style="min-width:44px">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-fg-3">${month}</span>
            <span class="font-mono-tnum font-bold text-[28px] leading-tight text-fg-2">${day}</span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-[14px] font-semibold text-fg-1 capitalize">${eh(dateLong.split(',')[1]?.trim() ?? '')}</p>
            <p class="text-[11px] mt-0.5" style="color:${wasDeclined ? 'var(--danger-ink)' : 'var(--fg-3)'}">${statusText}</p>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button id="me-register-past" type="button" ${state.saving ? 'disabled' : ''}
            class="px-4 py-3 rounded-full text-[14px] font-semibold transition-colors ${state.saving ? 'opacity-60 cursor-not-allowed' : ''}"
            style="${wasThere
              ? 'background:#047857;color:white;border:1.5px solid #047857'
              : 'background:color-mix(in oklab,#10b981 12%,transparent);color:#047857;border:1.5px solid color-mix(in oklab,#10b981 30%,transparent)'}">
            ${state.saving ? '…' : '✓ Ott voltam'}
          </button>
          <button id="me-decline-past" type="button" ${state.saving ? 'disabled' : ''}
            class="px-4 py-3 rounded-full text-[14px] font-semibold transition-colors ${state.saving ? 'opacity-60 cursor-not-allowed' : ''}"
            style="${wasDeclined
              ? 'background:var(--danger);color:white;border:1.5px solid var(--danger)'
              : 'background:color-mix(in oklab,var(--danger) 12%,transparent);color:var(--danger-ink);border:1.5px solid color-mix(in oklab,var(--danger) 30%,transparent)'}">
            ${state.saving ? '…' : '✗ Nem voltam'}
          </button>
        </div>

        <div class="mt-2">
          <button id="me-toggle-past-guest" type="button" ${state.saving ? 'disabled' : ''}
            class="w-full px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors"
            style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)">
            ${state.pastGuestMode ? '× Vendéget mégse adok hozzá' : '🙋 Vendéget hoztam'}
          </button>
        </div>

        ${guestForm}
      </div>
    </section>`;
}

// ─── Vendég-form (közös) ───
function renderGuestForm(state: MeState, mode: 'future' | 'past'): string {
  const count = mode === 'future' ? state.guestCount : state.pastGuestCount;
  const names = mode === 'future' ? state.guestNames : state.pastGuestNames;
  const prefix = mode === 'future' ? 'me-g' : 'me-pg';
  const MAX = 5;

  const nameInputs = Array.from({ length: count }, (_, i) => `
    <input type="text" data-guest-idx="${i}" id="${prefix}-name-${i}"
      class="${prefix}-name w-full rounded-[12px] border px-3 py-2 text-[13px] text-fg-1 placeholder-fg-3 focus:outline-none"
      style="border-color:var(--line-strong); background:var(--bg-card)"
      value="${ea(names[i] ?? '')}" placeholder="${i + 1}. vendég neve" />
  `).join('');

  return `
    <div class="mt-4 pt-4 border-t hairline space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-[12px] font-semibold text-fg-1">Vendégek</span>
        <div class="flex items-center gap-2">
          <button id="${prefix}-dec" type="button" class="w-7 h-7 rounded-full flex items-center justify-center text-[16px] font-bold transition-colors"
            style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)" ${count <= 1 ? 'disabled' : ''}>−</button>
          <span class="font-mono-tnum text-[14px] font-semibold text-fg-1 w-6 text-center">${count}</span>
          <button id="${prefix}-inc" type="button" class="w-7 h-7 rounded-full flex items-center justify-center text-[16px] font-bold transition-colors"
            style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)" ${count >= MAX ? 'disabled' : ''}>+</button>
        </div>
      </div>
      <div class="space-y-2">${nameInputs}</div>
      <button id="${prefix}-save" type="button" ${state.saving ? 'disabled' : ''}
        class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold transition-colors ${state.saving ? 'opacity-60 cursor-not-allowed' : ''}"
        style="background:var(--accent)">
        ${state.saving ? 'Mentés…' : `Hozzáadás (${count} vendég)`}
      </button>
    </div>`;
}

// ─── Notification settings ───
function renderNotificationCard(state: MeState): string {
  const p = state.prefs;
  const enabled = p.enabled && state.subscriptions.length > 0;

  // Ha a böngésző nem támogatja, mutatunk egy magyarázó kártyát.
  if (!state.pushSupported) {
    return `
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
      </section>`;
  }

  // Soft-ask kártya (master toggle ON-ra kattintva mielőtt permission promptot mutatunk)
  if (state.showPushOptIn) {
    return `
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
            <button id="me-push-allow" type="button" ${state.pushSubscribing ? 'disabled' : ''}
              class="w-full px-4 py-2.5 rounded-full text-white text-[14px] font-semibold transition-colors ${state.pushSubscribing ? 'opacity-60 cursor-not-allowed' : ''}"
              style="background:var(--accent)">
              ${state.pushSubscribing ? 'Engedélykérés…' : 'Igen, engedélyezem'}
            </button>
            <button id="me-push-deny" type="button" ${state.pushSubscribing ? 'disabled' : ''}
              class="w-full px-4 py-2.5 rounded-full text-[14px] font-semibold transition-colors"
              style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)">
              Most nem
            </button>
          </div>
        </div>
      </section>`;
  }

  // Permission denied — magyarázó kártya
  const deniedNote = state.pushPermission === 'denied' && !enabled
    ? `<div class="px-3 py-2 rounded-lg text-[11.5px]" style="background:color-mix(in oklab,var(--danger) 12%,transparent);color:var(--danger-ink)">
         ⚠️ A böngésződ letiltotta az értesítéseket. Engedélyezni a böngésző beállításaiban tudod (címsor melletti zár ikon → Notifications → Allow).
       </div>`
    : '';

  // Event-type toggle helper
  const eventToggle = (key: keyof MemberNotificationPrefs['events'], label: string, sub?: string) => `
    <label class="flex items-center justify-between gap-3 py-2 cursor-pointer ${!enabled ? 'opacity-55' : ''}">
      <div>
        <span class="text-[13px] text-fg-1">${label}</span>
        ${sub ? `<p class="text-[10.5px] text-fg-3 mt-0.5">${sub}</p>` : ''}
      </div>
      <input type="checkbox" data-pref-event="${key}" ${p.events[key] ? 'checked' : ''} ${!enabled ? 'disabled' : ''}
        class="w-4 h-4 rounded flex-shrink-0" style="accent-color:var(--accent)" />
    </label>`;

  // Eszköz lista
  const deviceList = state.subscriptions.length > 0 ? `
    <div class="pt-3 border-t hairline">
      <p class="eyebrow text-[10px] mb-2">Eszközök (${state.subscriptions.length})</p>
      <ul class="space-y-1.5">
        ${state.subscriptions.map((s) => `
          <li class="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-lg" style="background:var(--bg-elev)">
            <div class="flex-1 min-w-0">
              <p class="text-[12px] font-semibold text-fg-1 truncate">${eh(s.device)}</p>
              <p class="text-[10px] text-fg-3 font-mono-tnum truncate">${eh(s.token.slice(0, 16))}…</p>
            </div>
            <label class="flex items-center gap-2 cursor-pointer flex-shrink-0">
              <input type="checkbox" data-sub-toggle="${s.id}" ${s.enabled ? 'checked' : ''}
                class="w-4 h-4 rounded" style="accent-color:var(--accent)" />
            </label>
            <button data-sub-delete="${s.id}" type="button" class="p-1 rounded-md transition-colors hover:bg-[color:var(--line)]"
              title="Eszköz eltávolítása" style="color:var(--fg-3)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/>
              </svg>
            </button>
          </li>
        `).join('')}
      </ul>
    </div>` : '';

  return `
    <section class="fade-up" style="animation-delay:160ms">
      <div class="flex items-end justify-between mb-3">
        <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Értesítések</h2>
        ${enabled
          ? `<span class="eyebrow" style="color:#047857;background:color-mix(in oklab,#10b981 14%,transparent);padding:2px 8px;border-radius:999px">Aktív</span>`
          : ''
        }
      </div>
      <div class="card p-4 space-y-3" style="border-radius:22px">
        <label class="flex items-center justify-between gap-3 cursor-pointer">
          <div>
            <p class="text-[14px] font-semibold text-fg-1">Push értesítések</p>
            <p class="text-[11px] text-fg-3 mt-0.5">${enabled ? `Aktív ezen az eszközön` : 'Telefonra / asztali appra érkezik értesítés'}</p>
          </div>
          <input type="checkbox" id="me-pref-enabled" ${enabled ? 'checked' : ''}
            ${state.pushSubscribing ? 'disabled' : ''}
            class="w-5 h-5 rounded" style="accent-color:var(--accent)" />
        </label>
        ${deniedNote}

        ${deviceList}

        <div class="pt-3 border-t hairline ${!enabled ? 'opacity-55' : ''}">
          <p class="eyebrow text-[10px] mb-2">Mely eseményről értesüljek?</p>
          ${eventToggle('tuesdayReminder', 'Kedd reggeli emlékeztető', 'Ha még nem jelentkeztél')}
          ${eventToggle('cancellation', 'Edzés lemondva', 'Azonnali értesítés')}
          ${eventToggle('fullTeam', 'Megvan a 8 fő', 'Amikor összejön a csapat')}
          ${eventToggle('newRegistration', 'Új jelentkező', 'Valaki most regisztrált')}
          ${eventToggle('payment', 'Befizetési emlékeztető', 'Ha még tartozol')}
        </div>

        <div class="pt-3 border-t hairline space-y-2 ${!enabled ? 'opacity-55' : ''}">
          <label class="flex items-center justify-between">
            <span class="text-[13px] text-fg-1">Csendes órák</span>
            <input type="checkbox" id="me-pref-quiet-enabled" ${p.quietHours.enabled ? 'checked' : ''} ${!enabled ? 'disabled' : ''}
              class="w-4 h-4 rounded" style="accent-color:var(--accent)" />
          </label>
          ${p.quietHours.enabled ? `
            <div class="flex items-center justify-between gap-2 pl-4">
              <input id="me-pref-quiet-from" type="time" value="${p.quietHours.from}" ${!enabled ? 'disabled' : ''}
                class="rounded-[10px] border px-2 py-1 text-[12px] font-mono-tnum text-fg-1 flex-1"
                style="border-color:var(--line-strong); background:var(--bg-card)" />
              <span class="text-[11px] text-fg-3">—</span>
              <input id="me-pref-quiet-to" type="time" value="${p.quietHours.to}" ${!enabled ? 'disabled' : ''}
                class="rounded-[10px] border px-2 py-1 text-[12px] font-mono-tnum text-fg-1 flex-1"
                style="border-color:var(--line-strong); background:var(--bg-card)" />
            </div>
          ` : ''}
        </div>

        <p class="text-[10.5px] text-fg-3 text-center pt-1">
          Csapatszintű emlékeztető: <b>kedd 09:00</b> (Magyarország).
          Egyénileg csak ki/be kapcsolható.
        </p>
      </div>
    </section>`;
}

// ─── Profil (név átírás) ───
function renderProfileCard(state: MeState): string {
  const changed = state.nameEdit.trim() !== state.member.name && state.nameEdit.trim().length > 0;
  return `
    <section class="fade-up" style="animation-delay:200ms">
      <div class="flex items-end justify-between mb-3">
        <h2 class="text-[20px] font-semibold tracking-tight text-fg-1">Profil</h2>
      </div>
      <div class="card p-4" style="border-radius:22px">
        <label class="block">
          <span class="text-[10px] font-semibold text-fg-3 block mb-1">Megjelenítendő név</span>
          <input id="me-name-input" type="text" value="${ea(state.nameEdit)}"
            class="w-full rounded-[12px] border px-3 py-2.5 text-[14px] text-fg-1 focus:outline-none"
            style="border-color:var(--line-strong); background:var(--bg-card)" />
        </label>
        ${changed
          ? `<button id="me-name-save" type="button" ${state.saving ? 'disabled' : ''}
              class="mt-3 w-full px-4 py-2 rounded-full text-white text-[13px] font-semibold transition-colors ${state.saving ? 'opacity-60 cursor-not-allowed' : ''}"
              style="background:var(--accent)">
              ${state.saving ? 'Mentés…' : 'Név mentése'}
            </button>`
          : ''
        }
      </div>
    </section>`;
}

// ─── Toast ───
function renderToast(toast: NonNullable<MeState['toast']>): string {
  const palette = toast.kind === 'success'
    ? 'background:color-mix(in oklab,#10b981 14%,var(--bg-card));border:1px solid color-mix(in oklab,#10b981 30%,var(--line));color:#047857'
    : toast.kind === 'error'
      ? 'background:color-mix(in oklab,var(--danger) 14%,var(--bg-card));border:1px solid color-mix(in oklab,var(--danger) 30%,var(--line));color:var(--danger-ink)'
      : 'background:color-mix(in oklab,#0ea5e9 14%,var(--bg-card));border:1px solid color-mix(in oklab,#0ea5e9 30%,var(--line));color:#0369a1';
  return `
    <div id="toast" class="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full shadow-lg text-[12.5px] font-semibold fade-up"
      style="bottom:24px;${palette}">${eh(toast.msg)}</div>`;
}

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────

function rerender(container: HTMLElement, state: MeState) {
  const body = container.querySelector<HTMLElement>('#me-body')!;
  body.innerHTML = renderBody(state);
  attachHandlers(container, state);
  if (state.toast) {
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      state.toast = null;
      rerender(container, state);
    }, 2500);
  }
}

function attachHandlers(container: HTMLElement, state: MeState) {
  // Jövőbeli: Jövök / Lemondom
  container.querySelector<HTMLButtonElement>('#me-register-next')?.addEventListener('click', () => {
    void handleRegisterNext(container, state, 'Yes');
  });
  container.querySelector<HTMLButtonElement>('#me-cancel-next')?.addEventListener('click', () => {
    void handleRegisterNext(container, state, 'No');
  });

  // Vendég toggle
  container.querySelector<HTMLButtonElement>('#me-toggle-guest')?.addEventListener('click', () => {
    state.guestMode = !state.guestMode;
    if (state.guestMode && state.guestNames.length === 0) {
      state.guestCount = 1;
      state.guestNames = [''];
    }
    rerender(container, state);
  });

  // Vendég stepper + nevek (jövőbeli)
  container.querySelector<HTMLButtonElement>('#me-g-dec')?.addEventListener('click', () => {
    if (state.guestCount <= 1) return;
    state.guestCount--;
    state.guestNames.length = state.guestCount;
    rerender(container, state);
  });
  container.querySelector<HTMLButtonElement>('#me-g-inc')?.addEventListener('click', () => {
    if (state.guestCount >= 5) return;
    state.guestCount++;
    state.guestNames.push('');
    rerender(container, state);
  });
  container.querySelectorAll<HTMLInputElement>('.me-g-name').forEach((inp) => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.dataset.guestIdx);
      state.guestNames[idx] = inp.value;
    });
  });
  container.querySelector<HTMLButtonElement>('#me-g-save')?.addEventListener('click', () => {
    void handleGuestSave(container, state, 'future');
  });

  // Múltbeli: Voltam ott
  container.querySelector<HTMLButtonElement>('#me-register-past')?.addEventListener('click', () => {
    void handleRegisterPast(container, state);
  });
  container.querySelector<HTMLButtonElement>('#me-toggle-past-guest')?.addEventListener('click', () => {
    state.pastGuestMode = !state.pastGuestMode;
    if (state.pastGuestMode && state.pastGuestNames.length === 0) {
      state.pastGuestCount = 1;
      state.pastGuestNames = [''];
    }
    rerender(container, state);
  });
  // Múltbeli vendég stepper
  container.querySelector<HTMLButtonElement>('#me-pg-dec')?.addEventListener('click', () => {
    if (state.pastGuestCount <= 1) return;
    state.pastGuestCount--;
    state.pastGuestNames.length = state.pastGuestCount;
    rerender(container, state);
  });
  container.querySelector<HTMLButtonElement>('#me-pg-inc')?.addEventListener('click', () => {
    if (state.pastGuestCount >= 5) return;
    state.pastGuestCount++;
    state.pastGuestNames.push('');
    rerender(container, state);
  });
  container.querySelectorAll<HTMLInputElement>('.me-pg-name').forEach((inp) => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.dataset.guestIdx);
      state.pastGuestNames[idx] = inp.value;
    });
  });
  container.querySelector<HTMLButtonElement>('#me-pg-save')?.addEventListener('click', () => {
    void handleGuestSave(container, state, 'past');
  });

  // ─── Notification settings ───

  // Master toggle: ON → soft-ask kártya; OFF → unsubscribe
  container.querySelector<HTMLInputElement>('#me-pref-enabled')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) {
      // Soft-ask kártya nyitása (a tényleges permission prompt csak ezután jön)
      state.showPushOptIn = true;
      rerender(container, state);
    } else {
      void handlePushUnsubscribe(container, state);
    }
  });

  // Soft-ask: Igen, engedélyezem
  container.querySelector<HTMLButtonElement>('#me-push-allow')?.addEventListener('click', () => {
    state.showPushOptIn = false;
    void handlePushSubscribe(container, state);
  });

  // Soft-ask: Most nem
  container.querySelector<HTMLButtonElement>('#me-push-deny')?.addEventListener('click', () => {
    state.showPushOptIn = false;
    rerender(container, state);
  });

  // Event-type togglék (kedd reggel, lemondás stb.)
  container.querySelectorAll<HTMLInputElement>('[data-pref-event]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.prefEvent as keyof MemberNotificationPrefs['events'];
      if (!key) return;
      state.prefs.events[key] = cb.checked;
      // Az enabled mezőt is szinkronban tartjuk: ha legalább egy eszköz van + aktív, akkor enabled=true
      state.prefs.enabled = state.subscriptions.some((s) => s.enabled);
      void savePrefs(state);
    });
  });

  // Csendes órák enabled
  container.querySelector<HTMLInputElement>('#me-pref-quiet-enabled')?.addEventListener('change', (e) => {
    state.prefs.quietHours.enabled = (e.target as HTMLInputElement).checked;
    rerender(container, state);
    void savePrefs(state);
  });
  // Csendes órák idő-mezők
  container.querySelector<HTMLInputElement>('#me-pref-quiet-from')?.addEventListener('change', (e) => {
    state.prefs.quietHours.from = (e.target as HTMLInputElement).value;
    void savePrefs(state);
  });
  container.querySelector<HTMLInputElement>('#me-pref-quiet-to')?.addEventListener('change', (e) => {
    state.prefs.quietHours.to = (e.target as HTMLInputElement).value;
    void savePrefs(state);
  });

  // Eszköz lista: enabled toggle
  container.querySelectorAll<HTMLInputElement>('[data-sub-toggle]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const subId = cb.dataset.subToggle;
      if (!subId) return;
      try {
        await setSubscriptionEnabled(subId, cb.checked);
        const sub = state.subscriptions.find((s) => s.id === subId);
        if (sub) sub.enabled = cb.checked;
        state.prefs.enabled = state.subscriptions.some((s) => s.enabled);
        void savePrefs(state);
        state.toast = { kind: 'success', msg: cb.checked ? 'Eszköz aktiválva' : 'Eszköz kikapcsolva' };
        rerender(container, state);
      } catch (err) {
        state.toast = { kind: 'error', msg: `Hiba: ${String(err)}` };
        rerender(container, state);
      }
    });
  });

  // Eszköz lista: delete
  container.querySelectorAll<HTMLButtonElement>('[data-sub-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const subId = btn.dataset.subDelete;
      if (!subId) return;
      if (!confirm('Biztosan eltávolítod ezt az eszközt a push listából?')) return;
      try {
        await deleteSubscription(subId);
        state.subscriptions = state.subscriptions.filter((s) => s.id !== subId);
        state.prefs.enabled = state.subscriptions.some((s) => s.enabled);
        void savePrefs(state);
        state.toast = { kind: 'success', msg: '🗑️ Eszköz eltávolítva' };
        rerender(container, state);
      } catch (err) {
        state.toast = { kind: 'error', msg: `Hiba: ${String(err)}` };
        rerender(container, state);
      }
    });
  });

  // Profil: név átírás
  container.querySelector<HTMLInputElement>('#me-name-input')?.addEventListener('input', (e) => {
    state.nameEdit = (e.target as HTMLInputElement).value;
    // Csak a card frissül (nem teljes re-render, hogy a fókusz maradjon)
    const card = container.querySelector<HTMLElement>('#me-name-input')?.closest('section');
    if (card) {
      const saveBtn = card.querySelector<HTMLButtonElement>('#me-name-save');
      const shouldShow = state.nameEdit.trim() !== state.member.name && state.nameEdit.trim().length > 0;
      if (shouldShow && !saveBtn) rerender(container, state);
      if (!shouldShow && saveBtn) saveBtn.remove();
    }
  });
  container.querySelector<HTMLButtonElement>('#me-name-save')?.addEventListener('click', () => {
    void handleNameSave(container, state);
  });
}

// ─────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────

async function handleRegisterNext(container: HTMLElement, state: MeState, status: 'Yes' | 'No') {
  if (state.saving) return;
  state.saving = true;
  rerender(container, state);
  try {
    await upsertSelfRegistration(state.member.name, state.nextDate, status);
    if (status === 'Yes') {
      state.myAttendance.add(state.nextDate);
      state.myDeclined.delete(state.nextDate);
    } else {
      state.myAttendance.delete(state.nextDate);
      state.myDeclined.add(state.nextDate);
    }
    state.toast = { kind: 'success', msg: status === 'Yes' ? '✓ Sikeresen jelentkeztél!' : '✗ Jelezted, hogy nem tudsz jönni' };
    void logEvent('info', 'Self registration', { name: state.member.name, date: state.nextDate, status });
  } catch (err) {
    state.toast = { kind: 'error', msg: `Hiba: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    state.saving = false;
    rerender(container, state);
  }
}

async function handleRegisterPast(container: HTMLElement, state: MeState, status: 'Yes' | 'No' = 'Yes') {
  if (state.saving || !state.pastDate) return;
  state.saving = true;
  rerender(container, state);
  try {
    await upsertSelfRegistration(state.member.name, state.pastDate, status);
    if (status === 'Yes') {
      state.myAttendance.add(state.pastDate);
      state.myDeclined.delete(state.pastDate);
    } else {
      state.myAttendance.delete(state.pastDate);
      state.myDeclined.add(state.pastDate);
    }
    state.toast = { kind: 'success', msg: status === 'Yes' ? '✓ Hozzáadva' : '✗ Jelezted, hogy nem voltál ott' };
    void logEvent('info', `Self registration (past, ${status})`, { name: state.member.name, date: state.pastDate });
  } catch (err) {
    state.toast = { kind: 'error', msg: `Hiba: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    state.saving = false;
    rerender(container, state);
  }
}

async function handleGuestSave(container: HTMLElement, state: MeState, mode: 'future' | 'past') {
  if (state.saving) return;
  const date = mode === 'future' ? state.nextDate : state.pastDate;
  if (!date) return;

  const names = mode === 'future' ? state.guestNames : state.pastGuestNames;
  const cleanNames = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (cleanNames.length === 0) {
    state.toast = { kind: 'error', msg: 'Adj meg legalább egy nevet' };
    rerender(container, state);
    return;
  }

  state.saving = true;
  rerender(container, state);
  try {
    const rows: NewAttendanceRow[] = cleanNames.map((name) => ({
      name,
      status: 'Yes',
      event_date: date,
      mode: 'valós',
    }));
    await addAttendanceBatch(rows);
    if (mode === 'future') {
      state.guestMode = false;
      state.guestNames = [''];
      state.guestCount = 1;
    } else {
      state.pastGuestMode = false;
      state.pastGuestNames = [''];
      state.pastGuestCount = 1;
    }
    state.toast = { kind: 'success', msg: `✓ ${cleanNames.length} vendég hozzáadva` };
    void logEvent('info', 'Guests added by member', { byMember: state.member.name, date, guests: cleanNames });
  } catch (err) {
    state.toast = { kind: 'error', msg: `Hiba: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    state.saving = false;
    rerender(container, state);
  }
}

async function handleNameSave(container: HTMLElement, state: MeState) {
  if (state.saving) return;
  const newName = state.nameEdit.trim();
  if (!newName || newName === state.member.name) return;
  state.saving = true;
  rerender(container, state);
  try {
    await updateMember(state.member.id, { name: newName });
    state.member.name = newName;
    state.toast = { kind: 'success', msg: '✓ Név frissítve' };
    void logEvent('info', 'Member self-renamed', { id: state.member.id, newName });
  } catch (err) {
    state.toast = { kind: 'error', msg: `Hiba: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    state.saving = false;
    rerender(container, state);
  }
}

// ─── Notification subscription handlers ───

async function handlePushSubscribe(container: HTMLElement, state: MeState) {
  if (state.pushSubscribing) return;
  state.pushSubscribing = true;
  rerender(container, state);
  try {
    const result = await subscribeToPush(state.member.id, state.member.email);
    if (!result.ok) {
      state.pushPermission = currentPermission();
      // A hiba kódja lehet 'unsupported', 'permission-denied', vagy 'get-token-failed: messaging/...'
      const code = result.error.split(':')[0]?.trim() ?? result.error;
      const detail = result.error.includes(':') ? result.error.split(':').slice(1).join(':').trim() : '';
      const msgMap: Record<string, string> = {
        'unsupported': 'Ez a böngésző nem támogatja az értesítéseket',
        'permission-denied': 'Engedély megtagadva — a böngésző beállításaiban tudod feloldani',
        'sw-register-failed': 'A service worker regisztrálása sikertelen',
        'get-token-failed': 'Token-lekérés hiba',
        'no-token': 'Nem kaptunk push tokent',
      };
      const base = msgMap[code] ?? `Hiba: ${code}`;
      state.toast = { kind: 'error', msg: detail ? `${base} (${detail})` : base };
    } else {
      // Refresh subscriptions
      state.subscriptions = await getMySubscriptions(state.member.id);
      state.prefs.enabled = true;
      state.pushPermission = 'granted';
      await savePrefs(state);
      state.toast = { kind: 'success', msg: '🔔 Értesítések engedélyezve' };
      void logEvent('info', 'Push subscribed', { memberId: state.member.id });
    }
  } catch (err) {
    state.toast = { kind: 'error', msg: `Hiba: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    state.pushSubscribing = false;
    rerender(container, state);
  }
}

async function handlePushUnsubscribe(container: HTMLElement, state: MeState) {
  if (state.pushSubscribing) return;
  state.pushSubscribing = true;
  rerender(container, state);
  try {
    await unsubscribeFromPush(state.member.id);
    state.subscriptions = [];
    state.prefs.enabled = false;
    await savePrefs(state);
    state.toast = { kind: 'info', msg: 'Értesítések kikapcsolva' };
    void logEvent('info', 'Push unsubscribed', { memberId: state.member.id });
  } catch (err) {
    state.toast = { kind: 'error', msg: `Hiba: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    state.pushSubscribing = false;
    rerender(container, state);
  }
}

/** Csendben menti a prefs-et a Firestore-ba (nincs toast, nincs re-render). */
async function savePrefs(state: MeState): Promise<void> {
  try {
    await updateMemberPrefs(state.member.id, { notifications: state.prefs });
  } catch (err) {
    console.warn('[me] savePrefs failed:', err);
  }
}

// Phase D-től használjuk — placeholder
async function _deleteAttendance(name: string, date: string) {
  await deleteAttendanceForPlayerOnDate(name, date);
}
void _deleteAttendance;

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(h) % 360;
}

function eh(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function ea(s: string): string { return eh(s); }
