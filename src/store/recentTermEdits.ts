// Terms this tool has just saved to Wikidata, laid over officeholder history until Wikidata's
// query service shows them. The query service runs minutes behind edits, and a history fetched
// in that gap is cached for hours, so without this a saved term wouldn't show until both
// caught up. In-memory only, like the other stores; an edit's entry drops out as soon as a
// fetched history matches it, or after MAX_AGE_MS regardless.

import type { PositionHistoryRow } from '../services/wikidataClient';
import { MAX_ENTRIES_PER_STORE } from './limits';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface RecentTermEdit {
  positionQid: string;
  personQid: string;
  personLabel: string;
  imageUrl: string | null;
  // The term's start before the edit, in the form's notation ("1950", "1950-01", "1950-01-19"),
  // to find its row in the history; null when the edit created the statement.
  previousStart: string | null;
  created: boolean;
  // The term as saved, in the same notation.
  start: string | null;
  end: string | null;
  expiresAt: number;
}

let edits: RecentTermEdit[] = [];

export function recordTermEdit(edit: Omit<RecentTermEdit, 'expiresAt'>): void {
  const now = Date.now();
  edits = edits.filter((e) => e.expiresAt > now);
  // A second edit to a term still waiting on the query service continues the first: the
  // history still has the term as it was before both.
  const earlier = edits.find((e) => samePair(e, edit) && e.start === edit.previousStart);
  if (earlier) {
    edit = { ...edit, previousStart: earlier.previousStart, created: earlier.created };
    edits = edits.filter((e) => e !== earlier);
  }
  // Called after the edit is already on Wikidata, so a full store makes room rather than failing it.
  if (edits.length >= MAX_ENTRIES_PER_STORE) edits.shift();
  edits.push({ ...edit, expiresAt: now + MAX_AGE_MS });
}

const samePair = (a: { positionQid: string; personQid: string }, b: { positionQid: string; personQid: string }) =>
  a.positionQid === b.positionQid && a.personQid === b.personQid;

// "1950" / "1950-01" / "1950-01-19" → the timestamp SPARQL returns for that date.
function toSparqlDate(value: string): string {
  const [y, m = '01', d = '01'] = value.split('-');
  return `${y}-${m}-${d}T00:00:00Z`;
}

// Whether a SPARQL date is the given form value, at the form value's precision.
const matchesDate = (sparql: string | null, value: string | null) =>
  value === null ? sparql === null : sparql !== null && toSparqlDate(value) === toSparqlDate(sparql.slice(0, value.length));

// A history row already shows the term as saved: the query service has caught up.
const showsEdit = (row: PositionHistoryRow, edit: RecentTermEdit) =>
  row.personQid === edit.personQid && matchesDate(row.start, edit.start) && matchesDate(row.end, edit.end);

// One office's history with any recent edits to it applied. Rows from the query service win
// once they show an edit, and that edit is then forgotten.
export function withRecentTermEdits(positionQid: string, rows: PositionHistoryRow[]): PositionHistoryRow[] {
  const now = Date.now();
  const pending = edits.filter((e) => e.positionQid === positionQid && e.expiresAt > now);
  if (pending.length === 0) return rows;

  let result = rows;
  for (const edit of pending) {
    if (rows.some((row) => showsEdit(row, edit))) {
      edits = edits.filter((e) => e !== edit);
      continue;
    }
    const patch = { start: edit.start && toSparqlDate(edit.start), end: edit.end && toSparqlDate(edit.end), endUnknown: false, pending: true };
    // The same term can be listed once per party, so every matching row is patched.
    const isTerm = (row: PositionHistoryRow) =>
      row.personQid === edit.personQid && !edit.created && matchesDate(row.start, edit.previousStart);
    if (result.some(isTerm)) {
      result = result.map((row) => (isTerm(row) ? { ...row, ...patch } : row));
    } else {
      const samePerson = rows.find((row) => row.personQid === edit.personQid);
      result = [...result, {
        positionQid,
        personQid: edit.personQid,
        personLabel: samePerson?.personLabel ?? edit.personLabel,
        partyLabel: samePerson?.partyLabel ?? null,
        imageUrl: samePerson?.imageUrl ?? edit.imageUrl,
        ...patch,
      }];
    }
  }
  return result;
}

// For tests.
export function clearRecentTermEdits(): void {
  edits = [];
}
