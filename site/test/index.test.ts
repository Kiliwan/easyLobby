import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadVotes } from '../src/lib/data.js'
import { t } from '../src/i18n/index.js'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))

const page = (p: string) => readFileSync(`${dist}${p}`, 'utf8')

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1

describe('index page', () => {
  it('builds one index per language', () => {
    for (const lang of ['de', 'fr', 'it']) {
      expect(existsSync(`${dist}${lang}/index.html`), lang).toBe(true)
    }
  })

  it('lists every votation', () => {
    const html = page('fr/index.html')
    const links = html.match(/href="[^"]*\/fr\/objet\/[^"]+\/"/g) ?? []
    expect(new Set(links).size).toBe(loadVotes().votes.length)
  })

  it('ships no JavaScript', () => {
    expect(page('fr/index.html')).not.toMatch(/<script/i)
  })

  it('inlines the stylesheet rather than linking it', () => {
    const html = page('fr/index.html')
    expect(html).toMatch(/<style/i)
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i)
  })

  it('carries the unaudited disclaimer', () => {
    expect(page('fr/index.html')).toContain('non auditées')
  })

  it('renders the German title on the German index', () => {
    expect(page('de/index.html')).toContain('Keine 10-Millionen-Schweiz')
  })

  it('stays under 60 KB', () => {
    expect(Buffer.byteLength(page('fr/index.html'))).toBeLessThan(60_000)
  })

  it('renders "no declaration on this side" rather than CHF 0 for a side with no filing committee (object 7)', () => {
    const { votes } = loadVotes()
    const object7 = votes.find((v) => v.id === 7)!
    expect(object7.totals.no.budget).toBeNull()
    expect(object7.totals.no.final).toBeNull()
    expect(object7.committees.every((c) => c.side === 'yes')).toBe(true)

    const html = page('fr/index.html')
    const idx = html.indexOf(`objet/${object7.slug}/`)
    const block = html.slice(idx, idx + 1000)
    expect(block).toContain(t('fr', 'vote.side.noDeclaration'))
    expect(block).not.toContain('CONTRE · CHF 0')
    expect(block).not.toMatch(/CHF 0[^\d]*·\s*CONTRE/)

    const m = /<div class="hn" style="([^"]+)"/.exec(block)
    expect(m?.[1]).toBe('flex:0')

    const label = /<span class="tn">([^<]+)<\/span>/.exec(block)
    expect(label?.[1]).toContain(t('fr', 'vote.side.noDeclaration'))
  })

  it('shows the past- vs future-empty copy exactly where the data says it should', () => {
    const { votes } = loadVotes()
    const now = new Date()
    const undeclared = votes.filter((v) => v.stage === 'none')
    const pastCount = undeclared.filter((v) => new Date(`${v.ballotDate}T00:00:00Z`) < now).length
    const futureCount = undeclared.length - pastCount

    const html = page('fr/index.html').replace(/&#39;/g, "'")
    expect(occurrences(html, t('fr', 'empty.past'))).toBe(pastCount)
    expect(occurrences(html, t('fr', 'empty.future'))).toBe(futureCount)
  })
})
