const US_QID = 'Q30';

// Day-granular timeline: the slider's integer value is a day offset from EPOCH, so it can
// represent any exact date (not just whole years) and its max always equals the real
// current date rather than a fixed year — otherwise "today" silently drifts stale the
// moment a government changes after whatever fixed cutoff was hardcoded.
const EPOCH = new Date(Date.UTC(1900, 0, 1));
const MS_PER_DAY = 86400000;
const dayIndexFor = (date) => Math.floor((date.getTime() - EPOCH.getTime()) / MS_PER_DAY);
const dateForDayIndex = (idx) => new Date(EPOCH.getTime() + idx * MS_PER_DAY);
const isoDate = (date) => date.toISOString().slice(0, 10);

const heroEl = document.getElementById('hero');
const gridEl = document.getElementById('deptGrid');
const hintEl = document.getElementById('hint');
const officeCountEl = document.getElementById('officeCount');
const slider = document.getElementById('yearSlider');
const dateInput = document.getElementById('dateInput');
const yearLabel = document.getElementById('yearLabel');
const loginToggle = document.getElementById('loginToggle');
const countrySelect = document.getElementById('countrySelect');
const debugToggle = document.getElementById('debugToggle');
const backdrop = document.getElementById('backdrop');
const linkBtn = document.getElementById('linkBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const addOfficeBackdrop = document.getElementById('addOfficeBackdrop');
const addOfficeStatus = document.getElementById('addOfficeStatus');
const newOfficeTitle = document.getElementById('new-office-title');
const newOfficeDept = document.getElementById('new-office-dept');
const newOfficeWp = document.getElementById('new-office-wp');

let debugMode = localStorage.getItem('wgt-debug') === 'true';
debugToggle.checked = debugMode;

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
// input with a read-only span showing whatever "Pull ... from Wikipedia" last fetched, plus
// the copy button that moves the Wikipedia value into the Wikidata input on demand. Nothing
// here auto-applies — pulling only populates the right-hand column, copying is a distinct,
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
let currentCountryQid = US_QID;
let entries = [];

function isViewingToday() {
  return Number(slider.value) === dayIndexFor(new Date());
}

// A currently-serving officeholder reads naturally as "Since <start>". Once we're looking at
// history (or the record itself has a known end date — e.g. a data gap right after a real
// transition), "Since" implies they're still in office, which is misleading — show the actual
// start/end range instead.
function tenureLabel(officeholder) {
  if (!officeholder?.startDate) return '';
  const start = officeholder.startDate.slice(0, 10);
  const end = officeholder.endDate ? officeholder.endDate.slice(0, 10) : null;
  if (isViewingToday() && !end) return `since ${start}`;
  return `${start} – ${end || 'present'}`;
}

// A handful of Wikidata items turn up with no label at all yet (e.g. a very recently
// appointed officeholder); the SPARQL label service then falls back to the bare QID,
// which reads as a bug if shown unexplained.
const QID_ONLY_RE = /^Q[1-9]\d*$/;
function displayName(raw) {
  if (!raw) return 'Unknown';
  if (QID_ONLY_RE.test(raw)) return `Unnamed officeholder (${raw})`;
  return raw;
}

// Debug mode: shows the raw Wikidata QID as small secondary text next to whatever entity
// it belongs to (office, officeholder, deputy), so mismatches between what's displayed and
// what Wikidata actually has can be spot-checked directly, without opening the edit dialog.
function qidTag(qid) {
  if (!debugMode || !qid) return null;
  const span = document.createElement('span');
  span.className = 'qid-debug';
  span.textContent = `(${qid})`;
  return span;
}

function isHeroEntry(entry) {
  if (currentCountryQid === US_QID) return entry.position.id === 'president' || entry.position.id === 'vp';
  return entry.position.bucket === 'Head of State' || entry.position.bucket === 'Head of Government';
}

function ordinalSuffix(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  if (rem10 === 1) return `${n}st`;
  if (rem10 === 2) return `${n}nd`;
  if (rem10 === 3) return `${n}rd`;
  return `${n}th`;
}

// Built from whatever the org chart actually returned for this date/country — no hardcoded
// per-country administration names. Prefers the head of government (the US, having no
// separate head-of-government bucket, falls back to its 'president' entry); term ordinal
// comes from real Wikidata history, so a repeat, non-consecutive term is only ever called
// out when the data actually shows one.
function cabinetLabelFor(currentEntries) {
  const head = currentCountryQid === US_QID
    ? currentEntries.find((e) => e.position.id === 'president')
    : currentEntries.find((e) => e.position.bucket === 'Head of Government')
      ?? currentEntries.find((e) => e.position.bucket === 'Head of State');
  const holder = head?.officeholder;
  if (!holder?.personName || QID_ONLY_RE.test(holder.personName)) return '';
  const lastName = holder.personName.trim().split(/\s+/).slice(-1)[0];
  const ordinal = holder.termOrdinal || 1;
  return ordinal > 1 ? `${lastName} Cabinet (${ordinalSuffix(ordinal)} term)` : `${lastName} Cabinet`;
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Junior/deputy offices (Wikidata P2098) are nested under their senior office rather than
// shown as their own top-level cards — this renders them as a compact dropdown instead of
// separate cards, so e.g. the Vice President doesn't compete with the President for focus.
function deputiesDropdown(deputies) {
  if (!deputies || deputies.length === 0) return null;
  const wrap = document.createElement('div');
  wrap.className = 'deputies';
  const label = document.createElement('div');
  label.className = 'deputies-label';
  label.textContent = deputies.length === 1 ? 'Deputy' : `Deputies (${deputies.length})`;
  const select = document.createElement('select');
  select.className = 'input deputy-select';
  select.setAttribute('aria-label', label.textContent);
  deputies.forEach((dep) => {
    const opt = document.createElement('option');
    const qidSuffix = debugMode
      ? ` [${dep.position.wikidataQid || '?'} / ${dep.officeholder?.personWikidataQid || '?'}]`
      : '';
    opt.textContent = `${dep.position.title}: ${displayName(dep.officeholder?.personName)}${qidSuffix}`;
    select.appendChild(opt);
  });
  select.addEventListener('click', (e) => e.stopPropagation());
  wrap.append(label, select);
  return wrap;
}

// Wikidata P18 ("image") arrives as a ready-to-use Commons Special:FilePath URL — append
// `?width=<n>` directly for a sized thumbnail (no filename parsing needed). Falls back to the
// officeholder's initials when there's no image, or if the image URL fails to load.
function initialsFor(name) {
  if (!name || QID_ONLY_RE.test(name)) return '';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function officeholderImageEl(officeholder, width, className) {
  const placeholder = () => {
    const el = document.createElement('div');
    el.className = className;
    el.setAttribute('aria-hidden', 'true');
    el.textContent = initialsFor(officeholder?.personName);
    return el;
  };
  if (!officeholder?.imageUrl) return placeholder();
  const img = document.createElement('img');
  img.className = className;
  img.src = `${officeholder.imageUrl}?width=${width}`;
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('error', () => img.replaceWith(placeholder()), { once: true });
  return img;
}

// "Keir Starmer, since 2024-07-05" — name and tenure as one line, tenure muted.
function holderLine(className, officeholder) {
  const line = document.createElement('p');
  line.className = className;
  if (!officeholder?.personName) {
    line.classList.add('office-empty');
    line.textContent = 'No officeholder recorded for this date';
    return line;
  }
  line.append(document.createTextNode(displayName(officeholder.personName)));
  const holderQidTag = qidTag(officeholder.personWikidataQid);
  if (holderQidTag) line.appendChild(holderQidTag);
  const tenure = document.createElement('span');
  tenure.className = 'tenure';
  tenure.textContent = tenureLabel(officeholder);
  line.appendChild(tenure);
  return line;
}

// Office-first: the position title is the prominent heading, the officeholder is
// secondary/supporting detail — the org chart's subject is the office, not the person.
function leadCard(entry, fallbackTitle) {
  const card = document.createElement('article');
  card.className = 'lead';
  const photo = officeholderImageEl(entry?.officeholder, 200, 'portrait');
  const text = document.createElement('div');
  const officeEl = document.createElement('h2');
  officeEl.className = 'lead-office';
  officeEl.append(document.createTextNode(entry?.position.title || fallbackTitle));
  const officeQidTag = qidTag(entry?.position.wikidataQid);
  if (officeQidTag) officeEl.appendChild(officeQidTag);
  text.append(officeEl, holderLine('lead-holder', entry?.officeholder));
  const dd = deputiesDropdown(entry?.deputies);
  if (dd) text.appendChild(dd);
  card.append(photo, text);
  return card;
}

function renderHero(currentEntries) {
  heroEl.innerHTML = '';
  if (currentCountryQid === US_QID) {
    heroEl.append(leadCard(currentEntries.find((e) => e.position.id === 'president'), 'President'));
  } else {
    heroEl.append(
      leadCard(currentEntries.find((e) => e.position.bucket === 'Head of State'), 'Head of State'),
      leadCard(currentEntries.find((e) => e.position.bucket === 'Head of Government'), 'Head of Government'),
    );
  }
}

function officeRow(entry) {
  const { position, officeholder } = entry;
  const row = document.createElement('li');
  row.className = 'office';

  const title = document.createElement('h3');
  title.className = 'office-title';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'office-open';
  open.textContent = position.title;
  open.addEventListener('click', () => openDialog(entry));
  title.appendChild(open);
  const officeQidTag = qidTag(position.wikidataQid);
  if (officeQidTag) title.appendChild(officeQidTag);

  const linkState = document.createElement('span');
  linkState.className = position.wikidataQid ? 'link-state' : 'link-state unlinked';
  linkState.textContent = position.wikidataQid ? 'On Wikidata' : 'Not on Wikidata';

  const dept = document.createElement('p');
  dept.className = 'office-dept';
  dept.textContent = position.department;

  row.append(officeholderImageEl(officeholder, 96, 'portrait portrait-sm'), title, linkState, dept, holderLine('office-holder', officeholder));
  const dd = deputiesDropdown(entry.deputies);
  if (dd) row.appendChild(dd);
  return row;
}

function renderGrid(currentEntries) {
  gridEl.innerHTML = '';
  const offices = currentEntries.filter((e) => !isHeroEntry(e));
  officeCountEl.textContent = offices.length ? String(offices.length) : '';
  if (offices.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No offices found on Wikidata for this date. Try a later date, or add an office that is missing.';
    gridEl.appendChild(empty);
    return;
  }
  offices.forEach((entry) => gridEl.appendChild(officeRow(entry)));
}

function updateTimelineLabel() {
  yearLabel.textContent = cabinetLabelFor(entries);
  yearLabel.classList.remove('stale');
}

async function loadOrgChart(date, countryQid) {
  currentCountryQid = countryQid;
  hintEl.textContent = '';
  hintEl.className = 'status-line';
  loadingOverlay.classList.add('active');
  try {
    const data = await api(`/api/orgchart?date=${date}&country=${countryQid}`);
    entries = data.entries;
    renderHero(entries);
    renderGrid(entries);
    updateTimelineLabel();
    hintEl.textContent = 'Select an office to compare its Wikidata and Wikipedia data.';
  } catch (err) {
    hintEl.textContent = `Couldn't load offices: ${err.message}. Try again, or pick another date.`;
    hintEl.className = 'status-line error';
  } finally {
    loadingOverlay.classList.remove('active');
  }
}

function currentDateParam() {
  return isoDate(dateForDayIndex(Number(slider.value)));
}

function initTimeline() {
  const todayIdx = dayIndexFor(new Date());
  slider.min = '0';
  slider.max = String(todayIdx);
  slider.value = String(todayIdx);
  dateInput.min = isoDate(EPOCH);
  dateInput.max = isoDate(new Date());
  dateInput.value = currentDateParam();
  yearLabel.textContent = '';
}

slider.addEventListener('input', (e) => {
  // Live-drag only updates the date — the cabinet name needs a fresh fetch, which happens
  // on 'change' (drag release) via updateTimelineLabel().
  const idx = Number(e.target.value);
  yearLabel.classList.add('stale');
  dateInput.value = isoDate(dateForDayIndex(idx));
});
slider.addEventListener('change', () => {
  loadOrgChart(currentDateParam(), currentCountryQid);
});

dateInput.addEventListener('change', () => {
  if (!dateInput.value) return;
  const idx = dayIndexFor(new Date(`${dateInput.value}T00:00:00Z`));
  const clamped = Math.min(Math.max(idx, Number(slider.min)), Number(slider.max));
  slider.value = String(clamped);
  yearLabel.classList.add('stale');
  loadOrgChart(currentDateParam(), currentCountryQid);
});

countrySelect.addEventListener('change', () => {
  yearLabel.classList.add('stale');
  loadOrgChart(currentDateParam(), countrySelect.value);
});

async function populateCountries() {
  try {
    const { countries } = await api('/api/countries');
    countrySelect.innerHTML = '';
    for (const c of countries) {
      const opt = document.createElement('option');
      opt.value = c.qid;
      opt.textContent = c.label;
      countrySelect.appendChild(opt);
    }
    countrySelect.value = US_QID;
  } catch (err) {
    hintEl.textContent = `Couldn't load the country list: ${err.message}`;
    hintEl.className = 'status-line error';
  }
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

async function openDialog(entry) {
  const { position, officeholder } = entry;
  currentPositionId = position.id;
  dialogTitle.textContent = position.title;
  dialogStatus.textContent = '';
  dialogStatus.className = 'status-line';
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

  if (officeholder?.personWikidataQid) {
    try {
      const { entity } = await api(`/api/wikidata/entity/${officeholder.personWikidataQid}`);
      const sitelink = entity?.sitelinks?.enwiki?.title;
      if (sitelink) dialogFields.wp.value = sitelink;
    } catch {
      // Non-fatal: keep the guessed sitelink title.
    }
  }
}

function closeDialog() {
  backdrop.classList.remove('open');
  currentPositionId = null;
}

document.getElementById('cancelBtn').addEventListener('click', closeDialog);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (addOfficeBackdrop.classList.contains('open')) closeAddOfficeDialog();
  else if (backdrop.classList.contains('open')) closeDialog();
});
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeDialog(); });

