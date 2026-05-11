import './style.css';
import { db } from './lib/firebase';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
      <div class="text-6xl mb-4">🏐</div>
      <h1 class="text-3xl font-bold text-zinc-900 mb-2">Röpi App v2</h1>
      <p class="text-zinc-500 mb-6">HTML + TypeScript + Tailwind + Firebase</p>
      <div class="space-y-2 text-sm">
        <div class="flex items-center justify-between py-2 px-3 bg-zinc-50 rounded-lg">
          <span class="text-zinc-600">Vite</span>
          <span class="text-emerald-600 font-medium">✓ kész</span>
        </div>
        <div class="flex items-center justify-between py-2 px-3 bg-zinc-50 rounded-lg">
          <span class="text-zinc-600">TypeScript</span>
          <span class="text-emerald-600 font-medium">✓ kész</span>
        </div>
        <div class="flex items-center justify-between py-2 px-3 bg-zinc-50 rounded-lg">
          <span class="text-zinc-600">Tailwind CSS</span>
          <span class="text-emerald-600 font-medium">✓ kész</span>
        </div>
        <div class="flex items-center justify-between py-2 px-3 bg-zinc-50 rounded-lg">
          <span class="text-zinc-600">Firebase SDK</span>
          <span id="fb-status" class="text-amber-600 font-medium">⏳ config kell</span>
        </div>
      </div>
      <p class="mt-6 text-xs text-zinc-400">
        Fázis 0 kész — most jöhet a Firebase config és Claude Design.
      </p>
    </div>
  </div>
`;

// Firebase config ellenőrzés
if (import.meta.env.VITE_FIREBASE_PROJECT_ID) {
  const status = document.querySelector('#fb-status');
  if (status) {
    status.textContent = `✓ ${db.app.options.projectId}`;
    status.className = 'text-emerald-600 font-medium';
  }
}
