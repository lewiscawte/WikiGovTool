// The office comparison dialog (Wikidata vs Wikipedia) and the add-office dialog, shared by
// both pages. Importing this module adds the dialogs' markup to the page.
import {
  api, dateForWikidata, MONTHS, officeTitle, QID_ONLY_RE, refreshFromWikidata, renderSourceLinks, state,
} from './shared.js';
import { openAddOfficeholderDialog } from './officeholderDialog.js';
import { createItemLine, openCreateItemDialog } from './createItemDialog.js';

document.body.insertAdjacentHTML('beforeend', `
  <div class="dialog-backdrop" id="addOfficeBackdrop">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="addOfficeTitle">
      <h2 class="dialog-title" id="addOfficeTitle">Add office</h2>
      <p class="dialog-intro">
        Adds an office the page doesn't list. Search Wikidata to link its item, or create one;
        without an item it's added locally only.
      </p>
      <div class="field">
        <label for="new-office-search">Search Wikidata</label>
        <input class="input" id="new-office-search" placeholder="e.g. Minister for Widgets" autocomplete="off">
        <ul class="create-item-results" id="new-office-results"></ul>
      </div>
      <p class="status-line" id="new-office-linked"></p>
      <div class="field"><label for="new-office-title">Office title</label><input class="input" id="new-office-title" placeholder="e.g. Minister for Widgets"></div>
      <div class="field"><label for="new-office-dept">Department</label><input class="input" id="new-office-dept" placeholder="e.g. Department for Business and Trade"></div>
      <div class="field"><label for="new-office-wp">Wikipedia article, if there is one</label><input class="input" id="new-office-wp"></div>
      <p class="status-line" id="addOfficeStatus"></p>
      <div class="dialog-actions">
        <button type="button" class="btn" id="addOfficeCancelBtn">Cancel</button>
        <button type="button" class="btn btn-primary" id="addOfficeSubmitBtn">Add office</button>
      </div>
    </div>
  </div>

  <div class="dialog-backdrop" id="backdrop">
    <div class="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
      <h2 class="dialog-title" id="dialogTitle">Office</h2>

      <h3 class="dialog-section"><span>Office</span><span class="source-links" id="officeSourceLinks"></span></h3>
      <div class="field"><label for="f-office">Title on Wikidata</label><input class="input" id="f-office"></div>
      <div class="grid-2">
        <div class="field"><label for="f-qid">Wikidata item</label><input class="input" placeholder="Q…" id="f-qid"></div>
        <div class="field"><label for="f-officewp">Wikipedia article</label><input class="input" id="f-officewp"></div>
      </div>
      <button type="button" class="btn" id="pullOfficeBtn">Compare office with Wikipedia</button>

      <div class="compare">
        <div class="compare-row compare-head"><span></span><span class="voice-wd">Wikidata</span><span class="voice-wp">Wikipedia</span><span></span></div>
        <div class="compare-row">
          <label class="compare-label" for="f-dept">Department</label>
          <input class="input" id="f-dept">
          <span class="compare-wiki" id="wp-dept">—</span>
          <button type="button" class="copy-btn" data-target="dept" disabled title="Use the Wikipedia value" aria-label="Use the Wikipedia department">←</button>
        </div>
        <div class="compare-row">
          <label class="compare-label" for="f-inception">Created</label>
          <input class="input" id="f-inception">
          <span class="compare-wiki" id="wp-inception">—</span>
          <button type="button" class="copy-btn" data-target="inception" disabled title="Use the Wikipedia value" aria-label="Use the Wikipedia creation date">←</button>
        </div>
        <div class="compare-row">
          <label class="compare-label" for="f-dissolved">Abolished</label>
          <input class="input" id="f-dissolved" placeholder="Still exists">
          <span class="compare-wiki" id="wp-dissolved">—</span>
          <button type="button" class="copy-btn" data-target="dissolved" disabled title="Use the Wikipedia value" aria-label="Use the Wikipedia abolition date">←</button>
        </div>
      </div>

      <h3 class="dialog-section"><span>Officeholder</span><span class="source-links" id="holderSourceLinks"></span></h3>
      <div class="field"><label for="f-wp">Wikipedia article</label><input class="input" id="f-wp"></div>
      <button type="button" class="btn" id="pullBtn">Compare officeholder with Wikipedia</button>

      <div class="compare">
        <div class="compare-row compare-head"><span></span><span class="voice-wd">Wikidata</span><span class="voice-wp">Wikipedia</span><span></span></div>
        <div class="compare-row">
          <label class="compare-label" for="f-name">Name</label>
          <input class="input" id="f-name">
          <span class="compare-wiki" id="wp-name">—</span>
          <button type="button" class="copy-btn" data-target="name" disabled title="Use the Wikipedia value" aria-label="Use the Wikipedia name">←</button>
        </div>
        <div class="compare-row">
          <label class="compare-label" for="f-party">Party</label>
          <input class="input" id="f-party">
          <span class="compare-wiki" id="wp-party">—</span>
          <button type="button" class="copy-btn" data-target="party" disabled title="Use the Wikipedia value" aria-label="Use the Wikipedia party">←</button>
        </div>
        <div class="compare-row">
          <label class="compare-label" for="f-start">Took office</label>
          <input class="input" id="f-start">
          <span class="compare-wiki" id="wp-start">—</span>
          <button type="button" class="copy-btn" data-target="start" disabled title="Use the Wikipedia value" aria-label="Use the Wikipedia start date">←</button>
        </div>
        <div class="compare-row">
          <label class="compare-label" for="f-end">Left office</label>
          <input class="input" id="f-end" placeholder="Incumbent">
          <span class="compare-wiki" id="wp-end">—</span>
          <button type="button" class="copy-btn" data-target="end" disabled title="Use the Wikipedia value" aria-label="Use the Wikipedia end date">←</button>
        </div>
      </div>

      <p class="status-line" id="dialogStatus"></p>
      <details class="infobox-details">
        <summary>Infobox wikitext for Wikipedia</summary>
        <pre id="infobox"></pre>
      </details>

      <section class="edit-review" id="editReview" hidden aria-labelledby="editReviewTitle">
        <h3 class="edit-review-title" id="editReviewTitle">Review edit to Wikidata</h3>
        <div id="editReviewBody"></div>
        <div class="edit-review-actions">
          <button type="button" class="btn" id="editReviewCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="editReviewPublish">Publish to Wikidata</button>
        </div>
      </section>

      <div class="dialog-actions">
        <button type="button" class="btn" id="refreshOfficeBtn">Refresh from Wikidata</button>
        <button type="button" class="btn" id="addHolderBtn">Add officeholder</button>
        <button type="button" class="btn" id="linkBtn">Save link locally</button>
        <button type="button" class="btn" id="cancelBtn">Close</button>
        <button type="button" class="btn btn-primary" id="saveBtn">Save to Wikidata</button>
      </div>
    </div>
  </div>
`);

