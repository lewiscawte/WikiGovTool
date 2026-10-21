import { listPositions } from '../store/positionStore';
import { listExtraPositions } from '../store/extraPositionsStore';
import {
  fetchCabinetPositions,
  fetchDeputyPairs,
  fetchOfficeholderHistory,
  fetchPositionLifespans,
  PositionHistoryRow,
  resolveQidFromWikipediaTitle,
} from './wikidataClient';
import { OrgChartEntry, OrgChartPosition, PositionBucket, PositionSeed } from '../types';

export const UNITED_STATES_QID = 'Q30';

function findActiveTerm(candidates: PositionHistoryRow[], date: Date): PositionHistoryRow | undefined {
  return candidates.find((r) => {
    // An "unknown value" end date means Wikidata says the term is over, just not when, so it
    // can't be shown as covering any date (same principle as pickTermForDate below).
    if (r.endUnknown) return false;
    const start = r.start ? new Date(r.start) : null;
    const end = r.end ? new Date(r.end) : null;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  });
}

// Wikidata occasionally has stray/vandalism P39 statements with a start date but no end
// date, sitting in the middle of an otherwise fully-bounded succession (e.g. a fake
// "president" between two real, correctly-dated terms). An open-ended row can only be
// trusted if it's genuinely the most recent term for the position — any other open-ended
// row is untrustworthy and dropped before matching.
function sanitizeDatedRows(rows: PositionHistoryRow[]): PositionHistoryRow[] {
  const sorted = [...rows].sort((a, b) => new Date(b.start as string).getTime() - new Date(a.start as string).getTime());
  return sorted.filter((r, i) => r.end || r.endUnknown || i === 0);
}

function datedRowsForPosition(history: PositionHistoryRow[], positionQid: string): PositionHistoryRow[] {
  return sanitizeDatedRows(history.filter((r) => r.positionQid === positionQid && r.start));
}

// Only ever returns a term whose own [start, end] window actually covers `date`. There used
// to be a fallback here that returned "the most recently-started term" even when its end date
// had already passed `date` — meant to paper over successors not yet recorded on Wikidata, but
// it meant a departed officeholder (contradicted by their own end date) kept showing as if
// still serving, for as long as no successor existed. Showing no officeholder (a known gap in
// our data) is more honest than showing someone we already know has left.
function pickTermForDate(dated: PositionHistoryRow[], date: Date): PositionHistoryRow | null {
  return findActiveTerm(dated, date) ?? null;
}

// The same person can hold a position non-consecutively (e.g. a second, non-sequential
// term); the SPARQL history can also list the same term multiple times if it has more than
// one still-current P102 (party) claim, so dedupe by start date before counting.
function termOrdinalFor(dated: PositionHistoryRow[], term: PositionHistoryRow): number {
  const starts = new Set(dated.filter((r) => r.personQid === term.personQid).map((r) => r.start));
  return [...starts].filter((s) => new Date(s as string) <= new Date(term.start as string)).length;
}

// Fallback only: used when Wikidata has no P2389 ("organization directed by the office or
// position") claim for a position — common for defunct or purely ceremonial offices. Real
// position titles usually still name their portfolio ("Secretary of State for Scotland",
// "Minister of Justice"), so a title guess beats showing the generic class label on every card.
const DEPARTMENT_PATTERNS: RegExp[] = [
  /^Secretary of State for (.+)$/i,
  /^Minister of State for (.+)$/i,
  /^Secretary for (.+)$/i,
  /^Minister for (.+)$/i,
  /^Minister of (.+)$/i,
  /^Secretary of (.+)$/i,
  /^Chancellor of the (.+)$/i,
  /^Chancellor of (.+)$/i,
];

function deriveDepartmentFromTitle(title: string, bucket: PositionBucket): string {
  for (const re of DEPARTMENT_PATTERNS) {
    const m = title.match(re);
    if (m?.[1]) return m[1].replace(/^the\s+/i, '').trim();
  }
  return bucket;
}

async function resolveSeedQid(seed: PositionSeed): Promise<string | null> {
  if (seed.wikidataQid) return seed.wikidataQid;
  if (!seed.wikipediaTitle) return null;
  return resolveQidFromWikipediaTitle(seed.wikipediaTitle);
}

async function loadStaticPositions(): Promise<OrgChartPosition[]> {
  return Promise.all(
    listPositions().map(async (position: PositionSeed): Promise<OrgChartPosition> => {
      const qid = await resolveSeedQid(position);
      const bucket: PositionBucket = position.id === 'president' ? 'Head of State' : position.id === 'vp' ? 'Head of Government' : 'Minister';
      return {
        id: position.id,
        title: position.title,
        department: position.department,
        bucket,
        wikipediaTitle: position.wikipediaTitle,
        wikidataQid: qid,
        dynamic: false,
        inception: null,
        dissolved: null,
      };
    }),
  );
}

