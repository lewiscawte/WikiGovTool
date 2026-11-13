import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditInputError, formatTime, parseDateInput, planHasWork, planTermEdit } from '../src/services/wikidataEdits';

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

const p1308 = (id: string, personQid: string, qualifiers: Record<string, any[]> = {}) => ({
  ...p39(id, personQid, qualifiers),
  mainsnak: { snaktype: 'value', property: 'P1308', datavalue: { type: 'wikibase-entityid', value: { 'entity-type': 'item', id: personQid, 'numeric-id': Number(personQid.slice(1)) } } },
});

const office = (claims: any[] = []) => ({ id: 'Q2287650', lastrevid: 2000, labels: { en: { value: 'United States Secretary of the Interior' } }, claims: { P1308: claims } });

const endSnak = (hash: string, time: string, precision: number) => ({ ...timeSnak(hash, time, precision), property: 'P582' });

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
  const plan = planTermEdit(person([p39('S1', 'Q2287650')]), office(),
    parseDateInput('1950-01-19', 's'), parseDateInput('1953-01-20', 'e'));
  assert.equal(plan.person.statementId, 'S1');
  assert.equal(plan.person.baseRevId, 1000);
  assert.deepEqual(plan.person.changes.map((c) => [c.property, c.from, c.to, c.snakhash]), [
    ['P580', null, '1950-01-19', undefined],
    ['P582', null, '1953-01-20', undefined],
  ]);
});

test('a differing qualifier is replaced by hash, an identical one is left alone', () => {
  const claim = p39('S1', 'Q2287650', {
    P580: [timeSnak('h-start', '+1950-01-19T00:00:00Z', 11)],
    P582: [timeSnak('h-end', '+1953-00-00T00:00:00Z', 9)],
  });
  const plan = planTermEdit(person([claim]), office(), parseDateInput('1950-01-19', 's'), parseDateInput('1953-01-20', 'e'));
  assert.deepEqual(plan.person.changes.map((c) => [c.property, c.from, c.to, c.snakhash]), [['P582', '1953', '1953-01-20', 'h-end']]);
});

test('an empty date never touches Wikidata\'s value', () => {
  const claim = p39('S1', 'Q2287650', { P582: [timeSnak('h-end', '+1953-01-20T00:00:00Z', 11)] });
  const plan = planTermEdit(person([claim]), office(), parseDateInput('1950-01-19', 's'), null);
  assert.deepEqual(plan.person.changes.map((c) => c.property), ['P580']);
});

test('statements for other offices are ignored; no statement for the office means creating one', () => {
  const plan = planTermEdit(person([p39('S9', 'Q999')]), office(), parseDateInput('1950', 's'), null);
  assert.deepEqual(plan.person.candidates, []);
  assert.equal(plan.person.statementId, null);
  assert.equal(plan.person.needsChoice, false);
  assert.equal(plan.person.changes.length, 1);
});

test('several statements for the office need the user to choose, then plan against the choice', () => {
  const entity = person([p39('S1', 'Q2287650'), p39('S2', 'Q2287650', { P580: [timeSnak('h', '+1960-00-00T00:00:00Z', 9)] })]);
  const ask = planTermEdit(entity, office(), parseDateInput('1950', 's'), null);
  assert.equal(ask.person.needsChoice, true);
  assert.equal(ask.person.changes.length, 0);
  assert.deepEqual(ask.person.candidates.map((c) => [c.id, c.start]), [['S1', null], ['S2', '1960']]);

  const chosen = planTermEdit(entity, office(), parseDateInput('1950', 's'), null, { person: 'S2' });
  assert.equal(chosen.person.statementId, 'S2');
  assert.deepEqual(chosen.person.changes.map((c) => [c.from, c.to, c.snakhash]), [['1960', '1950', 'h']]);
});

test('a statement id that isn\'t one of the office\'s statements is refused', () => {
  assert.throws(() => planTermEdit(person([p39('S1', 'Q2287650')]), office(), parseDateInput('1950', 's'), null, { person: 'S9' }), EditInputError);
});

