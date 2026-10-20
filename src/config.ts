import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  wikimediaContact: process.env.WIKIMEDIA_CONTACT || 'lewiscawte@googlemail.com',
  wikidataSparqlEndpoint: process.env.WIKIDATA_SPARQL_ENDPOINT || 'https://query.wikidata.org/sparql',
  wikidataApi: process.env.WIKIDATA_API || 'https://www.wikidata.org/w/api.php',
  wikipediaApi: process.env.WIKIPEDIA_API || 'https://en.wikipedia.org/w/api.php',
  cacheTtlMs: Number(process.env.CACHE_TTL_MS) || 15 * 60 * 1000,
};

// Wikimedia's API etiquette requires a descriptive User-Agent with contact info,
// otherwise requests can be rate-limited or blocked outright.
export function userAgent(appName = 'WikiGovTool/0.1'): string {
  return `${appName} (${config.wikimediaContact})`;
}