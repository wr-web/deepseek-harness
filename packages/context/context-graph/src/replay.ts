/** Deterministic Phase 1 (no-exec) replay verification for context-graph checkpoints. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  ContextGraphProbe,
  ContextGraphProbeResult,
  ContextGraphReplay,
  ContextGraphReplayVerdict,
} from './types.ts'

/** Thresholds governing the verdict ladder. */
export interface ContextGraphReplayOptions {
  /** Minimum k/n, below a full pass, to report `partial` instead of `locational`/`dead`. */
  readonly partialThreshold: number
  /** Minimum scope ratio to keep a full pass at `fresh` instead of downgrading to `partial`. */
  readonly scopeThreshold: number
}

/** Defaults matching the design spec: half the load-bearing prefix, half the changed-path overlap. */
export const DEFAULT_REPLAY_OPTIONS: ContextGraphReplayOptions = {
  partialThreshold: 0.5,
  scopeThreshold: 0.5,
}

/**
 * Fingerprint one probe against the current working tree. Never throws: a
 * missing path is a valid, comparable outcome rather than an error.
 * @param cwd Working tree root the probe path is relative to.
 * @param probe Probe to evaluate.
 * @returns Current fingerprint, comparable to `probe.capturedFingerprint`.
 */
export function fingerprintProbe(cwd: string, probe: ContextGraphProbe): string {
  const absolute = join(cwd, probe.path)
  if (!existsSync(absolute)) return 'missing'
  if (probe.kind === 'path-exists') return 'exists'
  if (probe.kind === 'file-hash') return createHash('sha256').update(readFileSync(absolute)).digest('hex')
  return new RegExp(probe.pattern, 'mu').test(readFileSync(absolute, 'utf8')) ? 'match' : 'no-match'
}

/**
 * Ratio of paths changed since capture that the checkpoint actually touched.
 * Compares the captured commit against the current working tree (`git diff`
 * includes uncommitted changes), because that is the state a fork will face —
 * comparing against a clean `HEAD` would validate a world that doesn't exist.
 *
 * The diff itself is restricted to the touched paths' containing directories
 * (deduplicated), not the whole `cwd`. Measured against this repository's own
 * history (`scripts/replay-decay-eval.ts`): with an unrestricted repo-wide
 * diff, a checkpoint in an active monorepo never reads as `fresh` — unrelated
 * commits elsewhere in the tree dominate the denominator on every replay,
 * even one commit after capture. Directory-scoping makes "what changed"
 * mean "what changed near what this checkpoint is about" instead of "what
 * changed anywhere in the repository", which is what the ratio is meant to
 * measure. For a checkpoint whose touched paths already sit at `cwd` (a
 * single-project repository), this is a no-op: the containing directory is
 * `cwd` itself.
 * @param cwd Git working tree root.
 * @param capturedHead Commit hash recorded at capture time.
 * @param touchedPaths Paths the captured trajectory read or wrote, relative to `cwd`.
 * @returns 1 when nothing changed since capture; otherwise the overlap ratio.
 */
export function computeScopeRatio(cwd: string, capturedHead: string, touchedPaths: readonly string[]): number {
  const scopeDirs = [...new Set(touchedPaths.map(path => dirname(path)))]
  const args = ['diff', '--no-renames', '--name-only', capturedHead]
  if (scopeDirs.length > 0) args.push('--', ...scopeDirs)
  const output = execFileSync('git', args, { cwd, encoding: 'utf8' })
  const changed = output.split('\n').map(line => line.trim()).filter(line => line !== '')
  if (changed.length === 0) return 1
  const touched = new Set(touchedPaths)
  const overlap = changed.filter(path => touched.has(path)).length
  return overlap / changed.length
}

/**
 * Replay every probe in a checkpoint's checklist against the current working tree.
 *
 * Never throws: a replay-infrastructure failure (the captured commit is no
 * longer resolvable — pruned, rebased away, a shallow clone — or another
 * probe error) is environment drift, a strong `dead` signal in its own right
 * rather than an exception the caller must guard against separately.
 * @param cwd Working tree root the probe paths are relative to.
 * @param probes Ordered replay checklist recorded at capture time.
 * @param capturedHead Commit hash recorded at capture time, for scope comparison.
 * @param touchedPaths Paths the captured trajectory read or wrote, relative to `cwd`.
 * @param options Verdict ladder thresholds.
 * @returns Complete replay outcome.
 */
export function replayChecklist(
  cwd: string,
  probes: readonly ContextGraphProbe[],
  capturedHead: string,
  touchedPaths: readonly string[],
  options: ContextGraphReplayOptions = DEFAULT_REPLAY_OPTIONS,
): ContextGraphReplay {
  try {
    return replayChecklistOrThrow(cwd, probes, capturedHead, touchedPaths, options)
  } catch {
    return { verdict: 'dead', k: 0, n: probes.filter(probe => probe.loadBearing).length, scopeRatio: 0, results: [] }
  }
}

function replayChecklistOrThrow(
  cwd: string,
  probes: readonly ContextGraphProbe[],
  capturedHead: string,
  touchedPaths: readonly string[],
  options: ContextGraphReplayOptions,
): ContextGraphReplay {
  const ordered = [...probes].sort((left, right) => left.seq - right.seq)
  const results: ContextGraphProbeResult[] = []
  let k = 0
  let n = 0
  let stopped = false
  for (const probe of ordered) {
    const fingerprint = fingerprintProbe(cwd, probe)
    const consistent = fingerprint === probe.capturedFingerprint
    results.push({ seq: probe.seq, fingerprint, consistent })
    if (!probe.loadBearing) continue
    n += 1
    if (!stopped && consistent) k += 1
    else stopped = true
  }
  const scopeRatio = computeScopeRatio(cwd, capturedHead, touchedPaths)
  return { verdict: verdictOf(k, n, scopeRatio, results, options), k, n, scopeRatio, results }
}

function verdictOf(
  k: number,
  n: number,
  scopeRatio: number,
  results: readonly ContextGraphProbeResult[],
  options: ContextGraphReplayOptions,
): ContextGraphReplayVerdict {
  if (k === n) return scopeRatio >= options.scopeThreshold ? 'fresh' : 'partial'
  if (k / n >= options.partialThreshold) return 'partial'
  return results.every(result => result.fingerprint === 'missing') ? 'dead' : 'locational'
}
