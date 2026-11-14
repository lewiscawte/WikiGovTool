import { Router } from 'express';
import {
  fetchEntityForEdit, getEntity, invalidateItem, invalidateOfficeholderHistory, purgeCountryLists, searchEntities,
} from '../services/wikidataClient';
import {
  createItem, fetchLabels, findPossibleDuplicates, parseNewItem, plannedStatements, PROPERTY_LABELS, referencedItems,
} from '../services/wikidataCreate';
import { SUCCESSION_LABELS, successionItems } from '../services/wikidataSuccession';
import { applyItemDates, DateChange, DateProperty, planItemDate } from '../services/wikidataItemDates';
import {
  applyDepartmentEdit, DepartmentEditPlan, departmentEditHasWork, parseDepartmentEdit, planDepartmentEdit,
} from '../services/wikidataDepartmentEdit';
import { setPublishedDepartment } from '../store/departmentStore';
import {
  applyTermPlan, EditInputError, parseDateInput, planHasWork, planTermEdit, TermPlan, TermProperty, WikidataApiError,
  WikipediaSource,
} from '../services/wikidataEdits';
import { fetchRevisionTitle } from '../services/wikipediaClient';
import { requireAuth } from '../middleware/requireAuth';
import { recordOfficeDates, recordTermEdit } from '../store/recentTermEdits';
import { config } from '../config';

const QID_RE = /^Q[1-9]\d*$/;

export const wikidataRouter = Router();

// Backs the "link Wikidata" typeahead in the editor dialog.
wikidataRouter.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ results: [] });
      return;
    }
    const results = await searchEntities(q);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

wikidataRouter.get('/entity/:qid', async (req, res, next) => {
  try {
    if (!QID_RE.test(req.params.qid)) {
      res.status(400).json({ error: 'Invalid QID' });
      return;
    }
    const entity = await getEntity(req.params.qid);
    if (!entity) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }
    res.json({ entity });
  } catch (err) {
    next(err);
  }
});

// A form value's claimed Wikipedia source, checked against Wikipedia before it's cited:
// the revision has to exist and belong to the named article.
async function verifiedSource(raw: any, field: string): Promise<WikipediaSource | null> {
  if (raw == null) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const revid = Number(raw.revid);
  if (!title || !Number.isInteger(revid) || revid <= 0) throw new EditInputError(`Invalid Wikipedia source for ${field}`);
  const actual = await fetchRevisionTitle(revid);
  if (!actual || actual.replace(/_/g, ' ') !== title.replace(/_/g, ' ')) {
    throw new EditInputError(`Wikipedia revision ${revid} isn't a revision of "${title}"`);
  }
  return { title: actual, revid };
}

// The office dialog's Save to Wikidata: the officeholder's term dates, as start/end time
// qualifiers on the person's position held statement and the office's officeholder statement,
// and the office's own inception / dissolved dates. Both endpoints take { personQid?,
// positionQid, start, end, statementId?, officeStatementId?, sources?, officeInception,
// officeDissolved }; dates are "YYYY", "YYYY-MM" or "YYYY-MM-DD". An empty term date is only
// filled in where one side has it and the other has nothing; an empty office date leaves
// Wikidata alone. sources.start / sources.end ({ title, revid }) mark a term date as copied
// from that Wikipedia revision, which is then cited on the statements.
interface OfficeSavePlan {
  plan: TermPlan | null;
  officeDates: DateChange[];
  person: any;
  office: any;
}

