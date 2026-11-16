import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRedirects } from '../src/services/wikidataClient';
import { withRedirectsResolved } from '../src/services/orgchart';
import { assembleDepartments } from '../src/services/departments';
import { addExtraDepartment } from '../src/store/departmentStore';
import { OrgChartPosition } from '../src/types';

const entity = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });

// Q142154519 (a duplicate "Minister for Transport") was merged into Q142154047; Q142154420 (a
// duplicate ministry) into Q14866869. The query service records each as "old owl:sameAs new".
const REDIRECTS: Record<string, string> = { Q142154519: 'Q142154047', Q142154420: 'Q14866869' };

beforeEach(() => {
  mock.method(console, 'log', () => {});
  mock.method(globalThis, 'fetch', async (url: string) => {
    const query = decodeURIComponent(String(url));
    const asked = [...(query.match(/VALUES \?item \{([^}]*)\}/)?.[1].matchAll(/wd:(Q\d+)/g) ?? [])].map((m) => m[1]);
    const bindings = asked.filter((q) => REDIRECTS[q]).map((q) => ({ item: entity(q), target: entity(REDIRECTS[q]) }));
    return new Response(JSON.stringify({ results: { bindings } }));
  });
});

afterEach(() => mock.restoreAll());

const position = (id: string, qid: string | null, title: string): OrgChartPosition => ({
  id, title, department: 'x', bucket: 'Minister', wikipediaTitle: null, wikidataQid: qid, dynamic: true, inception: null, dissolved: null,
});

test('a merged item resolves to the item it redirects to; others to themselves', async () => {
  const result = await resolveRedirects(['Q142154519', 'Q142154047', 'Q5']);
  assert.deepEqual([...result], [['Q142154519', 'Q142154047'], ['Q142154047', 'Q142154047'], ['Q5', 'Q5']]);
});

test('an added office stored as a merged item takes the item it became, and a duplicate is dropped', async () => {
  const positions = await withRedirectsResolved([
    position('Q142154047', 'Q142154047', 'Minister for Transport'),
    position('local-transport-ab12', 'Q142154519', 'Minister for Transport (added)'),
    position('local-widgets-cd34', 'Q142154420', 'Minister of Widgets'),
    position('local-nothing-ef56', null, 'Office with no item'),
  ]);
  assert.deepEqual(positions.map((p) => [p.id, p.wikidataQid, p.title]), [
    ['Q142154047', 'Q142154047', 'Minister for Transport'],
    ['local-widgets-cd34', 'Q14866869', 'Minister of Widgets'],
    ['local-nothing-ef56', null, 'Office with no item'],
  ]);
});

test('an added department stored as a merged item is listed as the item it became, once', () => {
  const dept = (qid: string, label: string) => ({ qid, label, wikipediaTitle: null, inception: null, dissolved: null, heads: [], offices: [], vacant: [] });
  addExtraDepartment('Q924', dept('Q142154420', 'Ministry of Transport (duplicate)'));
  addExtraDepartment('Q924', dept('Q14866869', 'Ministry of Transport'));
  const view = assembleDepartments({
    date: new Date('2026-11-14'), country: 'Q924', cabinet: [], links: [], details: new Map(), offices: [],
    lifespans: new Map(), history: [], deputyPairs: [], redirects: new Map([['Q142154420', 'Q14866869']]),
  });
  assert.deepEqual(view.departments.map((d) => d.qid), ['Q14866869']);
});
