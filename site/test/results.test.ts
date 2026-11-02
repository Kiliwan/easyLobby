import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cantonMajorityFailed, loadVotes, resultFor } from '../src/lib/data.js'
import { formatPercent1 } from '../src/lib/format.js'
import { t } from '../src/i18n/index.js'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const page = (p: string) => readFileSync(`${dist}${p}`, 'utf8')
const { votes } = loadVotes()

const slugOf = (id: number) => votes.find((v) => v.id === id)!.slug
const detail = (id: number, lang = 'fr') => page(`${lang}/objet/${slugOf(id)}/index.html`)
const blockOf = (html: string) => /<section class="resblock">[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''

describe('result data', () => {
  it('attaches a result to every past object whose ballot has been counted', () => {
    const withResult = votes.filter((v) => resultFor(v.id) !== null)
    expect(withResult.length).toBeGreaterThanOrEqual(23)
    for (const v of withResult) {
      const bars = resultFor(v.id)!.bars
      expect(bars.some((b) => b.kind === 'main')).toBe(true)
      expect(bars.find((b) => b.kind === 'main')!.counted).toBe(true)
    }
  })

  it('gives no result to a ballot date that has not happened', () => {
    const today = new Date().toISOString().slice(0, 10)
    for (const v of votes.filter((x) => x.ballotDate > today)) {
      expect(resultFor(v.id)).toBeNull()
    }
  })

  it('flags a double-majority failure only when the people said yes and the cantons did not', () => {
    expect(cantonMajorityFailed({ doubleMajority: true, accepted: false, yesPct: 52 })).toBe(true)
    expect(cantonMajorityFailed({ doubleMajority: true, accepted: false, yesPct: 45 })).toBe(false)
    expect(cantonMajorityFailed({ doubleMajority: false, accepted: false, yesPct: 52 })).toBe(false)
    expect(cantonMajorityFailed({ doubleMajority: true, accepted: true, yesPct: 52 })).toBe(false)
  })
})

describe('result bar rendering', () => {
  it('draws the 50 % majority tick on every rendered result bar', () => {
    const html = detail(20)
    const bars = html.match(/<div class="res" /g) ?? []
    expect(bars.length).toBeGreaterThan(0)
    expect(html.match(/class="restick"/g)).toHaveLength(bars.length)
  })

  it('sizes the bar from the vote counts, not from a rounded percentage', () => {
    const main = resultFor(20)!.bars[0]!
    const html = detail(20)
    expect(html).toContain(`flex:${main.yesVotes}`)
    expect(html).toContain(`flex:${main.noVotes}`)
  })

  it('prints the yes share to one decimal in the page language', () => {
    const main = resultFor(20)!.bars[0]!
    expect(detail(20, 'de')).toContain(`${formatPercent1(main.yesPct!, 'de')} %`)
    expect(detail(20, 'it')).toContain(`${formatPercent1(main.yesPct!, 'it')} %`)
  })

  it('gives the funding bar and the result block each their own heading, funding first', () => {
    const html = detail(20)
    expect(html).toContain(t('fr', 'funding.heading'))
    expect(html).toContain(t('fr', 'result.heading'))
    expect(html.indexOf(t('fr', 'funding.heading'))).toBeLessThan(html.indexOf(t('fr', 'result.heading')))
    expect(html.indexOf('class="hero"')).toBeLessThan(html.indexOf('class="resblock"'))
  })

  it('draws the result bars shorter than the funding bar, but not by much', () => {
    const css = readFileSync(`${dist}fr/index.html`, 'utf8')
    const hero = Number(/\.hero\{[^}]*height:(\d+)px/.exec(css)?.[1])
    const res = Number(/\.res\{[^}]*height:(\d+)px/.exec(css)?.[1])
    expect(hero).toBeGreaterThan(0)
    expect(res).toBeGreaterThan(0)
    expect(res).toBeLessThan(hero)
    expect(res / hero).toBeGreaterThan(0.6)
  })

  it('states the verdict without listing the routine cantonal tally', () => {
    const block = blockOf(detail(20))
    const main = resultFor(20)!.bars[0]!
    expect(block).toContain(t('fr', main.accepted ? 'result.accepted' : 'result.rejected'))
    expect(block).not.toMatch(/cantons \d+\/\d+/)
    expect(block).not.toMatch(/Stände \d+\/\d+/)
  })

  it('still calls out a double-majority failure, the one case the cantons decide', () => {
    const failures = votes
      .map((v) => resultFor(v.id))
      .flatMap((r) => r?.bars ?? [])
      .filter((b) => cantonMajorityFailed(b))
    for (const b of failures) {
      const owner = votes.find((v) => resultFor(v.id)?.bars.includes(b))!
      expect(blockOf(detail(owner.id))).toContain(t('fr', 'result.cantonsFailed'))
    }
    expect(t('fr', 'result.cantonsFailed')).not.toBe('result.cantonsFailed')
  })

  it('shows turnout and names the official source on the detail page', () => {
    const block = blockOf(detail(20))
    expect(block).toContain(t('fr', 'result.source'))
    expect(block).toContain(t('fr', 'result.turnout', {
      pct: formatPercent1(resultFor(20)!.bars[0]!.turnoutPct!, 'fr'),
    }))
  })
})

describe('counter-proposal package (object 23)', () => {
  const block = () => blockOf(detail(23))

  it('renders one bar per ballot question, main first', () => {
    expect(resultFor(23)!.bars.map((b) => b.kind)).toEqual(['main', 'counterProject', 'subsidiary'])
    expect(block().match(/<div class="res" /g)).toHaveLength(3)
  })

  it('names the counter-project and the subsidiary question', () => {
    expect(block()).toContain(t('fr', 'result.kind.counterProject'))
    expect(block()).toContain(t('fr', 'result.kind.subsidiary'))
  })

  it('shows the counter-project as accepted even though the initiative was rejected', () => {
    const counter = resultFor(23)!.bars.find((b) => b.kind === 'counterProject')!
    const main = resultFor(23)!.bars.find((b) => b.kind === 'main')!
    expect(main.accepted).toBe(false)
    expect(counter.accepted).toBe(true)
    expect(block()).toContain(t('fr', 'result.accepted'))
    expect(block()).toContain(t('fr', 'result.rejected'))
  })

  it('does not call the subsidiary question accepted or rejected', () => {
    const rows = block().split('<div class="resrow">')
    const subsidiary = rows.find((r) => r.includes(t('fr', 'result.kind.subsidiary')))!
    expect(subsidiary).not.toContain('class="resverdict"')
    expect(subsidiary).toContain(t('fr', 'result.subsidiaryNote'))
  })

  it('renders even though the object has no declared funding at all', () => {
    expect(votes.find((v) => v.id === 23)!.stage).toBe('none')
    expect(block()).not.toBe('')
  })

  it('marks the package provisional while the federal validation is pending', () => {
    expect(resultFor(23)!.provisional).toBe(true)
    expect(block()).toContain(t('fr', 'result.provisional'))
  })
})

describe('index page', () => {
  it('shows every question of a package, same as the detail page', () => {
    const html = page('fr/index.html')
    const article = html.split('<article class="row">').find((a) => a.includes(slugOf(23)))!
    expect(article.match(/<div class="res" /g)).toHaveLength(3)
    expect(article).toContain(t('fr', 'result.kind.main'))
    expect(article).toContain(t('fr', 'result.kind.counterProject'))
    expect(article).toContain(t('fr', 'result.kind.subsidiary'))
  })

  it('leaves turnout and the source line to the detail page', () => {
    const html = page('fr/index.html')
    expect(html).not.toContain(t('fr', 'result.source'))
    expect(blockOf(detail(23))).toContain(t('fr', 'result.source'))
  })

  it('carries a result bar for every counted object it lists', () => {
    const html = page('fr/index.html')
    const counted = votes.filter((v) => resultFor(v.id) !== null)
    expect(html.match(/class="resblock"/g)).toHaveLength(counted.length)
  })
})
