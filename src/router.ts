/**
 * Minimális hash-alapú router.
 * Útvonalak:
 *   #/         → overview
 *   #/profile  → profile
 *   #/qr       → qr
 *   #/members  → members (admin)
 *
 * Auth state változására (sign-in/out) automatikusan újraindítja a dispatch-et,
 * így az aktuális oldal frissül (pl. members oldal feloldódik admin login után).
 */

import { renderOverviewPage } from './pages/overview';
import { renderProfilePage } from './pages/profile';
import { renderQrPage } from './pages/qr';
import { renderMembersPage } from './pages/members';
import { renderDatabasePage } from './pages/database';
import { renderAdminPage } from './pages/admin';
import { renderSettingsPage } from './pages/settings';
import { renderDiagnosticsPage } from './pages/diagnostics';
import { renderAccountingPage } from './pages/accounting';
import { renderPaymentsPage } from './pages/payments';
import { onAuthChange, signIn, signOut } from './lib/auth';

type Route = {
  pattern: RegExp;
  render: (container: HTMLElement) => Promise<void> | void;
};

const ROUTES: Route[] = [
  // Publikus
  { pattern: /^#?\/?$/,             render: renderOverviewPage },
  { pattern: /^#?\/profile\/?$/,    render: renderProfilePage },
  { pattern: /^#?\/database\/?$/,   render: renderDatabasePage },
  { pattern: /^#?\/qr\/?$/,         render: renderQrPage },
  // Admin
  { pattern: /^#?\/admin\/?$/,       render: renderAdminPage },
  { pattern: /^#?\/members\/?$/,     render: renderMembersPage },
  { pattern: /^#?\/accounting\/?$/,  render: renderAccountingPage },
  { pattern: /^#?\/payments\/?$/,    render: renderPaymentsPage },
  { pattern: /^#?\/settings\/?$/,    render: renderSettingsPage },
  { pattern: /^#?\/diagnostics\/?$/, render: renderDiagnosticsPage },
];

function currentHash(): string {
  return window.location.hash || '#/';
}

async function dispatch(container: HTMLElement) {
  const hash = currentHash();
  const route = ROUTES.find((r) => r.pattern.test(hash));
  try {
    if (route) {
      await route.render(container);
    } else {
      container.innerHTML = `
        <div class="device">
          <div class="px-5 pt-16 pb-12 text-center fade-up">
            <div class="text-5xl mb-3">🔍</div>
            <p class="text-[16px] font-semibold text-fg-1 mb-1">Az oldal nem található</p>
            <a href="#/" class="text-[13px] font-semibold" style="color:var(--accent)">← Vissza a főoldalra</a>
          </div>
        </div>`;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (err) {
    container.innerHTML = `
      <div class="device">
        <div class="px-5 pt-12 pb-12">
          <div class="card-soft p-6 text-center" style="border-radius:24px">
            <div class="text-4xl mb-3">⚠️</div>
            <p class="text-[15px] font-semibold text-fg-1 mb-2">Hiba történt</p>
            <pre class="text-[11px] text-left p-3 rounded-lg overflow-auto whitespace-pre-wrap font-mono-tnum"
                 style="background:var(--bg-elev);color:var(--accent-ink);max-height:300px">${String(err)}</pre>
          </div>
        </div>
      </div>`;
  }
}

export function startRouter(container: HTMLElement) {
  window.addEventListener('hashchange', () => dispatch(container));

  // Globális event delegation a header auth-gombokra.
  // A container stabil — csak az innerHTML cserélődik a renderek között,
  // így ez a listener egyszer ráül és minden re-render után működik.
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#header-signin')) {
      signIn().catch((err) => console.warn('Sign-in failed:', err));
    } else if (target.closest('#header-signout')) {
      signOut().catch((err) => console.warn('Sign-out failed:', err));
    }
  });

  // Az első auth state változás után, illetve minden további
  // bejelentkezésnél/kijelentkezésnél újra dispatch-elünk.
  // A loading -> resolved átmenet is itt fut le, így a header is frissül.
  let initialized = false;
  let lastUserId: string | null = null;
  onAuthChange((state) => {
    if (state.loading) return;
    const currentUserId = state.user?.uid ?? null;
    if (!initialized) {
      initialized = true;
      lastUserId = currentUserId;
      dispatch(container);
      return;
    }
    if (currentUserId !== lastUserId) {
      lastUserId = currentUserId;
      dispatch(container);
    }
  });

  // Fallback: ha valamiért nem fut le az auth callback gyorsan,
  // egyszer mégis renderelünk (loading state mellett)
  setTimeout(() => {
    if (!initialized) {
      initialized = true;
      dispatch(container);
    }
  }, 500);
}
