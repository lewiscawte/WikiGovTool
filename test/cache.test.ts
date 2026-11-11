import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadThroughCache, RemoteStore, TtlCache } from '../src/cache';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

class FakeRemote implements RemoteStore {
  data = new Map<string, { value: string; expiresAt: number }>();

  async mGet(keys: string[]) {
    return keys.map((k) => {
      const hit = this.data.get(k);
      return hit && hit.expiresAt > Date.now() ? hit.value : null;
    });
  }

  async setMany(entries: Array<{ key: string; value: string; ttlMs: number }>) {
    for (const e of entries) this.data.set(e.key, { value: e.value, expiresAt: Date.now() + e.ttlMs });
  }

  async del(keys: string[]) {
    for (const k of keys) this.data.delete(k);
  }
}

// Answers each id with `${id}@${version}`, recording which ids each call asked for.
function fetcher() {
  const calls: string[][] = [];
  const state = { version: 1 };
  const fetchMissing = async (ids: string[]) => {
    calls.push(ids);
    return new Map(ids.map((id) => [id, `${id}@${state.version}`]));
  };
  return { calls, state, fetchMissing };
}

// Lets a fire-and-forget background refresh run to completion. Only Date is mocked.
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

const memoryCache = (staleMs = 0) => new ReadThroughCache<string>('test', { ttlMs: HOUR, staleMs, memoryOnly: true });

beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('getMany only fetches the ids it does not already have', async () => {
  const cache = memoryCache();
  const { calls, fetchMissing } = fetcher();
  await cache.getMany(['Q1', 'Q2'], fetchMissing);
  const result = await cache.getMany(['Q1', 'Q2', 'Q3'], fetchMissing);
  assert.deepEqual(calls, [['Q1', 'Q2'], ['Q3']]);
  assert.deepEqual([...result.keys()].sort(), ['Q1', 'Q2', 'Q3']);
});

test('an empty result is cached like any other value', async () => {
  const cache = new ReadThroughCache<string[]>('test', { ttlMs: HOUR, memoryOnly: true });
  let fetches = 0;
  const fetchMissing = async (ids: string[]) => {
    fetches++;
    return new Map(ids.map((id) => [id, [] as string[]]));
  };
  await cache.getMany(['Q1'], fetchMissing);
  assert.deepEqual((await cache.getMany(['Q1'], fetchMissing)).get('Q1'), []);
  assert.equal(fetches, 1);
});

test('getOrFetch caches a null result', async () => {
  const cache = new ReadThroughCache<string | null>('test', { ttlMs: HOUR, memoryOnly: true });
  let fetches = 0;
  const fetchOne = async () => {
    fetches++;
    return null;
  };
  assert.equal(await cache.getOrFetch('Q1', fetchOne), null);
  assert.equal(await cache.getOrFetch('Q1', fetchOne), null);
  assert.equal(fetches, 1);
});

test('concurrent overlapping requests fetch each id once', async () => {
  const cache = memoryCache();
  const { calls, fetchMissing } = fetcher();
  const [a, b] = await Promise.all([
    cache.getMany(['Q1', 'Q2'], fetchMissing),
    cache.getMany(['Q2', 'Q3'], fetchMissing),
  ]);
  assert.deepEqual(calls.flat().sort(), ['Q1', 'Q2', 'Q3']);
  assert.equal(a.get('Q2'), 'Q2@1');
  assert.equal(b.get('Q2'), 'Q2@1');
  assert.equal(b.get('Q3'), 'Q3@1');
});

test('a failed fetch rejects, is not cached, and can be retried', async () => {
  const cache = memoryCache();
  const { fetchMissing } = fetcher();
  await assert.rejects(cache.getMany(['Q1'], async () => {
    throw new Error('upstream down');
  }), /upstream down/);
  assert.equal((await cache.getMany(['Q1'], fetchMissing)).get('Q1'), 'Q1@1');
});

