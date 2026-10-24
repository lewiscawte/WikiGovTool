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

// The timeline starts in 1900 (EPOCH in public/shared.js), so states dissolved (P576) before
// then can never be viewed — Wikidata still types many as sovereign states, e.g. the Kangar
// Union (659–750). A state is dropped only if all its dissolution dates are before 1900, so
// one with a later date (e.g. re-founded) stays; "unknown value" dates are ignored.
const TIMELINE_START = '1900-01-01T00:00:00Z';

const COUNTRIES_QUERY = `SELECT ?country ?countryLabel WHERE {
  ?country wdt:P31 wd:Q3624078 .
  FILTER NOT EXISTS {
    ?country wdt:P576 ?dissolved .
    FILTER(isLiteral(?dissolved) && ?dissolved < "${TIMELINE_START}"^^xsd:dateTime)
    FILTER NOT EXISTS {
      ?country wdt:P576 ?later .
      FILTER(isLiteral(?later) && ?later >= "${TIMELINE_START}"^^xsd:dateTime)
    }
  }
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
