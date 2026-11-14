// Dates as typed or copied into the dialogs. No DOM here, so the tests can load it too.

export const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08',
  sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

// What the dialogs show in an empty date field rather than leaving it blank.
const DATE_PLACEHOLDERS = new Set(['unknown', 'still exists', 'incumbent']);

// A date typed or copied into any dialog, as Wikidata takes it: "YYYY", "YYYY-MM" or
// "YYYY-MM-DD" at the precision the text actually gives (so "March 1950" never becomes
// 1950-03-01). Reads "19 January 1950", "January 19, 1950", "January 1950", wikilinks and
// {{start date|1950|1|19}}. '' for blank or a placeholder; null if unreadable.
export function dateForWikidata(text) {
  const cleaned = (text || '').replace(/<[^>]+>/g, '').replace(/\[\[[^\]]+\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
  if (!cleaned || DATE_PLACEHOLDERS.has(cleaned.toLowerCase())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  let m = cleaned.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
  if (m) return [m[1], m[2] && pad(m[2]), m[3] && pad(m[3])].filter(Boolean).join('-');
  m = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${pad(m[1])}`;
  m = cleaned.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${pad(m[2])}`;
  m = cleaned.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${MONTHS[m[1].toLowerCase()]}`;
  // Infobox templates such as {{start date|1950|1|19}}: only trust a full year|month|day.
  m = cleaned.match(/\{\{[^{}|]+\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})\s*[|}]/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  return null;
}
