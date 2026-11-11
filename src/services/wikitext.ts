// Replaces each [[target]] or [[target|label]] wikilink with its display text, in one
// forward pass. The regexes this replaces backtracked quadratically or worse on runs of
// unclosed "[[", and the text comes from articles anyone can edit.
//
// `labelAfter` picks which pipe the label follows: 'first' is what MediaWiki displays,
// 'last' matches the older matching code. A link whose label would be empty keeps its whole
// inner text, as the regexes did. Text that never closes with "]]" is left as it is.
export function unwrapWikilinks(text: string, labelAfter: 'first' | 'last' = 'first'): string {
  let out = '';
  let pos = 0;
  // The next "]" at or after the current link's contents. Reused across opening brackets
  // that share it, so no stretch of text is searched twice.
  let nextBracket = -1;
  for (;;) {
    const open = text.indexOf('[[', pos);
    if (open === -1) break;
    if (nextBracket < open + 2) {
      nextBracket = text.indexOf(']', open + 2);
      if (nextBracket === -1) break;
    }
    if (nextBracket > open + 2 && text[nextBracket + 1] === ']') {
      const inner = text.slice(open + 2, nextBracket);
      out += text.slice(pos, open) + linkLabel(inner, labelAfter);
      pos = nextBracket + 2;
    } else {
      out += text.slice(pos, open + 1);
      pos = open + 1;
    }
  }
  return out + text.slice(pos);
}

function linkLabel(inner: string, labelAfter: 'first' | 'last'): string {
  if (labelAfter === 'first') {
    const pipe = inner.indexOf('|');
    const label = pipe === -1 ? '' : inner.slice(pipe + 1);
    return label === '' ? inner : label;
  }
  // The last pipe that leaves a non-empty label and isn't the first character.
  const pipe = inner.lastIndexOf('|', inner.length - 2);
  return pipe < 1 ? inner : inner.slice(pipe + 1);
}
