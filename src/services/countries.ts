import { config, userAgent } from '../config';
import { TtlCache } from '../cache';

export interface CountryRef {
  qid: string;
  label: string;
}

// Countries change far less often than officeholders, so this gets its own long-lived cache
// rather than reusing the general-purpose cacheTtlMs.
const COUNTRIES_TTL_MS = 24 * 60 * 60 * 1000;
const countriesCache = new TtlCache<CountryRef[]>(COUNTRIES_TTL_MS);
const CACHE_KEY = 'sovereign-states';

const COUNTRIES_QUERY = `SELECT ?country ?countryLabel WHERE {
  ?country wdt:P31 wd:Q3624078 .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?countryLabel`;

export async function listCountries(): Promise<CountryRef[]> {
  const cached = countriesCache.get(CACHE_KEY);
  if (cached) return cached;

  const url = `${config.wikidataSparqlEndpoint}?query=${encodeURIComponent(COUNTRIES_QUERY)}&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Wikidata request failed: ${res.status} ${res.statusText}`);
  const data: any = await res.json();
  const countries: CountryRef[] = (data.results?.bindings ?? []).map((b: any) => ({
    qid: b.country.value.replace('http://www.wikidata.org/entity/', ''),
    label: b.countryLabel?.value ?? '',
  }));
  countriesCache.set(CACHE_KEY, countries);
  return countries;
}
