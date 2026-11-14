// The "create a new Wikidata item" dialog, for a person, office or department the searches
// can't find. Each kind gets a few sensible statements, prefilled where the country or the
// search already says what they should be. The server builds the item from these fields;
// nothing is sent until the user has previewed it. Importing this module adds the dialog.
import { api, state } from './shared.js';

document.body.insertAdjacentHTML('beforeend', `
  <div class="dialog-backdrop dialog-backdrop-top" id="createItemBackdrop">
    <div class="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="createItemTitle">
      <h2 class="dialog-title" id="createItemTitle">Create a Wikidata item</h2>
      <p class="dialog-intro" id="createItemIntro"></p>
      <div id="createItemFields"></div>
      <div class="field create-item-source">
        <label for="createItemSource">Source URL (recommended)</label>
        <input class="input" id="createItemSource" placeholder="https://… a page that confirms these details">
        <p class="create-item-hint">Cited on every statement below, so the new item isn't unsourced.</p>
      </div>
      <p class="status-line" id="createItemStatus"></p>

      <section class="edit-review" id="createItemReview" hidden aria-labelledby="createItemReviewTitle">
        <h3 class="edit-review-title" id="createItemReviewTitle">Review new item</h3>
        <div id="createItemReviewBody"></div>
        <div class="edit-review-actions">
          <button type="button" class="btn" id="createItemReviewCancel">Back</button>
          <button type="button" class="btn btn-primary" id="createItemPublish">Create on Wikidata</button>
        </div>
      </section>

      <div class="dialog-actions">
        <button type="button" class="btn" id="createItemCancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="createItemPreview">Preview</button>
      </div>
    </div>
  </div>
`);

const backdrop = document.getElementById('createItemBackdrop');
const titleEl = document.getElementById('createItemTitle');
const introEl = document.getElementById('createItemIntro');
const fieldsEl = document.getElementById('createItemFields');
const sourceInput = document.getElementById('createItemSource');
const statusEl = document.getElementById('createItemStatus');
const reviewEl = document.getElementById('createItemReview');
const reviewBody = document.getElementById('createItemReviewBody');
const publishBtn = document.getElementById('createItemPublish');

const QID_RE = /^Q[1-9]\d*$/;
const KIND_NAMES = { person: 'person', office: 'office', department: 'department' };
const OFFICE_CLASSES = [['Q83307', 'Minister'], ['Q2285706', 'Head of government'], ['Q48352', 'Head of state']];
// Kept in step with departmentClassesFor in src/services/wikidataCreate.ts, which checks them.
const COUNTRY_DEPARTMENT_CLASSES = {
  Q30: [['Q910252', 'United States federal executive department']],
  Q145: [['Q2500378', 'Department of the United Kingdom Government']],
};
const GENERAL_DEPARTMENT_CLASSES = [['Q192350', 'Ministry'], ['Q327333', 'Government agency']];

let kind = null;
let options = {};
// Readers for the current kind's fields, keyed by the request field they fill.
let readers = {};
let pending = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = isError ? 'status-line error' : 'status-line';
}

const countryLabel = () => document.getElementById('countrySelect')?.selectedOptions[0]?.textContent || state.countryQid;

function field(labelText, control, { wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = wide ? 'field create-item-wide' : 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  control.id = `ci-${Math.random().toString(36).slice(2, 8)}`;
  label.htmlFor = control.id;
  wrap.append(label, control);
  return wrap;
}

function textInput(key, labelText, { value = '', placeholder = '', wide = false } = {}) {
  const input = document.createElement('input');
  input.className = 'input';
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  readers[key] = () => input.value.trim();
  return field(labelText, input, { wide });
}

function selectInput(key, labelText, choices, value = '') {
  const select = document.createElement('select');
  select.className = 'input';
  for (const [v, text] of choices) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = text;
    select.appendChild(opt);
  }
  select.value = value;
  readers[key] = () => select.value;
  return field(labelText, select);
}

function checkbox(key, labelText, checked = true) {
  const label = document.createElement('label');
  label.className = 'toggle create-item-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  label.append(input, ` ${labelText}`);
  readers[key] = () => input.checked;
  return label;
}

// A Wikidata item chosen by searching, or by typing its Q-number.
function itemInput(key, labelText, placeholder) {
  const wrap = document.createElement('div');
  const input = document.createElement('input');
  input.className = 'input';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  const results = document.createElement('ul');
  results.className = 'create-item-results';
  let chosen = null;
  let timer = null;
  let request = 0;
  input.addEventListener('input', () => {
    chosen = QID_RE.test(input.value.trim()) ? input.value.trim() : null;
    clearTimeout(timer);
    results.innerHTML = '';
    const q = input.value.trim();
    if (!q || chosen) return;
    timer = setTimeout(async () => {
      const mine = ++request;
      try {
        const { results: found } = await api(`/api/wikidata/search?q=${encodeURIComponent(q)}`);
        if (mine !== request) return;
        found.slice(0, 6).forEach((r) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'create-item-result';
          btn.textContent = `${r.label} (${r.id})${r.description ? ` — ${r.description}` : ''}`;
          btn.addEventListener('click', () => {
            chosen = r.id;
            input.value = `${r.label} (${r.id})`;
            results.innerHTML = '';
          });
          li.appendChild(btn);
          results.appendChild(li);
        });
      } catch {
        // A failed lookup just leaves the list empty; a Q-number can still be typed.
      }
    }, 250);
  });
  readers[key] = () => {
    if (!input.value.trim()) return null;
    if (!chosen) throw new Error(`Pick a ${labelText.toLowerCase()} from the list, or enter its Q-number.`);
    return chosen;
  };
  wrap.append(input, results);
  return field(labelText, wrap, { wide: true });
}

