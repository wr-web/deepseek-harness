/** Package-owned invariant companion for the context-graph UI. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-context-graph'

export const name = 'client-ui-context-graph-invariant'
export const inject = ['invariants']

/** No runtime invariant: the effect-scoped view registration has no mutable Host state. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
