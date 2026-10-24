const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

function extractTemplateContent(wikitext: string, namePattern: RegExp): string | null {
  const startMatch = wikitext.match(new RegExp(`\\{\\{\\s*(${namePattern.source})`, 'i'));
  if (!startMatch || startMatch.index === undefined) return null;

  const start = startMatch.index;
  let depth = 0;
  for (let i = start; i < wikitext.length - 1; i++) {
    const two = wikitext.slice(i, i + 2);
    if (two === '{{') {
      depth++;
      i++;
    } else if (two === '}}') {
      depth--;
      i++;
      if (depth === 0) return wikitext.slice(start + 2, i); // content inside
    }
  }
  return null;
}

function parseDateFromTemplate(wikitext: string): string | null {
  // Try common date templates
  const content = extractTemplateContent(wikitext, /(?:start\s*date|end\s*date|date|birth\s*date|death\s*date|df\s*|dmy\s*|mdy\s*)/i);
  if (!content) return null;

  const parts = content.split('|').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  // Template like {{start date|1995|7|5}} or {{Start date and age|1995|07|05|df=yes}}
  if (parts.length >= 3 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{1,2}$/.test(parts[2])) {
    const year = parts[0];
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Template like {{start date|df=yes|5 July 1995}}
  for (const part of parts) {
    const parsed = parseDateString(part);
    if (parsed) return parsed;
  }

  return null;
}

function parseDateString(s: string): string | null {
  const cleaned = s.replace(/<[^>]+>/g, '').replace(/\[\[[^\]]+\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
  
  // Already ISO format YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  // Format like "5 July 1995" or "July 5, 1995"
  const dayMonthYear = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dayMonthYear) {
    const day = dayMonthYear[1].padStart(2, '0');
    const monthName = dayMonthYear[2].toLowerCase();
    const year = dayMonthYear[3];
    const month = MONTHS[monthName];
    if (month) return `${year}-${month}-${day}`;
  }

  const monthDayYear = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthDayYear) {
    const monthName = monthDayYear[1].toLowerCase();
    const day = monthDayYear[2].padStart(2, '0');
    const year = monthDayYear[3];
    const month = MONTHS[monthName];
    if (month) return `${year}-${month}-${day}`;
  }

  // Just month and year
  const monthYear = cleaned.match(/([A-Za-z]+)\s+(\d{4})/);
  if (monthYear) {
    const monthName = monthYear[1].toLowerCase();
    const year = monthYear[2];
    const month = MONTHS[monthName];
    if (month) return `${year}-${month}-01`;
  }

  // Just year
  const yearOnly = cleaned.match(/^(\d{4})$/);
  if (yearOnly) {
    return `${yearOnly[1]}-01-01`;
  }

  return null;
}

export function normalizeDate(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  
  // Check if it's a template
  if (trimmed.includes('{{')) {
    const fromTemplate = parseDateFromTemplate(trimmed);
    if (fromTemplate) return fromTemplate;
  }
  
  const parsed = parseDateString(trimmed);
  if (parsed) return parsed;
  
  return trimmed;
}

export function datesMatch(date1: string, date2: string): boolean {
  if (!date1 || !date2) return date1 === date2;
  
  const norm1 = normalizeDate(date1);
  const norm2 = normalizeDate(date2);
  
  if (norm1 === norm2) return true;
  
  // Also try direct comparison if both are normalized
  const iso1 = norm1.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const iso2 = norm2.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  
  if (iso1 && iso2) {
    // If day is 01 and they might be month/year only, be more flexible
    if ((iso1[3] === '01' && iso2[3] === '01' && iso1[2] === iso2[2] && iso1[1] === iso2[1])) {
      return true;
    }
  }
  
  // Case insensitive comparison as fallback
  return norm1.toLowerCase() === norm2.toLowerCase();
}
