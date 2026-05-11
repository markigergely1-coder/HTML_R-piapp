/**
 * Osztott Header komponens — sticky brand + tab navigáció.
 */

export type PageKey = 'overview' | 'profile';

const TABS: { key: PageKey; label: string; href: string }[] = [
  { key: 'overview', label: 'Alkalmak', href: '#/' },
  { key: 'profile', label: 'Profil', href: '#/profile' },
];

export function renderHeader(currentPage: PageKey): string {
  const tabs = TABS.map((t) => {
    const active = t.key === currentPage;
    const classes = active
      ? 'text-brand-700 border-brand-600'
      : 'text-zinc-500 border-transparent hover:text-zinc-700 hover:border-zinc-300';
    return `
      <a href="${t.href}"
         class="px-4 py-3 text-[13px] font-semibold border-b-2 transition-colors ${classes}">
        ${t.label}
      </a>`;
  }).join('');

  return `
    <div class="bg-white sticky top-0 z-20">
      <header class="border-b border-zinc-200">
        <div class="px-4 py-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xl" aria-hidden="true">🏐</span>
            <span class="text-[15px] font-semibold text-zinc-900">Röpi</span>
          </div>
          <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">
            ${currentPage === 'profile' ? 'Profil' : 'Alkalmak'}
          </span>
        </div>
      </header>
      <nav class="border-b border-zinc-200">
        <div class="px-2 flex">
          ${tabs}
        </div>
      </nav>
    </div>
  `;
}
