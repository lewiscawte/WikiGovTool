// The office comparison dialog (Wikidata vs Wikipedia) and the add-office dialog, shared by
// both pages. Importing this module adds the dialogs' markup to the page.
import { api, officeTitle, QID_ONLY_RE, state } from './shared.js';

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

      <h3 class="dialog-section">Office</h3>
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

      <h3 class="dialog-section">Officeholder</h3>
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

  // Fill in real sitelinks where Wikidata has them; keep the guesses otherwise.
  const lookups = [];
  if (position.wikidataQid && !position.wikipediaTitle) {
    lookups.push(api(`/api/wikidata/entity/${position.wikidataQid}`).then(({ entity }) => {
      const sitelink = entity?.sitelinks?.enwiki?.title;
      if (sitelink && currentPositionId === position.id) dialogFields.officewp.value = sitelink;
    }));
  }
  if (officeholder?.personWikidataQid) {
    lookups.push(api(`/api/wikidata/entity/${officeholder.personWikidataQid}`).then(({ entity }) => {
      const sitelink = entity?.sitelinks?.enwiki?.title;
      if (sitelink && currentPositionId === position.id) dialogFields.wp.value = sitelink;
    }));
  }
  await Promise.allSettled(lookups);
}

function closeDialog() {
  backdrop.classList.remove('open');
  currentPositionId = null;
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
  july: '07', august: '08', september: '09', oct: '10', october: '10',
  nov: '11', november: '11', dec: '12', december: '12',
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
    const { fields } = await api(url);
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

document.getElementById('saveBtn').addEventListener('click', async () => {
  try {
    await api('/api/wikidata/save', { method: 'POST', body: JSON.stringify({}) });
  } catch (err) {
    setStatus(dialogStatus, err.status === 401 ? 'Log in with Wikimedia first.' : (err.body?.detail || err.message), true);
  }
});
