import type { RawNode, TreeResponse } from './tree.js'

export function electionIds(exportsElections: TreeResponse): Set<number> {
  return new Set(exportsElections.data.tree_roots.map((r) => r.id))
}

export function inScopeRoots(tree: TreeResponse, elections: ReadonlySet<number>): RawNode[] {
  return tree.data.tree_roots.filter((root) => !elections.has(root.id))
}
