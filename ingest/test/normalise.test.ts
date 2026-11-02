import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { joinLabels } from '../src/join.js'
import { donorKey, type DonorObservation } from '../src/lifecycle.js'
import type { FormResponse } from '../src/model.js'
import { normalise } from '../src/normalise.js'
import { electionIds, inScopeRoots } from '../src/scope.js'
import { assignSlugs } from '../src/slugs.js'
import { splitRootLabel } from '../src/dates.js'
import type { RawNode, TreeResponse } from '../src/tree.js'

const load = (p: string) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as TreeResponse
const fr = load('./fixtures/trees/fr-campaign_financings.json')
const de = load('./fixtures/trees/de-campaign_financings.json')
const roots = inScopeRoots(fr, electionIds(load('./fixtures/trees/fr-exports-elections.json')))

const formsDir = fileURLToPath(new URL('./fixtures/forms/', import.meta.url))
const forms = new Map<string, FormResponse>()
for (const name of readdirSync(formsDir)) {
  if (!name.endsWith('.json')) continue
  forms.set(name.replace(/\.json$/, ''), JSON.parse(readFileSync(join(formsDir, name), 'utf8')))
}

const slugs = assignSlugs({}, roots.map((r) => ({ id: r.id, frenchTitle: splitRootLabel(r.label).title })))

const { output, violations } = normalise({
  roots,
  labels: joinLabels({ fr, de }),
  forms,
  slugs,
  generatedAt: '2026-09-09T04:12:03Z',
})

const vote = (id: number) => output.votes.find((v) => v.id === id)!

