import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFromCache } from '../src/buildFromCache.js'
import type { TreeResponse } from '../src/tree.js'

const electionLikeRoot = {
  id: 2,
  label: '02.03.2026 Élection au Conseil des États (Test)',
  type: 'campaign_financing',
}

const fr: TreeResponse = {
  data: {
    tree_roots: [
      {
        id: 1,
        label: '01.03.2026 Test Vote',
        type: 'campaign_financing',
        children: [
          {
            id: 10,
            label: 'Comités',
            type: 'category',
            children: [
              {
                id: 100,
                label: 'Comité Yes',
                type: 'actor',
                children: [
                  {
                    id: 1000,
                    label: "Adoption de l'objet",
                    type: 'campaign',
                    children: [
                      {
                        id: 10000,
                        label: 'Déclaration des recettes budgétées',
                        type: 'form',
                      },
                      {
                        id: 10001,
                        label: 'Déclaration de libéralités supérieures à 15 000 francs',
                        type: 'form',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      electionLikeRoot,
    ],
  },
}

const de: TreeResponse = {
  data: {
    tree_roots: [
      {
        id: 1,
        label: '01.03.2026 Testabstimmung',
        type: 'campaign_financing',
        children: [
          {
            id: 10,
            label: 'Komitees',
            type: 'category',
            children: [
              {
                id: 100,
                label: 'Komitee Ja',
                type: 'actor',
                children: [
                  {
                    id: 1000,
                    label: "Adoption de l'objet",
                    type: 'campaign',
                    children: [
                      { id: 10000, label: 'Déclaration des recettes budgétées', type: 'form' },
                      {
                        id: 10001,
                        label: 'Déclaration de libéralités supérieures à 15 000 francs',
                        type: 'form',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { ...electionLikeRoot, label: '02.03.2026 Ständeratswahl (Test)' },
    ],
  },
}

const totalsForm = {
  data: {
    label: 'Déclaration des recettes budgétées',
    actor_label: 'Comité Yes',
    form_data: { totals: { total: '100000.00' } },
  },
  meta: { data_checksum_sha256: 'a'.repeat(64) },
}

const allowancesForm = {
  data: {
    label: 'Déclaration de libéralités supérieures à 15 000 francs',
    actor_label: 'Comité Yes',
    form_data: {
      allowances: {
        natural_monetary: [
          {
            natural_first_name: 'Jane', natural_name: 'Doe', natural_city: 'Bern',
            value: "20'000.00", date: '01.01.2026',
          },
        ],
      },
    },
  },
  meta: { data_checksum_sha256: 'b'.repeat(64) },
}

const noElections: TreeResponse = { data: { tree_roots: [] } }
const excludeElectionLikeRoot: TreeResponse = { data: { tree_roots: [electionLikeRoot] } }

function cacheDir(opts: { elections?: TreeResponse; fr?: TreeResponse; de?: TreeResponse } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'scf-cache-'))
  const writeTree = (lang: string, tree: TreeResponse) => {
    const d = join(dir, 'raw', 'trees', lang)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'campaign_financings.json'), JSON.stringify(tree), 'utf8')
  }
  writeTree('fr', opts.fr ?? fr)
  writeTree('de', opts.de ?? de)

  const formsDir = join(dir, 'raw', 'forms')
  mkdirSync(formsDir, { recursive: true })
  writeFileSync(join(formsDir, '1000_10000.json'), JSON.stringify(totalsForm), 'utf8')
  writeFileSync(join(formsDir, '1000_10001.json'), JSON.stringify(allowancesForm), 'utf8')

  if (opts.elections) {
    writeFileSync(join(dir, 'raw', 'elections.json'), JSON.stringify(opts.elections), 'utf8')
  }

  return dir
}

describe('buildFromCache', () => {
  it('normalises a cache directory with two language trees and a couple of forms', async () => {
    const dir = cacheDir({ elections: excludeElectionLikeRoot })
    const result = await buildFromCache({
      dataDir: dir,
      now: new Date('2026-09-10T04:00:00Z'),
    })

    expect(result.violations).toEqual([])
    expect(result.formsCached).toBe(2)
    expect(result.output.votes).toHaveLength(1)

    const vote = result.output.votes[0]!
    expect(vote.id).toBe(1)
    expect(vote.stage).toBe('budget')
    expect(vote.committees).toHaveLength(1)

    const committee = vote.committees[0]!
    expect(committee.side).toBe('yes')
    expect(committee.budget).toBe(10_000_000)
    expect(committee.donors).toHaveLength(1)

    const donor = committee.donors[0]!
    expect(donor.name).toBe('Jane Doe')
    expect(donor.amount).toBe(2_000_000)
    expect(donor.firstSeenAt).toBeNull()
    expect(donor.withdrawnAt).toBeNull()
    expect(committee.namedDonorTotal).toBe(2_000_000)
    expect(committee.undeclaredRemainder).toBe(8_000_000)
  })

  it('writes votes.json and meta.json into the cache directory', async () => {
    const dir = cacheDir({ elections: excludeElectionLikeRoot })
    await buildFromCache({
      dataDir: dir,
      now: new Date('2026-09-10T04:00:00Z'),
    })

    const votes = JSON.parse(readFileSync(join(dir, 'normalised', 'votes.json'), 'utf8'))
    expect(votes.votes).toHaveLength(1)

    const meta = JSON.parse(readFileSync(join(dir, 'normalised', 'meta.json'), 'utf8'))
    expect(meta.votes).toBe(1)
    expect(meta.formsCached).toBe(2)
    expect(meta.formsFetched).toBe(0)
    expect(meta.violations).toEqual([])
  })

  it('throws a clear, actionable error when the elections export is not cached', async () => {
    const dir = cacheDir()
    await expect(buildFromCache({ dataDir: dir, now: new Date('2026-09-10T04:00:00Z') }))
      .rejects.toThrow(/elections/i)
    await expect(buildFromCache({ dataDir: dir, now: new Date('2026-09-10T04:00:00Z') }))
      .rejects.toThrow(/ingest/i)
  })

  it('does not silently fall back to any default when the elections export is missing', async () => {
    const dir = cacheDir()
    await expect(buildFromCache({ dataDir: dir, now: new Date('2026-09-10T04:00:00Z') }))
      .rejects.toThrow()
    expect(existsSync(join(dir, 'normalised', 'votes.json'))).toBe(false)
  })

  it('excludes a root id present in the cached elections export from the vote scope', async () => {
    const dir = cacheDir({ elections: excludeElectionLikeRoot })
    const result = await buildFromCache({
      dataDir: dir,
      now: new Date('2026-09-10T04:00:00Z'),
    })
    expect(result.output.votes.map((v) => v.id)).toEqual([1])
  })

  it('includes the election-like root when the cached elections export does not name it', async () => {
    const dir = cacheDir({ elections: noElections })
    const result = await buildFromCache({
      dataDir: dir,
      now: new Date('2026-09-10T04:00:00Z'),
    })
    expect(result.output.votes.map((v) => v.id).sort()).toEqual([1, 2])
  })

  it('survives a root with a malformed (no date prefix) label rather than crashing', async () => {
    const malformedRoot = { id: 999_001, label: 'No date prefix here', type: 'campaign_financing' }
    const frWithBadRoot: TreeResponse = {
      data: { tree_roots: [...fr.data.tree_roots, malformedRoot] },
    }
    const deWithBadRoot: TreeResponse = {
      data: { tree_roots: [...de.data.tree_roots, malformedRoot] },
    }
    const dir = cacheDir({
      elections: excludeElectionLikeRoot, fr: frWithBadRoot, de: deWithBadRoot,
    })

    const result = await buildFromCache({ dataDir: dir, now: new Date('2026-09-10T04:00:00Z') })

    expect(result.output.votes.map((v) => v.id)).toEqual([1])
    expect(result.violations.map((v) => v.rule)).toContain('root_label_date_prefix')
  })
})
