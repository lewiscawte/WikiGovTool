import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { createApp } from '../src/app';

const ARTICLE = `{{Infobox officeholder
| name = Example Person
| office = [[Minister of Examples|Minister for Examples]]
| term_start = [[January 20|20 January]] 2020
| term_end = Incumbent
}}`;

let server: Server;
let base: string;

beforeEach(async () => {
  mock.method(console, 'log', () => {});
  const realFetch = globalThis.fetch;
  mock.method(globalThis, 'fetch', async (input: any, init: any) => (
    String(input).startsWith('http://127.0.0.1')
      ? realFetch(input, init)
      : new Response(JSON.stringify({ query: { pages: [{ title: 'Example Person', revisions: [{ revid: 1, slots: { main: { content: ARTICLE } } }] }] } }))
  ));
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/wikipedia/infobox?title=Example`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

// `office` is an unauthenticated query parameter, and a slow match blocks every user.
test('the infobox route matches a long office parameter in linear time', async () => {
  await fetch(`${base}&office=warmup`);
  const start = performance.now();
  const res = await fetch(`${base}&office=${encodeURIComponent('[[|'.repeat(1000))}`);
  await res.text();
  const ms = performance.now() - start;
  assert.ok(ms < 400, `1,000 '[[|' in office took ${ms.toFixed(0)} ms`);
});

test('the infobox route still matches an office written as a wikilink', async () => {
  const res = await fetch(`${base}&office=${encodeURIComponent('[[Minister of Examples|Minister for Examples]]')}`);
  const body = await res.json();
  assert.equal(body.fields.term_start, '2020-01-20');
});
