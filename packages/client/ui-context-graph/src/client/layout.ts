/** Pure spatial layout for context-graph trees. */

import type {
  ContextGraphEdge, ContextGraphNode, ContextGraphNodeId, ContextGraphSnapshot,
} from '@deepseek-ai/dsh-context-graph/types'

const ROOT_X = 76
const ROOT_Y = 76
const LANE_GAP = 156
const ROW_GAP = 148
const CANVAS_PADDING = 76

/** One graph node positioned in a project-local tree canvas. */
export interface ContextGraphLayoutNode {
  readonly node: ContextGraphNode
  readonly lane: number
  readonly x: number
  readonly y: number
  readonly relation?: Extract<ContextGraphEdge['kind'], 'continuation' | 'fork'>
}

/** One graph relationship with a deterministic SVG path. */
export interface ContextGraphLayoutEdge {
  readonly edge: ContextGraphEdge
  readonly path: string
}

/** One project tree and its canvas dimensions. */
export interface ContextGraphProjectLayout {
  readonly nodes: readonly ContextGraphLayoutNode[]
  readonly edges: readonly ContextGraphLayoutEdge[]
  readonly width: number
  readonly height: number
}

/**
 * Arrange each project as chronological rows and stable branch lanes.
 * @param snapshot Graph snapshot to arrange.
 * @returns Spatial trees grouped by project identity.
 */
export function layoutContextGraph(snapshot: ContextGraphSnapshot): ReadonlyMap<string, ContextGraphProjectLayout> {
  const structural = new Map<ContextGraphNodeId, ContextGraphEdge>()
  for (const edge of snapshot.edges) {
    if (edge.kind !== 'recall') structural.set(edge.to, edge)
  }
  const groups = new Map<string, ContextGraphNode[]>()
  for (const node of [...snapshot.nodes].sort((a, b) => a.completedAt - b.completedAt || a.id.localeCompare(b.id))) {
    const group = groups.get(node.projectId)
    if (group === undefined) groups.set(node.projectId, [node])
    else group.push(node)
  }

  const result = new Map<string, ContextGraphProjectLayout>()
  for (const [projectId, nodes] of groups) {
    const positioned = new Map<ContextGraphNodeId, ContextGraphLayoutNode>()
    let furthestLane = 0
    const rows = nodes.map((node, row): ContextGraphLayoutNode => {
      const parentEdge = structural.get(node.id)
      const parent = parentEdge === undefined ? undefined : positioned.get(parentEdge.from)
      let lane = 0
      if (parent !== undefined && parentEdge?.kind === 'continuation') lane = parent.lane
      if (parent !== undefined && parentEdge?.kind === 'fork') lane = ++furthestLane
      const placed: ContextGraphLayoutNode = {
        node,
        lane,
        x: ROOT_X + lane * LANE_GAP,
        y: ROOT_Y + row * ROW_GAP,
        ...(parent === undefined || parentEdge === undefined ? {} : { relation: parentEdge.kind as 'continuation' | 'fork' }),
      }
      positioned.set(node.id, placed)
      return placed
    })
    const edges = snapshot.edges.flatMap((edge): ContextGraphLayoutEdge[] => {
      const from = positioned.get(edge.from)
      const to = positioned.get(edge.to)
      if (from === undefined || to === undefined) return []
      return [{ edge, path: edgePath(from, to) }]
    })
    result.set(projectId, {
      nodes: rows,
      edges,
      width: ROOT_X + furthestLane * LANE_GAP + CANVAS_PADDING,
      height: ROOT_Y + (nodes.length - 1) * ROW_GAP + CANVAS_PADDING,
    })
  }
  return result
}

function edgePath(from: ContextGraphLayoutNode, to: ContextGraphLayoutNode): string {
  if (from.x === to.x) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`
  const bendY = from.y + Math.max((to.y - from.y) * 0.48, 32)
  return `M ${from.x} ${from.y} C ${from.x} ${bendY} ${to.x} ${bendY} ${to.x} ${to.y}`
}