test('an expired entry is served while a background refresh replaces it', async () => {
  const cache = memoryCache(24 * HOUR);
  const { calls, state, fetchMissing } = fetcher();
  await cache.getMany(['Q1'], fetchMissing);

  mock.timers.tick(2 * HOUR);
  state.version = 2;
  assert.equal((await cache.getMany(['Q1'], fetchMissing)).get('Q1'), 'Q1@1');
  await settle();

  assert.equal((await cache.getMany(['Q1'], fetchMissing)).get('Q1'), 'Q1@2');
  assert.equal(calls.length, 2);
});

test('an entry past the stale window is fetched before answering', async () => {
  const cache = memoryCache(HOUR);
  const { state, fetchMissing } = fetcher();
  await cache.getMany(['Q1'], fetchMissing);
  mock.timers.tick(3 * HOUR);
  state.version = 2;
  assert.equal((await cache.getMany(['Q1'], fetchMissing)).get('Q1'), 'Q1@2');
});

test('a failed background refresh keeps serving the stale value', async () => {
  const cache = memoryCache(24 * HOUR);
  const { fetchMissing } = fetcher();
  await cache.getMany(['Q1'], fetchMissing);
  mock.timers.tick(2 * HOUR);
  const failing = async (): Promise<Map<string, string>> => {
    throw new Error('rate limited');
  };
  assert.equal((await cache.getMany(['Q1'], failing)).get('Q1'), 'Q1@1');
  await settle();
  assert.equal((await cache.getMany(['Q1'], failing)).get('Q1'), 'Q1@1');
});

test('invalidate forces the next read to fetch', async () => {
  const cache = memoryCache(24 * HOUR);
  const { state, fetchMissing } = fetcher();
  await cache.getMany(['Q1'], fetchMissing);
  await cache.invalidate('Q1');
  state.version = 2;
  assert.equal((await cache.getMany(['Q1'], fetchMissing)).get('Q1'), 'Q1@2');
});

test('a value fetched just after invalidate is kept briefly, and not served once expired', async () => {
  const cache = memoryCache(24 * HOUR);
  const { state, fetchMissing } = fetcher();
  await cache.invalidate('Q1');
  // The query service hasn't seen the edit yet, so this is the old value.
  await cache.getMany(['Q1'], fetchMissing);

  mock.timers.tick(2 * MINUTE);
  state.version = 2;
  assert.equal((await cache.getMany(['Q1'], fetchMissing)).get('Q1'), 'Q1@2');
});

test('the normal TTL applies again once the edit window has passed', async () => {
  const cache = memoryCache();
  const { calls, fetchMissing } = fetcher();
  await cache.invalidate('Q1');
  mock.timers.tick(16 * MINUTE);
  await cache.getMany(['Q1'], fetchMissing);
  mock.timers.tick(30 * MINUTE);
  await cache.getMany(['Q1'], fetchMissing);
  assert.equal(calls.length, 1);
});

test('a new process reads what an earlier one stored remotely', async () => {
  const remote = new FakeRemote();
  const first = new ReadThroughCache<string>('test', { ttlMs: HOUR, remote });
  const { calls, fetchMissing } = fetcher();
  await first.getMany(['Q1'], fetchMissing);

  const restarted = new ReadThroughCache<string>('test', { ttlMs: HOUR, remote });
  assert.equal((await restarted.getMany(['Q1'], fetchMissing)).get('Q1'), 'Q1@1');
  assert.equal(calls.length, 1);
});

test('every remote write expires, after the TTL plus the stale window', async () => {
  const remote = new FakeRemote();
  const setMany = mock.method(remote, 'setMany');
  const cache = new ReadThroughCache<string>('test', { ttlMs: HOUR, staleMs: 2 * HOUR, remote });
  await cache.getMany(['Q1'], fetcher().fetchMissing);
  assert.equal(setMany.mock.calls[0].arguments[0][0].ttlMs, 3 * HOUR);
});

