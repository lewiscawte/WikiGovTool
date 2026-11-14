import { config } from '../config';
import { ReadThroughCache } from '../cache';
import { upstreamJson } from './upstream';
import { withRecentTermEdits } from '../store/recentTermEdits';

const QID_RE = /^Q[1-9]\d*$/;
const ENTITY_URI_PREFIX = 'http://www.wikidata.org/entity/';
const toQid = (uri: string): string => uri.replace(ENTITY_URI_PREFIX, '');

const SEARCH_TTL_MS = 5 * 60 * 1000;

const persistent = <V>(namespace: string, ttlMs: number) => new ReadThroughCache<V>(namespace, { ttlMs, staleMs: config.cacheStaleMs });
const structureCache = <V>(namespace: string) => persistent<V>(namespace, config.cacheStructureTtlMs);

const qidCache = structureCache<string | null>('qid');
const historyCache = persistent<PositionHistoryRow[]>('history', config.cacheHistoryTtlMs);
const cabinetPositionsCache = structureCache<CabinetPosition[]>('cabinet');
const lifespanCache = structureCache<PositionLifespan>('lifespan');
const deputiesCache = structureCache<string[]>('deputies');
// Whole Wikidata items can each be megabytes, and any visitor can ask for any item, so this
// cache is bounded by size as well as by entry count.
const ENTITY_CACHE_BYTES = 32 * 1024 * 1024;
const entityCache = new ReadThroughCache<unknown | null>('entity', { ttlMs: config.cacheTtlMs, memoryOnly: true, maxBytes: ENTITY_CACHE_BYTES });
const entitySearchCache = new ReadThroughCache<EntitySearchResult[]>('entity-search', { ttlMs: SEARCH_TTL_MS, memoryOnly: true });
const peopleCache = new ReadThroughCache<PersonCandidate | null>('people', { ttlMs: SEARCH_TTL_MS, memoryOnly: true });

const wdFetch = (url: string): Promise<any> => upstreamJson(url, 'Wikidata');
const uniqueValidQids = (qids: string[]) => [...new Set(qids.filter((q) => QID_RE.test(q)))];
const emptyListsFor = <T>(qids: string[]) => new Map<string, T[]>(qids.map((q) => [q, []]));

export async function resolveQidFromWikipediaTitle(title: string): Promise<string | null> {
  return qidCache.getOrFetch(title, async () => {
    const url = `${config.wikidataApi}?action=wbgetentities&sites=enwiki&titles=${encodeURIComponent(title)}&props=info&format=json`;
    const data = await wdFetch(url);
    const entities = data.entities ?? {};
    const key = Object.keys(entities)[0];
    return key && key !== '-1' ? key : null;
  });
}

// Fresh (uncached) item JSON for building an edit: claims plus lastrevid, so the edit can be
// sent with baserevid and fail on a conflict rather than overwrite someone else's change.
export async function fetchEntityForEdit(qid: string): Promise<any | null> {
  if (!QID_RE.test(qid)) throw new Error('Invalid QID');
  const url = `${config.wikidataApi}?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=info|claims|labels&languages=en&format=json`;
  const data = await wdFetch(url);
  const entity = data.entities?.[qid];
  return entity && !('missing' in entity) ? entity : null;
}

// Drops an office's cached holders, after an edit to Wikidata changed them.
export function invalidateOfficeholderHistory(positionQid: string): Promise<void> {
  return historyCache.invalidate(positionQid);
}

// The refresh button: forgets what's cached about some offices, departments or other items, so
// the next view fetches them from Wikidata again.
export async function purgeOffices(qids: string[]): Promise<void> {
  const valid = uniqueValidQids(qids);
  await Promise.all([historyCache, lifespanCache, deputiesCache, departmentLinksCache, entityCache].map((c) => c.purge(valid)));
}

export async function purgeDepartments(qids: string[]): Promise<void> {
  const valid = uniqueValidQids(qids);
  await Promise.all([departmentDetailsCache, departmentOfficesCache, departmentProfileCache, entityCache].map((c) => c.purge(valid)));
}

