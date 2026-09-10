/** Session-log measurements for context-graph baseline comparisons. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContextGraphEvaluation, ContextGraphRunMetrics } from './types.ts'

/**
 * Aggregate provider-reported usage and recalled bytes from one session log.
 * @param events Durable events from one run.
 * @returns Provider usage and recall volume.
 */
export function measureContextGraphRun(events: readonly SessionEvent[]): ContextGraphRunMetrics {
  let uncachedInputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  let recallCount = 0
  let recalledBytes = 0
  for (const event of events) {
    if (event.type === 'assistant/message') {
      uncachedInputTokens += event.data.usage?.inputTokens ?? 0
      cacheReadTokens += event.data.usage?.cacheReadTokens ?? 0
      cacheWriteTokens += event.data.usage?.cacheWriteTokens ?? 0
      outputTokens += event.data.usage?.outputTokens ?? 0
    }
    if (event.type === 'user/message' && event.data.source.kind === 'context-graph') {
      recallCount += 1
      recalledBytes += event.data.source.recalledBytes
    }
  }
  return {
    uncachedInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalInputTokens: uncachedInputTokens + cacheReadTokens + cacheWriteTokens,
    recallCount,
    recalledBytes,
  }
}

/**
 * Compare equivalent baseline and recalled session logs without asserting task quality.
 * @param baselineEvents Events from the run without automatic recall.
 * @param recalledEvents Events from the equivalent run with automatic recall.
 * @returns Signed usage comparison and both measured runs.
 */
export function evaluateContextGraph(
  baselineEvents: readonly SessionEvent[],
  recalledEvents: readonly SessionEvent[],
): ContextGraphEvaluation {
  const baseline = measureContextGraphRun(baselineEvents)
  const recalled = measureContextGraphRun(recalledEvents)
  const totalInputTokensSaved = baseline.totalInputTokens - recalled.totalInputTokens
  return {
    baseline,
    recalled,
    uncachedInputTokensSaved: baseline.uncachedInputTokens - recalled.uncachedInputTokens,
    totalInputTokensSaved,
    ...(baseline.totalInputTokens === 0
      ? {}
      : { inputReductionRate: totalInputTokensSaved / baseline.totalInputTokens }),
    outputTokenDelta: recalled.outputTokens - baseline.outputTokens,
  }
}