async function loadDynamicPositions(countryQid: string): Promise<OrgChartPosition[]> {
  const discoveredPositions = await fetchCabinetPositions(countryQid);
  const discovered: OrgChartPosition[] = discoveredPositions.map((p) => ({
    id: p.qid,
    title: p.label,
    department: p.department ?? deriveDepartmentFromTitle(p.label, p.bucket),
    bucket: p.bucket,
    wikipediaTitle: null,
    wikidataQid: p.qid,
    dynamic: true,
    inception: null,
    dissolved: null,
  }));

  // User-added office stubs for this country (via POST /api/positions) — not discovered from
  // Wikidata, so wikidataQid starts null until someone links or creates the real item.
  const extras = await Promise.all(
    listExtraPositions(countryQid).map(async (seed): Promise<OrgChartPosition> => ({
      id: seed.id,
      title: seed.title,
      department: seed.department,
      bucket: 'Minister',
      wikipediaTitle: seed.wikipediaTitle || null,
      wikidataQid: await resolveSeedQid(seed),
      dynamic: true,
      inception: null,
      dissolved: null,
    })),
  );

  return [...discovered, ...extras];
}

// The org chart is an office-first structure: an office is only shown at all if it actually
// existed on `date` (per P571 inception / P576 dissolution). Whether we additionally know
// its current officeholder is a separate, secondary question — an existing office with no
// resolvable holder still shows (as a gap in officeholder data), but a nonexistent office
// never shows regardless of what stale holder data might otherwise be found for it.
export function existedOn(position: { inception: string | null; dissolved: string | null }, date: Date): boolean {
  if (position.inception && date < new Date(position.inception)) return false;
  if (position.dissolved && date >= new Date(position.dissolved)) return false;
  return true;
}

export function buildEntry(position: OrgChartPosition, history: PositionHistoryRow[], date: Date): OrgChartEntry {
  if (!position.wikidataQid) return { position, officeholder: null, deputies: [] };
  const dated = datedRowsForPosition(history, position.wikidataQid);
  const term = pickTermForDate(dated, date);
  if (!term) return { position, officeholder: null, deputies: [] };
  return {
    position,
    officeholder: {
      personName: term.personLabel,
      personWikidataQid: term.personQid,
      partyLabel: term.partyLabel,
      startDate: term.start,
      endDate: term.end,
      termOrdinal: termOrdinalFor(dated, term),
      imageUrl: term.imageUrl,
    },
    deputies: [],
  };
}

// The country's cabinet-level offices: the curated seed list for the US, live discovery otherwise.
export async function loadCabinetPositions(countryQid: string): Promise<OrgChartPosition[]> {
  return countryQid === UNITED_STATES_QID ? loadStaticPositions() : loadDynamicPositions(countryQid);
}

export async function buildOrgChart(date: Date, countryQid: string = UNITED_STATES_QID): Promise<OrgChartEntry[]> {
  const rawPositions = await loadCabinetPositions(countryQid);
  const qids = rawPositions.map((p) => p.wikidataQid).filter((q): q is string => !!q);
  const [history, lifespans, deputyPairs] = await Promise.all([
    fetchOfficeholderHistory(qids),
    fetchPositionLifespans(qids),
    fetchDeputyPairs(qids),
  ]);

  const positions: OrgChartPosition[] = rawPositions.map((position) => {
    const lifespan = position.wikidataQid ? lifespans.get(position.wikidataQid) : undefined;
    return { ...position, inception: lifespan?.inception ?? null, dissolved: lifespan?.dissolved ?? null };
  });

  const existing = positions.filter((position) => existedOn(position, date));

  // Only positions with a resolved QID can participate in P2098 deputy pairing; the rest
  // (QID resolution failed) are always shown top-level since there's nothing to match them on.
  const entriesByQid = new Map<string, OrgChartEntry>();
  const unresolvedEntries: OrgChartEntry[] = [];
  for (const position of existing) {
    const entry = buildEntry(position, history, date);
    if (position.wikidataQid) entriesByQid.set(position.wikidataQid, entry);
    else unresolvedEntries.push(entry);
  }

  // Nest each junior/deputy office (P2098) under its senior rather than listing it
  // separately — e.g. Vice President under President, Deputy Prime Minister under
  // Prime Minister — so the page foregrounds top-level offices, not every officeholder.
  const juniorQids = new Set<string>();
  for (const pair of deputyPairs) {
    if (pair.seniorQid === pair.juniorQid) continue;
    const senior = entriesByQid.get(pair.seniorQid);
    const junior = entriesByQid.get(pair.juniorQid);
    if (senior && junior) {
      senior.deputies.push(junior);
      juniorQids.add(pair.juniorQid);
    }
  }

  const topLevel = [...entriesByQid.entries()].filter(([qid]) => !juniorQids.has(qid)).map(([, entry]) => entry);
  return [...topLevel, ...unresolvedEntries];
}

export async function getPositionHistory(position: PositionSeed): Promise<PositionHistoryRow[]> {
  const qid = await resolveSeedQid(position);
  if (!qid) return [];
  return fetchOfficeholderHistory([qid]);
}
