/**
 * Konstansok — szinkronban a Python `modules/config.py`-vel.
 */

export const TOLERANCE = 500; // Ft, befizetés-egyezés tűréshatár

/** Fő tagnévlista (Python MAIN_NAME_LIST 1:1) — rendezve. */
export const MAIN_NAME_LIST: string[] = [
  'Anna Sengler', 'Annamária Földváry', 'Áron Szabó', 'Boti',
  'Csanád Laczkó', 'Csenge Domokos', 'Detti Szabó', 'Domokos Kadosa',
  'Dóri Békási', 'Flóra', 'Gergely Márki', 'Kilyénfalvi Júlia',
  'Laci Márki', 'Laura Piski', 'Lea Plank', 'Linda Antal',
  'Máté Lajer', 'Máté Plank', 'Márki Jancsi', 'Nóri Sásdi',
  'Océane Olivier',
].sort((a, b) => a.localeCompare(b, 'hu'));

/** Vendég-darabszám opciók (0-10). */
export const GUEST_COUNT_OPTIONS: string[] = Array.from({ length: 11 }, (_, i) => String(i));

export const MONTHS_HU = [
  'Január', 'Február', 'Március', 'Április', 'Május', 'Június',
  'Július', 'Augusztus', 'Szeptember', 'Október', 'November', 'December',
];
