/** Context-graph view strings. */

export const NS = 'contextGraph'

/** Locale keys owned by the context-graph view. */
export type ContextGraphKey =
  | 'view.label'
  | 'title'
  | 'subtitle'
  | 'refresh'
  | 'loading'
  | 'empty'
  | 'error'
  | 'fork'
  | 'forking'
  | 'fresh'
  | 'aging'
  | 'stale'
  | 'recalled'
  | 'actions'
  | 'tokens'
  | 'stats'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Cross-session context forest view. */
    contextGraph: ContextGraphKey
  }
}

/** Simplified Chinese context-graph strings. */
export const zh: Record<ContextGraphKey, string> = {
  'view.label': '上下文树',
  title: '上下文树',
  subtitle: '从已完成的工作节点继续，避免重复分析。',
  refresh: '刷新',
  loading: '正在读取上下文树…',
  empty: '完成一次任务后，这里会出现可复用节点。',
  error: '上下文树读取失败',
  fork: '从这里分支',
  forking: '正在分支…',
  fresh: '新鲜',
  aging: '老化中',
  stale: '已腐败',
  recalled: '已复用',
  actions: '动作',
  tokens: 'tokens',
  stats: '项目 / 节点 / 复用',
}

/** English context-graph strings. */
export const en: Record<ContextGraphKey, string> = {
  'view.label': 'Context tree',
  title: 'Context tree',
  subtitle: 'Continue from completed work without repeating the analysis.',
  refresh: 'Refresh',
  loading: 'Reading the context tree…',
  empty: 'Reusable nodes appear here after a task completes.',
  error: 'Context tree could not be read',
  fork: 'Fork from here',
  forking: 'Forking…',
  fresh: 'Fresh',
  aging: 'Aging',
  stale: 'Stale',
  recalled: 'Recalled',
  actions: 'Actions',
  tokens: 'tokens',
  stats: 'projects / nodes / recalls',
}
