export interface PositionSeed {
  id: string;
  title: string;
  department: string;
  wikipediaTitle: string;
  wikidataQid: string | null;
}

export type PositionBucket = 'Head of State' | 'Head of Government' | 'Minister';

export interface OrgChartPosition {
  id: string;
  title: string;
  // Display portfolio name (e.g. "Scotland", "HM Treasury") — from Wikidata P2389 where
  // available, else a best-effort guess from the title, else the bucket name.
  department: string;
  // Structural classification, independent of the display department name above — this is
  // what hero-vs-grid placement keys off, so renaming a department can't break it.
  bucket: PositionBucket;
  wikipediaTitle: string | null;
  wikidataQid: string | null;
  // false for the hardcoded US seed list (locally re-linkable via PUT /positions/:id/link);
  // true for positions discovered live per-country, which have no local store entry to edit.
  dynamic: boolean;
  // Wikidata P571 (inception) / P576 (dissolution) on the office itself — null when unknown.
  // Already used internally to decide whether the office is shown at all for a given date
  // (see existedOn in orgchart.ts); exposed here too so the edit dialog can display them.
  inception: string | null;
  dissolved: string | null;
}

export interface OfficeholderTerm {
  personName: string;
  personWikidataQid: string;
  partyLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  // 1 for a first/only known term in this position; 2+ when the same person previously held
  // it non-consecutively (e.g. a second, non-sequential term), counted from actual history.
  termOrdinal: number;
  // Wikidata P18 ("image") as a Commons Special:FilePath URL — append `?width=<n>` for a
  // sized thumbnail. Null when the person has no P18 claim.
  imageUrl: string | null;
}

export interface OrgChartEntry {
  position: OrgChartPosition;
  officeholder: OfficeholderTerm | null;
  // Junior/deputy roles (Wikidata P2098) nested under this office rather than listed as
  // their own top-level entries — e.g. Vice President under President. Always empty on an
  // entry that is itself someone else's deputy (those never appear at the top level).
  deputies: OrgChartEntry[];
}
