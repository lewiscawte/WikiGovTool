import { Request } from 'express';
import { config } from '../config';
import { wikimediaApiPost } from './wikimediaAuth';

// Edits to Wikidata made on the user's behalf. Currently one kind: an officeholder's term
// dates, as start time (P580) / end time (P582) qualifiers, kept in step on both statements
// that record the term: position held (P39) on the person and officeholder (P1308) on the
// office. planTermEdit works out what would change (pure, so the preview and the save
// compute the same thing); applyTermPlan sends it.

const GREGORIAN = 'http://www.wikidata.org/entity/Q1985727';
// config.wikipediaApi is English Wikipedia; values copied from it are cited as imported
// from Q328 (English Wikipedia) with the exact revision as the import URL, as is usual on Wikidata.
const ENGLISH_WIKIPEDIA = 'Q328';
const IMPORTED_FROM = 'P143';
const IMPORT_URL = 'P4656';
const DATE_INPUT_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

export type TermProperty = 'P580' | 'P582';
export const TERM_PROPERTY_LABELS: Record<TermProperty, string> = { P580: 'start time', P582: 'end time' };

export interface TimeInput {
  // Wikibase time string, e.g. "+1950-01-19T00:00:00Z"; month/day are 00 below their precision.
  time: string;
  // 9 = year, 10 = month, 11 = day.
  precision: 9 | 10 | 11;
}

export class EditInputError extends Error {}

// "1950", "1950-01" or "1950-01-19" → a Wikibase time at that precision; '' → null.
export function parseDateInput(raw: string | null | undefined, field: string): TimeInput | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = DATE_INPUT_RE.exec(s);
  if (!m) throw new EditInputError(`${field} must be YYYY, YYYY-MM or YYYY-MM-DD`);
  const [, y, mo, d] = m;
  // Wikidata records dates before the Gregorian switch in the Julian calendar; this tool
  // only sends Gregorian dates, so refuse rather than send a wrong calendar model.
  if (Number(y) < 1583) throw new EditInputError(`${field} is before 1583; enter it on Wikidata directly`);
  if (mo && (Number(mo) < 1 || Number(mo) > 12)) throw new EditInputError(`${field} has an invalid month`);
  if (d) {
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (date.getUTCMonth() !== Number(mo) - 1) throw new EditInputError(`${field} has an invalid day`);
  }
  return {
    time: `+${y}-${mo ?? '00'}-${d ?? '00'}T00:00:00Z`,
    precision: d ? 11 : mo ? 10 : 9,
  };
}

// A Wikibase time back to the form's notation, at its own precision: "1950", "1950-01", "1950-01-19".
export function formatTime(t: { time: string; precision: number }): string {
  const m = /^[+-]?(\d+)-(\d{2})-(\d{2})/.exec(t.time);
  if (!m) return t.time;
  const year = m[1].replace(/^0+(?=\d{4})/, '');
  if (t.precision >= 11) return `${year}-${m[2]}-${m[3]}`;
  if (t.precision === 10) return `${year}-${m[2]}`;
  return year;
}

function timeValue(t: TimeInput) {
  return { time: t.time, timezone: 0, before: 0, after: 0, precision: t.precision, calendarmodel: GREGORIAN };
}

export interface TermStatement {
  id: string;
  rank: string;
  start: string | null;
  end: string | null;
}

export interface QualifierChange {
  property: TermProperty;
  label: string;
  from: string | null;
  to: string;
  // Present when replacing an existing qualifier value.
  snakhash?: string;
  value: TimeInput;
  // Set when the value wasn't typed but filled in from the paired statement on this item.
  copiedFrom?: string;
}

// The Wikipedia article revision a form value was copied from.
export interface WikipediaSource {
  title: string;
  revid: number;
}

export interface PlannedReference extends WikipediaSource {
  url: string;
}

