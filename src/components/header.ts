/**
 * Osztott Header komponens — frosted glass sticky nav + tab navigáció + auth blokk.
 * Design: Claude Design / Röpi-app — glass, logo SVG, accent tab indicator.
 *
 * 10 tab horizontális scrollra van állítva mobilon. Az admin-only tabok csak
 * akkor jelennek meg, ha az aktuális user admin.
 */

import { getAuthState, signIn, signOut } from '../lib/auth';
import { getInitials } from '../lib/avatar';

export type PageKey =
  | 'overview'
  | 'profile'
  | 'database'
  | 'qr'
  | 'admin'
  | 'members'
  | 'accounting'
  | 'payments'
  | 'settings'
  | 'diagnostics';

interface TabDef {
  key: PageKey;
  label: string;
  href: string;
  adminOnly?: boolean;
}

const TABS: TabDef[] = [
  // Publikus
  { key: 'overview',    label: 'Alkalmak',    href: '#/' },
  { key: 'profile',     label: 'Profil',      href: '#/profile' },
  { key: 'database',    label: 'Adatbázis',   href: '#/database' },
  { key: 'qr',          label: 'QR',          href: '#/qr' },
  // Admin
  { key: 'admin',       label: 'Regisztráció', href: '#/admin',       adminOnly: true },
  { key: 'members',     label: 'Tagok',       href: '#/members',     adminOnly: true },
  { key: 'accounting',  label: 'Elszámolás',  href: '#/accounting',  adminOnly: true },
  { key: 'payments',    label: 'Befizetések', href: '#/payments',    adminOnly: true },
  { key: 'settings',    label: 'Kivételek',   href: '#/settings',    adminOnly: true },
  { key: 'diagnostics', label: 'Diagnosztika',href: '#/diagnostics', adminOnly: true },
];

const PAGE_LABEL: Record<PageKey, string> = {
  overview:    'Alkalmak',
  profile:     'Profil',
  database:    'Adatbázis',
  qr:          'Check-in',
  admin:       'Regisztráció',
  members:     'Tagok',
  accounting:  'Elszámolás',
  payments:    'Befizetések',
  settings:    'Kivételek',
  diagnostics: 'Diagnosztika',
};

export function renderHeader(currentPage: PageKey): string {
  const auth = getAuthState();
  const showAdminTabs = auth.isAdmin;

  const tabs = TABS.filter((t) => !t.adminOnly || showAdminTabs)
    .map((t) => {
      const active = t.key === currentPage;
      return `
        <a href="${t.href}"
           class="flex-none px-3 py-2.5 text-[13px] font-medium relative whitespace-nowrap"
           style="color: ${active ? 'var(--fg-1)' : 'var(--fg-3)'}">
          ${t.label}
          ${active ? `<span class="absolute left-3 right-3 bottom-0 h-[2px] rounded-full" style="background:var(--accent)"></span>` : ''}
        </a>`;
    })
    .join('');

  return `
    <div class="glass sticky top-0 z-30">
      <div class="px-5 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          ${renderLogo()}
          <div class="flex flex-col leading-none">
            <span class="text-[15px] font-semibold tracking-tight text-fg-1">Röpi</span>
            <span class="eyebrow text-[9px] mt-0.5">${PAGE_LABEL[currentPage]}</span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          ${renderAuthBlock()}
        </div>
      </div>
      <nav class="-mt-1">
        <div id="header-nav-scroller" class="flex gap-1 overflow-x-auto no-scrollbar px-3 pb-0.5">
          ${tabs}
        </div>
      </nav>
    </div>
  `;
}

function renderLogo(): string {
  return `
    <div class="w-8 h-8 rounded-[10px] flex items-center justify-center relative overflow-hidden"
         style="background: linear-gradient(135deg, var(--accent) 0%, #f97316 100%)">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="1.5">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12c4.5-1.5 13.5-1.5 18 0" />
        <path d="M12 3c-2.5 4.5-2.5 13.5 0 18" />
        <path d="M12 3c2.5 4.5 2.5 13.5 0 18" />
      </svg>
    </div>`;
}

function renderAuthBlock(): string {
  const auth = getAuthState();

  if (auth.loading) {
    return `<div class="w-8 h-8 rounded-full animate-pulse" style="background:var(--line)"></div>`;
  }

  if (!auth.user) {
    return `
      <button id="header-signin"
        class="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold transition-colors"
        style="background:var(--accent)">
        Bejelentkezés
      </button>`;
  }

  const name = auth.user.displayName || auth.user.email || '?';
  const initials = getInitials(name);
  const adminBadge = auth.isAdmin
    ? `<span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500" style="border:2px solid var(--bg-card)" title="Admin"></span>`
    : '';

  return `
    <div class="flex items-center gap-2 relative">
      <div class="relative" title="${escapeHtml(name)}">
        <div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold"
             style="background:color-mix(in oklab, var(--accent) 16%, transparent); color:var(--accent-ink)">
          ${escapeHtml(initials)}
        </div>
        ${adminBadge}
      </div>
      <button id="header-signout"
        class="text-[11px] font-medium text-fg-2 hover:text-fg-1 transition-colors">
        Kilépés
      </button>
    </div>`;
}

/**
 * Be kell hívni a render UTÁN, miután az `innerHTML` átment a DOM-ba.
 * Megjegyzés: a router globálisan kezeli a header-signin / header-signout
 * eseményeket event delegationnel, így ez most opcionális — de pages-ek
 * hívhatják, ha közvetlenebb DOM-szintű kötést akarnak.
 */
export function attachHeaderHandlers(container: HTMLElement) {
  container.querySelector<HTMLButtonElement>('#header-signin')?.addEventListener('click', async () => {
    try { await signIn(); } catch (e) { console.warn('Sign-in failed:', e); }
  });
  container.querySelector<HTMLButtonElement>('#header-signout')?.addEventListener('click', async () => {
    try { await signOut(); } catch (e) { console.warn('Sign-out failed:', e); }
  });

  // Az aktív tab automatikusan görgessen látható helyzetbe
  const scroller = container.querySelector<HTMLElement>('#header-nav-scroller');
  if (scroller) {
    const active = scroller.querySelector<HTMLAnchorElement>('a > span');
    const activeLink = active?.parentElement as HTMLAnchorElement | null;
    if (activeLink) {
      requestAnimationFrame(() => {
        const targetLeft = activeLink.offsetLeft - (scroller.offsetWidth - activeLink.offsetWidth) / 2;
        scroller.scrollTo({ left: Math.max(0, targetLeft), behavior: 'instant' });
      });
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
