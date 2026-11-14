import { EditInputError, formatTime, parseDateInput, TimeInput, timeValue } from './wikidataEdits';

// A department's formation and dissolution: which departments it came from and went to. One
// statement per other department, so a department formed from parts of several, or split
// several ways, is a statement each, with the part concerned (applies to part, P518) and the
// date (point in time, P585) as qualifiers. replaces / replaced by are each other's inverse,
// so the other department gets the matching statement; separated from and merged into have
// none. Statements are only ever added: what Wikidata already has is never changed.

const QID_RE = /^Q[1-9]\d*$/;
const MAX_LINKS = 10;
const APPLIES_TO_PART = 'P518';
const POINT_IN_TIME = 'P585';
const REFERENCE_URL = 'P854';

export type FormedRelation = 'P1365' | 'P807';
export type DissolvedRelation = 'P1366' | 'P7888';
export type SuccessionProperty = FormedRelation | DissolvedRelation;

export const SUCCESSION_LABELS: Record<SuccessionProperty | 'P518' | 'P585', string> = {
  P1365: 'replaces',
  P807: 'separated from',
  P1366: 'replaced by',
  P7888: 'merged into',
  P518: 'applies to part',
  P585: 'point in time',
};

const INVERSE: Partial<Record<SuccessionProperty, SuccessionProperty>> = { P1365: 'P1366', P1366: 'P1365' };

export interface SuccessionLink {
  relation: SuccessionProperty;
  // The other department.
  qid: string;
  partQid: string | null;
  date: TimeInput | null;
}

export interface SuccessionInput {
  departmentQid: string;
  links: SuccessionLink[];
  sourceUrl: string | null;
}

function parseLinks(raw: unknown, allowed: SuccessionProperty[], field: string, departmentQid: string): SuccessionLink[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new EditInputError(`${field} must be a list`);
  if (raw.length > MAX_LINKS) throw new EditInputError(`${field} has more than ${MAX_LINKS} departments`);
  return raw.map((r: any) => {
    if (!allowed.includes(r?.relation)) throw new EditInputError(`${field}: relation must be ${allowed.map((p) => SUCCESSION_LABELS[p]).join(' or ')}`);
    if (typeof r.qid !== 'string' || !QID_RE.test(r.qid)) throw new EditInputError(`${field}: each department must be a Wikidata item (Q…)`);
    if (r.qid === departmentQid) throw new EditInputError(`${field}: a department can't come from or go to itself`);
    if (r.partQid != null && r.partQid !== '' && !(typeof r.partQid === 'string' && QID_RE.test(r.partQid))) {
      throw new EditInputError(`${field}: the part must be a Wikidata item (Q…)`);
    }
    return {
      relation: r.relation,
      qid: r.qid,
      partQid: r.partQid || null,
      date: parseDateInput(typeof r.date === 'string' ? r.date : null, `${field} date`),
    };
  });
}

// { departmentQid, formedFrom: [{ relation, qid, partQid?, date? }], dissolvedInto: [...], sourceUrl? }
// requireLinks: false when the links come with other changes to the department.
export function parseSuccession(body: any, { requireLinks = true } = {}): SuccessionInput {
  const departmentQid = body?.departmentQid;
  if (typeof departmentQid !== 'string' || !QID_RE.test(departmentQid)) throw new EditInputError('This department has no Wikidata item');
  const links = [
    ...parseLinks(body.formedFrom, ['P1365', 'P807'], 'Formed from', departmentQid),
    ...parseLinks(body.dissolvedInto, ['P1366', 'P7888'], 'On dissolution', departmentQid),
  ];
  if (requireLinks && links.length === 0) throw new EditInputError('Add a department it was formed from or dissolved into');
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : '';
  if (sourceUrl && (sourceUrl.length > 500 || !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(sourceUrl))) {
    throw new EditInputError('Source URL must be a web address starting http:// or https://');
  }
  return { departmentQid, links, sourceUrl: sourceUrl || null };
}

export interface PlannedSuccessionStatement {
  property: SuccessionProperty;
  valueQid: string;
  partQid: string | null;
  date: TimeInput | null;
  // Display text for the date, in the form's notation.
  dateText: string | null;
  // Why nothing is sent for it: Wikidata already has it.
  existing: boolean;
}