export function importUrl(source: WikipediaSource): string {
  const base = config.wikipediaApi.replace(/\/api\.php$/, '/index.php');
  return `${base}?title=${encodeURIComponent(source.title.replace(/ /g, '_'))}&oldid=${source.revid}`;
}

// A term is recorded twice on Wikidata: position held (P39) on the person, pointing at the
// office, and officeholder (P1308) on the office, pointing at the person. Each is one side.
export type TermLink = 'P39' | 'P1308';
export const TERM_LINK_LABELS: Record<TermLink, string> = { P39: 'position held', P1308: 'officeholder' };

export interface SidePlan {
  entityQid: string;
  entityLabel: string;
  property: TermLink;
  // The item the statement points at: the office for P39, the person for P1308.
  valueQid: string;
  baseRevId: number;
  // Every statement on this item for the other one.
  candidates: TermStatement[];
  // The statement to edit; null with needsChoice false means a new statement is created.
  statementId: string | null;
  // More than one candidate and none chosen: the user has to pick before anything is planned.
  needsChoice: boolean;
  changes: QualifierChange[];
  // Wikipedia revisions to cite on the statement: one per distinct source of a changed value.
  references: PlannedReference[];
}

export interface TermPlan {
  person: SidePlan;
  office: SidePlan;
  // Dates the two sides disagree on that the user left blank, so neither is touched.
  conflicts: { property: TermProperty; label: string; person: string; office: string }[];
}

export interface StatementChoice {
  person?: string | null;
  office?: string | null;
}

// One qualifier's current state, as shown to the user.
function describeQualifier(snak: any): { text: string | null; hash?: string; time?: { time: string; precision: number } } {
  if (!snak) return { text: null };
  if (snak.snaktype === 'somevalue') return { text: 'unknown value', hash: snak.hash };
  if (snak.snaktype === 'novalue') return { text: 'no value', hash: snak.hash };
  const v = snak.datavalue?.value;
  return { text: v ? formatTime(v) : null, hash: snak.hash, time: v };
}

const itemValueOf = (claim: any): string | null => {
  const v = claim?.mainsnak?.snaktype === 'value' ? claim.mainsnak.datavalue?.value : null;
  return v ? (v.id ?? (v['numeric-id'] ? `Q${v['numeric-id']}` : null)) : null;
};

const sameTime = (a: { time: string; precision: number } | undefined, b: { time: string; precision: number } | undefined) =>
  !!a && !!b && a.time === b.time && a.precision === b.precision;

const termOf = (claim: any) => ({
  P580: describeQualifier(claim?.qualifiers?.P580?.[0]),
  P582: describeQualifier(claim?.qualifiers?.P582?.[0]),
});

function sideBase(entity: any, property: TermLink, valueQid: string): { side: SidePlan; claims: any[] } {
  const claims: any[] = (entity.claims?.[property] ?? []).filter((c: any) => itemValueOf(c) === valueQid);
  const side: SidePlan = {
    entityQid: entity.id,
    entityLabel: entity.labels?.en?.value ?? entity.id,
    property,
    valueQid,
    baseRevId: entity.lastrevid,
    candidates: claims.map((c) => {
      const term = termOf(c);
      return { id: c.id, rank: c.rank, start: term.P580.text, end: term.P582.text };
    }),
    statementId: null,
    needsChoice: false,
    changes: [],
    references: [],
  };
  return { side, claims };
}

function chosenClaim(side: SidePlan, claims: any[], statementId: string | null | undefined): any {
  if (!statementId) return null;
  const claim = claims.find((c) => c.id === statementId);
  if (!claim) {
    throw new EditInputError(`Statement ${statementId} is not a ${TERM_LINK_LABELS[side.property]} (${side.valueQid}) statement on ${side.entityQid}`);
  }
  return claim;
}

