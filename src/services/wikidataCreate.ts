import { Request } from 'express';
import { config } from '../config';
import { upstreamJson } from './upstream';
import { wikimediaApiPost } from './wikimediaAuth';
import { EditInputError, parseDateInput, TimeInput, timeValue, WikidataApiError } from './wikidataEdits';

// New Wikidata items for a person, office or department nobody has created yet. The item is
// built here from a fixed set of fields per kind, never from JSON the browser sends, so the
// tool can only ever create the shapes below. buildNewItem is pure, so the preview and the
// create send exactly the same item.

const QID_RE = /^Q[1-9]\d*$/;
const MAX_TERM_LENGTH = 250;
const MAX_URL_LENGTH = 500;
const MAX_TITLE_LENGTH = 255;

export type ItemKind = 'person' | 'office' | 'department';

export const HUMAN = 'Q5';
export const POLITICIAN = 'Q82955';
export const POSITION = 'Q4164871';
export const GENDERS: Record<string, string> = { Q6581097: 'male', Q6581072: 'female' };
// What an office is a subclass of decides whether the tool finds it as a country's office.
export const OFFICE_CLASSES: Record<string, string> = { Q83307: 'minister', Q2285706: 'head of government', Q48352: 'head of state' };
const GENERAL_DEPARTMENT_CLASSES: Record<string, string> = { Q192350: 'ministry', Q327333: 'government agency' };
// The country's own department class first, where it has one (as in services/departments.ts).
const COUNTRY_DEPARTMENT_CLASSES: Record<string, Record<string, string>> = {
  Q30: { Q910252: 'United States federal executive department' },
  Q145: { Q2500378: 'department of the United Kingdom Government' },
};

export function departmentClassesFor(countryQid: string): Record<string, string> {
  return { ...COUNTRY_DEPARTMENT_CLASSES[countryQid], ...GENERAL_DEPARTMENT_CLASSES };
}

export const PROPERTY_LABELS: Record<string, string> = {
  P31: 'instance of',
  P279: 'subclass of',
  P106: 'occupation',
  P27: 'country of citizenship',
  P21: 'sex or gender',
  P569: 'date of birth',
  P102: 'member of political party',
  P39: 'position held',
  P580: 'start time',
  P582: 'end time',
  P1001: 'applies to jurisdiction',
  P17: 'country',
  P2389: 'organization directed by the office or position',
  P2388: 'position held by head of the organization',
  P571: 'inception',
  P856: 'official website',
  P854: 'reference URL',
};

export interface NewItem {
  kind: ItemKind;
  countryQid: string;
  label: string;
  description: string;
  wikipediaTitle: string | null;
  sourceUrl: string | null;
  // Person.
  politician?: boolean;
  citizen?: boolean;
  genderQid?: string | null;
  birthDate?: TimeInput | null;
  partyQid?: string | null;
  // The office the person is being added to: a position held statement, which is then paired
  // with an officeholder statement on the office.
  heldPositionQid?: string | null;
  heldStart?: TimeInput | null;
  heldEnd?: TimeInput | null;
  // Office.
  officeClassQid?: string;
  departmentQid?: string | null;
  // Department.
  departmentClassQid?: string;
  headOfficeQid?: string | null;
  website?: string | null;
  // Office and department.
  inception?: TimeInput | null;
}

function text(raw: unknown, field: string, { required = false, max = MAX_TERM_LENGTH } = {}): string | null {
  if (raw != null && typeof raw !== 'string') throw new EditInputError(`${field} must be text`);
  const value = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!value) {
    if (required) throw new EditInputError(`${field} is required`);
    return null;
  }
  if (value.length > max) throw new EditInputError(`${field} is longer than ${max} characters`);
  return value;
}

function qid(raw: unknown, field: string): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !QID_RE.test(raw)) throw new EditInputError(`${field} must be a Wikidata item (Q…)`);
  return raw;
}

function oneOf(raw: unknown, allowed: Record<string, string>, field: string): string {
  if (typeof raw !== 'string' || !Object.prototype.hasOwnProperty.call(allowed, raw)) {
    throw new EditInputError(`${field} must be one of: ${Object.values(allowed).join(', ')}`);
  }
  return raw;
}

function url(raw: unknown, field: string): string | null {
  const value = text(raw, field, { max: MAX_URL_LENGTH });
  if (value && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(value)) throw new EditInputError(`${field} must be a web address starting http:// or https://`);
  return value;
}