function openAddOfficeDialog() {
  newOfficeTitle.value = '';
  newOfficeDept.value = '';
  newOfficeWp.value = '';
  addOfficeStatus.textContent = '';
  addOfficeStatus.className = 'status-line';
  addOfficeBackdrop.classList.add('open');
  newOfficeTitle.focus();
}

function closeAddOfficeDialog() {
  addOfficeBackdrop.classList.remove('open');
}

document.getElementById('addOfficeBtn').addEventListener('click', openAddOfficeDialog);
document.getElementById('addOfficeCancelBtn').addEventListener('click', closeAddOfficeDialog);
addOfficeBackdrop.addEventListener('click', (e) => { if (e.target === addOfficeBackdrop) closeAddOfficeDialog(); });

document.getElementById('addOfficeSubmitBtn').addEventListener('click', async () => {
  const title = newOfficeTitle.value.trim();
  if (!title) {
    addOfficeStatus.textContent = 'Office title is required.';
    addOfficeStatus.className = 'status-line error';
    return;
  }
  try {
    await api('/api/positions', {
      method: 'POST',
      body: JSON.stringify({
        countryQid: currentCountryQid,
        title,
        department: newOfficeDept.value.trim(),
        wikipediaTitle: newOfficeWp.value.trim(),
      }),
    });
    closeAddOfficeDialog();
    await loadOrgChart(currentDateParam(), currentCountryQid);
  } catch (err) {
    addOfficeStatus.textContent = err.status === 401 ? 'Log in with Wikimedia first.' : `Couldn't add the office: ${err.message}`;
    addOfficeStatus.className = 'status-line error';
  }
});