async function planFromBody(body: any): Promise<OfficeSavePlan> {
  const { personQid, positionQid, start, end, statementId, officeStatementId, sources, officeInception, officeDissolved } = body ?? {};
  if (typeof positionQid !== 'string' || !QID_RE.test(positionQid)) throw new EditInputError('This office has no Wikidata item');
  if (personQid != null && personQid !== '' && !(typeof personQid === 'string' && QID_RE.test(personQid))) {
    throw new EditInputError('Invalid officeholder Wikidata item');
  }
  const startValue = parseDateInput(start, 'Took office');
  const endValue = parseDateInput(end, 'Left office');
  if (startValue && endValue && startValue.time > endValue.time) throw new EditInputError('Left office is before took office');
  const inceptionValue = parseDateInput(typeof officeInception === 'string' ? officeInception : null, 'Created');
  const dissolvedValue = parseDateInput(typeof officeDissolved === 'string' ? officeDissolved : null, 'Abolished');
  if (inceptionValue && dissolvedValue && inceptionValue.time > dissolvedValue.time) throw new EditInputError('Abolished is before created');
  const termDates = Boolean(startValue || endValue);
  if (termDates && !personQid) throw new EditInputError('There is no officeholder to save term dates for');
  if (!termDates && !inceptionValue && !dissolvedValue) throw new EditInputError('Enter a date to save');
  if (statementId != null && typeof statementId !== 'string') throw new EditInputError('Invalid statement id');
  if (officeStatementId != null && typeof officeStatementId !== 'string') throw new EditInputError('Invalid statement id');
  const verified: Partial<Record<TermProperty, WikipediaSource | null>> = {
    P580: startValue ? await verifiedSource(sources?.start, 'took office') : null,
    P582: endValue ? await verifiedSource(sources?.end, 'left office') : null,
  };
  const [person, office] = await Promise.all([termDates ? fetchEntityForEdit(personQid) : null, fetchEntityForEdit(positionQid)]);
  if (termDates && !person) throw new EditInputError(`${personQid} wasn't found on Wikidata`);
  if (!office) throw new EditInputError(`${positionQid} wasn't found on Wikidata`);
  const plan = termDates
    ? planTermEdit(person, office, startValue, endValue, { person: statementId || null, office: officeStatementId || null }, verified)
    : null;
  const officeDates = [planItemDate(office, 'P571', inceptionValue), planItemDate(office, 'P576', dissolvedValue)]
    .filter((c): c is DateChange => c !== null);
  return { plan, officeDates, person, office };
}

const DATE_TEXT_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const dateText = (text: string | null | undefined) => (text && DATE_TEXT_RE.test(text) ? text : null);

// The person's position held statement as it stands after a save, for showing it before
// Wikidata's query service catches up.
function recordSavedTerm(plan: TermPlan, person: any): void {
  const side = plan.person;
  const before = side.candidates.find((c) => c.id === side.statementId);
  const after = (property: TermProperty, current: string | null | undefined) =>
    dateText(side.changes.find((c) => c.property === property)?.to ?? current);
  const image = person.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  recordTermEdit({
    positionQid: plan.office.entityQid,
    personQid: side.entityQid,
    personLabel: side.entityLabel,
    imageUrl: typeof image === 'string' ? `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image.replace(/ /g, '_'))}` : null,
    previousStart: dateText(before?.start),
    created: !before,
    start: after('P580', before?.start),
    end: after('P582', before?.end),
  });
}

// What a save would change, for the user to confirm.
wikidataRouter.post('/term/preview', requireAuth, async (req, res, next) => {
  try {
    const { plan, officeDates, office } = await planFromBody(req.body);
    res.json({
      plan,
      officeDates,
      office: { qid: office.id, label: office.labels?.en?.value ?? office.id, baseRevId: office.lastrevid },
      username: req.session.user?.username,
      tags: config.wikidataEditTags || null,
    });
  } catch (err) {
    if (err instanceof EditInputError) res.status(400).json({ error: err.message });
    else next(err);
  }
});