function grid(...children) {
  const el = document.createElement('div');
  el.className = 'grid-2';
  el.append(...children);
  return el;
}

function renderPersonFields() {
  const office = options.office;
  fieldsEl.append(
    grid(
      textInput('label', 'Name (English label)', { value: options.label }),
      textInput('description', 'Description', { value: 'politician' }),
    ),
    grid(
      selectInput('genderQid', 'Sex or gender', [['', 'Not set'], ['Q6581097', 'Male'], ['Q6581072', 'Female']]),
      textInput('birthDate', 'Date of birth', { placeholder: 'YYYY-MM-DD' }),
    ),
    itemInput('partyQid', 'Political party', 'Search Wikidata for the party'),
    textInput('wikipediaTitle', 'English Wikipedia article, if there is one', { wide: true }),
    checkbox('politician', 'Occupation: politician'),
    checkbox('citizen', `Country of citizenship: ${countryLabel()}`),
  );
  if (office?.qid) {
    fieldsEl.append(
      checkbox('holdsOffice', `Holds ${office.title} (position held on the person, officeholder on the office)`),
      grid(
        textInput('heldStart', 'Took office', { value: options.start || '', placeholder: 'YYYY-MM-DD' }),
        textInput('heldEnd', 'Left office', { value: options.end || '', placeholder: 'YYYY-MM-DD' }),
      ),
    );
  }
}

function renderOfficeFields() {
  fieldsEl.append(
    grid(
      textInput('label', 'Title (English label)', { value: options.label }),
      textInput('description', 'Description', { value: `government position in ${countryLabel()}` }),
    ),
    grid(
      selectInput('officeClassQid', 'Kind of office (subclass of)', OFFICE_CLASSES, 'Q83307'),
      textInput('inception', 'Created', { placeholder: 'YYYY-MM-DD' }),
    ),
    itemInput('departmentQid', 'Department it runs', 'Search Wikidata for the department'),
    textInput('wikipediaTitle', 'English Wikipedia article, if there is one', { wide: true }),
  );
  const note = document.createElement('p');
  note.className = 'create-item-hint';
  note.textContent = `Applies to jurisdiction and country are set to ${countryLabel()}: this tool finds a country's offices through them.`;
  fieldsEl.appendChild(note);
}

function renderDepartmentFields() {
  const classes = [...(COUNTRY_DEPARTMENT_CLASSES[state.countryQid] ?? []), ...GENERAL_DEPARTMENT_CLASSES];
  fieldsEl.append(
    grid(
      textInput('label', 'Name (English label)', { value: options.label }),
      textInput('description', 'Description', { value: `government department in ${countryLabel()}` }),
    ),
    grid(
      selectInput('departmentClassQid', 'Kind of department (instance of)', classes, classes[0][0]),
      textInput('inception', 'Created', { placeholder: 'YYYY-MM-DD' }),
    ),
    itemInput('headOfficeQid', 'Office that heads it', 'Search Wikidata for the office'),
    grid(
      textInput('website', 'Official website', { placeholder: 'https://…' }),
      textInput('wikipediaTitle', 'English Wikipedia article, if there is one'),
    ),
  );
}

function request() {
  const body = { kind, countryQid: state.countryQid, sourceUrl: sourceInput.value.trim() };
  for (const [key, read] of Object.entries(readers)) body[key] = read();
  if (kind === 'person') {
    if (body.holdsOffice) body.heldPositionQid = options.office.qid;
    else {
      delete body.heldStart;
      delete body.heldEnd;
    }
    delete body.holdsOffice;
  }
  return body;
}

// kind: "person" | "office" | "department". options: { label, office: { qid, title } (for a
// person, the office they're being added to), start, end, onDone({ qid, label, created, officeholder }) }.
export function openCreateItemDialog(newKind, newOptions = {}) {
  kind = newKind;
  options = newOptions;
  readers = {};
  pending = null;
  fieldsEl.innerHTML = '';
  sourceInput.value = '';
  reviewEl.hidden = true;
  setStatus('');
  titleEl.textContent = `Create a Wikidata item for a ${KIND_NAMES[kind]}`;
  introEl.textContent = 'Check the search first: this creates a new item on Wikidata, as you, after you review it. '
    + 'Statements already filled in are the usual ones for this kind of item; change or clear any that are wrong.';
  if (kind === 'person') renderPersonFields();
  else if (kind === 'office') renderOfficeFields();
  else renderDepartmentFields();
  backdrop.classList.add('open');
  fieldsEl.querySelector('input')?.focus();
}

