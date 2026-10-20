import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateOfficeholderInfobox } from '../src/services/infoboxGenerator';

test('generateOfficeholderInfobox emits required fields and omits absent optional ones', () => {
  const wikitext = generateOfficeholderInfobox({
    name: 'Marco Rubio',
    office: 'United States Secretary of State',
    termStart: 'January 21, 2025',
  });
  assert.match(wikitext, /^\{\{Infobox officeholder/);
  assert.match(wikitext, /\| name\s+= Marco Rubio/);
  assert.match(wikitext, /\| office\s+= United States Secretary of State/);
  assert.match(wikitext, /\| term_start\s+= January 21, 2025/);
  assert.doesNotMatch(wikitext, /predecessor/);
  assert.match(wikitext, /\}\}$/);
});

test('generateOfficeholderInfobox includes predecessor/successor when provided', () => {
  const wikitext = generateOfficeholderInfobox({
    name: 'Marco Rubio',
    office: 'United States Secretary of State',
    predecessor: 'Antony Blinken',
    successor: undefined,
  });
  assert.match(wikitext, /\| predecessor\s+= Antony Blinken/);
});
