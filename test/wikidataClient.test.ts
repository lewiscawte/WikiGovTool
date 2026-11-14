import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchCabinetPositions,
  fetchDeputyPairs,
  fetchOfficeholderHistory,
  fetchPositionLifespans,
  getEntity,
  invalidateOfficeholderHistory,
} from '../src/services/wikidataClient';

const entity = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });
const sparqlBody = (bindings: unknown[]) => new Response(JSON.stringify({ results: { bindings } }));
const historyRow = (position: string, person: string) => ({
  position: entity(position),
  person: entity(person),
  personLabel: { value: person },
});

// The QIDs in a SPARQL request's VALUES clause.
function requestedQids(call: { arguments: unknown[] }): string[] {
  const query = decodeURIComponent(String(call.arguments[0]));
  return [...(query.match(/VALUES \?\w+ \{([^}]*)\}/)?.[1].matchAll(/wd:(Q\d+)/g) ?? [])].map((m) => m[1]);
}

function stubSparql(bindings: () => unknown[]) {
  return mock.method(globalThis, 'fetch', async () => sparqlBody(bindings()));
}

beforeEach(() => {
  mock.method(console, 'log', () => {});
});

afterEach(() => {
  mock.restoreAll();
});

// Each test uses its own QIDs: the client's caches are module-level.

test('history for overlapping office sets only queries the offices not yet seen', async () => {
  const fetchMock = stubSparql(() => [historyRow('Q101', 'Q9001')]);
  await fetchOfficeholderHistory(['Q101', 'Q102']);
  await fetchOfficeholderHistory(['Q101', 'Q102', 'Q103']);
  assert.deepEqual(requestedQids(fetchMock.mock.calls[0]).sort(), ['Q101', 'Q102']);
  assert.deepEqual(requestedQids(fetchMock.mock.calls[1]), ['Q103']);
});

test('history rows come back only for the requested offices', async () => {
  stubSparql(() => [historyRow('Q111', 'Q9001'), historyRow('Q112', 'Q9002')]);
  await fetchOfficeholderHistory(['Q111', 'Q112']);
  const rows = await fetchOfficeholderHistory(['Q112']);
  assert.deepEqual(rows.map((r) => r.personQid), ['Q9002']);
});

