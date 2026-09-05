import { describe, expect, it } from 'vitest'
import { CallId, createMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  buildContextGraph, ContextGraphNodeId, evaluateContextGraph, matchContextGraph,
  measureContextGraphRun, truncateUtf8,
  type ContextGraphMessageSource,
} from '@deepseek-ai/dsh-context-graph'

const NOW = 2_000_000_000_000
const OPTIONS = { maxNodesPerSession: 20, maxTextBytes: 4096, staleAfterMs: 1_000 }

function header(id: string, extra: Partial<SessionHeader> = {}): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: NOW - 10_000,
    cwd: 'C:\\repo',
    ...extra,
  }
}

function appendTurn(
  session: Session,
  turn: number,
  prompt: string,
  answer: string,
  options: { recall?: ContextGraphMessageSource; tool?: string; toolCalls?: number } = {},
): number {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: prompt }],
  }), { surfaceOp: 'append' })
  if (options.recall !== undefined) {
    session.append('user/message', createUserMessage({
      source: options.recall,
      content: [{ type: 'text', text: 'bounded recalled summary' }],
    }), { surfaceOp: 'append' })
  }
  if (options.tool !== undefined) {
    for (let index = 0; index < (options.toolCalls ?? 1); index += 1) {
      const callId = CallId(`${session.id}-${turn}-${index}`)
      session.append('tool/call', {
        turn, step: 1, callId, name: options.tool, arguments: '{}',
      })
      session.append('tool/result', {
        turn,
        step: 1,
        message: createToolResultMessage({
          callId,
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        }),
      }, { surfaceOp: 'append' })
    }
  }
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createMessage({
      role: 'assistant',
      source: { kind: 'model', provider: 'mock', model: 'mock' },
      content: [{ type: 'reasoning', text: 'not projected' }, { type: 'text', text: answer }],
    }),
    usage: { inputTokens: 90, cacheReadTokens: 10, outputTokens: 20 },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  const ended = session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return ended.seq
}

