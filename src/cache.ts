import { redisStore } from './redisStore';

const DEFAULT_MAX_ENTRIES = 2000;

export class TtlCache<V> {
  private store = new Map<string, { value: V; expiresAt: number }>();

  constructor(private ttlMs: number, private maxEntries = DEFAULT_MAX_ENTRIES) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    this.store.delete(key);
    if (Date.now() > hit.expiresAt) return undefined;
    // Map keeps insertion order, so re-inserting makes the oldest key the least recently used.
    this.store.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.store.size > this.maxEntries) this.store.delete(this.store.keys().next().value as string);
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

export interface RemoteStore {
  mGet(keys: string[]): Promise<Array<string | null>>;
  setMany(entries: Array<{ key: string; value: string; ttlMs: number }>): Promise<void>;
  del(keys: string[]): Promise<void>;
}

// Bump when the shape of a cached value changes, so a deploy can't read entries from the old code.
const SCHEMA_VERSION = 'v1';
const REMOTE_TIMEOUT_MS = 500;

// Wikidata's query service lags behind edits, so a refetch right after one can return the old
// value. Until it has had time to catch up, that value is kept only briefly.
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const EDIT_TTL_MS = 60 * 1000;

interface Entry<V> {
  v: V;
  // When this entry stops being fresh. It stays servable for staleMs after that.
  f: number;
}

function parseEntry<V>(json: string): Entry<V> | undefined {
  try {
    const entry = JSON.parse(json);
    return entry && typeof entry.f === 'number' && 'v' in entry ? entry : undefined;
  } catch {
    return undefined;
  }
}

interface ReadThroughOptions {
  ttlMs: number;
  // How long past ttlMs an entry may still be served while it's refreshed in the background.
  staleMs?: number;
  maxEntries?: number;
  remote?: RemoteStore | null;
  // For data with no value after a restart, or too short-lived to be worth a network hop.
  memoryOnly?: boolean;
}

// Memory first, then Redis when configured, then upstream. Everything is per id, so overlapping
// requests share entries and only the ids nobody has yet are queried.
export class ReadThroughCache<V> {
  private memory: TtlCache<Entry<V>>;
  private remote: RemoteStore | null;
  private ttlMs: number;
  private staleMs: number;
  private inFlight = new Map<string, Promise<Map<string, V>>>();
  private recentlyEdited = new Map<string, number>();

  constructor(private namespace: string, options: ReadThroughOptions) {
    this.ttlMs = options.ttlMs;
    this.staleMs = options.staleMs ?? 0;
    this.memory = new TtlCache(options.ttlMs + this.staleMs, options.maxEntries);
    this.remote = options.memoryOnly ? null : options.remote === undefined ? redisStore : options.remote;
  }

  async getOrFetch(id: string, fetchOne: () => Promise<V>): Promise<V> {
    const found = await this.getMany([id], async () => new Map([[id, await fetchOne()]]));
    return found.get(id) as V;
  }

  // fetchMissing must return an entry for every id it's given, or that id is queried every time.
  async getMany(ids: string[], fetchMissing: (missing: string[]) => Promise<Map<string, V>>): Promise<Map<string, V>> {
    const unique = [...new Set(ids)];
    const entries = await this.read(unique);
    const now = Date.now();
    const result = new Map<string, V>();
    const stale: string[] = [];
    const missing: string[] = [];
    let hits = 0;
    for (const id of unique) {
      const entry = entries.get(id);
      if (entry && now < entry.f) {
        result.set(id, entry.v);
        hits++;
      } else if (entry && now < entry.f + this.staleMs && !this.wasRecentlyEdited(id)) {
        result.set(id, entry.v);
        stale.push(id);
      } else {
        missing.push(id);
      }
    }
    console.log(`[cache] ${this.namespace} hit=${hits} stale=${stale.length} miss=${missing.length}`);

    const toRefresh = stale.filter((id) => !this.inFlight.has(id));
    if (toRefresh.length > 0) {
      this.startFetch(toRefresh, fetchMissing).catch((err) => {
        console.error(`[cache] ${this.namespace} background refresh failed:`, err.message);
      });
    }

    const toFetch = missing.filter((id) => !this.inFlight.has(id));
    if (toFetch.length > 0) this.startFetch(toFetch, fetchMissing);
    const startedHere = new Set(toFetch);
    const fetched = await Promise.all(missing.map(async (id) => [id, await this.awaitFetch(id, startedHere.has(id), fetchMissing)] as const));
    for (const [id, batch] of fetched) {
      if (batch?.has(id)) result.set(id, batch.get(id) as V);
    }
    return result;
  }