const backdrop = document.getElementById('backdrop');
const linkBtn = document.getElementById('linkBtn');
const refreshOfficeBtn = document.getElementById('refreshOfficeBtn');
const addOfficeBackdrop = document.getElementById('addOfficeBackdrop');
const addOfficeStatus = document.getElementById('addOfficeStatus');
const newOfficeTitle = document.getElementById('new-office-title');
const newOfficeDept = document.getElementById('new-office-dept');
const newOfficeWp = document.getElementById('new-office-wp');
const newOfficeSearch = document.getElementById('new-office-search');
const newOfficeResults = document.getElementById('new-office-results');
const newOfficeLinked = document.getElementById('new-office-linked');
// The Wikidata item the new office is linked to, if one was found or created.
let newOfficeQid = null;
let newOfficeSearchTimer = null;
let newOfficeSearchRequest = 0;

function linkNewOffice(qid, label, note = '') {
  newOfficeQid = qid;
  if (!newOfficeTitle.value.trim()) newOfficeTitle.value = label;
  newOfficeResults.innerHTML = '';
  newOfficeLinked.textContent = `Linked to Wikidata item ${label} (${qid}). ${note}`.trim();
  newOfficeLinked.className = 'status-line';
}

const newOfficeCreateLine = createItemLine("Can't find it? Create a new Wikidata item for this office", () => {
  const q = newOfficeSearch.value.trim();
  openCreateItemDialog('office', {
    label: /^Q[1-9]\d*$/.test(q) ? '' : q,
    onDone: ({ qid, label, created }) => linkNewOffice(qid, label, created ? 'Created on Wikidata; add the office to show it now.' : ''),
  });
});
newOfficeCreateLine.hidden = true;
newOfficeResults.after(newOfficeCreateLine);

