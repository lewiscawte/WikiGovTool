// Extracts a top-level {{...}} template whose name matches namePattern, tracking brace
// depth so nested templates inside field values don't prematurely close the match.
export function extractTemplate(wikitext: string, namePattern: RegExp): string | null {
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
      if (depth === 0) return wikitext.slice(start, i + 1);
    }
  }
  return null;
}

// Splits a template block into its `| key = value` fields, respecting nested {{ }} and [[ ]]
// so values containing wikilinks or other templates aren't split on their internal pipes.
export function parseTemplateFields(templateBlock: string): Record<string, string> {
  const inner = templateBlock.trim().replace(/^\{\{/, '').replace(/\}\}$/, '');
  const firstPipe = inner.indexOf('|');
  if (firstPipe === -1) return {};
  const body = inner.slice(firstPipe + 1);

  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      buf += two;
      i++;
      continue;
    }
    if (two === '}}' || two === ']]') {
      depth--;
      buf += two;
      i++;
      continue;
    }
    if (body[i] === '|' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += body[i];
  }
  parts.push(buf);

  const fields: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

export function cleanWikitextValue(value: string): string {
  return value
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/\{\{efn[^{}]*\}\}/gi, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}