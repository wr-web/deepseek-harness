import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import ContextGraphService, { type Config } from '@deepseek-ai/dsh-context-graph'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'

class TestSessionQueryEngine extends SessionQueryEngine {
  override searchSessions(
    ..._args: Parameters<SessionQueryEngine['searchSessions']>
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(
    ..._args: Parameters<SessionQueryEngine['searchEvents']>
  ): ReturnType<SessionQueryEngine['searchEvents']> {
    return Promise.reject(new Error('unexpected searchEvents call'))
  }
}

const CONFIG: Config = {
  autoRecall: true,
  sameWorkspaceOnly: true,
  includeSubagents: false,
  maxSessions: 20,
  maxNodesPerSession: 20,
  readConcurrency: 2,
  maxTextBytes: 4096,
  maxRecallBytes: 2048,
  matchLimit: 5,
  minScore: 0.4,
  staleAfterMs: 60_000,
  cacheTtlMs: 10_000,
}

async function harness(config: Config = CONFIG): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin(ContextGraphService, config)
  return ctx
}

function appendCompletedTurn(session: Session, prompt: string, answer: string): void {
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: prompt }],
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      source: { kind: 'model', provider: 'mock', model: 'mock' },
      content: [
        { type: 'reasoning', text: 'private chain of thought' },
        { type: 'text', text: answer },
      ],
    }),
    usage: { inputTokens: 30, outputTokens: 8 },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

function fakeAgent(session: Session): Agent {
  return { id: session.id, session } as Agent
}

