import { Router } from 'express';
import { statsSummary } from '../services/stats';

export const statsRouter = Router();

// GET /api/stats — usage statistics: new items and edits by type, by user and by month. Public:
// every edit counted is public on Wikidata already.
statsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await statsSummary());
  } catch (err) {
    next(err);
  }
});
