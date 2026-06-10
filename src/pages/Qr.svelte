<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import Header from '../components/Header.svelte';

  const CHECKIN_URL = 'https://markigergely1-coder.github.io/ropi-app/checkin.html';

  let canvas: HTMLCanvasElement | undefined = $state();
  let copyLabel = $state('Másolás');

  onMount(() => {
    if (canvas) {
      QRCode.toCanvas(canvas, CHECKIN_URL, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#18181b', // zinc-900
          light: '#ffffff',
        },
      }).catch(console.error);
    }
  });

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(CHECKIN_URL);
      copyLabel = '✓ Másolva';
      setTimeout(() => {
        copyLabel = 'Másolás';
      }, 1800);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = CHECKIN_URL;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copyLabel = '✓ Másolva';
      setTimeout(() => {
        copyLabel = 'Másolás';
      }, 1800);
    }
  }

  function handlePrint() {
    window.print();
  }
</script>

<div class="device print:!max-w-none print:!shadow-none print:!border-0">
  <div class="print:hidden">
    <Header currentPage="qr" />
  </div>
  <main class="px-5 pt-5 pb-12 space-y-4">
    <!-- QR kód kártya -->
    <div class="card p-6 flex flex-col items-center print:border-0 print:shadow-none print:p-2" style="border-radius:24px">
      <div class="text-center mb-4 print:mb-2">
        <p class="eyebrow text-[10px] print:text-zinc-700">📲 Check-in</p>
        <p class="text-[20px] font-bold text-fg-1 mt-1">Olvasd be a kamerával</p>
      </div>
      <div class="bg-white p-2 rounded-2xl" style="border:1px solid var(--line)">
        <canvas bind:this={canvas} class="block max-w-full"></canvas>
      </div>
      <p class="text-[12px] text-fg-3 mt-4 text-center print:hidden">
        Vagy nyomtasd ki és tedd ki a terembe 🏐
      </p>
    </div>

    <!-- Link kártya -->
    <div class="card p-4 print:hidden" style="border-radius:20px">
      <p class="eyebrow text-[10px] mb-2">Check-in link</p>
      <div class="rounded-lg px-3 py-2.5 mb-3 break-all font-mono-tnum text-[11px] select-all"
           style="background:var(--bg-elev); border:1px solid var(--line); color:var(--fg-2)">
        {CHECKIN_URL}
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button onclick={handleCopy}
          class="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
          style="background:var(--bg-elev); color:var(--fg-2)"
          aria-label="Másolás">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span>{copyLabel}</span>
        </button>
        <a href={CHECKIN_URL} target="_blank" rel="noopener"
          class="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-white text-[13px] font-semibold transition-colors"
          style="background:var(--accent)">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Megnyitás
        </a>
      </div>
    </div>

    <!-- Akciók -->
    <div class="grid grid-cols-1 gap-2 print:hidden">
      <button onclick={handlePrint}
        class="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold transition-colors"
        style="background:var(--bg-card); border:1px solid var(--line); color:var(--fg-2)"
        aria-label="Nyomtatás">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
        </svg>
        Nyomtatás
      </button>
    </div>

    <!-- Tipp -->
    <div class="card-soft p-4 print:hidden" style="border-radius:16px">
      <p class="text-[12px] text-fg-2">
        <span class="font-semibold text-fg-1">Tipp:</span>
        Az edzés helyszínén tartsd nyitva ezt az oldalt, vagy nyomtasd ki a QR kódot
        és tedd ki a falra — a tagok a saját mobiljukkal beszkennelve egyetlen érintéssel
        regisztrálhatnak.
      </p>
    </div>
  </main>
</div>
