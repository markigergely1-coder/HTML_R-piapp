/**
 * 👤 Tagok — admin oldal a Claude Design rendszerrel.
 *
 * - Bejelentkezés-gate (Firebase Auth, Google)
 * - Admin email allowlist ellenőrzés
 * - Mobil: stats → kereső → add form → tagok lista
 * - Desktop (lg+): bal oldalsáv (stats + add form, sticky) | tagok lista
 */

import { renderHeader } from '../components/header';
import { getAuthState, onAuthChange, signIn } from '../lib/auth';
import { getInitials } from '../lib/avatar';
import {
  getAllMembers,
  addMember,
  updateMember,
  deleteMember,
  type Member,
} from '../lib/firestore';

interface MembersState {
  members: Member[];
  filter: string;            // kereső szöveg
  editingId: string | null;  // épp szerkesztett sor ID-je
  addOpen: boolean;          // mobil add form nyitva
  toast: { kind: 'success' | 'error'; msg: string } | null;
}

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
let toastTimer: number | null = null;

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderMembersPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());

  const auth = getAuthState();
  if (auth.loading) return; // a router majd újrahív
  if (!auth.user)        return showSignInGate(container);
  if (!auth.isAdmin)     return showNoPermissionGate(container, auth.user.email ?? '');

  // Admin — adatok
  const members = await getAllMembers();
  const state: MembersState = {
    members,
    filter: '',
    editingId: null,
    addOpen: false,
    toast: null,
  };

  rerender(container, state);

  // Re-render ha kijelentkezik
  const unsub = onAuthChange((s) => {
    if (!s.user || !s.isAdmin) {
      unsub();
      renderMembersPage(container);
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// Shell + loading
// ─────────────────────────────────────────────────────────────────

function renderShell(body: string): string {
  return `
    <div class="device">
      ${renderHeader('members')}
      <main id="members-body">${body}</main>
    </div>`;
}

function renderLoadingBody(): string {
  return `
    <div class="px-5 pt-5 space-y-3">
      <div class="grid grid-cols-2 gap-2.5">
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
      </div>
      <div class="h-14 rounded-2xl animate-pulse" style="background:var(--line)"></div>
      ${Array(5).fill(0).map(() => `
        <div class="h-16 rounded-2xl animate-pulse" style="background:var(--line)"></div>`).join('')}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
// Gate-ek (sign-in / no-permission)
// ─────────────────────────────────────────────────────────────────

function showSignInGate(container: HTMLElement): void {
  container.innerHTML = renderShell(`
    <div class="px-5 pt-5 pb-12 fade-up">
      <div class="card relative p-6 lg:p-8 text-center overflow-hidden" style="border-radius:24px">
        <div class="halo"></div>
        <div class="relative">
          <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
               style="background:color-mix(in oklab,var(--accent) 14%,transparent)">
            <span class="text-3xl">🔒</span>
          </div>
          <p class="text-[17px] font-semibold text-fg-1 mb-1">Csak admin oldal</p>
          <p class="text-[13px] text-fg-3 max-w-[280px] mx-auto mb-5">
            A tagok kezeléséhez jelentkezz be az admin Google fiókoddal.
          </p>
          <button id="gate-signin"
            class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-colors"
            style="background:var(--accent)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.35 11.1h-9.17v2.92h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.46 5 16.42 5 12c0-4.3 3.31-7.46 7.18-7.46 2.98 0 4.74 1.9 4.74 1.9L19 4.4S16.62 2 12.1 2 4 5.6 4 12c0 6.32 3.97 10 8.25 10 4.4 0 7.43-2.93 7.43-7.36 0-.94-.13-1.54-.13-1.54z"/>
            </svg>
            Bejelentkezés Google-lel
          </button>
        </div>
      </div>
    </div>`);
  container.querySelector<HTMLButtonElement>('#gate-signin')?.addEventListener('click', () => {
    signIn().catch((e) => console.warn('Sign-in failed:', e));
  });
}

function showNoPermissionGate(container: HTMLElement, email: string): void {
  container.innerHTML = renderShell(`
    <div class="px-5 pt-5 pb-12 fade-up">
      <div class="card-soft p-6 lg:p-8 text-center" style="border-radius:24px">
        <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
             style="background:color-mix(in oklab,#f59e0b 14%,transparent)">
          <span class="text-3xl">⛔</span>
        </div>
        <p class="text-[17px] font-semibold text-fg-1 mb-1">Nincs admin jogosultság</p>
        <p class="text-[13px] text-fg-3 max-w-[300px] mx-auto">
          A <span class="font-mono-tnum text-fg-1">${eh(email)}</span> nem szerepel az admin email-ek között.
        </p>
      </div>
    </div>`);
}

// ─────────────────────────────────────────────────────────────────
// Body (admin)
// ─────────────────────────────────────────────────────────────────

function renderBody(state: MembersState): string {
  return `
    <div class="lg:grid lg:grid-cols-[320px_1fr] lg:gap-6 lg:p-6 lg:pt-5 lg:items-start">
      <!-- Bal: stats + add form (sticky desktop) -->
      <aside class="lg:sticky lg:top-[110px] space-y-3 px-5 pt-5 lg:px-0 lg:pt-0">
        ${renderStats(state)}
        <!-- Mobil: gombbal nyitható, desktop: mindig nyitva -->
        <div class="lg:hidden">
          ${renderAddCardMobile(state)}
        </div>
        <div class="hidden lg:block">
          ${renderAddCardDesktop()}
        </div>
      </aside>

      <!-- Jobb: kereső + tagok lista -->
      <section class="px-5 pt-3 pb-12 lg:px-0 lg:pt-0 space-y-3">
        ${renderSearch(state)}
        ${renderMembersList(state)}
      </section>
    </div>
    ${state.toast ? renderToast(state.toast) : ''}`;
}

// ─── Stats kártyák ───
function renderStats(state: MembersState): string {
  const total = state.members.length;
  const active = state.members.filter((m) => m.active).length;
  const inactive = total - active;

  const card = (label: string, value: number, tone: 'red'|'emerald'|'zinc') => {
    const tones: Record<string,{dot:string;tint:string}> = {
      red:     { dot:'var(--accent)',  tint:'color-mix(in oklab,var(--accent) 10%,transparent)' },
      emerald: { dot:'#10b981', tint:'rgba(16,185,129,0.10)' },
      zinc:    { dot:'#a3a3a3', tint:'rgba(160,160,160,0.08)' },
    };
    const t = tones[tone];
    return `
      <div class="card relative p-3.5 overflow-hidden lift">
        <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:${t.tint};filter:blur(8px)"></div>
        <div class="relative flex items-center justify-between mb-2">
          <span class="eyebrow text-[10px]">${label}</span>
          <span class="w-1.5 h-1.5 rounded-full" style="background:${t.dot}"></span>
        </div>
        <p class="relative font-mono-tnum font-semibold text-[26px] leading-none num-display text-fg-1">${value}</p>
      </div>`;
  };

  return `
    <div class="grid grid-cols-3 gap-2 fade-up">
      ${card('Összes',  total,    'red')}
      ${card('Aktív',   active,   'emerald')}
      ${card('Inaktív', inactive, 'zinc')}
    </div>`;
}

// ─── Mobil add card (collapsible) ───
function renderAddCardMobile(state: MembersState): string {
  if (!state.addOpen) {
    return `
      <button id="add-toggle"
        class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[13px] font-semibold transition-colors fade-up"
        style="border:1.5px dashed var(--line-strong); background:var(--bg-card); color:var(--fg-2)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
        </svg>
        Új tag hozzáadása
      </button>`;
  }
  return renderAddForm({ closable: true });
}

// ─── Desktop add card (always visible) ───
function renderAddCardDesktop(): string {
  return renderAddForm({ closable: false });
}

function renderAddForm(opts: { closable: boolean }): string {
  return `
    <div class="card p-4 lg:p-5 fade-up">
      <div class="flex items-center justify-between mb-3">
        <span class="eyebrow">Új tag</span>
        ${opts.closable
          ? `<button id="add-toggle" class="text-[11px] text-fg-3 hover:text-fg-1 transition-colors">Mégse</button>`
          : ''}
      </div>
      <div class="space-y-2.5">
        <label class="block">
          <span class="text-[10px] font-medium text-fg-3 block mb-1">Név</span>
          <input id="new-name" type="text" placeholder="Teljes név"
            class="w-full rounded-[12px] border px-3 py-2.5 text-[13.5px] text-fg-1 placeholder-fg-3 focus:outline-none focus:border-current transition-colors"
            style="border-color:var(--line-strong); background:var(--bg-elev)" />
        </label>
        <label class="block">
          <span class="text-[10px] font-medium text-fg-3 block mb-1">Email</span>
          <input id="new-email" type="email" placeholder="nev@example.com"
            class="w-full rounded-[12px] border px-3 py-2.5 text-[13.5px] text-fg-1 placeholder-fg-3 focus:outline-none focus:border-current transition-colors"
            style="border-color:var(--line-strong); background:var(--bg-elev)" />
        </label>
        <label class="flex items-center gap-2 cursor-pointer py-1.5">
          <input id="new-active" type="checkbox" checked class="w-4 h-4 rounded" style="accent-color:var(--accent)" />
          <span class="text-[12.5px] text-fg-2">Aktív tag</span>
        </label>
        <button id="new-save"
          class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-colors"
          style="background:var(--accent)">
          Mentés
        </button>
      </div>
    </div>`;
}

// ─── Kereső ───
function renderSearch(state: MembersState): string {
  return `
    <div class="card flex items-center gap-2.5 px-3.5 py-2 fade-up" style="border-radius:16px">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--fg-3);flex:none">
        <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
      </svg>
      <input id="filter-input" type="search" placeholder="Keresés név vagy email alapján…"
        value="${ea(state.filter)}"
        class="flex-1 bg-transparent text-[13.5px] text-fg-1 placeholder-fg-3 focus:outline-none py-1.5" />
      ${state.filter ? `<button id="filter-clear" class="text-[11px] font-semibold transition-colors" style="color:var(--accent)">Töröl</button>` : ''}
    </div>`;
}

// ─── Tagok lista ───
function renderMembersList(state: MembersState): string {
  const filtered = filterMembers(state.members, state.filter);

  if (filtered.length === 0) {
    return `
      <div class="card-soft p-8 text-center fade-up" style="border-radius:22px">
        <div class="text-3xl mb-2">${state.filter ? '🔍' : '👥'}</div>
        <p class="text-[14px] font-semibold text-fg-1">
          ${state.filter ? 'Nincs találat' : 'Még nincs tag'}
        </p>
        <p class="text-[12px] text-fg-3 mt-1">
          ${state.filter
            ? `A "${eh(state.filter)}" keresésre nincs egyezés.`
            : 'Adj hozzá egy új tagot.'}
        </p>
      </div>`;
  }

  return `
    <div class="card overflow-hidden fade-up" style="border-radius:22px">
      <ul>
        ${filtered.map((m, i) => renderMemberRow(m, state, i)).join('')}
      </ul>
    </div>`;
}

function renderMemberRow(m: Member, state: MembersState, index: number): string {
  const isEditing = state.editingId === m.id;
  const hue = avatarHue(m.name || '?');
  const initials = getInitials(m.name || '?');
  const topBorder = index === 0 ? '' : 'border-top:1px solid var(--line);';

  if (isEditing) {
    return `
      <li data-id="${m.id}" style="${topBorder} background:color-mix(in oklab,var(--accent) 6%,transparent)">
        <div class="px-4 py-3.5 space-y-2.5">
          <input class="edit-name w-full rounded-[12px] border px-3 py-2 text-[13.5px] text-fg-1 focus:outline-none"
            style="border-color:var(--line-strong); background:var(--bg-card)"
            type="text" value="${ea(m.name)}" placeholder="Név" />
          <input class="edit-email w-full rounded-[12px] border px-3 py-2 text-[13.5px] text-fg-1 focus:outline-none"
            style="border-color:var(--line-strong); background:var(--bg-card)"
            type="email" value="${ea(m.email)}" placeholder="Email" />
          <div class="flex items-center justify-between">
            <label class="flex items-center gap-2 cursor-pointer">
              <input class="edit-active w-4 h-4 rounded" style="accent-color:var(--accent)"
                type="checkbox" ${m.active ? 'checked' : ''} />
              <span class="text-[12px] text-fg-2">Aktív</span>
            </label>
            <div class="flex gap-2">
              <button class="edit-cancel px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
                style="background:var(--bg-elev); color:var(--fg-2)">
                Mégse
              </button>
              <button class="edit-save px-3 py-1.5 rounded-full text-white text-[12px] font-semibold transition-colors"
                style="background:var(--accent)">
                Mentés
              </button>
            </div>
          </div>
        </div>
      </li>`;
  }

  return `
    <li data-id="${m.id}" class="hover:bg-[color:var(--bg-elev)] transition-colors" style="${topBorder}">
      <div class="flex items-center gap-3 px-4 py-3">
        <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[11px] relative"
             style="width:36px;height:36px;background:linear-gradient(135deg,hsl(${hue} 80% 88%) 0%,hsl(${(hue+30)%360} 75% 78%) 100%);color:hsl(${hue} 60% 30%)">
          ${eh(initials)}
          ${m.active ? '' : `<span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full" style="background:#a3a3a3;border:2px solid var(--bg-card)" title="Inaktív"></span>`}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[13.5px] font-semibold text-fg-1 truncate">${eh(m.name || '(nincs név)')}</p>
          <p class="text-[11.5px] text-fg-3 truncate font-mono-tnum">${eh(m.email || '(nincs email)')}</p>
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button class="row-edit p-2 rounded-lg transition-colors hover:bg-[color:var(--bg-card)]"
            title="Szerkesztés" style="color:var(--fg-3)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          </button>
          <button class="row-delete p-2 rounded-lg transition-colors hover:bg-[color:var(--bg-card)]"
            title="Törlés" style="color:var(--fg-3)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>
      </div>
    </li>`;
}

// ─── Toast ───
function renderToast(toast: NonNullable<MembersState['toast']>): string {
  const palette = toast.kind === 'success'
    ? 'background:color-mix(in oklab,#10b981 14%,var(--bg-card));border:1px solid color-mix(in oklab,#10b981 30%,var(--line));color:#047857'
    : 'background:color-mix(in oklab,var(--accent) 14%,var(--bg-card));border:1px solid color-mix(in oklab,var(--accent) 30%,var(--line));color:var(--accent-ink)';
  return `
    <div id="toast" class="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full shadow-lg text-[12.5px] font-semibold fade-up"
      style="bottom:24px;${palette}">
      ${eh(toast.msg)}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
// Re-render + handlers
// ─────────────────────────────────────────────────────────────────

function rerender(container: HTMLElement, state: MembersState) {
  const body = container.querySelector<HTMLElement>('#members-body')!;
  body.innerHTML = renderBody(state);
  attachBodyHandlers(container, state);

  // Toast auto-dismiss
  if (state.toast) {
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      state.toast = null;
      rerender(container, state);
    }, 2500);
  }
}

function attachBodyHandlers(container: HTMLElement, state: MembersState) {
  // Add toggle (mobil)
  container.querySelector<HTMLButtonElement>('#add-toggle')?.addEventListener('click', () => {
    state.addOpen = !state.addOpen;
    rerender(container, state);
  });

  // Save új tag
  container.querySelector<HTMLButtonElement>('#new-save')?.addEventListener('click', async () => {
    const name = (container.querySelector<HTMLInputElement>('#new-name')?.value ?? '').trim();
    const email = (container.querySelector<HTMLInputElement>('#new-email')?.value ?? '').trim();
    const active = container.querySelector<HTMLInputElement>('#new-active')?.checked ?? true;

    if (!name) {
      state.toast = { kind: 'error', msg: 'A név megadása kötelező.' };
      return rerender(container, state);
    }
    if (!EMAIL_REGEX.test(email)) {
      state.toast = { kind: 'error', msg: 'Érvénytelen email cím.' };
      return rerender(container, state);
    }
    try {
      await addMember({ name, email, active });
      state.members = await getAllMembers();
      state.addOpen = false;
      state.toast = { kind: 'success', msg: `✓ ${name} hozzáadva` };
      rerender(container, state);
    } catch (e) {
      state.toast = { kind: 'error', msg: `Hiba: ${String(e)}` };
      rerender(container, state);
    }
  });

  // Kereső
  const filterInput = container.querySelector<HTMLInputElement>('#filter-input');
  filterInput?.addEventListener('input', () => {
    state.filter = filterInput.value;
    // Csak a listát + clear gombot frissítjük (fókusz megőrzéséhez)
    const right = container.querySelector('#members-body > div > section');
    if (right) right.innerHTML = renderSearch(state) + renderMembersList(state);
    attachBodyHandlers(container, state);
    // Fókusz vissza a search input-ra
    container.querySelector<HTMLInputElement>('#filter-input')?.focus();
    // Cursor a sztring végére
    const inp = container.querySelector<HTMLInputElement>('#filter-input');
    if (inp) inp.setSelectionRange(inp.value.length, inp.value.length);
  });
  container.querySelector<HTMLButtonElement>('#filter-clear')?.addEventListener('click', () => {
    state.filter = '';
    rerender(container, state);
  });

  // Sorok: szerkesztés + törlés
  container.querySelectorAll<HTMLLIElement>('[data-id]').forEach((li) => {
    const id = li.dataset.id!;

    li.querySelector<HTMLButtonElement>('.row-edit')?.addEventListener('click', () => {
      state.editingId = id;
      rerender(container, state);
    });

    li.querySelector<HTMLButtonElement>('.row-delete')?.addEventListener('click', async () => {
      const m = state.members.find((x) => x.id === id);
      if (!m) return;
      if (!confirm(`Biztosan törlöd?\n\n${m.name} (${m.email})`)) return;
      try {
        await deleteMember(id);
        state.members = state.members.filter((x) => x.id !== id);
        state.toast = { kind: 'success', msg: `🗑️ ${m.name} törölve` };
        rerender(container, state);
      } catch (e) {
        state.toast = { kind: 'error', msg: `Hiba: ${String(e)}` };
        rerender(container, state);
      }
    });

    li.querySelector<HTMLButtonElement>('.edit-cancel')?.addEventListener('click', () => {
      state.editingId = null;
      rerender(container, state);
    });

    li.querySelector<HTMLButtonElement>('.edit-save')?.addEventListener('click', async () => {
      const name = (li.querySelector<HTMLInputElement>('.edit-name')?.value ?? '').trim();
      const email = (li.querySelector<HTMLInputElement>('.edit-email')?.value ?? '').trim();
      const active = li.querySelector<HTMLInputElement>('.edit-active')?.checked ?? true;
      if (!name) {
        state.toast = { kind: 'error', msg: 'A név nem lehet üres.' };
        return rerender(container, state);
      }
      if (email && !EMAIL_REGEX.test(email)) {
        state.toast = { kind: 'error', msg: 'Érvénytelen email cím.' };
        return rerender(container, state);
      }
      try {
        await updateMember(id, { name, email, active });
        const m = state.members.find((x) => x.id === id);
        if (m) { m.name = name; m.email = email; m.active = active; }
        state.editingId = null;
        state.toast = { kind: 'success', msg: '✓ Mentve' };
        rerender(container, state);
      } catch (e) {
        state.toast = { kind: 'error', msg: `Hiba: ${String(e)}` };
        rerender(container, state);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function filterMembers(members: Member[], filter: string): Member[] {
  const f = filter.trim().toLowerCase();
  if (!f) return members;
  return members.filter((m) =>
    m.name.toLowerCase().includes(f) || m.email.toLowerCase().includes(f),
  );
}

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
