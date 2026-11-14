// The usage statistics page. Standalone: shared.js sets up the date and country controls,
// which this page doesn't have.

const TYPE_LABELS = {
  person: 'People',
  office: 'Offices',
  department: 'Departments',
  term: 'Officeholder term dates',
  'term-new-holder': 'Officeholders added',
  'office-dates': 'Office created / abolished dates',
  'department-fields': 'Department name, article and dates',
  'department-succession': 'Department formation and dissolution',
};

const statusEl = document.getElementById('statsStatus');

function cell(row, text, { link } = {}) {
  const td = document.createElement('td');
  if (link) {
    const a = document.createElement('a');
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = text;
    td.appendChild(a);
  } else {
    td.textContent = text;
  }
  row.appendChild(td);
}

function fill(tbodyId, rows) {
  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = '';
  rows.forEach((cells) => {
    const tr = document.createElement('tr');
    cells.forEach(([text, options]) => cell(tr, String(text), options));
    tbody.appendChild(tr);
  });
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = tbody.closest('table').querySelectorAll('th').length;
    td.textContent = 'None yet';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

const userLink = (name) => `https://www.wikidata.org/wiki/Special:Contributions/${encodeURIComponent(name.replace(/ /g, '_'))}`;
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

async function load() {
  let stats;
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    stats = await res.json();
  } catch (err) {
    statusEl.textContent = `Couldn't load statistics: ${err.message}`;
    statusEl.className = 'status-line error';
    return;
  }
  if (!stats.enabled) {
    statusEl.textContent = 'Usage statistics aren\'t switched on for this server.';
    return;
  }
  statusEl.textContent = '';
  if (stats.since) {
    document.getElementById('statsSince').textContent = `Since ${new Date(stats.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  const byKind = (kind) => stats.totals.filter((t) => t.kind === kind).map((t) => [[TYPE_LABELS[t.type] ?? t.type], [t.count]]);
  fill('statsCreated', byKind('create'));
  fill('statsEdits', byKind('edit'));
  fill('statsUsers', stats.users.map((u) => [[u.username, { link: userLink(u.username) }], [u.created], [u.edits]]));
  fill('statsMonths', [...stats.months].reverse().map((m) => [[monthName(m.month)], [m.created], [m.edits]]));
  for (const id of ['statsTotals', 'statsUsersSection', 'statsMonthsSection']) document.getElementById(id).hidden = false;
}

load();
