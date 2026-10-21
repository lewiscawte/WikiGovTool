import { Router } from 'express';
import { buildDepartmentsView } from '../services/departments';
import { UNITED_STATES_QID } from '../services/orgchart';

const QID_RE = /^Q[1-9]\d*$/;

export const departmentsRouter = Router();

// GET /api/departments?date=YYYY-MM-DD&country=Q30 — the government grouped by department,
// each with its head office and the other offices within it, as held on `date`.
departmentsRouter.get('/', async (req, res, next) => {
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
    res.json(await buildDepartmentsView(date, countryParam));
  } catch (err) {
    next(err);
  }
});
