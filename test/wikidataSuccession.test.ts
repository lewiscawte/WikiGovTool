import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditInputError } from '../src/services/wikidataEdits';
import { parseSuccession, planSuccession, statementData, successionHasWork } from '../src/services/wikidataSuccession';

// DSIT (Q1) formed in 2023 from part of BEIS (Q2, which ended) and part of DCMS (Q3, which carried on).
const DSIT = 'Q1';
const BEIS = 'Q2';
const DCMS = 'Q3';
const DIGITAL = 'Q50';

const itemValue = (qid: string) => ({ type: 'wikibase-entityid', value: { 'entity-type': 'item', id: qid, 'numeric-id': Number(qid.slice(1)) } });
const claim = (property: string, qid: string, partQid?: string) => ({
  mainsnak: { snaktype: 'value', property, datavalue: itemValue(qid) },
  ...(partQid ? { qualifiers: { P518: [{ snaktype: 'value', property: 'P518', datavalue: itemValue(partQid) }] } } : {}),
});
const entity = (id: string, label: string, claims: Record<string, any[]> = {}) => ({ id, lastrevid: Number(id.slice(1)) * 100, labels: { en: { value: label } }, claims });
const entities = (...list: any[]) => new Map(list.map((e) => [e.id, e]));

const dsitInput = () => parseSuccession({
  departmentQid: DSIT,
  formedFrom: [
    { relation: 'P1365', qid: BEIS, date: '2023-02-07' },
    { relation: 'P807', qid: DCMS, partQid: DIGITAL, date: '2023-02-07' },
  ],
  sourceUrl: 'https://www.gov.uk/machinery-of-government',
});

test('a department formed from parts of two others gets a statement for each, and replaces is mirrored', () => {
  const plan = planSuccession(dsitInput(), entities(entity(DSIT, 'DSIT'), entity(BEIS, 'BEIS'), entity(DCMS, 'DCMS')));
  const summary = plan.sides.map((s) => [s.entityQid, s.baseRevId, s.statements.map((st) => [st.property, st.valueQid, st.partQid, st.dateText, st.existing])]);
  assert.deepEqual(summary, [
    [DSIT, 100, [['P1365', BEIS, null, '2023-02-07', false], ['P807', DCMS, DIGITAL, '2023-02-07', false]]],
    // separated from has no inverse, so DCMS isn't touched.
    [BEIS, 200, [['P1366', DSIT, null, '2023-02-07', false]]],
  ]);
  assert.equal(successionHasWork(plan), true);
});

test('statements already on Wikidata are shown but not sent, on either side', () => {
  const plan = planSuccession(dsitInput(), entities(
    entity(DSIT, 'DSIT', { P1365: [claim('P1365', BEIS)] }),
    entity(BEIS, 'BEIS', { P1366: [claim('P1366', DSIT)] }),
    entity(DCMS, 'DCMS'),
  ));
  assert.deepEqual(plan.sides.flatMap((s) => s.statements.map((st) => [s.entityQid, st.property, st.existing])), [
    [DSIT, 'P1365', true], [DSIT, 'P807', false], [BEIS, 'P1366', true],
  ]);
});

test('a link to the same department for a different part is a new statement', () => {
  const input = parseSuccession({ departmentQid: DSIT, formedFrom: [{ relation: 'P807', qid: DCMS, partQid: 'Q51' }] });
  const plan = planSuccession(input, entities(entity(DSIT, 'DSIT', { P807: [claim('P807', DCMS, DIGITAL)] }), entity(DCMS, 'DCMS')));
  assert.equal(plan.sides[0].statements[0].existing, false);
  // Without a part, any statement for that department counts as already there.
  const plain = parseSuccession({ departmentQid: DSIT, formedFrom: [{ relation: 'P807', qid: DCMS }] });
  assert.equal(planSuccession(plain, entities(entity(DSIT, 'DSIT', { P807: [claim('P807', DCMS, DIGITAL)] }), entity(DCMS, 'DCMS'))).sides[0].statements[0].existing, true);
});

test('a department split several ways gets replaced by for each, and each successor replaces it', () => {
  const input = parseSuccession({
    departmentQid: BEIS,
    dissolvedInto: [{ relation: 'P1366', qid: DSIT }, { relation: 'P1366', qid: 'Q4' }, { relation: 'P7888', qid: 'Q5' }],
  });
  const plan = planSuccession(input, entities(entity(BEIS, 'BEIS'), entity(DSIT, 'DSIT'), entity('Q4', 'DESNZ'), entity('Q5', 'DBT')));
  assert.deepEqual(plan.sides.map((s) => [s.entityQid, s.statements.map((st) => `${st.property}:${st.valueQid}`)]), [
    [BEIS, ['P1366:Q1', 'P1366:Q4', 'P7888:Q5']],
    [DSIT, ['P1365:Q2']],
    ['Q4', ['P1365:Q2']],
  ]);
});

test('a statement carries applies to part and point in time as qualifiers, and the source as a reference', () => {
  const plan = planSuccession(dsitInput(), entities(entity(DSIT, 'DSIT'), entity(BEIS, 'BEIS'), entity(DCMS, 'DCMS')));
  const data: any = statementData(plan.sides[0].statements[1], plan.sourceUrl);
  assert.equal(data.mainsnak.property, 'P807');
  assert.equal(data.mainsnak.datavalue.value.id, DCMS);
  assert.deepEqual(data['qualifiers-order'], ['P518', 'P585']);
  assert.equal(data.qualifiers.P518[0].datavalue.value.id, DIGITAL);
  assert.equal(data.qualifiers.P585[0].datavalue.value.time, '+2023-02-07T00:00:00Z');
  assert.equal(data.references[0].snaks.P854[0].datavalue.value, 'https://www.gov.uk/machinery-of-government');
  assert.equal((statementData(plan.sides[1].statements[0], null) as any).references, undefined);
});

test('relations must fit the list they are in, and items, dates and URLs are checked', () => {
  const bad = [
    { departmentQid: DSIT },
    { departmentQid: 'DSIT', formedFrom: [{ relation: 'P1365', qid: BEIS }] },
    { departmentQid: DSIT, formedFrom: [{ relation: 'P1366', qid: BEIS }] },
    { departmentQid: DSIT, dissolvedInto: [{ relation: 'P807', qid: BEIS }] },
    { departmentQid: DSIT, formedFrom: [{ relation: 'P1365', qid: DSIT }] },
    { departmentQid: DSIT, formedFrom: [{ relation: 'P1365', qid: BEIS, partQid: 'digital' }] },
    { departmentQid: DSIT, formedFrom: [{ relation: 'P1365', qid: BEIS, date: 'February 2023' }] },
    { departmentQid: DSIT, formedFrom: [{ relation: 'P1365', qid: BEIS }], sourceUrl: 'javascript:alert(1)' },
    { departmentQid: DSIT, formedFrom: Array.from({ length: 11 }, (_, i) => ({ relation: 'P1365', qid: `Q${i + 10}` })) },
  ];
  for (const body of bad) assert.throws(() => parseSuccession(body), EditInputError, JSON.stringify(body));
});

test('a department missing from Wikidata is refused', () => {
  assert.throws(() => planSuccession(dsitInput(), entities(entity(DSIT, 'DSIT'), entity(BEIS, 'BEIS'))), EditInputError);
});
