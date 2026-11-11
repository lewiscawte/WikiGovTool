import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { createApp } from '../src/app';

let server: Server;
let base: string;
let upstreamCalls = 0;

// Each visitor sits behind Toolforge's two proxy hops.
const from = (ip: string) => ({ headers: { 'X-Forwarded-For': `${ip}, 10.0.0.1` } });

before(async () => {
  mock.method(console, 'log', () => {});
  const realFetch = globalThis.fetch;
  mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    if (String(input).startsWith('http://127.0.0.1')) return realFetch(input, init);
    upstreamCalls++;
    return new Response('{"search":[]}');
  });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/wikidata/search?q=`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

// One visitor's uncached lookups must not use up the tool's shared Wikimedia allowance.
test('a client sending many uncached lookups is limited before they reach Wikimedia', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 100; i++) statuses.push((await fetch(base + `burst-${i}`, from('203.0.113.7'))).status);
  assert.ok(statuses.includes(429), 'expected the tool to answer 429 once the client is over its limit');
  assert.ok(upstreamCalls <= 60, `${upstreamCalls} lookups reached Wikimedia`);
});

test('another client is unaffected by the first client using up its limit', async () => {
  const res = await fetch(base + 'someone-else', from('198.51.100.20'));
  assert.equal(res.status, 200);
});

test('repeated cached lookups do not use up the limit', async () => {
  for (let i = 0; i < 100; i++) {
    const res = await fetch(base + 'same-query', from('192.0.2.55'));
    assert.equal(res.status, 200);
  }
});
