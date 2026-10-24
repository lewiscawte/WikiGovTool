import { api, renderSourceLinks, state } from './shared.js';

document.body.insertAdjacentHTML('beforeend', `
  <div class="dialog-backdrop" id="departmentDialogBackdrop">
    <div class="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="departmentDialogTitle">
      <div class="dialog-heading">
        <h2 class="dialog-title" id="departmentDialogTitle">Department</h2>
        <span class="source-links" id="deptSourceLinks"></span>
      </div>
      <div id="deptAddSection">
        <p class="dialog-intro">Search for a department on Wikidata or add it locally.</p>
        <div class="field">
          <label for="deptSearch">Search Wikidata</label>
          <input class="input" id="deptSearch" placeholder="e.g. Department for Transport" autocomplete="off">
        </div>
        <div class="field">
          <label for="deptSearchResults">Results</label>
          <select class="input" id="deptSearchResults" size="6"></select>
          <p class="hint">Select a result to use its Wikidata item, or leave unselected to add locally.</p>
        </div>
      </div>
      <div class="dept-dialog-body">
        <div class="dept-dialog-form">
          <div class="field">
            <label for="deptLabel">Name</label>
            <input class="input" id="deptLabel">
          </div>
          <div class="field">
            <label for="deptQid">Wikidata QID (optional)</label>
            <input class="input" id="deptQid" placeholder="Q...">
          </div>
          <div class="field">
            <label for="deptWikipedia">Wikipedia title (optional)</label>
            <input class="input" id="deptWikipedia">
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="deptInception">Inception (optional)</label>
              <input class="input" id="deptInception" placeholder="YYYY-MM-DD">
            </div>
            <div class="field">
              <label for="deptDissolved">Dissolved (optional)</label>
              <input class="input" id="deptDissolved" placeholder="YYYY-MM-DD">
            </div>
          </div>
        </div>
        <aside class="dept-profile" id="deptProfile" aria-live="polite">
          <h3 class="dept-profile-title">On Wikidata</h3>
          <div id="deptProfileBody"></div>
        </aside>
      </div>
      <p class="status-line" id="departmentDialogStatus"></p>
      <div class="dialog-actions">
        <button type="button" class="btn" id="departmentDialogCancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="departmentDialogSave">Save</button>
      </div>
    </div>
  </div>
`);

const backdrop = document.getElementById('departmentDialogBackdrop');
const titleEl = document.getElementById('departmentDialogTitle');
const addSection = document.getElementById('deptAddSection');
const searchInput = document.getElementById('deptSearch');
const resultsSelect = document.getElementById('deptSearchResults');
const labelInput = document.getElementById('deptLabel');
const qidInput = document.getElementById('deptQid');
const wpInput = document.getElementById('deptWikipedia');
const inceptionInput = document.getElementById('deptInception');
const dissolvedInput = document.getElementById('deptDissolved');
const profileBody = document.getElementById('deptProfileBody');
const deptSourceLinks = document.getElementById('deptSourceLinks');
const statusEl = document.getElementById('departmentDialogStatus');
const cancelBtn = document.getElementById('departmentDialogCancel');
const saveBtn = document.getElementById('departmentDialogSave');

let mode = 'add'; // 'add' | 'edit'
let editQid = null;
let onSaveCallback = () => {};
let profile = null;
let profileRequest = 0;

const QID_RE = /^Q[1-9]\d*$/;
const day = (iso) => (iso ? iso.slice(0, 10) : '');
const wikidataUrl = (qid) => `https://www.wikidata.org/wiki/${qid}`;
const wikipediaUrl = (title) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

