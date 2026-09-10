#!/usr/bin/env node
/** Snapshot-only Loader driver for two-session automatic context recall. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-context-graph'

const NAME = 'context-graph-snapshot-driver'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

function assistantText(agent: Agent, afterSeq: number): string {
  const event = agent.session.events
    .filter(item => item.seq > afterSeq && item.type === 'assistant/message')
    .at(-1)
  if (event?.type !== 'assistant/message') throw new Error(`agent ${agent.id} produced no assistant message`)
  return event.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

async function runTurn(ctx: Context, agent: Agent, text: string): Promise<string> {
  await agent.whenIdle()
  const afterSeq = agent.session.seq
  agent.followup(createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  }))
  await agent.whenIdle()
  await ctx.sessions.flush(agent.session)
  return assistantText(agent, afterSeq)
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const source = ctx.agents.get(SessionId('context-source'))
  const target = ctx.agents.get(SessionId('context-target'))
  if (source === undefined || target === undefined) throw new Error('context-graph fixture agents are missing')
  const sourceOutput = await runTurn(ctx, source, 'analyze token cache invalidation for this project')
  const sourceBoundary = source.session.events.findLast(event => event.type === 'turn/end')?.seq
  const targetOutput = await runTurn(ctx, target, 'continue token cache invalidation implementation')
  const recallEvent = target.session.events.find(event => event.type === 'user/message'
    && event.data.source.kind === 'context-graph')
  if (recallEvent?.type !== 'user/message' || recallEvent.data.source.kind !== 'context-graph') {
    throw new Error('target session did not log context-graph provenance')
  }
  const recall = recallEvent.data.source
  const recallText = recallEvent.data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
  const graph = await ctx.contextGraph.snapshot()
  process.stdout.write(`${JSON.stringify({
    source: sourceOutput,
    target: targetOutput,
    recall: {
      recalledFromSource: recall.sourceSessionId === source.id,
      capturedCompletedTurn: recall.capturedThroughSeq === sourceBoundary,
      withinBudget: recall.recalledBytes <= 2048,
      privateReasoningLeaked: recallText.includes('PRIVATE_SOURCE_REASONING'),
    },
    graph: { nodes: graph.stats.nodes, recallEdges: graph.stats.recallEdges },
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
