import { Router } from 'express';
import { fetchWikitext } from '../services/wikipediaClient';
import { cleanWikitextValue, extractTemplate, parseTemplateFields } from '../services/infoboxParser';

export const wikipediaRouter = Router();

async function pullInfobox(title: string, namePattern: RegExp): Promise<{ fields: Record<string, string> } | { error: string }> {
  const wikitext = await fetchWikitext(title);
  if (!wikitext) return { error: `No Wikipedia page found for "${title}"` };
  const block = extractTemplate(wikitext, namePattern);
  if (!block) return { error: `No matching infobox template found on "${title}"` };
  const raw = parseTemplateFields(block);
  const fields = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, cleanWikitextValue(v)]));
  return { fields };
}

// "Pull from Wikipedia" (officeholder): fetches a person's page and extracts its
// Infobox officeholder fields (name, party, term_start, term_end, ...).
wikipediaRouter.get('/infobox', async (req, res, next) => {
  try {
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'title query param is required' });
      return;
    }
    const result = await pullInfobox(title, /Infobox\s+officeholder/i);
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