function close() {
  backdrop.classList.remove('open');
  pending = null;
}

function itemLink(qid, text) {
  const a = document.createElement('a');
  a.href = `https://www.wikidata.org/wiki/${qid}`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

function done(result) {
  close();
  options.onDone?.(result);
}

function renderReview({ statements, labels, propertyLabels, duplicates, username, tags }, body) {
  reviewBody.innerHTML = '';
  if (duplicates.length) {
    const warn = document.createElement('p');
    warn.className = 'status-line error';
    warn.textContent = `Wikidata already has ${duplicates.length === 1 ? 'an item' : 'items'} called "${body.label}". Use one instead if it's the same ${KIND_NAMES[kind]}:`;
    const list = document.createElement('ul');
    list.className = 'edit-review-choices';
    duplicates.forEach((d) => {
      const li = document.createElement('li');
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'btn';
      use.textContent = `Use ${d.label} (${d.id})`;
      use.title = d.description || '';
      use.addEventListener('click', () => done({ qid: d.id, label: d.label, created: false }));
      li.append(use, ' ', itemLink(d.id, d.description || 'view'));
      list.appendChild(li);
    });
    reviewBody.append(warn, list);
  }

  const intro = document.createElement('p');
  intro.textContent = `As ${username}, create a new item:`;
  const list = document.createElement('ul');
  list.className = 'edit-review-changes';
  const line = (...parts) => {
    const li = document.createElement('li');
    li.append(...parts);
    list.appendChild(li);
    return li;
  };
  line('Label (en): ', Object.assign(document.createElement('ins'), { textContent: body.label }));
  line('Description (en): ', Object.assign(document.createElement('ins'), { textContent: body.description }));
  if (body.wikipediaTitle) line('English Wikipedia article: ', Object.assign(document.createElement('ins'), { textContent: body.wikipediaTitle }));
  const valueText = (v) => (v.item ? `${labels[v.item] ?? v.item} (${v.item})` : v.url ?? v.time.time.slice(1, 11).replace(/-00/g, ''));
  statements.forEach((s) => {
    const li = line(`${propertyLabels[s.property]} (${s.property}): `, Object.assign(document.createElement('ins'), { textContent: valueText(s.value) }));
    s.qualifiers.forEach((q) => li.append(`; ${propertyLabels[q.property]} ${valueText(q.value)}`));
    if (s.sourced && body.sourceUrl) li.append(' — cited to the source URL');
  });
  reviewBody.append(intro, list);
  if (body.heldPositionQid) {
    const then = document.createElement('p');
    then.append('Then on ', itemLink(body.heldPositionQid, `${options.office.title} (${body.heldPositionQid})`),
      ': add the new item as officeholder (P1308), with the same dates.');
    reviewBody.appendChild(then);
  }
  const note = document.createElement('p');
  note.className = 'edit-review-note';
  note.textContent = (body.sourceUrl ? '' : 'No source URL: the statements will be unsourced. ')
    + (tags ? `Tagged: ${tags}.` : 'No edit tag is configured.');
  reviewBody.appendChild(note);
  pending = body;
  publishBtn.disabled = false;
  reviewEl.hidden = false;
}

document.getElementById('createItemPreview').addEventListener('click', async () => {
  let body;
  try {
    body = request();
  } catch (err) {
    setStatus(err.message, true);
    return;
  }
  setStatus('Checking Wikidata…');
  try {
    const preview = await api('/api/wikidata/item/preview', { method: 'POST', body: JSON.stringify(body) });
    setStatus('');
    renderReview(preview, body);
  } catch (err) {
    setStatus(err.status === 401 ? 'Log in with Wikimedia first.' : err.message, true);
  }
});

publishBtn.addEventListener('click', async () => {
  if (!pending) return;
  publishBtn.disabled = true;
  setStatus('Creating on Wikidata…');
  try {
    const result = await api('/api/wikidata/item/create', { method: 'POST', body: JSON.stringify(pending) });
    done({ ...result, created: true });
  } catch (err) {
    publishBtn.disabled = false;
    setStatus(err.status === 401 ? 'Log in with Wikimedia first.' : err.message, true);
  }
});

document.getElementById('createItemReviewCancel').addEventListener('click', () => {
  reviewEl.hidden = true;
  pending = null;
});
document.getElementById('createItemCancel').addEventListener('click', close);
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
// Opened over another dialog: Escape closes only this one.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !backdrop.classList.contains('open')) return;
  e.stopPropagation();
  close();
}, true);

// The "Can't find it? Create a new Wikidata item" line under a search.
export function createItemLine(text, onClick) {
  const p = document.createElement('p');
  p.className = 'create-item-line';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'link-btn';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  p.appendChild(btn);
  return p;
}
