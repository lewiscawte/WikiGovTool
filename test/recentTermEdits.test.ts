import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearRecentTermEdits, recordOfficeDates, recordTermEdit, withRecentOfficeDates, withRecentTermEdits } from '../src/store/recentTermEdits';
import type { PositionHistoryRow } from '../src/services/wikidataClient';

const OFFICE = 'Q16147337';

const row = (personQid: string, start: string | null, end: string | null, extra: Partial<PositionHistoryRow> = {}): PositionHistoryRow => ({
  positionQid: OFFICE, personQid, personLabel: personQid, partyLabel: null,
  start: start && `${start}T00:00:00Z`, end: end && `${end}T00:00:00Z`, imageUrl: null, ...extra,
});

const edit = (overrides: Partial<Parameters<typeof recordTermEdit>[0]> = {}) => recordTermEdit({
  positionQid: OFFICE, personQid: 'Q31752753', personLabel: 'Mwigulu Nchemba', imageUrl: null,
  previousStart: '2021-03-31', created: false, start: '2021-03-31', end: '2025-11-03', ...overrides,
});

beforeEach(clearRecentTermEdits);

test('an ended term shows its end date before the query service has it', () => {
  edit();
  const [patched, other] = withRecentTermEdits(OFFICE, [row('Q31752753', '2021-03-31', null), row('Q22279305', '2015-12-10', '2021-03-30')]);
  assert.equal(patched.end, '2025-11-03T00:00:00Z');
  assert.equal(patched.pending, true);
  assert.equal(other.pending, undefined);
});

test('every row of the term is patched, as SPARQL lists one per party', () => {
  edit();
  const rows = withRecentTermEdits(OFFICE, [row('Q31752753', '2021-03-31', null, { partyLabel: 'A' }), row('Q31752753', '2021-03-31', null, { partyLabel: 'B' })]);
  assert.deepEqual(rows.map((r) => r.end), ['2025-11-03T00:00:00Z', '2025-11-03T00:00:00Z']);
});

test('only the edited term is patched, not the same person\'s other terms', () => {
  edit();
  const rows = withRecentTermEdits(OFFICE, [row('Q31752753', '2010-01-01', '2012-01-01'), row('Q31752753', '2021-03-31', null)]);
  assert.deepEqual(rows.map((r) => r.end), ['2012-01-01T00:00:00Z', '2025-11-03T00:00:00Z']);
});

test('a created term is added as a row, taking the person\'s label and portrait from their other rows', () => {
  edit({ created: true, previousStart: null, start: '2025-11-04', end: null, personQid: 'Q1', personLabel: 'New', imageUrl: 'img' });
  const rows = withRecentTermEdits(OFFICE, [row('Q31752753', '2021-03-31', '2025-11-03')]);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[1].personQid, rows[1].start, rows[1].end, rows[1].imageUrl, rows[1].pending], ['Q1', '2025-11-04T00:00:00Z', null, 'img', true]);
});

test('a year-precision date matches the query service\'s 1 January', () => {
  edit({ previousStart: '2021', start: '2021', end: '2025' });
  const [patched] = withRecentTermEdits(OFFICE, [row('Q31752753', '2021-01-01', null)]);
  assert.equal(patched.end, '2025-01-01T00:00:00Z');
});

test('once the query service shows the edit it is forgotten', () => {
  edit();
  const caughtUp = [row('Q31752753', '2021-03-31', '2025-11-03')];
  assert.equal(withRecentTermEdits(OFFICE, caughtUp)[0].pending, undefined);
  // Gone for good: an older cached copy is no longer patched either.
  assert.equal(withRecentTermEdits(OFFICE, [row('Q31752753', '2021-03-31', null)])[0].end, null);
});

test('a second edit to a waiting term still finds the term as the query service has it', () => {
  edit({ previousStart: '2021-03-31', start: '2021-04-01', end: null });
  edit({ previousStart: '2021-04-01', start: '2021-04-01', end: '2025-11-03' });
  const rows = withRecentTermEdits(OFFICE, [row('Q31752753', '2021-03-31', null)]);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].start, rows[0].end], ['2021-04-01T00:00:00Z', '2025-11-03T00:00:00Z']);
});

test('other offices are untouched', () => {
  edit();
  const rows = [{ ...row('Q31752753', '2021-03-31', null), positionQid: 'Q9' }];
  assert.equal(withRecentTermEdits('Q9', rows), rows);
});

test('an office\'s saved dates show over the cached lifespan until the query service has them', () => {
  recordOfficeDates(OFFICE, { inception: '1961-12-09' });
  const cached = { inception: '1961-01-01T00:00:00Z', dissolved: null };
  assert.deepEqual(withRecentOfficeDates(OFFICE, cached), { inception: '1961-12-09T00:00:00Z', dissolved: null });
  // Caught up: the saved value is forgotten, so a later change on Wikidata shows as it is.
  assert.deepEqual(withRecentOfficeDates(OFFICE, { inception: '1961-12-09T00:00:00Z', dissolved: null }), { inception: '1961-12-09T00:00:00Z', dissolved: null });
  assert.deepEqual(withRecentOfficeDates(OFFICE, cached), cached);
});

test('saving one office date leaves the other as Wikidata has it', () => {
  recordOfficeDates(OFFICE, { dissolved: '2023' });
  assert.deepEqual(withRecentOfficeDates(OFFICE, { inception: '1961-12-09T00:00:00Z', dissolved: null }), { inception: '1961-12-09T00:00:00Z', dissolved: '2023-01-01T00:00:00Z' });
});
