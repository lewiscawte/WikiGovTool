import { api, dateForWikidata, refreshFromWikidata, renderSourceLinks, state } from './shared.js';
import { createItemLine, itemPicker, openCreateItemDialog } from './createItemDialog.js';

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
      <section class="dept-succession" id="deptSuccession" hidden>
        <h3 class="dialog-section"><span>Formation and dissolution</span></h3>
        <p class="create-item-hint">
          Only ever added to Wikidata, never removed. One row per department,
          so a department formed from parts of several, or split several ways, gets a row each.
          "Replaces" and "replaced by" are added to the other department too.
        </p>
        <h4 class="dept-succession-heading">Formed from</h4>
        <div id="deptFormedRows"></div>
        <button type="button" class="link-btn" id="deptAddFormed">+ Add a department it was formed from</button>
        <h4 class="dept-succession-heading">On dissolution</h4>
        <div id="deptDissolvedRows"></div>
        <button type="button" class="link-btn" id="deptAddDissolved">+ Add a department it went to</button>
        <div class="field create-item-source">
          <label for="deptSuccessionSource">Source URL (recommended)</label>
          <input class="input" id="deptSuccessionSource" placeholder="https://… a page that confirms the change">
          <p class="create-item-hint">Cited on every statement added or changed, dates included.</p>
        </div>
      </section>
      <section class="edit-review" id="deptSuccessionReview" hidden aria-labelledby="deptSuccessionReviewTitle">
        <h3 class="edit-review-title" id="deptSuccessionReviewTitle">Review edit to Wikidata</h3>
        <div id="deptSuccessionReviewBody"></div>
        <div class="edit-review-actions">
          <button type="button" class="btn" id="deptSuccessionReviewCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="deptSuccessionPublish">Publish to Wikidata</button>
        </div>
      </section>
      <p class="status-line" id="departmentDialogStatus"></p>
      <div class="dialog-actions">
        <button type="button" class="btn" id="departmentDialogRefresh">Refresh from Wikidata</button>
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
const refreshBtn = document.getElementById('departmentDialogRefresh');

// After any search: the department may not be on Wikidata at all.
const createLine = createItemLine("Can't find it? Create a new Wikidata item for this department", () => {
  const q = searchInput.value.trim();
  openCreateItemDialog('department', { label: /^Q[1-9]\d*$/.test(q) ? '' : q, onDone: departmentCreated });
});
createLine.hidden = true;
resultsSelect.parentElement.after(createLine);

function departmentCreated({ qid, label, created }) {
  qidInput.value = qid;
  if (!labelInput.value.trim()) labelInput.value = label;
  if (!created) {
    loadProfile(qid, { fill: true });
    return;
  }
  // Wikidata's query service, which the profile comes from, won't have it for a few minutes.
  profileRequest++;
  profile = null;
  renderProfile(`Created ${qid} on Wikidata. Its details will show here once Wikidata's query service has it, in a few minutes. Save to add it to the page.`);
}

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
  profileRow(dl, 'Separated from', itemLinks(profile.separatedFrom ?? []));
  profileRow(dl, 'Replaced by', itemLinks(profile.replacedBy));
  profileRow(dl, 'Merged into', itemLinks(profile.mergedInto ?? []));
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
      createLine.hidden = false;
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
  resetSuccession(false);
  saveBtn.textContent = 'Save';
  refreshBtn.hidden = true;
  createLine.hidden = true;
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
  resetSuccession(QID_RE.test(qidInput.value));
  saveBtn.textContent = QID_RE.test(qidInput.value) ? 'Save to Wikidata' : 'Save';
  refreshBtn.hidden = !QID_RE.test(qidInput.value);
  refreshBtn.disabled = false;
  setStatus('');
  loadProfile(qidInput.value);
  backdrop.classList.add('open');
  labelInput.focus();
}

// Refetches the department from Wikidata, then reloads the view.
refreshBtn.addEventListener('click', async () => {
  if (mode !== 'edit' || !QID_RE.test(editQid || '')) return;
  refreshBtn.disabled = true;
  setStatus('Refreshing from Wikidata…');
  try {
    await refreshFromWikidata('department', editQid);
    close();
    await onSaveCallback();
  } catch (err) {
    refreshBtn.disabled = false;
    setStatus(err.status === 401 ? 'Log in with Wikimedia first.' : `Couldn't refresh: ${err.message}`, true);
  }
});

// A date field as Wikidata takes it; throws with the field's name if it can't be read.
function readDate(input, label) {
  const value = dateForWikidata(input.value);
  if (value === null) throw new Error(`Can't read "${input.value}" as the ${label} date. Use YYYY-MM-DD, YYYY-MM or YYYY.`);
  return value;
}

