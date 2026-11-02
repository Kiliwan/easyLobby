import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { countByType, indexByIdPath, pathKey, walk, type TreeResponse } from '../src/tree.js'

const fr = JSON.parse(
  readFileSync(new URL('./fixtures/trees/fr-campaign_financings.json', import.meta.url), 'utf8'),
) as TreeResponse

describe('pathKey', () => {
  it('joins ids with a slash', () => {
    expect(pathKey([28, 0, 452, 571, 91])).toBe('28/0/452/571/91')
  })
  it('is distinct for different depths with the same digits', () => {
    expect(pathKey([1, 23])).not.toBe(pathKey([12, 3]))
  })
})

describe('walk', () => {
  it('visits every node in the French fixture', () => {
    let n = 0
    walk(fr.data.tree_roots, () => { n += 1 })
    expect(n).toBe(2411)
  })

  it('gives each node its full ancestor path', () => {
    const paths: string[] = []
    walk(fr.data.tree_roots, (node, path) => {
      if (node.type === 'form') paths.push(pathKey(path))
    })
    expect(paths).toHaveLength(1353)
    for (const p of paths) expect(p.split('/')).toHaveLength(5)
  })
})

describe('indexByIdPath', () => {
  it('indexes every node uniquely', () => {
    const idx = indexByIdPath(fr.data.tree_roots)
    expect(idx.size).toBe(2411)
    expect(idx.get('28')?.type).toBe('campaign_financing')
  })
})

describe('countByType', () => {
  it('counts the fixture', () => {
    expect(countByType(fr.data.tree_roots, 'campaign_financing')).toBe(33)
    expect(countByType(fr.data.tree_roots, 'form')).toBe(1353)
  })
})