test('invalidate removes the remote copy so a restart cannot bring it back', async () => {
  const remote = new FakeRemote();
  const first = new ReadThroughCache<string>('test', { ttlMs: HOUR, remote });
  const { state, fetchMissing } = fetcher();
  await first.getMany(['Q1'], fetchMissing);
  await first.invalidate('Q1');

  state.version = 2;
  const restarted = new ReadThroughCache<string>('test', { ttlMs: HOUR, remote });
  assert.equal((await restarted.getMany(['Q1'], fetchMissing)).get('Q1'), 'Q1@2');
});

test('a remote that errors behaves as a miss', async () => {
  const remote: RemoteStore = {
    mGet: async () => { throw new Error('connection refused'); },
    setMany: async () => { throw new Error('connection refused'); },
    del: async () => { throw new Error('connection refused'); },
  };
  const cache = new ReadThroughCache<string>('test', { ttlMs: HOUR, remote });
  const { calls, fetchMissing } = fetcher();
  assert.equal((await cache.getMany(['Q1'], fetchMissing)).get('Q1'), 'Q1@1');
  await cache.invalidate('Q2');
  // The memory layer still protects upstream while the remote is down.
  await cache.getMany(['Q1'], fetchMissing);
  assert.equal(calls.length, 1);
});

test('a remote that hangs is abandoned', async () => {
  const never = new Promise<never>(() => {});
  const remote: RemoteStore = { mGet: () => never, setMany: () => never, del: () => never };
  const cache = new ReadThroughCache<string>('test', { ttlMs: HOUR, remote });
  assert.equal((await cache.getMany(['Q1'], fetcher().fetchMissing)).get('Q1'), 'Q1@1');
});

test('unreadable remote values are treated as misses', async () => {
  const remote = new FakeRemote();
  for (const junk of ['not json', '{"v":"no freshness"}', 'null']) {
    remote.data.set('v1:test:Q1', { value: junk, expiresAt: Date.now() + HOUR });
    const fresh = new ReadThroughCache<string>('test', { ttlMs: HOUR, remote });
    assert.equal((await fresh.getMany(['Q1'], fetcher().fetchMissing)).get('Q1'), 'Q1@1');
  }
});

test('remote keys are versioned and namespaced', async () => {
  const remote = new FakeRemote();
  const cache = new ReadThroughCache<string>('history', { ttlMs: HOUR, remote });
  await cache.getMany(['Q1'], fetcher().fetchMissing);
  assert.deepEqual([...remote.data.keys()], ['v1:history:Q1']);
});

test('a memory-only cache never touches the remote', async () => {
  const remote = new FakeRemote();
  const cache = new ReadThroughCache<string>('test', { ttlMs: HOUR, remote, memoryOnly: true });
  await cache.getMany(['Q1'], fetcher().fetchMissing);
  assert.equal(remote.data.size, 0);
});

test('TtlCache drops the least recently used entry when full', () => {
  const cache = new TtlCache<number>(HOUR, 2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

test('TtlCache honours a per-entry TTL', () => {
  const cache = new TtlCache<number>(HOUR);
  cache.set('short', 1, MINUTE);
  mock.timers.tick(2 * MINUTE);
  assert.equal(cache.get('short'), undefined);
});

test('TtlCache with a byte budget evicts the oldest entries to stay under it', () => {
  const cache = new TtlCache<string>(HOUR, 2000, 1000);
  for (const key of 'abcdefghij') cache.set(key, key.repeat(300));
  const kept = [...'abcdefghij'].filter((key) => cache.get(key) !== undefined);
  assert.ok(kept.length <= 3, `kept ${kept.length} entries of ~300 bytes under a 1,000-byte budget`);
  assert.ok(kept.includes('j'), 'the newest entry is kept');
});

test('TtlCache does not keep a single value larger than its byte budget', () => {
  const cache = new TtlCache<string>(HOUR, 2000, 1000);
  cache.set('big', 'x'.repeat(5000));
  assert.equal(cache.get('big'), undefined);
});
