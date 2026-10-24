// In-memory only, like the other stores: officeholders a user has picked for an office that
// Wikidata records no holder for. Keyed by the office's Wikidata QID, or its local id for an
// office with no Wikidata item. Reset on restart; nothing is written to Wikidata.

export interface LocalOfficeholder {
  personQid: string;
  personName: string;
  wikipediaTitle: string | null;
  imageUrl: string | null;
  // The tenure the user gave, if any. The person's own birth/death bound it too, so an
  // open-ended fill never shows on a date the person wasn't alive.
  startDate: string | null;
  endDate: string | null;
  birth: string | null;
  death: string | null;
}

const officeholdersByPosition = new Map<string, LocalOfficeholder[]>();

export function addLocalOfficeholder(positionKey: string, holder: LocalOfficeholder): void {
  const list = (officeholdersByPosition.get(positionKey) ?? []).filter((h) => h.personQid !== holder.personQid);
  list.push(holder);
  officeholdersByPosition.set(positionKey, list);
}

// The most recently added fill whose window covers `date`.
export function localOfficeholderOn(positionKey: string, date: Date): LocalOfficeholder | null {
  const list = officeholdersByPosition.get(positionKey) ?? [];
  const t = date.getTime();
  const after = (iso: string | null) => !iso || new Date(iso).getTime() <= t;
  const before = (iso: string | null) => !iso || new Date(iso).getTime() >= t;
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    if (after(h.startDate) && before(h.endDate) && after(h.birth) && before(h.death)) return h;
  }
  return null;
}
