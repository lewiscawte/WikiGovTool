import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { refreshCountry } from '../services/departments';
import { purgeDepartments, purgeItems, purgeOffices } from '../services/wikidataClient';

const QID_RE = /^Q[1-9]\d*$/;

export const cacheRouter = Router();

const PURGES: Record<string, (qid: string) => Promise<unknown>> = {
  office: (qid) => purgeOffices([qid]),
  department: (qid) => purgeDepartments([qid]),
  item: (qid) => purgeItems([qid]),
  country: refreshCountry,
};

// POST /api/cache/refresh { scope: "office" | "department" | "item" | "country", qid } — forgets
// what's cached so the next view refetches it from Wikidata. Logged-in only: a purge sends the
// next view's queries to Wikidata, so anyone able to purge at will could make the server flood it.
cacheRouter.post('/refresh', requireAuth, async (req, res, next) => {
  try {
    const { scope, qid } = req.body ?? {};
    const purge = typeof scope === 'string' && Object.prototype.hasOwnProperty.call(PURGES, scope) ? PURGES[scope] : null;
    if (!purge) {
      res.status(400).json({ error: 'scope must be office, department, item or country' });
      return;
    }
    if (typeof qid !== 'string' || !QID_RE.test(qid)) {
      res.status(400).json({ error: 'qid must look like "Q12345"' });
      return;
    }
    console.log(`[cache] refresh ${scope} ${qid} by ${req.session.user?.username}`);
    await purge(qid);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