newOfficeSearch.addEventListener('input', () => {
  clearTimeout(newOfficeSearchTimer);
  newOfficeResults.innerHTML = '';
  const q = newOfficeSearch.value.trim();
  if (!q) return;
  newOfficeSearchTimer = setTimeout(async () => {
    const mine = ++newOfficeSearchRequest;
    try {
      const { results } = await api(`/api/wikidata/search?q=${encodeURIComponent(q)}`);
      if (mine !== newOfficeSearchRequest) return;
      newOfficeCreateLine.hidden = false;
      results.slice(0, 8).forEach((r) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'create-item-result';
        btn.textContent = `${r.label} (${r.id})${r.description ? ` — ${r.description}` : ''}`;
        btn.addEventListener('click', () => linkNewOffice(r.id, r.label));
        li.appendChild(btn);
        newOfficeResults.appendChild(li);
      });
    } catch (err) {
      setStatus(addOfficeStatus, `Search failed: ${err.message}`, true);
    }
  }, 250);
});

const dialogFields = {
  office: document.getElementById('f-office'),
  dept: document.getElementById('f-dept'),
  qid: document.getElementById('f-qid'),
  officewp: document.getElementById('f-officewp'),
  wp: document.getElementById('f-wp'),
  name: document.getElementById('f-name'),
  party: document.getElementById('f-party'),
  start: document.getElementById('f-start'),
  end: document.getElementById('f-end'),
};
const pullOfficeBtn = document.getElementById('pullOfficeBtn');
const officeSourceLinks = document.getElementById('officeSourceLinks');
const holderSourceLinks = document.getElementById('holderSourceLinks');
const dialogTitle = document.getElementById('dialogTitle');
const dialogStatus = document.getElementById('dialogStatus');
const infoboxPre = document.getElementById('infobox');

// Wikidata/Wikipedia side-by-side comparison: each entry pairs an editable Wikidata-side
// input with a read-only span showing whatever "Compare with Wikipedia" last fetched, plus
// the copy button that moves the Wikipedia value into the Wikidata input on demand. Nothing
// here auto-applies — comparing only populates the right-hand column, copying is a distinct,
// deliberate action, so the two sources stay visibly separate until the user decides to merge them.
const COMPARE_FIELDS = ['dept', 'inception', 'dissolved', 'name', 'party', 'start', 'end'];
const compareCells = Object.fromEntries(
  COMPARE_FIELDS.map((key) => [key, {
    input: document.getElementById(`f-${key}`),
    wiki: document.getElementById(`wp-${key}`),
    btn: document.querySelector(`.copy-btn[data-target="${key}"]`),
  }]),
);

let currentPositionId = null;
let currentEntry = null;
// The officeholder's Wikipedia revision last compared against ({ title, revid }), and which
// term dates were copied from it with ← ({ title, revid, value }) — cited when saved to Wikidata.
let lastPulledArticle = null;
const wikiSources = { start: null, end: null };
// Called after something changes the underlying data (a saved link, an added office), so the
// page can reload.
let onDataChanged = () => {};

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.className = isError ? 'status-line error' : 'status-line';
}

async function refreshInfobox() {
  try {
    const wikitext = await api('/api/infobox/generate', {
      method: 'POST',
      body: JSON.stringify({
        name: dialogFields.name.value,
        office: dialogFields.office.value,
        department: dialogFields.dept.value,
        party: dialogFields.party.value,
        termStart: dialogFields.start.value,
        termEnd: dialogFields.end.value,
      }),
    });
    infoboxPre.textContent = wikitext.wikitext;
  } catch (err) {
    infoboxPre.textContent = `Couldn't generate wikitext: ${err.message}`;
  }
}

Object.values(dialogFields).forEach((input) => input.addEventListener('input', () => { refreshInfobox(); }));
// Publish sends what was previewed, so a date changed after the preview needs a new one.
[dialogFields.start, dialogFields.end, compareCells.inception.input, compareCells.dissolved.input]
  .forEach((input) => input.addEventListener('input', () => hideReview()));

