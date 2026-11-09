import { createClient } from 'redis';
import { config } from './config';
import type { RemoteStore } from './cache';

const MAX_RECONNECT_DELAY_MS = 5000;
const ERROR_LOG_INTERVAL_MS = 60 * 1000;

// Toolforge's shared Redis has no access control: any tool can read or overwrite any key. Only
// public data goes in here, never sessions, and the prefix has to be long, random and secret.
class RedisStore implements RemoteStore {
  private lastErrorLoggedAt = 0;
  private client = createClient({
    url: config.redisUrl,
    // Without this, commands queue up while Redis is away instead of failing into a cache miss.
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (retries) => Math.min(retries * 200, MAX_RECONNECT_DELAY_MS),
    },
  });

  constructor(private prefix: string) {
    // An 'error' event with no listener would crash the process.
    this.client.on('error', (err) => {
      if (Date.now() - this.lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;
      this.lastErrorLoggedAt = Date.now();
      console.error('[redis]', err.message);
    });
  }

  connect(): void {
    this.client.connect().catch((err) => console.error('[redis] connect failed:', err.message));
  }

  private key(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async mGet(keys: string[]): Promise<Array<string | null>> {
    return this.client.mGet(keys.map((k) => this.key(k)));
  }

  async setMany(entries: Array<{ key: string; value: string; ttlMs: number }>): Promise<void> {
    await Promise.all(entries.map((e) => this.client.pSetEx(this.key(e.key), e.ttlMs, e.value)));
  }

  async del(keys: string[]): Promise<void> {
    await this.client.del(keys.map((k) => this.key(k)));
  }
}

function createStore(): RedisStore | null {
  if (!config.redisUrl) return null;
  if (!config.redisKeyPrefix) {
    console.error('[redis] REDIS_URL is set without REDIS_KEY_PREFIX; caching in memory only');
    return null;
  }
  return new RedisStore(config.redisKeyPrefix);
}

export const redisStore = createStore();
