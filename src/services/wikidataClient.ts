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
  // True when P582 (end time) is Wikidata's "unknown value": the term is known to have ended,
  // but not when. `end` is null in that case rather than the placeholder URI SPARQL returns.
  endUnknown?: boolean;
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

// SPARQL returns Wikidata's "unknown value" as a skolem URI (http://www.wikidata.org/.well-known/genid/…)
// rather than a date literal. Treat anything that isn't a literal as "no usable date".
function dateValue(binding: any): string | null {
  return binding?.type === 'literal' ? binding.value : null;
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
    start: dateValue(b.start),
    end: dateValue(b.end),
    endUnknown: Boolean(b.end) && dateValue(b.end) === null,
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
async function runSparql(query: string): Promise<any[]> {
  const url = `${config.wikidataSparqlEndpoint}?query=${encodeURIComponent(query)}&format=json`;
  const data = await wdFetch(url);
  return data.results?.bindings ?? [];
}

const valuesList = (qids: string[]) => qids.map((q) => `wd:${q}`).join(' ');

export interface DepartmentLink {
  positionQid: string;
  departmentQid: string;
}

const departmentLinksCache = new TtlCache<DepartmentLink[]>(config.cacheTtlMs);

// Which department each office runs. Wikidata records this from either end — P2389
// ("organization directed by the office") on the office, or P2388 ("office held by head of
// the organization") on the department — and coverage of the two differs, so check both.
export async function fetchDepartmentLinks(positionQids: string[]): Promise<DepartmentLink[]> {
  const validQids = positionQids.filter((q) => QID_RE.test(q));
  if (validQids.length === 0) return [];
  const cacheKey = validQids.slice().sort().join(',');
  const cached = departmentLinksCache.get(cacheKey);
  if (cached) return cached;

  const bindings = await runSparql(`SELECT DISTINCT ?position ?dept WHERE {
  VALUES ?position { ${valuesList(validQids)} }
  { ?position wdt:P2389 ?dept . } UNION { ?dept wdt:P2388 ?position . }
}`);
  const result = bindings.map((b: any) => ({ positionQid: toQid(b.position.value), departmentQid: toQid(b.dept.value) }));
  departmentLinksCache.set(cacheKey, result);
  return result;
}

const departmentsOfClassCache = new TtlCache<string[]>(config.cacheTtlMs);

// Every item that is directly an instance of a country-specific department class (e.g.
// "United States federal executive department"), including abolished ones — this is what
// lets the timeline show e.g. the Department of Health, Education, and Welfare in 1970,
// whose head office isn't in the current cabinet list.
export async function fetchDepartmentsOfClass(classQid: string): Promise<string[]> {
  if (!QID_RE.test(classQid)) throw new Error('Invalid class QID');
  const cached = departmentsOfClassCache.get(classQid);
  if (cached) return cached;
  const bindings = await runSparql(`SELECT DISTINCT ?dept WHERE { ?dept wdt:P31 wd:${classQid} . }`);
  const result = bindings.map((b: any) => toQid(b.dept.value));
  departmentsOfClassCache.set(classQid, result);
  return result;
}

export interface DepartmentDetails {
  qid: string;
  label: string;
  wikipediaTitle: string | null;
  inception: string | null;
  dissolved: string | null;
}

const departmentDetailsCache = new TtlCache<Map<string, DepartmentDetails>>(config.cacheTtlMs);

export async function fetchDepartmentDetails(departmentQids: string[]): Promise<Map<string, DepartmentDetails>> {
  const validQids = departmentQids.filter((q) => QID_RE.test(q));
  if (validQids.length === 0) return new Map();
  const cacheKey = validQids.slice().sort().join(',');
  const cached = departmentDetailsCache.get(cacheKey);
  if (cached) return cached;

  // A department can carry several P571/P576 values (re-foundings, disputed dates): take the
  // earliest inception and latest dissolution so it isn't hidden on a date it plausibly existed.
  const bindings = await runSparql(`SELECT ?dept (SAMPLE(?label) AS ?deptLabel) (SAMPLE(?title) AS ?article)
       (MIN(?inception) AS ?founded) (MAX(?dissolved) AS ?abolished) WHERE {
  VALUES ?dept { ${valuesList(validQids)} }
  OPTIONAL { ?dept rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { ?dept wdt:P571 ?inception . }
  OPTIONAL { ?dept wdt:P576 ?dissolved . }
  OPTIONAL { ?a schema:about ?dept ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title . }
} GROUP BY ?dept`);

  const result = new Map<string, DepartmentDetails>();
  for (const b of bindings) {
    const qid = toQid(b.dept.value);
    result.set(qid, {
      qid,
      label: b.deptLabel?.value ?? qid,
      wikipediaTitle: b.article?.value ?? null,
      inception: b.founded?.value ?? null,
      dissolved: b.abolished?.value ?? null,
    });
  }
  departmentDetailsCache.set(cacheKey, result);
  return result;
}

export interface DepartmentOfficeRow {
  departmentQid: string;
  positionQid: string;
  positionLabel: string;
  role: 'head' | 'member';
}

const departmentOfficesCache = new TtlCache<DepartmentOfficeRow[]>(config.cacheTtlMs);

// The offices inside each department: its head (P2389 / P2388, as above) plus anything that
// is P361 "part of" it. P361 also links agencies, armed forces, even military operations, so
// rows are restricted to items someone has actually held (P39). Checking the position class
// via P31/P279* instead is correct too but ~50x slower and times out for a whole government.
export async function fetchDepartmentOffices(departmentQids: string[]): Promise<DepartmentOfficeRow[]> {
  const validQids = departmentQids.filter((q) => QID_RE.test(q));
  if (validQids.length === 0) return [];
  const cacheKey = validQids.slice().sort().join(',');
  const cached = departmentOfficesCache.get(cacheKey);
  if (cached) return cached;

  const bindings = await runSparql(`SELECT DISTINCT ?dept ?position ?positionLabel ?role WHERE {
  VALUES ?dept { ${valuesList(validQids)} }
  { ?position wdt:P2389 ?dept . BIND("head" AS ?role) }
  UNION { ?dept wdt:P2388 ?position . BIND("head" AS ?role) }
  UNION { ?position wdt:P361 ?dept . BIND("member" AS ?role) }
  FILTER EXISTS { ?holder wdt:P39 ?position . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`);

  // An office can match as both head and member (e.g. P2389 and P361 both set): head wins.
  const byKey = new Map<string, DepartmentOfficeRow>();
  for (const b of bindings) {
    const row: DepartmentOfficeRow = {
      departmentQid: toQid(b.dept.value),
      positionQid: toQid(b.position.value),
      positionLabel: b.positionLabel?.value ?? toQid(b.position.value),
      role: b.role.value === 'head' ? 'head' : 'member',
    };
    const key = `${row.departmentQid}|${row.positionQid}`;
    const existing = byKey.get(key);
    if (!existing || (existing.role === 'member' && row.role === 'head')) byKey.set(key, row);
  }
  const result = [...byKey.values()];
  departmentOfficesCache.set(cacheKey, result);
  return result;
}

export interface LinkedItem {
  qid: string;
  label: string;
}

export interface DepartmentProfile {
  qid: string;
  label: string;
  description: string | null;
  aliases: string[];
  wikipediaTitle: string | null;
  inception: string | null;
  dissolved: string | null;
  website: string | null;
  instanceOf: LinkedItem[];
  country: LinkedItem[];
  parent: LinkedItem[];
  headquarters: LinkedItem[];
  headOffice: LinkedItem[];
  replaces: LinkedItem[];
  replacedBy: LinkedItem[];
}

const departmentProfileCache = new TtlCache<DepartmentProfile | null>(config.cacheTtlMs);

// Everything the department dialog shows for one item. Linked items come back with their
// labels (one row per value, so each property is a separate OPTIONAL and rows multiply —
// fine for a single item).
const PROFILE_LINKS: Record<string, keyof DepartmentProfile> = {
  P31: 'instanceOf',
  P17: 'country',
  P749: 'parent',
  P159: 'headquarters',
  P2388: 'headOffice',
  P1365: 'replaces',
  P1366: 'replacedBy',
};

export async function fetchDepartmentProfile(qid: string): Promise<DepartmentProfile | null> {
  if (!QID_RE.test(qid)) throw new Error('Invalid QID');
  const cached = departmentProfileCache.get(qid);
  if (cached !== undefined) return cached;

  const [scalars, links] = await Promise.all([
    runSparql(`SELECT (SAMPLE(?label) AS ?l) (SAMPLE(?desc) AS ?d) (SAMPLE(?title) AS ?article)
       (MIN(?inception) AS ?founded) (MAX(?dissolved) AS ?abolished) (SAMPLE(?site) AS ?website)
       (GROUP_CONCAT(DISTINCT ?alias; separator="\\u001f") AS ?aliases) WHERE {
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?item skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P576 ?dissolved . }
  OPTIONAL { ?item wdt:P856 ?site . }
  OPTIONAL { ?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title . }
}`),
    runSparql(`SELECT ?prop ?value ?valueLabel WHERE {
  VALUES ?prop { ${Object.keys(PROFILE_LINKS).map((p) => `wdt:${p}`).join(' ')} }
  wd:${qid} ?prop ?value .
  FILTER(isIRI(?value) && STRSTARTS(STR(?value), "${ENTITY_URI_PREFIX}"))
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`),
  ]);

  const s = scalars[0];
  if (!s?.l && links.length === 0) {
    departmentProfileCache.set(qid, null);
    return null;
  }
  const profile: DepartmentProfile = {
    qid,
    label: s?.l?.value ?? qid,
    description: s?.d?.value ?? null,
    aliases: s?.aliases?.value ? s.aliases.value.split('\u001f') : [],
    wikipediaTitle: s?.article?.value ?? null,
    inception: s?.founded?.value ?? null,
    dissolved: s?.abolished?.value ?? null,
    website: s?.website?.value ?? null,
    instanceOf: [], country: [], parent: [], headquarters: [], headOffice: [], replaces: [], replacedBy: [],
  };
  for (const b of links) {
    const key = PROFILE_LINKS[b.prop.value.replace('http://www.wikidata.org/prop/direct/', '')];
    const list = profile[key] as LinkedItem[] | undefined;
    if (!list) continue;
    const valueQid = toQid(b.value.value);
    if (!list.some((i) => i.qid === valueQid)) list.push({ qid: valueQid, label: b.valueLabel?.value ?? valueQid });
  }
  departmentProfileCache.set(qid, profile);
  return profile;
}

export interface PersonCandidate {
  qid: string;
  name: string;
  description: string | null;
  birth: string | null;
  death: string | null;
  wikipediaTitle: string | null;
  imageUrl: string | null;
  // Wikidata already records this person holding the office being filled (any P39 statement).
  heldPosition: boolean;
}

// Of `qids`, the ones that are people (P31 Q5 — instance of human, not a subclass, which is
// how Wikidata models people), with what the officeholder picker shows for each. Order of
// the result follows `qids`.
export async function fetchPeople(qids: string[], positionQid: string | null): Promise<PersonCandidate[]> {
  const validQids = [...new Set(qids.filter((q) => QID_RE.test(q)))];
  if (validQids.length === 0) return [];
  const heldBind = positionQid && QID_RE.test(positionQid)
    ? `BIND(EXISTS { ?person wdt:P39 wd:${positionQid} . } AS ?held)`
    : 'BIND(false AS ?held)';
  const bindings = await runSparql(`SELECT ?person (SAMPLE(?label) AS ?name) (SAMPLE(?desc) AS ?description)
       (MIN(?born) AS ?birth) (MAX(?died) AS ?death) (SAMPLE(?title) AS ?article) (SAMPLE(?img) AS ?image)
       (SAMPLE(?held) AS ?heldPosition) WHERE {
  VALUES ?person { ${valuesList(validQids)} }
  ?person wdt:P31 wd:Q5 .
  OPTIONAL { ?person rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { ?person schema:description ?desc . FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?person wdt:P569 ?born . FILTER(isLiteral(?born)) }
  OPTIONAL { ?person wdt:P570 ?died . FILTER(isLiteral(?died)) }
  OPTIONAL { ?person wdt:P18 ?img . }
  OPTIONAL { ?a schema:about ?person ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title . }
  ${heldBind}
} GROUP BY ?person`);

  const byQid = new Map<string, PersonCandidate>();
  for (const b of bindings) {
    const qid = toQid(b.person.value);
    byQid.set(qid, {
      qid,
      name: b.name?.value ?? qid,
      description: b.description?.value ?? null,
      // "Unknown value" dates (skolem URIs, see dateValue) are filtered out in the query.
      birth: dateValue(b.birth),
      death: dateValue(b.death),
      wikipediaTitle: b.article?.value ?? null,
      imageUrl: b.image?.value ?? null,
      heldPosition: b.heldPosition?.value === 'true',
    });
  }
  return validQids.map((q) => byQid.get(q)).filter((p): p is PersonCandidate => !!p);
}
