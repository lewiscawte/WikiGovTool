import { Router } from 'express';
import { addPosition, getPosition, listPositions, updatePositionLink } from '../store/positionStore';
import { addExtraPosition } from '../store/extraPositionsStore';
import { getPositionHistory, UNITED_STATES_QID } from '../services/orgchart';
import { requireAuth } from '../middleware/requireAuth';
import { PositionSeed } from '../types';

const QID_RE = /^Q[1-9]\d*$/;

export const positionsRouter = Router();

positionsRouter.get('/', (_req, res) => {
  res.json({ positions: listPositions() });
});

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'office';
}

// Creates a local-only office stub — for a position that exists in the real government but
// has no Wikidata item yet (or none we've found). wikidataQid always starts null: the point
// is to flag the gap, not to fabricate a Wikidata link. Does not create anything on Wikidata
// itself (writes remain disabled — see POST /api/wikidata/save).
positionsRouter.post('/', requireAuth, (req, res) => {
  const { countryQid, title, department, wikipediaTitle } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  if (wikipediaTitle !== undefined && typeof wikipediaTitle !== 'string') {
    res.status(400).json({ error: 'wikipediaTitle must be a string' });
    return;
  }
  const country = typeof countryQid === 'string' && QID_RE.test(countryQid) ? countryQid : UNITED_STATES_QID;
  const seed: PositionSeed = {
    id: `local-${slugify(title)}-${Math.random().toString(36).slice(2, 6)}`,
    title: title.trim(),
    department: typeof department === 'string' && department.trim() ? department.trim() : 'Minister',
    wikipediaTitle: typeof wikipediaTitle === 'string' ? wikipediaTitle.trim() : '',
    wikidataQid: null,
  };

  if (country === UNITED_STATES_QID) {
    addPosition(seed);
  } else {
    addExtraPosition(country, seed);
  }
  res.status(201).json({ position: seed, countryQid: country });
});

positionsRouter.get('/:id', (req, res) => {
  const position = getPosition(req.params.id);
  if (!position) {
    res.status(404).json({ error: 'Position not found' });
    return;
  }
  res.json({ position });
});

positionsRouter.get('/:id/history', async (req, res, next) => {
  try {
    const position = getPosition(req.params.id);
    if (!position) {
      res.status(404).json({ error: 'Position not found' });
      return;
    }
    const history = await getPositionHistory(position);
    res.json({ position, history });
  } catch (err) {
    next(err);
  }
});

// Local-only: repoints this position at a different Wikidata QID / Wikipedia title.
// Does not write to Wikidata itself (see POST /api/wikidata/save).
positionsRouter.put('/:id/link', requireAuth, (req, res) => {
  const position = getPosition(req.params.id);
  if (!position) {
    res.status(404).json({ error: 'Position not found' });
    return;
  }
  const { wikidataQid, wikipediaTitle } = req.body ?? {};
  if (wikidataQid !== undefined && !QID_RE.test(wikidataQid)) {
    res.status(400).json({ error: 'wikidataQid must look like "Q12345"' });
    return;
  }
  if (wikipediaTitle !== undefined && typeof wikipediaTitle !== 'string') {
    res.status(400).json({ error: 'wikipediaTitle must be a string' });
    return;
  }
  const updated = updatePositionLink(req.params.id, { wikidataQid, wikipediaTitle });
  res.json({ position: updated });
});
