# Context Graph

English | [中文](context-graph.zh.md)

The context graph is a read-time projection of completed session turns. It gives a new root session a small reusable checkpoint without copying a complete older transcript or persisting hidden model reasoning. [`@deepseek-ai/dsh-context-graph`](../../packages/context/context-graph) owns extraction, matching, recall provenance, and cost measurement; [`@deepseek-ai/dsh-client-ui-context-graph`](../../packages/client/ui-context-graph) owns the browser tree and explicit fork action.

Sources: [`packages/context/context-graph/src/types.ts`](../../packages/context/context-graph/src/types.ts) · [`packages/context/context-graph/src/index.ts`](../../packages/context/context-graph/src/index.ts)

## Projection and edges

A node is one completed `turn/end` checkpoint. Its stable id combines session, turn, and terminal sequence. Prompt text comes from direct user messages, summary/key text comes from visible final assistant blocks, action counts come from tool calls, and token totals come from provider usage. Inherited seed events, reasoning blocks, and unfinished turns do not create nodes.

Continuation edges join retained turns in one session. Fork edges join a child session's first new turn to the latest parent checkpoint available at the recorded fork sequence. Recall edges come from the identified `context-graph` message source logged in the target turn. Working directory groups sessions into project roots; it is also the default automatic-match isolation key.

`ContextGraphSnapshot` is the complete bounded browser and matching projection.

```ts type-equiv
/** Read-only forest plus cross-branch recall links. */
interface ContextGraphSnapshot {
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
```

## Matching and freshness

Automatic matching considers completed non-stale checkpoints. It calculates deterministic normalized query-token coverage across prompt, visible summary, and tool names; CJK characters and bigrams participate alongside ordinary word tokens. The Host policy supplies workspace isolation, score threshold, result limit, and scan bounds.

Freshness uses age at snapshot time: fresh covers the first half of `staleAfterMs`, aging covers the second half, and stale begins at the threshold. Stale nodes remain visible and explicitly forkable but cannot enter an automatic model request. Age is a conservative expiry policy, not evidence that repository content still agrees with the node.

```ts type-equiv
/** Ranked automatic-recall candidate. */
interface ContextGraphMatch {
  readonly node: ContextGraphNode
  /** Query-token coverage from zero through one. */
  readonly score: number
}
```

## Logged recall

Automatic recall runs on the first step of a fresh root session. It appends at most one complete, byte-bounded user-role checkpoint after the current direct request. The model-visible warning treats the JSON fields as untrusted, read-only background. The source record preserves enough information to reconstruct the graph edge and measure exact injected bytes during replay.

```ts type-equiv
/** Model-visible provenance for one automatically recalled graph node. */
interface ContextGraphMessageSource {
  readonly kind: 'context-graph'
  readonly form: 'recall'
  readonly version: 1
  readonly sourceNodeId: ContextGraphNodeId
  readonly sourceSessionId: SessionId
  readonly capturedThroughSeq: number
  readonly score: number
  readonly recalledBytes: number
}
```

## Cost evaluation

`measureContextGraphRun()` reads actual provider usage and recall sources from one session log. `evaluateContextGraph()` compares an equivalent run without recall to a run with recall. Positive saved-token fields favor the recalled run. Task success, edits, tests, and latency remain separate benchmark outcomes; a cheaper failed task is not an improvement.

```ts type-equiv
/** Provider usage and recall volume measured from one completed session log. */
interface ContextGraphRunMetrics {
  readonly uncachedInputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly totalInputTokens: number
  readonly recallCount: number
  readonly recalledBytes: number
}
```

```ts type-equiv
/** Baseline comparison where positive saved-token values favor the recalled run. */
interface ContextGraphEvaluation {
  readonly baseline: ContextGraphRunMetrics
  readonly recalled: ContextGraphRunMetrics
  readonly uncachedInputTokensSaved: number
  readonly totalInputTokensSaved: number
  readonly inputReductionRate?: number
  readonly outputTokenDelta: number
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcontextgraph--contextgraphservice"></a>

### `ctx.contextGraph` — `ContextGraphService`

Host service that extracts, ranks, and recalls reusable session checkpoints.

```ts cordis-catalog
/**
 * Read the current bounded graph, using a short event-invalidated cache.
 * @param signal Optional cancellation signal.
 * @returns Current projected graph snapshot.
 */
async snapshot(signal?: AbortSignal): Promise<ContextGraphSnapshot>

/**
 * Rank reusable completed turns for one target session and query.
 * @param targetSessionId Session receiving a possible recall.
 * @param query Direct user request.
 * @param signal Optional cancellation signal.
 * @returns Matching nodes in deterministic rank order.
 */
async match( targetSessionId: SessionId, query: string, signal?: AbortSignal, ): Promise<ContextGraphMatch[]>

/**
 * Remote graph read scoped by an existing target Agent.
 * @param agent Existing Agent that authorizes the read.
 * @param signal Request cancellation signal.
 * @returns Current projected graph snapshot.
 */
@Remote('snapshot') remoteSnapshot(agent: Agent, signal: AbortSignal): Promise<ContextGraphSnapshot>

/**
 * Remote ranked discovery scoped by an existing target Agent.
 * @param agent Agent receiving a possible recall.
 * @param query Direct user request.
 * @param signal Request cancellation signal.
 * @returns Matching nodes in deterministic rank order.
 */
@Remote('match') remoteMatch(agent: Agent, query: string, signal: AbortSignal): Promise<ContextGraphMatch[]>
```

Types: [Agent](core.md) · [SessionId](core.md)

Source: [`packages/context/context-graph/src/index.ts`](../../packages/context/context-graph/src/index.ts)
<!-- END GENERATED cordis-surface -->
