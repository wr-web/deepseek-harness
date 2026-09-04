/**
 * Related-task pairing (docs: 2026-09-05-context-graph-replay-verification, section "Layer 2").
 *
 * Not a unit test — a one-off, read-only analysis tool (no working-tree
 * mutation, no test execution, no model calls). Complements
 * build-layer2-taskset.ts's FAIL_TO_PASS mining with the structure the
 * six-arm trial actually needs: pairs of tasks where a "base" commit and a
 * later "related" commit touch the same file, close enough in time that a
 * checkpoint from the base task would plausibly still be around when the
 * related task comes up. This mirrors SWE-ContextBench's base+related task
 * structure (arXiv:2602.08316) rather than treating every mined task as
 * independent.
 *
 * Takes each already-validated task from layer2-taskset.json as the
 * "related" (target) side, and looks back for the single *nearest* prior
 * commit touching one of its source files — not every commit in the window,
 * which explodes combinatorially for frequently-touched files (an earlier
 * draft of this tool produced 133k pairs from all-pairs-in-window; nearest-
 * prior-touch gives at most one base per task). A task with no qualifying
 * prior commit in the window is reported, not silently dropped — the "no
 * relevant prior context exists" case matters exactly as much as a hit.
 *
 * The default 30-day window is not arbitrary: scripts/replay-decay-eval.ts
 * measured a ~27.8-day median half-life for this codebase's own checkpoints,
 * so a pair further apart than that is already past where a real checkpoint
 * would typically still verify as fresh.
 *
 * Run from the repository root (after build-layer2-taskset.ts has produced
 * layer2-taskset.json):
 *   npx tsx packages/context/context-graph/scripts/build-context-pairs.ts [maxDaysApart]
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const maxDaysApart = Number(process.argv[2] ?? 30)

interface ValidatedTask {
  readonly commit: string
  readonly package: string
  readonly message: string
  readonly committedAt: string
  readonly sourceFiles: string[]
}

interface PriorTouch {
  readonly commit: string
  readonly message: string
  readonly committedAt: string
  readonly sharedSourceFiles: string[]
  readonly daysBefore: number
}

interface PairingResult {
  readonly relatedCommit: string
  readonly relatedMessage: string
  readonly relatedCommittedAt: string
  readonly package: string
  readonly base: PriorTouch | undefined
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** Every commit before `beforeCommit` that touched at least one of `sourceFiles`, nearest first. */
function priorTouches(cwd: string, packagePath: string, sourceFiles: readonly string[], beforeCommit: string): PriorTouch[] {
  const output = git([
    'log', '--no-merges', '--format=%x00%H%x01%s%x01%cI', '--name-only',
    `${beforeCommit}^`, '--', ...sourceFiles,
  ], cwd)
  return output.split('\x00').filter(chunk => chunk.trim() !== '').map((chunk): PriorTouch => {
    const lines = chunk.split('\n').filter(line => line !== '')
    const [hash, message, committedAt] = (lines[0] ?? '').split('\x01')
    const files = lines.slice(1)
    return {
      commit: hash ?? '', message: message ?? '', committedAt: committedAt ?? '',
      sharedSourceFiles: files.filter(path => sourceFiles.includes(path)),
      daysBefore: 0, // filled in once the related commit's own date is known
    }
  }).filter(touch => touch.sharedSourceFiles.length > 0)
}

function main(): void {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const taskSetPath = join(repoRoot, 'packages/context/context-graph/scripts/layer2-taskset.json')
  const tasks: ValidatedTask[] = JSON.parse(readFileSync(taskSetPath, 'utf8'))

  const results: PairingResult[] = tasks.map((task): PairingResult => {
    const candidates = priorTouches(repoRoot, task.package, task.sourceFiles, task.commit)
      .map((touch): PriorTouch => ({
        ...touch,
        daysBefore: (Date.parse(task.committedAt) - Date.parse(touch.committedAt)) / 86_400_000,
      }))
      .filter(touch => touch.daysBefore >= 0 && touch.daysBefore <= maxDaysApart)
      .sort((left, right) => left.daysBefore - right.daysBefore)

    return {
      relatedCommit: task.commit, relatedMessage: task.message, relatedCommittedAt: task.committedAt,
      package: task.package, base: candidates[0],
    }
  })

  const withBase = results.filter(result => result.base !== undefined)
  console.log(`${results.length} validated tasks checked, ${withBase.length} have a prior same-file commit within ${maxDaysApart} days`)
  for (const result of results) {
    const label = result.base === undefined
      ? 'no prior context in window'
      : `base ${result.base.commit.slice(0, 8)} "${result.base.message}" (${result.base.daysBefore.toFixed(1)}d earlier)`
    console.log(`${result.relatedCommit.slice(0, 8)} "${result.relatedMessage}" -> ${label}`)
  }

  const outPath = join(repoRoot, 'packages/context/context-graph/scripts/context-pairs.json')
  writeFileSync(outPath, JSON.stringify(results, undefined, 2))
  console.log(`Wrote ${results.length} pairing records to ${outPath}`)
}

main()