export async function purgeItems(qids: string[]): Promise<void> {
  await entityCache.purge(uniqueValidQids(qids));
}

// A just-created office or department: the query service doesn't have it yet, so what's
// fetched about it is only kept briefly until it has (see ReadThroughCache.invalidate).
export async function invalidateNewItem(kind: 'office' | 'department', qid: string): Promise<void> {
  const caches = kind === 'office'
    ? [historyCache, lifespanCache, deputiesCache, departmentLinksCache]
    : [departmentDetailsCache, departmentOfficesCache, departmentProfileCache];
  await Promise.all(caches.map((c) => c.invalidate(qid)));
}

// A country's office list, and the list of a department class's members, if it has one.
export async function purgeCountryLists(countryQid: string, departmentClassQid: string | null): Promise<void> {
  await Promise.all([
    cabinetPositionsCache.purge(uniqueValidQids([countryQid])),
    departmentClassQid ? departmentsOfClassCache.purge(uniqueValidQids([departmentClassQid])) : Promise.resolve(),
  ]);
}

export interface EntitySearchResult {
  id: string;
  label: string;
  description: string | null;
}

export async function searchEntities(query: string, limit = 8): Promise<EntitySearchResult[]> {
  return entitySearchCache.getOrFetch(`${limit}:${query}`, async () => {
    const url = `${config.wikidataApi}?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&limit=${limit}&format=json`;
    const data = await wdFetch(url);
    return (data.search ?? []).map((r: any) => ({
      id: r.id,
      label: r.label ?? r.id,
      description: r.description ?? null,
    }));
  });
}