const date = (raw: unknown, field: string) => parseDateInput(typeof raw === 'string' ? raw : null, field);

// The request body → a checked NewItem. Anything not listed for the kind is ignored.
export function parseNewItem(body: any): NewItem {
  const kind = body?.kind;
  if (kind !== 'person' && kind !== 'office' && kind !== 'department') throw new EditInputError('kind must be person, office or department');
  const countryQid = qid(body.countryQid, 'Country');
  if (!countryQid) throw new EditInputError('Country is required');
  const label = text(body.label, 'Label', { required: true }) as string;
  const description = text(body.description, 'Description', { required: true }) as string;
  if (label.toLowerCase() === description.toLowerCase()) throw new EditInputError('Label and description must differ');
  const base: NewItem = {
    kind,
    countryQid,
    label,
    description,
    wikipediaTitle: text(body.wikipediaTitle, 'Wikipedia article', { max: MAX_TITLE_LENGTH }),
    sourceUrl: url(body.sourceUrl, 'Source URL'),
  };

  if (kind === 'person') {
    const heldPositionQid = qid(body.heldPositionQid, 'Office held');
    const heldStart = heldPositionQid ? date(body.heldStart, 'Took office') : null;
    const heldEnd = heldPositionQid ? date(body.heldEnd, 'Left office') : null;
    if (heldStart && heldEnd && heldStart.time > heldEnd.time) throw new EditInputError('Left office is before took office');
    return {
      ...base,
      politician: body.politician !== false,
      citizen: body.citizen !== false,
      genderQid: body.genderQid ? oneOf(body.genderQid, GENDERS, 'Sex or gender') : null,
      birthDate: date(body.birthDate, 'Date of birth'),
      partyQid: qid(body.partyQid, 'Political party'),
      heldPositionQid,
      heldStart,
      heldEnd,
    };
  }
  if (kind === 'office') {
    return {
      ...base,
      officeClassQid: oneOf(body.officeClassQid, OFFICE_CLASSES, 'Kind of office'),
      departmentQid: qid(body.departmentQid, 'Department'),
      inception: date(body.inception, 'Created'),
    };
  }
  return {
    ...base,
    departmentClassQid: oneOf(body.departmentClassQid, departmentClassesFor(countryQid), 'Kind of department'),
    headOfficeQid: qid(body.headOfficeQid, 'Head office'),
    inception: date(body.inception, 'Created'),
    website: url(body.website, 'Official website'),
  };
}

type Value = { item: string } | { time: TimeInput } | { url: string };

export interface PlannedStatement {
  property: string;
  value: Value;
  qualifiers: { property: string; value: Value }[];
  // Cited with the source URL; false for the statement that only says what kind of thing it is.
  sourced: boolean;
}

function datavalue(v: Value) {
  if ('item' in v) return { type: 'wikibase-entityid', value: { 'entity-type': 'item', 'numeric-id': Number(v.item.slice(1)), id: v.item } };
  if ('time' in v) return { type: 'time', value: timeValue(v.time) };
  return { type: 'string', value: v.url };
}

const snak = (property: string, v: Value) => ({ snaktype: 'value', property, datavalue: datavalue(v) });

export function plannedStatements(item: NewItem): PlannedStatement[] {
  const out: PlannedStatement[] = [];
  const add = (property: string, value: Value | null, { sourced = true, qualifiers = [] as PlannedStatement['qualifiers'] } = {}) => {
    if (value) out.push({ property, value, qualifiers, sourced });
  };
  const itemValue = (q: string | null | undefined) => (q ? { item: q } : null);
  const time = (t: TimeInput | null | undefined) => (t ? { time: t } : null);

  if (item.kind === 'person') {
    add('P31', { item: HUMAN }, { sourced: false });
    if (item.politician) add('P106', { item: POLITICIAN });
    if (item.citizen) add('P27', { item: item.countryQid });
    add('P21', itemValue(item.genderQid));
    add('P569', time(item.birthDate));
    add('P102', itemValue(item.partyQid));
    if (item.heldPositionQid) {
      const qualifiers = [
        ...(item.heldStart ? [{ property: 'P580', value: { time: item.heldStart } }] : []),
        ...(item.heldEnd ? [{ property: 'P582', value: { time: item.heldEnd } }] : []),
      ];
      add('P39', { item: item.heldPositionQid }, { qualifiers });
    }
  } else if (item.kind === 'office') {
    add('P31', { item: POSITION }, { sourced: false });
    add('P279', itemValue(item.officeClassQid));
    add('P1001', { item: item.countryQid });
    add('P17', { item: item.countryQid });
    add('P2389', itemValue(item.departmentQid));
    add('P571', time(item.inception));
  } else {
    add('P31', itemValue(item.departmentClassQid));
    add('P17', { item: item.countryQid });
    add('P2388', itemValue(item.headOfficeQid));
    add('P571', time(item.inception));
    add('P856', item.website ? { url: item.website } : null);
  }
  return out;
}

