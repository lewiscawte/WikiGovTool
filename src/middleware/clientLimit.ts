import { AsyncLocalStorage } from 'node:async_hooks';
import { NextFunction, Request, Response } from 'express';
import { TtlCache } from '../cache';

// Wikimedia rate-limits this tool as a whole, and once it has, upstream.ts must stop every
// request to that host. So each client gets its own allowance of lookups that actually reach
// Wikimedia, and one client can't use up everyone's. Cached responses cost nothing.
const BURST = 60;
const REFILL_PER_SECOND = 1;
const MAX_TRACKED_CLIENTS = 10000;

interface Bucket {
  tokens: number;
  updatedAt: number;
}

// A bucket left alone this long would have refilled completely, so it can simply expire.
const buckets = new TtlCache<Bucket>((BURST / REFILL_PER_SECOND) * 1000, MAX_TRACKED_CLIENTS);
const currentClient = new AsyncLocalStorage<string>();

export class ClientRateLimitedError extends Error {
  // Read by ReadThroughCache: another request waiting on the same lookup fetches for itself
  // rather than failing with this client's limit.
  readonly onlyAffectsCaller = true;

  constructor(public retryAfterSeconds: number) {
    super(`Too many lookups from this client; retry in ${retryAfterSeconds}s`);
  }
}

// One IPv6 user typically controls a whole /64, so IPv6 addresses are grouped by it; an
// IPv4-mapped IPv6 address counts as the IPv4 address.
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}::/64`;
}

// Runs the rest of the request with the client as its identity (req.ip honours the app's
// trust proxy setting).
export function trackClient(req: Request, _res: Response, next: NextFunction): void {
  currentClient.run(clientKey(req.ip ?? 'unknown'), next);
}

// Takes one Wikimedia lookup from the current client's allowance. Work outside a request,
// such as startup, isn't charged.
export function chargeUpstreamLookup(): void {
  const client = currentClient.getStore();
  if (client === undefined) return;
  const now = Date.now();
  const bucket = buckets.get(client) ?? { tokens: BURST, updatedAt: now };
  const tokens = Math.min(BURST, bucket.tokens + ((now - bucket.updatedAt) / 1000) * REFILL_PER_SECOND);
  if (tokens < 1) {
    buckets.set(client, { tokens, updatedAt: now });
    throw new ClientRateLimitedError(Math.ceil((1 - tokens) / REFILL_PER_SECOND));
  }
  buckets.set(client, { tokens: tokens - 1, updatedAt: now });
}
