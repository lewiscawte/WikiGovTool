# WikiGovTool

A tool for checking that Wikidata and English Wikipedia agree about governments: who held
which office, when, and how departments and offices fit together.

It's live at **https://wikigovtool.toolforge.org/**.

Pick a country and a date (anywhere from 1900 to today), and the tool shows that government
as Wikidata records it. Wherever the data is thin or the two sources disagree, it says so, and
logged-in editors can fix term dates on Wikidata directly, citing the Wikipedia revision they
came from.

## Features

- **Two views of a government on any date.** *Offices* lists every cabinet-level office and
  who held it. *Departments* groups offices under the department or ministry they belong to,
  with the office that runs it first.
- **Gaps are shown, not hidden.** Offices with no holder on the date, offices not linked to
  any department, and departments with no offices are each listed, since each is usually a
  missing statement on Wikidata.
- **Wikidata and Wikipedia side by side.** Opening an office compares its Wikidata values with
  the infobox on the office's and officeholder's Wikipedia articles. Values that differ are
  flagged, and a Wikipedia value can be copied across.
- **Edits to Wikidata, reviewed first.** Logged-in editors can save an officeholder's term
  dates (start time P580 / end time P582, on both the person's position held P39 statement and
  the office's officeholder P1308 statement) and an office's or department's own dates
  (inception P571 / dissolved P576). Every edit is shown for review before it's published, and
  term dates copied from Wikipedia are cited with the exact article revision (P143 + P4656).
  Dates can be typed as YYYY, YYYY-MM or YYYY-MM-DD, or as written on Wikipedia
  ("7 February 2023").
- **Local additions for gaps.** Missing officeholders, offices and departments can be added
  locally (searching Wikipedia and Wikidata, limited to people alive on the date). These are
  kept in memory only, never written to Wikidata, and labelled as local.

## How it works

The backend is a small Express server in TypeScript (`src/`). It reads Wikidata through the
Wikidata Query Service (SPARQL) and the Action API, and Wikipedia through its Action API,
caching results in memory and, when configured, in Redis. The frontend (`public/`) is plain HTML, CSS and ES modules
with no build step.

There's no database. Local additions and edits live in server memory and are lost on restart;
Wikidata and Wikipedia are always the source of truth. Edits are always built from live data,
never from the cache.

The first load for a country can take up to a minute, because the queries that find a
country's offices are slow when nothing is cached yet.

When a search can't find a person, office or department, "Create a new Wikidata item" opens a
form with the usual statements for that kind of item. It's previewed, along with any existing
items of the same name, before anything is created, and a source URL given there is cited on the
new statements.

Editing a department that has a Wikidata item saves to Wikidata, after a preview: its name,
English Wikipedia article, inception and dissolved dates (a blank field leaves Wikidata alone),
and its formation and dissolution, one row per department it came from (replaces, separated
from) or went to (replaced by, merged into), with the part concerned and the date as
qualifiers. Those links are only ever added, and "replaces" / "replaced by" are added to the
other department too. A department without a Wikidata item is still edited locally.

To see changes made on Wikidata sooner, log in and use "Refresh from Wikidata" in an office or
department dialog, or add `?refresh=1` to the page address to refetch the whole country. Terms
saved through this tool show straight away, marked as waiting, until Wikidata's query service
(which runs minutes behind edits) catches up.

## Running it locally

Requires Node.js 20 or later.

```sh
npm install
cp .env.example .env   # then edit .env, see below
npm run dev            # http://localhost:3000, restarts on code changes
```

Reading data needs no setup. Logging in and editing need OAuth credentials (see below).

| Command | What it does |
|---|---|
| `npm run dev` | Runs the server from source, restarting when files change |
| `npm run build` | Compiles TypeScript to `dist/` |
| `npm start` | Runs the compiled server from `dist/` |
| `npm test` | Runs the test suite |

## Configuration

All settings are environment variables, read from `.env` if present. `.env.example` lists
them all with their defaults.

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `SESSION_SECRET` | Signs session cookies. **Set this in production** to a long random string, e.g. `openssl rand -hex 32` |
| `WIKIMEDIA_CONTACT` | Contact address in the User-Agent sent to Wikimedia, as their API etiquette requires |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | The OAuth 2.0 consumer's client application key and secret |
| `OAUTH_CALLBACK_URL` | Must match the consumer's registered callback |
| `WIKIDATA_EDIT_TAGS` | Change tags added to every Wikidata edit (comma-separated). Each must already exist on Wikidata |
| `GIT_COMMIT` | Commit shown in the footer, only needed where the server runs without a `.git` directory |
| `CACHE_TTL_MS` | How long Wikipedia articles and Wikidata items are cached (default 15 minutes) |
| `CACHE_HISTORY_TTL_MS` | How long officeholder histories stay fresh (default 6 hours) |
| `CACHE_STRUCTURE_TTL_MS` | How long offices, departments and their links stay fresh (default 24 hours) |
| `CACHE_COUNTRIES_TTL_MS` | How long the country list stays fresh (default 7 days) |
| `CACHE_STALE_MS` | How long past those an entry can still be shown while it's refreshed in the background (default 7 days, 0 to disable) |
| `REDIS_URL`, `REDIS_KEY_PREFIX` | Optional. Keeps the cache across restarts; without both, it's memory only |

### OAuth

Register an OAuth 2.0 consumer at
[Special:OAuthConsumerRegistration](https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2)
on Meta-Wiki:

- **Callback:** `<your site>/api/auth/callback`, e.g. `http://localhost:3000/api/auth/callback`
- **Client is confidential:** yes
- **OAuth 2 flow:** authorization code
- **Grants:** "Request authorization for specific permissions", with *Edit existing pages*
- **Applicable project:** `wikidatawiki`

A consumer is usable by its owner while it awaits approval, which is enough for testing.

#### Testing with an owner-only consumer

Owner-only consumers can't use the normal login. For local testing only, set
`OAUTH_OWNER_ONLY=true` and `OAUTH_OWNER_ACCESS_TOKEN` to the consumer's access token: logging
in then uses that token directly. Everyone who logs in acts as the token's owner, so this is
refused when `NODE_ENV=production`. Never enable it on a shared deployment.

## Deployment

The public instance runs on [Toolforge](https://toolforge.org/). After pulling changes:

```sh
npm install
npm run build
# then restart the webservice
```

Set `NODE_ENV=production`, a real `SESSION_SECRET`, and the production consumer's OAuth
settings. The footer shows the running commit, linked to GitHub, to make bug reports easier
to match to a version.

To use [Toolforge's shared Redis](https://wikitech.wikimedia.org/wiki/Help:Toolforge/Redis),
set `REDIS_URL=redis://redis.svc.tools.eqiad1.wikimedia.cloud:6379` and `REDIS_KEY_PREFIX` to
the output of `openssl rand -hex 32`. Every tool can read and overwrite that instance, so the
prefix must stay secret, and only public data may go in it: never sessions, which hold OAuth
tokens. Cache activity is logged with `[cache]` and `[upstream]` prefixes.

## Project layout

```
src/
  routes/       HTTP endpoints (/api/...)
  services/     Wikidata and Wikipedia access, org chart and department assembly, edits
  store/        In-memory local additions
  data/         The curated US cabinet list
public/         The frontend: pages, styles and dialogs
test/           Tests (node:test, run with tsx)
```

## License

WikiGovTool is free software, licensed under the
[GNU General Public License v3.0 or later](LICENSE.md).