saveBtn.addEventListener('click', async () => {
  const label = labelInput.value.trim();
  if (!label) {
    setStatus('Name is required.', true);
    return;
  }
  // A department with a Wikidata item is edited there, after a preview; only one without an
  // item is kept as a local edit.
  if (mode === 'edit' && QID_RE.test(editQid || '')) {
    await previewDepartmentEdit();
    return;
  }
  const countryQid = state.countryQid || 'Q30';
  try {
    const inception = readDate(inceptionInput, 'inception');
    const dissolved = readDate(dissolvedInput, 'dissolved');
    if (mode === 'add') {
      const qid = qidInput.value.trim();
      await api('/api/departments', {
        method: 'POST',
        body: JSON.stringify({
          countryQid,
          qid: qid || undefined,
          label,
          wikipediaTitle: wpInput.value.trim(),
          inception: inception || undefined,
          dissolved: dissolved || undefined,
        }),
      });
      await onSaveCallback();
      if (QID_RE.test(qid)) {
        // On the page now; anything typed here that Wikidata doesn't have yet is saved there
        // next, after the usual preview.
        mode = 'edit';
        editQid = qid;
        titleEl.textContent = 'Edit department';
        addSection.style.display = 'none';
        qidInput.readOnly = true;
        saveBtn.textContent = 'Save to Wikidata';
        successionEl.hidden = false;
        await previewDepartmentEdit('Department added to the page. ');
        return;
      }
      setStatus('Department added.');
    } else {
      await api(`/api/departments/${editQid}`, {
        method: 'PUT',
        body: JSON.stringify({ label, wikipediaTitle: wpInput.value.trim(), inception: inception || null, dissolved: dissolved || null }),
      });
      setStatus('Department updated.');
      await onSaveCallback();
    }
    setTimeout(close, 400);
  } catch (err) {
    setStatus(err.status === 401 ? 'Log in with Wikimedia first.' : `Error: ${err.message}`, true);
  }
});

// ---------- Formation and dissolution: replaces / separated from / replaced by / merged into ----------

const successionEl = document.getElementById('deptSuccession');
const formedRows = document.getElementById('deptFormedRows');
const dissolvedRows = document.getElementById('deptDissolvedRows');
const successionSource = document.getElementById('deptSuccessionSource');
const successionReview = document.getElementById('deptSuccessionReview');
const successionReviewBody = document.getElementById('deptSuccessionReviewBody');
const successionPublish = document.getElementById('deptSuccessionPublish');
// Row readers, so a removed row is simply dropped from the list.
let formed = [];
let dissolved = [];
let pendingSuccession = null;

const RELATIONS = {
  formed: [['P1365', 'replaces (it ended)'], ['P807', 'separated from (it carried on)']],
  dissolved: [['P1366', 'replaced by'], ['P7888', 'merged into (it already existed)']],
};

function hideSuccessionReview() {
  successionReview.hidden = true;
  successionReviewBody.innerHTML = '';
  pendingSuccession = null;
}

function resetSuccession(show) {
  successionEl.hidden = !show;
  formedRows.innerHTML = '';
  dissolvedRows.innerHTML = '';
  formed = [];
  dissolved = [];
  successionSource.value = '';
  hideSuccessionReview();
}

// One department it came from or went to: which one, how, which part, and when. The date
// starts as the department's own inception or dissolution date.
function successionRow(kind) {
  const list = kind === 'formed' ? formed : dissolved;
  const row = document.createElement('div');
  row.className = 'succession-row';
  const dept = itemPicker('Search for the department', 'department');
  const relation = document.createElement('select');
  relation.className = 'input';
  relation.setAttribute('aria-label', 'How');
  for (const [value, text] of RELATIONS[kind]) relation.appendChild(Object.assign(document.createElement('option'), { value, textContent: text }));
  const part = itemPicker('Which part (optional)', 'part');
  const date = document.createElement('input');
  date.className = 'input';
  date.placeholder = 'YYYY-MM-DD';
  date.setAttribute('aria-label', 'Date');
  date.value = (kind === 'formed' ? inceptionInput : dissolvedInput).value.trim();
  dept.input.setAttribute('aria-label', 'Department');
  part.input.setAttribute('aria-label', 'Which part (applies to part)');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn';
  remove.textContent = 'Remove';
  const reader = () => {
    const qid = dept.value();
    if (!qid) return null;
    return { relation: relation.value, qid, partQid: part.value(), date: readDate(date, 'formation or dissolution') };
  };
  remove.addEventListener('click', () => {
    list.splice(list.indexOf(reader), 1);
    row.remove();
    hideSuccessionReview();
  });
  [dept.input, relation, part.input, date].forEach((el) => el.addEventListener('input', hideSuccessionReview));
  row.append(dept.element, relation, part.element, date, remove);
  list.push(reader);
  (kind === 'formed' ? formedRows : dissolvedRows).appendChild(row);
  dept.input.focus();
}

document.getElementById('deptAddFormed').addEventListener('click', () => successionRow('formed'));
document.getElementById('deptAddDissolved').addEventListener('click', () => successionRow('dissolved'));
document.getElementById('deptSuccessionReviewCancel').addEventListener('click', hideSuccessionReview);
// Publish sends what was previewed, so any change after the preview needs a new one.
[labelInput, wpInput, inceptionInput, dissolvedInput, successionSource].forEach((input) => input.addEventListener('input', hideSuccessionReview));

