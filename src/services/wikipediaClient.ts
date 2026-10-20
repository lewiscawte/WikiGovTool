import { config, userAgent } from '../config';
import { TtlCache } from '../cache';

const wikitextCache = new TtlCache<string | null>(config.cacheTtlMs);

export async function fetchWikitext(title: string): Promise<string | null> {
  const cached = wikitextCache.get(title);
  if (cached !== undefined) return cached;

  const url = `${config.wikipediaApi}?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(title)}&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent() } });
  if (!res.ok) throw new Error(`Wikipedia request failed: ${res.status} ${res.statusText}`);
  const data: any = await res.json();
  const page = data.query?.pages?.[0];
  const text: string | null = page && !page.missing ? (page.revisions?.[0]?.slots?.main?.content ?? null) : null;
  wikitextCache.set(title, text);
  return text;
}