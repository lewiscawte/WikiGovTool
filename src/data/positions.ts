import { PositionSeed } from '../types';

// Wikidata QIDs are resolved lazily from the Wikipedia title (see
// services/wikidataClient.ts#resolveQidFromWikipediaTitle) rather than hardcoded here,
// so this seed can't drift from whatever Wikidata/Wikipedia currently link to.
export const POSITION_SEEDS: PositionSeed[] = [
  { id: 'president', title: 'President of the United States', department: 'Executive Office', wikipediaTitle: 'President of the United States', wikidataQid: null },
  { id: 'vp', title: 'Vice President of the United States', department: 'Executive Office', wikipediaTitle: 'Vice President of the United States', wikidataQid: null },
  { id: 'state', title: 'Secretary of State', department: 'State', wikipediaTitle: 'United States Secretary of State', wikidataQid: null },
  { id: 'treasury', title: 'Secretary of the Treasury', department: 'Treasury', wikipediaTitle: 'United States Secretary of the Treasury', wikidataQid: null },
  { id: 'defense', title: 'Secretary of Defense', department: 'Defense', wikipediaTitle: 'United States Secretary of Defense', wikidataQid: null },
  { id: 'justice', title: 'Attorney General', department: 'Justice', wikipediaTitle: 'United States Attorney General', wikidataQid: null },
  { id: 'interior', title: 'Secretary of the Interior', department: 'Interior', wikipediaTitle: 'United States Secretary of the Interior', wikidataQid: null },
  { id: 'agriculture', title: 'Secretary of Agriculture', department: 'Agriculture', wikipediaTitle: 'United States Secretary of Agriculture', wikidataQid: null },
  { id: 'commerce', title: 'Secretary of Commerce', department: 'Commerce', wikipediaTitle: 'United States Secretary of Commerce', wikidataQid: null },
  { id: 'labor', title: 'Secretary of Labor', department: 'Labor', wikipediaTitle: 'United States Secretary of Labor', wikidataQid: null },
  { id: 'hhs', title: 'Secretary of Health and Human Services', department: 'Health & Human Services', wikipediaTitle: 'United States Secretary of Health and Human Services', wikidataQid: null },
  { id: 'hud', title: 'Secretary of Housing and Urban Development', department: 'Housing & Urban Development', wikipediaTitle: 'United States Secretary of Housing and Urban Development', wikidataQid: null },
  { id: 'transportation', title: 'Secretary of Transportation', department: 'Transportation', wikipediaTitle: 'United States Secretary of Transportation', wikidataQid: null },
  { id: 'energy', title: 'Secretary of Energy', department: 'Energy', wikipediaTitle: 'United States Secretary of Energy', wikidataQid: null },
  { id: 'education', title: 'Secretary of Education', department: 'Education', wikipediaTitle: 'United States Secretary of Education', wikidataQid: null },
  { id: 'veterans', title: 'Secretary of Veterans Affairs', department: 'Veterans Affairs', wikipediaTitle: 'United States Secretary of Veterans Affairs', wikidataQid: null },
  { id: 'homeland', title: 'Secretary of Homeland Security', department: 'Homeland Security', wikipediaTitle: 'United States Secretary of Homeland Security', wikidataQid: null },
];