# Handover

Everything a person — or an AI agent — needs to pick this up from scratch, including
what must be copied when moving to another computer and what deliberately stays behind.

**This document contains no secrets.** It says where every secret lives instead of what
it is, because this repository is public.

---

## 0. If you are an AI agent, read this first

**What this is.** A local-business outreach tool: it finds businesses anywhere in the
world from free OpenStreetMap data, determines which ones have no working website,
collects their public contact details and social presence, scores them, and provides a
to-do list and pipeline to work through them.

**Current state in one line.** The app works completely, runs on one machine, and is
verified end to end. A rewrite to host it on Vercel without any local machine is **about
a third done on a branch** (see §11).

**Read order:**
1. This document, all of it. §2 (state), §3 (what is local), §11 (unfinished work).
2. `README.md` for how the product works and how to run it.
3. `CONTRIBUTING.md` for the rules that must not be broken.
4. `~/.commandcode/plans/local-lead-outreach-system.md` if it still exists — the original
   design plan, with the reasoning behind the architecture.

**How to work here.** `npm test` and `npm run typecheck` must pass before anything is
considered done. There are verification scripts for every layer (§10) — use them rather
than assuming. The project's history has repeated examples of an assumption passing
review and failing against reality, so verify against the real service before building
on it.

**Do not undo these decisions** (§12): the politeness model, the confidence factor in
scoring, the SQL/TypeScript scoring pair, or the honesty rules about missing data.

---

## 1. What it is

| | |
|---|---|
| **Name** | Outreach OS (`outreach-os`) |
| **Licence** | MIT |
| **Repo** | https://github.com/Stormynubee/outreach-os (public) |
| **Stack** | TypeScript monorepo — Fastify + SQLite server, React + Vite interface |
| **Cost to run** | £0 locally. Free tiers only if hosted. No API keys anywhere. |
| **Data source** | OpenStreetMap — Overpass (businesses) and Nominatim (geocoding) |

Four parts: **discovery** (find businesses in an area), **enrichment** (website status,
emails, phones, socials), **scoring** (rank the best leads first), **outreach** (to-do
list, pipeline stages, weekly activity).

---

## 2. Current state

### Working and verified

- Discovery, enrichment, scoring, filtering, CSV export, to-do list, pipeline, dashboard,
  guided tour, splash screen.
- 68 unit and integration tests, an 18-check interface smoke test, and live end-to-end
  checks that have been run against real OpenStreetMap services and real business
  websites.
- Runs offline with no account and no cloud dependency: `npm start`.

### In flight

- **A serverless rewrite on the branch `serverless-turso`.** It does not build yet. See
  §11 for exactly where it got to.

### Abandoned, with reasons (do not re-attempt without new information)

| Attempt | Why it stopped |
|---|---|
| Engine on **Railway** | The account's trial is expired; it needs a paid plan. Everything else was ready. |
| Engine on **Vercel** | Vercel's filesystem is ephemeral, so SQLite cannot persist. Vercel's own documentation states SQLite "can't be used with Vercel". |
| **Turso with FTS5** | Turso does not support SQLite's FTS5 — it uses Tantivy with different syntax. Full-text search becomes a `LIKE` filter instead. |

---

## 3. What lives where

This is the important section for moving machines.

| Thing | Where it lives | Travels with a `git clone`? |
|---|---|---|
| Source code | GitHub | **Yes** |
| **`data/app.db`** | Your disk | **No — this is your workspace** |
| `data/app.db-wal`, `data/app.db-shm` | Your disk | **No — recent writes live here** |
| `data/api-token.txt` | Your disk | **No — the engine's access token** |
| `.vercel/` (Vercel project link) | Your disk | No — recreated by `vercel link` |
| `node_modules/`, `packages/web/dist/` | Your disk | No — rebuilt by `npm install` / `npm run build` |
| The Vercel deployment | Vercel | N/A — already deployed, auto-deploys from GitHub |
| Cloudflared (tunnel) | Installed globally | No — install separately |
| Docker Desktop, its containers | Installed globally | No |

**`data/app.db` is the only irreplaceable file in this project.** It holds every lead,
contact, social account, follower override, task, pipeline stage, note, your settings
(contact identity, display name, offer preset, mirror list, delays), the HTTP response
cache and the job queue. It is gitignored on purpose, because it is private business
data and this repository is public.

### About RAM

This app is one Node process and a SQLite file — a few hundred megabytes at most, and it
is idle unless you are searching or enriching.