test('an "unknown value" qualifier is shown as such and replaced', () => {
  const claim = p39('S1', 'Q2287650', { P582: [{ snaktype: 'somevalue', property: 'P582', hash: 'h-unk' }] });
  const plan = planTermEdit(person([claim]), office(), null, parseDateInput('1953-01-20', 'e'));
  assert.deepEqual(plan.person.changes.map((c) => [c.from, c.snakhash]), [['unknown value', 'h-unk']]);
});

const chapmanRev = { title: 'Oscar L. Chapman', revid: 1234567 };
const chapmanUrl = 'https://en.wikipedia.org/w/index.php?title=Oscar_L._Chapman&oldid=1234567';

test('a changed value copied from Wikipedia is cited once, by exact revision', () => {
  const plan = planTermEdit(person([p39('S1', 'Q2287650')]), office(),
    parseDateInput('1950-01-19', 's'), parseDateInput('1953-01-20', 'e'), {}, { P580: chapmanRev, P582: chapmanRev });
  assert.deepEqual(plan.person.references, [{ ...chapmanRev, url: chapmanUrl }]);
});

test('values typed by hand, or unchanged, are not cited', () => {
  const claim = p39('S1', 'Q2287650', { P580: [timeSnak('h', '+1950-01-19T00:00:00Z', 11)] });
  const unchanged = planTermEdit(person([claim]), office(), parseDateInput('1950-01-19', 's'), parseDateInput('1953', 'e'), {}, { P580: chapmanRev });
  assert.deepEqual(unchanged.person.references, []);
  const typed = planTermEdit(person([p39('S1', 'Q2287650')]), office(), parseDateInput('1950', 's'), null);
  assert.deepEqual(typed.person.references, []);
});

test('a revision the statement already cites is not cited again', () => {
  const claim = { ...p39('S1', 'Q2287650'), references: [{ snaks: { P4656: [{ snaktype: 'value', datavalue: { type: 'string', value: chapmanUrl } }] } }] };
  const plan = planTermEdit(person([claim]), office(), parseDateInput('1950', 's'), null, {}, { P580: chapmanRev });
  assert.equal(plan.person.changes.length, 1);
  assert.deepEqual(plan.person.references, []);
});

// The office side: officeholder (P1308) statements on the office, pointing at the person.

test('an office without the person gets a new officeholder statement carrying the whole term', () => {
  // Shaped like Mwigulu Nchemba (Q31752753) and Minister of Finance (Q16147337): the dates went
  // onto the person's position held statement, but the office never listed them.
  const claim = p39('S1', 'Q2287650', {
    P580: [timeSnak('h-start', '+1950-01-19T00:00:00Z', 11)],
    P582: [endSnak('h-end', '+1953-01-20T00:00:00Z', 11)],
  });
  const plan = planTermEdit(person([claim]), office([p1308('O9', 'Q999')]), null, parseDateInput('1953-01-20', 'e'));
  assert.equal(plan.person.changes.length, 0);
  assert.equal(plan.office.statementId, null);
  assert.equal(plan.office.needsChoice, false);
  assert.equal(plan.office.baseRevId, 2000);
  assert.deepEqual(plan.office.changes.map((c) => [c.property, c.to, c.copiedFrom]), [
    ['P580', '1950-01-19', 'Q1297519'],
    ['P582', '1953-01-20', undefined],
  ]);
});

test('typed dates go onto both sides, and are cited on both', () => {
  const plan = planTermEdit(person([p39('S1', 'Q2287650')]), office([p1308('O1', 'Q1297519')]),
    parseDateInput('1950-01-19', 's'), null, {}, { P580: chapmanRev });
  assert.equal(plan.office.statementId, 'O1');
  assert.deepEqual(plan.person.changes.map((c) => c.to), ['1950-01-19']);
  assert.deepEqual(plan.office.changes.map((c) => c.to), ['1950-01-19']);
  assert.deepEqual(plan.person.references.map((r) => r.url), [chapmanUrl]);
  assert.deepEqual(plan.office.references.map((r) => r.url), [chapmanUrl]);
});

