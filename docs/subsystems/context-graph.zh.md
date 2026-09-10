# 上下文图

[English](context-graph.md) | 中文

上下文图是已完成会话轮次的读取时投影。它让新根会话获得一小段可复用检查点，而不用复制整段旧 transcript 或持久化隐藏模型 reasoning。[`@deepseek-ai/dsh-context-graph`](../../packages/context/context-graph)负责提取、匹配、复用来源和成本计量；[`@deepseek-ai/dsh-client-ui-context-graph`](../../packages/client/ui-context-graph)负责浏览器树与显式 fork 操作。

来源：[`packages/context/context-graph/src/types.ts`](../../packages/context/context-graph/src/types.ts) · [`packages/context/context-graph/src/index.ts`](../../packages/context/context-graph/src/index.ts)

## 投影与边

每个节点是一个完成的 `turn/end` 检查点。稳定 ID 组合会话、轮次与终止序列。prompt 文本来自直接用户消息，摘要/key 文本来自可见的 assistant 最终块，action 计数来自工具调用，token 总量来自提供方 usage。继承的 seed 事件、reasoning 块和未完成轮次不会创建节点。

连续边连接同一会话内保留的轮次。fork 边把子会话的第一个新轮次连接到记录的 fork 序列处可用的最新父检查点。复用边来自目标轮次日志中带身份的 `context-graph` 消息 source。工作目录把会话分组为项目根，也是自动匹配默认的隔离 key。

`ContextGraphSnapshot` 是浏览器和匹配共同使用的完整有界投影。

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

## 匹配与新鲜度

自动匹配只考虑已完成且未腐败的检查点。它在 prompt、可见摘要与工具名上计算确定性的规范化查询 token 覆盖率；中文字符与双字组合和普通英文词一起参与。Host 策略提供工作区隔离、分数阈值、结果数量和扫描上限。

新鲜度使用快照时的年龄：`staleAfterMs` 的前一半为新鲜，后一半为老化中，达到阈值后为已腐败。已腐败节点仍然可见且可显式 fork，但不能进入自动模型请求。年龄是一种保守过期策略，并不是仓库内容仍与节点一致的证据。

```ts type-equiv
/** Ranked automatic-recall candidate. */
interface ContextGraphMatch {
  readonly node: ContextGraphNode
  /** Query-token coverage from zero through one. */
  readonly score: number
}
```

## 有日志来源的复用

自动复用在全新根会话的第一个 step 运行。它在当前直接请求后最多追加一个完整且有字节上限的用户角色检查点。模型可见警告把 JSON 字段视为不可信、只读背景。source 记录保留足够的信息，让重放可以重建图边并计量准确注入字节。

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

## 成本评测

`measureContextGraphRun()` 从一个会话日志读取真实提供方 usage 与复用 source。`evaluateContextGraph()` 比较一次不复用的等价运行和一次复用运行。saved-token 字段为正表示复用运行更省。任务成功、改动、测试与延迟仍是独立 benchmark 结果；更便宜但失败的任务不是改进。

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md) · [SessionId](core.zh.md)

Source: [`packages/context/context-graph/src/index.ts`](../../packages/context/context-graph/src/index.ts)
<!-- END GENERATED cordis-surface -->
