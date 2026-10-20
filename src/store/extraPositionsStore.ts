import { PositionSeed } from '../types';

// In-memory only, per-country: office stubs a user adds under a dynamically-discovered
// country (one with no local seed store of its own). Merged into that country's org chart
// alongside the live SPARQL-discovered positions; reset on server restart.
const extraPositionsByCountry = new Map<string, PositionSeed[]>();

export function addExtraPosition(countryQid: string, seed: PositionSeed): void {
  const list = extraPositionsByCountry.get(countryQid) ?? [];
  list.push(seed);
  extraPositionsByCountry.set(countryQid, list);
}

export function listExtraPositions(countryQid: string): PositionSeed[] {
  return extraPositionsByCountry.get(countryQid) ?? [];
}
