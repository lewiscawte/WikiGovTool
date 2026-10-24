import { Router } from 'express';
import { fetchWikitext } from '../services/wikipediaClient';
import { cleanWikitextValue, extractTemplate, parseTemplateFields } from '../services/infoboxParser';

export const wikipediaRouter = Router();

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[\[[^\]]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMatchingTerm(block: string, officeTitle: string): Record<string, string> | null {
  if (!officeTitle) return null;
  const target = normalizeForMatch(officeTitle);
  if (!target) return null;

  // Look for office/term blocks with multiple entries
  // Common patterns: office1, term_start1, term_end1 or office = ... followed by term_start/term_end
  const fields = parseTemplateFields(block);
  const rawFields = parseTemplateFields(block); // keep raw for checking
  
  // Check numbered offices
  for (let i = 1; i <= 20; i++) {
    const office = fields[`office${i}`] || fields[`position${i}`] || fields[`office_${i}`];
    if (office) {
      const normOffice = normalizeForMatch(office);
      // Check if they match (office title contains key parts or vice versa)
      if (normOffice.includes(target) || target.includes(normOffice) || 
          target.split(' ').some(w => w.length > 3 && normOffice.includes(w))) {
        const result: Record<string, string> = {};
        if (fields[`term_start${i}`]) result.term_start = fields[`term_start${i}`];
        if (fields[`term_end${i}`]) result.term_end = fields[`term_end${i}`];
        if (fields[`predecessor${i}`]) result.predecessor = fields[`predecessor${i}`];
        if (fields[`successor${i}`]) result.successor = fields[`successor${i}`];
        if (Object.keys(result).length > 0) return result;
      }
    }
  }

  // Check if main office matches
  const mainOffice = fields.office || fields.position;
  if (mainOffice) {
    const normOffice = normalizeForMatch(mainOffice);
    if (normOffice.includes(target) || target.includes(normOffice) ||
        target.split(' ').filter(w => w.length > 3).every(w => normOffice.includes(w)) ||
        normOffice.split(' ').filter(w => w.length > 3).every(w => target.includes(w))) {
      const result: Record<string, string> = {};
      if (fields.term_start) result.term_start = fields.term_start;
      if (fields.term_end) result.term_end = fields.term_end;
      if (fields.predecessor) result.predecessor = fields.predecessor;
      if (fields.successor) result.successor = fields.successor;
      return result;
    }
  }

  return null;
}

async function pullInfobox(title: string, namePattern: RegExp, officeTitle?: string): Promise<{ fields: Record<string, string> } | { error: string }> {
  const wikitext = await fetchWikitext(title);
  if (!wikitext) return { error: `No Wikipedia page found for "${title}"` };
  const block = extractTemplate(wikitext, namePattern);
  if (!block) return { error: `No matching infobox template found on "${title}"` };
  
  // Try to find matching term for specific office if provided
  if (officeTitle && namePattern.test('Infobox officeholder')) {
    const matched = findMatchingTerm(block, officeTitle);
    if (matched && Object.keys(matched).length > 0) {
      const fields = Object.fromEntries(Object.entries(matched).map(([k, v]) => [k, cleanWikitextValue(v)]));
      // Still get other common fields
      const allFields = parseTemplateFields(block);
      if (allFields.name) fields.name = cleanWikitextValue(allFields.name);
      if (allFields.party) fields.party = cleanWikitextValue(allFields.party);
      if (allFields.birth_date) fields.birth_date = cleanWikitextValue(allFields.birth_date);
      return { fields };
    }
  }
  
  const raw = parseTemplateFields(block);
  const fields = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, cleanWikitextValue(v)]));
  return { fields };
}

// "Pull from Wikipedia" (officeholder): fetches a person's page and extracts its
// Infobox officeholder fields (name, party, term_start, term_end, ...).
wikipediaRouter.get('/infobox', async (req, res, next) => {
  try {
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const office = typeof req.query.office === 'string' ? req.query.office.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'title query param is required' });
      return;
    }
    const result = await pullInfobox(title, /Infobox\s+officeholder/i, office);
    if ('error' in result) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ title, fields: result.fields });
  } catch (err) {
    next(err);
  }
});

// "Pull office info": fetches the OFFICE's own Wikipedia page (not the officeholder's) and
// extracts its Infobox official/political post fields (formation, abolished, incumbent,
// appointer, termlength, ...) — these exist independently of Wikidata's P571/P576 and
// frequently disagree with it (e.g. Wikipedia records an "abolished" date for a defunct
// office that Wikidata never got a P576 claim for), which is exactly the kind of
// cross-source inconsistency this tool exists to surface.
wikipediaRouter.get('/office-infobox', async (req, res, next) => {
  try {
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'title query param is required' });
      return;
    }
    const result = await pullInfobox(title, /Infobox\s+(?:official|political)\s+post/i);
    if ('error' in result) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ title, fields: result.fields });
  } catch (err) {
    next(err);
  }
});
