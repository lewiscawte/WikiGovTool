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
  dates (start time P580 / end time P582 on their position held P39 statement). Every edit is
  shown for review before it's published, and dates copied from Wikipedia are cited with the
  exact article revision (P143 + P4656).
- **Local additions for gaps.** Missing officeholders, offices and departments can be added
  locally (searching Wikipedia and Wikidata, limited to people alive on the date). These are
  kept in memory only, never written to Wikidata, and labelled as local.

## How it works

The backend is a small Express server in TypeScript (`src/`). It reads Wikidata through the
Wikidata Query Service (SPARQL) and the Action API, and Wikipedia through its Action API,
caching results for 15 minutes. The frontend (`public/`) is plain HTML, CSS and ES modules
with no build step.

There's no database. Local additions and edits live in server memory and are lost on restart;
Wikidata and Wikipedia are always the source of truth.

The first load for a country can take up to a minute, because the queries that find a
country's offices are slow when nothing is cached yet.

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
| `CACHE_TTL_MS` | How long Wikidata/Wikipedia responses are cached (default 15 minutes) |

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
