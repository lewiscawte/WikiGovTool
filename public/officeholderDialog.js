// The "Add officeholder" dialog: fills an office Wikidata records no holder for, by searching
// Wikidata and Wikipedia for the person. Importing this module adds the dialog to the page.
import { api, currentDateParam, dateForWikidata, officeholderImageEl, officeTitle } from './shared.js';
import { createItemLine, openCreateItemDialog } from './createItemDialog.js';

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
      <section class="edit-review" id="holderReview" hidden aria-labelledby="holderReviewTitle">
        <h3 class="edit-review-title" id="holderReviewTitle">Review edit to Wikidata</h3>
        <div id="holderReviewBody"></div>
        <div class="edit-review-actions">
          <button type="button" class="btn" id="holderReviewCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="holderReviewPublish">Publish to Wikidata</button>
        </div>
      </section>
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
const QID_RE = /^Q[1-9]\d*$/;
const reviewEl = document.getElementById('holderReview');
const reviewBody = document.getElementById('holderReviewBody');
const publishBtn = document.getElementById('holderReviewPublish');
// The previewed Wikidata edit; Publish sends exactly this.
let pendingEdit = null;

function hideReview() {
  reviewEl.hidden = true;
  reviewBody.innerHTML = '';
  pendingEdit = null;
}

// After any search: the person may not be on Wikidata at all.
const createLine = createItemLine("Can't find them? Create a new Wikidata item for this person", () => {
  const q = searchInput.value.trim();
  const position = currentEntry.position;
  openCreateItemDialog('person', {
    label: QID_RE.test(q) ? '' : q,
    office: position.wikidataQid ? { qid: position.wikidataQid, title: officeTitle(position.title) } : null,
    start: startInput.value.trim(),
    end: endInput.value.trim(),
    onDone: personCreated,
  });
});
createLine.hidden = true;
resultsEl.after(createLine);

async function personCreated({ qid, label, created, officeholder }) {
  if (!created) {
    // An existing item the preview turned up: the search finds it like any other.
    searchInput.value = qid;
    runSearch(qid);
    return;
  }
  if (officeholder && 'revisions' in officeholder) {
    // Created holding this office, on both items: nothing left to add locally.
    close();
    await onSaveCallback();
    return;
  }
  // Wikidata's query service, which the search uses, won't have the new item for a few
  // minutes, so list it straight away.
  resultsEl.innerHTML = '';
  resultsEl.appendChild(resultRow({
    qid, name: label, description: 'Just created on Wikidata', birth: null, death: null,
    wikipediaTitle: null, imageUrl: null, heldPosition: false,
  }));
  select(qid);
  setStatus(searchStatus, officeholder?.error
    ? `Created ${qid}, but couldn't record the office on Wikidata: ${officeholder.error}. You can add them locally below.`
    : `Created ${qid} on Wikidata.`, Boolean(officeholder?.error));
}

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
  if (hidden.notAlive) parts.push(`${hidden.notAlive} not alive on ${searchDate()}`);
  return parts.length ? `Hidden: ${parts.join(', ')}.` : '';
}

