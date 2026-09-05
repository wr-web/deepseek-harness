/** Context-graph view strings. */

export const NS = 'contextGraph'

/** Locale keys owned by the context-graph view. */
export type ContextGraphKey =
  | 'view.label'
  | 'eyebrow'
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
  | 'projects'
  | 'nodes'
  | 'recalls'
  | 'selectNode'
  | 'summarySource'
  | 'request'
  | 'conclusion'
  | 'completed'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Cross-session context forest view. */
    contextGraph: ContextGraphKey
  }
}

/** Simplified Chinese context-graph strings. */
export const zh: Record<ContextGraphKey, string> = {
  'view.label': '上下文树',
  eyebrow: '项目记忆',
  title: '上下文树',
  subtitle: '每个圆点是一轮已完成的工作；沿树继续，避免重复分析。',
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
  projects: '项目',
  nodes: '节点',
  recalls: '复用',
  selectNode: '选择一个圆点查看这轮工作的结论。',
  summarySource: '圆点文字来自该轮可见结论，不会额外调用模型生成摘要。',
  request: '请求',
  conclusion: '可见结论',
  completed: '完成于',
}

/** English context-graph strings. */
export const en: Record<ContextGraphKey, string> = {
  'view.label': 'Context tree',
  eyebrow: 'Project memory',
  title: 'Context tree',
  subtitle: 'Each circle is one completed turn. Continue along the tree without repeating the analysis.',
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
  projects: 'projects',
  nodes: 'nodes',
  recalls: 'recalls',
  selectNode: 'Select a circle to inspect that turn.',
  summarySource: 'Circle text comes from the visible conclusion and does not spend another model call.',
  request: 'Request',
  conclusion: 'Visible conclusion',
  completed: 'Completed',
}
