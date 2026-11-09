import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { upstreamJson, UpstreamRateLimitedError } from '../src/services/upstream';

// Rate limits are per host and module-level, so each test gets its own hosts.
let hostCount = 0;
let SPARQL: string;
let API: string;

function stubFetch(respond: () => Response) {
  return mock.method(globalThis, 'fetch', async () => respond());
}

beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  mock.method(console, 'log', () => {});
  hostCount++;
  SPARQL = `https://sparql${hostCount}.example/sparql?query=x`;
  API = `https://api${hostCount}.example/w/api.php?action=x`;
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('returns the parsed body of a successful response', async () => {
  stubFetch(() => new Response('{"ok":true}'));
  assert.deepEqual(await upstreamJson(SPARQL, 'Wikidata'), { ok: true });
});

test('a failed response keeps the labelled error message', async () => {
  stubFetch(() => new Response('', { status: 500, statusText: 'Server Error' }));
  await assert.rejects(upstreamJson(SPARQL, 'Wikidata'), /Wikidata request failed: 500 Server Error/);
});

test('after a 429, requests to that host fail without touching the network', async () => {
  const fetchMock = stubFetch(() => new Response('', { status: 429, headers: { 'Retry-After': '30' } }));
  await assert.rejects(upstreamJson(SPARQL, 'Wikidata'), UpstreamRateLimitedError);
  await assert.rejects(upstreamJson(SPARQL, 'Wikidata'), (err: UpstreamRateLimitedError) => {
    assert.ok(err instanceof UpstreamRateLimitedError);
    assert.equal(err.retryAfterSeconds, 30);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('requests resume once Retry-After has passed', async () => {
  let status = 429;
  stubFetch(() => new Response('{"ok":true}', { status, headers: { 'Retry-After': '30' } }));
  await assert.rejects(upstreamJson(SPARQL, 'Wikidata'), UpstreamRateLimitedError);
  status = 200;
  mock.timers.tick(31_000);
  assert.deepEqual(await upstreamJson(SPARQL, 'Wikidata'), { ok: true });
});

test('a rate limit on one host does not block another', async () => {
  let status = 429;
  stubFetch(() => new Response('{"ok":true}', { status }));
  await assert.rejects(upstreamJson(SPARQL, 'Wikidata'), UpstreamRateLimitedError);
  status = 200;
  assert.deepEqual(await upstreamJson(API, 'Wikidata'), { ok: true });
});

test('a 429 without a usable Retry-After still backs off', async () => {
  const fetchMock = stubFetch(() => new Response('', { status: 429 }));
  await assert.rejects(upstreamJson(SPARQL, 'Wikidata'), UpstreamRateLimitedError);
  mock.timers.tick(10_000);
  await assert.rejects(upstreamJson(SPARQL, 'Wikidata'), UpstreamRateLimitedError);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('the API answers 503 with Retry-After while upstream is rate limiting', async () => {
  const realFetch = globalThis.fetch;
  mock.method(globalThis, 'fetch', async (input: any, init: any) => (
    String(input).startsWith('http://127.0.0.1')
      ? realFetch(input, init)
      : new Response('', { status: 429, headers: { 'Retry-After': '30' } })
  ));
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/wikidata/entity/Q1`);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('Retry-After'), '30');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
