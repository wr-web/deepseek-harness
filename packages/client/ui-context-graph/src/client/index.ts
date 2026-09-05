/** Browser context-graph view registration. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import contextGraphRemote from '@deepseek-ai/dsh-context-graph/remote'
import type { ContextGraphNode, ContextGraphSnapshot } from '@deepseek-ai/dsh-context-graph/types'
import { ContextGraphView, type ContextGraphViewInjected } from './ContextGraphView.tsx'
import { en, NS, zh } from './locales.ts'

export const inject = ['slots', 'sessions', 'locale', 'remote']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contextGraphRemote)
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-context-graph: dictionaries')
    const t = ctx.locale.bind(NS)
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view',
      id: 'context-graph',
      order: 20,
      locale: NS,
      label: () => t('view.label'),
      inject: (sessionId: SessionId): ContextGraphViewInjected => ({
        async loadGraph(signal): Promise<ContextGraphSnapshot> {
          const result = await ctx.remote.contextGraph.snapshot(sessionId, signal)
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
          return result.value
        },
        async forkFrom(node: ContextGraphNode): Promise<void> {
          const child = await ctx.sessions.fork({
            sessionId: node.sessionId,
            atSeq: node.boundarySeq,
            increaseTitle: true,
          })
          ctx.sessions.open(child)
        },
      }),
    }, ContextGraphView))
  } catch (error) {
    await disposeRemote()
    throw error
  }
  return disposeRemote
}
