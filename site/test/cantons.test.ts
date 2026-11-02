import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { describe, expect, it } from 'vitest'
import ResultBar from '../src/components/ResultBar.astro'
import { cantonMajorityFailed, formatCantons, type BallotObject, type VoteResult } from '../src/lib/data.js'
import { t } from '../src/i18n/index.js'

const bar = (over: Partial<BallotObject> = {}): BallotObject => ({
  vorlagenId: 1, mainId: 1, kind: 'main', titles: { fr: 'Objet' },
  counted: true, provisional: false, accepted: false, doubleMajority: true,
  yesPct: 50.73, yesVotes: 1299129, noVotes: 1261680, turnoutPct: 47.04,
  cantonsYes: 7, cantonsNo: 13, cantonsYesHalf: 3, cantonsNoHalf: 3,
  ...over,
})

const render = async (bars: BallotObject[], lang = 'fr') => {
  const container = await AstroContainer.create()
  const result: VoteResult = { vorlagenId: 1, provisional: false, bars }
  return container.renderToString(ResultBar, { props: { result, lang } })
}

describe('formatCantons', () => {
  it('adds half cantons as halves, keeping the ½ only when one is left over', () => {
    expect(formatCantons(7, 3)).toBe('8½')
    expect(formatCantons(13, 3)).toBe('14½')
    expect(formatCantons(14, 6)).toBe('17')
    expect(formatCantons(20, 0)).toBe('20')
    expect(formatCantons(0, 1)).toBe('0½')
  })

  it('treats a missing half-canton count as zero, not as a missing whole count', () => {
    expect(formatCantons(11, null)).toBe('11')
    expect(formatCantons(null, 3)).toBe('—')
  })
})

describe('a vote the people carried and the cantons refused', () => {
  it('hatches the winning green instead of drawing it solid', async () => {
    const html = await render([bar()])
    expect(html).toMatch(/class="res defeated"/)
  })

  it('badges the verdict and names the cantonal split, halves included', async () => {
    const html = await render([bar()])
    expect(html).toContain('class="badge"')
    expect(html).toContain(t('fr', 'result.cantonsFailed', { yes: '8½', no: '14½' }))
    expect(html).toContain('8½')
    expect(html).toContain('14½')
  })

  it('ships the rules that make the hatch and the badge visible', () => {
    const built = readFileSync(fileURLToPath(new URL('../dist/fr/index.html', import.meta.url)), 'utf8')
    expect(built).toMatch(/\.res\.defeated>\.ry\{[^}]*repeating-linear-gradient/)
    expect(built).toMatch(/\.resverdict \.badge\{/)
  })

  it('names the question and both sides for a screen reader, not just the yes share', async () => {
    const html = await render([
      bar({ kind: 'main' }),
      bar({ kind: 'counterProject', yesPct: 73.4, accepted: true }),
    ])
    const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!)
    expect(labels).toHaveLength(2)
    expect(labels[0]).toContain(t('fr', 'result.kind.main'))
    expect(labels[1]).toContain(t('fr', 'result.kind.counterProject'))
    for (const l of labels) {
      expect(l).toContain(t('fr', 'result.yes'))
      expect(l).toContain(t('fr', 'result.no'))
    }
    expect(labels[0]).toContain('49,3 %')
  })

  it('still shows the popular majority crossing the tick', async () => {
    const html = await render([bar()])
    expect(html).toContain('flex:1299129')
    expect(html).toContain('class="restick"')
    expect(html).toContain('50,7 %')
  })

  it('translates the failure into de and it', async () => {
    expect(await render([bar()], 'de')).toContain(t('de', 'result.cantonsFailed', { yes: '8½', no: '14½' }))
    expect(await render([bar()], 'it')).toContain(t('it', 'result.cantonsFailed', { yes: '8½', no: '14½' }))
  })
})

describe('every other outcome stays plain', () => {
  it('does not hatch or badge an object the people also rejected', async () => {
    const html = await render([bar({ yesPct: 45.6, yesVotes: 1381191, noVotes: 1646845 })])
    expect(html).not.toContain('defeated')
    expect(html).not.toContain('class="badge"')
    expect(html).toContain(t('fr', 'result.rejected'))
  })

  it('does not hatch or badge an accepted object', async () => {
    const html = await render([bar({ accepted: true, yesPct: 58.2 })])
    expect(html).not.toContain('defeated')
    expect(html).not.toContain('class="badge"')
    expect(html).toContain(t('fr', 'result.accepted'))
  })

  it('does not hatch a simple-majority object, which no cantonal count can defeat', async () => {
    const html = await render([bar({ doubleMajority: false })])
    expect(html).not.toContain('defeated')
    expect(html).not.toContain('class="badge"')
  })

  it('agrees with the predicate that drives it', () => {
    expect(cantonMajorityFailed(bar())).toBe(true)
    expect(cantonMajorityFailed(bar({ yesPct: 45.6 }))).toBe(false)
    expect(cantonMajorityFailed(bar({ accepted: true }))).toBe(false)
    expect(cantonMajorityFailed(bar({ doubleMajority: false }))).toBe(false)
  })
})