function link(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

function profileRow(dl, term, ...values) {
  const nodes = values.flat().filter(Boolean);
  if (!nodes.length) return null;
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  nodes.forEach((n, i) => {
    if (i) dd.append(', ');
    dd.append(n);
  });
  dl.append(dt, dd);
  return dd;
}

const itemLinks = (items) => items.map((i) => link(wikidataUrl(i.qid), i.label));

// Marks a Wikidata value that disagrees with what the form says (red = mismatch, as elsewhere).
function compared(dd, formValue, wikidataValue) {
  if (dd && formValue && wikidataValue && formValue !== wikidataValue) {
    dd.classList.add('mismatch');
    dd.title = `The form says "${formValue}"`;
  }
}

function renderProfile(message) {
  profileBody.innerHTML = '';
  renderSourceLinks(deptSourceLinks, profile ? { qid: profile.qid, wikipediaTitle: profile.wikipediaTitle } : {});
  if (!profile) {
    const p = document.createElement('p');
    p.className = 'dept-profile-empty';
    p.textContent = message || 'Pick a Wikidata item to see what Wikidata records about it.';
    profileBody.appendChild(p);
    return;
  }
  if (profile.description) {
    const desc = document.createElement('p');
    desc.className = 'dept-profile-desc';
    desc.textContent = profile.description;
    profileBody.appendChild(desc);
  }
  const dl = document.createElement('dl');
  dl.className = 'dept-profile-facts';
  profileRow(dl, 'Item', link(wikidataUrl(profile.qid), profile.qid));
  compared(profileRow(dl, 'Label', profile.label), labelInput.value.trim(), profile.label);
  profileRow(dl, 'Also known as', profile.aliases.join(', ') || null);
  const wp = profileRow(dl, 'Wikipedia', profile.wikipediaTitle && link(wikipediaUrl(profile.wikipediaTitle), profile.wikipediaTitle));
  if (wp) wp.classList.add('voice-wp');
  compared(wp, wpInput.value.trim(), profile.wikipediaTitle);
  compared(profileRow(dl, 'Inception', day(profile.inception) || null), inceptionInput.value.trim(), day(profile.inception));
  compared(profileRow(dl, 'Dissolved', day(profile.dissolved) || null), dissolvedInput.value.trim(), day(profile.dissolved));
  profileRow(dl, 'Head office', itemLinks(profile.headOffice));
  profileRow(dl, 'Parent organisation', itemLinks(profile.parent));
  profileRow(dl, 'Instance of', itemLinks(profile.instanceOf));
  profileRow(dl, 'Country', itemLinks(profile.country));
  profileRow(dl, 'Headquarters', itemLinks(profile.headquarters));
  profileRow(dl, 'Replaces', itemLinks(profile.replaces));
  profileRow(dl, 'Replaced by', itemLinks(profile.replacedBy));
  // Only http(s) becomes a link: the value is from Wikidata, and its URL type isn't the only
  // thing that should stand between a page anyone can edit and an href.
  const website = /^https?:\/\//i.test(profile.website || '') ? profile.website : null;
  profileRow(dl, 'Website', website && link(website, website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')));
  profileBody.appendChild(dl);
}

// Loads the Wikidata profile for `qid` and, if `fill`, copies its values into any empty field.
async function loadProfile(qid, { fill = false } = {}) {
  const request = ++profileRequest;
  profile = null;
  if (!QID_RE.test(qid)) {
    renderProfile();
    return;
  }
  renderProfile('Loading from Wikidata…');
  try {
    const res = await api(`/api/departments/profile/${qid}`);
    if (request !== profileRequest) return;
    profile = res.profile;
    if (fill) {
      if (!labelInput.value.trim()) labelInput.value = profile.label;
      if (!wpInput.value.trim() && profile.wikipediaTitle) wpInput.value = profile.wikipediaTitle;
      if (!inceptionInput.value.trim()) inceptionInput.value = day(profile.inception);
      if (!dissolvedInput.value.trim()) dissolvedInput.value = day(profile.dissolved);
    }
    renderProfile();
  } catch (err) {
    if (request !== profileRequest) return;
    renderProfile(err.status === 404 ? `${qid} wasn't found on Wikidata.` : `Couldn't load ${qid} from Wikidata.`);
  }
}

qidInput.addEventListener('change', () => loadProfile(qidInput.value.trim(), { fill: mode === 'add' }));
[labelInput, wpInput, inceptionInput, dissolvedInput].forEach((input) => input.addEventListener('input', () => {
  if (profile) renderProfile();
}));

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = isError ? 'status-line error' : 'status-line';
}

function close() {
  backdrop.classList.remove('open');
  setStatus('');
  resultsSelect.innerHTML = '';
  searchInput.value = '';
}

cancelBtn.addEventListener('click', close);
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (backdrop.classList.contains('open')) close();
});

