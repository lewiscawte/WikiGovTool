import { config, userAgent } from '../config';
import { TtlCache } from '../cache';

export interface Article {
  // Canonical title, after following any redirect.
  title: string;
  // The revision the text is from, so a value copied from it can be cited exactly.
  revid: number;
  text: string;
}

const articleCache = new TtlCache<Article | null>(config.cacheTtlMs);

export async function fetchArticle(title: string): Promise<Article | null> {
  const cached = articleCache.get(title);
  if (cached !== undefined) return cached;

  const url = `${config.wikipediaApi}?action=query&prop=revisions&rvprop=ids|content&rvslots=main&redirects=1&titles=${encodeURIComponent(title)}&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent() } });
  if (!res.ok) throw new Error(`Wikipedia request failed: ${res.status} ${res.statusText}`);
  const data: any = await res.json();
  const page = data.query?.pages?.[0];
  const rev = page && !page.missing ? page.revisions?.[0] : null;
  const article = rev?.slots?.main?.content != null ? { title: page.title, revid: rev.revid, text: rev.slots.main.content } : null;
  articleCache.set(title, article);
  return article;
}

export async function fetchWikitext(title: string): Promise<string | null> {
  return (await fetchArticle(title))?.text ?? null;
}

// The article a revision belongs to, or null if there's no such revision (or it's deleted).
export async function fetchRevisionTitle(revid: number): Promise<string | null> {
  const url = `${config.wikipediaApi}?action=query&revids=${revid}&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent() } });
  if (!res.ok) throw new Error(`Wikipedia request failed: ${res.status} ${res.statusText}`);
  const data: any = await res.json();
  if (data.query?.badrevids) return null;
  const page = data.query?.pages?.[0];
  return page && !page.missing ? page.title : null;
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