// The wbeditentity data for the new item.
export function buildNewItem(item: NewItem): Record<string, unknown> {
  const claims = plannedStatements(item).map((s) => ({
    type: 'statement',
    rank: 'normal',
    mainsnak: snak(s.property, s.value),
    ...(s.qualifiers.length ? {
      qualifiers: Object.fromEntries(s.qualifiers.map((q) => [q.property, [snak(q.property, q.value)]])),
      'qualifiers-order': s.qualifiers.map((q) => q.property),
    } : {}),
    ...(s.sourced && item.sourceUrl ? { references: [{ snaks: { P854: [snak('P854', { url: item.sourceUrl })] } }] } : {}),
  }));
  return {
    labels: { en: { language: 'en', value: item.label } },
    descriptions: { en: { language: 'en', value: item.description } },
    ...(item.wikipediaTitle ? { sitelinks: { enwiki: { site: 'enwiki', title: item.wikipediaTitle } } } : {}),
    claims,
  };
}

// Every item a new item's statements point at, to label them in the preview.
export function referencedItems(item: NewItem): string[] {
  const ids = plannedStatements(item).flatMap((s) => [s.value, ...s.qualifiers.map((q) => q.value)])
    .flatMap((v) => ('item' in v ? [v.item] : []));
  return [...new Set(ids)];
}

export async function fetchLabels(qids: string[]): Promise<Record<string, string>> {
  const valid = qids.filter((q) => QID_RE.test(q)).slice(0, 50);
  if (valid.length === 0) return {};
  const data = await upstreamJson(`${config.wikidataApi}?action=wbgetentities&ids=${valid.join('|')}&props=labels&languages=en&format=json`, 'Wikidata');
  return Object.fromEntries(valid.map((q) => [q, data.entities?.[q]?.labels?.en?.value ?? q]));
}

export interface PossibleDuplicate {
  id: string;
  label: string;
  description: string | null;
}

// Items whose English label or alias is exactly this label: probably the item being created.
export async function findPossibleDuplicates(label: string): Promise<PossibleDuplicate[]> {
  const data = await upstreamJson(
    `${config.wikidataApi}?action=wbsearchentities&search=${encodeURIComponent(label)}&language=en&type=item&limit=20&format=json`,
    'Wikidata',
  );
  const wanted = label.toLowerCase();
  return (data.search ?? [])
    .filter((r: any) => (r.match?.text ?? r.label ?? '').toLowerCase() === wanted)
    .map((r: any) => ({ id: r.id, label: r.label ?? r.id, description: r.description ?? null }));
}

function tagsParam(): Record<string, string> {
  return config.wikidataEditTags ? { tags: config.wikidataEditTags } : {};
}

// Wikidata explains a refused new item in error.messages; a conflict there (an article already
// linked, or a label and description another item has) names the item it conflicts with.
function refusal(error: any): string {
  const names: string[] = (error.messages ?? []).map((m: any) => m?.name).filter(Boolean);
  const conflicts = [...new Set(JSON.stringify(error.messages ?? []).match(/Q[1-9]\d*/g) ?? [])];
  return [error.info, names.length ? `(${names.join(', ')})` : '', conflicts.length ? `Conflicts with ${conflicts.join(', ')}.` : '']
    .filter(Boolean).join(' ');
}

export async function createItem(req: Request, item: NewItem): Promise<{ qid: string; revid: number }> {
  const data = await wikimediaApiPost(req, config.wikidataApi, {
    action: 'wbeditentity',
    new: 'item',
    data: JSON.stringify(buildNewItem(item)),
    summary: `Create ${item.kind} item via WikiGovTool`,
    ...tagsParam(),
  });
  if (data?.error) throw new WikidataApiError(data.error.code, refusal(data.error), 'a new item', []);
  return { qid: data.entity.id, revid: data.entity.lastrevid };
}
