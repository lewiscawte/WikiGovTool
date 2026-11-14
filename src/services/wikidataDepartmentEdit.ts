import { Request } from 'express';
import { config } from '../config';
import { wikimediaApiPost } from './wikimediaAuth';
import { EditInputError, parseDateInput, TimeInput, WikidataApiError } from './wikidataEdits';
import { DateChange, DateProperty, itemDateStatement, planItemDate } from './wikidataItemDates';
import {
  parseSuccession, planSuccession, statementData, SUCCESSION_LABELS, SuccessionInput, SuccessionPlan, successionHasWork,
} from './wikidataSuccession';

// Everything the department edit dialog saves to Wikidata in one go: the department's English
// label, English Wikipedia link, inception (P571) and dissolved (P576) dates, and the departments
// it was formed from or dissolved into (wikidataSuccession.ts). A blank field leaves Wikidata's
// value alone; nothing is ever removed. planDepartmentEdit is pure, so the preview and the save
// compute the same thing.

const MAX_LABEL_LENGTH = 250;
const MAX_TITLE_LENGTH = 255;


export interface DepartmentEditInput {
  succession: SuccessionInput;
  label: string | null;
  wikipediaTitle: string | null;
  dates: Record<DateProperty, TimeInput | null>;
}

export function parseDepartmentEdit(body: any): DepartmentEditInput {
  const succession = parseSuccession(body, { requireLinks: false });
  const text = (raw: unknown, field: string, max: number) => {
    if (raw != null && typeof raw !== 'string') throw new EditInputError(`${field} must be text`);
    const value = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (value.length > max) throw new EditInputError(`${field} is longer than ${max} characters`);
    return value || null;
  };
  const dates = {
    P571: parseDateInput(typeof body.inception === 'string' ? body.inception : null, 'Inception'),
    P576: parseDateInput(typeof body.dissolved === 'string' ? body.dissolved : null, 'Dissolved'),
  };
  if (dates.P571 && dates.P576 && dates.P571.time > dates.P576.time) throw new EditInputError('Dissolved is before inception');
  return {
    succession,
    label: text(body.label, 'Name', MAX_LABEL_LENGTH),
    wikipediaTitle: text(body.wikipediaTitle, 'Wikipedia title', MAX_TITLE_LENGTH),
    dates,
  };
}

// A change to the department's own label or Wikipedia link, or one of its dates.
export type FieldChange = { field: 'label' | 'wikipedia'; label: string; from: string | null; to: string } | DateChange;

const isDateChange = (f: FieldChange): f is DateChange => f.field === 'P571' || f.field === 'P576';

export interface DepartmentEditPlan {
  departmentQid: string;
  fields: FieldChange[];
  succession: SuccessionPlan;
}

const sameTitle = (a: string, b: string) => a.replace(/_/g, ' ') === b.replace(/_/g, ' ');

// entities: the department and every department it links to, fresh from the API.
export function planDepartmentEdit(input: DepartmentEditInput, entities: Map<string, any>): DepartmentEditPlan {
  const succession = planSuccession(input.succession, entities);
  const qid = input.succession.departmentQid;
  const entity = entities.get(qid);
  const fields: FieldChange[] = [];

  const currentLabel = entity.labels?.en?.value ?? null;
  if (input.label && input.label !== currentLabel) fields.push({ field: 'label', label: 'English label', from: currentLabel, to: input.label });
  const currentTitle = entity.sitelinks?.enwiki?.title ?? null;
  if (input.wikipediaTitle && !(currentTitle && sameTitle(currentTitle, input.wikipediaTitle))) {
    fields.push({ field: 'wikipedia', label: 'English Wikipedia article', from: currentTitle, to: input.wikipediaTitle.replace(/_/g, ' ') });
  }
  for (const property of ['P571', 'P576'] as const) {
    const change = planItemDate(entity, property, input.dates[property]);
    if (change) fields.push(change);
  }
  return { departmentQid: qid, fields, succession };
}

export const departmentEditHasWork = (plan: DepartmentEditPlan) => plan.fields.length > 0 || successionHasWork(plan.succession);

export interface AppliedDepartmentEdit {
  entityQid: string;
  baseRevId: number;
  revid: number;
}

// One edit per item, each based on the revision the preview read, so a change by anyone else
// in between fails rather than being overwritten. The department's own edit goes first.
export async function applyDepartmentEdit(req: Request, plan: DepartmentEditPlan, entities: Map<string, any>): Promise<AppliedDepartmentEdit[]> {
  const sourceUrl = plan.succession.sourceUrl;
  const applied: AppliedDepartmentEdit[] = [];
  for (const side of plan.succession.sides) {
    const links = side.statements.filter((s) => !s.existing);
    const fields = side.entityQid === plan.departmentQid ? plan.fields : [];
    if (links.length === 0 && fields.length === 0) continue;

    const data: Record<string, unknown> = {
      claims: [
        ...links.map((s) => statementData(s, sourceUrl)),
        ...fields.filter(isDateChange).map((f) => itemDateStatement(entities.get(side.entityQid), f, sourceUrl)),
      ],
    };
    const label = fields.find((f) => f.field === 'label');
    if (label) data.labels = { en: { language: 'en', value: label.to } };
    const wikipedia = fields.find((f) => f.field === 'wikipedia');
    if (wikipedia) data.sitelinks = { enwiki: { site: 'enwiki', title: wikipedia.to } };

    const parts = [
      ...fields.map((f) => `set ${f.label}`),
      ...(links.length ? [`add ${[...new Set(links.map((s) => SUCCESSION_LABELS[s.property]))].join(', ')}`] : []),
    ];
    const result = await wikimediaApiPost(req, config.wikidataApi, {
      action: 'wbeditentity',
      id: side.entityQid,
      baserevid: String(side.baseRevId),
      data: JSON.stringify(data),
      summary: `Department: ${parts.join('; ')} via WikiGovTool`,
      ...(config.wikidataEditTags ? { tags: config.wikidataEditTags } : {}),
    });
    if (result?.error) throw new WikidataApiError(result.error.code, result.error.info, side.entityQid, applied.map((a) => a.revid));
    applied.push({ entityQid: side.entityQid, baseRevId: side.baseRevId, revid: result.entity?.lastrevid });
  }
  return applied;
}
