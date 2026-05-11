import './style.css';
import { renderOverviewPage } from './pages/overview';

const app = document.querySelector<HTMLDivElement>('#app')!;

// Egyelőre csak egy oldal van — később router jön.
renderOverviewPage(app).catch((err) => {
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-6">
      <div class="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div class="text-5xl mb-4">⚠️</div>
        <h1 class="text-xl font-bold text-zinc-900 mb-2">Hiba történt</h1>
        <pre class="text-xs text-red-600 text-left bg-red-50 p-3 rounded-lg overflow-auto">${String(err)}</pre>
      </div>
    </div>`;
});
