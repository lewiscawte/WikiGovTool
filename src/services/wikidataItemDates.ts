import { Request } from 'express';
import { config } from '../config';
import { wikimediaApiPost } from './wikimediaAuth';
import { EditInputError, formatTime, TimeInput, timeValue, WikidataApiError } from './wikidataEdits';

// An item's own dates: inception (P571) and dissolved (P576), for departments and offices alike.
// A date typed in a dialog is added when the item has none, and replaces the value when it
// differs; a blank one leaves Wikidata alone.

const REFERENCE_URL = 'P854';

export type DateProperty = 'P571' | 'P576';
export const DATE_LABELS: Record<DateProperty, string> = { P571: 'inception', P576: 'dissolved, abolished or demolished date' };

export interface DateChange {
  field: DateProperty;
  label: string;
  from: string | null;
  to: string;
  value: TimeInput;
  // The statement whose value changes (none: a new statement), and how many references it
  // loses, since they cited the old value.
  statementId?: string;
  referencesDropped?: number;
}

// A Wikibase time as the form may show it: "1950", "1950-01", "1950-01-19", or padded to a
// full day as the query service gives it ("1950-01-01" for a year-precision 1950).
function formsOf(t: { time: string; precision: number }): string[] {
  const short = formatTime(t);
  const [y, m = '01', d = '01'] = short.split('-');
  return [short, `${y}-${m === '00' ? '01' : m}-${d === '00' ? '01' : d}`];
}

export function planItemDate(entity: any, property: DateProperty, value: TimeInput | null): DateChange | null {
  if (!value) return null;
  const typed = formatTime(value);
  const statements = (entity.claims?.[property] ?? []).filter((c: any) => c.rank !== 'deprecated');
  const values = statements.map((c: any) => (c.mainsnak?.snaktype === 'value' ? c.mainsnak.datavalue?.value : null));
  if (values.some((v: any) => v && formsOf(v).includes(typed))) return null;
  const label = DATE_LABELS[property];
  if (statements.length > 1) {
    throw new EditInputError(`${entity.id} has ${statements.length} ${label} statements on Wikidata; change the right one there`);
  }
  const current = statements[0];
  return {
    field: property,
    label,
    from: values[0] ? formatTime(values[0]) : current ? 'unknown value' : null,
    to: typed,
    value,
    ...(current ? { statementId: current.id, referencesDropped: (current.references ?? []).length } : {}),
  };
}

export function itemDateStatement(entity: any, change: DateChange, sourceUrl: string | null) {
  const current = change.statementId ? (entity.claims?.[change.field] ?? []).find((c: any) => c.id === change.statementId) : null;
  return {
    ...(current ? { id: current.id, rank: current.rank, qualifiers: current.qualifiers, 'qualifiers-order': current['qualifiers-order'] } : { rank: 'normal' }),
    type: 'statement',
    mainsnak: { snaktype: 'value', property: change.field, datavalue: { type: 'time', value: timeValue(change.value) } },
    // The old references cited the old date, so they go; the source given now replaces them.
    references: sourceUrl ? [{ snaks: { [REFERENCE_URL]: [{ snaktype: 'value', property: REFERENCE_URL, datavalue: { type: 'string', value: sourceUrl } }] } }] : [],
  };
}

// Sends date changes to one item as a single edit, based on baserevid so a change by anyone
// else since fails rather than being overwritten. Returns the new revision.
export async function applyItemDates(req: Request, entity: any, baserevid: number, changes: DateChange[], sourceUrl: string | null = null): Promise<number> {
  const result = await wikimediaApiPost(req, config.wikidataApi, {
    action: 'wbeditentity',
    id: entity.id,
    baserevid: String(baserevid),
    data: JSON.stringify({ claims: changes.map((c) => itemDateStatement(entity, c, sourceUrl)) }),
    summary: `Set ${changes.map((c) => c.label).join(' and ')} via WikiGovTool`,
    ...(config.wikidataEditTags ? { tags: config.wikidataEditTags } : {}),
  });
  if (result?.error) throw new WikidataApiError(result.error.code, result.error.info, entity.id, []);
  return result.entity?.lastrevid;
}