If the goal of moving it is to free memory on the working machine, note that the largest
consumer on that machine is **Docker Desktop with the ~20 containers currently running**
(several Supabase stacks, Postgres, Redis and MongoDB instances belonging to other
projects). Stopping Docker Desktop frees far more than moving this app does.

---

## 4. Migrating to another computer

### On the old machine

1. **Stop the engine.** Close the terminal running `npm start`, or end the Node process.
   This matters: SQLite runs in WAL mode, so recent writes sit in `app.db-wal` until a
   checkpoint. Copying `app.db` alone while it runs can lose your latest changes.
2. **Stop cloudflared** if a tunnel is running.
3. **Copy the whole `data/` folder** — all of `app.db`, `app.db-wal`, `app.db-shm`, and
   `api-token.txt`. Copy the folder, not just the `.db`.
4. Optionally copy `.vercel/` to keep the Vercel project link.

That is the entire migration. Nothing else is machine-specific.

### On the new machine

1. Install **Node.js 22.5 or newer** (`node -v`).
2. `git clone https://github.com/Stormynubee/outreach-os.git`
3. `cd outreach-os && npm install`
4. **Copy your `data/` folder into the project root**, so you have `data/app.db`.
5. `npm run build && npm start`
6. Open <http://localhost:4317>. Your leads are there.

Optional, only if you want them: **Docker Desktop** (for the container path),
**cloudflared** (for the tunnel), the **Vercel CLI** (`npm i -g vercel`).

### If you forget the token

Delete nothing. If `data/api-token.txt` is missing, the engine generates a new one on
start and logs where it wrote it. Anything that was using the old token (a hosted
interface, a browser tab) then needs the new value pasted into
Settings → Engine connection.

---

## 5. Running it — every path

### 5.1 Local development

```bash
npm install
npm run dev          # API on :4317, interface on http://localhost:5173
```

Set your contact in **Settings** before searching. OpenStreetMap blocks clients that do
not identify a real contact, and rejects placeholder addresses like `example.com`
outright — the app refuses them up front and explains why.

### 5.2 Local production (the normal way to use it)

```bash
npm run build
npm start            # one process on :4317 serving both interface and API
```

Entirely offline. No account, no cloud, no keys.

### 5.3 Self-contained container

```bash
docker build -t outreach-os .
docker run -d -p 4317:4317 -v outreach-data:/data outreach-os
```

**The volume is not optional** — it holds the database *and* the token. Without it every
restart begins with an empty workspace. Verified to survive a restart.

### 5.4 Hosted interface + engine on your machine

```bash
npm start           # terminal 1
npm run tunnel      # terminal 2 — cloudflared, prints a public HTTPS address
```

Then in the **hosted** interface: Settings → Engine connection → paste the tunnel address
and the token from `data/api-token.txt`.

The address changes each time the tunnel restarts; update it in Settings. This is why the
address is runtime configuration rather than baked into the build.

### 5.5 Container host (needs a paid plan somewhere)

Same image as §5.3, on a host with a persistent volume. The code needs no changes. Railway
was ready to go but its trial expired; Render's free tier has no persistent disks.

### 5.6 Fully serverless (in progress, see §11)

Target: one Vercel URL, no machine involved, using Turso (hosted SQLite) for storage.
Not usable yet.

---

## 6. Requirements from scratch

| Requirement | Why | Needed for |
|---|---|---|
| Node.js ≥ 22.5 | Runs the server and build | Everything |
| npm | Workspaces | Everything |
| Internet | Overpass, Nominatim, business sites | Discovery and enrichment |
| Docker Desktop | Optional | §5.3 only |
| cloudflared | Optional | §5.4 only |
| Vercel CLI | Optional | Deploying the interface |
| Turso account | Optional | §5.6 only |

No database server, no API keys, no cloud account is required for normal use.

---

## 7. Secrets, accounts, and what is not in the repo

**Deliberately not in the repo** (all gitignored): `data/`, `.vercel/`, `node_modules/`,
`dist/`, `.commandcode/`, `.env`.

| Secret | Where it lives | How to rotate |
|---|---|---|
| Engine access token | `data/api-token.txt`, or `OUTREACH_API_TOKEN` | Stop the engine, delete the file, restart |
| Your OSM contact | Inside `data/app.db` (Settings) | Edit it in Settings |

Accounts this project touched, none of which store secrets in the repo:

| Service | Account | State |
|---|---|---|
| GitHub | `Stormynubee` | Repo is public, MIT |
| Vercel | `priyanktiwari434-2151` | Project `outreach-os`, live at https://outreach-os-rouge.vercel.app |
| Railway | `arya108383@gmail.com` | **Trial expired** — a paid plan is required to deploy |
| Turso | *not created* | Needed for §5.6 |