// Plans the term on both items. The target for each date is what the user typed; a date left
// blank is filled from whichever side has it into the side that has nothing, and never
// overwrites a value already there.
export function planTermEdit(
  personEntity: any,
  officeEntity: any,
  start: TimeInput | null,
  end: TimeInput | null,
  choice: StatementChoice = {},
  sources: Partial<Record<TermProperty, WikipediaSource | null>> = {},
): TermPlan {
  const person = sideBase(personEntity, 'P39', officeEntity.id);
  const office = sideBase(officeEntity, 'P1308', personEntity.id);
  const plan: TermPlan = { person: person.side, office: office.side, conflicts: [] };
  const typed: Record<TermProperty, TimeInput | null> = { P580: start, P582: end };

  let personClaim = chosenClaim(person.side, person.claims, choice.person);
  if (!personClaim && person.claims.length === 1) personClaim = person.claims[0];
  else if (!personClaim && person.claims.length > 1) {
    // The office side is matched against the person's term, so it waits for this choice.
    person.side.needsChoice = true;
    return plan;
  }
  person.side.statementId = personClaim?.id ?? null;
  const personTerm = termOf(personClaim);

  let officeClaim = chosenClaim(office.side, office.claims, choice.office);
  if (!officeClaim && office.claims.length === 1) officeClaim = office.claims[0];
  else if (!officeClaim && office.claims.length > 1) {
    // Several terms in office: take the one sharing a date with this term, if exactly one does.
    const known = (p: TermProperty) => typed[p] ?? personTerm[p].time;
    const matching = office.claims.filter((c) => {
      const term = termOf(c);
      return (['P580', 'P582'] as const).some((p) => sameTime(term[p].time, known(p) ?? undefined));
    });
    if (matching.length === 1) officeClaim = matching[0];
    else office.side.needsChoice = true;
  }
  office.side.statementId = officeClaim?.id ?? null;
  const officeTerm = termOf(officeClaim);

  for (const property of ['P580', 'P582'] as const) {
    const label = TERM_PROPERTY_LABELS[property];
    const sides = [
      { side: person.side, current: personTerm[property], other: office.side.needsChoice ? null : officeTerm[property], otherQid: office.side.entityQid },
      { side: office.side, current: officeTerm[property], other: personTerm[property], otherQid: person.side.entityQid },
    ];
    const value = typed[property];
    if (!value) {
      const p = personTerm[property];
      const o = officeTerm[property];
      if (!office.side.needsChoice && p.time && o.time && !sameTime(p.time, o.time)) {
        plan.conflicts.push({ property, label, person: p.text!, office: o.text! });
      }
    }
    for (const { side, current, other, otherQid } of sides) {
      if (side.needsChoice) continue;
      if (value) {
        if (sameTime(current.time, value)) continue;
        side.changes.push({
          property, label, from: current.text, to: formatTime(value),
          ...(current.hash ? { snakhash: current.hash } : {}),
          value,
        });
      } else if (!current.hash && other?.time) {
        const copied: TimeInput = { time: other.time.time, precision: other.time.precision as TimeInput['precision'] };
        side.changes.push({ property, label, from: null, to: formatTime(copied), value: copied, copiedFrom: otherQid });
      }
    }
  }

  // Cite each Wikipedia revision a typed value came from, unless the statement already does.
  for (const [side, claim] of [[person.side, personClaim], [office.side, officeClaim]] as const) {
    const cited = new Set<string>(
      (claim?.references ?? []).flatMap((r: any) => (r.snaks?.[IMPORT_URL] ?? []).map((sn: any) => sn.datavalue?.value)),
    );
    for (const change of side.changes) {
      const source = change.copiedFrom ? null : sources[change.property];
      if (!source) continue;
      const url = importUrl(source);
      if (cited.has(url)) continue;
      cited.add(url);
      side.references.push({ ...source, url });
    }
  }
  return plan;
}

// A side that has something to send: a statement to create, or qualifiers to set.
const sideHasWork = (side: SidePlan) => !side.statementId || side.changes.length > 0;

