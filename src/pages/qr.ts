/**
 * 📲 Check-in QR oldal.
 * - Nagy QR kód (canvas-re renderelve a `qrcode` package-gel)
 * - Check-in link + másol/megnyit gomb
 * - "Nyomtatás" gomb (csak a QR-t mutatja oldalfeltöltés nélkül)
 */

import QRCode from 'qrcode';
import { renderHeader } from '../components/header';

// Tudatosan a checkin.html-re mutat (GitHub Pages-en él) — a régi Streamlit
// `qr_page.py` is ezt használja default-ként.
const CHECKIN_URL = 'https://markigergely1-coder.github.io/ropi-app/checkin.html';

export async function renderQrPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();
  attachHandlers(container);

  // QR kód kanvasra
  const canvas = container.querySelector<HTMLCanvasElement>('#qr-canvas')!;
  await QRCode.toCanvas(canvas, CHECKIN_URL, {
    width: 320,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#18181b', // zinc-900
      light: '#ffffff',
    },
  });
}

function renderShell(): string {
  return `
    <div class="bg-zinc-50 min-h-screen pb-12 print:bg-white">
      <div class="max-w-md mx-auto">
        <div class="print:hidden">${renderHeader('qr')}</div>
        <main class="px-4 py-6 space-y-4">

          <!-- QR kód kártya -->
          <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 flex flex-col items-center print:border-0 print:shadow-none print:p-2">
            <div class="text-center mb-4 print:mb-2">
              <p class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider print:text-zinc-700">📲 Check-in</p>
              <p class="text-[20px] font-bold text-zinc-900 mt-1">Olvasd be a kamerával</p>
            </div>
            <div class="bg-white p-2 rounded-2xl border border-zinc-100">
              <canvas id="qr-canvas" class="block max-w-full"></canvas>
            </div>
            <p class="text-[12px] text-zinc-500 mt-4 text-center print:hidden">
              Vagy nyomtasd ki és tedd ki a terembe 🏐
            </p>
          </div>

          <!-- Link kártya -->
          <div class="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 print:hidden">
            <p class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Check-in link</p>
            <div class="bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2.5 mb-3 break-all font-mono text-[11px] text-zinc-700 select-all">
              ${CHECKIN_URL}
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button id="copy-btn"
                class="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[13px] font-semibold transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span id="copy-label">Másolás</span>
              </button>
              <a href="${CHECKIN_URL}" target="_blank" rel="noopener"
                class="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Megnyitás
              </a>
            </div>
          </div>

          <!-- Akciók -->
          <div class="grid grid-cols-1 gap-2 print:hidden">
            <button id="print-btn"
              class="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-[13px] font-semibold transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Nyomtatás
            </button>
          </div>

          <!-- Tipp -->
          <div class="bg-sky-50 border border-sky-100 rounded-xl p-4 print:hidden">
            <p class="text-[12px] text-sky-900">
              <span class="font-semibold">Tipp:</span>
              Az edzés helyszínén tartsd nyitva ezt az oldalt, vagy nyomtasd ki a QR kódot
              és tedd ki a falra — a tagok a saját mobiljukkal beszkennelve egyetlen érintéssel
              regisztrálhatnak.
            </p>
          </div>

        </main>
      </div>
    </div>
  `;
}

function attachHandlers(container: HTMLElement) {
  const copyBtn = container.querySelector<HTMLButtonElement>('#copy-btn');
  const copyLabel = container.querySelector<HTMLSpanElement>('#copy-label');
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(CHECKIN_URL);
      if (copyLabel) {
        copyLabel.textContent = '✓ Másolva';
        setTimeout(() => {
          if (copyLabel) copyLabel.textContent = 'Másolás';
        }, 1800);
      }
    } catch {
      // Fallback: select-and-copy a textarea-val
      const ta = document.createElement('textarea');
      ta.value = CHECKIN_URL;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (copyLabel) copyLabel.textContent = '✓ Másolva';
    }
  });

  const printBtn = container.querySelector<HTMLButtonElement>('#print-btn');
  printBtn?.addEventListener('click', () => window.print());
}
