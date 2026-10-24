// The office comparison dialog (Wikidata vs Wikipedia) and the add-office dialog, shared by
// both pages. Importing this module adds the dialogs' markup to the page.
import { api, officeTitle, QID_ONLY_RE, renderSourceLinks, state } from './shared.js';

document.body.insertAdjacentHTML('beforeend', `
  <div class="dialog-backdrop" id="addOfficeBackdrop">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="addOfficeTitle">
      <h2 class="dialog-title" id="addOfficeTitle">Add office</h2>
      <p class="dialog-intro">
        Adds a local entry for an office that exists in government but has no Wikidata item
        we can find. Nothing is created on Wikidata.
      </p>
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
        <button type="button" class="btn" id="linkBtn">Save link locally</button>
        <button type="button" class="btn" id="cancelBtn">Close</button>
        <button type="button" class="btn btn-primary" id="saveBtn">Save to Wikidata</button>
      </div>
    </div>
  </div>
`);

const backdrop = document.getElementById('backdrop');
const linkBtn = document.getElementById('linkBtn');
const addOfficeBackdrop = document.getElementById('addOfficeBackdrop');
const addOfficeStatus = document.getElementById('addOfficeStatus');
const newOfficeTitle = document.getElementById('new-office-title');
const newOfficeDept = document.getElementById('new-office-dept');
const newOfficeWp = document.getElementById('new-office-wp');

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
  setStatus(addOfficeStatus, '');
  addOfficeBackdrop.classList.add('open');
  newOfficeTitle.focus();
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

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08',
  sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

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

// Term dates as Wikidata takes them: "YYYY", "YYYY-MM" or "YYYY-MM-DD" at the precision the
// text actually gives (so "March 1950" never becomes 1950-03-01). '' for blank; null if unreadable.
function termDateForWikidata(text) {
  const cleaned = (text || '').replace(/<[^>]+>/g, '').replace(/\[\[[^\]]+\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
  if (!cleaned) return '';
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(cleaned)) return cleaned;
  const pad = (n) => String(n).padStart(2, '0');
  let m = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/);
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

function termRequest(statementId = null) {
  const position = currentEntry?.position;
  const personQid = currentEntry?.officeholder?.personWikidataQid;
  if (!position?.wikidataQid) throw new Error('This office has no Wikidata item to save to.');
  if (!personQid) throw new Error('There is no officeholder to save. Use "Add officeholder" to pick one first.');
  const start = termDateForWikidata(dialogFields.start.value);
  const end = termDateForWikidata(dialogFields.end.value);
  if (start === null) throw new Error(`Can't read "${dialogFields.start.value}" as a date. Use YYYY-MM-DD.`);
  if (end === null) throw new Error(`Can't read "${dialogFields.end.value}" as a date. Use YYYY-MM-DD.`);
  const sources = { start: start ? sourceFor('start') : null, end: end ? sourceFor('end') : null };
  return { personQid, positionQid: position.wikidataQid, start, end, statementId, sources };
}

function renderReview({ plan, username, tags }, request) {
  reviewBody.innerHTML = '';
  const intro = document.createElement('p');
  intro.append(`As ${username}, on `, wikidataLink(plan.personQid, `${plan.personLabel} (${plan.personQid})`), ':');
  reviewBody.appendChild(intro);

  if (plan.needsChoice) {
    const ask = document.createElement('p');
    ask.textContent = `${plan.personLabel} has ${plan.candidates.length} "position held" statements for this office. Which term is this?`;
    const list = document.createElement('ul');
    list.className = 'edit-review-choices';
    plan.candidates.forEach((c) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = `${c.start ?? 'no start'} – ${c.end ?? 'no end'}${c.rank === 'normal' ? '' : ` (${c.rank} rank)`}`;
      btn.addEventListener('click', () => previewEdit(c.id));
      li.appendChild(btn);
      list.appendChild(li);
    });
    reviewBody.append(ask, list);
    publishBtn.hidden = true;
    reviewEl.hidden = false;
    return;
  }

  const changes = document.createElement('ul');
  changes.className = 'edit-review-changes';
  if (!plan.statementId) {
    const li = document.createElement('li');
    li.append('Add a new "position held" statement: ', wikidataLink(plan.positionQid, `${officeTitle(currentEntry.position.title)} (${plan.positionQid})`));
    changes.appendChild(li);
  }
  plan.changes.forEach((c) => {
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
    changes.appendChild(li);
  });
  plan.references.forEach((r) => {
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
  const nothing = plan.statementId && plan.changes.length === 0;
  if (nothing) {
    const p = document.createElement('p');
    p.textContent = 'Wikidata already has these dates. Nothing to change.';
    reviewBody.appendChild(p);
  } else {
    reviewBody.appendChild(changes);
  }

  const note = document.createElement('p');
  note.className = 'edit-review-note';
  note.textContent = `Only the term dates are saved; name, party and the office fields are not. `
    + (tags ? `Tagged: ${tags}.` : 'No edit tag is configured.');
  reviewBody.appendChild(note);

  pendingEdit = nothing ? null : { ...request, statementId: plan.statementId, baseRevId: plan.baseRevId };
  publishBtn.hidden = nothing;
  publishBtn.disabled = false;
  reviewEl.hidden = false;
}

async function previewEdit(statementId = null) {
  let request;
  try {
    request = termRequest(statementId);
  } catch (err) {
    setStatus(dialogStatus, err.message, true);
    return;
  }
  setStatus(dialogStatus, 'Checking Wikidata…');
  try {
    const preview = await api('/api/wikidata/term/preview', { method: 'POST', body: JSON.stringify(request) });
    if (currentEntry?.officeholder?.personWikidataQid !== request.personQid) return;
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
    const { revisions } = await api('/api/wikidata/term/save', { method: 'POST', body: JSON.stringify(pendingEdit) });
    hideReview();
    dialogStatus.className = 'status-line';
    dialogStatus.textContent = 'Saved to Wikidata. ';
    const last = revisions[revisions.length - 1];
    if (last) {
      const diff = document.createElement('a');
      diff.href = `https://www.wikidata.org/w/index.php?diff=${last}`;
      diff.target = '_blank';
      diff.rel = 'noopener';
      diff.textContent = revisions.length === 1 ? 'View the edit' : `View the last of ${revisions.length} edits`;
      dialogStatus.append(diff, '. ');
    }
    dialogStatus.append("Wikidata's query service can take a few minutes to show it here.");
    await onDataChanged();
  } catch (err) {
    publishBtn.disabled = false;
    const partial = err.body?.revisions?.length ? ` ${err.body.revisions.length} edit(s) went through before this; check the item's history.` : '';
    setStatus(dialogStatus, (err.status === 401 ? 'Log in with Wikimedia first.' : err.message) + partial, true);
  }
});