// Whether a plan is ready to send and changes anything. Neither side is ready while a statement
// is still to be chosen: the office side isn't even planned until the person's is settled.
export const planHasWork = (plan: TermPlan) =>
  !plan.person.needsChoice && !plan.office.needsChoice && (sideHasWork(plan.person) || sideHasWork(plan.office));

export class WikidataApiError extends Error {
  constructor(public code: string, info: string, public entityQid: string, public completedRevisions: number[]) {
    super(info);
  }
}

function tagsParam(): Record<string, string> {
  return config.wikidataEditTags ? { tags: config.wikidataEditTags } : {};
}

export interface AppliedSide {
  entityQid: string;
  statementId: string;
  baseRevId: number;
  revisions: number[];
}

// Sends one side as a chain of edits, each based on the revision the previous one made, so an
// edit by anyone else in between fails with an edit conflict instead of being overwritten.
// done collects every revision made so far, on either item, for reporting a partial failure.
async function applySide(req: Request, side: SidePlan, done: number[]): Promise<AppliedSide> {
  const set = side.changes.map((c) => c.label).join(' and ');
  const imported = side.references.length ? ', imported from English Wikipedia' : '';
  const what = `${TERM_LINK_LABELS[side.property]} ([[${side.valueQid}]])`;
  const summary = `${set ? `Set ${set} of ${what}` : `Add ${what}`}${imported} via WikiGovTool`;
  const revisions: number[] = [];
  let baserevid = side.baseRevId;

  const post = async (params: Record<string, string>) => {
    const data = await wikimediaApiPost(req, config.wikidataApi, {
      ...params,
      baserevid: String(baserevid),
      summary,
      ...tagsParam(),
    });
    if (data?.error) throw new WikidataApiError(data.error.code, data.error.info, side.entityQid, [...done]);
    const revid = data?.pageinfo?.lastrevid;
    if (revid) {
      revisions.push(revid);
      done.push(revid);
      baserevid = revid;
    }
    return data;
  };

  let statementId = side.statementId;
  if (!statementId) {
    const created = await post({
      action: 'wbcreateclaim',
      entity: side.entityQid,
      property: side.property,
      snaktype: 'value',
      value: JSON.stringify({ 'entity-type': 'item', 'numeric-id': Number(side.valueQid.slice(1)) }),
    });
    statementId = created.claim.id as string;
  }
  for (const change of side.changes) {
    await post({
      action: 'wbsetqualifier',
      claim: statementId,
      property: change.property,
      snaktype: 'value',
      value: JSON.stringify(timeValue(change.value)),
      ...(change.snakhash ? { snakhash: change.snakhash } : {}),
    });
  }
  for (const ref of side.references) {
    await post({
      action: 'wbsetreference',
      statement: statementId,
      snaks: JSON.stringify({
        [IMPORTED_FROM]: [{
          snaktype: 'value',
          property: IMPORTED_FROM,
          datavalue: { type: 'wikibase-entityid', value: { 'entity-type': 'item', 'numeric-id': Number(ENGLISH_WIKIPEDIA.slice(1)) } },
        }],
        [IMPORT_URL]: [{ snaktype: 'value', property: IMPORT_URL, datavalue: { type: 'string', value: ref.url } }],
      }),
      'snaks-order': JSON.stringify([IMPORTED_FROM, IMPORT_URL]),
    });
  }
  return { entityQid: side.entityQid, statementId, baseRevId: side.baseRevId, revisions };
}

// The person's statement first, then the office's; a side with nothing to change is skipped.
export async function applyTermPlan(req: Request, plan: TermPlan): Promise<AppliedSide[]> {
  if (plan.person.needsChoice || plan.office.needsChoice) throw new EditInputError('Choose which statement to edit first');
  const done: number[] = [];
  const applied: AppliedSide[] = [];
  for (const side of [plan.person, plan.office]) {
    if (sideHasWork(side)) applied.push(await applySide(req, side, done));
  }
  return applied;
}
