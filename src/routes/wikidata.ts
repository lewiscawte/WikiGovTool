import { Router } from 'express';
import { getEntity, searchEntities } from '../services/wikidataClient';
import { requireAuth } from '../middleware/requireAuth';

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

// Writes are disabled for now (read-only deployment). Wire this up to wbeditentity,
// authenticated with the logged-in editor's own OAuth token, when ready to go live.
wikidataRouter.post('/save', requireAuth, (_req, res) => {
  res.status(501).json({
    error: 'Writes to Wikidata are disabled in this deployment',
    detail: 'Read-only mode: this endpoint is a placeholder until wbeditentity + a reviewed OAuth write flow are wired in.',
  });
});
