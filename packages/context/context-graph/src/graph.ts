/** Pure extraction and ranking for the cross-session context graph. */

import { Buffer } from 'node:buffer'
import { basename } from 'node:path'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import {
  ContextGraphNodeId,
  type ContextGraphAction,
  type ContextGraphEdge,
  type ContextGraphFreshness,
  type ContextGraphMatch,
  type ContextGraphNode,
  type ContextGraphProject,
  type ContextGraphSession,
  type ContextGraphSnapshot,
} from './types.ts'

/** Complete detached session input used by graph extraction. */
export interface ContextGraphSource {
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
}

/** Extraction choices already validated by the service. */
export interface GraphOptions {
  readonly maxNodesPerSession: number
  readonly maxTextBytes: number
  readonly staleAfterMs: number
}

interface TurnBuilder {
  turn: number
  promptParts: string[]
  assistantParts: string[]
  actions: Map<string, number>
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  recalledFrom?: ContextGraphNodeId
  recallScore?: number
  recalledBytes: number
}

interface ExtractedSession {
  source: ContextGraphSource
  session: ContextGraphSession
  nodes: ContextGraphNode[]
}

/**
 * Build one deterministic forest from detached session logs.
 * @param sources Complete session logs to project.
 * @param now Snapshot generation time in Unix epoch milliseconds.
 * @param options Validated extraction limits.
 * @returns Projected forest and aggregate statistics.
 */
export function buildContextGraph(
  sources: readonly ContextGraphSource[],
  now: number,
  options: GraphOptions,
): ContextGraphSnapshot {
  const extracted = sources.map(source => extractSession(source, now, options))
  const nodes = extracted.flatMap(item => item.nodes)
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const sessionById = new Map(extracted.map(item => [item.source.header.id, item]))
  const edges: ContextGraphEdge[] = []
  for (const item of extracted) {
    let previous: ContextGraphNode | undefined
    for (const node of item.nodes) {
      if (previous !== undefined) edges.push(edge('continuation', previous.id, node.id))
      previous = node
    }
    const first = item.nodes[0]
    if (first !== undefined && item.source.header.parentSession !== undefined) {
      const inheritedThrough = Math.max((item.source.header.seedLength ?? 0) - 1, 0)
      const parent = sourceNodeAt(sessionById, item.source.header.parentSession, inheritedThrough)
      if (parent !== undefined) edges.push(edge('fork', parent.id, first.id))
    }
    for (const node of item.nodes) {
      if (node.recalledFrom !== undefined && nodeById.has(node.recalledFrom)) {
        edges.push(edge('recall', node.recalledFrom, node.id))
      }
    }
  }

  const projectRows = new Map<string, { cwd?: string; sessions: SessionId[] }>()
  for (const item of extracted) {
    if (item.nodes.length === 0) continue
    const row = projectRows.get(item.session.projectId)
    if (row === undefined) {
      projectRows.set(item.session.projectId, {
        ...(item.session.cwd === undefined ? {} : { cwd: item.session.cwd }),
        sessions: [item.session.sessionId],
      })
    } else {
      row.sessions.push(item.session.sessionId)
    }
  }
  const projects: ContextGraphProject[] = [...projectRows].map(([id, row]) => ({
    id,
    label: row.cwd === undefined ? 'Projectless sessions' : basename(row.cwd) || row.cwd,
    ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
    sessionIds: row.sessions,
  }))
  const recalledBytes = nodes.reduce((total, node) => total + node.recalledBytes, 0)
  return {
    generatedAt: now,
    projects,
    sessions: extracted.filter(item => item.nodes.length > 0).map(item => item.session),
    nodes,
    edges,
    stats: {
      projects: projects.length,
      sessions: extracted.filter(item => item.nodes.length > 0).length,
      nodes: nodes.length,
      reusableNodes: nodes.filter(node => node.reusable).length,
      recallEdges: edges.filter(item => item.kind === 'recall').length,
      recalledBytes,
    },
  }
}