export async function openOfficeDialog(entry, { onChange } = {}) {
  const { position, officeholder } = entry;
  currentPositionId = position.id;
  currentEntry = entry;
  lastPulledArticle = null;
  wikiSources.start = null;
  wikiSources.end = null;
  hideReview();
  onDataChanged = onChange || (() => {});
  dialogTitle.textContent = officeTitle(position.title);
  setStatus(dialogStatus, '');
  linkBtn.hidden = Boolean(position.dynamic);
  refreshOfficeBtn.hidden = !position.wikidataQid;
  refreshOfficeBtn.disabled = false;

  dialogFields.office.value = position.title;
  dialogFields.dept.value = position.department;
  dialogFields.qid.value = position.wikidataQid || '';
  dialogFields.officewp.value = position.wikipediaTitle || '';
  compareCells.inception.input.value = position.inception ? position.inception.slice(0, 10) : 'Unknown';
  compareCells.dissolved.input.value = position.dissolved ? position.dissolved.slice(0, 10) : 'Still exists';
  const holderName = officeholder?.personName && !QID_ONLY_RE.test(officeholder.personName) ? officeholder.personName : '';
  dialogFields.name.value = holderName;
  dialogFields.party.value = officeholder?.partyLabel || '';
  dialogFields.start.value = officeholder?.startDate ? officeholder.startDate.slice(0, 10) : '';
  dialogFields.end.value = officeholder?.endDate ? officeholder.endDate.slice(0, 10) : '';
  dialogFields.wp.value = holderName ? holderName.replace(/ /g, '_') : '';

  // Wipe any Wikipedia values pulled for the previously-open office/officeholder.
  for (const key of COMPARE_FIELDS) {
    compareCells[key].wiki.textContent = '—';
    compareCells[key].wiki.classList.remove('mismatch');
    compareCells[key].btn.disabled = true;
  }

  backdrop.classList.add('open');
  await refreshInfobox();

  // Heading icons: Wikidata straight away; Wikipedia once the real sitelink is known. An
  // office with no Wikidata item can only have the article it was added with.
  renderSourceLinks(officeSourceLinks, { qid: position.wikidataQid, wikipediaTitle: position.wikidataQid ? null : position.wikipediaTitle });
  renderSourceLinks(holderSourceLinks, { qid: officeholder?.personWikidataQid });

  // Fill in real sitelinks where Wikidata has them; keep the guesses otherwise.
  const lookups = [];
  if (position.wikidataQid) {
    lookups.push(api(`/api/wikidata/entity/${position.wikidataQid}`).then(({ entity }) => {
      const sitelink = entity?.sitelinks?.enwiki?.title;
      if (currentPositionId !== position.id) return;
      if (sitelink && !position.wikipediaTitle) dialogFields.officewp.value = sitelink;
      renderSourceLinks(officeSourceLinks, { qid: position.wikidataQid, wikipediaTitle: sitelink });
    }));
  }
  if (officeholder?.personWikidataQid) {
    lookups.push(api(`/api/wikidata/entity/${officeholder.personWikidataQid}`).then(({ entity }) => {
      const sitelink = entity?.sitelinks?.enwiki?.title;
      if (currentPositionId !== position.id) return;
      if (sitelink) dialogFields.wp.value = sitelink;
      renderSourceLinks(holderSourceLinks, { qid: officeholder.personWikidataQid, wikipediaTitle: sitelink });
    }));
  }
  await Promise.allSettled(lookups);
}

function closeDialog() {
  backdrop.classList.remove('open');
  currentPositionId = null;
  currentEntry = null;
}

document.getElementById('cancelBtn').addEventListener('click', closeDialog);

// Refetches the office, and its officeholder's item, from Wikidata, then reloads the view.
refreshOfficeBtn.addEventListener('click', async () => {
  const qid = currentEntry?.position.wikidataQid;
  if (!qid) return;
  const personQid = currentEntry.officeholder?.personWikidataQid;
  refreshOfficeBtn.disabled = true;
  setStatus(dialogStatus, 'Refreshing from Wikidata…');
  try {
    await Promise.all([
      refreshFromWikidata('office', qid),
      personQid ? refreshFromWikidata('item', personQid) : null,
    ]);
    closeDialog();
    await onDataChanged();
  } catch (err) {
    refreshOfficeBtn.disabled = false;
    setStatus(dialogStatus, err.status === 401 ? 'Log in with Wikimedia first.' : `Couldn't refresh: ${err.message}`, true);
  }
});

// Another holder for this office, e.g. after ending the current one's term above. The left
// office date, if any, is offered as their start.
document.getElementById('addHolderBtn').addEventListener('click', () => {
  if (!currentEntry) return;
  const entry = currentEntry;
  const start = dateForWikidata(dialogFields.end.value);
  const onSave = onDataChanged;
  closeDialog();
  openAddOfficeholderDialog(entry, { onSave, start: start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : '' });
});
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeDialog(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (addOfficeBackdrop.classList.contains('open')) closeAddOfficeDialog();
  else if (backdrop.classList.contains('open')) closeDialog();
});

