import { readFileSync } from 'fs';
import mysql from 'mysql2/promise';
import { config } from '../config';

// Usage statistics: one row per Wikidata revision this tool made, so new items and edits can be
// counted by type, by user and over time. Everything in a row is already public on Wikidata (the
// edit, its item and its user); nothing else about the user is kept. Recording never holds up
// or fails an edit: it's sent after Wikidata has accepted the edit, and a database problem is
// only logged. Off when no database is configured (config.stats).

export type StatsKind = 'create' | 'edit';
export type StatsType =
  // New items, by what they are.
  | 'person' | 'office' | 'department'
  // Edits, by what the tool was doing.
  | 'term' | 'term-new-holder' | 'office-dates' | 'department-fields' | 'department-succession';

export interface StatsEvent {
  username: string;
  kind: StatsKind;
  type: StatsType;
  entity: string;
  revid: number;
  // The country being viewed when the edit was made, if known.
  country: string | null;
}

const QID_RE = /^Q[1-9]\d*$/;

// One event per revision, for the items an edit touched. Revisions Wikidata didn't report are skipped.
export function editEvents(
  username: string,
  country: string | null,
  sides: Array<{ entityQid: string; revisions: Array<number | undefined>; type: StatsType }>,
): StatsEvent[] {
  const validCountry = country && QID_RE.test(country) ? country : null;
  return sides.flatMap((side) => side.revisions
    .filter((revid): revid is number => Number.isInteger(revid) && (revid as number) > 0)
    .map((revid) => ({ username, kind: 'edit' as const, type: side.type, entity: side.entityQid, revid, country: validCountry })));
}

// The [client] user and password from a MySQL option file such as Toolforge's replica.my.cnf.
export function parseCnf(text: string): { user: string; password: string } | null {
  let section = '';
  const found: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const pair = /^([a-z_]+)\s*=\s*(.*)$/i.exec(line);
    if (section !== 'client' || !pair) continue;
    found[pair[1].toLowerCase()] = pair[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return found.user && found.password ? { user: found.user, password: found.password } : null;
}

function credentials(): { user: string; password: string } | null {
  if (config.stats.dbUser && config.stats.dbPassword) return { user: config.stats.dbUser, password: config.stats.dbPassword };
  try {
    return parseCnf(readFileSync(config.stats.dbCnf, 'utf8'));
  } catch {
    return null;
  }
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  at DATETIME NOT NULL,
  username VARCHAR(255) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  type VARCHAR(32) NOT NULL,
  entity VARCHAR(20) NOT NULL,
  revid BIGINT UNSIGNED NOT NULL,
  country VARCHAR(20) NULL,
  UNIQUE KEY revid (revid),
  KEY at (at),
  KEY username (username)
) DEFAULT CHARSET=utf8mb4`;

let pool: mysql.Pool | null = null;
let ready: Promise<mysql.Pool | null> | null = null;

export const statsEnabled = () => Boolean(config.stats.dbName);

// The connection pool, with the table created on first use; null when statistics are off or
// the database can't be reached (tried again on the next call).
function database(): Promise<mysql.Pool | null> {
  if (!statsEnabled()) return Promise.resolve(null);
  if (!ready) {
    ready = (async () => {
      const login = credentials();
      if (!login) throw new Error(`no database login: set STATS_DB_USER and STATS_DB_PASSWORD, or STATS_DB_CNF (${config.stats.dbCnf})`);
      pool = mysql.createPool({
        host: config.stats.dbHost,
        port: config.stats.dbPort,
        database: config.stats.dbName,
        user: login.user,
        password: login.password,
        connectionLimit: 2,
        timezone: 'Z',
      });
      await pool.query(SCHEMA);
      return pool;
    })().catch((err) => {
      console.error('[stats] database unavailable:', err.message);
      ready = null;
      pool?.end().catch(() => {});
      pool = null;
      return null;
    });
  }
  return ready;
}

// Records events; a revision already recorded is skipped. Never throws.
export async function recordStats(events: StatsEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const db = await database();
    if (!db) return;
    const rows = events.map((e) => [new Date(), e.username.slice(0, 255), e.kind, e.type, e.entity, e.revid, e.country]);
    await db.query('INSERT IGNORE INTO events (at, username, kind, type, entity, revid, country) VALUES ?', [rows]);
  } catch (err) {
    console.error('[stats] not recorded:', (err as Error).message);
  }
}

// For the backfill script: events with their own times, from before statistics were kept.
export async function recordPastStats(events: Array<StatsEvent & { at: Date }>): Promise<number> {
  const db = await database();
  if (!db) throw new Error('Statistics are off: set STATS_DB_NAME');
  if (events.length === 0) return 0;
  const rows = events.map((e) => [e.at, e.username.slice(0, 255), e.kind, e.type, e.entity, e.revid, e.country]);
  const [result] = await db.query('INSERT IGNORE INTO events (at, username, kind, type, entity, revid, country) VALUES ?', [rows]);
  return (result as mysql.ResultSetHeader).affectedRows;
}

export interface StatsSummary {
  enabled: boolean;
  since: string | null;
  totals: Array<{ kind: StatsKind; type: StatsType; count: number }>;
  users: Array<{ username: string; created: number; edits: number }>;
  months: Array<{ month: string; created: number; edits: number }>;
}

const SUMMARY_TTL_MS = 60 * 1000;
const MAX_USERS = 100;
let cached: { at: number; summary: StatsSummary } | null = null;

export async function statsSummary(): Promise<StatsSummary> {
  if (cached && Date.now() - cached.at < SUMMARY_TTL_MS) return cached.summary;
  const db = await database();
  if (!db) return { enabled: false, since: null, totals: [], users: [], months: [] };
  const [[first], totals, users, months] = await Promise.all([
    db.query('SELECT MIN(at) AS since FROM events').then(([rows]) => rows as any[]),
    db.query('SELECT kind, type, COUNT(*) AS count FROM events GROUP BY kind, type ORDER BY kind, count DESC').then(([rows]) => rows as any[]),
    db.query(`SELECT username, SUM(kind = 'create') AS created, SUM(kind = 'edit') AS edits FROM events
      GROUP BY username ORDER BY COUNT(*) DESC, username LIMIT ${MAX_USERS}`).then(([rows]) => rows as any[]),
    db.query(`SELECT DATE_FORMAT(at, '%Y-%m') AS month, SUM(kind = 'create') AS created, SUM(kind = 'edit') AS edits FROM events
      GROUP BY month ORDER BY month`).then(([rows]) => rows as any[]),
  ]);
  const summary: StatsSummary = {
    enabled: true,
    since: first?.since ? new Date(first.since).toISOString() : null,
    totals: totals.map((r) => ({ kind: r.kind, type: r.type, count: Number(r.count) })),
    users: users.map((r) => ({ username: r.username, created: Number(r.created), edits: Number(r.edits) })),
    months: months.map((r) => ({ month: r.month, created: Number(r.created), edits: Number(r.edits) })),
  };
  cached = { at: Date.now(), summary };
  return summary;
}
