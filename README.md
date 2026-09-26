# Outreach OS

**Find local businesses that are missing a website — then work the list.**

Outreach OS takes any location in the world, finds the businesses there, works out
which ones have no working website, collects their public contact details, records
their social presence, and ranks them so the best leads sit at the top. Then it gives
you a to-do list to work through them.

Everything runs on your own machine against free OpenStreetMap services. No cloud
account, no API keys, no per-request billing.

[![CI](https://github.com/Stormynubee/outreach-os/actions/workflows/ci.yml/badge.svg)](https://github.com/Stormynubee/outreach-os/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-black.svg)](./package.json)

---

## The problem it solves

Selling websites, social media management or video to local businesses means knowing
which local businesses actually need you. Google Places costs money per lookup and
requires billing. Directory sites are stale and buried in captchas. Doing it by hand
means opening hundreds of tabs.

This does it in one pass, from open data, for free — and it is honest about what it
could not find instead of inventing numbers.

---

## Features

**Discovery**
- Search any town, city or postcode worldwide via the OpenStreetMap Overpass API
- One combined query covers every selected business category, so a search is a handful
  of requests rather than one per category
- Dense areas that hit the result cap are automatically split into quarters and
  re-queried; sparse areas stay a single request
- Nine built-in category groups (food & drink, health & beauty, trades, retail,
  hospitality, professional services, fitness, automotive, media & creative) plus a
  keyword filter
- Live progress over server-sent events: tiles covered, businesses found, which mirror
  answered

**Enrichment, per business**
- Does it have a website, and is that site live, dead, parked, or a social page
  standing in for one
- Emails (including Cloudflare-obfuscated addresses and `name (at) domain (dot) com`
  obfuscation), phone numbers normalised to E.164, and WhatsApp links
- Social profiles across Instagram, Facebook, TikTok, YouTube, X, LinkedIn, Pinterest,
  Threads, Telegram, plus link-in-bio hubs
- Follower counts where they can honestly be obtained, with a stated reason where they
  cannot
- Whether the business already publishes video

**Ranking**
- A deterministic 0–100 score with the reasoning shown on every lead
- A business *verified* to have no website always outranks one with a working site
- A business we could not fully check can never outrank one we did: the score is
  multiplied by a confidence factor derived from how much of the business was actually
  inspected, so unknowns can never be mistaken for signal
- Switchable offer presets re-rank everything if you sell social media rather than
  websites

**Outreach workspace**
- Today's to-do list with tick and un-tick; counts and the weekly chart are derived
  from the list, so un-ticking reverts them exactly
- Pipeline stages per business (new → contacted → replied → won/lost)
- Notes, CSV export that respects your filters, and a dashboard with KPI tiles and a
  weekly activity chart
- A built-in guided tour covering every part of the app

---

## Requirements

- **Node.js 22.5 or newer** (uses `node:sqlite` as a fallback path and modern fetch)
- Windows, macOS or Linux
- An internet connection for discovery and enrichment

No database server, no Docker, no cloud account.

---

## Quick start

```bash
git clone https://github.com/Stormynubee/outreach-os.git
cd outreach-os
npm install
npm run dev
```

Open <http://localhost:5173> and set your contact in **Settings** (see below).

To run the production build in a single process on port 4317:

```bash
npm run build
npm start
```

### Set your contact before searching

Both OpenStreetMap services require every request to identify a real contact, and they
block clients that do not. **Discovery is disabled until you set one.** The app enforces
this up front, because the alternative is a bare `403 Access denied` with no
explanation.

- A real email address is best: `you@yourdomain.com`
- A URL also works: `https://github.com/you`
- **Placeholders are rejected.** `anything@example.com` is blocked by OpenStreetMap
  outright, so the app refuses it and tells you why

It is only ever sent as part of an honest `User-Agent` string. The app never
impersonates a browser.

---

## How it works

```
location text
   │
   ├─ Nominatim ──────────► bounding box + OSM relation  (cached forever; 1 req/sec)
   │
   ├─ Overpass ───────────► businesses in the area, tile by tile, sequentially
   │                        capped tiles split into quarters and retried smaller
   │                        empty results cross-checked against a second mirror
   │
   ├─ enrich (queued) ────► probe site ─► scrape contacts ─► check socials
   │                        domain-bucketed: 1 request at a time, ≥1.2s apart
   │
   ├─ score ──────────────► web gap + contactability + presence, × confidence
   │
   └─ SQLite ─────────────► leads, contacts, socials, tasks, caches, job queue
```

Every stage writes partial results and never throws into the job runner, so a business
that cannot be reached is still a lead — with the reason recorded.

The scoring weights live in `packages/shared/src/score.ts` and are compiled into a SQL
expression at runtime, so a bulk re-rank and the API agree by construction. A test
matrix asserts the SQL and TypeScript implementations produce identical scores across
every combination of state, preset, contact flags, follower tier and enrichment stage.

---

## Honest limitations

These are real constraints of collecting this data for free, not bugs. They are
surfaced in the interface rather than hidden.

| Platform | Follower counts | Why |
|---|---|---|
| YouTube | **Reliable** | Public channel pages expose the subscriber count |
| TikTok | Sometimes | Occasionally readable from the logged-out page |
| Facebook | Sometimes | Occasionally readable from the public page |
| Instagram | Rarely | Login-walled; usually not readable at all |
| X / Twitter | Never attempted | Login-walled, no public endpoint |
| LinkedIn | Never attempted | Their terms forbid automated collection |

Missing values show as **unknown with a reason**, and every social account has a manual
override. A number you enter by hand is never overwritten by a later scrape — the
scraper writes to a separate column and the override always wins.

Presence is always recorded even when the count is not: presence is the sales signal,
the count is a bonus.

**No automated sending.** This tool tracks outreach you do yourself. It does not send
email or direct messages and has no bulk-messaging feature.

---

## Fair use

Free OpenStreetMap infrastructure is donated, and the app is deliberately a good
citizen. This is enforced in code, not just documented:

- Honest `User-Agent` identifying the app and your contact
- `robots.txt` fetched and obeyed, including `Crawl-delay`; a site that disallows us is
  still recorded as a lead, just not scraped
- One request at a time per domain with a minimum 1.2s gap; social platforms get their
  own stricter limits
- Overpass queries are strictly sequential, because their policy forbids parallel
  scripts from one application
- On `429`/`406` the client pauses for 30 seconds instead of retrying immediately
- Nominatim is called at most once per location string and cached permanently; their
  policy requires caching and forbids repeat queries
- **No autocomplete.** Nominatim forbids it, so the location field never queries while
  you type and suggestions come from a bundled offline city list
- Never circumvents a login wall or a paywall

Data is © OpenStreetMap contributors, available under the
[Open Database License](https://www.openstreetmap.org/copyright). Attribution and the
map data timestamp are shown in the app footer, as both services require.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API and UI with hot reload |
| `npm run build` && `npm start` | Production build served from one process on :4317 |
| `npm test` | Unit and integration tests |
| `npm run typecheck` | Strict TypeScript across both packages |
| `npm run verify:ui` | Mounts the real UI in a DOM and asserts it renders, including the splash and the guided tour |
| `npm run verify` | Confirms the API and built UI serve together and the event stream works |
| `npm run verify:auth` | Checks the access-token gate and CORS |
| `npm run verify:deploy <url>` | Checks a hosted copy: shell, assets, deep links, no leaked secret |
| `npm run verify:engine <url> [token]` | Checks a self-contained deployment that serves its own interface, including that data survives a restart |
| `npm run tunnel` | Publishes the engine over HTTPS (cloudflared) for a hosted interface to reach |
| `npm run e2e` | Full pipeline against a live town, then checks the ranking invariants |
| `npm run smoke` | Verifies the Overpass query shape and geocoding contract still hold |
| `npm run mirrors` | Times the real query against every Overpass mirror |

`npm run e2e` accepts a location: `node scripts/e2e.mjs "Lisbon, Portugal"`.

The end-to-end and smoke scripts make real network requests to OpenStreetMap and to
business websites. They are verification tools, not part of normal use.

---

## Project layout

```
packages/shared   Types, scoring weights and OSM category mappings, shared by API and UI
packages/server   Fastify API, SQLite storage, discovery and enrichment pipeline
packages/web      React + Vite interface
scripts/          Diagnostics and verification
data/app.db       Your database — gitignored. Back this up.
```

**Where your data lives.** A single SQLite file at `data/app.db`. Keep it out of
OneDrive or any synced folder: WAL mode plus cloud sync causes file-lock errors and
corruption. Set `OUTREACH_DB_PATH` to move it elsewhere.

---

## Configuration

Everything is editable in **Settings** and applied without a restart:

- Contact identity, and the offer preset used for ranking
- Overpass mirror list, ranked automatically by measured success rate and latency
- Concurrency, per-domain delays, page budget per site, and robots on/off
- Cache lifetimes per content type

Defaults live in `packages/server/src/settings.ts`.

---

## Deployment

**The engine is a long-running, stateful process and needs a persistent disk.** That
shapes where it can run:

- The enrichment worker runs continuously, and a full discovery plus enrichment pass
  takes minutes to tens of minutes even when the network is fast. The delays are
  deliberate politeness, not slowness to be optimised away.
- All state — the job queue, the response cache, the leads — lives in one SQLite file
  that must survive restarts. It is also the resume mechanism: killing the process
  mid-discovery and restarting it continues from the last completed tile.

So the **engine** runs on your own machine, or on a VPS or container host with a
persistent volume (mount it at `data/` and point `OUTREACH_DB_PATH` at it).

The **interface** is a static build and can be hosted anywhere, including a static
host, as long as it can reach the engine. The engine itself cannot run on a stateless
serverless platform (Vercel, Netlify, Lambda, Cloudflare Workers): there is no
persistent filesystem for the database, no always-on process for the worker, and the
per-domain rate limiting assumes one long-lived scheduler. Vercel's own documentation
puts it plainly — SQLite "can't be used with Vercel".

### Fully independent, one container

There is a `Dockerfile` that builds the engine and the interface into a single image.
One container is the whole app: it serves the interface and the API on the same origin,
so there is nothing to point at anything and no tunnel involved.

```bash
docker build -t outreach-os .
docker run -d -p 4317:4317 -v outreach-data:/data outreach-os
```

That works on any host with a **persistent volume mounted at `/data`** — a container
platform, a VPS, or a spare machine at home. The volume is not optional: it holds both
the SQLite database and the generated access token, so without it every restart starts
from an empty workspace. `npm run verify:engine <url> <token>` checks all of this,
including that data survives a restart.

Environment variables it understands:

| Variable | Purpose |
|---|---|
| `OUTREACH_DATA_DIR` | Where the database and token live. `/data` in the image. |
| `OUTREACH_DB_PATH` | The database file alone, if you want it somewhere else. |
| `OUTREACH_API_TOKEN` | Set the access token explicitly instead of generating one. |
| `OUTREACH_ALLOWED_ORIGINS` | Comma-separated CORS allow-list for a separately hosted interface. |
| `OUTREACH_CONTACT_EMAIL` | Seeds the OSM contact on first boot, so discovery is not disabled. |
| `OUTREACH_DISPLAY_NAME` | Seeds the name shown in the interface. |
| `HOST` / `PORT` | Bind address and port. `HOST=0.0.0.0` in the image. |

On a container platform, remember that the crawler now runs from a datacenter IP.
Cloudflare-protected small-business sites block those more aggressively than a
residential connection, so enrichment may find fewer contacts than it does at home.

### Hosting the interface separately

The interface is served by the engine when you run `npm start`, so for local use there
is nothing to do. To reach it from a hosted copy:

```bash
npm start          # terminal 1 — the engine, on :4317
npm run tunnel     # terminal 2 — a public HTTPS address for it (cloudflared)
```

`npm run tunnel` prints an address like
`https://something-something.trycloudflare.com`. A quick tunnel needs no account, and
the address changes each time it restarts.

Then, in the **hosted** interface, open **Settings → Engine connection**, paste that
address and the access token, and save. The token lives at `data/api-token.txt` and is
printed by the engine on its first start. It is kept in your browser's local storage,
never baked into the deployed bundle.

The hosted copy is a thin client: your machine still does the crawling and still holds
the data, so the tunnel only has to be up while you are using it.

### The access token

The app deliberately has no user accounts — it assumes one trusted operator. That is
safe while it listens only on `127.0.0.1`, but the moment it is reachable through a
tunnel, anyone with the address could read every lead, change the pipeline and make
your machine issue outbound requests.

So the engine issues a token on first start and requires it on every `/api` route
(`/api/health` stays open so a monitor can check liveness). It is accepted as a bearer
header, or as `?token=` for the two cases that cannot set headers: the live event
stream and CSV downloads.

To rotate it, stop the engine, delete `data/api-token.txt` and start it again.

Overpass's usage policy also asks that applications consuming it not be deployed on
fast-deployment platforms, which is worth respecting to keep the service available.

---

## Troubleshooting

**"Could not reach the engine."**
Either the engine is not running, or the address in Settings is stale. Quick tunnel
addresses change every time the tunnel restarts, so update it in
Settings → Engine connection. `npm run verify:auth` checks the engine directly;
`npm run verify:deploy <url>` checks a hosted copy.

**"The engine rejected the request."**
The token in Settings does not match `data/api-token.txt`.

**"The public Overpass mirrors are not responding right now."**
Public Overpass mirrors are heavily loaded and genuinely flaky, and they sometimes
return valid JSON with incomplete data for regions they do not cover. The app tracks
each mirror's success rate and latency, rotates between them, backs off failing ones,
and cross-checks an empty result against a second mirror before believing it. Wait a few
minutes and retry; `npm run mirrors` shows which are healthy.

**Discovery finds nothing for a place that clearly has businesses.**
Usually a mirror problem rather than an empty area — see above. `npm run mirrors` is the
first thing to check.

**A site shows as "blocked".**
It returned 401/403 to an honest bot identifier. That is recorded as a lead rather than
hidden, because it usually means someone actively manages their web presence.

**Windows: `better-sqlite3` fails to install.**
Add exclusions in Windows Defender for this folder and for `node_modules`. Antivirus
scanning of native binaries during install is the usual cause, and it also slows the
app down at runtime.

---

## Development

```bash
npm test          # unit and integration tests
npm run typecheck # strict TypeScript, both packages
npm run verify:ui # renders the real UI in a DOM and checks it works
```

Tests cover the pieces most likely to rot silently: the scoring parity matrix, the
robots.txt parser (RFC 9309 precedence, wildcards, `$` anchors), URL and dedupe-key
normalisation, email de-obfuscation, phone normalisation, the tiling logic, and the
data layer against the real schema.

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

[MIT](./LICENSE) © Hansraj Tiwari

Map data is © OpenStreetMap contributors, licensed under the ODbL. This project is not
affiliated with or endorsed by the OpenStreetMap Foundation.
