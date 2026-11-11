import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { BoundedSessionStore } from '../src/sessionStore';

let server: Server;
let loginUrl: string;

const sessionId = (res: Response) => /connect\.sid=s%3A([^.;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
const login = (cookie?: string) => fetch(loginUrl, { redirect: 'manual', headers: cookie ? { cookie } : {} });

before(async () => {
  mock.method(console, 'log', () => {});
  config.oauth.clientId = 'test-client';
  config.oauth.clientSecret = 'test-secret';
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  loginUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/login`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

test('the session cookie expires', async () => {
  const res = await login();
  assert.equal(res.status, 302);
  assert.match(res.headers.get('set-cookie') ?? '', /Expires=|Max-Age=/i);
});

// Each unauthenticated visit to /api/auth/login stores a session, so they must not pile up.
test('a flood of unauthenticated logins does not keep every pending session', async () => {
  const first = await login();
  const firstId = sessionId(first);
  assert.ok(firstId, 'login started a session');
  const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0];
  for (let i = 0; i < 1200; i++) await login();
  const replay = await login(cookie);
  // A new session id means the server no longer had the first one stored.
  const replayId = sessionId(replay);
  assert.ok(replayId && replayId !== firstId, 'the first pending session should have been dropped');
});

test('a flood of pending sessions does not push out logged-in users', () => {
  const store = new BoundedSessionStore(60_000);
  const cookie = { originalMaxAge: 60_000, httpOnly: true, path: '/' } as any;
  store.set('logged-in', { cookie, user: { username: 'Example', loggedInAt: '2026-11-11' } } as any);
  for (let i = 0; i < 5000; i++) store.set(`pending-${i}`, { cookie, oauthState: 'x' } as any);
  store.get('logged-in', (_err, sess) => assert.equal(sess?.user?.username, 'Example'));
  store.get('pending-0', (_err, sess) => assert.equal(sess, null));
});