export function openAddOfficeDialog({ onChange } = {}) {
  onDataChanged = onChange || (() => {});
  newOfficeTitle.value = '';
  newOfficeDept.value = '';
  newOfficeWp.value = '';
  newOfficeSearch.value = '';
  newOfficeResults.innerHTML = '';
  newOfficeLinked.textContent = '';
  newOfficeCreateLine.hidden = true;
  newOfficeQid = null;
  setStatus(addOfficeStatus, '');
  addOfficeBackdrop.classList.add('open');
  newOfficeSearch.focus();
}

function closeAddOfficeDialog() {
  addOfficeBackdrop.classList.remove('open');
}

document.getElementById('addOfficeCancelBtn').addEventListener('click', closeAddOfficeDialog);
addOfficeBackdrop.addEventListener('click', (e) => { if (e.target === addOfficeBackdrop) closeAddOfficeDialog(); });

document.getElementById('addOfficeSubmitBtn').addEventListener('click', async () => {
  const title = newOfficeTitle.value.trim();
  if (!title) {
    setStatus(addOfficeStatus, 'Office title is required.', true);
    return;
  }
  try {
    await api('/api/positions', {
      method: 'POST',
      body: JSON.stringify({
        countryQid: state.countryQid,
        title,
        department: newOfficeDept.value.trim(),
        wikipediaTitle: newOfficeWp.value.trim(),
        wikidataQid: newOfficeQid,
      }),
    });
    closeAddOfficeDialog();
    await onDataChanged();
  } catch (err) {
    setStatus(addOfficeStatus, err.status === 401 ? 'Log in with Wikimedia first.' : `Couldn't add the office: ${err.message}`, true);
  }
});

// A Wikidata-side value counts as "empty" for comparison purposes even when it's holding one
// of our own placeholder strings ("Unknown", "Still exists", "Incumbent") rather than blank.
const EMPTY_PLACEHOLDERS = new Set(['', 'unknown', 'still exists', 'incumbent']);

function normalizeDateForCompare(s) {
  if (!s) return s;
  const cleaned = s.replace(/<[^>]+>/g, '').replace(/\[\[[^\]]+\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
  
  // Handle templates roughly
  if (cleaned.includes('{{')) {
    // Try to extract date from templates
    const tmpl = cleaned.match(/\{\{[^{}]*\|([^{}|]+(?:\|[^{}]+)*)\}\}/i);
    if (tmpl) {
      const parts = tmpl[1].split('|').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{1,2}$/.test(parts[2])) {
        return `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
      }
      for (const part of parts) {
        const res = normalizeDateForCompare(part);
        if (res && res !== part) return res;
      }
    }
  }
  
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`;
  
  const dmy = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase()];
    if (month) return `${dmy[3]}-${month}-${dmy[1].padStart(2,'0')}`;
  }
  
  const mdy = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (mdy) {
    const month = MONTHS[mdy[1].toLowerCase()];
    if (month) return `${mdy[3]}-${month}-${mdy[2].padStart(2,'0')}`;
  }
  
  const my = cleaned.match(/([A-Za-z]+)\s+(\d{4})/);
  if (my) {
    const month = MONTHS[my[1].toLowerCase()];
    if (month) return `${my[2]}-${month}-01`;
  }
  
  const y = cleaned.match(/^(\d{4})$/);
  if (y) return `${y[1]}-01-01`;
  
  return cleaned.toLowerCase();
}

function fillCompareCell(key, wikipediaValue) {
  const cell = compareCells[key];
  cell.wiki.textContent = wikipediaValue || '—';
  cell.btn.disabled = !wikipediaValue;
  if (!wikipediaValue) {
    cell.wiki.classList.remove('mismatch');
    return;
  }
  const wikidataNorm = cell.input.value.trim().toLowerCase();
  const wikiNorm = normalizeDateForCompare(wikipediaValue);
  const wdNorm = normalizeDateForCompare(cell.input.value.trim());
  
  const isDateField = ['inception', 'dissolved', 'start', 'end'].includes(key);
  let differs;
  if (isDateField && wikiNorm.match(/^\d{4}-\d{2}-\d{2}$/) && wdNorm.match(/^\d{4}-\d{2}-\d{2}$/)) {
    differs = wikiNorm !== wdNorm;
  } else {
    differs = EMPTY_PLACEHOLDERS.has(wikidataNorm) || wdNorm !== wikiNorm;
  }
  cell.wiki.classList.toggle('mismatch', differs);
}

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.target;
    const cell = compareCells[key];
    cell.input.value = cell.wiki.textContent;
    cell.wiki.classList.remove('mismatch');
    if (key in wikiSources && lastPulledArticle) wikiSources[key] = { ...lastPulledArticle, value: cell.input.value };
    hideReview();
    refreshInfobox();
  });
});

