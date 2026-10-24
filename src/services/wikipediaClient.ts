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
export interface ArticleSearchResult {
  title: string;
  // The article's Wikidata item (page prop wikibase_item); null for unconnected articles.
  wikidataQid: string | null;
}

// Full-text article search, returning each hit's linked Wikidata item so results can be
// checked against Wikidata (e.g. "is this a person?") in one batch.
export async function searchArticles(query: string, limit = 10): Promise<ArticleSearchResult[]> {
  const url = `${config.wikipediaApi}?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${limit}&gsrnamespace=0&prop=pageprops&ppprop=wikibase_item&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent() } });
  if (!res.ok) throw new Error(`Wikipedia request failed: ${res.status} ${res.statusText}`);
  const data: any = await res.json();
  return (data.query?.pages ?? [])
    .sort((a: any, b: any) => a.index - b.index)
    .map((p: any) => ({ title: p.title, wikidataQid: p.pageprops?.wikibase_item ?? null }));
}
