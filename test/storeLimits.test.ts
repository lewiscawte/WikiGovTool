import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPosition, listPositions } from '../src/store/positionStore';
import { addExtraPosition, listExtraPositions } from '../src/store/extraPositionsStore';
import { addLocalOfficeholder } from '../src/store/officeholderStore';

const stub = (id: string, title = 'Office') => ({ id, title, department: 'Dept', wikipediaTitle: '', wikidataQid: null });
const holder = (personQid: string) => ({
  personQid, personName: 'Person', wikipediaTitle: null, imageUrl: null, startDate: null, endDate: null, birth: null, death: null,
});

// These stores are shared by every user and only cleared by a restart, so writes must be capped.
test('positionStore stops accepting new offices once full', () => {
  const start = listPositions().length;
  assert.throws(() => {
    for (let i = 0; i < 5000; i++) addPosition(stub(`local-cap-${i}`));
  });
  assert.ok(listPositions().length - start <= 1000, `store grew by ${listPositions().length - start}`);
});

test('extraPositionsStore stops accepting new offices once full', () => {
  assert.throws(() => {
    for (let i = 0; i < 5000; i++) addExtraPosition(`Q${1000 + (i % 7)}`, stub(`local-extra-${i}`));
  });
  const total = [0, 1, 2, 3, 4, 5, 6].reduce((n, k) => n + listExtraPositions(`Q${1000 + k}`).length, 0);
  assert.ok(total <= 1000, `store holds ${total}`);
});

test('officeholderStore stops accepting new fills once full', () => {
  assert.throws(() => {
    for (let i = 0; i < 5000; i++) addLocalOfficeholder(`local-office-${i}`, holder(`Q${i + 1}`));
  });
});

test('office stubs reject over-long text', () => {
  assert.throws(() => addPosition(stub('local-long', 'x'.repeat(90000))));
  assert.throws(() => addExtraPosition('Q145', stub('local-long-2', 'x'.repeat(90000))));
});