const COMPARED = (title) => `Compared with "${title}". Fields marked ≠ differ; use ← to copy a Wikipedia value across.`;

document.getElementById('pullBtn').addEventListener('click', async () => {
  const title = dialogFields.wp.value.trim();
  const office = dialogFields.office.value.trim();
  if (!title) {
    setStatus(dialogStatus, "Enter the officeholder's Wikipedia article first.", true);
    return;
  }
  setStatus(dialogStatus, `Reading the infobox on "${title}"…`);
  try {
    const url = `/api/wikipedia/infobox?title=${encodeURIComponent(title)}${office ? `&office=${encodeURIComponent(office)}` : ''}`;
    const { fields, title: articleTitle, revid } = await api(url);
    lastPulledArticle = revid ? { title: articleTitle, revid } : null;
    fillCompareCell('name', fields.name || '');
    fillCompareCell('party', fields.party || '');
    fillCompareCell('start', fields.term_start || '');
    fillCompareCell('end', fields.term_end || '');
    setStatus(dialogStatus, COMPARED(title));
  } catch (err) {
    setStatus(dialogStatus, `Couldn't read "${title}": ${err.message}`, true);
  }
});

// Pulls the OFFICE's own Wikipedia infobox (Infobox official/political post) into the
// Wikipedia-side comparison column — deliberately never auto-applied to the Wikidata-side
// inputs, since the point is to surface disagreements between the two sources (mismatch
// highlighting) and let the user decide, per field, whether to copy Wikipedia's value across.
pullOfficeBtn.addEventListener('click', async () => {
  const title = dialogFields.officewp.value.trim();
  if (!title) {
    setStatus(dialogStatus, "Enter the office's Wikipedia article first.", true);
    return;
  }
  setStatus(dialogStatus, `Reading the infobox on "${title}"…`);
  try {
    const { fields } = await api(`/api/wikipedia/office-infobox?title=${encodeURIComponent(title)}`);
    fillCompareCell('dept', fields.department || fields.body || '');
    fillCompareCell('inception', fields.formation || '');
    fillCompareCell('dissolved', fields.abolished || '');
    setStatus(dialogStatus, COMPARED(title));
  } catch (err) {
    setStatus(dialogStatus, `Couldn't read "${title}": ${err.message}`, true);
  }
});

linkBtn.addEventListener('click', async () => {
  if (!currentPositionId) return;
  try {
    await api(`/api/positions/${currentPositionId}/link`, {
      method: 'PUT',
      body: JSON.stringify({ wikidataQid: dialogFields.qid.value.trim(), wikipediaTitle: dialogFields.officewp.value.trim() }),
    });
    setStatus(dialogStatus, 'Link saved locally.');
    await onDataChanged();
  } catch (err) {
    setStatus(dialogStatus, err.status === 401 ? 'Log in with Wikimedia first.' : `Couldn't save the link: ${err.message}`, true);
  }
});

for (const key of Object.keys(wikiSources)) {
  dialogFields[key].addEventListener('input', () => {
    if (wikiSources[key] && dialogFields[key].value !== wikiSources[key].value) wikiSources[key] = null;
  });
}

const sourceFor = (key) => {
  const src = wikiSources[key];
  return src && dialogFields[key].value === src.value ? { title: src.title, revid: src.revid } : null;
};

const reviewEl = document.getElementById('editReview');
const reviewBody = document.getElementById('editReviewBody');
const publishBtn = document.getElementById('editReviewPublish');
const wikidataLink = (qid, text = qid) => {
  const a = document.createElement('a');
  a.href = `https://www.wikidata.org/wiki/${qid}`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
};
// The request being reviewed; Publish sends exactly this, plus the revision it was planned against.
let pendingEdit = null;

function hideReview() {
  reviewEl.hidden = true;
  reviewBody.innerHTML = '';
  pendingEdit = null;
}