export interface SuccessionSide {
  entityQid: string;
  entityLabel: string;
  baseRevId: number;
  statements: PlannedSuccessionStatement[];
}

export interface SuccessionPlan {
  sides: SuccessionSide[];
  sourceUrl: string | null;
}

const itemOf = (snak: any): string | null => {
  const v = snak?.snaktype === 'value' ? snak.datavalue?.value : null;
  return v ? (v.id ?? (v['numeric-id'] ? `Q${v['numeric-id']}` : null)) : null;
};

// Already recorded: a statement with this value and, if a part is given, that part. A
// statement differing only in its date counts too, since dates are never changed here.
function alreadyHas(entity: any, property: string, valueQid: string, partQid: string | null): boolean {
  return (entity.claims?.[property] ?? []).some((c: any) => itemOf(c.mainsnak) === valueQid
    && (partQid === null || (c.qualifiers?.[APPLIES_TO_PART] ?? []).some((q: any) => itemOf(q) === partQid)));
}

// entities: the department and every department it links to, fresh from the API.
export function planSuccession(input: SuccessionInput, entities: Map<string, any>): SuccessionPlan {
  const sides = new Map<string, SuccessionSide>();
  const sideFor = (qid: string): SuccessionSide => {
    const entity = entities.get(qid);
    if (!entity) throw new EditInputError(`${qid} wasn't found on Wikidata`);
    if (!sides.has(qid)) {
      sides.set(qid, { entityQid: qid, entityLabel: entity.labels?.en?.value ?? qid, baseRevId: entity.lastrevid, statements: [] });
    }
    return sides.get(qid)!;
  };
  const add = (onQid: string, property: SuccessionProperty, valueQid: string, link: SuccessionLink) => {
    const side = sideFor(onQid);
    if (side.statements.some((s) => s.property === property && s.valueQid === valueQid && s.partQid === link.partQid)) return;
    side.statements.push({
      property,
      valueQid,
      partQid: link.partQid,
      date: link.date,
      dateText: link.date ? formatTime(link.date) : null,
      existing: alreadyHas(entities.get(onQid), property, valueQid, link.partQid),
    });
  };

  sideFor(input.departmentQid);
  for (const link of input.links) {
    if (!entities.has(link.qid)) throw new EditInputError(`${link.qid} wasn't found on Wikidata`);
    add(input.departmentQid, link.relation, link.qid, link);
    const inverse = INVERSE[link.relation];
    if (inverse) add(link.qid, inverse, input.departmentQid, link);
  }
  return { sides: [...sides.values()], sourceUrl: input.sourceUrl };
}

export const successionHasWork = (plan: SuccessionPlan) => plan.sides.some((s) => s.statements.some((st) => !st.existing));

const itemSnak = (property: string, qid: string) => ({
  snaktype: 'value', property, datavalue: { type: 'wikibase-entityid', value: { 'entity-type': 'item', 'numeric-id': Number(qid.slice(1)), id: qid } },
});

export function statementData(s: PlannedSuccessionStatement, sourceUrl: string | null) {
  const qualifiers: Record<string, unknown[]> = {};
  if (s.partQid) qualifiers[APPLIES_TO_PART] = [itemSnak(APPLIES_TO_PART, s.partQid)];
  if (s.date) qualifiers[POINT_IN_TIME] = [{ snaktype: 'value', property: POINT_IN_TIME, datavalue: { type: 'time', value: timeValue(s.date) } }];
  return {
    type: 'statement',
    rank: 'normal',
    mainsnak: itemSnak(s.property, s.valueQid),
    ...(Object.keys(qualifiers).length ? { qualifiers, 'qualifiers-order': Object.keys(qualifiers) } : {}),
    ...(sourceUrl ? { references: [{ snaks: { [REFERENCE_URL]: [{ snaktype: 'value', property: REFERENCE_URL, datavalue: { type: 'string', value: sourceUrl } }] } }] } : {}),
  };
}

// Every item the plan mentions, to label them in the preview.
export function successionItems(plan: SuccessionPlan): string[] {
  return [...new Set(plan.sides.flatMap((s) => s.statements.flatMap((st) => [st.valueQid, ...(st.partQid ? [st.partQid] : [])])))];
}
