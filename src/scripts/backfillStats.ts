// Fills the usage statistics with this tool's edits from before they were recorded, read from
// Wikidata's recent changes by the OAuth consumer's change tag. Recent changes only go back 30
// days, so older edits can't be counted. Safe to run more than once: a revision already
// recorded is skipped.
//
//   npm run backfill-stats -- <OAuth consumer id>     (the number in the "OAuth CID: …" tag)

import { config, userAgent } from '../config';
import { recordPastStats, StatsEvent, StatsType } from '../services/stats';

// What an edit was, from the summary the tool gave it (see the summary lines in
// services/wikidataCreate.ts, wikidataEdits.ts, wikidataItemDates.ts and
// wikidataDepartmentEdit.ts). Null for anything that isn't one of the tool's own edits.
export function classifySummary(comment: string): { kind: StatsEvent['kind']; type: StatsType } | null {
  if (!/via WikiGovTool/.test(comment)) return null;
  const created = /Create (person|office|department) item via WikiGovTool/.exec(comment);
  if (created) return { kind: 'create', type: created[1] as StatsType };
  const department = /Department: (.*) via WikiGovTool/.exec(comment);
  if (department) return { kind: 'edit', type: /(^|; )set /.test(department[1]) ? 'department-fields' : 'department-succession' };
  if (/department formation\/dissolution/.test(comment)) return { kind: 'edit', type: 'department-succession' };
  if (/(Set .* of|Add) (position held|officeholder) \(\[\[Q\d+\]\]\)/.test(comment)) return { kind: 'edit', type: 'term' };
  if (/Set (inception|dissolved, abolished or demolished date)/.test(comment)) return { kind: 'edit', type: 'office-dates' };
  return null;
}

interface RecentChange {
  user: string;
  title: string;
  revid: number;
  timestamp: string;
  comment?: string;
}

async function* toolEdits(consumerId: string): AsyncGenerator<RecentChange> {
  let next: Record<string, string> = {};
  do {
    const params = new URLSearchParams({
      action: 'query', list: 'recentchanges', rctag: `OAuth CID: ${consumerId}`, rctype: 'edit|new',
      rcprop: 'user|title|ids|timestamp|comment', rclimit: '500', format: 'json', formatversion: '2', ...next,
    });
    const res = await fetch(`${config.wikidataApi}?${params}`, { headers: { 'User-Agent': userAgent() } });
    if (!res.ok) throw new Error(`Recent changes request failed: ${res.status}`);
    const data: any = await res.json();
    if (data.error) throw new Error(`${data.error.code}: ${data.error.info}`);
    yield* data.query?.recentchanges ?? [];
    next = data.continue ?? {};
  } while (Object.keys(next).length);
}

async function main(): Promise<void> {
  const consumerId = process.argv[2];
  if (!consumerId || !/^\d+$/.test(consumerId)) {
    console.error('Usage: npm run backfill-stats -- <OAuth consumer id>');
    process.exit(2);
  }
  const events: Array<StatsEvent & { at: Date }> = [];
  let skipped = 0;
  for await (const change of toolEdits(consumerId)) {
    const what = classifySummary(change.comment ?? '');
    if (!what || !/^Q[1-9]\d*$/.test(change.title)) {
      skipped++;
      continue;
    }
    events.push({ ...what, username: change.user, entity: change.title, revid: change.revid, country: null, at: new Date(change.timestamp) });
  }
  const added = await recordPastStats(events);
  console.log(`Found ${events.length} of the tool's edits (${skipped} other changes skipped); ${added} were new to the statistics.`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
