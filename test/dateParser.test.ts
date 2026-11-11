import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDate } from '../src/services/dateParser';

const timed = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

// Infobox dates come from articles anyone can edit, and a slow parse blocks every user.
test('normalizeDate unwraps wikilinks in linear time', () => {
  const ms = timed(() => normalizeDate('[[|'.repeat(1000) + ' 2020'));
  assert.ok(ms < 50, `1,000 '[[|' took ${ms.toFixed(0)} ms`);
});

test('normalizeDate still reads dates written with wikilinks', () => {
  assert.equal(normalizeDate('[[5 July]] [[1995]]'), '1995-07-05');
  assert.equal(normalizeDate('[[January 20|20 January]] 2025'), '2025-01-20');
  assert.equal(normalizeDate('[[Category:X|July]] 4, 1776'), '1776-07-04');
});
