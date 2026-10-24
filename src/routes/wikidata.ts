import { Router } from 'express';
import { getEntity, searchEntities } from '../services/wikidataClient';
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