The Vercel deployment is the interface only. It cannot do anything on its own, because
the engine is not hosted anywhere yet.

If the engine ever becomes reachable from the internet, **always set a token** — without
one, anyone with the address can read every lead, edit the pipeline, and make the machine
issue outbound requests.

---

## 8. Constraints that must not be broken

These are enforced in code and are the reason the app stays welcome on donated
infrastructure. Breaking them gets the user blocked.

- **Honest `User-Agent`** identifying the app and a real contact. Never impersonate a
  browser.
- **Obey `robots.txt`**, including `Crawl-delay`. A site that disallows us is still
  recorded as a lead, just not scraped.
- **Never parallelise Overpass queries.** Their policy forbids parallel scripts from one
  application. The tile loop is sequential on purpose.
- **Never parallelise requests to one domain.** Per-domain serialisation with a minimum
  delay is the politeness guarantee.
- **Never add autocomplete** to the location field. Nominatim forbids it; suggestions come
  from the user's own search history.
- **Never read a platform that walls or forbids automated access** (LinkedIn, X). Report
  `unknown` with a reason.
- **Never invent a data point.** A missing follower count is reported as unknown with a
  reason, and a hand-entered value can never be overwritten by a later scrape.
- **No automated sending.** The app tracks outreach; it does not send email or DMs.

Attribution is required: "© OpenStreetMap contributors", ODbL, shown in the footer
together with the map data timestamp.

---

## 9. Known gotchas

- **Public Overpass mirrors are genuinely flaky.** They return timeouts, and some
  regional mirrors return *valid JSON with silently incomplete data*. The app health-tracks
  mirrors, rotates, backs off, and cross-checks an empty result against a second mirror
  before believing it. Do not "simplify" that away.
- **A failing tile must not be retried forever.** A failed tile stays in the pending set;
  the attempt cap and the failure-kind distinction (query too heavy vs server too busy)
  are both load-bearing.
- **Overpass returns HTTP 200 with an error page** on timeout. Never trust the status code.
- **Follower counts will have gaps** — Instagram is login-walled, X is login-walled,
  LinkedIn forbids it. This is a real limit, not a bug.
- **Windows:** `better-sqlite3` (and later `libsql`) need antivirus exclusions; Windows
  prefers IPv6 and will hang on hosts with no v6 route, hence `ipv4Preferred`.
- **`data/` must not live in OneDrive or any synced folder.** WAL plus cloud sync causes
  file-lock errors and corruption.
- **Tunnel addresses change on every restart.** Expect to update Settings.
- **A datacenter IP crawls worse than a home connection.** Cloudflare-protected small
  business sites block datacenter ranges more aggressively, so any hosted engine will find
  fewer contacts on some leads.

---

## 10. Proving it works

| Command | What it proves |
|---|---|
| `npm test` | 68 unit and integration tests |
| `npm run typecheck` | Strict TypeScript, both packages |
| `npm run verify:ui` | The real interface mounts and renders, including splash and guide |
| `npm run verify` | API and built interface serve together; the event stream works |
| `npm run verify:auth` | The token gate and CORS behave correctly |
| `npm run verify:engine <url> [token]` | A self-contained deployment, including data surviving a restart |
| `npm run verify:deploy <url>` | A hosted interface: assets, deep links, no leaked secret |
| `npm run e2e` | The full pipeline against a live town, then the ranking invariants |
| `npm run smoke` / `npm run mirrors` | The upstream Overpass/Nominatim contract still holds |

`e2e`, `smoke` and `mirrors` make real requests to donated services. They are
verification tools, not part of normal use.

---

## 11. The in-flight serverless rewrite

**Branch: `serverless-turso` (pushed). It does not build yet.** `main` is untouched and
fully working, so a clone of `main` gives a working app.

**Goal:** one Vercel URL running everything, with hosted SQLite (Turso, free tier) instead
of a local file, and no always-on worker.

**Done:**

- `scripts/preflight-db.mjs` — **30 checks pass locally**: named `@parameter` binding,
  partial indexes with partial conflict targets, upsert with `RETURNING`, `json_extract`,
  `json_group_array`, `json_each`, `date(x,'unixepoch','localtime')`, chunked
  `UPDATE ... LIMIT/OFFSET`, `batch()`, `transaction()`, a migrations table, and gzipped
  `BLOB`s (returned as `ArrayBuffer`). Run it with
  `node scripts/preflight-db.mjs [url] [token]`; the Turso half is unrun until an account
  exists. It only works on this branch, because it needs the branch's dependency.
