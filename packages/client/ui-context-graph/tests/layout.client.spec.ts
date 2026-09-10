import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ContextGraphNodeId, type ContextGraphNode, type ContextGraphSnapshot } from '@deepseek-ai/dsh-context-graph'
import { layoutContextGraph } from '../src/client/layout.ts'

function node(id: string, completedAt: number): ContextGraphNode {
  return {
    id: ContextGraphNodeId(id),
    sessionId: SessionId(id.split('@')[0] ?? id),
    projectId: 'project:repo',
    cwd: '/repo',
    turn: 1,
    boundarySeq: 8,
    key: id,
    prompt: id,
    summary: id,
    actions: [],
    outcome: 'completed',
    reusable: true,
    completedAt,
    freshness: 'fresh',
    inputTokens: 1,
    cacheReadTokens: 0,
    outputTokens: 1,
    recalledBytes: 0,
  }
}

describe('layoutContextGraph', () => {
  it('sorts checkpoints, keeps continuations in one lane, and opens a lane for forks', () => {
    const root = node('root@1:8', 1)
    const continued = node('root@2:16', 2)
    const forked = node('child@2:16', 3)
    const recalled = node('recall@1:8', 4)
    const snapshot: ContextGraphSnapshot = {
      generatedAt: 5,
      projects: [{ id: 'project:repo', label: 'repo', cwd: '/repo', sessionIds: [] }],
      sessions: [],
      nodes: [recalled, forked, root, continued],
      edges: [
        { id: 'continue', kind: 'continuation', from: root.id, to: continued.id },
        { id: 'fork', kind: 'fork', from: continued.id, to: forked.id },
        { id: 'recall', kind: 'recall', from: root.id, to: recalled.id },
      ],
      stats: { projects: 1, sessions: 0, nodes: 4, reusableNodes: 4, recallEdges: 1, recalledBytes: 0 },
    }

    const layout = layoutContextGraph(snapshot).get('project:repo')
    expect(layout?.nodes.map(row => ({
      id: row.node.id,
      lane: row.lane,
      relation: row.relation,
    }))).toEqual([
      { id: root.id, lane: 0, relation: undefined },
      { id: continued.id, lane: 0, relation: 'continuation' },
      { id: forked.id, lane: 1, relation: 'fork' },
      { id: recalled.id, lane: 0, relation: undefined },
    ])
    expect(layout?.edges).toHaveLength(3)
    expect(layout?.edges[0]?.path).toBe('M 62 62 L 62 186')
    expect(layout?.width).toBe(252)
    expect(layout?.height).toBe(372)
  })

  it('places sibling forks beside the next main-line turn at one shared depth', () => {
    const root = node('root@1:8', 1)
    const main = node('root@2:16', 2)
    const left = node('left@1:8', 3)
    const right = node('right@1:8', 4)
    const snapshot: ContextGraphSnapshot = {
      generatedAt: 5,
      projects: [],
      sessions: [],
      nodes: [root, main, left, right],
      edges: [
        { id: 'main', kind: 'continuation', from: root.id, to: main.id },
        { id: 'left', kind: 'fork', from: root.id, to: left.id },
        { id: 'right', kind: 'fork', from: root.id, to: right.id },
      ],
      stats: { projects: 0, sessions: 0, nodes: 4, reusableNodes: 4, recallEdges: 0, recalledBytes: 0 },
    }

    expect(layoutContextGraph(snapshot).get('project:repo')?.nodes.map(row => [row.node.id, row.x, row.y])).toEqual([
      [root.id, 62, 62],
      [main.id, 62, 186],
      [left.id, 190, 186],
      [right.id, 318, 186],
    ])
  })

  it('lays out malformed structural cycles without recursion', () => {
    const left = node('left@1:8', 1)
    const right = node('right@1:8', 2)
    const snapshot = {
      generatedAt: 3,
      projects: [],
      sessions: [],
      nodes: [left, right],
      edges: [
        { id: 'left', kind: 'fork' as const, from: right.id, to: left.id },
        { id: 'right', kind: 'fork' as const, from: left.id, to: right.id },
      ],
      stats: { projects: 0, sessions: 0, nodes: 2, reusableNodes: 2, recallEdges: 0, recalledBytes: 0 },
    }
    expect(layoutContextGraph(snapshot).get('project:repo')?.nodes.map(row => row.lane)).toEqual([0, 1])
  })

  it('uses node identity to break equal-time ordering and treats a missing parent as a root', () => {
    const alpha = node('a@1:8', 1)
    const beta = node('b@1:8', 1)
    const snapshot = {
      generatedAt: 2,
      projects: [],
      sessions: [],
      nodes: [beta, alpha],
      edges: [{ id: 'orphan', kind: 'fork' as const, from: ContextGraphNodeId('missing@1:8'), to: beta.id }],
      stats: { projects: 0, sessions: 0, nodes: 2, reusableNodes: 2, recallEdges: 0, recalledBytes: 0 },
    }
    expect(layoutContextGraph(snapshot).get('project:repo')?.nodes.map(row => [row.node.id, row.lane])).toEqual([
      [alpha.id, 0],
      [beta.id, 0],
    ])
  })
})
