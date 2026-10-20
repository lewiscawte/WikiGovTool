import { POSITION_SEEDS } from '../data/positions';
import { PositionSeed } from '../types';

// In-memory only: modifications made via PUT /api/positions/:id/link reset on restart.
// Wikidata/Wikipedia remain the source of truth for everything else (reads go live).
const positions = new Map<string, PositionSeed>(POSITION_SEEDS.map((p) => [p.id, { ...p }]));

export function listPositions(): PositionSeed[] {
  return [...positions.values()];
}

export function getPosition(id: string): PositionSeed | undefined {
  return positions.get(id);
}

// User-created office stub — no Wikidata item yet (wikidataQid is null until someone links
// or creates one). In-memory only, like everything else here.
export function addPosition(seed: PositionSeed): void {
  positions.set(seed.id, seed);
}

export function updatePositionLink(
  id: string,
  patch: { wikidataQid?: string; wikipediaTitle?: string },
): PositionSeed | undefined {
  const position = positions.get(id);
  if (!position) return undefined;
  if (patch.wikidataQid !== undefined) position.wikidataQid = patch.wikidataQid;
  if (patch.wikipediaTitle !== undefined) position.wikipediaTitle = patch.wikipediaTitle;
  return position;
}