test('a blank date the office has fills the person\'s statement, uncited', () => {
  const plan = planTermEdit(person([p39('S1', 'Q2287650')]),
    office([p1308('O1', 'Q1297519', { P582: [endSnak('h', '+1953-00-00T00:00:00Z', 9)] })]),
    parseDateInput('1950', 's'), null, {}, { P580: chapmanRev, P582: chapmanRev });
  assert.deepEqual(plan.person.changes.map((c) => [c.property, c.to, c.copiedFrom]), [
    ['P580', '1950', undefined],
    ['P582', '1953', 'Q2287650'],
  ]);
  assert.deepEqual(plan.person.references.length, 1);
});

test('blank dates the sides disagree on are left alone and reported', () => {
  const plan = planTermEdit(
    person([p39('S1', 'Q2287650', { P582: [endSnak('h1', '+1953-01-20T00:00:00Z', 11)] })]),
    office([p1308('O1', 'Q1297519', { P582: [endSnak('h2', '+1953-00-00T00:00:00Z', 9)] })]),
    parseDateInput('1950', 's'), null);
  assert.deepEqual(plan.office.changes.map((c) => c.property), ['P580']);
  assert.deepEqual(plan.conflicts, [{ property: 'P582', label: 'end time', person: '1953-01-20', office: '1953' }]);
});

test('a typed date overwrites both sides, so is not a conflict', () => {
  const plan = planTermEdit(
    person([p39('S1', 'Q2287650', { P582: [endSnak('h1', '+1953-01-20T00:00:00Z', 11)] })]),
    office([p1308('O1', 'Q1297519', { P582: [endSnak('h2', '+1953-00-00T00:00:00Z', 9)] })]),
    null, parseDateInput('1953-01-20', 'e'));
  assert.equal(plan.person.changes.length, 0);
  assert.deepEqual(plan.office.changes.map((c) => [c.from, c.to, c.snakhash]), [['1953', '1953-01-20', 'h2']]);
  assert.deepEqual(plan.conflicts, []);
});

test('several officeholder statements: the one sharing a date with the term is used', () => {
  const plan = planTermEdit(
    person([p39('S1', 'Q2287650', { P580: [timeSnak('h', '+1950-01-19T00:00:00Z', 11)] })]),
    office([
      p1308('O1', 'Q1297519', { P580: [timeSnak('a', '+1941-00-00T00:00:00Z', 9)] }),
      p1308('O2', 'Q1297519', { P580: [timeSnak('b', '+1950-01-19T00:00:00Z', 11)] }),
    ]),
    null, parseDateInput('1953', 'e'));
  assert.equal(plan.office.statementId, 'O2');
  assert.equal(plan.office.needsChoice, false);
});

test('several officeholder statements and no telling them apart: the user chooses', () => {
  const offices = office([p1308('O1', 'Q1297519'), p1308('O2', 'Q1297519')]);
  const ask = planTermEdit(person([p39('S1', 'Q2287650')]), offices, parseDateInput('1950', 's'), null);
  assert.equal(ask.office.needsChoice, true);
  assert.equal(ask.office.changes.length, 0);
  assert.deepEqual(ask.office.candidates.map((c) => c.id), ['O1', 'O2']);

  const chosen = planTermEdit(person([p39('S1', 'Q2287650')]), offices, parseDateInput('1950', 's'), null, { office: 'O2' });
  assert.equal(chosen.office.statementId, 'O2');
  assert.deepEqual(chosen.office.changes.map((c) => c.to), ['1950']);
});

test('the office side waits while the person\'s statement is still to be chosen', () => {
  const plan = planTermEdit(person([p39('S1', 'Q2287650'), p39('S2', 'Q2287650')]), office(), parseDateInput('1950', 's'), null);
  assert.equal(plan.person.needsChoice, true);
  assert.equal(plan.office.changes.length, 0);
  assert.equal(planHasWork(plan), false);
});

test('an office that already matches has nothing to send', () => {
  const plan = planTermEdit(
    person([p39('S1', 'Q2287650', { P580: [timeSnak('h', '+1950-00-00T00:00:00Z', 9)] })]),
    office([p1308('O1', 'Q1297519', { P580: [timeSnak('h', '+1950-00-00T00:00:00Z', 9)] })]),
    parseDateInput('1950', 's'), null);
  assert.equal(planHasWork(plan), false);
});
