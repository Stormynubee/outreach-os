## What this changes

<!-- One or two sentences. Link the issue it closes, if there is one. -->

## Why

<!-- The problem this solves. -->

## How it was verified

<!--
Tick what you ran. See CONTRIBUTING.md for the full list.
-->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run verify:ui`
- [ ] Ran it by hand and checked the behaviour

## Rules checklist

- [ ] Compared the UI against the reference style, if this touches the interface
- [ ] Does not add parallel requests to a single domain
- [ ] Does not add autocomplete to the location field
- [ ] Does not add scraping for a platform that forbids or walls it
- [ ] Reports unknown data as unknown, with a reason, rather than a default
- [ ] If scoring changed, the TypeScript and SQL implementations still agree

## Notes for the reviewer

<!-- Anything you are unsure about, or deliberately left out. -->
