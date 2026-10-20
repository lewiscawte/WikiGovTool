import { Router } from 'express';
import { generateOfficeholderInfobox } from '../services/infoboxGenerator';

export const infoboxRouter = Router();

// Generates the wikitext shown in the editor dialog's "Generated infobox wikitext" pane.
infoboxRouter.post('/generate', (req, res) => {
  const { name, office, department, party, termStart, termEnd, predecessor, successor } = req.body ?? {};
  if (!name || !office) {
    res.status(400).json({ error: 'name and office are required' });
    return;
  }
  const wikitext = generateOfficeholderInfobox({
    name,
    office,
    department,
    party,
    termStart,
    termEnd,
    predecessor,
    successor,
  });
  res.json({ wikitext });
});
