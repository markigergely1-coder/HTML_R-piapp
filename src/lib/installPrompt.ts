/**
 * PWA Telepítés Prompt — „App telepítése" gomb a site-on.
 *
 * Android / Chrome / Edge: a `beforeinstallprompt` API-val natív telepítő
 * dialógust tudunk megjeleníteni egy gombnyomásra.
 *
 * iOS Safari: az Apple NEM támogatja a beforeinstallprompt-ot, ezért
 * lépésről lépésre vizuális útmutatót mutatunk (Share → Add to Home Screen).
 *
 * A banner automatikusan eltűnik, ha:
 * - Már standalone PWA-ként fut
 * - A user korábban elutasította (localStorage flag, 14 napra)
 */

/* ── Típusok a Chrome-specifikus API-hoz ── */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
}

/* ── Globális state ── */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let bannerEl: HTMLDivElement | null = null;
let iosGuideEl: HTMLDivElement | null = null;

const DISMISS_KEY = 'pwa-install-dismissed';
const DISMISS_DAYS = 14;

/* ── Platform detection ── */
function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window as any).MSStream;
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true;
}

function isDismissed(): boolean {
  const ts = localStorage.getItem(DISMISS_KEY);
  if (!ts) return false;
  const elapsed = Date.now() - Number(ts);
  return elapsed < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

function dismiss(): void {
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
  hideBanner();
  hideIosGuide();
}

/* ── Banner: közös alap (Android + iOS) ── */

function createBanner(onInstallClick: () => void): HTMLDivElement {
  const el = document.createElement('div');
  el.id = 'pwa-install-banner';
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'transform:translateX(-50%) translateY(20px)',
    'bottom:24px',
    'z-index:9999',
    'background:var(--bg-card)',
    'border:1px solid var(--line)',
    'padding:12px 16px',
    'border-radius:18px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'font-family:Inter, system-ui, sans-serif',
    'max-width:calc(100vw - 32px)',
    'width:360px',
    'opacity:0',
    'transition:opacity 350ms ease, transform 350ms cubic-bezier(0.22,1,0.36,1)',
  ].join(';');

  el.innerHTML = `
    <div style="
      width:40px; height:40px; border-radius:12px; flex-shrink:0;
      background: linear-gradient(135deg, var(--accent) 0%, #14b8a6 100%);
      display:flex; align-items:center; justify-content:center;
    ">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14M19 12l-7 7-7-7"/>
      </svg>
    </div>
    <div style="flex:1; min-width:0;">
      <div style="font-size:13px; font-weight:700; color:var(--fg-1); line-height:1.2;">
        Röpi App telepítése
      </div>
      <div style="font-size:11px; color:var(--fg-3); margin-top:2px; line-height:1.3;">
        Gyorsabb indulás, offline mód
      </div>
    </div>
    <button id="pwa-install-btn" style="
      background:var(--accent); color:#fff; border:none; border-radius:12px;
      padding:8px 16px; font-weight:700; font-size:12px; cursor:pointer;
      font-family:inherit; white-space:nowrap; flex-shrink:0;
      transition: background 180ms ease, transform 120ms ease;
    ">Telepítés</button>
    <button id="pwa-install-close" style="
      background:none; border:none; cursor:pointer; padding:4px;
      color:var(--fg-3); flex-shrink:0; line-height:1;
      transition: color 180ms ease;
    " title="Bezárás" aria-label="Bezárás">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
  `;

  document.body.appendChild(el);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
  });

  // Event listeners
  el.querySelector('#pwa-install-btn')!.addEventListener('click', onInstallClick);
  el.querySelector('#pwa-install-close')!.addEventListener('click', dismiss);

  return el;
}

function hideBanner(): void {
  if (!bannerEl) return;
  bannerEl.style.opacity = '0';
  bannerEl.style.transform = 'translateX(-50%) translateY(20px)';
  setTimeout(() => {
    bannerEl?.remove();
    bannerEl = null;
  }, 400);
}

/* ── iOS útmutató overlay ── */

