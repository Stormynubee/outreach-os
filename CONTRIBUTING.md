# Contributing

Thanks for taking a look. This project has a few firm rules, and they exist for
reasons worth understanding before changing anything.

## Getting set up

```bash
git clone https://github.com/Stormynubee/outreach-os.git
cd outreach-os
npm install
npm run dev        # API on :4317, interface on http://localhost:5173
```

Set your contact in **Settings** before searching — OpenStreetMap blocks clients that
do not identify a real contact, and rejects placeholder addresses outright.

## Before you open a pull request

```bash
npm run typecheck   # strict TypeScript, both packages
npm test            # unit and integration tests
npm run build       # the interface must build
npm run verify:ui   # the interface must actually render
```

All four must pass. CI runs them on Linux and Windows across Node 22 and 24.

## Rules that are not negotiable

These are enforced in code and reviewed carefully, because breaking them gets the
project's users rate limited or blocked:

- **Never spoof a browser.** The `User-Agent` identifies this application and the
  user's contact. It is not a disguise.
- **Always obey `robots.txt`**, including `Crawl-delay`.
- **Never add parallel Overpass requests.** Their policy forbids parallel scripts from
  one application, and the tile loop is sequential on purpose.
- **Never add parallel requests to one domain.** Per-domain serialisation with a
  minimum delay is the politeness guarantee. Social platforms have their own limits.
- **Never add autocomplete to the location field.** Nominatim forbids it explicitly.
  Suggestions come from the bundled offline gazetteer and the user's own search history.
- **Never attempt to read a platform that forbids or walls it** (LinkedIn, X). Report
  `unknown` with a reason instead.
- **Never invent a data point.** If a follower count cannot be obtained, say so. An
  honest gap is worth more than a plausible number.

## Design conventions worth keeping

- **Scores are computed twice on purpose** — once in TypeScript and once compiled into
  a SQL expression — so a bulk re-rank and the API cannot disagree. If you change a
  weight, change it in `packages/shared/src/score.ts` and the parity test will keep both
  implementations honest.
- **Unknown data must never look like signal.** Anything we could not check multiplies
  the score down through the confidence factor rather than scoring as a default.
- **Prefer deriving to incrementing.** Daily counters are rebuilt from the task list,
  so un-ticking a task reverts every number exactly. Hand-maintained counters drift.
- **Partial results beat no results.** Every enrichment stage records what it found and
  why it stopped; nothing throws into the job runner.
- **Say why, in the interface.** Readiness blocks, blocked sites and missing follower
  counts all explain themselves where the user meets them.

## Scraping changes

If you touch the fetching or parsing code, expect to explain:

1. How the change stays within the rules above.
2. What happens when the site is unreachable, blocked, or returns nonsense.
3. That partial results are still recorded.

Add a test for the parsing logic where you can — the existing suites for robots.txt,
URL normalisation, email de-obfuscation, phone normalisation and tiling are the model
to follow.

## Reporting bugs

Include your operating system, Node version, what you did, what you expected, and what
happened. If it involves discovery, `npm run mirrors` output is genuinely useful,
because the public Overpass mirrors are flaky and often the real culprit.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](./LICENSE).