test('an office with no holders is not queried again', async () => {
  const fetchMock = stubSparql(() => []);
  await fetchOfficeholderHistory(['Q121']);
  await fetchOfficeholderHistory(['Q121']);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('an edit refetches only the edited office', async () => {
  const fetchMock = stubSparql(() => []);
  await fetchOfficeholderHistory(['Q131', 'Q132']);
  await invalidateOfficeholderHistory('Q131');
  await fetchOfficeholderHistory(['Q131', 'Q132']);
  assert.deepEqual(requestedQids(fetchMock.mock.calls[1]), ['Q131']);
});

test('deputy pairs are limited to offices in the requested set, even when cached', async () => {
  const fetchMock = stubSparql(() => [{ senior: entity('Q141'), junior: entity('Q142') }]);
  assert.deepEqual(await fetchDeputyPairs(['Q141']), []);
  assert.deepEqual(await fetchDeputyPairs(['Q141', 'Q142']).then((p) => p.filter((x) => x.seniorQid === 'Q141')), [
    { seniorQid: 'Q141', juniorQid: 'Q142' },
  ]);
  assert.deepEqual(requestedQids(fetchMock.mock.calls[1]), ['Q142']);
});

// A small stand-in for Wikidata's class tree and two countries' offices. Q900 is both a head of
// state and a head of government; Q999 has P1001 but isn't an executive office.
const SUBCLASSES: Record<string, string[]> = {
  Q48352: ['Q48352', 'Q900', 'Q1100'],
  Q2285706: ['Q2285706', 'Q901', 'Q900'],
  Q83307: ['Q83307', 'Q902', ...Array.from({ length: 450 }, (_, i) => `Q${2000 + i}`)],
};
const COUNTRY_OFFICES: Record<string, string[]> = {
  Q5000: ['Q999', 'Q902', 'Q901', 'Q900'],
  // A head of state listed after more ministers than the cap allows.
  Q5001: [...Array.from({ length: 450 }, (_, i) => `Q${2000 + i}`), 'Q1100'],
  // Q3000 was created after the class lists were fetched, as a subclass of minister.
  Q5002: ['Q900', 'Q3000'],
};
// Each office's P279 parents; offices not listed have an unrelated one.
const PARENTS: Record<string, string[]> = { Q3000: ['Q83307'] };

function stubCabinetSparql() {
  return mock.method(globalThis, 'fetch', async (url: string) => {
    const query = decodeURIComponent(String(url));
    const closure = query.match(/wdt:P279\* wd:(Q\d+)/);
    if (closure) return sparqlBody(SUBCLASSES[closure[1]].map((q) => ({ sub: entity(q) })));
    const country = query.match(/wdt:P1001 wd:(Q\d+)/);
    if (country) {
      return sparqlBody(COUNTRY_OFFICES[country[1]].flatMap((q) => (PARENTS[q] ?? ['Q1']).map((parent) => ({ position: entity(q), parent: entity(parent) }))));
    }
    return sparqlBody(requestedQids({ arguments: [url] }).map((q) => ({
      position: entity(q),
      positionLabel: { value: `Office ${q}` },
      ...(q === 'Q902' ? { dept: entity('Q7000'), deptLabel: { value: 'Ministry of Q902' } } : {}),
    })));
  });
}

const isClosureQuery = (call: { arguments: unknown[] }) => /wdt:P279\*/.test(decodeURIComponent(String(call.arguments[0])));

test('cabinet positions are the country offices in an executive class, best bucket first', async () => {
  stubCabinetSparql();
  const positions = await fetchCabinetPositions('Q5000');
  assert.deepEqual(positions, [
    { qid: 'Q900', label: 'Office Q900', bucket: 'Head of State', department: null },
    { qid: 'Q901', label: 'Office Q901', bucket: 'Head of Government', department: null },
    { qid: 'Q902', label: 'Office Q902', bucket: 'Minister', department: 'Ministry of Q902' },
  ]);
});

test('cabinet positions keep heads of state over ministers when capped at 400, without refetching class lists', async () => {
  const fetchMock = stubCabinetSparql();
  await fetchCabinetPositions('Q5000');
  const before = fetchMock.mock.calls.filter(isClosureQuery).length;

  const positions = await fetchCabinetPositions('Q5001');
  assert.equal(positions.length, 400);
  assert.deepEqual(positions[0], { qid: 'Q1100', label: 'Office Q1100', bucket: 'Head of State', department: null });
  assert.equal(fetchMock.mock.calls.filter(isClosureQuery).length, before);
});

test('an office newer than the cached class lists is found through its parent class', async () => {
  stubCabinetSparql();
  const positions = await fetchCabinetPositions('Q5002');
  assert.deepEqual(positions.map((p) => [p.qid, p.bucket]), [['Q900', 'Head of State'], ['Q3000', 'Minister']]);
});

test('lifespans are returned as a new map each call', async () => {
  stubSparql(() => [{ position: entity('Q151'), inception: { value: '1900-01-01T00:00:00Z' } }]);
  const first = await fetchPositionLifespans(['Q151']);
  first.delete('Q151');
  const second = await fetchPositionLifespans(['Q151']);
  assert.equal(second.get('Q151')?.inception, '1900-01-01T00:00:00Z');
});

// GET /api/wikidata/entity/:qid is unauthenticated, so distinct large items must not pile up.
test('getEntity bounds cached entities by size, not only by count', async () => {
  const filler = 'x'.repeat(200_000);
  const fetchMock = mock.method(globalThis, 'fetch', async (url: string) => {
    const qid = new URL(String(url)).searchParams.get('ids')!;
    return new Response(JSON.stringify({ entities: { [qid]: { id: qid, filler } } }));
  });
  for (let i = 1; i <= 300; i++) await getEntity(`Q${700000 + i}`);
  const calls = fetchMock.mock.callCount();
  await getEntity('Q700001');
  assert.equal(fetchMock.mock.callCount(), calls + 1, 'the oldest of 300 × 200 kB entities should have been evicted');
});
