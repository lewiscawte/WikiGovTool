import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editEvents, parseCnf, recordStats, statsEnabled, statsSummary } from '../src/services/stats';
import { classifySummary } from '../src/scripts/backfillStats';

test('an edit is one event per revision, typed by what the tool was doing', () => {
  const events = editEvents('Lcawte', 'Q924', [
    { entityQid: 'Q31752753', revisions: [101, 102], type: 'term' },
    { entityQid: 'Q16147337', revisions: [103, undefined], type: 'term' },
  ]);
  assert.deepEqual(events.map((e) => [e.entity, e.revid, e.kind, e.type, e.country, e.username]), [
    ['Q31752753', 101, 'edit', 'term', 'Q924', 'Lcawte'],
    ['Q31752753', 102, 'edit', 'term', 'Q924', 'Lcawte'],
    ['Q16147337', 103, 'edit', 'term', 'Q924', 'Lcawte'],
  ]);
  assert.equal(editEvents('Lcawte', 'not a country', [{ entityQid: 'Q1', revisions: [1], type: 'term' }])[0].country, null);
});

test('the database login is read from the [client] section of a my.cnf', () => {
  const cnf = "[client]\nuser = s55555\npassword = 'secret with spaces'\n[mysqld]\nuser = other\n";
  assert.deepEqual(parseCnf(cnf), { user: 's55555', password: 'secret with spaces' });
  assert.equal(parseCnf('[mysqld]\nuser = s1\npassword = x\n'), null);
});

test('with no database configured, recording does nothing and the summary says statistics are off', async () => {
  assert.equal(statsEnabled(), false);
  await recordStats([{ username: 'x', kind: 'edit', type: 'term', entity: 'Q1', revid: 1, country: null }]);
  assert.deepEqual(await statsSummary(), { enabled: false, since: null, totals: [], users: [], months: [] });
});

test('past edits are classified by the summaries the tool gives them', () => {
  const cases: Array<[string, string | null]> = [
    ['/* wbeditentity-create-item:0| */ Create office item via WikiGovTool', 'create/office'],
    ['/* wbeditentity-create-item:0| */ Create person item via WikiGovTool', 'create/person'],
    ['/* wbsetqualifier-add:1| */ [[Property:P582]]: 3 November 2025, Set end time of position held ([[Q16147337]]) via WikiGovTool', 'edit/term'],
    ['/* wbcreateclaim-create:1| */ [[Property:P1308]]: [[Q6738666]], Set start time of officeholder ([[Q6738666]]) via WikiGovTool', 'edit/term'],
    ['/* wbcreateclaim-create:1| */ [[Property:P39]]: [[Q1]], Add position held ([[Q1]]) via WikiGovTool', 'edit/term'],
    ['/* wbeditentity-update:0| */ Set inception via WikiGovTool', 'edit/office-dates'],
    ['/* wbeditentity-update:0| */ Department: set inception; add replaces via WikiGovTool', 'edit/department-fields'],
    ['/* wbsetclaim-create:1||1 */ [[Property:P1365]]: [[Q14866868]], Department: add replaces via WikiGovTool', 'edit/department-succession'],
    ['/* wbsetdescription-set:1|en */ Ghanaian ministerial portfolio', null],
  ];
  for (const [comment, expected] of cases) {
    const got = classifySummary(comment);
    assert.equal(got ? `${got.kind}/${got.type}` : null, expected, comment);
  }
});
