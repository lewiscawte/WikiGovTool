import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanWikitextValue, extractTemplate, parseTemplateFields } from '../src/services/infoboxParser';

const SAMPLE = `
{{short description|American politician}}
'''Marco Rubio''' is an American politician.

{{Infobox officeholder
| name        = Marco Rubio
| image       = Marco Rubio official photo.jpg
| office      = United States Secretary of State
| president   = [[Donald Trump]]
| term_start  = January 21, 2025
| term_end    = Incumbent
| predecessor = [[Antony Blinken]]
| party       = [[Republican Party (United States)|Republican]]
| birth_date  = {{birth date and age|1971|5|28}}
}}

==Early life==
Some text.
`;

test('extractTemplate finds the Infobox officeholder block despite a nested template earlier', () => {
  const block = extractTemplate(SAMPLE, /Infobox\s+officeholder/i);
  assert.ok(block);
  assert.match(block!, /^\{\{Infobox officeholder/);
  assert.match(block!, /\}\}$/);
});

test('parseTemplateFields splits fields and preserves nested templates/links in values', () => {
  const block = extractTemplate(SAMPLE, /Infobox\s+officeholder/i)!;
  const fields = parseTemplateFields(block);
  assert.equal(fields.name, 'Marco Rubio');
  assert.equal(fields.office, 'United States Secretary of State');
  assert.equal(fields.term_start, 'January 21, 2025');
  assert.equal(fields.predecessor, '[[Antony Blinken]]');
  assert.equal(fields.party, '[[Republican Party (United States)|Republican]]');
  assert.equal(fields.birth_date, '{{birth date and age|1971|5|28}}');
});

test('cleanWikitextValue strips wikilinks, bold markup and refs down to display text', () => {
  assert.equal(cleanWikitextValue('[[Antony Blinken]]'), 'Antony Blinken');
  assert.equal(cleanWikitextValue('[[Republican Party (United States)|Republican]]'), 'Republican');
  assert.equal(cleanWikitextValue("'''Marco Rubio'''"), 'Marco Rubio');
  assert.equal(cleanWikitextValue('Term<ref>some citation</ref> served'), 'Term served');
});

test('extractTemplate returns null when no matching template exists', () => {
  assert.equal(extractTemplate('no templates here', /Infobox\s+officeholder/i), null);
});

const timed = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

// Article wikitext is editable by anyone, and a slow parse blocks every user's requests.
test('cleanWikitextValue strips refs in linear time, even when they never close', () => {
  const ms = timed(() => cleanWikitextValue('<ref>'.repeat(20000)));
  assert.ok(ms < 100, `20,000 unclosed <ref> took ${ms.toFixed(0)} ms`);
});

test('cleanWikitextValue removes paired and self-closing refs', () => {
  assert.equal(cleanWikitextValue('Treasury<ref name="a">Cited, p. 4</ref> and<ref name="b" /> State'), 'Treasury and State');
  assert.equal(cleanWikitextValue('Treasury<REF>x</REF>'), 'Treasury');
});

test('cleanWikitextValue unwraps wikilinks in linear time, even when they never close', () => {
  const ms = timed(() => cleanWikitextValue('[['.repeat(10000)));
  assert.ok(ms < 100, `10,000 unclosed [[ took ${ms.toFixed(0)} ms`);
});

test('cleanWikitextValue keeps the text after the first pipe, as MediaWiki displays it', () => {
  assert.equal(cleanWikitextValue('[[A|B|C]] and [[|D]] and [[E|]] and [[F]]'), 'B|C and D and E| and F');
  assert.equal(cleanWikitextValue('[[a]b]] [[]] [[x'), '[[a]b]] [[]] [[x');
});
