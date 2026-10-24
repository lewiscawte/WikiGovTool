import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  wikimediaContact: process.env.WIKIMEDIA_CONTACT || 'lewiscawte@googlemail.com',
  wikidataSparqlEndpoint: process.env.WIKIDATA_SPARQL_ENDPOINT || 'https://query.wikidata.org/sparql',
  wikidataApi: process.env.WIKIDATA_API || 'https://www.wikidata.org/w/api.php',
  wikipediaApi: process.env.WIKIPEDIA_API || 'https://en.wikipedia.org/w/api.php',
  // Change tags applied to every edit this tool makes on Wikidata (comma-separated). Each must
  // already exist and be active on Wikidata (Special:Tags), or the edit is rejected; empty = none.
  wikidataEditTags: process.env.WIKIDATA_EDIT_TAGS || '',
  cacheTtlMs: Number(process.env.CACHE_TTL_MS) || 15 * 60 * 1000,
  oauth: {
    clientId: process.env.OAUTH_CLIENT_ID || '',
    clientSecret: process.env.OAUTH_CLIENT_SECRET || '',
    callbackUrl: process.env.OAUTH_CALLBACK_URL || 'http://localhost:3000/api/auth/callback',
    authBase: process.env.OAUTH_AUTH_BASE || 'https://meta.wikimedia.org',
    authorizeUrl: process.env.OAUTH_AUTHORIZE_URL || 'https://meta.wikimedia.org/w/rest.php/oauth2/authorize',
    tokenUrl: process.env.OAUTH_TOKEN_URL || 'https://meta.wikimedia.org/w/rest.php/oauth2/access_token',
    // Wikidata rather than meta: a consumer restricted to wikidatawiki (the only wiki this tool
    // edits) has tokens meta rejects with 403, and this endpoint also works for "*" consumers.
    profileUrl: process.env.OAUTH_PROFILE_URL || 'https://www.wikidata.org/w/rest.php/oauth2/resource/profile',
    scope: process.env.OAUTH_SCOPE || '',
    // Local testing only: log in with an owner-only consumer's access token instead of the
    // OAuth redirect flow. Everyone who logs in becomes the token's owner, so it is refused
    // when NODE_ENV=production. Off unless OAUTH_OWNER_ONLY=true.
    ownerOnly: process.env.OAUTH_OWNER_ONLY === 'true',
    ownerAccessToken: process.env.OAUTH_OWNER_ACCESS_TOKEN || '',
  },
};

// Wikimedia's API etiquette requires a descriptive User-Agent with contact info,
// otherwise requests can be rate-limited or blocked outright.
export function userAgent(appName = 'WikiGovTool/0.1'): string {
  return `${appName} (${config.wikimediaContact})`;
}