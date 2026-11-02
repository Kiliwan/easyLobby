# Deploy checklist

Ordered. Do these in sequence.

## 0. Reuse terms — settled, nothing for you to do

**Verified 2026-09-15. Both sources are cleared for this site. This step is no longer a gate.**

| Source | Licence | Means |
|---|---|---|
| EFK register (the funding data) | **`terms_open`** | Open use. No attribution condition, no commercial restriction. |
| Federal Statistical Office (ballot results) | **`terms_ask`** | Open use, but **commercial** use needs the owner's permission. |

Read from the opendata.swiss CKAN API, which answers automated requests normally — the 403s
seen during design were from its *web pages*, not the API:

```
curl 'https://ckan.opendata.swiss/api/3/action/package_show?id=politikfinanzierung'
```

The one thing to keep in mind: **`terms_ask` binds the results data if this site ever becomes
commercial** — ads, sponsorship, paid access. As a free public-interest site nothing is required.
If that changes, ask the Federal Statistical Office first, or drop the result bars. The funding
data, which is the point of the project, is unrestricted either way.

## 1. Confirmed values — verify they still match at push time

These are filled in for GitHub user `Kiliwan`, repo `easyLobby`. `base` is case-sensitive and
preserves the repo's exact casing (GitHub lowercases only the *subdomain*, `kiliwan.github.io`)
— get it wrong and every internal link 404s.

| Value | File : line | Current value |
|---|---|---|
| `site` | `site/astro.config.mjs:4` | `https://kiliwan.github.io` |
| `base` | `site/astro.config.mjs:5` | `/easyLobby` (exact case) |
| `USER_AGENT` contact | `ingest/src/config.ts:9` | `+https://github.com/Kiliwan/easyLobby` — repo URL, deliberately not a personal email (see below) |
| default branch name | `.github/workflows/deploy.yml:5` | `branches: [main]` — confirm this matches the repo's actual default branch |

**Why the `USER_AGENT` is a repo URL, not an email:** a personal address would sit in a
government server's request logs and in a public repo indefinitely. A repository URL is the
normal convention for a polite crawler's contact and gives a sysadmin who wants to complain
somewhere to open an issue — same intent as spec §5.3, without exposing an inbox.

If any of these ever change (fork, rename, transfer), update `site/astro.config.mjs` and
`ingest/src/config.ts` together and rebuild — a stale `base` silently breaks every link, and
`astro build` will not catch it because there's nothing to compare against.

## 2. Create the repository

- Create it on GitHub. **It must be public** — GitHub Pages requires a paid plan for private-repo
  Pages, and this project assumes the free tier.
- Push this working tree (`git init`, `git add`, `git commit`, add the remote, push) — that part
  is on you, not automated by anything here.

## 3. Enable Pages

**Settings → Pages → Source: "GitHub Actions"**. Easy to miss, and if skipped, `deploy.yml`'s
`actions/deploy-pages` step fails with an unhelpful error.

## 4. First ingest run

Data isn't fetched yet on a fresh checkout beyond what's already committed under `data/raw/` and
`data/snapshots/`. To refresh it live:

```
gh workflow run ingest.yml
```

or trigger it from the Actions tab (`ingest` → Run workflow). Watch it — a cold run against all
~490 in-scope forms takes on the order of 20 minutes at the enforced 1.5s/request pace. It
commits `data/snapshots/`, `data/history/`, `data/raw/` (including `data/raw/results/`),
`data/slugs.json` and `data/vorlagen.json` back to the repo only if they changed, which in turn
triggers `deploy.yml`.

The same run also refreshes the official ballot results from the Federal Statistical Office —
a handful of extra requests to a static CDN, not to the register. That source has its own
licence (`terms_ask`: open use, commercial use by permission) — see step 0.

## 5. First deploy

If you don't want to wait for step 4 to trigger it, run it directly:

```
gh workflow run deploy.yml
```

or push any commit to the default branch. It rebuilds `data/normalised/votes.json` from the
committed cache (no network access), runs the test suite, builds the site, and publishes to
Pages. **A failed contract check or any structural violation from `from-cache` fails this
workflow and blocks the deploy** — that's deliberate, see `README.md` and spec §10.

## 6. Enable the crons — now unblocked, but still your call

Both `ingest.yml` and `contract.yml` are `workflow_dispatch`-only: nothing runs unattended. The
reason for that was the open licence question in step 0, **which is now settled** — so the gate
is gone. Enabling them is a deliberate choice to start a daily crawl of a federal server, so it
stays a manual edit rather than something a deploy turns on for you.

To enable unattended daily runs, uncomment:

- `.github/workflows/ingest.yml` — the `schedule:` block with `cron: '0 4 * * *'` (06:00 CEST /
  05:00 CET)
- `.github/workflows/contract.yml` — the `schedule:` block with `cron: '30 3 * * *'` (30 min
  before ingest)

## 7. After the first deploy, check

- The site loads at `https://kiliwan.github.io/easyLobby/`.
- `/de/`, `/fr/`, `/it/` all resolve, and internal links between them don't 404 (catches a wrong
  `base`).
- Open one detail page and compare it against the design mockup — Yes/No bar, donor breakdown,
  source link back to the EFK register, "as declared, unaudited" disclaimer.
- The Actions tab shows green runs for `ingest` (if you ran it) and `deploy`.

## Reference

- Design spec: `docs/superpowers/specs/2026-09-09-swiss-campaign-finance-design.md` (§9 hosting,
  §11 licence)
- `README.md` — what the project is and how to run it locally
