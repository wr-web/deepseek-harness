/**
 * Public records for the reusable cross-session context graph.
 *
 * @module @deepseek-ai/dsh-context-graph/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable identity of one completed-turn checkpoint. */
export type ContextGraphNodeId = Branded<'ContextGraphNodeId'>

/**
 * Brand a serialized checkpoint identity.
 * @param value Serialized checkpoint identity.
 * @returns Branded checkpoint identity.
 */
export function ContextGraphNodeId(value: string): ContextGraphNodeId {
  return value as ContextGraphNodeId
}

/** Freshness derived from the checkpoint age at graph-read time. */
export type ContextGraphFreshness = 'fresh' | 'aging' | 'stale'

/** Aggregated tool activity between a turn's prompt and its terminal boundary. */
export interface ContextGraphAction {
  /** Registered tool name. */
  readonly name: string
  /** Number of calls to this tool in the turn. */
  readonly count: number
}

/** One completed-turn checkpoint that can seed a later branch. */
export interface ContextGraphNode {
  /** Stable `<session>@<turn>:<boundary-seq>` identity. */
  readonly id: ContextGraphNodeId
  /** Session that originally produced this checkpoint. */
  readonly sessionId: SessionId
  /** Project grouping identity derived from the recorded working directory. */
  readonly projectId: string
  /** Recorded working directory, absent for projectless sessions. */
  readonly cwd?: string
  /** Turn number carried by the durable event log. */
  readonly turn: number
  /** `turn/end` sequence accepted by `sessions.fork(..., atSeq)`. */
  readonly boundarySeq: number
  /** Short first-line label derived from the final assistant text. */
  readonly key: string
  /** Direct user request that opened the turn, within the configured byte bound. */
  readonly prompt: string
  /** Final assistant text, within the configured byte bound. */
  readonly summary: string
  /** Tool calls aggregated by name in first-use order. */
  readonly actions: readonly ContextGraphAction[]
  /** Terminal turn outcome. Only completed nodes are automatic-recall candidates. */
  readonly outcome: string
  /** Whether automatic recall may select this node. */
  readonly reusable: boolean
  /** Time of the terminal boundary in Unix epoch milliseconds. */
  readonly completedAt: number
  /** Age classification at snapshot generation time. */
  readonly freshness: ContextGraphFreshness
  /** Provider-reported uncached input tokens summed across the turn. */
  readonly inputTokens: number
  /** Provider-reported cache-read tokens summed across the turn. */
  readonly cacheReadTokens: number
  /** Provider-reported output tokens summed across the turn. */
  readonly outputTokens: number
  /** Earlier node automatically recalled into this turn, when present. */
  readonly recalledFrom?: ContextGraphNodeId
  /** Match score recorded with the automatic recall. */
  readonly recallScore?: number
  /** Exact UTF-8 bytes automatically recalled into this turn. */
  readonly recalledBytes: number
}

/** One session represented by its non-inherited graph nodes. */
export interface ContextGraphSession {
  readonly sessionId: SessionId
  readonly projectId: string
  readonly cwd?: string
  readonly createdAt: number
  readonly parentSessionId?: SessionId
  readonly nodeIds: readonly ContextGraphNodeId[]
}

/** One working-directory forest root. */
export interface ContextGraphProject {
  readonly id: string
  readonly label: string
  readonly cwd?: string
  readonly sessionIds: readonly SessionId[]
}

/** Relationship between two checkpoints. */
export interface ContextGraphEdge {
  readonly id: string
  readonly kind: 'continuation' | 'fork' | 'recall'
  readonly from: ContextGraphNodeId
  readonly to: ContextGraphNodeId
}

/** Read-only forest plus cross-branch recall links. */
export interface ContextGraphSnapshot {
  readonly generatedAt: number
  readonly projects: readonly ContextGraphProject[]
  readonly sessions: readonly ContextGraphSession[]
  readonly nodes: readonly ContextGraphNode[]
  readonly edges: readonly ContextGraphEdge[]
  readonly stats: {
    readonly projects: number
    readonly sessions: number
    readonly nodes: number
    readonly reusableNodes: number
    readonly recallEdges: number
    readonly recalledBytes: number
  }
}

/** Ranked automatic-recall candidate. */
export interface ContextGraphMatch {
  readonly node: ContextGraphNode
  /** Query-token coverage from zero through one. */
  readonly score: number
}

/** Provider usage and recall volume measured from one completed session log. */
export interface ContextGraphRunMetrics {
  readonly uncachedInputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly totalInputTokens: number
  readonly recallCount: number
  readonly recalledBytes: number
}

/** Baseline comparison where positive saved-token values favor the recalled run. */
export interface ContextGraphEvaluation {
  readonly baseline: ContextGraphRunMetrics
  readonly recalled: ContextGraphRunMetrics
  readonly uncachedInputTokensSaved: number
  readonly totalInputTokensSaved: number
  readonly inputReductionRate?: number
  readonly outputTokenDelta: number
}

/** Model-visible provenance for one automatically recalled graph node. */
export interface ContextGraphMessageSource {
  readonly kind: 'context-graph'
  readonly form: 'recall'
  readonly version: 1
  readonly sourceNodeId: ContextGraphNodeId
  readonly sourceSessionId: SessionId
  readonly capturedThroughSeq: number
  readonly score: number
  readonly recalledBytes: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'context-graph': ContextGraphMessageSource
  }
}
