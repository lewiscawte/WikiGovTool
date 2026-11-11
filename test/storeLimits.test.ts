import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ENTRIES_PER_STORE, StoreLimitError } from '../src/store/limits';
import { addPosition, listPositions } from '../src/store/positionStore';
import { addExtraPosition, listExtraPositions } from '../src/store/extraPositionsStore';
import { addLocalOfficeholder } from '../src/store/officeholderStore';
import { addExtraDepartment, listExtraDepartments, setDepartmentOverride } from '../src/store/departmentStore';

const stub = (id: string, title = 'Office') => ({ id, title, department: 'Dept', wikipediaTitle: '', wikidataQid: null });
const isFull = (e: unknown) => e instanceof StoreLimitError && e.status === 507;
const isTooLong = (e: unknown) => e instanceof StoreLimitError && e.status === 400;
const holder = (personQid: string) => ({
  personQid, personName: 'Person', wikipediaTitle: null, imageUrl: null, startDate: null, endDate: null, birth: null, death: null,
});

// These stores are shared by every user and only cleared by a restart, so writes must be capped.
test('positionStore stops accepting new offices once full', () => {
  const start = listPositions().length;
  assert.throws(() => {
    for (let i = 0; i < 5000; i++) addPosition(stub(`local-cap-${i}`));
  }, isFull);
  assert.ok(listPositions().length - start <= 1000, `store grew by ${listPositions().length - start}`);
});

test('extraPositionsStore stops accepting new offices once full', () => {
  assert.throws(() => {
    for (let i = 0; i < 5000; i++) addExtraPosition(`Q${1000 + (i % 7)}`, stub(`local-extra-${i}`));
  }, isFull);
  const total = [0, 1, 2, 3, 4, 5, 6].reduce((n, k) => n + listExtraPositions(`Q${1000 + k}`).length, 0);
  assert.ok(total <= 1000, `store holds ${total}`);
});

test('officeholderStore stops accepting new fills once full', () => {
  let accepted = 0;
  assert.throws(() => {
    for (let i = 0; i < 5000; i++) {
      addLocalOfficeholder(`local-office-${i}`, holder(`Q${i + 1}`));
      accepted++;
    }
  }, isFull);
  assert.ok(accepted <= MAX_ENTRIES_PER_STORE, `accepted ${accepted} fills`);
});

test('office stubs reject over-long text', () => {
  assert.throws(() => addPosition(stub('local-long', 'x'.repeat(90000))), isTooLong);
  assert.throws(() => addExtraPosition('Q145', stub('local-long-2', 'x'.repeat(90000))), isTooLong);
});

const dept = (qid: string, label = 'Department') => ({
  qid, label, wikipediaTitle: null, inception: null, dissolved: null, heads: [], offices: [], vacant: [],
});

test('departmentStore stops accepting new departments once full', () => {
  assert.throws(() => {
    for (let i = 0; i < 5000; i++) addExtraDepartment(`Q${2000 + (i % 5)}`, dept(`local-dept-cap-${i}`));
  }, isFull);
  const total = [0, 1, 2, 3, 4].reduce((n, k) => n + listExtraDepartments(`Q${2000 + k}`).length, 0);
  assert.ok(total <= 1000, `store holds ${total}`);
});

test('departmentStore stops accepting new overrides once full, but still updates existing ones', () => {
  setDepartmentOverride('local-kept', { label: 'Before' });
  let accepted = 0;
  assert.throws(() => {
    for (let i = 0; i < 5000; i++) {
      setDepartmentOverride(`local-override-cap-${i}`, { label: 'x' });
      accepted++;
    }
  }, isFull);
  assert.ok(accepted <= MAX_ENTRIES_PER_STORE, `accepted ${accepted} overrides`);
  assert.doesNotThrow(() => setDepartmentOverride('local-kept', { label: 'After' }));
});

test('departments reject over-long text', () => {
  assert.throws(() => addExtraDepartment('Q145', dept('local-long', 'x'.repeat(90000))), isTooLong);
  assert.throws(() => setDepartmentOverride('Q1', { dissolved: 'x'.repeat(90000) }), isTooLong);
});
