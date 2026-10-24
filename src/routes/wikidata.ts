import { Router } from 'express';
import { fetchEntityForEdit, getEntity, invalidateOfficeholderHistory, searchEntities } from '../services/wikidataClient';
import {
  applyTermPlan, EditInputError, parseDateInput, planTermEdit, TermPlan, TermProperty, WikidataApiError, WikipediaSource,
} from '../services/wikidataEdits';
import { fetchRevisionTitle } from '../services/wikipediaClient';
import { requireAuth } from '../middleware/requireAuth';
import { wikimediaApiPost } from '../services/wikimediaAuth';
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

wikidataRouter.post('/save', requireAuth, async (req, res, next) => {
  try {
    const { id, data, summary } = req.body as { id?: string; data?: any; summary?: string };
    if (!id || !QID_RE.test(id)) {
      res.status(400).json({ error: 'Invalid QID' });
      return;
    }
    if (!data) {
      res.status(400).json({ error: 'Missing data' });
      return;
    }

    const result = await wikimediaApiPost(req, config.wikidataApi, {
      action: 'wbeditentity',
      id,
      data: JSON.stringify(data),
      summary: summary || 'Edit via WikiGovTool',
    });

    res.json(result);
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

// Officeholder term dates: start/end time qualifiers on the person's position held statement.
// Both endpoints take { personQid, positionQid, start, end, statementId?, sources? }; dates are
// "YYYY", "YYYY-MM" or "YYYY-MM-DD", and an empty date leaves Wikidata's value alone.
// sources.start / sources.end ({ title, revid }) mark a date as copied from that Wikipedia
// revision, which is then cited on the statement.
async function planFromBody(body: any): Promise<TermPlan> {
  const { personQid, positionQid, start, end, statementId, sources } = body ?? {};
  if (typeof personQid !== 'string' || !QID_RE.test(personQid)) throw new EditInputError('No officeholder Wikidata item to edit');
  if (typeof positionQid !== 'string' || !QID_RE.test(positionQid)) throw new EditInputError('This office has no Wikidata item');
  const startValue = parseDateInput(start, 'Took office');
  const endValue = parseDateInput(end, 'Left office');
  if (!startValue && !endValue) throw new EditInputError('Enter a took office or left office date to save');
  if (startValue && endValue && startValue.time > endValue.time) throw new EditInputError('Left office is before took office');
  if (statementId != null && typeof statementId !== 'string') throw new EditInputError('Invalid statement id');
  const verified: Partial<Record<TermProperty, WikipediaSource | null>> = {
    P580: startValue ? await verifiedSource(sources?.start, 'took office') : null,
    P582: endValue ? await verifiedSource(sources?.end, 'left office') : null,
  };
  const entity = await fetchEntityForEdit(personQid);
  if (!entity) throw new EditInputError(`${personQid} wasn't found on Wikidata`);
  return planTermEdit(entity, positionQid, startValue, endValue, statementId || null, verified);
}

// What a save would change, for the user to confirm.
wikidataRouter.post('/term/preview', requireAuth, async (req, res, next) => {
  try {
    const plan = await planFromBody(req.body);
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
    const plan = await planFromBody(req.body);
    if (Number(req.body?.baseRevId) !== plan.baseRevId) {
      res.status(409).json({ error: `${plan.personQid} has changed on Wikidata since the preview. Review the edit again.` });
      return;
    }
    if (plan.needsChoice) throw new EditInputError('Choose which position held statement to edit');
    if (plan.changes.length === 0) throw new EditInputError('Nothing to change: Wikidata already has these dates');
    const applied = await applyTermPlan(req, plan);
    invalidateOfficeholderHistory();
    res.json({ ...applied, personQid: plan.personQid });
  } catch (err) {
    if (err instanceof EditInputError) res.status(400).json({ error: err.message });
    else if (err instanceof WikidataApiError) {
      res.status(502).json({ error: `Wikidata refused the edit (${err.code}): ${err.message}`, revisions: err.completedRevisions });
    } else next(err);
  }
});