wikidataRouter.post('/term/save', requireAuth, async (req, res, next) => {
  try {
    // Re-planned from the live items rather than trusting the previewed plan, and refused if
    // either changed since the preview, so the user only publishes what they reviewed.
    const { plan, officeDates, person, office } = await planFromBody(req.body);
    const changed = [
      plan && Number(req.body?.baseRevId) !== plan.person.baseRevId ? plan.person.entityQid : null,
      Number(req.body?.officeBaseRevId) !== office.lastrevid ? office.id : null,
    ].filter(Boolean);
    if (changed.length) {
      res.status(409).json({ error: `${changed.join(' and ')} changed on Wikidata since the preview. Review the edit again.` });
      return;
    }
    if (plan?.person.needsChoice) throw new EditInputError('Choose which position held statement to edit');
    if (plan?.office.needsChoice) throw new EditInputError('Choose which officeholder statement to edit');
    const termWork = plan !== null && planHasWork(plan);
    if (!termWork && officeDates.length === 0) throw new EditInputError('Nothing to change: Wikidata already has these dates');

    const applied: { entityQid: string; baseRevId: number; revisions: number[] }[] = termWork ? await applyTermPlan(req, plan!) : [];
    if (plan && termWork) {
      recordSavedTerm(plan, person);
      await invalidateOfficeholderHistory(office.id);
    }
    if (officeDates.length) {
      // After the term's edits to the office, if any, so it continues from their revision.
      const officeEdits = applied.find((a) => a.entityQid === office.id);
      const baserevid = officeEdits?.revisions[officeEdits.revisions.length - 1] ?? office.lastrevid;
      let revid: number;
      try {
        revid = await applyItemDates(req, office, baserevid, officeDates);
      } catch (err) {
        if (err instanceof WikidataApiError) err.completedRevisions = applied.flatMap((a) => a.revisions);
        throw err;
      }
      if (officeEdits) officeEdits.revisions.push(revid);
      else applied.push({ entityQid: office.id, baseRevId: office.lastrevid, revisions: [revid] });
      const saved = (field: DateProperty) => officeDates.find((c) => c.field === field)?.to;
      recordOfficeDates(office.id, {
        ...(saved('P571') ? { inception: saved('P571') } : {}),
        ...(saved('P576') ? { dissolved: saved('P576') } : {}),
      });
      await invalidateItem('office', office.id);
    }
    res.json({ applied, personQid: plan?.person.entityQid ?? null });
  } catch (err) {
    if (err instanceof EditInputError) res.status(400).json({ error: err.message });
    else if (err instanceof WikidataApiError) {
      res.status(502).json({ error: `Wikidata refused the edit to ${err.entityQid} (${err.code}): ${err.message}`, revisions: err.completedRevisions });
    } else next(err);
  }
});

// New items for a person, office or department not on Wikidata yet. Both endpoints take the
// fields parseNewItem lists for the kind; the item itself is always built on the server.
wikidataRouter.post('/item/preview', requireAuth, async (req, res, next) => {
  try {
    const item = parseNewItem(req.body);
    const [labels, duplicates] = await Promise.all([fetchLabels(referencedItems(item)), findPossibleDuplicates(item.label)]);
    res.json({
      statements: plannedStatements(item),
      labels,
      propertyLabels: PROPERTY_LABELS,
      duplicates,
      username: req.session.user?.username,
      tags: config.wikidataEditTags || null,
    });
  } catch (err) {
    if (err instanceof EditInputError) res.status(400).json({ error: err.message });
    else next(err);
  }
});

