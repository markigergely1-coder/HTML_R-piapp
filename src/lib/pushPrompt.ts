/**
 * Auto-prompt: ha a felhasználó telepítette a PWA-t és még nem engedélyezett
 * push értesítést, az első indításnál (vagy első bejelentkezésnél) felugrik
 * egy modal, ami megkérdezi engedélyezi-e.
 *
 * Logika:
 * - Csak installed PWA-ban (display-mode: standalone) jelenjen meg
 * - Csak ha be van jelentkezve
 * - Csak ha még nincs push subscription
 * - Csak ha még nem kérdeztük meg (localStorage flag)
 *
 * Bárhol az appban megjelenik (overlay, nem oldal-szintű).
 */

import { onAuthChange } from './auth';
import { isPushSupported, subscribeToPush, getMySubscriptions, currentPermission } from './notifications';
import { getMemberByEmail } from './firestore';

const PROMPTED_KEY = 'ropi-push-prompted';

function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS-en navigator.standalone is van, asztali / Android: matchMedia
  const standaloneIOS = (window.navigator as { standalone?: boolean }).standalone === true;
  const standaloneOther = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  return standaloneIOS || standaloneOther;
}

function hasBeenPrompted(): boolean {
  try {
    return localStorage.getItem(PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

function markPrompted(): void {
  try {
    localStorage.setItem(PROMPTED_KEY, '1');
  } catch {
    // ignore
  }
}

/**
 * Auth-állapot változásra figyelünk. Amint bejelentkezett a user, és telepített
 * PWA-ban vagyunk, megnézzük szükséges-e a prompt.
 */
export function setupAutoPushPrompt(): void {
  if (!isStandalonePWA()) return;        // csak PWA-ban
  if (hasBeenPrompted()) return;          // már kérdeztük
  if (currentPermission() !== 'default') return; // 'granted' v 'denied' — már döntött

  let dispatched = false;
  onAuthChange(async (state) => {
    if (state.loading || !state.user || dispatched) return;
    dispatched = true;

    // Várunk pár másodpercet, hogy ne ugorjon fel azonnal a betöltés alatt
    await new Promise((r) => setTimeout(r, 1500));

    try {
      if (!(await isPushSupported())) return;
      const email = state.user!.email ?? '';
      if (!email) return;
      const member = await getMemberByEmail(email);
      if (!member) return;
      const subs = await getMySubscriptions(member.id);
      if (subs.length > 0) return; // már fel van iratkozva
      // Most felhozzuk a kártyát
      showPrompt(member.id, email);
    } catch (err) {
      console.warn('[pushPrompt] check failed:', err);
    }
  });
}

function showPrompt(memberId: string, memberEmail: string): void {
  // Ha már van egy ilyen modal nyitva, ne csináljunk újat
  if (document.getElementById('push-auto-prompt')) return;

  const overlay = document.createElement('div');
  overlay.id = 'push-auto-prompt';
  overlay.className = 'fade-up';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    background: rgba(15,12,10,0.5);
    backdrop-filter: blur(10px) saturate(140%);
    -webkit-backdrop-filter: blur(10px) saturate(140%);
    animation-duration: 200ms;
  `;
  overlay.innerHTML = `
    <div class="card relative overflow-hidden" role="dialog" aria-modal="true"
      style="max-width:380px;width:100%;border-radius:24px;box-shadow:var(--shadow-lg);border:1px solid var(--line-strong)">
      <div class="p-6">
        <div class="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
             style="background:color-mix(in oklab,var(--accent) 14%,transparent)">
          <span style="font-size:36px;line-height:1">🔔</span>
        </div>
        <h3 class="text-[18px] font-semibold text-fg-1 text-center mb-2">Bekapcsolod az értesítéseket?</h3>
        <p class="text-[13px] text-fg-2 text-center leading-relaxed mb-5">
          Szólunk ha lemondják az edzést, és kedd reggelente emlékeztetünk
          ha még nem jelentkeztél. Bármikor kikapcsolhatod a Jelenlét tabon.
        </p>
        <div class="flex flex-col gap-2">
          <button id="push-auto-allow" type="button"
            class="w-full px-4 py-2.5 rounded-full text-white text-[14px] font-semibold transition-colors"
            style="background:var(--accent)">
            ✓ Engedélyezem
          </button>
          <button id="push-auto-deny" type="button"
            class="w-full px-4 py-2.5 rounded-full text-[14px] font-semibold transition-colors"
            style="background:var(--bg-elev);color:var(--fg-1);border:1px solid var(--line-strong)">
            Most nem
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 160ms';
    setTimeout(() => overlay.remove(), 180);
  };

  overlay.querySelector<HTMLButtonElement>('#push-auto-deny')?.addEventListener('click', () => {
    markPrompted();
    close();
  });

  overlay.querySelector<HTMLButtonElement>('#push-auto-allow')?.addEventListener('click', async () => {
    const btn = overlay.querySelector<HTMLButtonElement>('#push-auto-allow');
    const denyBtn = overlay.querySelector<HTMLButtonElement>('#push-auto-deny');
    if (btn) { btn.disabled = true; btn.textContent = 'Engedélykérés…'; btn.style.opacity = '0.6'; }
    if (denyBtn) denyBtn.disabled = true;
    markPrompted();
    try {
      const result = await subscribeToPush(memberId, memberEmail);
      if (result.ok) {
        if (btn) btn.textContent = '✓ Sikeres!';
        setTimeout(close, 800);
      } else {
        if (btn) {
          btn.textContent = `Hiba: ${result.error.split(':')[0]}`;
          btn.style.background = 'var(--danger)';
          btn.disabled = false;
        }
        setTimeout(close, 2500);
      }
    } catch (err) {
      console.warn('[pushPrompt] subscribe failed:', err);
      close();
    }
  });

  // Háttérre kattintás: tekintsük "Most nem"-nek
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      markPrompted();
      close();
    }
  });
}
