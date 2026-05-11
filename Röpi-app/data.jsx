// Sample roster + attendance data for the mockup
const PLAYERS = [
  'Balogh Levente',
  'Farkas Petra',
  'Horváth Zsófia',
  'Kis Bálint',
  'Kovács Anna',
  'Molnár Bence',
  'Nagy Eszter',
  'Papp Dóra',
  'Szabó Márton',
  'Tóth Gábor',
  'Varga Lilla',
];

// Yearly totals (all players use same skeleton — randomized by name for variety)
const YEARLY_TOTALS = {
  'Kovács Anna':    { 2023: 18, 2024: 22, 2025: 24, 2026: 23, total: 87 },
  'Balogh Levente': { 2023: 12, 2024: 19, 2025: 21, 2026: 18, total: 70 },
  'Farkas Petra':   { 2023: 22, 2024: 26, 2025: 23, 2026: 19, total: 90 },
  'Horváth Zsófia': { 2023:  9, 2024: 14, 2025: 18, 2026: 14, total: 55 },
  'Kis Bálint':     { 2023: 16, 2024: 20, 2025: 20, 2026: 17, total: 73 },
  'Molnár Bence':   { 2023:  5, 2024: 11, 2025: 16, 2026: 12, total: 44 },
  'Nagy Eszter':    { 2023: 24, 2024: 28, 2025: 27, 2026: 25, total: 104 },
  'Papp Dóra':      { 2023:  0, 2024:  6, 2025: 12, 2026:  9, total: 27 },
  'Szabó Márton':   { 2023: 19, 2024: 22, 2025: 21, 2026: 21, total: 83 },
  'Tóth Gábor':     { 2023: 14, 2024: 18, 2025: 19, 2026: 16, total: 67 },
  'Varga Lilla':    { 2023: 11, 2024: 17, 2025: 22, 2026: 20, total: 70 },
};

// Monthly breakdown for selected year (just sample for Kovács Anna 2026)
const MONTHLY_2026 = {
  'Kovács Anna':    [3, 4, 5, 3, 4, 2, 0, 0, 0, 0, 0, 0],
  'Balogh Levente': [3, 3, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0],
  'Farkas Petra':   [2, 4, 5, 4, 4, 0, 0, 0, 0, 0, 0, 0],
  'Horváth Zsófia': [2, 2, 4, 3, 3, 0, 0, 0, 0, 0, 0, 0],
  'Kis Bálint':     [3, 4, 4, 3, 3, 0, 0, 0, 0, 0, 0, 0],
  'Molnár Bence':   [1, 3, 3, 3, 2, 0, 0, 0, 0, 0, 0, 0],
  'Nagy Eszter':    [4, 5, 5, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Papp Dóra':      [1, 1, 2, 2, 3, 0, 0, 0, 0, 0, 0, 0],
  'Szabó Márton':   [3, 4, 5, 4, 5, 0, 0, 0, 0, 0, 0, 0],
  'Tóth Gábor':     [3, 3, 4, 3, 3, 0, 0, 0, 0, 0, 0, 0],
  'Varga Lilla':    [3, 4, 5, 4, 4, 0, 0, 0, 0, 0, 0, 0],
};

// Settlement records (some players have, some don't, to show empty state)
const SETTLEMENTS_2026 = {
  'Kovács Anna': [
    { month: 1, name: 'Január',   sessions: 3, amount:  6900, paid: true  },
    { month: 2, name: 'Február',  sessions: 4, amount:  9200, paid: true  },
    { month: 3, name: 'Március',  sessions: 5, amount: 11500, paid: true  },
    { month: 4, name: 'Április',  sessions: 3, amount:  6900, paid: true  },
    { month: 5, name: 'Május',    sessions: 4, amount: 12600, paid: false },
    { month: 6, name: 'Június',   sessions: 2, amount:  6400, paid: false },
  ],
  'Nagy Eszter': [
    { month: 1, name: 'Január',   sessions: 4, amount:  9200, paid: true },
    { month: 2, name: 'Február',  sessions: 5, amount: 11500, paid: true },
    { month: 3, name: 'Március',  sessions: 5, amount: 11500, paid: true },
    { month: 4, name: 'Április',  sessions: 5, amount: 11500, paid: false },
  ],
  'Farkas Petra': [
    { month: 1, name: 'Január',   sessions: 2, amount:  4600, paid: true },
    { month: 2, name: 'Február',  sessions: 4, amount:  9200, paid: true },
    { month: 3, name: 'Március',  sessions: 5, amount: 11500, paid: false },
  ],
};

// Recent sessions for selected player (descending dates)
const RECENT = {
  'Kovács Anna': [
    '2026-05-19', '2026-05-12', '2026-05-05', '2026-04-28', '2026-04-21',
    '2026-04-14', '2026-04-07', '2026-03-31', '2026-03-24', '2026-03-17',
  ],
};
// Default recent dates for any other player
const DEFAULT_RECENT = [
  '2026-05-19', '2026-05-12', '2026-04-28', '2026-04-21', '2026-04-14',
  '2026-04-07', '2026-03-31', '2026-03-24', '2026-03-17', '2026-03-10',
];

const MONTH_SHORT = ['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];
const DAY_SHORT   = ['vas','hét','ked','sze','csü','pén','szo'];

// Hungarian long format: "2026. máj. 19., kedd"
function formatHuLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = DAY_SHORT[dt.getUTCDay()];
  const dayName = ['vasárnap','hétfő','kedd','szerda','csütörtök','péntek','szombat'][dt.getUTCDay()];
  return `${y}. ${MONTH_SHORT[m-1].toLowerCase()}. ${d}., ${dayName}`;
}
function formatHuf(n) {
  return new Intl.NumberFormat('hu-HU').format(Math.round(n)) + ' Ft';
}
function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
}
// Deterministic warm-spectrum avatar color from name
function avatarHue(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(h) % 360;
}

Object.assign(window, {
  PLAYERS, YEARLY_TOTALS, MONTHLY_2026, SETTLEMENTS_2026, RECENT, DEFAULT_RECENT,
  MONTH_SHORT, formatHuLong, formatHuf, getInitials, avatarHue,
});
