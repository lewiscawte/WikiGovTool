import { userAgent } from '../config';
import { chargeUpstreamLookup } from '../middleware/clientLimit';

const DEFAULT_BACKOFF_SECONDS = 60;

// Keeps sending after a 429 and the Wikidata Query Service starts answering 403 instead, so once
// a host has rate-limited us nothing more goes to it until Retry-After has passed.
const blockedUntil = new Map<string, number>();

export class UpstreamRateLimitedError extends Error {
  constructor(host: string, public retryAfterSeconds: number) {
    super(`${host} is rate limiting this tool; retry in ${retryAfterSeconds}s`);
  }
}

export async function upstreamJson(url: string, source: string): Promise<any> {
  const host = new URL(url).host;
  const until = blockedUntil.get(host) ?? 0;
  if (Date.now() < until) throw new UpstreamRateLimitedError(host, Math.ceil((until - Date.now()) / 1000));
  chargeUpstreamLookup();

  const startedAt = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' } });
  console.log(`[upstream] ${host} ${res.status} ${Date.now() - startedAt}ms`);
  if (res.status === 429) {
    const retryAfterSeconds = Number(res.headers.get('Retry-After')) || DEFAULT_BACKOFF_SECONDS;
    blockedUntil.set(host, Date.now() + retryAfterSeconds * 1000);
    throw new UpstreamRateLimitedError(host, retryAfterSeconds);
  }
  if (!res.ok) throw new Error(`${source} request failed: ${res.status} ${res.statusText}`);
  return res.json();
}
