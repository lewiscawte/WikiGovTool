import { Router } from 'express';
import { buildDepartmentsView } from '../services/departments';
import { UNITED_STATES_QID } from '../services/orgchart';
import { requireAuth } from '../middleware/requireAuth';
import { addExtraDepartment, setDepartmentOverride } from '../store/departmentStore';
import { Department } from '../types';
import { searchEntities } from '../services/wikidataClient';

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

// Search for departments on Wikidata
departmentsRouter.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ results: [] });
      return;
    }
    const results = await searchEntities(q);
    // Filter to likely departments (basic filtering)
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// Add a department (local only, can search/select from Wikidata)
departmentsRouter.post('/', requireAuth, (req, res) => {
  const { countryQid, qid, label, wikipediaTitle, inception, dissolved } = req.body ?? {};
  const country = typeof countryQid === 'string' && QID_RE.test(countryQid) ? countryQid : UNITED_STATES_QID;
  if (typeof label !== 'string' || !label.trim()) {
    res.status(400).json({ error: 'label is required' });
    return;
  }

  const deptQid = typeof qid === 'string' && QID_RE.test(qid) ? qid : `local-dept-${Math.random().toString(36).slice(2, 8)}`;

  const dept: Department = {
    qid: deptQid,
    label: label.trim(),
    wikipediaTitle: typeof wikipediaTitle === 'string' ? wikipediaTitle.trim() || null : null,
    inception: typeof inception === 'string' ? inception.trim() || null : null,
    dissolved: typeof dissolved === 'string' ? dissolved.trim() || null : null,
    heads: [],
    offices: [],
    vacant: [],
  };

  addExtraDepartment(country, dept);
  res.status(201).json({ department: dept, countryQid: country });
});

// Edit/update a department
departmentsRouter.put('/:qid', requireAuth, (req, res) => {
  const qid = req.params.qid;
  if (!QID_RE.test(qid) && !qid.startsWith('local-')) {
    res.status(400).json({ error: 'Invalid department QID' });
    return;
  }
  const { label, wikipediaTitle, inception, dissolved } = req.body ?? {};
  const patch: any = {};
  if (typeof label === 'string') patch.label = label.trim();
  if (wikipediaTitle !== undefined) patch.wikipediaTitle = typeof wikipediaTitle === 'string' ? (wikipediaTitle.trim() || null) : null;
  if (inception !== undefined) patch.inception = typeof inception === 'string' ? (inception.trim() || null) : null;
  if (dissolved !== undefined) patch.dissolved = typeof dissolved === 'string' ? (dissolved.trim() || null) : null;

  setDepartmentOverride(qid, patch);
  res.json({ ok: true, qid, patch });
});