describe('ContextGraphService', () => {
  it('automatically appends one bounded, logged-provenance checkpoint on a matching first step', async () => {
    const ctx = await harness()
    const source = ctx.sessions.create(SessionId('source'))
    appendCompletedTurn(source, 'analyze token cache invalidation', 'Use a monotonic cache version stamp.')
    const target = ctx.sessions.create(SessionId('target'))
    const direct = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'continue token cache invalidation' }],
    })
    const signal = new AbortController().signal

    const decision = await agentEvents(ctx, fakeAgent(target)).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }),
    )

    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected entered pre-step')
    expect(decision.messages).toHaveLength(2)
    const recalled = decision.messages[1]
    expect(recalled?.source).toMatchObject({
      kind: 'context-graph',
      sourceSessionId: source.id,
      capturedThroughSeq: source.events.at(-1)?.seq,
    })
    const text = recalled?.content.find(block => block.type === 'text')?.text ?? ''
    expect(text).toContain('Use a monotonic cache version stamp.')
    expect(text).not.toContain('private chain of thought')
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(CONFIG.maxRecallBytes)

    const snapshot = await ctx.contextGraph.snapshot(signal)
    expect(await ctx.contextGraph.snapshot(signal)).toBe(snapshot)
    await expect(ctx.contextGraph.remoteSnapshot(fakeAgent(target), signal)).resolves.toBe(snapshot)
    await expect(ctx.contextGraph.remoteMatch(fakeAgent(target), 'token cache', signal))
      .resolves.toHaveLength(1)

    const later = await agentEvents(ctx, fakeAgent(target)).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 1, step: 2, signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }),
    )
    expect(later).toEqual({ kind: 'enter', messages: [direct] })

    const rejected = await agentEvents(ctx, fakeAgent(target)).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'reject' as const, reason: 'test rejection' }),
    )
    expect(rejected).toEqual({ kind: 'reject', reason: 'test rejection' })
  })

  it('skips candidates whose metadata alone exceeds the recall byte limit', async () => {
    const ctx = await harness({ ...CONFIG, maxRecallBytes: 256 })
    const source = ctx.sessions.create(SessionId('s'.repeat(300)))
    appendCompletedTurn(source, 'token cache', 'Use the existing cache.')
    const target = ctx.sessions.create(SessionId('target'))
    const direct = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'token cache' }],
    })
    const signal = new AbortController().signal
    const decision = await agentEvents(ctx, fakeAgent(target)).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }),
    )
    expect(decision).toEqual({ kind: 'enter', messages: [direct] })
  })

  it('does not recall into forked, completed, empty-query, or unrelated first turns', async () => {
    const ctx = await harness()
    const source = ctx.sessions.create(SessionId('source'))
    appendCompletedTurn(source, 'token cache', 'Use the existing cache.')
    const signal = new AbortController().signal
    const direct = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'token cache' }],
    })
    const next = (messages: typeof direct[]): Promise<{ kind: 'enter'; messages: typeof direct[] }> =>
      Promise.resolve({ kind: 'enter', messages })

    const forked = ctx.sessions.create(SessionId('forked'), {
      meta: { parentSession: source.id, seedLength: source.seq },
    })
    await expect(agentEvents(ctx, fakeAgent(forked)).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 1, step: 1, signal },
      () => next([direct]),
    )).resolves.toEqual({ kind: 'enter', messages: [direct] })

    const completed = ctx.sessions.create(SessionId('completed'))
    appendCompletedTurn(completed, 'already done', 'Done.')
    await expect(agentEvents(ctx, fakeAgent(completed)).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 2, step: 1, signal },
      () => next([direct]),
    )).resolves.toEqual({ kind: 'enter', messages: [direct] })

    const empty = ctx.sessions.create(SessionId('empty'))
    const pluginMessage = createUserMessage({
      source: { kind: 'plugin', plugin: 'test' },
      content: [{ type: 'text', text: 'ignored plugin text' }],
    })
    const reasoningOnly = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'reasoning', text: 'not direct user text' }],
    })
    await expect(agentEvents(ctx, fakeAgent(empty)).waterfall(
      'agent/pre-step',
      { messages: [pluginMessage, reasoningOnly], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [pluginMessage, reasoningOnly] }),
    )).resolves.toEqual({ kind: 'enter', messages: [pluginMessage, reasoningOnly] })

    const unrelated = ctx.sessions.create(SessionId('unrelated'))
    const other = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'paint a landscape' }],
    })
    await expect(agentEvents(ctx, fakeAgent(unrelated)).waterfall(
      'agent/pre-step',
      { messages: [other], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [other] }),
    )).resolves.toEqual({ kind: 'enter', messages: [other] })
  })

  it('reads persisted sessions concurrently and skips unreadable records', async () => {
    const ctx = await harness({
      ...CONFIG,
      autoRecall: false,
      includeSubagents: true,
      cacheTtlMs: 0,
    })
    const persistedHeader: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('persisted'),
      createdAt: 1,
      cwd: 'C:\\repo',
    }
    const unreadableHeader: SessionHeader = {
      ...persistedHeader,
      id: SessionId('unreadable'),
    }
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockResolvedValue([
      { header: persistedHeader, live: false, persisted: true },
      { header: unreadableHeader, live: false, persisted: true },
    ])
    const readSession = vi.spyOn(ctx.sessionQuery, 'readSession').mockImplementation((id) => {
      if (id === persistedHeader.id) return Promise.resolve({ session: persistedHeader, events: [] })
      return Promise.reject(new Error('broken persisted log'))
    })

    await expect(ctx.contextGraph.snapshot()).resolves.toMatchObject({ nodes: [], edges: [] })
    expect(readSession).toHaveBeenCalledTimes(2)
    await expect(ctx.contextGraph.match(persistedHeader.id, 'query')).resolves.toEqual([])
  })

  it('excludes subagent records unless configured and honors cancellation', async () => {
    const ctx = await harness({ ...CONFIG, autoRecall: false })
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('subagent'),
      createdAt: 1,
      origin: 'subagent',
    }
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockResolvedValue([
      { header, live: false, persisted: true },
    ])
    const readSession = vi.spyOn(ctx.sessionQuery, 'readSession')
    await expect(ctx.contextGraph.snapshot()).resolves.toMatchObject({ nodes: [] })
    expect(readSession).not.toHaveBeenCalled()

    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(ctx.contextGraph.snapshot(controller.signal)).rejects.toThrow('cancelled')
  })

  it('validates every numeric configuration domain', async () => {
    const cases: Array<[Partial<Config>, string]> = [
      [{ maxSessions: 'many' as never }, 'positive safe integer'],
      [{ maxSessions: 1.5 }, 'positive safe integer'],
      [{ maxSessions: 0 }, 'positive safe integer'],
      [{ cacheTtlMs: -1 }, 'non-negative safe integer'],
      [{ maxRecallBytes: 255 }, 'at least 256'],
      [{ minScore: Number.NaN }, 'between zero and one'],
      [{ minScore: -0.1 }, 'between zero and one'],
      [{ minScore: 1.1 }, 'between zero and one'],
    ]
    for (const [patch, message] of cases) {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(TestSessionQueryEngine)
      expect(() => new ContextGraphService(ctx, { ...CONFIG, autoRecall: false, ...patch }))
        .toThrow(message)
    }

    const detached = Session.create(SessionId('detached'))
    expect(fakeAgent(detached).id).toBe(detached.id)
  })
})
