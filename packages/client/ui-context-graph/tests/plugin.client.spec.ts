import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ContextGraphNodeId, type ContextGraphNode, type ContextGraphSnapshot } from '@deepseek-ai/dsh-context-graph'
import { apply as nodeApply } from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import { apply as clientApply } from '../src/client/index.ts'

const NODE: ContextGraphNode = {
  id: ContextGraphNodeId('source@1:5'),
  sessionId: SessionId('source'),
  projectId: 'project:test',
  turn: 1,
  boundarySeq: 5,
  key: 'Reusable checkpoint',
  prompt: 'Analyze the cache',
  summary: 'Use a monotonic version.',
  actions: [],
  outcome: 'completed',
  reusable: true,
  completedAt: 1,
  freshness: 'fresh',
  inputTokens: 10,
  cacheReadTokens: 0,
  outputTokens: 5,
  recalledBytes: 0,
}

const SNAPSHOT: ContextGraphSnapshot = {
  generatedAt: 1,
  projects: [{ id: 'project:test', label: 'test', sessionIds: [NODE.sessionId] }],
  sessions: [{
    sessionId: NODE.sessionId,
    projectId: 'project:test',
    createdAt: 1,
    nodeIds: [NODE.id],
  }],
  nodes: [NODE],
  edges: [],
  stats: { projects: 1, sessions: 1, nodes: 1, reusableNodes: 1, recallEdges: 0, recalledBytes: 0 },
}

describe('context-graph browser plugin', () => {
  it('keeps the node entry inert and registers its empty invariant companion', async () => {
    nodeApply()
    const dispose = vi.fn()
    const register = vi.fn().mockReturnValue(dispose)
    const installed = await invariant.apply({ invariants: { register } } as never)
    expect(invariant.name).toBe('client-ui-context-graph-invariant')
    expect(invariant.inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-client-ui-context-graph', expect.any(Function))
    expect(() => { (register.mock.calls[0]![1] as () => void)() }).not.toThrow()
    expect(installed).toBe(dispose)
  })

  it('registers the view, reads its Remote face, and forks at the selected boundary', async () => {
    let registration: {
      label: () => string
      inject: (sessionId: SessionId) => {
        loadGraph: (signal: AbortSignal) => Promise<ContextGraphSnapshot>
        forkFrom: (node: ContextGraphNode) => Promise<void>
      }
    } | undefined
    const localeDispose = vi.fn()
    const slotDispose = vi.fn()
    const open = vi.fn()
    const fork = vi.fn().mockResolvedValue(SessionId('child'))
    const snapshot = vi.fn().mockResolvedValue({ ok: true, value: SNAPSHOT })
    const ctx = {
      effect: vi.fn((install: () => unknown) => install()),
      locale: {
        register: vi.fn().mockReturnValue(localeDispose),
        bind: vi.fn().mockReturnValue((key: string) => key),
      },
      slots: {
        inject: vi.fn((_name: string, install: () => unknown) => install()),
        register: vi.fn((entry: typeof registration) => {
          registration = entry
          return slotDispose
        }),
      },
      remote: { contextGraph: { snapshot } },
      sessions: { fork, open },
    }

    clientApply(ctx as never)
    expect(ctx.locale.register).toHaveBeenCalledOnce()
    expect(ctx.slots.inject).toHaveBeenCalledWith('conversation.view', expect.any(Function))
    expect(registration?.label()).toBe('view.label')
    const face = registration?.inject(SessionId('target'))
    if (face === undefined) throw new Error('view registration was not captured')
    const signal = new AbortController().signal
    await expect(face.loadGraph(signal)).resolves.toBe(SNAPSHOT)
    await face.forkFrom(NODE)
    expect(fork).toHaveBeenCalledWith({ sessionId: NODE.sessionId, atSeq: NODE.boundarySeq, increaseTitle: true })
    expect(open).toHaveBeenCalledWith(SessionId('child'))

    snapshot.mockResolvedValueOnce({ ok: false, error: { code: 'BROKEN', message: 'unavailable' } })
    await expect(face.loadGraph(signal)).rejects.toThrow('BROKEN: unavailable')
  })
})
