/** Package-owned context-graph invariants. @module @deepseek-ai/dsh-context-graph/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-context-graph'

/** Cordis companion plugin name. */
export const name = 'context-graph-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: graph rows are pure projections of validated session logs, while
 * automatic recall is already reconstructable from its logged user-message source.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
