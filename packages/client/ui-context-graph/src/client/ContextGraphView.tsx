import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextGraphNode, ContextGraphSnapshot } from '@deepseek-ai/dsh-context-graph/types'
import { layoutContextGraph } from './layout.ts'
import type { ContextGraphKey } from './locales.ts'
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

  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    void props.loadGraph(controller.signal).then(setSnapshot, (reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { controller.abort() }
  }, [props.loadGraph, refreshNonce, revision])

  const layout = useMemo(() => snapshot === undefined ? undefined : layoutContextGraph(snapshot), [snapshot])
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
          <h2>{props.t('title')}</h2>
          <p>{props.t('subtitle')}</p>
        </div>
        <button className={css.refresh} type="button" onClick={() => { setRefreshNonce(value => value + 1) }}>
          {props.t('refresh')}
        </button>
      </header>
      {snapshot !== undefined && (
        <div className={css.stats} aria-label={props.t('stats')}>
          <strong>{snapshot.stats.projects}</strong><span>/</span>
          <strong>{snapshot.stats.nodes}</strong><span>/</span>
          <strong>{snapshot.stats.recallEdges}</strong>
          <small>{props.t('stats')}</small>
        </div>
      )}
      <main className={css.scroll}>
        {error !== undefined && <p className={css.state}>{props.t('error')}: {error}</p>}
        {error === undefined && snapshot === undefined && <p className={css.state}>{props.t('loading')}</p>}
        {snapshot !== undefined && snapshot.nodes.length === 0 && <p className={css.state}>{props.t('empty')}</p>}
        {snapshot?.projects.map((project) => {
          const rows = layout?.get(project.id) ?? []
          if (rows.length === 0) return null
          return (
            <section className={css.project} key={project.id}>
              <div className={css.projectHeader}>
                <h3>{project.label}</h3>
                {project.cwd !== undefined && <code>{project.cwd}</code>}
              </div>
              <div className={css.tree}>
                {rows.map(({ node, depth, relation }) => (
                  <article
                    className={css.node}
                    data-freshness={node.freshness}
                    data-relation={relation ?? 'root'}
                    key={node.id}
                    style={{ '--context-depth': depth } as CSSProperties}
                  >
                    <span className={css.rail} aria-hidden="true"><i /></span>
                    <div className={css.card}>
                      <div className={css.nodeHeader}>
                        <span className={css.freshness}>{props.t(node.freshness as ContextGraphKey)}</span>
                        {node.recalledFrom !== undefined && <span className={css.recalled}>{props.t('recalled')}</span>}
                        <time dateTime={new Date(node.completedAt).toISOString()}>{new Date(node.completedAt).toLocaleString()}</time>
                      </div>
                      <h4>{node.key}</h4>
                      <p className={css.prompt}>{node.prompt}</p>
                      {node.summary !== '' && <p className={css.summary}>{node.summary}</p>}
                      <div className={css.footer}>
                        <div className={css.metrics}>
                          <span>{node.inputTokens + node.cacheReadTokens + node.outputTokens} {props.t('tokens')}</span>
                          {node.actions.length > 0 && <span>{props.t('actions')}: {node.actions.map(action => `${action.name}×${action.count}`).join(' · ')}</span>}
                        </div>
                        <button
                          type="button"
                          disabled={forking !== undefined}
                          onClick={() => { void startFork(node) }}
                        >
                          {forking === node.id ? props.t('forking') : props.t('fork')}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </main>
    </div>
  )
}