/**
 * Rank reusable nodes against a direct user request.
 * @param snapshot Forest containing candidate nodes.
 * @param query Direct user request.
 * @param targetSessionId Session receiving a possible recall.
 * @param targetCwd Recorded target working directory.
 * @param sameWorkspaceOnly Whether candidates must have the same working directory.
 * @param minScore Minimum query-token coverage.
 * @param limit Maximum number of returned candidates.
 * @returns Candidates in deterministic descending score order.
 */
export function matchContextGraph(
  snapshot: ContextGraphSnapshot,
  query: string,
  targetSessionId: SessionId,
  targetCwd: string | undefined,
  sameWorkspaceOnly: boolean,
  minScore: number,
  limit: number,
): ContextGraphMatch[] {
  const queryTokens = tokens(query)
  if (queryTokens.size === 0) return []
  return snapshot.nodes.flatMap((node): ContextGraphMatch[] => {
    if (!node.reusable || node.sessionId === targetSessionId || node.freshness === 'stale') return []
    if (sameWorkspaceOnly && node.cwd !== targetCwd) return []
    const candidate = tokens(`${node.prompt}\n${node.summary}\n${node.actions.map(action => action.name).join(' ')}`)
    let overlap = 0
    for (const token of queryTokens) if (candidate.has(token)) overlap += 1
    const score = overlap / queryTokens.size
    return score < minScore ? [] : [{ node, score }]
  }).sort((left, right) => right.score - left.score
    || right.node.completedAt - left.node.completedAt
    || left.node.id.localeCompare(right.node.id))
    .slice(0, limit)
}

function extractSession(
  source: ContextGraphSource,
  now: number,
  options: GraphOptions,
): ExtractedSession {
  const projectId = projectIdOf(source.header.cwd)
  const nodes: ContextGraphNode[] = []
  const liveStart = source.header.seedLength ?? 0
  let turn: TurnBuilder | undefined
  for (const event of source.events) {
    if (event.seq < liveStart) continue
    switch (event.type) {
      case 'turn/start':
        turn = freshTurn(event.data.turn)
        break
      case 'user/message': {
        if (turn === undefined) break
        const sourceKind = event.data.source.kind
        if (sourceKind === 'user') turn.promptParts.push(extractSessionEventText(event))
        if (sourceKind === 'context-graph') {
          const recall = event.data.source as unknown as {
            sourceNodeId: ContextGraphNodeId
            score: number
            recalledBytes: number
          }
          turn.recalledFrom = recall.sourceNodeId
          turn.recallScore = recall.score
          turn.recalledBytes += recall.recalledBytes
        }
        break
      }
      case 'assistant/message':
        if (turn === undefined) break
        turn.assistantParts.push(extractSessionEventText(event))
        turn.inputTokens += event.data.usage?.inputTokens ?? 0
        turn.cacheReadTokens += event.data.usage?.cacheReadTokens ?? 0
        turn.outputTokens += event.data.usage?.outputTokens ?? 0
        break
      case 'tool/call':
        if (turn !== undefined) turn.actions.set(event.data.name, (turn.actions.get(event.data.name) ?? 0) + 1)
        break
      case 'turn/end':
        if (turn !== undefined && turn.turn === event.data.turn) {
          const node = finishTurn(source.header, projectId, turn, event, now, options)
          if (node !== undefined) nodes.push(node)
          turn = undefined
        }
        break
      default:
        break
    }
  }
  const retained = nodes.slice(-options.maxNodesPerSession)
  return {
    source,
    nodes: retained,
    session: {
      sessionId: source.header.id,
      projectId,
      ...(source.header.cwd === undefined ? {} : { cwd: source.header.cwd }),
      createdAt: source.header.createdAt,
      ...(source.header.parentSession === undefined ? {} : { parentSessionId: source.header.parentSession }),
      nodeIds: retained.map(node => node.id),
    },
  }
}

