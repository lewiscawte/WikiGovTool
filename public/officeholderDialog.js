// The "Add officeholder" dialog: fills an office Wikidata records no holder for, by searching
// Wikidata and Wikipedia for the person. Importing this module adds the dialog to the page.
import { api, currentDateParam, officeholderImageEl, officeTitle } from './shared.js';

document.body.insertAdjacentHTML('beforeend', `
  <div class="dialog-backdrop" id="holderDialogBackdrop">
    <div class="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="holderDialogTitle">
      <h2 class="dialog-title" id="holderDialogTitle">Add officeholder</h2>
      <p class="dialog-intro" id="holderDialogIntro"></p>
      <div class="field">
        <label for="holderSearch">Search Wikipedia and Wikidata</label>
        <input class="input" id="holderSearch" placeholder="Name, Wikipedia article or Q-number" autocomplete="off">
      </div>
      <p class="status-line" id="holderSearchStatus"></p>
      <ul class="holder-results" id="holderResults" role="listbox" aria-label="People found"></ul>
      <div class="grid-2">
        <div class="field">
          <label for="holderStart">Took office (optional)</label>
          <input class="input" id="holderStart" placeholder="YYYY-MM-DD">
        </div>
        <div class="field">
          <label for="holderEnd">Left office (optional)</label>
          <input class="input" id="holderEnd" placeholder="YYYY-MM-DD">
        </div>
      </div>
      <p class="status-line" id="holderDialogStatus"></p>
      <div class="dialog-actions">
        <button type="button" class="btn" id="holderDialogCancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="holderDialogSave" disabled>Add officeholder</button>
      </div>
    </div>
  </div>
`);

const backdrop = document.getElementById('holderDialogBackdrop');
const titleEl = document.getElementById('holderDialogTitle');
const introEl = document.getElementById('holderDialogIntro');
const searchInput = document.getElementById('holderSearch');
const searchStatus = document.getElementById('holderSearchStatus');
const resultsEl = document.getElementById('holderResults');
const startInput = document.getElementById('holderStart');
const endInput = document.getElementById('holderEnd');
const statusEl = document.getElementById('holderDialogStatus');
const saveBtn = document.getElementById('holderDialogSave');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const year = (iso) => (iso ? iso.slice(0, 4).replace(/^-?0+/, '') : null);

let currentEntry = null;
let currentDate = null;
let selectedQid = null;
let searchTimeout = null;
let searchRequest = 0;
let onSaveCallback = () => {};

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.className = isError ? 'status-line error' : 'status-line';
}

function lifeYears(person) {
  const born = year(person.birth);
  const died = year(person.death);
  if (born && died) return `${born}–${died}`;
  if (born) return `born ${born}`;
  if (died) return `died ${died}`;
  return '';
}

function hiddenNote(hidden) {
  const parts = [];
  if (hidden.notPerson) parts.push(`${hidden.notPerson} not a person on Wikidata`);
  if (hidden.notAlive) parts.push(`${hidden.notAlive} not alive on ${currentDate}`);
  return parts.length ? `Hidden: ${parts.join(', ')}.` : '';
}

function select(qid) {
  selectedQid = qid;
  saveBtn.disabled = !qid;
  resultsEl.querySelectorAll('.holder-result').forEach((row) => {
    const on = row.dataset.qid === qid;
    row.classList.toggle('selected', on);
    row.setAttribute('aria-selected', String(on));
  });
}

