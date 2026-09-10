/** Configuration for graph extraction, matching, and automatic recall. */

/** Context-graph plugin configuration. */
export interface Config {
  /** Automatically recall one matching node into a fresh root session's first turn. */
  autoRecall: boolean
  /** Restrict automatic matches to the exact recorded working directory. */
  sameWorkspaceOnly: boolean
  /** Include subagent sessions as reusable sources. */
  includeSubagents: boolean
  /** Maximum newest sessions inspected for one graph snapshot. */
  maxSessions: number
  /** Maximum newest non-inherited completed turns retained per session. */
  maxNodesPerSession: number
  /** Concurrent complete-session reads while building a snapshot. */
  readConcurrency: number
  /** UTF-8 byte bound applied independently to node prompts and summaries. */
  maxTextBytes: number
  /** Complete UTF-8 byte bound for automatically injected context. */
  maxRecallBytes: number
  /** Maximum ranked matches returned by discovery. */
  matchLimit: number
  /** Minimum query-token coverage required for automatic recall. */
  minScore: number
  /** Age after which a node is displayed as stale and excluded from automatic recall. */
  staleAfterMs: number
  /** Maximum age of an in-memory graph snapshot before an external change is observed. */
  cacheTtlMs: number
}
