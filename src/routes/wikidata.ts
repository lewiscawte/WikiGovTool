import { Router } from 'express';
import {
  fetchEntityForEdit, getEntity, invalidateItem, invalidateOfficeholderHistory, purgeCountryLists, searchEntities,
} from '../services/wikidataClient';
import {
  createItem, fetchLabels, findPossibleDuplicates, parseNewItem, plannedStatements, PROPERTY_LABELS, referencedItems,
} from '../services/wikidataCreate';
import {
  applySuccession, parseSuccession, planSuccession, SUCCESSION_LABELS, SuccessionPlan, successionHasWork, successionItems,
} from '../services/wikidataSuccession';
import {
  applyTermPlan, EditInputError, parseDateInput, planHasWork, planTermEdit, TermPlan, TermProperty, WikidataApiError,
  WikipediaSource,
} from '../services/wikidataEdits';
import { fetchRevisionTitle } from '../services/wikipediaClient';
import { requireAuth } from '../middleware/requireAuth';
import { recordTermEdit } from '../store/recentTermEdits';
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

// Officeholder term dates: start/end time qualifiers on the person's position held statement
// and the office's officeholder statement. Both endpoints take { personQid, positionQid, start,
// end, statementId?, officeStatementId?, sources? }; dates are "YYYY", "YYYY-MM" or
// "YYYY-MM-DD", and an empty date is only filled in where one side has it and the other has
// nothing. sources.start / sources.end ({ title, revid }) mark a date as copied from that
// Wikipedia revision, which is then cited on the statements.
async function planFromBody(body: any): Promise<{ plan: TermPlan; person: any }> {
  const { personQid, positionQid, start, end, statementId, officeStatementId, sources } = body ?? {};
  if (typeof personQid !== 'string' || !QID_RE.test(personQid)) throw new EditInputError('No officeholder Wikidata item to edit');
  if (typeof positionQid !== 'string' || !QID_RE.test(positionQid)) throw new EditInputError('This office has no Wikidata item');
  const startValue = parseDateInput(start, 'Took office');
  const endValue = parseDateInput(end, 'Left office');
  if (!startValue && !endValue) throw new EditInputError('Enter a took office or left office date to save');
  if (startValue && endValue && startValue.time > endValue.time) throw new EditInputError('Left office is before took office');
  if (statementId != null && typeof statementId !== 'string') throw new EditInputError('Invalid statement id');
  if (officeStatementId != null && typeof officeStatementId !== 'string') throw new EditInputError('Invalid statement id');
  const verified: Partial<Record<TermProperty, WikipediaSource | null>> = {
    P580: startValue ? await verifiedSource(sources?.start, 'took office') : null,
    P582: endValue ? await verifiedSource(sources?.end, 'left office') : null,
  };
  const [person, office] = await Promise.all([fetchEntityForEdit(personQid), fetchEntityForEdit(positionQid)]);
  if (!person) throw new EditInputError(`${personQid} wasn't found on Wikidata`);
  if (!office) throw new EditInputError(`${positionQid} wasn't found on Wikidata`);
  const plan = planTermEdit(person, office, startValue, endValue,
    { person: statementId || null, office: officeStatementId || null }, verified);
  return { plan, person };
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
    const { plan } = await planFromBody(req.body);
    res.json({ plan, username: req.session.user?.username, tags: config.wikidataEditTags || null });
  } catch (err) {
    if (err instanceof EditInputError) res.status(400).json({ error: err.message });
    else next(err);
  }
});

wikidataRouter.post('/term/save', requireAuth, async (req, res, next) => {
  try {
    // Re-planned from the live item rather than trusting the previewed plan, and refused if
    // the item changed since the preview, so the user only publishes what they reviewed.
    const { plan, person } = await planFromBody(req.body);
    const changed = [
      Number(req.body?.baseRevId) !== plan.person.baseRevId ? plan.person.entityQid : null,
      Number(req.body?.officeBaseRevId) !== plan.office.baseRevId ? plan.office.entityQid : null,
    ].filter(Boolean);
    if (changed.length) {
      res.status(409).json({ error: `${changed.join(' and ')} changed on Wikidata since the preview. Review the edit again.` });
      return;
    }
    if (plan.person.needsChoice) throw new EditInputError('Choose which position held statement to edit');
    if (plan.office.needsChoice) throw new EditInputError('Choose which officeholder statement to edit');
    if (!planHasWork(plan)) throw new EditInputError('Nothing to change: Wikidata already has these dates');
    const applied = await applyTermPlan(req, plan);
    recordSavedTerm(plan, person);
    await invalidateOfficeholderHistory(plan.office.entityQid);
    res.json({ applied, personQid: plan.person.entityQid });
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

// A department's formation and dissolution: { departmentQid, formedFrom, dissolvedInto,
// sourceUrl? } (see parseSuccession). Statements are only added, never changed or removed.
async function successionFromBody(body: any): Promise<SuccessionPlan> {
  const input = parseSuccession(body);
  const qids = [...new Set([input.departmentQid, ...input.links.map((l) => l.qid)])];
  const entities = await Promise.all(qids.map((q) => fetchEntityForEdit(q)));
  return planSuccession(input, new Map(qids.map((q, i) => [q, entities[i]] as const).filter(([, e]) => e)));
}

wikidataRouter.post('/succession/preview', requireAuth, async (req, res, next) => {
  try {
    const plan = await successionFromBody(req.body);
    res.json({
      plan,
      labels: await fetchLabels(successionItems(plan)),
      propertyLabels: SUCCESSION_LABELS,
      username: req.session.user?.username,
      tags: config.wikidataEditTags || null,
    });
  } catch (err) {
    if (err instanceof EditInputError) res.status(400).json({ error: err.message });
    else next(err);
  }
});

wikidataRouter.post('/succession/save', requireAuth, async (req, res, next) => {
  try {
    // Re-planned from the live items, and refused if any changed since the preview.
    const plan = await successionFromBody(req.body);
    const previewed = req.body?.baseRevIds ?? {};
    const changed = plan.sides.filter((s) => Number(previewed[s.entityQid]) !== s.baseRevId).map((s) => s.entityQid);
    if (changed.length) {
      res.status(409).json({ error: `${changed.join(', ')} changed on Wikidata since the preview. Review the edit again.` });
      return;
    }
    if (!successionHasWork(plan)) throw new EditInputError('Nothing to add: Wikidata already has these');
    const applied = await applySuccession(req, plan);
    await Promise.all(plan.sides.map((s) => invalidateItem('department', s.entityQid)));
    res.json({ applied });
  } catch (err) {
    if (err instanceof EditInputError) res.status(400).json({ error: err.message });
    else if (err instanceof WikidataApiError) {
      res.status(502).json({ error: `Wikidata refused the edit to ${err.entityQid} (${err.code}): ${err.message}`, revisions: err.completedRevisions });
    } else next(err);
  }
});
