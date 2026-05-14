/**
 * Téma kezelés — világos / sötét mód.
 *
 * Logika:
 *   - Ha a user explicit választott, azt használjuk (localStorage)
 *   - Egyébként a rendszer beállítása szerint (prefers-color-scheme)
 *
 * CSS-ben a `<html data-theme="dark">` attribútum alapján kapcsolunk.
 * Az `applyTheme()` ezt mindig szinkronban tartja.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ropi-theme';

function getSystemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** A jelenleg érvényes téma (user choice > rendszer). */
export function getCurrentTheme(): Theme {
  return getStoredTheme() ?? getSystemTheme();
}

/** Beállítja és perzisztálja a témát + DOM-ra alkalmazza. */
export function setTheme(t: Theme): void {
  try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
  applyTheme();
}

/** Light ↔ dark váltás. */
export function toggleTheme(): Theme {
  const next: Theme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** A jelenleg érvényes témát ráírja a `<html data-theme="…">`-ra. */
export function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', getCurrentTheme());
}

/** A rendszer-beállítás változására figyel (ha a user nem választott explicit). */
export function watchSystemTheme(): void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return;
  mq.addEventListener?.('change', () => {
    if (!getStoredTheme()) applyTheme();
  });
}
