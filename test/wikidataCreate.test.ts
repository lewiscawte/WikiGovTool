import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditInputError } from '../src/services/wikidataEdits';
import { buildNewItem, parseNewItem, plannedStatements, referencedItems } from '../src/services/wikidataCreate';

const mainValues = (data: any) => data.claims.map((c: any) => [c.mainsnak.property, c.mainsnak.datavalue.value.id ?? c.mainsnak.datavalue.value.time ?? c.mainsnak.datavalue.value]);

test('a person is a human politician, citizen of the country, with only the fields filled in', () => {
  const item = parseNewItem({ kind: 'person', countryQid: 'Q924', label: 'Jane Doe', description: 'Tanzanian politician', genderQid: 'Q6581072', birthDate: '1970-05-01' });
  const data: any = buildNewItem(item);
  assert.deepEqual(data.labels, { en: { language: 'en', value: 'Jane Doe' } });
  assert.deepEqual(data.descriptions, { en: { language: 'en', value: 'Tanzanian politician' } });
  assert.equal(data.sitelinks, undefined);
  assert.deepEqual(mainValues(data), [
    ['P31', 'Q5'], ['P106', 'Q82955'], ['P27', 'Q924'], ['P21', 'Q6581072'], ['P569', '+1970-05-01T00:00:00Z'],
  ]);
});

test('unticked occupation and citizenship are left off', () => {
  const item = parseNewItem({ kind: 'person', countryQid: 'Q924', label: 'Jane Doe', description: 'judge', politician: false, citizen: false });
  assert.deepEqual(plannedStatements(item).map((s) => s.property), ['P31']);
});

test('a person holding an office gets position held with the term as qualifiers', () => {
  const item = parseNewItem({
    kind: 'person', countryQid: 'Q924', label: 'Jane Doe', description: 'politician',
    heldPositionQid: 'Q16147337', heldStart: '2025-11-04', heldEnd: '',
  });
  const p39 = (buildNewItem(item) as any).claims.find((c: any) => c.mainsnak.property === 'P39');
  assert.equal(p39.mainsnak.datavalue.value.id, 'Q16147337');
  assert.deepEqual(p39['qualifiers-order'], ['P580']);
  assert.equal(p39.qualifiers.P580[0].datavalue.value.time, '+2025-11-04T00:00:00Z');
  assert.equal(p39.qualifiers.P580[0].datavalue.value.precision, 11);
});

test('the source URL is cited on every statement except what kind of thing it is', () => {
  const item = parseNewItem({ kind: 'person', countryQid: 'Q924', label: 'Jane Doe', description: 'politician', sourceUrl: 'https://example.org/jane' });
  const claims = (buildNewItem(item) as any).claims;
  assert.equal(claims[0].references, undefined);
  for (const c of claims.slice(1)) {
    assert.deepEqual(c.references, [{ snaks: { P854: [{ snaktype: 'value', property: 'P854', datavalue: { type: 'string', value: 'https://example.org/jane' } }] } }]);
  }
});

test('an office is a position, subclass of the chosen class, in the country, so the tool finds it', () => {
  const item = parseNewItem({
    kind: 'office', countryQid: 'Q924', label: 'Minister of Widgets', description: 'government position in Tanzania',
    officeClassQid: 'Q83307', departmentQid: 'Q42', wikipediaTitle: 'Minister of Widgets (Tanzania)',
  });
  const data: any = buildNewItem(item);
  assert.deepEqual(mainValues(data), [['P31', 'Q4164871'], ['P279', 'Q83307'], ['P1001', 'Q924'], ['P17', 'Q924'], ['P2389', 'Q42']]);
  assert.deepEqual(data.sitelinks, { enwiki: { site: 'enwiki', title: 'Minister of Widgets (Tanzania)' } });
  assert.deepEqual(referencedItems(item), ['Q4164871', 'Q83307', 'Q924', 'Q42']);
});

test('a department takes the country\'s own class where it has one, and a website', () => {
  const item = parseNewItem({
    kind: 'department', countryQid: 'Q145', label: 'Department for Widgets', description: 'government department in the United Kingdom',
    departmentClassQid: 'Q2500378', headOfficeQid: 'Q7', website: 'https://www.gov.uk/widgets',
  });
  assert.deepEqual(mainValues(buildNewItem(item)), [['P31', 'Q2500378'], ['P17', 'Q145'], ['P2388', 'Q7'], ['P856', 'https://www.gov.uk/widgets']]);
});

test('only the listed choices are accepted', () => {
  const base = { countryQid: 'Q924', label: 'X', description: 'y' };
  const bad = [
    { ...base, kind: 'robot' },
    { ...base, kind: 'office', officeClassQid: 'Q5' },
    { ...base, kind: 'department', departmentClassQid: 'Q2500378' }, // the UK's class, not Tanzania's
    { ...base, kind: 'person', genderQid: 'Q1' },
  ];
  for (const body of bad) assert.throws(() => parseNewItem(body), EditInputError, JSON.stringify(body));
});

test('labels, item ids, dates and URLs are checked', () => {
  const person = { kind: 'person', countryQid: 'Q924', label: 'Jane Doe', description: 'politician' };
  const bad = [
    { ...person, label: '  ' },
    { ...person, description: 'jane doe' },
    { ...person, label: 'x'.repeat(251) },
    { ...person, partyQid: 'Labour' },
    { ...person, birthDate: '5 May 1970' },
    { ...person, countryQid: 'UK' },
    { ...person, sourceUrl: 'javascript:alert(1)' },
    { ...person, heldPositionQid: 'Q1', heldStart: '2020', heldEnd: '2019' },
  ];
  for (const body of bad) assert.throws(() => parseNewItem(body), EditInputError, JSON.stringify(body));
});

test('fields that belong to another kind are ignored', () => {
  const item = parseNewItem({ kind: 'person', countryQid: 'Q924', label: 'Jane Doe', description: 'politician', officeClassQid: 'Q83307', website: 'https://x.org' });
  assert.deepEqual(plannedStatements(item).map((s) => s.property), ['P31', 'P106', 'P27']);
});
