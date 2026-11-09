import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchDeputyPairs,
  fetchOfficeholderHistory,
  fetchPositionLifespans,
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

test('lifespans are returned as a new map each call', async () => {
  stubSparql(() => [{ position: entity('Q151'), inception: { value: '1900-01-01T00:00:00Z' } }]);
  const first = await fetchPositionLifespans(['Q151']);
  first.delete('Q151');
  const second = await fetchPositionLifespans(['Q151']);
  assert.equal(second.get('Q151')?.inception, '1900-01-01T00:00:00Z');
});