describe('context graph extraction', () => {
  it('keeps non-inherited checkpoints and connects a completed-turn fork', () => {
    const parent = Session.create(SessionId('parent'), undefined, header('parent'))
    const parentBoundary = appendTurn(parent, 1, 'inspect auth flow', 'Auth uses signed sessions.', { tool: 'grep' })
    const childHeader = header('child', {
      parentSession: parent.id,
      seedLength: parent.events.length,
    })
    const child = Session.create(SessionId('child'), parent.events, childHeader)
    appendTurn(child, 2, 'add refresh rotation', 'Rotation is implemented and tested.')

    const graph = buildContextGraph([
      { header: parent.header, events: parent.events },
      { header: child.header, events: child.events },
    ], parent.events[parentBoundary]?.time ?? NOW, OPTIONS)

    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0]).toMatchObject({
      sessionId: parent.id,
      prompt: 'inspect auth flow',
      summary: 'Auth uses signed sessions.',
      actions: [{ name: 'grep', count: 1 }],
      inputTokens: 90,
      cacheReadTokens: 10,
      outputTokens: 20,
    })
    expect(graph.nodes[1]).toMatchObject({ sessionId: child.id, turn: 2 })
    expect(graph.edges).toContainEqual(expect.objectContaining({
      kind: 'fork',
      from: graph.nodes[0]?.id,
      to: graph.nodes[1]?.id,
    }))
  })

  it('records recall as a cross-branch edge and counts its exact logged bytes', () => {
    const source = Session.create(SessionId('source'), undefined, header('source'))
    const boundary = appendTurn(source, 1, '分析缓存失效', '缓存由版本戳失效。')
    const sourceId = ContextGraphNodeId(`${source.id}@1:${boundary}`)
    const target = Session.create(SessionId('target'), undefined, header('target'))
    appendTurn(target, 1, '修复缓存失效', '复用了版本戳方案。', {
      recall: {
        kind: 'context-graph',
        form: 'recall',
        version: 1,
        sourceNodeId: sourceId,
        sourceSessionId: source.id,
        capturedThroughSeq: boundary,
        score: 0.8,
        recalledBytes: 321,
      },
    })

    const graph = buildContextGraph([
      { header: source.header, events: source.events },
      { header: target.header, events: target.events },
    ], Date.now(), { ...OPTIONS, staleAfterMs: Number.MAX_SAFE_INTEGER })
    expect(graph.edges).toContainEqual(expect.objectContaining({ kind: 'recall', from: sourceId }))
    expect(graph.nodes.find(node => node.sessionId === target.id)).toMatchObject({
      recalledFrom: sourceId,
      recallScore: 0.8,
    })
    expect(graph.stats.recalledBytes).toBe(321)
  })

  it('connects continuations, applies retention, and keeps projectless prompt-only turns non-reusable', () => {
    const projectlessHeader: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('chain'),
      createdAt: NOW - 10_000,
    }
    const source = Session.create(SessionId('chain'), undefined, projectlessHeader)
    appendTurn(source, 1, 'first request', 'First result.')
    appendTurn(source, 2, 'second request', '')
    const complete = buildContextGraph(
      [{ header: source.header, events: source.events }],
      source.events.at(-1)?.time ?? NOW,
      OPTIONS,
    )
    expect(complete.projects).toMatchObject([{ label: 'Projectless sessions' }])
    expect(complete.projects[0]).not.toHaveProperty('cwd')
    expect(complete.edges).toContainEqual(expect.objectContaining({ kind: 'continuation' }))
    expect(complete.nodes[1]).toMatchObject({ key: 'second request', reusable: false, recalledBytes: 0 })

    const retained = buildContextGraph(
      [{ header: source.header, events: source.events }],
      source.events.at(-1)?.time ?? NOW,
      { ...OPTIONS, maxNodesPerSession: 1 },
    )
    expect(retained.nodes.map(node => node.turn)).toEqual([2])
  })

  it('skips incomplete event fragments and resolves fork ancestry through an empty parent', () => {
    const grand = Session.create(SessionId('grand'), undefined, header('grand'))
    appendTurn(grand, 1, 'root task', 'Root result.')
    const parentHeader = header('empty-parent', { parentSession: grand.id })
    const child = Session.create(SessionId('child-source'), undefined, header('child-source'))
    appendTurn(child, 2, 'child task', 'Child result.')
    const shifted = child.events.map((event): SessionEvent => ({ ...event, seq: event.seq + 10 }))
    const childHeader = header('child-source', { parentSession: SessionId('empty-parent'), seedLength: 10 })
    const fragments = Session.create(SessionId('fragments'), undefined, header('fragments'))
    fragments.append('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId('outside-turn'),
      name: 'ignored',
      arguments: '{}',
    })
    fragments.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'outside' }] }), { surfaceOp: 'append' })
    fragments.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [{ type: 'text', text: 'outside' }] }),
    }, { surfaceOp: 'append' })
    fragments.append('turn/start', { turn: 1 })
    fragments.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    fragments.append('turn/start', { turn: 2 })
    fragments.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    const graph = buildContextGraph([
      { header: grand.header, events: grand.events },
      { header: parentHeader, events: [] },
      { header: childHeader, events: shifted },
      { header: fragments.header, events: fragments.events },
    ], Date.now(), { ...OPTIONS, staleAfterMs: Number.MAX_SAFE_INTEGER })
    expect(graph.edges).toContainEqual(expect.objectContaining({
      kind: 'fork',
      from: graph.nodes.find(node => node.sessionId === grand.id)?.id,
      to: graph.nodes.find(node => node.sessionId === childHeader.id)?.id,
    }))
    expect(graph.nodes.some(node => node.sessionId === fragments.id)).toBe(false)
  })

  it('terminates missing and cyclic parent chains without fabricating a fork', () => {
    const child = Session.create(SessionId('cycle-child'), undefined, header('cycle-child'))
    appendTurn(child, 1, 'cycle task', 'Cycle result.')
    const shifted = child.events.map((event): SessionEvent => ({ ...event, seq: event.seq + 10 }))
    const graph = buildContextGraph([
      { header: header('cycle-child', { parentSession: SessionId('cycle-a'), seedLength: 10 }), events: shifted },
      { header: header('cycle-a', { parentSession: SessionId('cycle-b') }), events: [] },
      { header: header('cycle-b', { parentSession: SessionId('cycle-a') }), events: [] },
      { header: header('missing-child', { parentSession: SessionId('absent'), seedLength: 10 }), events: shifted },
      { header: header('root-parent-child', { parentSession: SessionId('root-parent') }), events: child.events },
      { header: header('root-parent'), events: [] },
    ], Date.now(), { ...OPTIONS, staleAfterMs: Number.MAX_SAFE_INTEGER })
    expect(graph.edges.filter(edge => edge.kind === 'fork')).toEqual([])
  })
})