// What Save to Wikidata sends: the holder's term dates, if there's a holder, and the office's own
// created / abolished dates. choice: { statementId, officeStatementId }, the statements the user
// picked when several match.
function termRequest(choice = {}) {
  const position = currentEntry?.position;
  const personQid = currentEntry?.officeholder?.personWikidataQid || null;
  if (!position?.wikidataQid) throw new Error('This office has no Wikidata item to save to.');
  const read = (input, label) => {
    const value = dateForWikidata(input.value);
    if (value === null) throw new Error(`Can't read "${input.value}" as the ${label} date. Use YYYY-MM-DD, YYYY-MM or YYYY.`);
    return value;
  };
  const start = read(dialogFields.start, 'took office');
  const end = read(dialogFields.end, 'left office');
  const officeInception = read(compareCells.inception.input, 'created');
  const officeDissolved = read(compareCells.dissolved.input, 'abolished');
  if ((start || end) && !personQid) throw new Error('There is no officeholder to save term dates for. Use "Add officeholder" to pick one first.');
  if (!start && !end && !officeInception && !officeDissolved) throw new Error('Enter a date to save.');
  const sources = { start: start ? sourceFor('start') : null, end: end ? sourceFor('end') : null };
  return {
    personQid: start || end ? personQid : null, positionQid: position.wikidataQid, start, end,
    statementId: choice.statementId ?? null, officeStatementId: choice.officeStatementId ?? null, sources,
    officeInception, officeDissolved,
  };
}

const LINK_LABELS = { P39: 'position held', P1308: 'officeholder' };

// One item's half of the review: its heading, then a choice of statement or the changes to it.
// Returns false when the user has to choose a statement first.
function renderSide(side, request) {
  const heading = document.createElement('p');
  heading.append('On ', wikidataLink(side.entityQid, `${side.entityLabel} (${side.entityQid})`), ':');
  reviewBody.appendChild(heading);
  const linkLabel = LINK_LABELS[side.property];

  if (side.needsChoice) {
    const ask = document.createElement('p');
    ask.textContent = `${side.entityLabel} has ${side.candidates.length} "${linkLabel}" statements for this term. Which one is it?`;
    const list = document.createElement('ul');
    list.className = 'edit-review-choices';
    side.candidates.forEach((c) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = `${c.start ?? 'no start'} – ${c.end ?? 'no end'}${c.rank === 'normal' ? '' : ` (${c.rank} rank)`}`;
      const key = side.property === 'P39' ? 'statementId' : 'officeStatementId';
      btn.addEventListener('click', () => previewEdit({
        statementId: request.statementId, officeStatementId: request.officeStatementId, [key]: c.id,
      }));
      li.appendChild(btn);
      list.appendChild(li);
    });
    reviewBody.append(ask, list);
    return false;
  }

  if (side.statementId && side.changes.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Already has these dates. Nothing to change.';
    reviewBody.appendChild(p);
    return true;
  }
  const changes = document.createElement('ul');
  changes.className = 'edit-review-changes';
  if (!side.statementId) {
    const li = document.createElement('li');
    li.append(`Add a new "${linkLabel}" statement: `, wikidataLink(side.valueQid));
    changes.appendChild(li);
  }
  side.changes.forEach((c) => {
    const li = document.createElement('li');
    const verb = c.from ? 'Change' : 'Add';
    li.append(`${verb} ${c.label} (${c.property}): `);
    if (c.from) {
      const from = document.createElement('del');
      from.textContent = c.from;
      li.append(from, ' → ');
    }
    const to = document.createElement('ins');
    to.textContent = c.to;
    li.appendChild(to);
    if (c.copiedFrom) li.append(' (copied from ', wikidataLink(c.copiedFrom), ')');
    changes.appendChild(li);
  });
  side.references.forEach((r) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = r.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'voice-wp';
    link.textContent = r.title;
    li.append('Add reference: imported from English Wikipedia, revision ', String(r.revid), ' of ', link);
    changes.appendChild(li);
  });
  reviewBody.appendChild(changes);
  return true;
}

// The office's own dates, under their own heading.
function renderOfficeDates(office, officeDates) {
  const heading = document.createElement('p');
  heading.append('On ', wikidataLink(office.qid, `${office.label} (${office.qid})`), ', the office itself:');
  const list = document.createElement('ul');
  list.className = 'edit-review-changes';
  officeDates.forEach((c) => {
    const li = document.createElement('li');
    li.append(`${c.from ? 'Change' : 'Add'} ${c.label} (${c.field}): `);
    if (c.from) li.append(Object.assign(document.createElement('del'), { textContent: c.from }), ' → ');
    li.append(Object.assign(document.createElement('ins'), { textContent: c.to }));
    if (c.referencesDropped) li.append(` (${c.referencesDropped === 1 ? 'its reference cites' : `its ${c.referencesDropped} references cite`} the old date, so ${c.referencesDropped === 1 ? 'it is' : 'they are'} removed)`);
    list.appendChild(li);
  });
  reviewBody.append(heading, list);
}