// A Wikidata-side value counts as "empty" for comparison purposes even when it's holding one
// of our own placeholder strings ("Unknown", "Still exists", "Incumbent") rather than blank.
const EMPTY_PLACEHOLDERS = new Set(['', 'unknown', 'still exists', 'incumbent']);
function fillCompareCell(key, wikipediaValue) {
  const cell = compareCells[key];
  cell.wiki.textContent = wikipediaValue || '—';
  cell.btn.disabled = !wikipediaValue;
  if (!wikipediaValue) {
    cell.wiki.classList.remove('mismatch');
    return;
  }
  const wikidataNorm = cell.input.value.trim().toLowerCase();
  const differs = EMPTY_PLACEHOLDERS.has(wikidataNorm) || wikidataNorm !== wikipediaValue.trim().toLowerCase();
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

document.getElementById('pullBtn').addEventListener('click', async () => {
  const title = dialogFields.wp.value.trim();
  if (!title) {
    dialogStatus.textContent = "Enter the officeholder's Wikipedia article first.";
    dialogStatus.className = 'status-line error';
    return;
  }
  dialogStatus.textContent = `Reading the infobox on "${title}"…`;
  dialogStatus.className = 'status-line';
  try {
    const { fields } = await api(`/api/wikipedia/infobox?title=${encodeURIComponent(title)}`);
    fillCompareCell('name', fields.name || '');
    fillCompareCell('party', fields.party || '');
    fillCompareCell('start', fields.term_start || '');
    fillCompareCell('end', fields.term_end || '');
    dialogStatus.textContent = `Compared with "${title}". Fields marked ≠ differ; use ← to copy a Wikipedia value across.`;
    dialogStatus.className = 'status-line';
  } catch (err) {
    dialogStatus.textContent = `Couldn't read "${title}": ${err.message}`;
    dialogStatus.className = 'status-line error';
  }
});

// Pulls the OFFICE's own Wikipedia infobox (Infobox official/political post) into the
// Wikipedia-side comparison column — deliberately never auto-applied to the Wikidata-side
// inputs, since the point is to surface disagreements between the two sources (mismatch
// highlighting) and let the user decide, per field, whether to copy Wikipedia's value across.
pullOfficeBtn.addEventListener('click', async () => {
  const title = dialogFields.officewp.value.trim();
  if (!title) {
    dialogStatus.textContent = "Enter the office's Wikipedia article first.";
    dialogStatus.className = 'status-line error';
    return;
  }
  dialogStatus.textContent = `Reading the infobox on "${title}"…`;
  dialogStatus.className = 'status-line';
  try {
    const { fields } = await api(`/api/wikipedia/office-infobox?title=${encodeURIComponent(title)}`);
    fillCompareCell('dept', fields.department || fields.body || '');
    fillCompareCell('inception', fields.formation || '');
    fillCompareCell('dissolved', fields.abolished || '');
    dialogStatus.textContent = `Compared with "${title}". Fields marked ≠ differ; use ← to copy a Wikipedia value across.`;
    dialogStatus.className = 'status-line';
  } catch (err) {
    dialogStatus.textContent = `Couldn't read "${title}": ${err.message}`;
    dialogStatus.className = 'status-line error';
  }
});

linkBtn.addEventListener('click', async () => {
  if (!currentPositionId) return;
  try {
    await api(`/api/positions/${currentPositionId}/link`, {
      method: 'PUT',
      body: JSON.stringify({ wikidataQid: dialogFields.qid.value.trim(), wikipediaTitle: dialogFields.officewp.value.trim() }),
    });
    dialogStatus.textContent = 'Link saved locally.';
    dialogStatus.className = 'status-line';
    await loadOrgChart(currentDateParam(), currentCountryQid);
  } catch (err) {
    dialogStatus.textContent = err.status === 401 ? 'Log in with Wikimedia first.' : `Couldn't save the link: ${err.message}`;
    dialogStatus.className = 'status-line error';
  }
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  try {
    await api('/api/wikidata/save', { method: 'POST', body: JSON.stringify({}) });
  } catch (err) {
    dialogStatus.textContent = err.status === 401 ? 'Log in with Wikimedia first.' : (err.body?.detail || err.message);
    dialogStatus.className = 'status-line error';
  }
});

async function refreshLoginState() {
  try {
    const { user } = await api('/api/auth/me');
    loginToggle.textContent = `Log out (${user.username})`;
    loginToggle.dataset.loggedIn = 'true';
  } catch {
    loginToggle.textContent = 'Log in with Wikimedia';
    loginToggle.dataset.loggedIn = 'false';
  }
}

loginToggle.addEventListener('click', async () => {
  if (loginToggle.dataset.loggedIn === 'true') {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  } else {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
  }
  await refreshLoginState();
});

debugToggle.addEventListener('change', () => {
  debugMode = debugToggle.checked;
  localStorage.setItem('wgt-debug', String(debugMode));
  renderHero(entries);
  renderGrid(entries);
});

initTimeline();
refreshLoginState();
populateCountries().then(() => loadOrgChart(currentDateParam(), US_QID));