  // After an edit: forgets the id, and treats it as recently edited for a while.
  async invalidate(id: string): Promise<void> {
    const now = Date.now();
    for (const [key, until] of this.recentlyEdited) {
      if (until <= now) this.recentlyEdited.delete(key);
    }
    this.recentlyEdited.set(id, now + EDIT_WINDOW_MS);
    this.memory.delete(id);
    const remote = this.remote;
    if (remote) await this.remoteCall('del', () => remote.del([this.remoteKey(id)]));
  }

  private wasRecentlyEdited(id: string): boolean {
    const until = this.recentlyEdited.get(id);
    return until !== undefined && Date.now() < until;
  }

  private remoteKey(id: string): string {
    return `${SCHEMA_VERSION}:${this.namespace}:${id}`;
  }

  // Waits for the in-flight fetch of `id`. A fetch another request started can fail for a
  // reason that only applies to that request, such as its client's rate limit; this request
  // then fetches for itself instead of taking on that error.
  private async awaitFetch(
    id: string,
    startedHere: boolean,
    fetchMissing: (missing: string[]) => Promise<Map<string, V>>,
  ): Promise<Map<string, V> | undefined> {
    try {
      return await this.inFlight.get(id);
    } catch (err) {
      if (startedHere || !(err as { onlyAffectsCaller?: boolean } | null)?.onlyAffectsCaller) throw err;
      return this.inFlight.get(id) ?? this.startFetch([id], fetchMissing);
    }
  }

  private startFetch(ids: string[], fetchMissing: (missing: string[]) => Promise<Map<string, V>>): Promise<Map<string, V>> {
    const batch = Promise.resolve()
      .then(() => fetchMissing(ids))
      .then(async (fetched) => {
        await this.write(fetched);
        return fetched;
      })
      .finally(() => {
        for (const id of ids) this.inFlight.delete(id);
      });
    for (const id of ids) this.inFlight.set(id, batch);
    return batch;
  }

  private async read(ids: string[]): Promise<Map<string, Entry<V>>> {
    const now = Date.now();
    const entries = new Map<string, Entry<V>>();
    const notFresh: string[] = [];
    for (const id of ids) {
      const entry = this.memory.get(id);
      if (entry) entries.set(id, entry);
      if (!entry || now >= entry.f) notFresh.push(id);
    }

    const remote = this.remote;
    if (!remote || notFresh.length === 0) return entries;
    const values = await this.remoteCall('mGet', () => remote.mGet(notFresh.map((id) => this.remoteKey(id))));
    values?.forEach((json, i) => {
      const entry = json === null ? undefined : parseEntry<V>(json);
      if (!entry || entry.f <= (entries.get(notFresh[i])?.f ?? 0)) return;
      entries.set(notFresh[i], entry);
      this.memory.set(notFresh[i], entry, entry.f + this.staleMs - now);
    });
    return entries;
  }

  private async write(fetched: Map<string, V>): Promise<void> {
    const now = Date.now();
    const writes: Array<{ key: string; value: string; ttlMs: number }> = [];
    for (const [id, value] of fetched) {
      const entry: Entry<V> = { v: value, f: now + (this.wasRecentlyEdited(id) ? EDIT_TTL_MS : this.ttlMs) };
      this.memory.set(id, entry);
      if (this.remote) writes.push({ key: this.remoteKey(id), value: JSON.stringify(entry), ttlMs: this.ttlMs + this.staleMs });
    }
    const remote = this.remote;
    if (remote && writes.length > 0) await this.remoteCall('setMany', () => remote.setMany(writes));
  }

  // A remote problem must only ever cost a cache miss, never a failed request.
  private async remoteCall<T>(operation: string, call: () => Promise<T>): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        call(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), REMOTE_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      console.error(`[cache] ${this.namespace} redis ${operation} failed:`, (err as Error).message);
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}