wikidataRouter.post('/item/create', requireAuth, async (req, res, next) => {
  try {
    const item = parseNewItem(req.body);
    const created = await createItem(req, item);
    // A new person given the office they hold: the office lists them too (officeholder,
    // P1308), as a term saved through the office dialog would. The item exists by now either
    // way, so a failure here is reported alongside it rather than as a failed create.
    let officeholder: { revisions: number[] } | { error: string } | null = null;
    if (item.kind === 'person' && item.heldPositionQid) {
      try {
        const [person, office] = await Promise.all([fetchEntityForEdit(created.qid), fetchEntityForEdit(item.heldPositionQid)]);
        if (!person || !office) throw new Error('the new item or the office could not be read back from Wikidata');
        const plan = planTermEdit(person, office, item.heldStart ?? null, item.heldEnd ?? null);
        const applied = planHasWork(plan) ? await applyTermPlan(req, plan) : [];
        recordSavedTerm(plan, person);
        await invalidateOfficeholderHistory(item.heldPositionQid);
        officeholder = { revisions: applied.flatMap((a) => a.revisions) };
      } catch (err) {
        officeholder = { error: (err as Error).message };
      }
    }
    // So the country's office list is fetched again, and finds the office once Wikidata's
    // query service has it.
    if (item.kind === 'office') await purgeCountryLists(item.countryQid, null);
    if (item.kind !== 'person') await invalidateItem(item.kind, created.qid);
    res.status(201).json({ ...created, label: item.label, officeholder });
  } catch (err) {
    if (err instanceof EditInputError) res.status(400).json({ error: err.message });
    else if (err instanceof WikidataApiError) res.status(502).json({ error: `Wikidata refused the new item (${err.code}): ${err.message}` });
    else next(err);
  }
});

// The department edit dialog: { departmentQid, label, wikipediaTitle, inception, dissolved,
// formedFrom, dissolvedInto, sourceUrl? } (see parseDepartmentEdit). A blank field leaves
// Wikidata alone, and links to other departments are only ever added.
async function departmentEditFromBody(body: any): Promise<{ plan: DepartmentEditPlan; entities: Map<string, any> }> {
  const input = parseDepartmentEdit(body);
  const qids = [...new Set([input.succession.departmentQid, ...input.succession.links.map((l) => l.qid)])];
  const fetched = await Promise.all(qids.map((q) => fetchEntityForEdit(q)));
  const entities = new Map(qids.map((q, i) => [q, fetched[i]] as const).filter(([, e]) => e));
  return { plan: planDepartmentEdit(input, entities), entities };
}

wikidataRouter.post('/department/preview', requireAuth, async (req, res, next) => {
  try {
    const { plan } = await departmentEditFromBody(req.body);
    res.json({
      plan,
      labels: await fetchLabels(successionItems(plan.succession)),
      propertyLabels: SUCCESSION_LABELS,
      username: req.session.user?.username,
      tags: config.wikidataEditTags || null,
    });
  } catch (err) {
    if (err instanceof EditInputError) res.status(400).json({ error: err.message });
    else next(err);
  }
});

wikidataRouter.post('/department/save', requireAuth, async (req, res, next) => {
  try {
    // Re-planned from the live items, and refused if any changed since the preview.
    const { plan, entities } = await departmentEditFromBody(req.body);
    const previewed = req.body?.baseRevIds ?? {};
    const changed = plan.succession.sides.filter((s) => Number(previewed[s.entityQid]) !== s.baseRevId).map((s) => s.entityQid);
    if (changed.length) {
      res.status(409).json({ error: `${changed.join(', ')} changed on Wikidata since the preview. Review the edit again.` });
      return;
    }
    if (!departmentEditHasWork(plan)) throw new EditInputError('Nothing to change: Wikidata already has all of this');
    const applied = await applyDepartmentEdit(req, plan, entities);
    // The page reads departments through the query service, which is minutes behind: show the
    // published values meanwhile.
    const value = (field: string) => plan.fields.find((f) => f.field === field)?.to;
    const patch = Object.fromEntries(Object.entries({
      label: value('label'), wikipediaTitle: value('wikipedia'), inception: value('P571'), dissolved: value('P576'),
    }).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length) setPublishedDepartment(plan.departmentQid, patch);
    await Promise.all(plan.succession.sides.map((s) => invalidateItem('department', s.entityQid)));
    res.json({ applied });
  } catch (err) {
    if (err instanceof EditInputError) res.status(400).json({ error: err.message });
    else if (err instanceof WikidataApiError) {
      res.status(502).json({ error: `Wikidata refused the edit to ${err.entityQid} (${err.code}): ${err.message}`, revisions: err.completedRevisions });
    } else next(err);
  }
});
