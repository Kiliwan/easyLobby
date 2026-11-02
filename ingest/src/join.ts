import { indexByIdPath, type IdPath, type TreeResponse } from './tree.js'

export type Lang = 'de' | 'fr' | 'it'
export const LANGS: readonly Lang[] = ['de', 'fr', 'it'] as const
export type Labels = Record<Lang, string>

export class JoinMismatchError extends Error {
  constructor(lang: Lang, detail: string) {
    super(`Tree for ${lang} does not match the French reference tree: ${detail}`)
    this.name = 'JoinMismatchError'
  }
}

export function joinLabels(trees: Partial<Record<Lang, TreeResponse>>): Map<IdPath, Labels> {
  const reference = trees.fr
  if (!reference) throw new JoinMismatchError('fr', 'the French tree is required as reference')

  const refIndex = indexByIdPath(reference.data.tree_roots)
  const out = new Map<IdPath, Labels>()
  for (const [path, node] of refIndex) {
    out.set(path, { de: node.label, fr: node.label, it: node.label })
  }

  for (const lang of LANGS) {
    const tree = trees[lang]
    if (!tree || lang === 'fr') continue
    const index = indexByIdPath(tree.data.tree_roots)

    for (const path of index.keys()) {
      if (!refIndex.has(path)) throw new JoinMismatchError(lang, `extra path ${path}`)
    }
    for (const [path, refNode] of refIndex) {
      const node = index.get(path)
      if (!node) throw new JoinMismatchError(lang, `missing path ${path}`)
      if (node.type !== refNode.type) {
        throw new JoinMismatchError(lang, `type mismatch at ${path}: ${node.type} vs ${refNode.type}`)
      }
      out.get(path)![lang] = node.label
    }
  }

  return out
}