- `packages/server/src/db/client.ts` — rewritten around `@libsql/client` behind a
  `prepare()`-shaped shim, so **the SQL and its named arguments are unchanged** and the
  rest of the conversion is mostly adding `await`.
- Migrations moved from `PRAGMA user_version` to a `schema_migrations` table (pragmas are
  unreliable over the hosted protocol).
- The shim was exercised against the **real** migration script (25 tables, 38 indexes, the
  duplicate view) and the real job-claim statement.

**Remaining, in order:**

1. **Add `await` to the call sites.** `npx tsc -p packages/server/tsconfig.json` reports
   **184 errors, all of this kind.** The typechecker finds every one, so work from its
   output, largest file first:
   `routes/index.ts` (28), `db/businesses.ts` (26), `db/tasks.ts` (24), `db/stats.ts` (20),
   `discovery/run.ts` (18), `index.ts` (17), `lib/http.ts` (12), `db/jobs.ts` (10),
   `test/pipeline.test.ts` (9), `providers/overpass.ts` (8),
   `enrich/checkSocial.ts` (4), `queue/worker.ts` (3), `providers/geocode.ts` (2),
   `test/scoring.test.ts` (2), `enrich/scrapeSite.ts` (1).
   Tests need `await migrate(db)` in their setup. The scoring parity matrix runs 13,500
   comparisons — batch them rather than awaiting one at a time, or it becomes very slow.
2. **Drop FTS5** from the schema and make `listLeads` use its existing `LIKE` fallback.
3. **Move rate limiting into the database** (a `domain_state` table) so the per-domain
   delay and circuit breaker survive between invocations — there is no long-lived process
   on a serverless host.
4. **Replace the always-on worker with `POST /api/engine/tick`**: a single-flight lease so
   two invocations can never run Overpass requests in parallel, then bounded work, then
   return. Discovery becomes a resumable step function (tiles are already persisted).
5. **Add the client driver**: while the app is open and work is pending, call tick every
   couple of seconds. Vercel Hobby cron can only run **once per day**, so cron is a
   backstop and the open tab is the driver.
6. **Serverless entry** (`api/index.ts`) and `vercel.json` rewrites; remove the worker
   loop from that path.
7. **Deploy and verify** with `npm run verify:engine <vercel-url> <token>`, then run a
   live discovery.

**Accepted trade-offs:** enrichment only advances while a tab is open (it resumes, it does
not restart); search becomes `LIKE`; crawling comes from a datacenter IP; cron is daily.

---

## 12. Decisions made, and why

Do not undo these without understanding them.

1. **Politeness is enforced in code, not documented.** Per-domain serialisation, minimum
   delays, sequential Overpass, honest User-Agent, robots.txt. This is why the app can run
   at all against donated services.
2. **Scoring is computed twice, on purpose** — once in TypeScript and once compiled into
   SQL — with a parity test over 13,500 combinations. A bulk re-rank and the API cannot
   disagree. If you change a weight, change it in `packages/shared/src/score.ts`.
3. **Unknown data multiplies the score down.** A confidence factor derived from how much
   was actually inspected means an unverifiable business can never outrank a verified one.
4. **Derive, do not increment.** Daily counters are rebuilt from the task list, so
   un-ticking a task reverts every number exactly. Hand-maintained counters drift.
5. **`dedupe_key` is deliberately not unique.** Franchises share domains and free-host
   subdomains are separate businesses; a unique index would silently merge real leads.
6. **Fuzzy duplicates are surfaced, never auto-merged.** A wrong merge destroys a lead.
7. **Partial results beat no results.** Every enrichment stage records what it found and
   why it stopped; nothing throws into the job runner.
8. **No headless browser.** It would unlock more scraping but breaks the "no
   circumvention" position the project is built on.
9. **Turso over Postgres**, because the engine is SQLite-native: JSON aggregation, partial
   indexes, upsert syntax and date arithmetic would all have needed rewriting.
10. **The interface runs on a website layout, not a phone layout.** A phone mockup was the
    *style* reference (palette, chunky cards, big numerals, pill controls), not the layout.

---

## 13. Repository layout

```
packages/shared   Types, scoring weights, OSM category maps (shared by server and web)
packages/server   Fastify API, SQLite storage, discovery and enrichment pipeline
packages/web      React + Vite interface
scripts/          Verification and diagnostics
data/             YOUR DATA — gitignored, back it up
Dockerfile        Self-contained image: engine and interface in one
vercel.json       Static interface build settings
HANDOVER.md       This document
```

Branches: `main` is the working app. `serverless-turso` is the unfinished rewrite.
