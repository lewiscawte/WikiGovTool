import { Router } from 'express';
import { fetchPeople, PersonCandidate, searchEntities } from '../services/wikidataClient';
import { searchArticles } from '../services/wikipediaClient';
import { addLocalOfficeholder } from '../store/officeholderStore';
import { requireAuth } from '../middleware/requireAuth';

const QID_RE = /^Q[1-9]\d*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_ID_RE = /^[a-z0-9-]{1,80}$/;

export const officeholdersRouter = Router();

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

// Not born yet, or already dead, on `date`. People with no recorded dates are given the
// benefit of the doubt.
function aliveOn(person: PersonCandidate, date: Date): boolean {
  const t = date.getTime();
  return !(time(person.birth) > t) && !(time(person.death) < t);
}

// GET /api/officeholders/search?q=…&date=YYYY-MM-DD&position=Q123
// Searches Wikidata items and Wikipedia articles together, keeps only people (P31 Q5) alive
// on `date`, and lists anyone Wikidata already records in `position` first.
officeholdersRouter.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ results: [], hidden: { notPerson: 0, notAlive: 0 } });
      return;
    }
    const dateParam = typeof req.query.date === 'string' && ISO_DATE_RE.test(req.query.date) ? req.query.date : null;
    const date = dateParam ? new Date(dateParam) : new Date();
    const positionQid = typeof req.query.position === 'string' && QID_RE.test(req.query.position) ? req.query.position : null;

    const [items, articles] = await Promise.all([
      searchEntities(q, 15),
      searchArticles(q, 10).catch(() => []),
    ]);
    // Wikipedia's ranking is usually the better one for a person's name, so its hits lead.
    const candidateQids = [...new Set([
      ...(QID_RE.test(q) ? [q] : []),
      ...articles.map((a) => a.wikidataQid).filter((x): x is string => !!x),
      ...items.map((i) => i.id),
    ])];
    const people = await fetchPeople(candidateQids, positionQid);
    const alive = people.filter((p) => aliveOn(p, date));
    // Stable sort: held-this-office first, otherwise search order.
    const results = alive.map((p, i) => ({ p, i }))
      .sort((a, b) => Number(b.p.heldPosition) - Number(a.p.heldPosition) || a.i - b.i)
      .map(({ p }) => p);

    res.json({
      results,
      hidden: { notPerson: candidateQids.length - people.length, notAlive: people.length - alive.length },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/officeholders — fill an empty office locally with a person from the search.
// The person is re-checked here rather than trusting what the client sends.
officeholdersRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const { positionKey, personQid, startDate, endDate } = req.body ?? {};
    if (typeof positionKey !== 'string' || !(QID_RE.test(positionKey) || LOCAL_ID_RE.test(positionKey))) {
      res.status(400).json({ error: 'positionKey must be an office QID or local id' });
      return;
    }
    if (typeof personQid !== 'string' || !QID_RE.test(personQid)) {
      res.status(400).json({ error: 'personQid must look like "Q12345"' });
      return;
    }
    for (const d of [startDate, endDate]) {
      if (d != null && d !== '' && !(typeof d === 'string' && ISO_DATE_RE.test(d))) {
        res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
        return;
      }
    }
    if (startDate && endDate && startDate > endDate) {
      res.status(400).json({ error: 'Left office is before took office' });
      return;
    }
    const [person] = await fetchPeople([personQid], null);
    if (!person) {
      res.status(400).json({ error: `${personQid} isn't a person on Wikidata` });
      return;
    }
    addLocalOfficeholder(positionKey, {
      personQid,
      personName: person.name,
      wikipediaTitle: person.wikipediaTitle,
      imageUrl: person.imageUrl,
      startDate: startDate || null,
      endDate: endDate || null,
      birth: person.birth,
      death: person.death,
    });
    res.status(201).json({ person });
  } catch (err) {
    next(err);
  }
});
