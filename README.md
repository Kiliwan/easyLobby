# easyLobby

A static, three-language website answering, per federal ballot object: how much money is
behind Yes, how much behind No, and who provided it — sourced from the Swiss Federal
Audit Office's (EFK/CDF) campaign-financing register.

Since 23 October 2022, organisations and individuals spending more than CHF 50 000 on a
federal popular-vote campaign must declare their income and donors to the EFK at
`politikfinanzierung.efk.admin.ch`. That register is a four-level expand-collapse tree with
the numbers hidden a click deep. This project republishes the vote-campaign subset as one
screen per ballot object: a full-width Yes/No bar on the index, a mirrored donor breakdown on
the detail page.

## Data source and licence

Data comes from the EFK's undocumented JSON API. It requires no authentication and is fetched
under a `User-Agent` identifying this project.

**Licence: open use** (verified 2026-09-15). The dataset *Financement de la vie politique*,
published by the Contrôle fédéral des finances with `politikfinanzierung.efk.admin.ch` as its
landing page, carries [`terms_open`](https://opendata.swiss/terms-of-use) on opendata.swiss —
the most permissive of the four terms: no attribution condition, no commercial restriction.
Read from the CKAN API (`package_show?id=politikfinanzierung`).

Attribution is given anyway — every figure links to its source page on the register — because
it is the right thing for a transparency site, not because the licence demands it.

### Ballot results (second source)

Alongside the funding declarations, each object carries its official result from the **Federal
Statistical Office**: one JSON per ballot date at `ogd-static.voteinfo-app.ch`, a static CDN with
no relation to the EFK register. Licence on opendata.swiss is `terms_ask` — open use, but
**commercial** use requires the owner's permission, which is stricter than the EFK data's
`terms_open`.

Cheap by construction: a date whose result is fully counted is never re-fetched, so a steady-state
run costs 1–2 requests. Only the reduced national extract is stored (`data/raw/results/<date>.json`,
~4 KB each); the raw files are 2–6 MB because they carry every commune. `data/vorlagen.json` freezes
the object↔result mapping once matched, so title matching never re-decides a mapping it already holds.

If that source is unreachable, the ingest logs `RESULTS STEP SKIPPED`, keeps the cached results
and **completes normally** — a results outage must never cost a register crawl.

#### Two interpretation choices worth knowing about

An initiative and its direct counter-project are **one object in the register** (single binary
for/against) but **several ballot questions in the results**. Two points follow that the data
cannot settle. Both were decided deliberately:

- **Declared funding is attributed to the main object** (the initiative). The register has no
  field saying which of the two questions a committee backed. Safe to hold because a third
  campaign position would make `classifySide` throw rather than mis-file the money.
- **The subsidiary question keeps the source's own yes/no labels**, not initiative/counter-project.
  The mapping is plausible from the numbers but undocumented, and stating it backwards would
  invert the meaning.

The data itself is already public by federal law: it is what organisations and individuals
filed with the EFK, verbatim. No entity resolution, no merging, no commentary. Every figure
links back to its source page on the register, and every page is labelled "as declared,
unaudited" — the EFK checks within its statutory framework, but the filers remain responsible
for the accuracy of what they file.

## Running the ingest

```
npm run ingest
```

Fetches the three-language tree (`de`, `fr`, `it` — the register's `en` endpoint returns
German content byte-for-byte, so English was dropped) plus one form per
in-scope campaign, normalises the result, and writes `data/normalised/votes.json` and
`data/history/`.

### Politeness rules — not negotiable

The ingest talks to a live government server, so its request behaviour is enforced in code,
not left to convention:

- One connection, no concurrency — a sequential loop, never a pool.
- 1.5 s minimum between requests, measured from the end of the previous response.
- A descriptive `User-Agent` carrying a contact URL.
- Exponential backoff on 429/5xx (5 s, 15 s, 45 s), then abort.
- A hard cap of 600 requests per run — a normal run is ~165, so hitting the cap means a bug,
  not a valid case to raise.
- Abort after 5 consecutive failures, leaving the previous day's data intact rather than
  retrying into a storm.
- The site itself never fetches from the EFK — visitors generate zero load on the register.

These exist because the register is a shared, unauthenticated government service with no rate
limit of its own; the ingest is the only thing standing between this project and hammering it.

### Rebuilding from the committed cache

```
npm run from-cache --workspace ingest
```

Rebuilds `data/normalised/votes.json` and `data/normalised/meta.json` purely from what is
already on disk under `data/raw/` and `data/snapshots/` — no network access, no live fetch.
`data/raw/` is committed precisely so this works on a fresh checkout: a CI
deploy step, or anyone who clones the repo, can regenerate the site's data without ever
crawling the EFK register. It fails with a clear error if `data/raw/elections.json` is missing,
since that means the ingest job (`npm run ingest`) has never populated the cache.

### Contract check

```
npm run contract --workspace ingest
```

A live check, run at the start of every ingest (and on its own via the `contract` workflow),
that fetches one tree, two forms and one ballot-result file, and asserts their shape. The API is
undocumented and unversioned — this is expected to fail eventually, and must fail loudly rather
than let a shape change silently produce empty pages. When it fails, the ingest stops before
crawling, nothing is committed, and the site is not redeployed.

The results file is checked here for a specific reason: because the ingest *degrades gracefully*
when that source is unreachable, a change in its payload shape would otherwise be invisible — the
site would keep serving the last cached results indefinitely with nothing failing. The contract
job is what turns that silence into a red build. It asserts the fields a silent regression would
target: `hauptvorlagenId` (counter-project linkage), the French title (matching), the half-canton
counts (cantonal tally), and that vote counts are still numbers.

## Building the site

```
npm run build --workspace site
npm test --workspace site
npm run typecheck --workspace site
```

`site/` reads `data/normalised/votes.json` at build time and renders it with Astro to static
HTML — 3 languages × (1 index + one page per ballot object + 1 about page) + 1 root redirect.
No JavaScript ships on any content page; core content works without it. The root page
(`/`) is a meta-refresh to `/de/` with three visible language links, since static hosting
cannot read `Accept-Language` without JavaScript, and the site ships none.

## Testing

```
npm test --workspaces
```

Runs both workspaces: `ingest` (offline, fixture-based — captured real API responses, no test
touches the network) and `site` (builds the site, then asserts against the built HTML,
including a page-weight report printed to the console).

## Deployment

GitHub Actions builds and publishes the site to GitHub Pages on every push to `main`. A separate,
manually triggered `ingest` workflow runs the contract check, refreshes the data from the EFK
register and commits it back; each successful ingest then redeploys the site automatically.
