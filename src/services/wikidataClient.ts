import { config, userAgent } from '../config';
import { TtlCache } from '../cache';

const QID_RE = /^Q[1-9]\d*$/;
const ENTITY_URI_PREFIX = 'http://www.wikidata.org/entity/';
const toQid = (uri: string): string => uri.replace(ENTITY_URI_PREFIX, '');

const qidCache = new TtlCache<string | null>(config.cacheTtlMs);
const historyCache = new TtlCache<PositionHistoryRow[]>(config.cacheTtlMs);
const cabinetPositionsCache = new TtlCache<CabinetPosition[]>(config.cacheTtlMs);
const lifespanCache = new TtlCache<Map<string, PositionLifespan>>(config.cacheTtlMs);
const deputyPairsCache = new TtlCache<DeputyPair[]>(config.cacheTtlMs);

async function wdFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Wikidata request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function resolveQidFromWikipediaTitle(title: string): Promise<string | null> {
  const cached = qidCache.get(title);
  if (cached !== undefined) return cached;
  const url = `${config.wikidataApi}?action=wbgetentities&sites=enwiki&titles=${encodeURIComponent(title)}&props=info&format=json`;
  const data = await wdFetch(url);
  const entities = data.entities ?? {};
  const key = Object.keys(entities)[0];
  const qid = key && key !== '-1' ? key : null;
  qidCache.set(title, qid);
  return qid;
}

export interface EntitySearchResult {
  id: string;
  label: string;
  description: string | null;
}

export async function searchEntities(query: string, limit = 8): Promise<EntitySearchResult[]> {
  const url = `${config.wikidataApi}?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&limit=${limit}&format=json`;
  const data = await wdFetch(url);
  return (data.search ?? []).map((r: any) => ({
    id: r.id,
    label: r.label ?? r.id,
    description: r.description ?? null,
  }));
}

export async function getEntity(qid: string): Promise<unknown | null> {
  if (!QID_RE.test(qid)) throw new Error('Invalid QID');
  const url = `${config.wikidataApi}?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=labels|claims|sitelinks&languages=en&format=json`;
  const data = await wdFetch(url);
  return data.entities?.[qid] ?? null;
}

export interface PositionHistoryRow {
  positionQid: string;
  personQid: string;
  personLabel: string;
  partyLabel: string | null;
  start: string | null;
  end: string | null;
  // Wikidata P18 ("image"), already bound by SPARQL as a full Commons Special:FilePath URL —
  // append `?width=<n>` directly to it to get a sized thumbnail, no filename parsing needed.
  imageUrl: string | null;
}

function buildHistoryQuery(qids: string[]): string {
  return `SELECT ?position ?person ?personLabel ?start ?end ?partyLabel ?image WHERE {
  VALUES ?position { ${qids.map((q) => `wd:${q}`).join(' ')} }
  ?person p:P39 ?statement .
  ?statement ps:P39 ?position .
  OPTIONAL { ?statement pq:P580 ?start. }
  OPTIONAL { ?statement pq:P582 ?end. }
  OPTIONAL {
    ?person p:P102 ?partyStatement .
    ?partyStatement ps:P102 ?party .
    FILTER NOT EXISTS { ?partyStatement pq:P582 ?partyEnd }
  }
  OPTIONAL { ?person wdt:P18 ?image. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?position DESC(?start)`;
}

// Fetches the full holder history (not just the current holder) for a batch of position
// QIDs in a single SPARQL query, so the timeline slider doesn't need one call per scrub.
export async function fetchOfficeholderHistory(qids: string[]): Promise<PositionHistoryRow[]> {
  const validQids = qids.filter((q) => QID_RE.test(q));
  if (validQids.length === 0) return [];

  const cacheKey = validQids.slice().sort().join(',');
  const cached = historyCache.get(cacheKey);
  if (cached) return cached;

  const query = buildHistoryQuery(validQids);
  const url = `${config.wikidataSparqlEndpoint}?query=${encodeURIComponent(query)}&format=json`;
  const data = await wdFetch(url);
  const rows: PositionHistoryRow[] = (data.results?.bindings ?? []).map((b: any) => ({
    positionQid: toQid(b.position.value),
    personQid: toQid(b.person.value),
    personLabel: b.personLabel?.value ?? '',
    partyLabel: b.partyLabel?.value ?? null,
    start: b.start?.value ?? null,
    end: b.end?.value ?? null,
    imageUrl: b.image?.value ?? null,
  }));
  historyCache.set(cacheKey, rows);
  return rows;
}

