import { Router } from 'express';
import { buildOrgChart, UNITED_STATES_QID } from '../services/orgchart';

const QID_RE = /^Q[1-9]\d*$/;

export const orgchartRouter = Router();

// GET /api/orgchart?date=YYYY-MM-DD&country=Q30 — powers the timeline slider + country
// selector. country defaults to the United States, which uses the curated static seed
// list; any other QID is discovered live from Wikidata (see services/orgchart.ts).
orgchartRouter.get('/', async (req, res, next) => {
  try {
    const dateParam = typeof req.query.date === 'string' ? req.query.date : undefined;
    const date = dateParam ? new Date(dateParam) : new Date();
    if (Number.isNaN(date.getTime())) {
      res.status(400).json({ error: 'Invalid date' });
      return;
    }
    const countryParam = typeof req.query.country === 'string' ? req.query.country : UNITED_STATES_QID;
    if (!QID_RE.test(countryParam)) {
      res.status(400).json({ error: 'country must look like "Q30"' });
      return;
    }
    const entries = await buildOrgChart(date, countryParam);
    res.json({ date: date.toISOString().slice(0, 10), country: countryParam, entries });
  } catch (err) {
    next(err);
  }
});