export async function getEntity(qid: string): Promise<unknown | null> {
  if (!QID_RE.test(qid)) throw new Error('Invalid QID');
  return entityCache.getOrFetch(qid, async () => {
    const url = `${config.wikidataApi}?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=labels|claims|sitelinks&languages=en&format=json`;
    const data = await wdFetch(url);
    return data.entities?.[qid] ?? null;
  });
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
  // A term this tool saved that Wikidata's query service doesn't show yet (store/recentTermEdits.ts).
  pending?: boolean;
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
  const validQids = uniqueValidQids(qids);
  if (validQids.length === 0) return [];

  const byPosition = await historyCache.getMany(validQids, async (missing) => {
    const bindings = await runSparql(buildHistoryQuery(missing));
    const rows = emptyListsFor<PositionHistoryRow>(missing);
    for (const b of bindings) {
      rows.get(toQid(b.position.value))?.push({
        positionQid: toQid(b.position.value),
        personQid: toQid(b.person.value),
        personLabel: b.personLabel?.value ?? '',
        partyLabel: b.partyLabel?.value ?? null,
        start: dateValue(b.start),
        end: dateValue(b.end),
        endUnknown: Boolean(b.end) && dateValue(b.end) === null,
        imageUrl: b.image?.value ?? null,
      });
    }
    return rows;
  });
  return validQids.flatMap((q) => withRecentTermEdits(q, byPosition.get(q) ?? []));
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
  const validQids = uniqueValidQids(qids);
  if (validQids.length === 0) return new Map();

  return lifespanCache.getMany(validQids, async (missing) => {
    const bindings = await runSparql(buildLifespanQuery(missing));
    const result = new Map<string, PositionLifespan>(missing.map((q) => [q, { inception: null, dissolved: null }]));
    for (const b of bindings) {
      result.set(toQid(b.position.value), {
        inception: b.inception?.value ?? null,
        dissolved: b.dissolved?.value ?? null,
      });
    }
    return result;
  });
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

// Enough for the UK's ~220 executive offices with room to spare. Hitting it is logged.
const MAX_CABINET_POSITIONS = 400;

const subclassesCache = structureCache<string[]>('subclasses');

// Every class at or below `classQid` in the P279 tree. These don't depend on the country, so
// one fetch serves them all (about 70,000 QIDs across the three classes, a few seconds).
function fetchSubclasses(classQid: string): Promise<string[]> {
  return subclassesCache.getOrFetch(classQid, async () => {
    const bindings = await runSparql(`SELECT DISTINCT ?sub WHERE { ?sub wdt:P279* wd:${classQid} . }`);
    return bindings.map((b: any) => toQid(b.sub.value));
  });
}

// Discovers a country's executive positions (head of state, head of government, ministers)
// live from Wikidata's own position/jurisdiction modeling (P1001 "applies to jurisdiction"
// plus a P279* subclass walk up to one of the three classes above), rather than a hardcoded
// per-country list. Coverage and labeling quality follow directly from how well that
// country's positions are curated on Wikidata, which varies a great deal.
export async function fetchCabinetPositions(countryQid: string): Promise<CabinetPosition[]> {
  if (!QID_RE.test(countryQid)) throw new Error('Invalid country QID');
  return cabinetPositionsCache.getOrFetch(countryQid, () => queryCabinetPositions(countryQid));
}

// Asking WDQS for "P1001 this country and P279* one of the classes" in one query took 40s to
// over 60s for the UK. Fetching the country's classes (only items with a P279 can be in a
// subclass tree; 744 for the UK, ~4s) and matching them against the shared subclass lists
// here gives the same answer.
async function queryCabinetPositions(countryQid: string): Promise<CabinetPosition[]> {
  const [subclassSets, candidates] = await Promise.all([
    Promise.all(BUCKET_CLASSES.map(async (c) => new Set(await fetchSubclasses(c.qid)))),
    runSparql(`SELECT DISTINCT ?position WHERE { ?position wdt:P1001 wd:${countryQid} ; wdt:P279 [] . }`),
  ]);

  const matched: Array<{ qid: string; rank: number }> = [];
  for (const b of candidates) {
    const qid = toQid(b.position.value);
    const rank = subclassSets.findIndex((set) => set.has(qid));
    if (rank !== -1) matched.push({ qid, rank });
  }

  // SPARQL result order is arbitrary (no ORDER BY) — sorting by bucket priority before the
  // cap below is essential, not cosmetic: without it, a country with many minister matches
  // could silently push its single Head of State entry (e.g. a monarch) out of the slice
  // purely by chance ordering. This bit the UK: "Monarch of the United Kingdom" was being
  // discovered correctly but then dropped by an unprioritized cutoff.
  matched.sort((a, b) => a.rank - b.rank);
  if (matched.length > MAX_CABINET_POSITIONS) {
    console.log(`[cabinet] ${countryQid} has ${matched.length} executive offices; showing the first ${MAX_CABINET_POSITIONS}`);
  }
  const selected = matched.slice(0, MAX_CABINET_POSITIONS);
  if (selected.length === 0) return [];

  const bindings = await runSparql(`SELECT ?position ?positionLabel ?dept ?deptLabel WHERE {
  VALUES ?position { ${valuesList(selected.map((m) => m.qid))} }
  OPTIONAL { ?position wdt:P2389 ?dept. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`);
  const details = new Map<string, { label: string; department: string | null }>();
  for (const b of bindings) {
    const qid = toQid(b.position.value);
    const department = b.deptLabel?.value ?? null;
    const existing = details.get(qid);
    if (!existing) details.set(qid, { label: b.positionLabel?.value ?? qid, department });
    else if (!existing.department && department) existing.department = department;
  }

  return selected.map(({ qid, rank }) => ({
    qid,
    label: details.get(qid)?.label ?? qid,
    bucket: BUCKET_CLASSES[rank].bucket,
    department: details.get(qid)?.department ?? null,
  }));
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
  const validQids = uniqueValidQids(qids);
  if (validQids.length === 0) return [];

  const juniorsBySenior = await deputiesCache.getMany(validQids, async (missing) => {
    const bindings = await runSparql(buildDeputyPairsQuery(missing));
    const juniors = emptyListsFor<string>(missing);
    for (const b of bindings) juniors.get(toQid(b.senior.value))?.push(toQid(b.junior.value));
    return juniors;
  });

  // Filtered here, not before caching, because the requested set differs between callers.
  const qidSet = new Set(validQids);
  return validQids.flatMap((seniorQid) => (juniorsBySenior.get(seniorQid) ?? [])
    .filter((juniorQid) => qidSet.has(juniorQid))
    .map((juniorQid) => ({ seniorQid, juniorQid })));
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

const departmentLinksCache = structureCache<string[]>('department-links');

// Which department each office runs. Wikidata records this from either end — P2389
// ("organization directed by the office") on the office, or P2388 ("office held by head of
// the organization") on the department — and coverage of the two differs, so check both.
export async function fetchDepartmentLinks(positionQids: string[]): Promise<DepartmentLink[]> {
  const validQids = uniqueValidQids(positionQids);
  if (validQids.length === 0) return [];

  const departmentsByPosition = await departmentLinksCache.getMany(validQids, async (missing) => {
    const bindings = await runSparql(`SELECT DISTINCT ?position ?dept WHERE {
  VALUES ?position { ${valuesList(missing)} }
  { ?position wdt:P2389 ?dept . } UNION { ?dept wdt:P2388 ?position . }
}`);
    const departments = emptyListsFor<string>(missing);
    for (const b of bindings) departments.get(toQid(b.position.value))?.push(toQid(b.dept.value));
    return departments;
  });
  return validQids.flatMap((positionQid) => (departmentsByPosition.get(positionQid) ?? [])
    .map((departmentQid) => ({ positionQid, departmentQid })));
}

const departmentsOfClassCache = structureCache<string[]>('departments-of-class');

// Every item that is directly an instance of a country-specific department class (e.g.
// "United States federal executive department"), including abolished ones — this is what
// lets the timeline show e.g. the Department of Health, Education, and Welfare in 1970,
// whose head office isn't in the current cabinet list.
export async function fetchDepartmentsOfClass(classQid: string): Promise<string[]> {
  if (!QID_RE.test(classQid)) throw new Error('Invalid class QID');
  return departmentsOfClassCache.getOrFetch(classQid, async () => {
    const bindings = await runSparql(`SELECT DISTINCT ?dept WHERE { ?dept wdt:P31 wd:${classQid} . }`);
    return bindings.map((b: any) => toQid(b.dept.value));
  });
}

export interface DepartmentDetails {
  qid: string;
  label: string;
  wikipediaTitle: string | null;
  inception: string | null;
  dissolved: string | null;
}

const departmentDetailsCache = structureCache<DepartmentDetails | null>('department-details');

export async function fetchDepartmentDetails(departmentQids: string[]): Promise<Map<string, DepartmentDetails>> {
  const validQids = uniqueValidQids(departmentQids);
  if (validQids.length === 0) return new Map();

  const found = await departmentDetailsCache.getMany(validQids, async (missing) => {
    // A department can carry several P571/P576 values (re-foundings, disputed dates): take the
    // earliest inception and latest dissolution so it isn't hidden on a date it plausibly existed.
    const bindings = await runSparql(`SELECT ?dept (SAMPLE(?label) AS ?deptLabel) (SAMPLE(?title) AS ?article)
       (MIN(?inception) AS ?founded) (MAX(?dissolved) AS ?abolished) WHERE {
  VALUES ?dept { ${valuesList(missing)} }
  OPTIONAL { ?dept rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { ?dept wdt:P571 ?inception . }
  OPTIONAL { ?dept wdt:P576 ?dissolved . }
  OPTIONAL { ?a schema:about ?dept ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title . }
} GROUP BY ?dept`);

    const result = new Map<string, DepartmentDetails | null>(missing.map((q) => [q, null]));
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
    return result;
  });

  const result = new Map<string, DepartmentDetails>();
  for (const [qid, details] of found) {
    if (details) result.set(qid, details);
  }
  return result;
}

export interface DepartmentOfficeRow {
  departmentQid: string;
  positionQid: string;
  positionLabel: string;
  role: 'head' | 'member';
}

const departmentOfficesCache = structureCache<DepartmentOfficeRow[]>('department-offices');

// The offices inside each department: its head (P2389 / P2388, as above) plus anything that
// is P361 "part of" it. P361 also links agencies, armed forces, even military operations, so
// rows are restricted to items someone has actually held (P39). Checking the position class
// via P31/P279* instead is correct too but ~50x slower and times out for a whole government.
export async function fetchDepartmentOffices(departmentQids: string[]): Promise<DepartmentOfficeRow[]> {
  const validQids = uniqueValidQids(departmentQids);
  if (validQids.length === 0) return [];

  const officesByDepartment = await departmentOfficesCache.getMany(validQids, async (missing) => {
    const bindings = await runSparql(`SELECT DISTINCT ?dept ?position ?positionLabel ?role WHERE {
  VALUES ?dept { ${valuesList(missing)} }
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
    const offices = emptyListsFor<DepartmentOfficeRow>(missing);
    for (const row of byKey.values()) offices.get(row.departmentQid)?.push(row);
    return offices;
  });
  return validQids.flatMap((q) => officesByDepartment.get(q) ?? []);
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

const departmentProfileCache = structureCache<DepartmentProfile | null>('department-profile');

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
  return departmentProfileCache.getOrFetch(qid, () => queryDepartmentProfile(qid));
}

async function queryDepartmentProfile(qid: string): Promise<DepartmentProfile | null> {
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
  if (!s?.l && links.length === 0) return null;
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
  const validQids = uniqueValidQids(qids);
  if (validQids.length === 0) return [];
  const heldQid = positionQid && QID_RE.test(positionQid) ? positionQid : null;
  const cacheId = (qid: string) => `${qid}|${heldQid ?? ''}`;

  const found = await peopleCache.getMany(validQids.map(cacheId), async (missingIds) => {
    const missing = missingIds.map((id) => id.split('|')[0]);
    const people = await queryPeople(missing, heldQid);
    return new Map(missing.map((q) => [cacheId(q), people.get(q) ?? null]));
  });
  return validQids.map((q) => found.get(cacheId(q))).filter((p): p is PersonCandidate => !!p);
}

// One person read straight from Wikidata's API rather than the query service, for an item
// created moments ago that the query service doesn't have yet. Null unless it's a human (P31 Q5).
export async function fetchPersonDirect(qid: string): Promise<PersonCandidate | null> {
  const entity = await fetchEntityForEdit(qid);
  const values = (property: string) => (entity?.claims?.[property] ?? [])
    .map((c: any) => (c.mainsnak?.snaktype === 'value' ? c.mainsnak.datavalue?.value : null))
    .filter((v: any) => v != null);
  if (!values('P31').some((v: any) => v.id === 'Q5')) return null;
  const day = (property: string) => {
    const t = values(property)[0]?.time;
    return typeof t === 'string' ? t.replace(/^\+/, '').replace(/-00/g, '-01') : null;
  };
  const image = values('P18')[0];
  return {
    qid,
    name: entity.labels?.en?.value ?? qid,
    description: null,
    birth: day('P569'),
    death: day('P570'),
    wikipediaTitle: null,
    imageUrl: typeof image === 'string' ? `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image.replace(/ /g, '_'))}` : null,
    heldPosition: false,
  };
}

async function queryPeople(qids: string[], heldQid: string | null): Promise<Map<string, PersonCandidate>> {
  const heldBind = heldQid
    ? `BIND(EXISTS { ?person wdt:P39 wd:${heldQid} . } AS ?held)`
    : 'BIND(false AS ?held)';
  const bindings = await runSparql(`SELECT ?person (SAMPLE(?label) AS ?name) (SAMPLE(?desc) AS ?description)
       (MIN(?born) AS ?birth) (MAX(?died) AS ?death) (SAMPLE(?title) AS ?article) (SAMPLE(?img) AS ?image)
       (SAMPLE(?held) AS ?heldPosition) WHERE {
  VALUES ?person { ${valuesList(qids)} }
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
  return byQid;
}
