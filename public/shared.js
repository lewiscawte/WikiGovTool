// Shared by the Departments and Offices pages: API access, formatting, portrait/lead rendering,
// and the masthead controls (country, date, timeline, QID toggle, login).

export const US_QID = 'Q30';

// Day-granular timeline: the slider's integer value is a day offset from EPOCH, so it can
// represent any exact date (not just whole years) and its max always equals the real
// current date rather than a fixed year — otherwise "today" silently drifts stale the
// moment a government changes after whatever fixed cutoff was hardcoded.
const EPOCH = new Date(Date.UTC(1900, 0, 1));
const MS_PER_DAY = 86400000;
const dayIndexFor = (date) => Math.floor((date.getTime() - EPOCH.getTime()) / MS_PER_DAY);
const dateForDayIndex = (idx) => new Date(EPOCH.getTime() + idx * MS_PER_DAY);
const isoDate = (date) => date.toISOString().slice(0, 10);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const QID_ONLY_RE = /^Q[1-9]\d*$/;

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode etc. — not essential */ }
}

export const state = {
  debugMode: readStorage('wgt-debug') === 'true',
  countryQid: US_QID,
};

const slider = document.getElementById('yearSlider');

export async function api(path, opts) {
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

const REPO_URL = 'https://github.com/lewiscawte/WikiGovTool';

// The deployed commit in the footer, linked to GitHub, so a bug report can say which build.
async function showVersion() {
  const el = document.getElementById('versionInfo');
  if (!el) return;
  try {
    const { commit, dirty } = await api('/api/version');
    if (!commit) return;
    const link = document.createElement('a');
    link.href = `${REPO_URL}/commit/${commit}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = commit;
    el.append(link);
    if (dirty) el.append(' (with uncommitted changes)');
  } catch { /* not worth surfacing */ }
}
showVersion();

function isViewingToday() {
  return Number(slider.value) === dayIndexFor(new Date());
}

export function currentDateParam() {
  return isoDate(dateForDayIndex(Number(slider.value)));
}

// A currently-serving officeholder reads naturally as "since <start>". Once we're looking at
// history (or the record itself has a known end date — e.g. a data gap right after a real
// transition), "since" implies they're still in office, which is misleading — show the actual
// start/end range instead.
export function tenureLabel(officeholder) {
  if (!officeholder?.startDate) return '';
  const start = officeholder.startDate.slice(0, 10);
  const end = officeholder.endDate ? officeholder.endDate.slice(0, 10) : null;
  if (isViewingToday() && !end) return `since ${start}`;
  return `${start} – ${end || 'present'}`;
}

// A handful of Wikidata items turn up with no label at all yet (e.g. a very recently
// created office or appointed officeholder); the SPARQL label service then falls back to the
// bare QID, which reads as a bug if shown unexplained.
export function displayName(raw) {
  if (!raw) return 'Unknown';
  if (QID_ONLY_RE.test(raw)) return `Unnamed officeholder (${raw})`;
  return raw;
}
export function officeTitle(raw) {
  if (QID_ONLY_RE.test(raw)) return `Unnamed office (${raw})`;
  return raw;
}

// Debug mode: shows the raw Wikidata QID as small secondary text next to whatever entity
// it belongs to, so mismatches between what's displayed and what Wikidata actually has can
// be spot-checked directly, without opening the edit dialog.
export function qidTag(qid) {
  if (!state.debugMode || !qid) return null;
  const span = document.createElement('span');
  span.className = 'qid-debug';
  span.textContent = `(${qid})`;
  return span;
}

function initialsFor(name) {
  if (!name || QID_ONLY_RE.test(name)) return '';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Wikidata P18 ("image") arrives as a ready-to-use Commons Special:FilePath URL — append
// `?width=<n>` directly for a sized thumbnail (no filename parsing needed). Falls back to the
// officeholder's initials when there's no image, or if the image URL fails to load.
export function officeholderImageEl(officeholder, width, className) {
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
// `onAdd`, if given, puts an "Add officeholder" button on an empty line.
export function holderLine(className, officeholder, onAdd) {
  const line = document.createElement('p');
  line.className = className;
  if (!officeholder?.personName) {
    line.classList.add('office-empty');
    line.textContent = 'No officeholder recorded for this date';
    if (onAdd) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'add-holder';
      add.textContent = 'Add officeholder';
      add.addEventListener('click', onAdd);
      line.appendChild(add);
    }
    return line;
  }
  line.append(document.createTextNode(displayName(officeholder.personName)));
  const holderQidTag = qidTag(officeholder.personWikidataQid);
  if (holderQidTag) line.appendChild(holderQidTag);
  const tenure = document.createElement('span');
  tenure.className = 'tenure';
  tenure.textContent = tenureLabel(officeholder);
  line.appendChild(tenure);
  if (officeholder.local) {
    const local = document.createElement('span');
    local.className = 'holder-local';
    local.textContent = 'Added locally, not on Wikidata';
    line.appendChild(local);
  }
  return line;
}

// A button that opens an office's comparison dialog; the row it sits in becomes clickable
// via .office-open::after, so it must sit inside a positioned container.
export function officeButton(entry, onOpen) {
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'office-open';
  open.textContent = officeTitle(entry.position.title);
  open.addEventListener('click', () => onOpen(entry));
  return open;
}

// Junior/deputy offices (Wikidata P2098) are nested under their senior office rather than
// shown as their own entries — this renders them as a compact dropdown, so e.g. the Vice
// President doesn't compete with the President for focus.
export function deputiesDropdown(deputies) {
  if (!deputies || deputies.length === 0) return null;
  const wrap = document.createElement('div');
  wrap.className = 'deputies';
  const label = document.createElement('div');
  label.textContent = deputies.length === 1 ? 'Deputy' : `Deputies (${deputies.length})`;
  const select = document.createElement('select');
  select.className = 'input deputy-select';
  select.setAttribute('aria-label', label.textContent);
  deputies.forEach((dep) => {
    const opt = document.createElement('option');
    const qidSuffix = state.debugMode
      ? ` [${dep.position.wikidataQid || '?'} / ${dep.officeholder?.personWikidataQid || '?'}]`
      : '';
    opt.textContent = `${officeTitle(dep.position.title)}: ${displayName(dep.officeholder?.personName)}${qidSuffix}`;
    select.appendChild(opt);
  });
  select.addEventListener('click', (e) => e.stopPropagation());
  wrap.append(label, select);
  return wrap;
}

// Office-first: the position title is the prominent heading, the officeholder is
// supporting detail.
export function leadCard(entry, fallbackTitle, onOpen, onAddHolder) {
  const card = document.createElement('article');
  card.className = 'lead';
  const photo = officeholderImageEl(entry?.officeholder, 200, 'portrait');
  const text = document.createElement('div');
  const officeEl = document.createElement('h2');
  officeEl.className = 'lead-office';
  if (entry && onOpen) officeEl.appendChild(officeButton(entry, onOpen));
  else officeEl.append(document.createTextNode(entry?.position.title || fallbackTitle));
  const officeQidTag = qidTag(entry?.position.wikidataQid);
  if (officeQidTag) officeEl.appendChild(officeQidTag);
  const onAdd = entry && onAddHolder ? () => onAddHolder(entry) : null;
  text.append(officeEl, holderLine('lead-holder', entry?.officeholder, onAdd));
  const dd = deputiesDropdown(entry?.deputies);
  if (dd) text.appendChild(dd);
  card.append(photo, text);
  return card;
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

// "Starmer Cabinet", "Trump Cabinet (2nd term)" — from whichever entry leads the government.
// Term ordinal comes from real Wikidata history, so a repeat, non-consecutive term is only
// ever called out when the data actually shows one.
export function cabinetLabelFor(headEntry) {
  const holder = headEntry?.officeholder;
  if (!holder?.personName || QID_ONLY_RE.test(holder.personName)) return '';
  const lastName = holder.personName.trim().split(/\s+/).slice(-1)[0];
  const ordinal = holder.termOrdinal || 1;
  return ordinal > 1 ? `${lastName} Cabinet (${ordinalSuffix(ordinal)} term)` : `${lastName} Cabinet`;
}

// Wires the masthead. `load(date, countryQid)` is called on first load and whenever the
// country or date changes; `rerender()` when only presentation changes (QID toggle).
// Country and date are mirrored into the URL so switching pages or reloading keeps your place.
export function initMasthead({ load, rerender }) {
  const dateInput = document.getElementById('dateInput');
  const cabinetEl = document.getElementById('yearLabel');
  const countrySelect = document.getElementById('countrySelect');
  const debugToggle = document.getElementById('debugToggle');
  const loginToggle = document.getElementById('loginToggle');
  const viewLinks = document.querySelectorAll('[data-view-link]');

  const params = new URLSearchParams(location.search);
  if (QID_ONLY_RE.test(params.get('country') || '')) state.countryQid = params.get('country');

  const todayIdx = dayIndexFor(new Date());
  slider.min = '0';
  slider.max = String(todayIdx);
  const requested = params.get('date');
  const startIdx = requested && ISO_DATE_RE.test(requested) ? dayIndexFor(new Date(`${requested}T00:00:00Z`)) : todayIdx;
  slider.value = String(Math.min(Math.max(startIdx, 0), todayIdx));
  dateInput.min = isoDate(EPOCH);
  dateInput.max = isoDate(new Date());
  dateInput.value = currentDateParam();

  function syncUrl() {
    const query = new URLSearchParams({ country: state.countryQid });
    if (!isViewingToday()) query.set('date', currentDateParam());
    history.replaceState(null, '', `${location.pathname}?${query}`);
    viewLinks.forEach((a) => { a.href = `${a.dataset.viewLink}?${query}`; });
  }

  function reload() {
    cabinetEl.classList.add('stale');
    syncUrl();
    load(currentDateParam(), state.countryQid);
  }

  slider.addEventListener('input', () => {
    // Live-drag only updates the date; the fetch happens on 'change' (drag release).
    cabinetEl.classList.add('stale');
    dateInput.value = currentDateParam();
  });
  slider.addEventListener('change', reload);

  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const idx = dayIndexFor(new Date(`${dateInput.value}T00:00:00Z`));
    slider.value = String(Math.min(Math.max(idx, Number(slider.min)), Number(slider.max)));
    reload();
  });

  countrySelect.addEventListener('change', () => {
    state.countryQid = countrySelect.value;
    reload();
  });

  debugToggle.checked = state.debugMode;
  debugToggle.addEventListener('change', () => {
    state.debugMode = debugToggle.checked;
    writeStorage('wgt-debug', String(state.debugMode));
    rerender();
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
      await refreshLoginState();
      return;
    }
    window.location.href = '/api/auth/login';
  });

  async function populateCountries() {
    const { countries } = await api('/api/countries');
    countrySelect.innerHTML = '';
    for (const c of countries) {
      const opt = document.createElement('option');
      opt.value = c.qid;
      opt.textContent = c.label;
      countrySelect.appendChild(opt);
    }
    if (!countries.some((c) => c.qid === state.countryQid)) state.countryQid = US_QID;
    countrySelect.value = state.countryQid;
  }

  refreshLoginState();
  syncUrl();
  const ready = populateCountries().then(() => load(currentDateParam(), state.countryQid));

  return {
    ready,
    setCabinetLabel(text) {
      cabinetEl.textContent = text;
      cabinetEl.classList.remove('stale');
    },
  };
}