function finishTurn(
  header: SessionHeader,
  projectId: string,
  turn: TurnBuilder,
  event: SessionEvent<'turn/end'>,
  now: number,
  options: GraphOptions,
): ContextGraphNode | undefined {
  const prompt = truncateUtf8(turn.promptParts.filter(Boolean).join('\n'), options.maxTextBytes)
  const summary = truncateUtf8(turn.assistantParts.filter(Boolean).join('\n'), options.maxTextBytes)
  if (prompt === '' && summary === '') return undefined
  const outcome = event.data.reason.kind
  const key = firstLine(summary || prompt)
  return {
    id: ContextGraphNodeId(`${header.id}@${turn.turn}:${event.seq}`),
    sessionId: header.id,
    projectId,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    turn: turn.turn,
    boundarySeq: event.seq,
    key,
    prompt,
    summary,
    actions: [...turn.actions].map(([name, count]): ContextGraphAction => ({ name, count })),
    outcome,
    reusable: outcome === 'completed' && summary !== '',
    completedAt: event.time,
    freshness: freshnessOf(now - event.time, options.staleAfterMs),
    inputTokens: turn.inputTokens,
    cacheReadTokens: turn.cacheReadTokens,
    outputTokens: turn.outputTokens,
    ...(turn.recalledFrom === undefined ? {} : { recalledFrom: turn.recalledFrom }),
    ...(turn.recallScore === undefined ? {} : { recallScore: turn.recallScore }),
    recalledBytes: turn.recalledBytes,
  }
}

function freshTurn(turn: number): TurnBuilder {
  return {
    turn,
    promptParts: [],
    assistantParts: [],
    actions: new Map(),
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    recalledBytes: 0,
  }
}

function sourceNodeAt(
  sessions: ReadonlyMap<SessionId, ExtractedSession>,
  sessionId: SessionId,
  boundarySeq: number,
  seen = new Set<SessionId>(),
): ContextGraphNode | undefined {
  if (seen.has(sessionId)) return undefined
  seen.add(sessionId)
  const session = sessions.get(sessionId)
  if (session === undefined) return undefined
  const local = session.nodes.filter(node => node.boundarySeq <= boundarySeq).at(-1)
  if (local !== undefined) return local
  const parent = session.source.header.parentSession
  if (parent === undefined) return undefined
  return sourceNodeAt(sessions, parent, boundarySeq, seen)
}

function edge(kind: ContextGraphEdge['kind'], from: ContextGraphNodeId, to: ContextGraphNodeId): ContextGraphEdge {
  return { id: `${kind}:${from}->${to}`, kind, from, to }
}

function projectIdOf(cwd: string | undefined): string {
  return cwd === undefined ? 'project:none' : `project:${encodeURIComponent(cwd)}`
}

function freshnessOf(age: number, staleAfterMs: number): ContextGraphFreshness {
  if (age >= staleAfterMs) return 'stale'
  if (age >= staleAfterMs / 2) return 'aging'
  return 'fresh'
}

function firstLine(text: string): string {
  return truncateUtf8(text.trim().replace(/\r?\n[\s\S]*$/u, ''), 160)
}

/**
 * Truncate without splitting a UTF-8 sequence.
 * @param value Text to constrain.
 * @param maxBytes Maximum returned UTF-8 bytes, including the ellipsis.
 * @returns Original or truncated text within the byte limit.
 */
export function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.byteLength <= maxBytes) return value
  const ellipsis = Buffer.from('…', 'utf8')
  if (maxBytes < ellipsis.byteLength) return ''
  let end = maxBytes - ellipsis.byteLength
  while (end > 0 && bytes.readUInt8(end) >> 6 === 0b10) end -= 1
  return `${bytes.subarray(0, end).toString('utf8').trimEnd()}…`
}

function tokens(value: string): Set<string> {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  const result = new Set<string>()
  for (const match of normalized.matchAll(/[\p{L}\p{N}_-]+/gu)) {
    const token = match[0]
    result.add(token)
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      const chars = Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(token),
        item => item.segment,
      )
      for (const char of chars) result.add(char)
      for (let index = 0; index + 1 < chars.length; index += 1) {
        result.add(`${chars[index]}${chars[index + 1]}`)
      }
    }
  }
  return result
}
