import { Request } from 'express';
import { config } from '../config';
import { wikimediaApiPost } from './wikimediaAuth';

// Edits to Wikidata made on the user's behalf. Currently one kind: an officeholder's term
// dates, as start time (P580) / end time (P582) qualifiers on their position held (P39)
// statement for an office. planTermEdit works out what would change (pure, so the preview
// and the save compute the same thing); applyTermPlan sends it.

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

export interface TermPlan {
  personQid: string;
  personLabel: string;
  positionQid: string;
  baseRevId: number;
  // Every P39 statement on the person for this office.
  candidates: TermStatement[];
  // The statement to edit; null with needsChoice false means a new statement is created.
  statementId: string | null;
  // More than one candidate and none chosen: the user has to pick before anything is planned.
  needsChoice: boolean;
  changes: QualifierChange[];
  // Wikipedia revisions to cite on the statement: one per distinct source of a changed value.
  references: PlannedReference[];
}

// One qualifier's current state, as shown to the user.
function describeQualifier(snak: any): { text: string | null; hash?: string; time?: { time: string; precision: number } } {
  if (!snak) return { text: null };
  if (snak.snaktype === 'somevalue') return { text: 'unknown value', hash: snak.hash };
  if (snak.snaktype === 'novalue') return { text: 'no value', hash: snak.hash };
  const v = snak.datavalue?.value;
  return { text: v ? formatTime(v) : null, hash: snak.hash, time: v };
}

const positionOf = (claim: any): string | null => {
  const v = claim?.mainsnak?.snaktype === 'value' ? claim.mainsnak.datavalue?.value : null;
  return v ? (v.id ?? (v['numeric-id'] ? `Q${v['numeric-id']}` : null)) : null;
};

export function planTermEdit(
  entity: any,
  positionQid: string,
  start: TimeInput | null,
  end: TimeInput | null,
  statementId?: string | null,
  sources: Partial<Record<TermProperty, WikipediaSource | null>> = {},
): TermPlan {
  const claims: any[] = (entity.claims?.P39 ?? []).filter((c: any) => positionOf(c) === positionQid);
  const candidates: TermStatement[] = claims.map((c) => ({
    id: c.id,
    rank: c.rank,
    start: describeQualifier(c.qualifiers?.P580?.[0]).text,
    end: describeQualifier(c.qualifiers?.P582?.[0]).text,
  }));
  const plan: TermPlan = {
    personQid: entity.id,
    personLabel: entity.labels?.en?.value ?? entity.id,
    positionQid,
    baseRevId: entity.lastrevid,
    candidates,
    statementId: null,
    needsChoice: false,
    changes: [],
    references: [],
  };

  let claim: any = null;
  if (statementId) {
    claim = claims.find((c) => c.id === statementId);
    if (!claim) throw new EditInputError(`Statement ${statementId} is not a position held (${positionQid}) statement on ${entity.id}`);
  } else if (claims.length === 1) {
    claim = claims[0];
  } else if (claims.length > 1) {
    plan.needsChoice = true;
    return plan;
  }
  plan.statementId = claim?.id ?? null;

  for (const [property, value] of [['P580', start], ['P582', end]] as const) {
    if (!value) continue;
    const current = describeQualifier(claim?.qualifiers?.[property]?.[0]);
    const same = current.time && current.time.time === value.time && current.time.precision === value.precision;
    if (same) continue;
    plan.changes.push({
      property,
      label: TERM_PROPERTY_LABELS[property],
      from: current.text,
      to: formatTime(value),
      ...(current.hash ? { snakhash: current.hash } : {}),
      value,
    });
  }

  // Cite each Wikipedia revision a changed value came from, unless the statement already does.
  const cited = new Set<string>(
    (claim?.references ?? []).flatMap((r: any) => (r.snaks?.[IMPORT_URL] ?? []).map((sn: any) => sn.datavalue?.value)),
  );
  for (const change of plan.changes) {
    const source = sources[change.property];
    if (!source) continue;
    const url = importUrl(source);
    if (cited.has(url)) continue;
    cited.add(url);
    plan.references.push({ ...source, url });
  }
  return plan;
}

export class WikidataApiError extends Error {
  constructor(public code: string, info: string, public completedRevisions: number[]) {
    super(info);
  }
}

function tagsParam(): Record<string, string> {
  return config.wikidataEditTags ? { tags: config.wikidataEditTags } : {};
}

export interface AppliedEdit {
  statementId: string;
  revisions: number[];
}

// Sends a plan as a chain of edits, each based on the revision the previous one made, so an
// edit by anyone else in between fails with an edit conflict instead of being overwritten.
export async function applyTermPlan(req: Request, plan: TermPlan): Promise<AppliedEdit> {
  const imported = plan.references.length ? ', imported from English Wikipedia' : '';
  const summary = `Set ${plan.changes.map((c) => c.label).join(' and ')} of position held ([[${plan.positionQid}]])${imported} via WikiGovTool`;
  const revisions: number[] = [];
  let baserevid = plan.baseRevId;

  const post = async (params: Record<string, string>) => {
    const data = await wikimediaApiPost(req, config.wikidataApi, {
      ...params,
      baserevid: String(baserevid),
      summary,
      ...tagsParam(),
    });
    if (data?.error) throw new WikidataApiError(data.error.code, data.error.info, revisions);
    const revid = data?.pageinfo?.lastrevid;
    if (revid) {
      revisions.push(revid);
      baserevid = revid;
    }
    return data;
  };

  let statementId = plan.statementId;
  if (!statementId) {
    const created = await post({
      action: 'wbcreateclaim',
      entity: plan.personQid,
      property: 'P39',
      snaktype: 'value',
      value: JSON.stringify({ 'entity-type': 'item', 'numeric-id': Number(plan.positionQid.slice(1)) }),
    });
    statementId = created.claim.id as string;
  }
  for (const change of plan.changes) {
    await post({
      action: 'wbsetqualifier',
      claim: statementId,
      property: change.property,
      snaktype: 'value',
      value: JSON.stringify(timeValue(change.value)),
      ...(change.snakhash ? { snakhash: change.snakhash } : {}),
    });
  }
  for (const ref of plan.references) {
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
  return { statementId, revisions };
}