function departmentEditRequest() {
  return {
    departmentQid: editQid,
    label: labelInput.value.trim(),
    wikipediaTitle: wpInput.value.trim(),
    inception: readDate(inceptionInput, 'inception'),
    dissolved: readDate(dissolvedInput, 'dissolved'),
    formedFrom: formed.map((read) => read()).filter(Boolean),
    dissolvedInto: dissolved.map((read) => read()).filter(Boolean),
    sourceUrl: successionSource.value.trim(),
  };
}

function renderDepartmentReview({ plan, labels, propertyLabels, username, tags }, request) {
  successionReviewBody.innerHTML = '';
  const intro = document.createElement('p');
  intro.textContent = `As ${username}:`;
  successionReviewBody.appendChild(intro);
  const named = (qid) => `${labels[qid] ?? qid} (${qid})`;
  const sourced = plan.succession.sourceUrl ? ' — cited to the source URL' : '';
  plan.succession.sides.forEach((side) => {
    const list = document.createElement('ul');
    list.className = 'edit-review-changes';
    if (side.entityQid === plan.departmentQid) {
      plan.fields.forEach((f) => {
        const li = document.createElement('li');
        li.append(`${f.from ? 'Change' : 'Add'} ${f.label}: `);
        if (f.from) li.append(Object.assign(document.createElement('del'), { textContent: f.from }), ' → ');
        li.append(Object.assign(document.createElement('ins'), { textContent: f.to }));
        if (f.value) li.append(sourced);
        if (f.referencesDropped) li.append(` (its ${f.referencesDropped === 1 ? 'reference cites' : `${f.referencesDropped} references cite`} the old date, so ${f.referencesDropped === 1 ? 'it is' : 'they are'} removed)`);
        list.appendChild(li);
      });
    }
    side.statements.forEach((st) => {
      const li = document.createElement('li');
      li.append(st.existing ? 'Already on Wikidata, not added: ' : 'Add ');
      li.append(`${propertyLabels[st.property]} (${st.property}): `);
      const value = document.createElement(st.existing ? 'span' : 'ins');
      value.textContent = named(st.valueQid);
      li.appendChild(value);
      if (st.partQid) li.append(`; applies to part: ${named(st.partQid)}`);
      if (st.dateText && !st.existing) li.append(`; point in time: ${st.dateText}`);
      if (!st.existing) li.append(sourced);
      list.appendChild(li);
    });
    if (!list.children.length) return;
    const heading = document.createElement('p');
    heading.append('On ', link(wikidataUrl(side.entityQid), `${side.entityLabel} (${side.entityQid})`), ':');
    successionReviewBody.append(heading, list);
  });
  const nothing = plan.fields.length === 0 && !plan.succession.sides.some((s) => s.statements.some((st) => !st.existing));
  const note = document.createElement('p');
  note.className = 'edit-review-note';
  note.textContent = (nothing ? 'Wikidata already has all of this. Nothing to change. ' : '')
    + 'A blank field leaves Wikidata as it is. '
    + (plan.succession.sourceUrl ? '' : 'No source URL: new statements will be unsourced. ')
    + (tags ? `Tagged: ${tags}.` : 'No edit tag is configured.');
  successionReviewBody.appendChild(note);
  pendingSuccession = nothing ? null : {
    ...request,
    baseRevIds: Object.fromEntries(plan.succession.sides.map((s) => [s.entityQid, s.baseRevId])),
  };
  successionPublish.hidden = nothing;
  successionPublish.disabled = false;
  successionReview.hidden = false;
}

async function previewDepartmentEdit(prefix = '') {
  let request;
  try {
    request = departmentEditRequest();
  } catch (err) {
    setStatus(prefix + err.message, true);
    return;
  }
  setStatus(`${prefix}Checking Wikidata…`);
  try {
    const preview = await api('/api/wikidata/department/preview', { method: 'POST', body: JSON.stringify(request) });
    setStatus(prefix);
    renderDepartmentReview(preview, request);
  } catch (err) {
    setStatus(prefix + (err.status === 401 ? 'Log in with Wikimedia first.' : err.message), true);
  }
}

successionPublish.addEventListener('click', async () => {
  if (!pendingSuccession) return;
  successionPublish.disabled = true;
  setStatus('Publishing to Wikidata…');
  try {
    const { applied } = await api('/api/wikidata/department/save', { method: 'POST', body: JSON.stringify(pendingSuccession) });
    resetSuccession(true);
    statusEl.textContent = 'Saved to Wikidata. ';
    applied.forEach(({ entityQid, baseRevId, revid }) => {
      statusEl.append(link(`https://www.wikidata.org/w/index.php?title=${entityQid}&diff=${revid}&oldid=${baseRevId}`, `View the edit to ${entityQid}`), '. ');
    });
    statusEl.append("The page shows the new values now; the Wikidata panel catches up in a few minutes.");
    await onSaveCallback();
  } catch (err) {
    successionPublish.disabled = false;
    const partial = err.body?.revisions?.length ? ` ${err.body.revisions.length} edit(s) went through before this; check the items' history.` : '';
    setStatus((err.status === 401 ? 'Log in with Wikimedia first.' : err.message) + partial, true);
  }
});