function select(qid) {
  if (qid !== selectedQid) hideReview();
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
    const params = new URLSearchParams({ q, date: searchDate() });
    if (positionQid) params.set('position', positionQid);
    const { results, hidden } = await api(`/api/officeholders/search?${params}`);
    if (request !== searchRequest) return;
    createLine.hidden = false;
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

// People are searched for as alive on the term's own dates when they're given, so someone
// from a past term who has since died is still found; otherwise on the date being viewed.
function searchDate() {
  for (const input of [startInput, endInput]) {
    const date = dateForWikidata(input.value);
    if (date && ISO_DATE_RE.test(date)) return date;
  }
  return currentDate;
}

// New dates can change who counts as alive, so search again.
[startInput, endInput].forEach((input) => input.addEventListener('change', () => {
  const q = searchInput.value.trim();
  if (q) runSearch(q);
}));

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

// `start`, if given, prefills the took office date.
export function openAddOfficeholderDialog(entry, { onSave, start = '' } = {}) {
  currentEntry = entry;
  currentDate = currentDateParam();
  onSaveCallback = onSave || (() => {});
  const office = officeTitle(entry.position.title);
  titleEl.textContent = `Add officeholder: ${office}`;
  const onWikidata = Boolean(entry.position.wikidataQid);
  const situation = !entry.officeholder?.personName
    ? `Wikidata records no holder of this office on ${currentDate}.`
    : onWikidata
      ? 'They\'re added alongside the current holder; if that term is over, give it an end date in the office dialog.'
      : 'A locally added officeholder shows on dates Wikidata records no holder for, so end the current holder\'s term first.';
  introEl.textContent = `${situation} Find the person on Wikipedia `
    + 'or Wikidata. Only people (Wikidata "instance of: human") alive on that date, or on the term\'s dates once '
    + 'entered, are listed, and anyone Wikidata already records in this office comes first. The term can be any '
    + 'dates, past ones included. '
    + (onWikidata
      ? 'It\'s saved to Wikidata, after a preview: position held on the person and officeholder on the office.'
      : 'This office has no Wikidata item, so it\'s saved locally; nothing is written to Wikidata.');
  saveBtn.textContent = onWikidata ? 'Preview Wikidata edit' : 'Add officeholder';
  hideReview();
  searchInput.value = '';
  resultsEl.innerHTML = '';
  createLine.hidden = true;
  startInput.value = start;
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

// After a save: close, or say why the page won't show them on the date being viewed.
async function saved(startDate, endDate) {
  // A term that doesn't cover the date being viewed (a past one, say) is saved all the same;
  // it shows on the dates it does cover. Say so, since the page won't show it now.
  const covers = !(startDate && startDate > currentDate) && !(endDate && endDate < currentDate.slice(0, endDate.length));
  if (covers) close();
  else setStatus(statusEl, `Added for ${startDate || 'an unknown start'} – ${endDate || 'present'}. That doesn't include ${currentDate}, `
    + 'the date you\'re viewing, so it shows on the page only for dates in that range.');
  await onSaveCallback();
}

function renderReview({ plan, username, tags }, request) {
  reviewBody.innerHTML = '';
  const intro = document.createElement('p');
  intro.textContent = `As ${username}:`;
  reviewBody.appendChild(intro);
  const sides = [[plan.person, 'position held (P39)'], [plan.office, 'officeholder (P1308)']];
  for (const [side, statement] of sides) {
    const heading = document.createElement('p');
    const link = document.createElement('a');
    link.href = `https://www.wikidata.org/wiki/${side.entityQid}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = `${side.entityLabel} (${side.entityQid})`;
    heading.append('On ', link, ':');
    const list = document.createElement('ul');
    list.className = 'edit-review-changes';
    const line = (text) => list.appendChild(Object.assign(document.createElement('li'), { textContent: text }));
    if (side.needsChoice) {
      line(`Wikidata has several ${statement} statements that could be this term. Save it from the office dialog, which lets you pick one.`);
    } else {
      if (!side.statementId) line(`Add a new ${statement} statement`);
      side.changes.forEach((c) => line(`${c.from ? 'Change' : 'Add'} ${c.label} (${c.property}): ${c.from ? `${c.from} → ` : ''}${c.to}${c.copiedFrom ? ` (copied from ${c.copiedFrom})` : ''}`));
      if (side.statementId && side.changes.length === 0) line('Already has this term. Nothing to change.');
    }
    reviewBody.append(heading, list);
  }
  const blocked = plan.person.needsChoice || plan.office.needsChoice;
  const hasWork = (side) => !side.statementId || side.changes.length > 0;
  const nothing = !hasWork(plan.person) && !hasWork(plan.office);
  const note = document.createElement('p');
  note.className = 'edit-review-note';
  note.textContent = tags ? `Tagged: ${tags}.` : 'No edit tag is configured.';
  reviewBody.appendChild(note);
  pendingEdit = blocked || nothing ? null : {
    ...request,
    statementId: plan.person.statementId,
    officeStatementId: plan.office.statementId,
    baseRevId: plan.person.baseRevId,
    officeBaseRevId: plan.office.baseRevId,
  };
  publishBtn.hidden = !pendingEdit;
  publishBtn.disabled = false;
  reviewEl.hidden = false;
}

async function previewWikidataEdit() {
  const read = (input, label) => {
    const value = dateForWikidata(input.value);
    if (value === null) throw new Error(`Can't read "${input.value}" as the ${label} date. Use YYYY-MM-DD, YYYY-MM or YYYY.`);
    return value;
  };
  let request;
  try {
    request = {
      personQid: selectedQid,
      positionQid: currentEntry.position.wikidataQid,
      start: read(startInput, 'took office'),
      end: read(endInput, 'left office'),
      newTerm: true,
    };
  } catch (err) {
    setStatus(statusEl, err.message, true);
    return;
  }
  setStatus(statusEl, 'Checking Wikidata…');
  try {
    const preview = await api('/api/wikidata/term/preview', { method: 'POST', body: JSON.stringify(request) });
    if (selectedQid !== request.personQid) return;
    setStatus(statusEl, '');
    renderReview(preview, request);
  } catch (err) {
    setStatus(statusEl, err.status === 401 ? 'Log in with Wikimedia first.' : err.message, true);
  }
}

publishBtn.addEventListener('click', async () => {
  if (!pendingEdit) return;
  const edit = pendingEdit;
  publishBtn.disabled = true;
  setStatus(statusEl, 'Publishing to Wikidata…');
  try {
    await api('/api/wikidata/term/save', { method: 'POST', body: JSON.stringify(edit) });
    hideReview();
    setStatus(statusEl, '');
    await saved(edit.start, edit.end);
  } catch (err) {
    publishBtn.disabled = false;
    const partial = err.body?.revisions?.length ? ` ${err.body.revisions.length} edit(s) went through before this; check the items' history.` : '';
    setStatus(statusEl, (err.status === 401 ? 'Log in with Wikimedia first.' : err.message) + partial, true);
  }
});

document.getElementById('holderReviewCancel').addEventListener('click', hideReview);
[startInput, endInput].forEach((input) => input.addEventListener('input', hideReview));

saveBtn.addEventListener('click', async () => {
  if (!currentEntry || !selectedQid) return;
  // An office on Wikidata gets the term there, on both items, after a preview.
  if (currentEntry.position.wikidataQid) {
    await previewWikidataEdit();
    return;
  }
  // Read like every other date ("7 February 2023" too), but a local fill needs the full day.
  const startDate = dateForWikidata(startInput.value) ?? startInput.value.trim();
  const endDate = dateForWikidata(endInput.value) ?? endInput.value.trim();
  if ((startDate && !ISO_DATE_RE.test(startDate)) || (endDate && !ISO_DATE_RE.test(endDate))) {
    setStatus(statusEl, 'Dates must be a full day, e.g. 2023-02-07 or 7 February 2023.', true);
    return;
  }
  if (startDate && endDate && startDate > endDate) {
    setStatus(statusEl, 'Left office is before took office.', true);
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
    await saved(startDate, endDate);
  } catch (err) {
    setStatus(statusEl, err.status === 401 ? 'Log in with Wikimedia first.' : `Couldn't add the officeholder: ${err.message}`, true);
  }
});
