import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore -- plain browser JavaScript, no types
import { dateForWikidata } from '../public/dates.js';

test('dates typed or copied into a dialog keep the precision they were given', () => {
  const cases: Array<[string, string | null]> = [
    ['2023-02-07', '2023-02-07'],
    ['2023-2-7', '2023-02-07'],
    ['2023', '2023'],
    ['2023-02', '2023-02'],
    ['7 February 2023', '2023-02-07'],
    ['7 Feb. 2023', '2023-02-07'],
    ['February 7, 2023', '2023-02-07'],
    ['February 2023', '2023-02'],
    ['[[7 February]] [[2023]]', '2023-02-07'],
    ['{{start date|2023|2|7}}', '2023-02-07'],
    ['  2023-02-07 ', '2023-02-07'],
  ];
  for (const [text, expected] of cases) assert.equal(dateForWikidata(text), expected, text);
});

test('blanks and the dialogs\' placeholders mean no date; anything else unreadable is null', () => {
  for (const text of ['', '   ', 'Unknown', 'Still exists', 'Incumbent']) assert.equal(dateForWikidata(text), '', text);
  for (const text of ['soon', '07/02/2023', '7 Smarch 2023']) assert.equal(dateForWikidata(text), null, text);
});