describe('normalise', () => {
  it('emits all 29 in-scope votations, newest ballot date first', () => {
    expect(output.votes).toHaveLength(29)
    const dates = output.votes.map((v) => v.ballotDate)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('reports no structural violations', () => {
    expect(violations).toEqual([])
  })

  it('computes object 28 side totals from the real fixtures', () => {
    const v = vote(28)
    expect(v.stage).toBe('final')
    expect(v.totals.yes.budget).toBe(659_250_000)
    expect(v.totals.yes.final).toBe(665_491_817)
    expect(v.totals.no.budget).toBe(958_238_600)
    expect(v.totals.no.final).toBe(961_136_639)
  })

  it('does not double a filer name repeated across natural_first_name and natural_name (object 28, form 580/92)', () => {
    const donors = vote(28).committees.flatMap((c) => c.donors)
    expect(donors.some((d) => d.name === 'Urs Murbach und Theresa Nussbaum')).toBe(true)
    expect(donors.some(
      (d) => d.name === 'Urs Murbach und Theresa Nussbaum Urs Murbach und Theresa Nussbaum',
    )).toBe(false)
  })

  it('keeps donor names verbatim — economiesuisse is NOT merged', () => {
    const names = vote(28).committees.flatMap((c) => c.donors.map((d) => d.name))
    expect(names).toContain('economiesuisse')
    expect(names).toContain('Economiesuisse')
  })

  it('formats a natural person as first name then surname', () => {
    const donors = vote(28).committees.flatMap((c) => c.donors)
    const blocher = donors.find((d) => d.name === 'Christoph Blocher')!
    expect(blocher.kind).toBe('natural_monetary')
    expect(blocher.city).toBe('Herrliberg')
    expect(blocher.date).toBe('2026-06-24')
    expect(blocher.amount).toBe(13_333_265)
  })

  it('computes the undeclared remainder per committee from the display-stage donors only', () => {
    const c = vote(28).committees.find((x) => x.id === 579)!
    expect(c.side).toBe('yes')
    expect(c.final).toBe(617_306_158)
    expect(c.displayStage).toBe('final')
    expect(c.namedDonorTotal).toBe(514_808_616)
    expect(c.undeclaredRemainder).toBe(102_497_542)
    expect(c.namedDonorTotal + c.undeclaredRemainder!).toBe(c.final)
  })

  it('sorts the display-stage donor subset by amount, largest first', () => {
    const c = vote(28).committees.find((x) => x.id === 579)!
    const displayed = c.donors.filter((d) => d.stage === c.displayStage)
    expect(displayed.map((d) => d.amount)).toEqual([
      270_000_000, 105_000_000, 81_475_351, 25_000_000, 13_333_265, 10_000_000, 10_000_000,
    ])
  })

  it('keeps every parsed donor across both stages, not just the displayed subset', () => {
    const c = vote(28).committees.find((x) => x.id === 579)!
    expect(c.donors).toHaveLength(18)
    const budgetCount = c.donors.filter((d) => d.stage === 'budget').length
    const finalCount = c.donors.filter((d) => d.stage === 'final').length
    expect(budgetCount).toBe(11)
    expect(finalCount).toBe(7)
  })

  it('retains a donor declared at budget stage but absent from the final accounts', () => {
    const c = vote(28).committees.find((x) => x.id === 579)!
    const matter = c.donors.find((d) => d.name === 'Thomas Matter')!
    expect(matter).toBeDefined()
    expect(matter.stage).toBe('budget')
    expect(matter.amount).toBe(25_000_000)
    expect(c.displayStage).toBe('final')
    expect(c.donors.filter((d) => d.stage === c.displayStage).some((d) => d.name === 'Thomas Matter')).toBe(false)
  })

  it('attaches null firstSeenAt/withdrawnAt to a donor with no observation', () => {
    const c = vote(28).committees.find((x) => x.id === 579)!
    const blocher = c.donors.find((d) => d.name === 'Christoph Blocher')!
    expect(blocher.firstSeenAt).toBeNull()
    expect(blocher.withdrawnAt).toBeNull()
  })

  it('attaches an observation to the matching donor by key', () => {
    const matterEntry = {
      natural_first_name: 'Thomas', natural_name: 'Matter', natural_city: 'Meilen',
      living_abroad: false, value: "250'000.00", date: '29.04.2026',
    }
    const observations = new Map<string, DonorObservation>([
      [donorKey(579, 92, matterEntry), { firstSeenAt: '2026-09-10', withdrawnAt: '2026-09-14' }],
    ])
    const { output } = normalise({
      roots, labels: joinLabels({ fr, de }), forms, slugs,
      generatedAt: '2026-09-09T04:12:03Z', observations,
    })
    const c = output.votes.find((v) => v.id === 28)!.committees.find((x) => x.id === 579)!
    const matter = c.donors.find((d) => d.name === 'Thomas Matter')!
    expect(matter.firstSeenAt).toBe('2026-09-10')
    expect(matter.withdrawnAt).toBe('2026-09-14')
  })

  it('does not let a withdrawn donor change namedDonorTotal or undeclaredRemainder', () => {
    const matterEntry = {
      natural_first_name: 'Thomas', natural_name: 'Matter', natural_city: 'Meilen',
      living_abroad: false, value: "250'000.00", date: '29.04.2026',
    }
    const observations = new Map<string, DonorObservation>([
      [donorKey(579, 92, matterEntry), { firstSeenAt: '2026-09-10', withdrawnAt: '2026-09-14' }],
    ])
    const { output } = normalise({
      roots, labels: joinLabels({ fr, de }), forms, slugs,
      generatedAt: '2026-09-09T04:12:03Z', observations,
    })
    const c = output.votes.find((v) => v.id === 28)!.committees.find((x) => x.id === 579)!
    expect(c.namedDonorTotal).toBe(514_808_616)
    expect(c.undeclaredRemainder).toBe(102_497_542)
  })

  it('marks objects with no filings as stage "none" with no committees', () => {
    for (const id of [33, 34, 35, 36, 23]) {
      expect(vote(id).stage).toBe('none')
      expect(vote(id).committees).toEqual([])
    }
  })

  it('carries a slug and a source URL for every vote', () => {
    for (const v of output.votes) {
      expect(v.slug).toMatch(/^[a-z0-9-]+$/)
      expect(v.sourceUrl).toBe(
        `https://politikfinanzierung.efk.admin.ch/app/fr/campaign-financings/${v.id}`,
      )
    }
  })

  it('carries all three language titles', () => {
    const t = vote(28).titles
    expect(t.fr).toContain('Pas de Suisse à 10 millions')
    expect(t.de).toContain('Keine 10-Millionen-Schweiz')
    expect(t.it).toBeTruthy()
  })

  it('leaves amounts null where no payload is cached', () => {
    const uncached = output.votes.find((v) => v.committees.some((c) => c.budget === null && c.final === null))
    expect(uncached).toBeDefined()
  })

  it('survives a poisoned donor amount ("1\'000.--"), reports a violation, drops only that entry, and keeps building the other 28 votes', () => {
    const poisoned = new Map(forms)
    const original = poisoned.get('550_102')!
    const mutated: FormResponse = {
      ...original,
      data: {
        ...original.data,
        form_data: {
          ...original.data.form_data,
          allowances: {
            ...original.data.form_data.allowances,
            juristic_monetary: [
              { ...original.data.form_data.allowances!.juristic_monetary![0]!, value: "1'013'589.--" },
              ...original.data.form_data.allowances!.juristic_monetary!.slice(1),
            ],
          },
        },
      },
    }
    poisoned.set('550_102', mutated)

    const result = normalise({
      roots, labels: joinLabels({ fr, de }), forms: poisoned, slugs,
      generatedAt: '2026-09-09T04:12:03Z',
    })

    expect(result.output.votes).toHaveLength(29)
    expect(result.violations).toContainEqual(
      expect.objectContaining({ rule: 'donor_amount_parseable' }),
    )

    const committee550 = result.output.votes.flatMap((v) => v.committees).find((c) => c.id === 550)!
    const finalDonors = committee550.donors.filter((d) => d.stage === 'final')
    expect(finalDonors.some((d) => d.name === 'economiesuisse' && d.amount === 101_358_950)).toBe(false)
    expect(finalDonors.some((d) => d.name === 'Avenergy Suisse')).toBe(true)
  })

  it('survives an unrecognised sixth form label, reports a violation, and keeps building the other 28 votes', () => {
    const withRelabelledForm: RawNode[] = JSON.parse(JSON.stringify(roots))
    let relabelled = false
    const recurse = (nodes: RawNode[]) => {
      for (const node of nodes) {
        if (node.type === 'form' && node.campaign_id === 550 && node.id === 102) {
          node.label = 'Déclaration de quelque chose de nouveau'
          relabelled = true
        }
        if (node.children) recurse(node.children)
      }
    }
    recurse(withRelabelledForm)
    expect(relabelled).toBe(true)

    const result = normalise({
      roots: withRelabelledForm, labels: joinLabels({ fr, de }), forms, slugs,
      generatedAt: '2026-09-09T04:12:03Z',
    })

    expect(result.output.votes).toHaveLength(29)
    expect(result.violations).toContainEqual(
      expect.objectContaining({ rule: 'form_label_recognised' }),
    )
  })

  it('survives a poisoned totals value, reports a violation, and keeps building the other 28 votes', () => {
    const poisoned = new Map(forms)
    const original = poisoned.get('607_111')!
    poisoned.set('607_111', {
      ...original,
      data: {
        ...original.data,
        form_data: { ...original.data.form_data, totals: { total: "1'000.--" } },
      },
    })

    const result = normalise({
      roots, labels: joinLabels({ fr, de }), forms: poisoned, slugs,
      generatedAt: '2026-09-09T04:12:03Z',
    })

    expect(result.output.votes).toHaveLength(29)
    expect(result.violations).toContainEqual(
      expect.objectContaining({ rule: 'form_total_parseable' }),
    )
  })

  it('keeps a donor whose date is malformed, with a null date, instead of dropping the money', () => {
    const poisoned = new Map(forms)
    const original = poisoned.get('550_102')!
    const mutated: FormResponse = {
      ...original,
      data: {
        ...original.data,
        form_data: {
          ...original.data.form_data,
          allowances: {
            ...original.data.form_data.allowances,
            juristic_monetary: [
              { ...original.data.form_data.allowances!.juristic_monetary![0]!, date: '31.13.2026' },
              ...original.data.form_data.allowances!.juristic_monetary!.slice(1),
            ],
          },
        },
      },
    }
    poisoned.set('550_102', mutated)

    const result = normalise({
      roots, labels: joinLabels({ fr, de }), forms: poisoned, slugs,
      generatedAt: '2026-09-09T04:12:03Z',
    })

    expect(result.output.votes).toHaveLength(29)
    expect(result.violations).toContainEqual(
      expect.objectContaining({ rule: 'donor_date_parseable' }),
    )
    const committee550 = result.output.votes.flatMap((v) => v.committees).find((c) => c.id === 550)!
    const economiesuisseFinal = committee550.donors.find(
      (d) => d.name === 'economiesuisse' && d.amount === 101_358_950,
    )
    expect(economiesuisseFinal).toBeDefined()
    expect(economiesuisseFinal!.date).toBeNull()
  })

  it('skips a root whose label lacks the date prefix, reports a violation, and keeps the rest', () => {
    const malformed: RawNode = { id: 999_001, label: 'No date prefix here', type: 'election', children: [] }
    const withBadRoot = [...roots, malformed]

    const result = normalise({
      roots: withBadRoot,
      labels: joinLabels({ fr, de }),
      forms,
      slugs,
      generatedAt: '2026-09-09T04:12:03Z',
    })

    expect(result.output.votes).toHaveLength(29)
    expect(result.output.votes.find((v) => v.id === 999_001)).toBeUndefined()
    expect(result.violations).toContainEqual(
      expect.objectContaining({ rule: 'root_label_date_prefix' }),
    )
  })
})
