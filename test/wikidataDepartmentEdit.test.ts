import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditInputError } from '../src/services/wikidataEdits';
import { departmentEditHasWork, parseDepartmentEdit, planDepartmentEdit } from '../src/services/wikidataDepartmentEdit';
import { getDepartmentOverride, setDepartmentOverride, setPublishedDepartment } from '../src/store/departmentStore';

const DEPT = 'Q1';
const timeClaim = (id: string, property: string, time: string, precision: number, references: any[] = []) => ({
  id, rank: 'normal', type: 'statement', references,
  mainsnak: { snaktype: 'value', property, datavalue: { type: 'time', value: { time, precision, timezone: 0, before: 0, after: 0, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } } },
});
const dept = (claims: Record<string, any[]> = {}, extra: any = {}) => ({
  id: DEPT, lastrevid: 500, labels: { en: { value: 'Department of Widgets' } }, sitelinks: { enwiki: { title: 'Department of Widgets' } }, claims, ...extra,
});
const plan = (body: any, entity: any = dept()) =>
  planDepartmentEdit(parseDepartmentEdit({ departmentQid: DEPT, ...body }), new Map([[DEPT, entity]]));

test('a changed inception replaces the value on the existing statement, dropping references to the old date', () => {
  const p = plan({ inception: '2023-02-07' }, dept({ P571: [timeClaim('S1', 'P571', '+2023-02-06T00:00:00Z', 11, [{}, {}])] }));
  assert.deepEqual(p.fields.map((f) => [f.field, f.from, f.to, f.statementId, f.referencesDropped]), [['P571', '2023-02-06', '2023-02-07', 'S1', 2]]);
  assert.equal(departmentEditHasWork(p), true);
});

test('an inception Wikidata lacks is added as a new statement', () => {
  const p = plan({ inception: '2023' });
  assert.deepEqual(p.fields.map((f) => [f.field, f.from, f.to, f.statementId]), [['P571', null, '2023', undefined]]);
});

test('the date the form shows for a year-precision value counts as unchanged', () => {
  const entity = dept({ P571: [timeClaim('S1', 'P571', '+1950-00-00T00:00:00Z', 9)] });
  // The query service pads 1950 to 1950-01-01, which is what the dialog prefills.
  assert.deepEqual(plan({ inception: '1950-01-01' }, entity).fields, []);
  assert.deepEqual(plan({ inception: '1950' }, entity).fields, []);
});

test('blank fields leave Wikidata alone', () => {
  const p = plan({ label: '', wikipediaTitle: '', inception: '', dissolved: '' }, dept({ P571: [timeClaim('S1', 'P571', '+1950-00-00T00:00:00Z', 9)] }));
  assert.deepEqual(p.fields, []);
  assert.equal(departmentEditHasWork(p), false);
});

test('a new label and Wikipedia article are set; the same article written with underscores is not', () => {
  const p = plan({ label: 'Department for Widgets', wikipediaTitle: 'Department_of_Widgets', dissolved: '2024-01-01' });
  assert.deepEqual(p.fields.map((f) => [f.field, f.from, f.to]), [
    ['label', 'Department of Widgets', 'Department for Widgets'],
    ['P576', null, '2024-01-01'],
  ]);
  const moved = plan({ wikipediaTitle: 'Department for Widgets' });
  assert.deepEqual(moved.fields.map((f) => [f.field, f.to]), [['wikipedia', 'Department for Widgets']]);
});

test('several statements for a date are left for Wikidata itself, unless one already matches', () => {
  const entity = dept({ P571: [timeClaim('S1', 'P571', '+1950-00-00T00:00:00Z', 9), timeClaim('S2', 'P571', '+1951-00-00T00:00:00Z', 9)] });
  assert.throws(() => plan({ inception: '1952' }, entity), EditInputError);
  assert.deepEqual(plan({ inception: '1951' }, entity).fields, []);
});

test('field changes and links go into one plan, with links still optional', () => {
  const p = planDepartmentEdit(
    parseDepartmentEdit({ departmentQid: DEPT, inception: '2023-02-07', formedFrom: [{ relation: 'P1365', qid: 'Q2' }] }),
    new Map([[DEPT, dept()], ['Q2', { id: 'Q2', lastrevid: 9, labels: {}, claims: {} }]]),
  );
  assert.deepEqual(p.fields.map((f) => f.field), ['P571']);
  assert.deepEqual(p.succession.sides.map((s) => s.entityQid), [DEPT, 'Q2']);
});

test('dissolved before inception is refused', () => {
  assert.throws(() => parseDepartmentEdit({ departmentQid: DEPT, inception: '2024', dissolved: '2023' }), EditInputError);
});

test('published values show over the cached ones and replace a local edit of the same field', () => {
  setDepartmentOverride('Q901', { label: 'Local name', wikipediaTitle: 'Local title' });
  setPublishedDepartment('Q901', { inception: '2023-02-07', label: 'Published name' });
  assert.deepEqual(getDepartmentOverride('Q901'), { wikipediaTitle: 'Local title', inception: '2023-02-07', label: 'Published name' });
});
