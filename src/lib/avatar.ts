/**
 * Avatar segédfüggvények — kezdőbetűk és deterministic szín a névből.
 */

const AVATAR_COLORS = [
  { bg: 'bg-sky-100', text: 'text-sky-800' },
  { bg: 'bg-violet-100', text: 'text-violet-800' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  { bg: 'bg-amber-100', text: 'text-amber-800' },
  { bg: 'bg-pink-100', text: 'text-pink-800' },
  { bg: 'bg-orange-100', text: 'text-orange-800' },
  { bg: 'bg-indigo-100', text: 'text-indigo-800' },
  { bg: 'bg-teal-100', text: 'text-teal-800' },
];

/** "Kovács Anna" → "KA", "Szabó Csilla" → "SC" (max 2 betű). */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Determinisztikus szín a név hash-jéből — ugyanaz a név mindig ugyanazt a színt kapja. */
export function getAvatarColor(name: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0; // 32-bit int
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
