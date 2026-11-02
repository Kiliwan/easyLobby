export interface RawNode {
  id: number
  label: string
  type: string
  header_text?: string | null
  campaign_id?: number
  download_path?: string
  children?: RawNode[]
}

export interface TreeResponse {
  data: { tree_roots: RawNode[] }
}

export type IdPath = string

export function pathKey(path: readonly number[]): IdPath {
  return path.join('/')
}

export function walk(
  roots: readonly RawNode[],
  visit: (node: RawNode, path: readonly number[]) => void,
): void {
  const recurse = (nodes: readonly RawNode[], prefix: readonly number[]): void => {
    for (const node of nodes) {
      const path = [...prefix, node.id]
      visit(node, path)
      if (node.children) recurse(node.children, path)
    }
  }
  recurse(roots, [])
}

export function indexByIdPath(roots: readonly RawNode[]): Map<IdPath, RawNode> {
  const index = new Map<IdPath, RawNode>()
  walk(roots, (node, path) => {
    index.set(pathKey(path), node)
  })
  return index
}

export function countByType(roots: readonly RawNode[], type: string): number {
  let n = 0
  walk(roots, (node) => {
    if (node.type === type) n += 1
  })
  return n
}
