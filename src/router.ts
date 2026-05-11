/**
 * Minimális hash-alapú router.
 * Útvonalak: `#/` → overview, `#/profile` → profile.
 */

import { renderOverviewPage } from './pages/overview';
import { renderProfilePage } from './pages/profile';
import { renderQrPage } from './pages/qr';

type Route = {
  pattern: RegExp;
  render: (container: HTMLElement) => Promise<void> | void;
};

const ROUTES: Route[] = [
  { pattern: /^#?\/?$/, render: renderOverviewPage },
  { pattern: /^#?\/profile\/?$/, render: renderProfilePage },
  { pattern: /^#?\/qr\/?$/, render: renderQrPage },
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
        <div class="min-h-screen flex items-center justify-center p-6">
          <div class="text-center">
            <p class="text-zinc-500 text-sm mb-2">Az oldal nem található</p>
            <a href="#/" class="text-brand-600 hover:text-brand-700 underline">Vissza a főoldalra</a>
          </div>
        </div>`;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (err) {
    container.innerHTML = `
      <div class="min-h-screen flex items-center justify-center p-6">
        <div class="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div class="text-5xl mb-4">⚠️</div>
          <h1 class="text-xl font-bold text-zinc-900 mb-2">Hiba történt</h1>
          <pre class="text-xs text-red-600 text-left bg-red-50 p-3 rounded-lg overflow-auto whitespace-pre-wrap">${String(err)}</pre>
        </div>
      </div>`;
  }
}

export function startRouter(container: HTMLElement) {
  window.addEventListener('hashchange', () => dispatch(container));
  dispatch(container);
}
