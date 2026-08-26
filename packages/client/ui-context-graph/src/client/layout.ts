/** Pure structural layout for context-graph rows. */

import type {
  ContextGraphEdge, ContextGraphNode, ContextGraphNodeId, ContextGraphSnapshot,
} from '@deepseek-ai/dsh-context-graph/types'

/** One graph node with derived structural presentation data. */
export interface ContextGraphLayoutNode {
  readonly node: ContextGraphNode
  readonly depth: number
  readonly relation?: Extract<ContextGraphEdge['kind'], 'continuation' | 'fork'>
}

/**
 * Group nodes by project and derive bounded structural indentation.
 * @param snapshot Graph snapshot to arrange.
 * @returns Chronological presentation rows grouped by project identity.
 */
export function layoutContextGraph(snapshot: ContextGraphSnapshot): ReadonlyMap<string, ContextGraphLayoutNode[]> {
  const structural = new Map<ContextGraphNodeId, ContextGraphEdge>()
  for (const edge of snapshot.edges) {
    if (edge.kind !== 'recall') structural.set(edge.to, edge)
  }
  const byId = new Map(snapshot.nodes.map(node => [node.id, node]))
  const depthCache = new Map<ContextGraphNodeId, number>()
  const depthOf = (id: ContextGraphNodeId, seen = new Set<ContextGraphNodeId>()): number => {
    const cached = depthCache.get(id)
    if (cached !== undefined) return cached
    if (seen.has(id)) return 0
    seen.add(id)
    const parent = structural.get(id)?.from
    const depth = parent === undefined || !byId.has(parent) ? 0 : Math.min(depthOf(parent, seen) + 1, 8)
    depthCache.set(id, depth)
    return depth
  }
  const groups = new Map<string, ContextGraphLayoutNode[]>()
  for (const node of [...snapshot.nodes].sort((a, b) => a.completedAt - b.completedAt || a.id.localeCompare(b.id))) {
    const edge = structural.get(node.id)
    const row: ContextGraphLayoutNode = {
      node,
      depth: depthOf(node.id),
      ...(edge === undefined ? {} : { relation: edge.kind as 'continuation' | 'fork' }),
    }
    const group = groups.get(node.projectId)
    if (group === undefined) groups.set(node.projectId, [row])
    else group.push(row)
  }
  return groups
}
