/**
 * Dátum segédfüggvények — Tuesday alkalmak generálása, parsing.
 * Logika 1:1 a Python `modules/utils.py`-ból.
 */

const HUNGARY_TZ = 'Europe/Budapest';

/** Mai dátum Magyarország időzónájában (YYYY-MM-DD) */
export function todayInHungary(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: HUNGARY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // pl. "2026-05-11"
}

/** A megadott YYYY-MM-DD dátum hét napja: 0=vasárnap, 1=hétfő, ..., 2=kedd, ... */
export function weekdayOf(dateStr: string): number {
  // ISO formátum: Date konstruktor UTC-ben értelmezi, de a getDay() lokális.
  // A dátumstringeket UTC-ben dolgozzuk: 12:00 UTC-vel hozzuk létre hogy ne legyen időzóna gond
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.getUTCDay();
}

/** Adott dátumhoz hozzáad / kivon napokat (YYYY-MM-DD bemenet és kimenet) */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Generál Tuesday dátumokat: `pastCount` múltbeli + `futureCount` jövőbeli.
 * Visszatérés: kronológikus sorrendben (legrégebbi → legújabb).
 */
export function generateTuesdayDates(pastCount = 8, futureCount = 1): string[] {
  const today = todayInHungary();
  const todayWeekday = weekdayOf(today); // 2 = kedd

  // "days_since_tuesday = (today.weekday() - 1) % 7" Python-ban (Monday=0, Tuesday=1)
  // JS-ben Sunday=0, Tuesday=2 → kompenzálunk: (todayWeekday - 2 + 7) % 7
  const daysSinceTuesday = (todayWeekday - 2 + 7) % 7;
  const lastTuesday = addDays(today, -daysSinceTuesday);

  const result: string[] = [];
  for (let i = pastCount - 1; i >= 0; i--) {
    result.push(addDays(lastTuesday, -7 * i));
  }
  for (let i = 1; i <= futureCount; i++) {
    result.push(addDays(lastTuesday, 7 * i));
  }
  return result;
}

/** A jelenlegi "soron következő" alkalom (ma ha kedd, egyébként a jövőbeli) */
export function upcomingTuesday(dates: string[]): string {
  const today = todayInHungary();
  const isTuesday = weekdayOf(today) === 2;
  if (isTuesday && dates.includes(today)) return today;
  return dates[dates.length - 1];
}

/** Magyar formátum: "2026. máj. 11. (kedd)" */
export function formatDateHu(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return new Intl.DateTimeFormat('hu-HU', {
    timeZone: HUNGARY_TZ,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}
