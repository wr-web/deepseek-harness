import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextGraphNode, ContextGraphSnapshot } from '@deepseek-ai/dsh-context-graph/types'
import { layoutContextGraph } from './layout.ts'
import css from './ContextGraphView.module.css'

export interface ContextGraphViewInjected {
  loadGraph: (signal: AbortSignal) => Promise<ContextGraphSnapshot>
  forkFrom: (node: ContextGraphNode) => Promise<void>
}

type Props = ConvViewProps & InjectFace<ContextGraphViewInjected> & PropsLocale<'contextGraph'>

export function ContextGraphView(props: Props) {
  const revision = props.useSessions(state => state.ids
    .map(id => `${id}:${state.byId[id]?.updatedAt ?? 0}`)
    .join('|'))
  const [snapshot, setSnapshot] = useState<ContextGraphSnapshot>()
  const [error, setError] = useState<string>()
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [forking, setForking] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    void props.loadGraph(controller.signal).then(setSnapshot, (reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { controller.abort() }
  }, [props.loadGraph, refreshNonce, revision])

  useEffect(() => {
    if (snapshot === undefined || snapshot.nodes.length === 0) return
    if (selectedId !== undefined && snapshot.nodes.some(node => node.id === selectedId)) return
    setSelectedId(snapshot.nodes.at(-1)?.id)
  }, [selectedId, snapshot])

  const layout = useMemo(() => snapshot === undefined ? undefined : layoutContextGraph(snapshot), [snapshot])
  const selected = snapshot?.nodes.find(node => node.id === selectedId)
  const startFork = useCallback(async (node: ContextGraphNode) => {
    setForking(node.id)
    try {
      await props.forkFrom(node)
    } finally {
      setForking(undefined)
    }
  }, [props.forkFrom])

  return (
    <div className={css.root} data-conversation-composer-overlay="">
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>{props.t('eyebrow')}</p>
          <h2>{props.t('title')}</h2>
          <p className={css.subtitle}>{props.t('subtitle')}</p>
        </div>
        <button className={css.refresh} type="button" onClick={() => { setRefreshNonce(value => value + 1) }}>
          {props.t('refresh')}
        </button>
      </header>
      {snapshot !== undefined && (
        <div className={css.stats} aria-label={props.t('stats')}>
          <span><strong>{snapshot.stats.projects}</strong>{props.t('projects')}</span>
          <i />
          <span><strong>{snapshot.stats.nodes}</strong>{props.t('nodes')}</span>
          <i />
          <span><strong>{snapshot.stats.recallEdges}</strong>{props.t('recalls')}</span>
        </div>
      )}
      <main className={css.scroll}>
        {error !== undefined && <p className={css.state}>{props.t('error')}: {error}</p>}
        {error === undefined && snapshot === undefined && <p className={css.state}>{props.t('loading')}</p>}
        {snapshot !== undefined && snapshot.nodes.length === 0 && <p className={css.state}>{props.t('empty')}</p>}
        {snapshot !== undefined && snapshot.nodes.length > 0 && (
          <div className={css.content}>
            <div className={css.forest}>
              {snapshot.projects.map((project) => {
                const projectLayout = layout?.get(project.id)
                if (projectLayout === undefined || projectLayout.nodes.length === 0) return null
                return (
                  <section className={css.project} key={project.id}>
                    <div className={css.projectHeader}>
                      <div className={css.projectMark} aria-hidden="true" />
                      <div>
                        <h3>{project.label}</h3>
                        {project.cwd !== undefined && <code>{project.cwd}</code>}
                      </div>
                    </div>
                    <div className={css.canvasViewport}>
                      <div className={css.canvas} style={{ width: projectLayout.width, height: projectLayout.height }}>
                        <svg
                          aria-hidden="true"
                          className={css.edges}
                          height={projectLayout.height}
                          viewBox={`0 0 ${projectLayout.width} ${projectLayout.height}`}
                          width={projectLayout.width}
                        >
                          {projectLayout.edges.map(({ edge, path }) => (
                            <path
                              className={edge.from === selectedId || edge.to === selectedId ? css.activeEdge : undefined}
                              d={path}
                              data-kind={edge.kind}
                              key={edge.id}
                            />
                          ))}
                        </svg>
                        {projectLayout.nodes.map(({ node, x, y, relation }, index) => (
                          <button
                            aria-label={`${node.key}, ${props.t(node.freshness)}`}
                            aria-pressed={selectedId === node.id}
                            className={css.node}
                            data-freshness={node.freshness}
                            data-relation={relation ?? 'root'}
                            key={node.id}
                            onClick={() => { setSelectedId(node.id) }}
                            style={{ left: x, top: y }}
                            type="button"
                          >
                            <span className={css.turn}>T{node.turn}</span>
                            <span className={css.nodeLabel}>{node.key}</span>
                            {node.recalledFrom !== undefined && <span className={css.recallDot} title={props.t('recalled')} />}
                            <span className={css.nodeNumber}>{String(index + 1).padStart(2, '0')}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
            <aside className={css.inspector}>
              {selected === undefined
                ? <p className={css.inspectorHint}>{props.t('selectNode')}</p>
                : (
                  <>
                    <div className={css.inspectorHeading}>
                      <span className={css.inspectorDot} data-freshness={selected.freshness} />
                      <span>{props.t(selected.freshness)}</span>
                      {selected.recalledFrom !== undefined && <span>{props.t('recalled')}</span>}
                    </div>
                    <h3>{selected.key}</h3>
                    <p className={css.summarySource}>{props.t('summarySource')}</p>
                    <dl className={css.details}>
                      <div>
                        <dt>{props.t('request')}</dt>
                        <dd>{selected.prompt}</dd>
                      </div>
                      <div>
                        <dt>{props.t('conclusion')}</dt>
                        <dd>{selected.summary}</dd>
                      </div>
                      <div className={css.detailRow}>
                        <dt>{props.t('tokens')}</dt>
                        <dd>{selected.inputTokens + selected.cacheReadTokens + selected.outputTokens}</dd>
                      </div>
                      <div className={css.detailRow}>
                        <dt>{props.t('completed')}</dt>
                        <dd>
                          <time dateTime={new Date(selected.completedAt).toISOString()}>
                            {new Date(selected.completedAt).toLocaleString()}
                          </time>
                        </dd>
                      </div>
                      {selected.actions.length > 0 && (
                        <div>
                          <dt>{props.t('actions')}</dt>
                          <dd className={css.actionList}>
                            {selected.actions.map(action => (
                              <code key={action.name}>{action.name} × {action.count}</code>
                            ))}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <button
                      className={css.fork}
                      type="button"
                      disabled={forking !== undefined}
                      onClick={() => { void startFork(selected) }}
                    >
                      {forking === selected.id ? props.t('forking') : props.t('fork')}
                    </button>
                  </>
                )}
            </aside>
          </div>
        )}
      </main>
    </div>
  )
}
