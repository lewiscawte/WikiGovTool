import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleDepartments, AssembleInput, preferClassDepartments } from '../src/services/departments';
import { OrgChartPosition } from '../src/types';
import { PositionHistoryRow } from '../src/services/wikidataClient';

const position = (qid: string, title: string, bucket: OrgChartPosition['bucket'] = 'Minister'): OrgChartPosition => ({
  id: qid,
  title,
  department: 'from seed',
  bucket,
  wikipediaTitle: null,
  wikidataQid: qid,
  dynamic: false,
  inception: null,
  dissolved: null,
});

const term = (positionQid: string, personLabel: string, start: string, end: string | null = null): PositionHistoryRow => ({
  positionQid,
  personQid: `Q9${positionQid.slice(1)}`,
  personLabel,
  partyLabel: null,
  start,
  end,
  imageUrl: null,
});

const dept = (qid: string, label: string, inception: string | null = null, dissolved: string | null = null) =>
  [qid, { qid, label, wikipediaTitle: null, inception, dissolved }] as const;

function baseInput(): AssembleInput {
  return {
    date: new Date('2026-01-01'),
    country: 'Q30',
    cabinet: [
      position('Q1', 'President', 'Head of State'),
      position('Q2', 'Vice President', 'Head of Government'),
      position('Q10', 'Secretary of State'),
      position('Q20', 'Secretary of Defense'),
      position('Q30', 'Minister without Portfolio'),
    ],
    links: [
      { positionQid: 'Q20', departmentQid: 'D2' },
      { positionQid: 'Q10', departmentQid: 'D1' },
    ],
    details: new Map([dept('D2', 'Department of Defense'), dept('D1', 'Department of State')]),
    offices: [
      { departmentQid: 'D2', positionQid: 'Q20', positionLabel: 'Secretary of Defense', role: 'head' },
      { departmentQid: 'D2', positionQid: 'Q22', positionLabel: 'Assistant Secretary of Defense', role: 'member' },
      { departmentQid: 'D2', positionQid: 'Q21', positionLabel: 'Deputy Secretary of Defense', role: 'member' },
      { departmentQid: 'D2', positionQid: 'Q23', positionLabel: 'Under Secretary of Defense', role: 'member' },
    ],
    lifespans: new Map(),
    history: [
      term('Q1', 'Pres Person', '2025-01-20'),
      term('Q2', 'VP Person', '2025-01-20'),
      term('Q10', 'State Person', '2025-01-21'),
      term('Q20', 'Defense Person', '2025-01-25'),
      term('Q21', 'Deputy Person', '2025-03-01'),
      term('Q22', 'Assistant Person', '2025-04-01'),
      term('Q23', 'Former Under Secretary', '2020-01-01', '2024-01-01'),
      term('Q30', 'Portfolio Person', '2025-02-01'),
    ],
    deputyPairs: [
      { seniorQid: 'Q1', juniorQid: 'Q2' },
      { seniorQid: 'Q20', juniorQid: 'Q21' },
    ],
  };
}

test('departments follow cabinet order and carry their head office', () => {
  const view = assembleDepartments(baseInput());
  assert.deepEqual(view.departments.map((d) => d.label), ['Department of State', 'Department of Defense']);
  const defense = view.departments[1];
  assert.deepEqual(defense.heads.map((h) => h.officeholder?.personName), ['Defense Person']);
  assert.equal(defense.heads[0].position.department, 'Department of Defense');
});

test('the head office deputy is listed first, other held offices alphabetically, unheld ones as vacant', () => {
  const defense = assembleDepartments(baseInput()).departments[1];
  assert.deepEqual(defense.offices.map((o) => o.position.title), ['Deputy Secretary of Defense', 'Assistant Secretary of Defense']);
  assert.deepEqual(defense.vacant.map((o) => o.position.title), ['Under Secretary of Defense']);
});

test('leaders stay out of departments, with the deputy leader nested', () => {
  const view = assembleDepartments(baseInput());
  assert.deepEqual(view.leaders.map((l) => l.position.title), ['President']);
  assert.deepEqual(view.leaders[0].deputies.map((d) => d.position.title), ['Vice President']);
});

test('cabinet offices with no department link are reported as unassigned', () => {
  const view = assembleDepartments(baseInput());
  assert.deepEqual(view.unassigned.map((u) => u.position.title), ['Minister without Portfolio']);
});

test('a department abolished before the date is hidden and its head becomes unassigned', () => {
  const input = baseInput();
  input.details = new Map([dept('D2', 'Department of Defense', '1949-08-10', '2025-06-01'), dept('D1', 'Department of State')]);
  const view = assembleDepartments(input);
  assert.deepEqual(view.departments.map((d) => d.label), ['Department of State']);
  assert.deepEqual(view.unassigned.map((u) => u.position.title), ['Secretary of Defense', 'Minister without Portfolio']);
});

test('a department found only through its class sorts after linked departments', () => {
  const input = baseInput();
  input.details.set('D0', { qid: 'D0', label: 'Aardvark Department', wikipediaTitle: null, inception: null, dissolved: null });
  const view = assembleDepartments(input);
  assert.equal(view.departments.at(-1)?.label, 'Aardvark Department');
  assert.deepEqual(view.departments.at(-1)?.heads, []);
});

test('links to non-department bodies are dropped when the office also heads a known department', () => {
  const links = [
    { positionQid: 'Q10', departmentQid: 'TREASURY' },
    { positionQid: 'Q10', departmentQid: 'CFIUS' },
    { positionQid: 'Q11', departmentQid: 'SOME_AGENCY' },
  ];
  assert.deepEqual(preferClassDepartments(links, new Set(['TREASURY'])), [
    { positionQid: 'Q10', departmentQid: 'TREASURY' },
    { positionQid: 'Q11', departmentQid: 'SOME_AGENCY' },
  ]);
  assert.deepEqual(preferClassDepartments(links, new Set()), links);
});

test('a term whose end date is "unknown value" on Wikidata is treated as ended, not current', () => {
  const input = baseInput();
  // Wikidata's "unknown value" end date: the term ended, but nobody recorded when.
  input.history = input.history.map((r) => (r.positionQid === 'Q22' ? { ...r, endUnknown: true } : r));
  const defense = assembleDepartments(input).departments[1];
  assert.deepEqual(defense.vacant.map((o) => o.position.title).sort(), ['Assistant Secretary of Defense', 'Under Secretary of Defense']);
});
