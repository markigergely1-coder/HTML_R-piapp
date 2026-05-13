/**
 * PWA service worker életciklus kezelés.
 *
 * Ha új verzió van deployolva, megjelenik egy toast: "Új verzió elérhető".
 * Kattintáskor frissítjük az SW-t és újratöltjük az oldalt.
 */

import { registerSW } from 'virtual:pwa-register';

export function setupPwa(): void {
  let toast: HTMLDivElement | null = null;

  const showUpdateToast = (onClick: () => void) => {
    if (toast) return;
    toast = document.createElement('div');
    toast.style.cssText = [
      'position:fixed',
      'left:50%',
      'transform:translateX(-50%)',
      'bottom:24px',
      'z-index:100',
      'background:#18181b',
      'color:#fff',
      'padding:10px 14px 10px 16px',
      'border-radius:9999px',
      'box-shadow:0 6px 24px rgba(0,0,0,0.20)',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'font-family:Inter, system-ui, sans-serif',
      'font-size:12.5px',
      'font-weight:600',
      'max-width:90vw',
      'animation:slideUpToast 320ms cubic-bezier(0.22, 1, 0.36, 1)',
    ].join(';');
    toast.innerHTML = `
      <span>🔄 Új verzió elérhető</span>
      <button id="pwa-reload" style="
        background:#ef4444;color:#fff;border:none;
        border-radius:9999px;padding:6px 12px;font-weight:700;
        font-size:11.5px;cursor:pointer;font-family:inherit">
        Frissítés
      </button>
    `;

    // Animáció keyframe
    if (!document.getElementById('pwa-toast-style')) {
      const style = document.createElement('style');
      style.id = 'pwa-toast-style';
      style.textContent = `
        @keyframes slideUpToast {
          from { transform: translate(-50%, 30px); opacity: 0; }
          to   { transform: translate(-50%, 0);     opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    toast.querySelector<HTMLButtonElement>('#pwa-reload')?.addEventListener('click', () => {
      onClick();
    });
  };

  const updateSW = registerSW({
    onNeedRefresh() {
      showUpdateToast(() => {
        updateSW(true); // skip waiting + reload
      });
    },
    onOfflineReady() {
      // Lehetne egy "kész offline használatra" toast, de a többség ezt nem érti.
      // Csendben hagyjuk.
      console.log('[pwa] Offline ready');
    },
  });
}