export interface PositionLifespan {
  inception: string | null;
  dissolved: string | null;
}

function buildLifespanQuery(qids: string[]): string {
  return `SELECT ?position ?inception ?dissolved WHERE {
  VALUES ?position { ${qids.map((q) => `wd:${q}`).join(' ')} }
  OPTIONAL { ?position wdt:P571 ?inception. }
  OPTIONAL { ?position wdt:P576 ?dissolved. }
}`;
}

// P571 "inception" / P576 "dissolved, abolished or demolished date" on the position entity
// itself — independent of whether anyone is currently recorded as holding it, so this works
// even for positions with no P39 statements at all yet. Coverage is inherently partial: many
// genuinely-defunct offices (e.g. some abolished 20th-century UK ministries) have neither
// property set on Wikidata, so they can't be caught this way.
export async function fetchPositionLifespans(qids: string[]): Promise<Map<string, PositionLifespan>> {
  const validQids = qids.filter((q) => QID_RE.test(q));
  if (validQids.length === 0) return new Map();

  const cacheKey = validQids.slice().sort().join(',');
  const cached = lifespanCache.get(cacheKey);
  if (cached) return cached;

  const query = buildLifespanQuery(validQids);
  const url = `${config.wikidataSparqlEndpoint}?query=${encodeURIComponent(query)}&format=json`;
  const data = await wdFetch(url);

  const result = new Map<string, PositionLifespan>();
  for (const b of data.results?.bindings ?? []) {
    result.set(toQid(b.position.value), {
      inception: b.inception?.value ?? null,
      dissolved: b.dissolved?.value ?? null,
    });
  }
  lifespanCache.set(cacheKey, result);
  return result;
}

export interface CabinetPosition {
  qid: string;
  label: string;
  bucket: 'Head of State' | 'Head of Government' | 'Minister';
  // The organization this office heads (Wikidata P2389 "organization directed by the office
  // or position"), e.g. "HM Treasury" for Chancellor of the Exchequer. Null when Wikidata
  // has no P2389 claim for this position (common for defunct/ambiguous offices) — callers
  // should fall back to a title-derived guess in that case.
  department: string | null;
}

// Priority order matters: a position can transitively subclass more than one of these
// (e.g. in some systems the head of government is itself classed as a minister), so when
// a position matches several, the earliest-listed bucket here wins.
const BUCKET_CLASSES: Array<{ qid: string; bucket: CabinetPosition['bucket'] }> = [
  { qid: 'Q48352', bucket: 'Head of State' },
  { qid: 'Q2285706', bucket: 'Head of Government' },
  { qid: 'Q83307', bucket: 'Minister' },
];

function buildCabinetPositionsQuery(countryQid: string): string {
  // NB: Blazegraph (Wikidata Query Service's engine) does not support the SPARQL 1.1
  // bounded-repeat property path syntax (`P279{0,4}`) — it 400s with a MalformedQueryException.
  // Only unbounded `*`/`+`/`?` path operators are supported, so this has to stay unbounded.
  return `SELECT ?position ?positionLabel ?class ?dept ?deptLabel WHERE {
  VALUES ?class { ${BUCKET_CLASSES.map((c) => `wd:${c.qid}`).join(' ')} }
  ?position wdt:P1001 wd:${countryQid} .
  ?position wdt:P279* ?class .
  OPTIONAL { ?position wdt:P2389 ?dept. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 200`;
}