describe('context graph matching and bounds', () => {
  it('matches English and Chinese terms, respects workspace affinity, and excludes stale nodes', () => {
    const fresh = Session.create(SessionId('fresh'), undefined, header('fresh'))
    appendTurn(fresh, 1, '分析 token 缓存策略', 'Token cache uses stable request prefixes.')
    const other = Session.create(SessionId('other'), undefined, header('other', { cwd: 'C:\\other' }))
    appendTurn(other, 1, 'token cache strategy', 'A different project cache.')
    const graph = buildContextGraph([
      { header: fresh.header, events: fresh.events },
      { header: other.header, events: other.events },
    ], Date.now(), { ...OPTIONS, staleAfterMs: Number.MAX_SAFE_INTEGER })

    const matches = matchContextGraph(
      graph,
      '继续分析 token 缓存',
      SessionId('target'),
      'C:\\repo',
      true,
      0.2,
      5,
    )
    expect(matches.map(match => match.node.sessionId)).toEqual([fresh.id])

    const staleGraph = buildContextGraph(
      [{ header: fresh.header, events: fresh.events }],
      Date.now() + 2_000,
      { ...OPTIONS, staleAfterMs: 1 },
    )
    expect(matchContextGraph(staleGraph, 'token cache', SessionId('target'), 'C:\\repo', true, 0, 5)).toEqual([])
  })

  it('truncates on a UTF-8 codepoint boundary', () => {
    const value = truncateUtf8('ab界cd', 4)
    expect(value).toBe('a…')
    expect(Buffer.byteLength(value, 'utf8')).toBe(4)
    expect(truncateUtf8('abc', 2)).toBe('')
    expect(truncateUtf8('ab界cd', 6)).toBe('ab…')
  })

  it('covers empty queries, candidate exclusions, cross-workspace mode, and deterministic tie breaks', () => {
    const source = Session.create(SessionId('ranked'), undefined, header('ranked'))
    appendTurn(source, 1, 'token cache', 'token cache result', { tool: 'read_cache', toolCalls: 2 })
    const graph = buildContextGraph(
      [{ header: source.header, events: source.events }],
      source.events.at(-1)?.time ?? NOW,
      OPTIONS,
    )
    const base = graph.nodes[0]
    if (base === undefined) throw new Error('missing fixture node')
    const ranked = {
      ...graph,
      nodes: [
        { ...base, id: ContextGraphNodeId('b'), sessionId: SessionId('b'), completedAt: 1 },
        { ...base, id: ContextGraphNodeId('a'), sessionId: SessionId('a'), completedAt: 1 },
        { ...base, id: ContextGraphNodeId('newer'), sessionId: SessionId('newer'), completedAt: 2 },
        { ...base, id: ContextGraphNodeId('partial'), sessionId: SessionId('partial'), prompt: 'token only', summary: '' },
        { ...base, id: ContextGraphNodeId('self'), sessionId: SessionId('target') },
        { ...base, id: ContextGraphNodeId('failed'), sessionId: SessionId('failed'), reusable: false },
        { ...base, id: ContextGraphNodeId('stale'), sessionId: SessionId('stale'), freshness: 'stale' as const },
        { ...base, id: ContextGraphNodeId('other'), sessionId: SessionId('other'), cwd: 'C:\\other' },
      ],
    }
    expect(matchContextGraph(ranked, '', SessionId('target'), 'C:\\repo', true, 0, 10)).toEqual([])
    expect(matchContextGraph(ranked, 'token cache', SessionId('target'), 'C:\\repo', true, 0.75, 10)
      .map(match => match.node.id)).toEqual([ContextGraphNodeId('newer'), ContextGraphNodeId('a'), ContextGraphNodeId('b')])
    expect(matchContextGraph(ranked, 'token cache', SessionId('target'), 'C:\\repo', false, 0.75, 10)
      .some(match => match.node.id === ContextGraphNodeId('other'))).toBe(true)
  })

  it('classifies aging checkpoints', () => {
    const source = Session.create(SessionId('aging'), undefined, header('aging'))
    appendTurn(source, 1, 'age task', 'Age result.')
    const completedAt = source.events.at(-1)?.time ?? NOW
    const graph = buildContextGraph(
      [{ header: source.header, events: source.events }],
      completedAt + 750,
      { ...OPTIONS, staleAfterMs: 1_000 },
    )
    expect(graph.nodes[0]?.freshness).toBe('aging')
  })

  it('uses cwd as a fallback project label and handles absent assistant usage', () => {
    const rootHeader = header('root-cwd', { cwd: 'C:\\' })
    const source = Session.create(rootHeader.id, undefined, rootHeader)
    source.append('turn/start', { turn: 1 })
    source.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '   ' }],
    }), { surfaceOp: 'append' })
    source.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        source: { kind: 'model', provider: 'mock', model: 'mock' },
        content: [{ type: 'text', text: 'Done.' }],
      }),
    }, { surfaceOp: 'append' })
    source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const graph = buildContextGraph(
      [{ header: source.header, events: source.events }],
      Date.now(),
      { ...OPTIONS, staleAfterMs: Number.MAX_SAFE_INTEGER },
    )
    expect(graph.projects[0]?.label).toBe('C:\\')
    expect(graph.nodes[0]).toMatchObject({
      key: 'Done.',
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    })
  })
})

