import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntry } from '../src/services/orgchart';
import { addLocalOfficeholder, LocalOfficeholder } from '../src/store/officeholderStore';
import { OrgChartPosition } from '../src/types';
import { PositionHistoryRow } from '../src/services/wikidataClient';

const position = (qid: string | null, id = qid ?? 'local-office'): OrgChartPosition => ({
  id,
  title: 'Secretary of Widgets',
  department: 'Widgets',
  bucket: 'Minister',
  wikipediaTitle: null,
  wikidataQid: qid,
  dynamic: false,
  inception: null,
  dissolved: null,
});

const holder = (personQid: string, overrides: Partial<LocalOfficeholder> = {}): LocalOfficeholder => ({
  personQid,
  personName: `Person ${personQid}`,
  wikipediaTitle: null,
  imageUrl: null,
  startDate: null,
  endDate: null,
  birth: null,
  death: null,
  ...overrides,
});

test('a local officeholder fills an office Wikidata has no holder for, marked as local', () => {
  addLocalOfficeholder('Q100', holder('Q500'));
  const entry = buildEntry(position('Q100'), [], new Date('2026-01-01'));
  assert.equal(entry.officeholder?.personWikidataQid, 'Q500');
  assert.equal(entry.officeholder?.local, true);
});

test('a Wikidata holder wins over a local one', () => {
  addLocalOfficeholder('Q101', holder('Q501'));
  const history: PositionHistoryRow[] = [{
    positionQid: 'Q101', personQid: 'Q601', personLabel: 'On Wikidata', partyLabel: null,
    start: '2025-01-01T00:00:00Z', end: null, imageUrl: null,
  }];
  const entry = buildEntry(position('Q101'), history, new Date('2026-01-01'));
  assert.equal(entry.officeholder?.personWikidataQid, 'Q601');
  assert.equal(entry.officeholder?.local, undefined);
});

test('a local officeholder only shows inside their tenure and lifetime', () => {
  addLocalOfficeholder('Q102', holder('Q502', { startDate: '2020-01-01', endDate: '2024-12-31' }));
  addLocalOfficeholder('Q103', holder('Q503', { birth: '1950-01-01T00:00:00Z', death: '2010-01-01T00:00:00Z' }));
  const on = (qid: string, date: string) => buildEntry(position(qid), [], new Date(date)).officeholder?.personWikidataQid ?? null;
  assert.equal(on('Q102', '2019-06-01'), null);
  assert.equal(on('Q102', '2022-06-01'), 'Q502');
  assert.equal(on('Q102', '2025-06-01'), null);
  assert.equal(on('Q103', '1949-06-01'), null);
  assert.equal(on('Q103', '2000-06-01'), 'Q503');
  assert.equal(on('Q103', '2011-06-01'), null);
});

test('an office with no Wikidata item is keyed by its local id', () => {
  addLocalOfficeholder('local-widgets-ab12', holder('Q504'));
  const entry = buildEntry(position(null, 'local-widgets-ab12'), [], new Date('2026-01-01'));
  assert.equal(entry.officeholder?.personWikidataQid, 'Q504');
});

test('the most recently added fill wins where two overlap', () => {
  addLocalOfficeholder('Q105', holder('Q505'));
  addLocalOfficeholder('Q105', holder('Q506'));
  assert.equal(buildEntry(position('Q105'), [], new Date('2026-01-01')).officeholder?.personWikidataQid, 'Q506');
});
