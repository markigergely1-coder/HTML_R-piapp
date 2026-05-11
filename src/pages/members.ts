/**
 * 👤 Tagok & Email — admin-only oldal.
 * - Bejelentkezés-gate (Firebase Auth, Google sign-in)
 * - Admin email allowlist ellenőrzés
 * - Tagok lista (avatar, név, email, aktív)
 * - Hozzáadás form (név + email + aktív)
 * - Szerkesztés inline (row → input mezők)
 * - Törlés confirm-mel
 */

import { renderHeader, attachHeaderHandlers } from '../components/header';
import { getAuthState, onAuthChange, signIn } from '../lib/auth';
import { getInitials, getAvatarColor } from '../lib/avatar';
import {
  getAllMembers,
  addMember,
  updateMember,
  deleteMember,
  type Member,
} from '../lib/firestore';

interface MembersState {
  members: Member[];
  editingId: string | null;
  addOpen: boolean;
  toast: { kind: 'success' | 'error'; msg: string } | null;
}

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ─────────────────────────────────────────────────────────────────
// Belépési pont
// ─────────────────────────────────────────────────────────────────

export async function renderMembersPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(renderLoadingBody());
  attachHeaderHandlers(container);

  const auth = getAuthState();

  // Ha nincs bejelentkezve, vagy nem admin: gate
  if (auth.loading) {
    return; // várjuk meg az első auth állapotot — a router újrahív
  }

  if (!auth.user) {
    container.innerHTML = renderShell(renderSignInGate());
    attachHeaderHandlers(container);
    container.querySelector<HTMLButtonElement>('#gate-signin')?.addEventListener('click', () => {
      signIn().catch((e) => console.warn('Sign-in failed:', e));
    });
    return;
  }

  if (!auth.isAdmin) {
    container.innerHTML = renderShell(renderNoPermissionGate(auth.user.email ?? ''));
    attachHeaderHandlers(container);
    return;
  }

  // Admin — adatok betöltése
  const members = await getAllMembers();
  const state: MembersState = {
    members,
    editingId: null,
    addOpen: false,
    toast: null,
  };

  rerender(container, state);

  // Ha kijelentkezik az admin, frissüljön a UI
  const unsub = onAuthChange((s) => {
    if (!s.user || !s.isAdmin) {
      unsub();
      renderMembersPage(container); // újra-dispatch
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// Shell + gate-ek
// ─────────────────────────────────────────────────────────────────

function renderShell(body: string): string {
  return `
    <div class="bg-zinc-50 min-h-screen pb-12">
      <div class="max-w-md mx-auto">
        ${renderHeader('members')}
        <main id="members-body">${body}</main>
      </div>
    </div>
  `;
}

function renderLoadingBody(): string {
  return `
    <div class="px-4 py-6 space-y-3">
      <div class="h-14 bg-zinc-100 rounded-2xl animate-pulse"></div>
      <div class="h-20 bg-zinc-100 rounded-2xl animate-pulse"></div>
      <div class="h-20 bg-zinc-100 rounded-2xl animate-pulse"></div>
      <div class="h-20 bg-zinc-100 rounded-2xl animate-pulse"></div>
    </div>
  `;
}

function renderSignInGate(): string {
  return `
    <div class="flex flex-col items-center justify-center px-6 py-16 text-center gap-4">
      <div class="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center">
        <span class="text-3xl">🔒</span>
      </div>
      <div>
        <p class="text-[16px] font-semibold text-zinc-900 mb-1">Csak admin oldal</p>
        <p class="text-[13px] text-zinc-500 max-w-[260px]">
          A tagok kezeléséhez jelentkezz be az admin Google fiókoddal.
        </p>
      </div>
      <button id="gate-signin"
        class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold transition-colors shadow-sm">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21.35 11.1h-9.17v2.92h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.46 5 16.42 5 12c0-4.3 3.31-7.46 7.18-7.46 2.98 0 4.74 1.9 4.74 1.9L19 4.4S16.62 2 12.1 2 4 5.6 4 12c0 6.32 3.97 10 8.25 10 4.4 0 7.43-2.93 7.43-7.36 0-.94-.13-1.54-.13-1.54z" />
        </svg>
        Bejelentkezés Google-lel
      </button>
    </div>
  `;
}

function renderNoPermissionGate(email: string): string {
  return `
    <div class="flex flex-col items-center justify-center px-6 py-16 text-center gap-4">
      <div class="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center">
        <span class="text-3xl">⛔</span>
      </div>
      <div>
        <p class="text-[16px] font-semibold text-zinc-900 mb-1">Nincs admin jogosultság</p>
        <p class="text-[13px] text-zinc-500 max-w-[280px]">
          A <span class="font-mono text-zinc-700">${escapeHtml(email)}</span> nem szerepel az
          admin email-ek között.
        </p>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────
// Admin body
// ─────────────────────────────────────────────────────────────────

function renderBody(state: MembersState): string {
  const stats = {
    total: state.members.length,
    active: state.members.filter((m) => m.active).length,
  };

  return `
    <div class="px-4 py-5 space-y-4">
      ${renderStatsRow(stats)}
      ${renderAddCard(state)}
      ${renderMembersList(state)}
      ${state.toast ? renderToast(state.toast) : ''}
    </div>
  `;
}

function renderStatsRow(stats: { total: number; active: number }): string {
  return `
    <div class="grid grid-cols-2 gap-2">
      <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-3.5">
        <p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Összes tag</p>
        <p class="text-[24px] font-bold text-zinc-900 leading-none">${stats.total}</p>
      </div>
      <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-3.5">
        <p class="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-1">Aktív</p>
        <p class="text-[24px] font-bold text-emerald-600 leading-none">${stats.active}</p>
      </div>
    </div>
  `;
}

function renderAddCard(state: MembersState): string {
  if (!state.addOpen) {
    return `
      <button id="add-toggle"
        class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-dashed border-zinc-300 bg-white hover:border-brand-400 hover:bg-brand-50/50 text-zinc-600 hover:text-brand-700 text-[13px] font-semibold transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Új tag hozzáadása
      </button>
    `;
  }

  return `
    <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4">
      <div class="flex items-center justify-between mb-3">
        <p class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Új tag</p>
        <button id="add-toggle"
          class="text-[11px] text-zinc-500 hover:text-zinc-700">
          Mégse
        </button>
      </div>
      <div class="space-y-2.5">
        <input id="new-name" type="text" placeholder="Teljes név"
          class="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 focus:bg-white" />
        <input id="new-email" type="email" placeholder="email@example.com"
          class="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 focus:bg-white" />
        <label class="flex items-center gap-2 cursor-pointer py-1">
          <input id="new-active" type="checkbox" checked
            class="w-4 h-4 rounded border-zinc-300 text-brand-500 focus:ring-brand-500" />
          <span class="text-[13px] text-zinc-700">Aktív tag</span>
        </label>
        <button id="new-save"
          class="w-full px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold transition-colors">
          💾 Mentés
        </button>
      </div>
    </div>
  `;
}

function renderMembersList(state: MembersState): string {
  if (state.members.length === 0) {
    return `
      <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8 text-center">
        <div class="text-3xl mb-2">👥</div>
        <p class="text-[14px] font-semibold text-zinc-700">Még nincs tag</p>
        <p class="text-[12px] text-zinc-500 mt-1">Adj hozzá egy új tagot fent.</p>
      </div>
    `;
  }

  return `
    <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <ul class="divide-y divide-zinc-100">
        ${state.members.map((m) => renderMemberRow(m, state)).join('')}
      </ul>
    </div>
  `;
}

function renderMemberRow(m: Member, state: MembersState): string {
  const isEditing = state.editingId === m.id;
  const { bg, text } = getAvatarColor(m.name || '?');
  const initials = getInitials(m.name || '?');

  if (isEditing) {
    return `
      <li class="px-4 py-3 bg-brand-50/30" data-id="${m.id}">
        <div class="space-y-2">
          <input class="edit-name w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            type="text" value="${escapeAttr(m.name)}" placeholder="Név" />
          <input class="edit-email w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            type="email" value="${escapeAttr(m.email)}" placeholder="Email" />
          <div class="flex items-center justify-between">
            <label class="flex items-center gap-2 cursor-pointer">
              <input class="edit-active w-4 h-4 rounded border-zinc-300 text-brand-500 focus:ring-brand-500"
                type="checkbox" ${m.active ? 'checked' : ''} />
              <span class="text-[12px] text-zinc-700">Aktív</span>
            </label>
            <div class="flex gap-2">
              <button class="edit-cancel px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[12px] font-semibold">
                Mégse
              </button>
              <button class="edit-save px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[12px] font-semibold">
                ✓ Mentés
              </button>
            </div>
          </div>
        </div>
      </li>
    `;
  }

  return `
    <li class="px-4 py-3 hover:bg-zinc-50 transition-colors flex items-center gap-3" data-id="${m.id}">
      <div class="w-9 h-9 rounded-full ${bg} flex items-center justify-center flex-shrink-0 relative">
        <span class="text-[11px] font-semibold ${text}">${escapeHtml(initials)}</span>
        ${m.active ? '' : '<span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-zinc-300 border-2 border-white" title="Inaktív"></span>'}
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-[13px] font-semibold text-zinc-900 truncate">${escapeHtml(m.name || '(nincs név)')}</p>
        <p class="text-[11px] text-zinc-500 truncate">${escapeHtml(m.email || '(nincs email)')}</p>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button class="row-edit p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
          title="Szerkesztés">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button class="row-delete p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50"
          title="Törlés">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </li>
  `;
}

function renderToast(toast: NonNullable<MembersState['toast']>): string {
  const palette =
    toast.kind === 'success'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : 'bg-red-50 border-red-200 text-red-800';
  return `
    <div id="toast" class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl border shadow-lg ${palette} text-[12px] font-medium animate-pulse-once">
      ${escapeHtml(toast.msg)}
    </div>
  `;
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
    setTimeout(() => {
      state.toast = null;
      rerender(container, state);
    }, 2500);
  }
}

function attachBodyHandlers(container: HTMLElement, state: MembersState) {
  // Add toggle
  const addToggle = container.querySelector<HTMLButtonElement>('#add-toggle');
  addToggle?.addEventListener('click', () => {
    state.addOpen = !state.addOpen;
    rerender(container, state);
  });

  // Save new
  container.querySelector<HTMLButtonElement>('#new-save')?.addEventListener('click', async () => {
    const name = (container.querySelector<HTMLInputElement>('#new-name')?.value ?? '').trim();
    const email = (container.querySelector<HTMLInputElement>('#new-email')?.value ?? '').trim();
    const active = container.querySelector<HTMLInputElement>('#new-active')?.checked ?? true;

    if (!name) {
      state.toast = { kind: 'error', msg: 'A név megadása kötelező.' };
      rerender(container, state);
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      state.toast = { kind: 'error', msg: 'Érvénytelen email cím.' };
      rerender(container, state);
      return;
    }
    try {
      await addMember({ name, email, active });
      state.members = await getAllMembers();
      state.addOpen = false;
      state.toast = { kind: 'success', msg: `✅ ${name} hozzáadva.` };
      rerender(container, state);
    } catch (e) {
      state.toast = { kind: 'error', msg: `Hiba: ${String(e)}` };
      rerender(container, state);
    }
  });

  // Row edit / delete
  container.querySelectorAll<HTMLLIElement>('[data-id]').forEach((li) => {
    const id = li.dataset.id!;

    li.querySelector<HTMLButtonElement>('.row-edit')?.addEventListener('click', () => {
      state.editingId = id;
      rerender(container, state);
    });

    li.querySelector<HTMLButtonElement>('.row-delete')?.addEventListener('click', async () => {
      const m = state.members.find((x) => x.id === id);
      if (!m) return;
      if (!confirm(`Biztosan törlöd? \n\n${m.name} (${m.email})`)) return;
      try {
        await deleteMember(id);
        state.members = state.members.filter((x) => x.id !== id);
        state.toast = { kind: 'success', msg: `🗑️ ${m.name} törölve.` };
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
        rerender(container, state);
        return;
      }
      if (email && !EMAIL_REGEX.test(email)) {
        state.toast = { kind: 'error', msg: 'Érvénytelen email cím.' };
        rerender(container, state);
        return;
      }
      try {
        await updateMember(id, { name, email, active });
        const m = state.members.find((x) => x.id === id);
        if (m) {
          m.name = name;
          m.email = email;
          m.active = active;
        }
        state.editingId = null;
        state.toast = { kind: 'success', msg: '✅ Mentve.' };
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