// Discovers a country's executive positions (head of state, head of government, ministers)
// live from Wikidata's own position/jurisdiction modeling (P1001 "applies to jurisdiction"
// plus a P279* subclass walk up to one of the three classes above), rather than a hardcoded
// per-country list. Coverage and labeling quality follow directly from how well that
// country's positions are curated on Wikidata, which varies a great deal.
export async function fetchCabinetPositions(countryQid: string): Promise<CabinetPosition[]> {
  if (!QID_RE.test(countryQid)) throw new Error('Invalid country QID');
  const cached = cabinetPositionsCache.get(countryQid);
  if (cached) return cached;

  const query = buildCabinetPositionsQuery(countryQid);
  const url = `${config.wikidataSparqlEndpoint}?query=${encodeURIComponent(query)}&format=json`;
  const data = await wdFetch(url);

  const bucketRank = (classQid: string) => BUCKET_CLASSES.findIndex((c) => c.qid === classQid);
  const best = new Map<string, { classQid: string; label: string; department: string | null }>();
  for (const b of data.results?.bindings ?? []) {
    const qid = toQid(b.position.value);
    const classQid = toQid(b.class.value);
    if (bucketRank(classQid) === -1) continue;
    const label = b.positionLabel?.value ?? qid;
    const department = b.deptLabel?.value ?? null;
    const existing = best.get(qid);
    if (!existing || bucketRank(classQid) < bucketRank(existing.classQid)) {
      best.set(qid, { classQid, label, department: department ?? existing?.department ?? null });
    } else if (!existing.department && department) {
      existing.department = department;
    }
  }

  const bucketNameRank = (bucket: CabinetPosition['bucket']) => BUCKET_CLASSES.findIndex((c) => c.bucket === bucket);

  // SPARQL result order is arbitrary (no ORDER BY) — sorting by bucket priority before the
  // cap below is essential, not cosmetic: without it, a country with 40+ minister matches
  // could silently push its single Head of State entry (e.g. a monarch) out of the slice
  // purely by chance ordering. This bit the UK: "Monarch of the United Kingdom" was being
  // discovered correctly but then dropped by an unprioritized cutoff.
  const result: CabinetPosition[] = [...best.entries()]
    .map(([qid, v]) => ({ qid, label: v.label, bucket: BUCKET_CLASSES[bucketRank(v.classQid)].bucket, department: v.department }))
    .sort((a, b) => bucketNameRank(a.bucket) - bucketNameRank(b.bucket))
    .slice(0, 100);
  cabinetPositionsCache.set(countryQid, result);
  return result;
}

export interface DeputyPair {
  seniorQid: string;
  juniorQid: string;
}

function buildDeputyPairsQuery(qids: string[]): string {
  // P2098 "substitute/deputy/replacement of office/officeholder" is asserted on the SENIOR
  // office, pointing at its deputy (confirmed against real data: "President of the United
  // States" -P2098-> "Vice President of the United States").
  return `SELECT ?senior ?junior WHERE {
  VALUES ?senior { ${qids.map((q) => `wd:${q}`).join(' ')} }
  ?senior wdt:P2098 ?junior .
}`;
}

// Finds junior/deputy offices among a set of positions so the frontend can nest them under
// their senior office instead of listing them as their own top-level entries. Only pairs
// where BOTH ends are already in `qids` are returned — a deputy whose senior fell outside our
// discovered set (or vice versa) can't be sensibly nested, so it's left as top-level.
export async function fetchDeputyPairs(qids: string[]): Promise<DeputyPair[]> {
  const validQids = qids.filter((q) => QID_RE.test(q));
  if (validQids.length === 0) return [];

  const cacheKey = validQids.slice().sort().join(',');
  const cached = deputyPairsCache.get(cacheKey);
  if (cached) return cached;

  const query = buildDeputyPairsQuery(validQids);
  const url = `${config.wikidataSparqlEndpoint}?query=${encodeURIComponent(query)}&format=json`;
  const data = await wdFetch(url);

  const qidSet = new Set(validQids);
  const result: DeputyPair[] = (data.results?.bindings ?? [])
    .map((b: any) => ({ seniorQid: toQid(b.senior.value), juniorQid: toQid(b.junior.value) }))
    .filter((p: DeputyPair) => qidSet.has(p.juniorQid));

  deputyPairsCache.set(cacheKey, result);
  return result;
}