// Departments page: the government grouped by department/ministry, each card showing the
// office that runs it and the other offices within it.
import {
  api, cabinetLabelFor, holderLine, initMasthead, leadCard, officeButton, officeholderImageEl, qidTag,
} from './shared.js';
import { openOfficeDialog } from './officeDialog.js';
import { openAddDepartmentDialog, openEditDepartmentDialog } from './departmentDialog.js';

const leadersEl = document.getElementById('leaders');
const gridEl = document.getElementById('departmentGrid');
const hintEl = document.getElementById('hint');
const countEl = document.getElementById('departmentCount');
const loadingOverlay = document.getElementById('loadingOverlay');
const unassignedSection = document.getElementById('unassignedSection');
const unassignedList = document.getElementById('unassignedList');
const unassignedCount = document.getElementById('unassignedCount');
const emptySection = document.getElementById('emptySection');
const emptyList = document.getElementById('emptyList');
const emptyCount = document.getElementById('emptyCount');
const addDepartmentBtn = document.getElementById('addDepartmentBtn');

let view = null;
let lastLoad = null;
let currentCountryQid = null;

const open = (entry) => openOfficeDialog(entry, { onChange: reload });
const year = (iso) => (iso ? iso.slice(0, 4) : null);

function lifespanText(dept) {
  const from = year(dept.inception);
  const to = year(dept.dissolved);
  if (from && to) return `${from}–${to}`;
  if (from) return `Established ${from}`;
  if (to) return `Abolished ${to}`;
  return '';
}

function headBlock(entry) {
  const block = document.createElement('div');
  block.className = 'department-head-office';
  const text = document.createElement('div');
  const title = document.createElement('h4');
  title.className = 'department-head-title';
  title.appendChild(officeButton(entry, open));
  const officeQid = qidTag(entry.position.wikidataQid);
  if (officeQid) title.appendChild(officeQid);
  text.append(title, holderLine('department-head-holder', entry.officeholder));
  block.append(officeholderImageEl(entry.officeholder, 112, 'portrait portrait-md'), text);
  return block;
}

function officeItem(entry) {
  const item = document.createElement('li');
  item.className = 'department-office';
  const title = document.createElement('p');
  title.className = 'department-office-title';
  title.appendChild(officeButton(entry, open));
  const officeQid = qidTag(entry.position.wikidataQid);
  if (officeQid) title.appendChild(officeQid);
  item.append(title, holderLine('department-office-holder', entry.officeholder));
  return item;
}

function departmentCard(dept) {
  const card = document.createElement('article');
  card.className = 'department';

  const header = document.createElement('header');
  const name = document.createElement('h3');
  name.className = 'department-name';
  if (dept.wikipediaTitle) {
    const link = document.createElement('a');
    link.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(dept.wikipediaTitle.replace(/ /g, '_'))}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = dept.label;
    name.appendChild(link);
  } else {
    name.textContent = dept.label;
  }
  const deptQid = qidTag(dept.qid);
  if (deptQid) name.appendChild(deptQid);
  
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openEditDepartmentDialog(dept, { onSave: reload });
  });
  header.appendChild(name);
  header.appendChild(editBtn);
  const meta = lifespanText(dept);
  if (meta) {
    const metaEl = document.createElement('p');
    metaEl.className = 'department-meta';
    metaEl.textContent = meta;
    header.appendChild(metaEl);
  }
  card.appendChild(header);

  if (dept.heads.length) {
    dept.heads.forEach((h) => card.appendChild(headBlock(h)));
  } else {
    const gap = document.createElement('p');
    gap.className = 'department-gap';
    gap.textContent = 'No office running this department is recorded on Wikidata for this date.';
    card.appendChild(gap);
  }

  if (dept.offices.length) {
    const list = document.createElement('ul');
    list.className = 'department-offices';
    dept.offices.forEach((o) => list.appendChild(officeItem(o)));
    card.appendChild(list);
  }

  if (dept.vacant.length) {
    const fold = document.createElement('details');
    fold.className = 'department-vacant';
    const summary = document.createElement('summary');
    summary.textContent = dept.vacant.length === 1
      ? '1 office with no holder recorded on this date'
      : `${dept.vacant.length} offices with no holder recorded on this date`;
    const list = document.createElement('ul');
    list.className = 'department-offices';
    dept.vacant.forEach((o) => list.appendChild(officeItem(o)));
    fold.append(summary, list);
    card.appendChild(fold);
  }

  return card;
}

function unassignedRow(entry) {
  const row = document.createElement('li');
  row.className = 'office';
  const title = document.createElement('h3');
  title.className = 'office-title';
  title.appendChild(officeButton(entry, open));
  const officeQid = qidTag(entry.position.wikidataQid);
  if (officeQid) title.appendChild(officeQid);
  row.append(officeholderImageEl(entry.officeholder, 96, 'portrait portrait-sm'), title, holderLine('office-holder', entry.officeholder));
  return row;
}

function render() {
  if (!view) return;

  leadersEl.innerHTML = '';
  view.leaders.forEach((entry) => leadersEl.appendChild(leadCard(entry, entry.position.title, open)));

  const populated = view.departments.filter((d) => d.heads.length || d.offices.length || d.vacant.length);
  const empty = view.departments.filter((d) => !populated.includes(d));

  gridEl.innerHTML = '';
  countEl.textContent = populated.length ? String(populated.length) : '';
  if (populated.length === 0) {
    const none = document.createElement('p');
    none.className = 'empty-state';
    none.textContent = 'No departments found on Wikidata for this date. Try a later date, or switch to the Offices view.';
    gridEl.appendChild(none);
  }
  populated.forEach((d) => gridEl.appendChild(departmentCard(d)));

  unassignedList.innerHTML = '';
  view.unassigned.forEach((e) => unassignedList.appendChild(unassignedRow(e)));
  unassignedCount.textContent = String(view.unassigned.length);
  unassignedSection.hidden = view.unassigned.length === 0;

  emptyList.innerHTML = '';
  empty.forEach((d) => {
    const li = document.createElement('li');
    li.textContent = d.label;
    const q = qidTag(d.qid);
    if (q) li.appendChild(q);
    emptyList.appendChild(li);
  });
  emptyCount.textContent = String(empty.length);
  emptySection.hidden = empty.length === 0;
}

async function loadDepartments(date, countryQid) {
  currentCountryQid = countryQid;
  hintEl.textContent = '';
  hintEl.className = 'status-line';
  loadingOverlay.classList.add('active');
  try {
    view = await api(`/api/departments?date=${date}&country=${countryQid}`);
    render();
    const head = view.leaders.find((l) => l.position.bucket === 'Head of Government') ?? view.leaders[0];
    masthead.setCabinetLabel(cabinetLabelFor(head));
    hintEl.textContent = 'Select any office to compare its Wikidata and Wikipedia data.';
  } catch (err) {
    hintEl.textContent = `Couldn't load departments: ${err.message}. Try again, or pick another date.`;
    hintEl.className = 'status-line error';
  } finally {
    loadingOverlay.classList.remove('active');
  }
}

function reload() {
  return lastLoad ? loadDepartments(...lastLoad) : undefined;
}

const masthead = initMasthead({
  load: (date, countryQid) => {
    lastLoad = [date, countryQid];
    return loadDepartments(date, countryQid);
  },
  rerender: render,
});
masthead.ready.catch((err) => {
  hintEl.textContent = `Couldn't load the country list: ${err.message}`;
  hintEl.className = 'status-line error';
});

if (addDepartmentBtn) {
  addDepartmentBtn.addEventListener('click', () => {
    openAddDepartmentDialog({ onSave: reload });
  });
}