let searchTimeout = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  resultsSelect.innerHTML = '';
  if (!q) return;
  searchTimeout = setTimeout(async () => {
    try {
      const res = await api(`/api/wikidata/search?q=${encodeURIComponent(q)}`);
      const results = res.results || [];
      if (results.length === 0) {
        const opt = document.createElement('option');
        opt.disabled = true;
        opt.textContent = 'No results';
        resultsSelect.appendChild(opt);
        return;
      }
      for (const r of results.slice(0, 15)) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = `${r.label} (${r.id})${r.description ? ' — ' + r.description : ''}`;
        opt.dataset.label = r.label;
        resultsSelect.appendChild(opt);
      }
    } catch (err) {
      setStatus('Search failed.', true);
    }
  }, 250);
});

resultsSelect.addEventListener('change', () => {
  const opt = resultsSelect.selectedOptions[0];
  if (!opt || !opt.value || opt.disabled) return;
  qidInput.value = opt.value;
  if (opt.dataset.label && !labelInput.value) {
    labelInput.value = opt.dataset.label;
  }
  loadProfile(opt.value, { fill: true });
});

export function openAddDepartmentDialog({ onSave } = {}) {
  mode = 'add';
  editQid = null;
  onSaveCallback = onSave || (() => {});
  titleEl.textContent = 'Add department';
  addSection.style.display = 'block';
  labelInput.value = '';
  qidInput.value = '';
  wpInput.value = '';
  inceptionInput.value = '';
  dissolvedInput.value = '';
  setStatus('');
  resultsSelect.innerHTML = '';
  searchInput.value = '';
  qidInput.readOnly = false;
  loadProfile('');
  backdrop.classList.add('open');
  searchInput.focus();
}

export function openEditDepartmentDialog(dept, { onSave } = {}) {
  mode = 'edit';
  editQid = dept.qid;
  onSaveCallback = onSave || (() => {});
  titleEl.textContent = 'Edit department';
  addSection.style.display = 'none';
  labelInput.value = dept.label || '';
  qidInput.value = dept.qid && dept.qid.startsWith('Q') ? dept.qid : '';
  wpInput.value = dept.wikipediaTitle || '';
  inceptionInput.value = dept.inception ? dept.inception.slice(0, 10) : '';
  dissolvedInput.value = dept.dissolved ? dept.dissolved.slice(0, 10) : '';
  // The QID is what the edit is keyed on, so it can't be changed here.
  qidInput.readOnly = true;
  setStatus('');
  loadProfile(qidInput.value);
  backdrop.classList.add('open');
  labelInput.focus();
}

saveBtn.addEventListener('click', async () => {
  const label = labelInput.value.trim();
  if (!label) {
    setStatus('Name is required.', true);
    return;
  }
  const countryQid = state.countryQid || 'Q30';
  try {
    if (mode === 'add') {
      await api('/api/departments', {
        method: 'POST',
        body: JSON.stringify({
          countryQid,
          qid: qidInput.value.trim() || undefined,
          label,
          wikipediaTitle: wpInput.value.trim(),
          inception: inceptionInput.value.trim() || undefined,
          dissolved: dissolvedInput.value.trim() || undefined,
        }),
      });
      setStatus('Department added.');
    } else {
      await api(`/api/departments/${editQid}`, {
        method: 'PUT',
        body: JSON.stringify({
          label,
          wikipediaTitle: wpInput.value.trim(),
          inception: inceptionInput.value.trim() || null,
          dissolved: dissolvedInput.value.trim() || null,
        }),
      });
      setStatus('Department updated.');
    }
    await onSaveCallback();
    setTimeout(close, 400);
  } catch (err) {
    setStatus(err.status === 401 ? 'Log in with Wikimedia first.' : `Error: ${err.message}`, true);
  }
});