function renderReview({ plan, officeDates, office, username, tags }, request) {
  reviewBody.innerHTML = '';
  const intro = document.createElement('p');
  intro.textContent = plan ? `As ${username}, the term is saved on both the officeholder and the office:` : `As ${username}:`;
  reviewBody.appendChild(intro);

  // The office side is only planned once the person's statement is settled.
  const ready = !plan || (renderSide(plan.person, request) && renderSide(plan.office, request));
  if (!ready) {
    publishBtn.hidden = true;
    reviewEl.hidden = false;
    return;
  }
  if (officeDates.length) renderOfficeDates(office, officeDates);

  (plan?.conflicts ?? []).forEach((c) => {
    const p = document.createElement('p');
    p.className = 'status-line error';
    p.textContent = `The two items disagree on the ${c.label}: ${c.person} on the officeholder, ${c.office} on the office. `
      + 'Neither is changed; enter the right date above to set both.';
    reviewBody.appendChild(p);
  });

  const hasWork = (side) => !side.statementId || side.changes.length > 0;
  const nothing = !(plan && (hasWork(plan.person) || hasWork(plan.office))) && officeDates.length === 0;
  if (nothing) {
    const p = document.createElement('p');
    p.textContent = 'Wikidata already has these dates. Nothing to change.';
    reviewBody.appendChild(p);
  }
  const note = document.createElement('p');
  note.className = 'edit-review-note';
  note.textContent = 'Saved: the term dates, and the office\'s created and abolished dates. A blank date leaves Wikidata as it is. '
    + 'Name, party, title and department are not saved. '
    + (tags ? `Tagged: ${tags}.` : 'No edit tag is configured.');
  reviewBody.appendChild(note);

  pendingEdit = nothing ? null : {
    ...request,
    statementId: plan?.person.statementId ?? null,
    officeStatementId: plan?.office.statementId ?? null,
    baseRevId: plan?.person.baseRevId ?? null,
    officeBaseRevId: office.baseRevId,
  };
  publishBtn.hidden = nothing;
  publishBtn.disabled = false;
  reviewEl.hidden = false;
}

async function previewEdit(choice = {}) {
  let request;
  try {
    request = termRequest(choice);
  } catch (err) {
    setStatus(dialogStatus, err.message, true);
    return;
  }
  setStatus(dialogStatus, 'Checking Wikidata…');
  try {
    const preview = await api('/api/wikidata/term/preview', { method: 'POST', body: JSON.stringify(request) });
    // The dialog may have moved on to another office while Wikidata was checked.
    if (currentEntry?.position.wikidataQid !== request.positionQid) return;
    setStatus(dialogStatus, '');
    renderReview(preview, request);
  } catch (err) {
    setStatus(dialogStatus, err.status === 401 ? 'Log in with Wikimedia first.' : err.message, true);
  }
}

document.getElementById('saveBtn').addEventListener('click', () => previewEdit());
document.getElementById('editReviewCancel').addEventListener('click', hideReview);

publishBtn.addEventListener('click', async () => {
  if (!pendingEdit) return;
  publishBtn.disabled = true;
  setStatus(dialogStatus, 'Publishing to Wikidata…');
  try {
    const { applied } = await api('/api/wikidata/term/save', { method: 'POST', body: JSON.stringify(pendingEdit) });
    hideReview();
    dialogStatus.className = 'status-line';
    dialogStatus.textContent = 'Saved to Wikidata. ';
    // One diff per item, spanning every edit made to it.
    applied.forEach(({ entityQid, baseRevId, revisions }) => {
      const last = revisions[revisions.length - 1];
      if (!last) return;
      const diff = document.createElement('a');
      diff.href = `https://www.wikidata.org/w/index.php?title=${entityQid}&diff=${last}&oldid=${baseRevId}`;
      diff.target = '_blank';
      diff.rel = 'noopener';
      diff.textContent = `View the ${revisions.length === 1 ? 'edit' : `${revisions.length} edits`} to ${entityQid}`;
      dialogStatus.append(diff, '. ');
    });
    dialogStatus.append("Wikidata's query service can take a few minutes to show it here.");
    await onDataChanged();
  } catch (err) {
    publishBtn.disabled = false;
    const partial = err.body?.revisions?.length ? ` ${err.body.revisions.length} edit(s) went through before this; check the items' history.` : '';
    setStatus(dialogStatus, (err.status === 401 ? 'Log in with Wikimedia first.' : err.message) + partial, true);
  }
});