function showIosGuide(): void {
  if (iosGuideEl) return;

  const el = document.createElement('div');
  el.id = 'pwa-ios-guide';
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:10000',
    'background:rgba(0,0,0,0.55)',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
    'display:flex',
    'align-items:flex-end',
    'justify-content:center',
    'padding:16px',
    'opacity:0',
    'transition:opacity 300ms ease',
  ].join(';');

  el.innerHTML = `
    <div style="
      background:var(--bg-card); border-radius:24px; padding:28px 24px 24px;
      width:100%; max-width:380px; box-shadow:0 20px 60px rgba(0,0,0,0.3);
      position:relative; animation: iosGuideSlideUp 400ms cubic-bezier(0.22,1,0.36,1) both;
    ">
      <button id="pwa-ios-close" style="
        position:absolute; top:14px; right:14px; background:var(--bg-elev);
        border:none; border-radius:50%; width:30px; height:30px; cursor:pointer;
        display:flex; align-items:center; justify-content:center;
        color:var(--fg-2); transition: background 180ms ease;
      " title="Bezárás" aria-label="Bezárás">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>

      <div style="text-align:center; margin-bottom:20px;">
        <div style="
          width:52px; height:52px; border-radius:16px; margin:0 auto 12px;
          background: linear-gradient(135deg, var(--accent) 0%, #14b8a6 100%);
          display:flex; align-items:center; justify-content:center;
        ">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="1.5">
            <circle cx="12" cy="12" r="9"/>
            <path d="M3 12c4.5-1.5 13.5-1.5 18 0"/>
            <path d="M12 3c-2.5 4.5-2.5 13.5 0 18"/>
            <path d="M12 3c2.5 4.5 2.5 13.5 0 18"/>
          </svg>
        </div>
        <div style="font-size:17px; font-weight:700; color:var(--fg-1); line-height:1.2;">
          Röpi App telepítése
        </div>
        <div style="font-size:12px; color:var(--fg-3); margin-top:4px;">
          Kövesd az alábbi 2 lépést
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:12px;">
        ${iosStep(1,
          `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>`,
          'Nyomd meg a <strong>Megosztás</strong> gombot',
          'Az alul lévő sávban (□↑ ikon)'
        )}
        ${iosStep(2,
          `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>`,
          'Válaszd: <strong>Főképernyőhöz adás</strong>',
          'Görgesd le a menüt ha nem látod'
        )}
      </div>

      <div style="
        margin-top:16px; padding:12px; border-radius:12px;
        background:color-mix(in oklab, var(--accent) 8%, var(--bg-elev));
        border:1px solid color-mix(in oklab, var(--accent) 20%, transparent);
        display:flex; align-items:center; gap:8px;
      ">
        <span style="font-size:16px;">💡</span>
        <span style="font-size:11px; color:var(--fg-2); line-height:1.4;">
          Ezután a Röpi App ikonként jelenik meg a kezdőképernyőn, mint egy igazi app!
        </span>
      </div>
    </div>
  `;

  // Animáció keyframe
  if (!document.getElementById('pwa-ios-guide-style')) {
    const style = document.createElement('style');
    style.id = 'pwa-ios-guide-style';
    style.textContent = `
      @keyframes iosGuideSlideUp {
        from { transform: translateY(40px); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(el);
  iosGuideEl = el;

  // Animate overlay in
  requestAnimationFrame(() => {
    el.style.opacity = '1';
  });

  // Close handlers
  el.querySelector('#pwa-ios-close')!.addEventListener('click', () => {
    dismiss();
  });
  el.addEventListener('click', (e) => {
    if (e.target === el) dismiss();
  });
}

function iosStep(num: number, icon: string, title: string, subtitle: string): string {
  return `
    <div style="
      display:flex; align-items:center; gap:12px;
      padding:14px; border-radius:14px;
      background:var(--bg-elev); border:1px solid var(--line);
    ">
      <div style="
        width:36px; height:36px; border-radius:10px; flex-shrink:0;
        background:color-mix(in oklab, var(--accent) 10%, var(--bg-card));
        display:flex; align-items:center; justify-content:center;
      ">
        ${icon}
      </div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:13px; font-weight:600; color:var(--fg-1); line-height:1.3;">
          <span style="
            display:inline-flex; align-items:center; justify-content:center;
            width:18px; height:18px; border-radius:50%; font-size:10px; font-weight:800;
            background:var(--accent); color:#fff; margin-right:6px; vertical-align:middle;
          ">${num}</span>
          ${title}
        </div>
        <div style="font-size:11px; color:var(--fg-3); margin-top:2px; line-height:1.3;">
          ${subtitle}
        </div>
      </div>
    </div>
  `;
}

function hideIosGuide(): void {
  if (!iosGuideEl) return;
  iosGuideEl.style.opacity = '0';
  setTimeout(() => {
    iosGuideEl?.remove();
    iosGuideEl = null;
  }, 350);
}

/* ── Android / Chrome: beforeinstallprompt kezelés ── */

async function handleAndroidInstall(): Promise<void> {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    hideBanner();
  }
  deferredPrompt = null;
}

/* ── iOS: guide megjelenítés ── */

function handleIosInstall(): void {
  hideBanner();
  showIosGuide();
}

/* ── Fő belépési pont ── */

export function setupInstallPrompt(): void {
  // Ha már standalone PWA-ként fut, nem kell semmi
  if (isStandalone()) return;

  // Ha nemrég elutasította, ne zavarjuk
  if (isDismissed()) return;

  // Android / Chrome: beforeinstallprompt eventben elkapjuk a promptot
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;

    // Kis késleltetéssel mutatjuk a bannert (ne az oldal betöltésekor rögtön)
    setTimeout(() => {
      if (!bannerEl) {
        bannerEl = createBanner(handleAndroidInstall);
      }
    }, 3000);
  });

  // Ha telepítette, elrejtjük
  window.addEventListener('appinstalled', () => {
    hideBanner();
    deferredPrompt = null;
  });

  // iOS: nincs beforeinstallprompt, magunktól mutatjuk a bannert
  if (isIos()) {
    setTimeout(() => {
      if (!bannerEl) {
        bannerEl = createBanner(handleIosInstall);
      }
    }, 4000);
  }
}
