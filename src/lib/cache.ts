/**
 * Session-szintű in-memory cache TTL-lel.
 *
 * Cél: a Firestore IndexedDB cache fölött egy gyorsabb réteg —
 * ugyanaz a query ne fusson le kétszer egy boot session-ön belül.
 * Tab-váltások (overview ↔ profile ↔ database) instant-ok lesznek.
 *
 * Használat:
 *   const members = await cached('members', 5 * 60_000, () => getAllMembers());
 *
 * Invalidáció írás után:
 *   invalidate('members'); // pontos kulcs
 *   invalidate('member');  // 'member' prefix-szel kezdődő összes kulcs
 */

interface Entry {
  data: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

/** TTL gyakori értékek (ms) — kombinálható ttlMs-ként. */
export const TTL = {
  SHORT:  30_000,       // 30 sec — gyorsan változó adat
  MEDIUM: 5 * 60_000,   // 5 perc — alapértelmezett
  LONG:   30 * 60_000,  // 30 perc — kvázi statikus
} as const;

/**
 * Cache lookup → vissza ha érvényes (nem expired), különben fetcher fut
 * és az eredmény cache-be kerül.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) {
    return hit.data as T;
  }
  const data = await fetcher();
  store.set(key, { data, expiresAt: now + ttlMs });
  return data;
}

/**
 * Cache invalidáció. A kulcs pontosan vagy prefix-szel egyezzen
 * (pl. invalidate('memberByEmail') törli az összes 'memberByEmail:foo@…' bejegyzést).
 */
export function invalidate(keyOrPrefix: string): void {
  const prefix = `${keyOrPrefix}:`;
  for (const k of [...store.keys()]) {
    if (k === keyOrPrefix || k.startsWith(prefix)) {
      store.delete(k);
    }
  }
}

/** Teljes cache törlés (pl. signout / signin után). */
export function invalidateAll(): void {
  store.clear();
}
