import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditInputError, formatTime, parseDateInput, planTermEdit } from '../src/services/wikidataEdits';

const timeSnak = (hash: string, time: string, precision: number) => ({
  snaktype: 'value', property: 'P580', hash,
  datavalue: { type: 'time', value: { time, precision, timezone: 0, before: 0, after: 0, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } },
});

const p39 = (id: string, positionQid: string, qualifiers: Record<string, any[]> = {}) => ({
  id, rank: 'normal', type: 'statement',
  mainsnak: { snaktype: 'value', property: 'P39', datavalue: { type: 'wikibase-entityid', value: { 'entity-type': 'item', id: positionQid, 'numeric-id': Number(positionQid.slice(1)) } } },
  qualifiers,
});

const person = (claims: any[]) => ({ id: 'Q1297519', lastrevid: 1000, labels: { en: { value: 'Oscar L. Chapman' } }, claims: { P39: claims } });

test('parseDateInput keeps the precision the user typed', () => {
  assert.deepEqual(parseDateInput('1950-01-19', 'Took office'), { time: '+1950-01-19T00:00:00Z', precision: 11 });
  assert.deepEqual(parseDateInput('1950-01', 'Took office'), { time: '+1950-01-00T00:00:00Z', precision: 10 });
  assert.deepEqual(parseDateInput('1950', 'Took office'), { time: '+1950-00-00T00:00:00Z', precision: 9 });
  assert.equal(parseDateInput('  ', 'Took office'), null);
});

test('parseDateInput rejects malformed, impossible and pre-Gregorian dates', () => {
  for (const bad of ['19 January 1950', '1950-13-01', '1950-02-30', '1500-01-01', '50-01-01']) {
    assert.throws(() => parseDateInput(bad, 'Took office'), EditInputError, bad);
  }
});

test('formatTime renders at the value\'s own precision', () => {
  assert.equal(formatTime({ time: '+1950-01-19T00:00:00Z', precision: 11 }), '1950-01-19');
  assert.equal(formatTime({ time: '+1950-01-00T00:00:00Z', precision: 10 }), '1950-01');
  assert.equal(formatTime({ time: '+1950-00-00T00:00:00Z', precision: 9 }), '1950');
});

test('an undated statement gets both qualifiers added', () => {
  const plan = planTermEdit(person([p39('S1', 'Q2287650')]), 'Q2287650',
    parseDateInput('1950-01-19', 's'), parseDateInput('1953-01-20', 'e'));
  assert.equal(plan.statementId, 'S1');
  assert.equal(plan.baseRevId, 1000);
  assert.deepEqual(plan.changes.map((c) => [c.property, c.from, c.to, c.snakhash]), [
    ['P580', null, '1950-01-19', undefined],
    ['P582', null, '1953-01-20', undefined],
  ]);
});

test('a differing qualifier is replaced by hash, an identical one is left alone', () => {
  const claim = p39('S1', 'Q2287650', {
    P580: [timeSnak('h-start', '+1950-01-19T00:00:00Z', 11)],
    P582: [timeSnak('h-end', '+1953-00-00T00:00:00Z', 9)],
  });
  const plan = planTermEdit(person([claim]), 'Q2287650', parseDateInput('1950-01-19', 's'), parseDateInput('1953-01-20', 'e'));
  assert.deepEqual(plan.changes.map((c) => [c.property, c.from, c.to, c.snakhash]), [['P582', '1953', '1953-01-20', 'h-end']]);
});

test('an empty date never touches Wikidata\'s value', () => {
  const claim = p39('S1', 'Q2287650', { P582: [timeSnak('h-end', '+1953-01-20T00:00:00Z', 11)] });
  const plan = planTermEdit(person([claim]), 'Q2287650', parseDateInput('1950-01-19', 's'), null);
  assert.deepEqual(plan.changes.map((c) => c.property), ['P580']);
});

test('statements for other offices are ignored; no statement for the office means creating one', () => {
  const plan = planTermEdit(person([p39('S9', 'Q999')]), 'Q2287650', parseDateInput('1950', 's'), null);
  assert.deepEqual(plan.candidates, []);
  assert.equal(plan.statementId, null);
  assert.equal(plan.needsChoice, false);
  assert.equal(plan.changes.length, 1);
});

test('several statements for the office need the user to choose, then plan against the choice', () => {
  const entity = person([p39('S1', 'Q2287650'), p39('S2', 'Q2287650', { P580: [timeSnak('h', '+1960-00-00T00:00:00Z', 9)] })]);
  const ask = planTermEdit(entity, 'Q2287650', parseDateInput('1950', 's'), null);
  assert.equal(ask.needsChoice, true);
  assert.equal(ask.changes.length, 0);
  assert.deepEqual(ask.candidates.map((c) => [c.id, c.start]), [['S1', null], ['S2', '1960']]);

  const chosen = planTermEdit(entity, 'Q2287650', parseDateInput('1950', 's'), null, 'S2');
  assert.equal(chosen.statementId, 'S2');
  assert.deepEqual(chosen.changes.map((c) => [c.from, c.to, c.snakhash]), [['1960', '1950', 'h']]);
});

test('a statement id that isn\'t one of the office\'s statements is refused', () => {
  assert.throws(() => planTermEdit(person([p39('S1', 'Q2287650')]), 'Q2287650', parseDateInput('1950', 's'), null, 'S9'), EditInputError);
});

test('an "unknown value" qualifier is shown as such and replaced', () => {
  const claim = p39('S1', 'Q2287650', { P582: [{ snaktype: 'somevalue', property: 'P582', hash: 'h-unk' }] });
  const plan = planTermEdit(person([claim]), 'Q2287650', null, parseDateInput('1953-01-20', 'e'));
  assert.deepEqual(plan.changes.map((c) => [c.from, c.snakhash]), [['unknown value', 'h-unk']]);
});

const chapmanRev = { title: 'Oscar L. Chapman', revid: 1234567 };
const chapmanUrl = 'https://en.wikipedia.org/w/index.php?title=Oscar_L._Chapman&oldid=1234567';

test('a changed value copied from Wikipedia is cited once, by exact revision', () => {
  const plan = planTermEdit(person([p39('S1', 'Q2287650')]), 'Q2287650',
    parseDateInput('1950-01-19', 's'), parseDateInput('1953-01-20', 'e'), null, { P580: chapmanRev, P582: chapmanRev });
  assert.deepEqual(plan.references, [{ ...chapmanRev, url: chapmanUrl }]);
});

test('values typed by hand, or unchanged, are not cited', () => {
  const claim = p39('S1', 'Q2287650', { P580: [timeSnak('h', '+1950-01-19T00:00:00Z', 11)] });
  const unchanged = planTermEdit(person([claim]), 'Q2287650', parseDateInput('1950-01-19', 's'), parseDateInput('1953', 'e'), null, { P580: chapmanRev });
  assert.deepEqual(unchanged.references, []);
  const typed = planTermEdit(person([p39('S1', 'Q2287650')]), 'Q2287650', parseDateInput('1950', 's'), null);
  assert.deepEqual(typed.references, []);
});

test('a revision the statement already cites is not cited again', () => {
  const claim = { ...p39('S1', 'Q2287650'), references: [{ snaks: { P4656: [{ snaktype: 'value', datavalue: { type: 'string', value: chapmanUrl } }] } }] };
  const plan = planTermEdit(person([claim]), 'Q2287650', parseDateInput('1950', 's'), null, null, { P580: chapmanRev });
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.references, []);
});