describe('context graph evaluation', () => {
  it('compares logged provider usage and exact recall volume', () => {
    const baseline = Session.create(SessionId('baseline'), undefined, header('baseline'))
    appendTurn(baseline, 1, 'repeat analysis', 'First analysis.')
    appendTurn(baseline, 2, 'implement it', 'Implementation complete.')

    const recalled = Session.create(SessionId('recalled'), undefined, header('recalled'))
    appendTurn(recalled, 1, 'implement it', 'Implementation complete.', {
      recall: {
        kind: 'context-graph',
        form: 'recall',
        version: 1,
        sourceNodeId: ContextGraphNodeId('source@1:8'),
        sourceSessionId: SessionId('source'),
        capturedThroughSeq: 8,
        score: 1,
        recalledBytes: 512,
      },
    })

    expect(measureContextGraphRun(recalled.events)).toMatchObject({
      totalInputTokens: 100,
      outputTokens: 20,
      recallCount: 1,
      recalledBytes: 512,
    })
    expect(evaluateContextGraph(baseline.events, recalled.events)).toMatchObject({
      uncachedInputTokensSaved: 90,
      totalInputTokensSaved: 100,
      inputReductionRate: 0.5,
      outputTokenDelta: -20,
    })
  })

  it('omits the reduction rate when the baseline has no input usage', () => {
    const empty = evaluateContextGraph([], [])
    expect(empty.inputReductionRate).toBeUndefined()
    expect(empty.totalInputTokensSaved).toBe(0)
  })

  it('treats omitted provider usage fields as zero', () => {
    const session = Session.create(SessionId('usage-optional'), undefined, header('usage-optional'))
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        source: { kind: 'model', provider: 'mock', model: 'mock' },
        content: [{ type: 'text', text: 'no usage' }],
      }),
      usage: { inputTokens: 1, outputTokens: 2 },
    }, { surfaceOp: 'append' })
    const event = session.events[0]
    if (event?.type !== 'assistant/message') throw new Error('missing assistant fixture')
    const sparse = [{ ...event, data: { ...event.data, usage: undefined } }] as SessionEvent[]
    expect(measureContextGraphRun(sparse)).toMatchObject({
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    })
  })
})
