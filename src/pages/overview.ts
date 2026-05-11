/**
 * Alkalmak Áttekintése oldal.
 * - Tuesday alkalmak dropdown-ja
 * - Kiválasztott alkalomra: létszám + résztvevők névsora
 */

import { generateTuesdayDates, upcomingTuesday, formatDateHu } from '../lib/dates';
import { getConfirmedAttendees, getCancelledSessions } from '../lib/firestore';

export async function renderOverviewPage(container: HTMLElement): Promise<void> {
  const dates = generateTuesdayDates(8, 1);
  const cancelled = await getCancelledSessions();
  const upcoming = upcomingTuesday(dates);

  container.innerHTML = `
    <div class="min-h-screen bg-zinc-50">
      <header class="bg-white border-b border-zinc-200">
        <div class="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <span class="text-2xl">🏐</span>
          <h1 class="text-lg font-semibold text-zinc-900">Alkalmak Áttekintése</h1>
        </div>
      </header>

      <main class="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <section class="bg-white rounded-2xl shadow-sm border border-zinc-200 p-5">
          <label for="date-select" class="block text-sm font-medium text-zinc-700 mb-2">
            Válassz egy alkalmat
          </label>
          <select id="date-select"
            class="w-full rounded-xl border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
            ${dates
              .slice()
              .reverse() // legújabb előre
              .map((d) => {
                const isUpcoming = d === upcoming;
                const isCancelled = cancelled.has(d);
                const prefix = isUpcoming ? '📌 ' : isCancelled ? '❌ ' : '';
                const suffix = isCancelled ? ' (lemondva)' : '';
                return `<option value="${d}" ${isUpcoming ? 'selected' : ''}>${prefix}${formatDateHu(d)}${suffix}</option>`;
              })
              .join('')}
          </select>
        </section>

        <section id="result" class="bg-white rounded-2xl shadow-sm border border-zinc-200 p-5 min-h-[200px]">
          <div class="flex items-center justify-center h-32 text-zinc-400 text-sm">
            Betöltés...
          </div>
        </section>
      </main>
    </div>
  `;

  const select = container.querySelector<HTMLSelectElement>('#date-select')!;
  const resultEl = container.querySelector<HTMLElement>('#result')!;

  async function refresh() {
    const selected = select.value;
    resultEl.innerHTML = `
      <div class="flex items-center justify-center h-32 text-zinc-400 text-sm">
        Adatok betöltése...
      </div>`;

    try {
      if (cancelled.has(selected)) {
        resultEl.innerHTML = `
          <div class="text-center py-8">
            <div class="text-5xl mb-3">❌</div>
            <h2 class="text-lg font-semibold text-zinc-900 mb-1">Lemondott alkalom</h2>
            <p class="text-sm text-zinc-500">Erre a dátumra a tréning törölve lett.</p>
          </div>`;
        return;
      }

      const attendees = await getConfirmedAttendees(selected);
      const count = attendees.length;

      if (count === 0) {
        resultEl.innerHTML = `
          <div class="text-center py-8">
            <div class="text-5xl mb-3">😶</div>
            <h2 class="text-lg font-semibold text-zinc-900 mb-1">Nincs regisztráció</h2>
            <p class="text-sm text-zinc-500">Erre az alkalomra még senki sem jelentkezett.</p>
          </div>`;
        return;
      }

      const cols = attendees
        .map(
          (name) => `
        <li class="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-zinc-50">
          <span class="text-emerald-500">✓</span>
          <span class="text-zinc-800">${escapeHtml(name)}</span>
        </li>`,
        )
        .join('');

      resultEl.innerHTML = `
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-zinc-900">Résztvevők</h2>
          <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-sm font-medium">
            ${count} fő
          </span>
        </div>
        <ul class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">${cols}</ul>
      `;
    } catch (err) {
      resultEl.innerHTML = `
        <div class="text-center py-8">
          <div class="text-5xl mb-3">⚠️</div>
          <h2 class="text-lg font-semibold text-zinc-900 mb-1">Hiba történt</h2>
          <p class="text-sm text-red-600">${escapeHtml(String(err))}</p>
        </div>`;
    }
  }

  select.addEventListener('change', refresh);
  await refresh();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
