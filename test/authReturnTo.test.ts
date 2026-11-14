import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnTo } from '../src/routes/auth';

test('login returns to the page it was started from', () => {
  assert.equal(safeReturnTo('/departments.html?country=Q924&date=2020-12-06'), '/departments.html?country=Q924&date=2020-12-06');
  assert.equal(safeReturnTo('/?country=Q145'), '/?country=Q145');
  assert.equal(safeReturnTo('/index.html#offices'), '/index.html#offices');
});

test('anywhere off this site, or anything odd, goes to the home page instead', () => {
  const bad = [
    undefined, '', 'https://evil.example/', 'evil.example', '//evil.example/x', '/\\evil.example',
    '/\\\\evil.example', 'javascript:alert(1)', '/.//evil.example', '/x/..//evil.example', '/%2e//evil.example', '/%0d%0aSet-Cookie:x=1'.replace('%0d%0a', '\r\n'), `/${'a'.repeat(2001)}`,
  ];
  for (const raw of bad) assert.equal(safeReturnTo(raw), '/', JSON.stringify(raw));
});