function resultRow(person) {
  const row = document.createElement('li');
  row.className = 'holder-result';
  row.dataset.qid = person.qid;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', 'false');
  row.tabIndex = 0;

  const text = document.createElement('div');
  const name = document.createElement('p');
  name.className = 'holder-result-name';
  name.textContent = person.name;
  const years = lifeYears(person);
  if (years) {
    const y = document.createElement('span');
    y.className = 'holder-result-years';
    y.textContent = years;
    name.appendChild(y);
  }
  text.appendChild(name);
  if (person.description) {
    const desc = document.createElement('p');
    desc.className = 'holder-result-desc';
    desc.textContent = person.description;
    text.appendChild(desc);
  }
  const meta = document.createElement('p');
  meta.className = 'holder-result-meta';
  if (person.heldPosition) {
    const held = document.createElement('span');
    held.className = 'holder-result-held';
    held.textContent = 'Held this office (Wikidata)';
    meta.appendChild(held);
  }
  const qid = document.createElement('a');
  qid.href = `https://www.wikidata.org/wiki/${person.qid}`;
  qid.target = '_blank';
  qid.rel = 'noopener';
  qid.textContent = person.qid;
  meta.appendChild(qid);
  if (person.wikipediaTitle) {
    const wp = document.createElement('a');
    wp.className = 'voice-wp';
    wp.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(person.wikipediaTitle.replace(/ /g, '_'))}`;
    wp.target = '_blank';
    wp.rel = 'noopener';
    wp.textContent = person.wikipediaTitle;
    meta.appendChild(wp);
  }
  meta.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  text.appendChild(meta);

  row.append(officeholderImageEl({ imageUrl: person.imageUrl, personName: person.name }, 96, 'portrait portrait-sm'), text);
  row.addEventListener('click', () => select(person.qid));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(person.qid);
    }
  });
  return row;
}

async function runSearch(q) {
  const request = ++searchRequest;
  setStatus(searchStatus, 'Searching…');
  const positionQid = currentEntry.position.wikidataQid;
  try {
    const params = new URLSearchParams({ q, date: currentDate });
    if (positionQid) params.set('position', positionQid);
    const { results, hidden } = await api(`/api/officeholders/search?${params}`);
    if (request !== searchRequest) return;
    resultsEl.innerHTML = '';
    results.forEach((p) => resultsEl.appendChild(resultRow(p)));
    const note = hiddenNote(hidden);
    setStatus(searchStatus, results.length
      ? [`${results.length} ${results.length === 1 ? 'person' : 'people'} found.`, note].filter(Boolean).join(' ')
      : `No people found. ${note}`.trim());
    // Keep the selection if it's still listed.
    select(results.some((p) => p.qid === selectedQid) ? selectedQid : null);
  } catch (err) {
    if (request !== searchRequest) return;
    setStatus(searchStatus, `Search failed: ${err.message}`, true);
  }
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  if (!q) {
    searchRequest++;
    resultsEl.innerHTML = '';
    setStatus(searchStatus, '');
    select(null);
    return;
  }
  searchTimeout = setTimeout(() => runSearch(q), 300);
});

export function openAddOfficeholderDialog(entry, { onSave } = {}) {
  currentEntry = entry;
  currentDate = currentDateParam();
  onSaveCallback = onSave || (() => {});
  const office = officeTitle(entry.position.title);
  titleEl.textContent = `Add officeholder: ${office}`;
  introEl.textContent = `Wikidata records no holder of this office on ${currentDate}. Find the person on Wikipedia `
    + 'or Wikidata. Only people (Wikidata "instance of: human") alive on that date are listed, and anyone '
    + 'Wikidata already records in this office comes first. This is saved locally; nothing is written to Wikidata.';
  searchInput.value = '';
  resultsEl.innerHTML = '';
  startInput.value = '';
  endInput.value = '';
  setStatus(searchStatus, '');
  setStatus(statusEl, '');
  select(null);
  backdrop.classList.add('open');
  searchInput.focus();
}

function close() {
  backdrop.classList.remove('open');
  clearTimeout(searchTimeout);
  searchRequest++;
  currentEntry = null;
}

document.getElementById('holderDialogCancel').addEventListener('click', close);
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
});

saveBtn.addEventListener('click', async () => {
  if (!currentEntry || !selectedQid) return;
  const startDate = startInput.value.trim();
  const endDate = endInput.value.trim();
  if ((startDate && !ISO_DATE_RE.test(startDate)) || (endDate && !ISO_DATE_RE.test(endDate))) {
    setStatus(statusEl, 'Dates must be YYYY-MM-DD.', true);
    return;
  }
  // The fill only shows on dates inside its tenure, so it must cover the date being viewed.
  if ((startDate && startDate > currentDate) || (endDate && endDate < currentDate)) {
    setStatus(statusEl, `The dates must include ${currentDate}, the date you're viewing.`, true);
    return;
  }
  try {
    await api('/api/officeholders', {
      method: 'POST',
      body: JSON.stringify({
        positionKey: currentEntry.position.wikidataQid || currentEntry.position.id,
        personQid: selectedQid,
        startDate: startDate || null,
        endDate: endDate || null,
      }),
    });
    close();
    await onSaveCallback();
  } catch (err) {
    setStatus(statusEl, err.status === 401 ? 'Log in with Wikimedia first.' : `Couldn't add the officeholder: ${err.message}`, true);
  }
});
