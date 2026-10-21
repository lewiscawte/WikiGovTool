// Offices page: every cabinet-level office as a flat list.
import {
  api, cabinetLabelFor, deputiesDropdown, holderLine, initMasthead, leadCard, officeButton,
  officeholderImageEl, qidTag, state, US_QID,
} from './shared.js';
import { openAddOfficeDialog, openOfficeDialog } from './officeDialog.js';

const heroEl = document.getElementById('hero');
const gridEl = document.getElementById('deptGrid');
const hintEl = document.getElementById('hint');
const officeCountEl = document.getElementById('officeCount');
const loadingOverlay = document.getElementById('loadingOverlay');

let entries = [];

const isLeader = (e) => (state.countryQid === US_QID
  ? e.position.id === 'president' || e.position.id === 'vp'
  : e.position.bucket === 'Head of State' || e.position.bucket === 'Head of Government');

function headOfGovernment(currentEntries) {
  return state.countryQid === US_QID
    ? currentEntries.find((e) => e.position.id === 'president')
    : currentEntries.find((e) => e.position.bucket === 'Head of Government')
      ?? currentEntries.find((e) => e.position.bucket === 'Head of State');
}

const open = (entry) => openOfficeDialog(entry, { onChange: reload });

function renderHero(currentEntries) {
  heroEl.innerHTML = '';
  if (state.countryQid === US_QID) {
    heroEl.append(leadCard(currentEntries.find((e) => e.position.id === 'president'), 'President', open));
  } else {
    heroEl.append(
      leadCard(currentEntries.find((e) => e.position.bucket === 'Head of State'), 'Head of State', open),
      leadCard(currentEntries.find((e) => e.position.bucket === 'Head of Government'), 'Head of Government', open),
    );
  }
}

function officeRow(entry) {
  const { position, officeholder } = entry;
  const row = document.createElement('li');
  row.className = 'office';

  const title = document.createElement('h3');
  title.className = 'office-title';
  title.appendChild(officeButton(entry, open));
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
  const offices = currentEntries.filter((e) => !isLeader(e));
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

function render() {
  renderHero(entries);
  renderGrid(entries);
}

async function loadOrgChart(date, countryQid) {
  hintEl.textContent = '';
  hintEl.className = 'status-line';
  loadingOverlay.classList.add('active');
  try {
    const data = await api(`/api/orgchart?date=${date}&country=${countryQid}`);
    entries = data.entries;
    render();
    masthead.setCabinetLabel(cabinetLabelFor(headOfGovernment(entries)));
    hintEl.textContent = 'Select an office to compare its Wikidata and Wikipedia data.';
  } catch (err) {
    hintEl.textContent = `Couldn't load offices: ${err.message}. Try again, or pick another date.`;
    hintEl.className = 'status-line error';
  } finally {
    loadingOverlay.classList.remove('active');
  }
}

let lastLoad = null;
function reload() {
  return lastLoad ? loadOrgChart(...lastLoad) : undefined;
}

const masthead = initMasthead({
  load: (date, countryQid) => {
    lastLoad = [date, countryQid];
    return loadOrgChart(date, countryQid);
  },
  rerender: render,
});
masthead.ready.catch((err) => {
  hintEl.textContent = `Couldn't load the country list: ${err.message}`;
  hintEl.className = 'status-line error';
});

document.getElementById('addOfficeBtn').addEventListener('click', () => openAddOfficeDialog({ onChange: reload }));
