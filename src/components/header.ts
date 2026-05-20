/**
 * Osztott Header komponens — frosted glass sticky nav + tab navigáció + auth blokk.
 * Design: Claude Design / Röpi-app — glass, logo SVG, accent tab indicator.
 *
 * 10 tab horizontális scrollra van állítva mobilon. Az admin-only tabok csak
 * akkor jelennek meg, ha az aktuális user admin.
 */

import { getAuthState, signIn, signOut } from '../lib/auth';
import { getInitials } from '../lib/avatar';
import { getCurrentTheme } from '../lib/theme';

export type PageKey =
  | 'overview'
  | 'profile'
  | 'me'
  | 'database'
  | 'yearly'
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
  visibility: 'always' | 'admin' | 'transient';
}

const TABS: TabDef[] = [
  // Mindenkinek (bejelentkezés nélkül is)
  { key: 'admin',       label: 'Regisztráció', href: '#/admin',       visibility: 'always' },
  { key: 'overview',    label: 'Alkalmak',    href: '#/',             visibility: 'always' },

  // Tranziens: csak akkor jelenik meg, ha az aktuális oldal ez
  { key: 'profile',     label: 'Profil',      href: '#/profile',     visibility: 'transient' },
  { key: 'me',          label: 'Saját',       href: '#/me',          visibility: 'transient' },

  // Admin only (logged-in non-admin nem látja)
  { key: 'database',    label: 'Adatbázis',   href: '#/database',    visibility: 'admin' },
  { key: 'yearly',      label: 'Statisztikák',href: '#/yearly',      visibility: 'admin' },
  { key: 'qr',          label: 'QR',          href: '#/qr',          visibility: 'admin' },
  { key: 'members',     label: 'Tagok',       href: '#/members',     visibility: 'admin' },
  { key: 'accounting',  label: 'Elszámolás',  href: '#/accounting',  visibility: 'admin' },
  { key: 'payments',    label: 'Befizetések', href: '#/payments',    visibility: 'admin' },
  { key: 'settings',    label: 'Beállítások', href: '#/settings',    visibility: 'admin' },
  { key: 'diagnostics', label: 'Diagnosztika',href: '#/diagnostics', visibility: 'admin' },
];

const PAGE_LABEL: Record<PageKey, string> = {
  overview:    'Alkalmak',
  profile:     'Profil',
  me:          'Saját',
  database:    'Adatbázis',
  yearly:      'Statisztikák',
  qr:          'Check-in',
  admin:       'Regisztráció',
  members:     'Tagok',
  accounting:  'Elszámolás',
  payments:    'Befizetések',
  settings:    'Beállítások',
  diagnostics: 'Diagnosztika',
};

export function renderHeader(currentPage: PageKey): string {
  const auth = getAuthState();
  const isAdmin = auth.isAdmin;

  const tabs = TABS.filter((t) => {
    if (t.visibility === 'always') return true;
    if (t.visibility === 'transient') return t.key === currentPage; // csak ha rajta vagyunk
    if (t.visibility === 'admin') return isAdmin;
    return false;
  })
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
        <a href="#/" class="flex items-center gap-2.5 no-underline" style="color:inherit;text-decoration:none" aria-label="Főoldal">
          ${renderLogo()}
          <div class="flex flex-col leading-none">
            <span class="text-[15px] font-semibold tracking-tight text-fg-1">Röpi</span>
            <span class="eyebrow text-[9px] mt-0.5">${PAGE_LABEL[currentPage]}</span>
          </div>
        </a>
        <div class="flex items-center gap-2">
          ${renderThemeToggle()}
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

function renderThemeToggle(): string {
  const isDark = getCurrentTheme() === 'dark';
  // Kattintáskor az ELLENKEZŐ módra vált, ezért a célállapot ikonját mutatjuk.
  const icon = isDark
    // Sun (váltás világosra)
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <circle cx="12" cy="12" r="4"/>
         <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
       </svg>`
    // Moon (váltás sötétre)
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
       </svg>`;
  const title = isDark ? 'Világos mód' : 'Sötét mód';
  return `
    <button id="header-theme-toggle" type="button"
      class="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
      style="background:var(--bg-elev);color:var(--fg-2);border:1px solid var(--line)"
      title="${title}" aria-label="${title}">
      ${icon}
    </button>`;
}

function renderLogo(): string {
  return `
    <div class="w-8 h-8 rounded-[10px] flex items-center justify-center relative overflow-hidden"
         style="background: linear-gradient(135deg, var(--accent) 0%, #14b8a6 100%)">
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
      <a href="#/me" id="header-avatar-link" class="relative no-underline" title="Saját — ${escapeHtml(name)}" aria-label="Saját oldal">
        <div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold transition-transform hover:scale-105"
             style="background:color-mix(in oklab, var(--accent) 16%, transparent); color:var(--accent-ink)">
          ${escapeHtml(initials)}
        </div>
        ${adminBadge}
      </a>
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
