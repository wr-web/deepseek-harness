/**
 * Layer 1 decay-curve measurement (docs: 2026-09-05-context-graph-replay-verification).
 *
 * Not a unit test — a one-off measurement tool. Picks several real historical
 * commits of one file as capture points, derives probes from that file's
 * exported symbols, and replays them against this repository's own
 * subsequent history using real `git worktree` checkouts. Reports how many
 * commits/days pass before the replay verdict actually breaks — the
 * empirical half-life the design note's Layer 1 section asks for, measured
 * on this codebase's real activity instead of the small synthetic repos in
 * tests/replay.spec.ts.
 *
 * Run from the repository root:
 *   npx tsx packages/context/context-graph/scripts/replay-decay-eval.ts [path] [captureCount] [maxSamplesPerCapture]
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replayChecklist, type ContextGraphProbe } from '../src/replay.ts'

const targetPath = process.argv[2] ?? 'packages/core/session/src/types.ts'
const captureCount = Number(process.argv[3] ?? 8)
const maxSamplesPerCapture = Number(process.argv[4] ?? 12)

interface Commit {
  readonly hash: string
  readonly epochSeconds: number
}

interface SamplePoint {
  readonly commitDistance: number
  readonly verdictNoScope: string
  readonly verdictDefault: string
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function touchingCommits(path: string): Commit[] {
  // No --follow: combined with --reverse it is known to misbehave (returns a
  // single commit) in this git version, and rename-tracking isn't needed —
  // this measures decay under the path's current name.
  const output = git(['log', '--format=%H|%ct', '--reverse', '--', path])
  return output.split('\n').filter(line => line !== '').map((line): Commit => {
    const [hash, epoch] = line.split('|')
    return { hash: hash ?? '', epochSeconds: Number(epoch ?? '0') }
  })
}

/** Derive path-exists + one grep probe per exported top-level symbol, fingerprinted against the worktree's own checked-out content. */
function deriveCapturedProbes(worktree: string, path: string): ContextGraphProbe[] {
  const content = readFileSync(join(worktree, path), 'utf8')
  const symbols = new Set<string>()
  const pattern = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|type|function|const|class|enum)\s+([A-Za-z_$][\w$]*)/gmu
  for (const match of content.matchAll(pattern)) {
    const name = match[1]
    if (name !== undefined) symbols.add(name)
  }
  const probes: ContextGraphProbe[] = [
    { seq: 0, kind: 'path-exists', path, capturedFingerprint: 'exists', loadBearing: true },
  ]
  let seq = 1
  for (const symbol of symbols) {
    const found = new RegExp(`\\b${escapeRegExp(symbol)}\\b`, 'mu').test(content)
    probes.push({
      seq, kind: 'grep', path, pattern: `\\b${escapeRegExp(symbol)}\\b`,
      capturedFingerprint: found ? 'match' : 'no-match', loadBearing: true,
    })
    seq += 1
  }
  return probes
}

function withWorktree<T>(commit: string, run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'context-graph-decay-'))
  git(['worktree', 'add', '--detach', '--quiet', dir, commit])
  try {
    return run(dir)
  } finally {
    git(['worktree', 'remove', '--force', dir])
    rmSync(dir, { recursive: true, force: true })
  }
}

function main(): void {
  const repoRoot = git(['rev-parse', '--show-toplevel']).trim()
  process.chdir(repoRoot)
  const commits = touchingCommits(targetPath)
  const spanDays = ((commits.at(-1)?.epochSeconds ?? 0) - (commits[0]?.epochSeconds ?? 0)) / 86400
  console.log(`${targetPath}: ${commits.length} touching commits, ${spanDays.toFixed(1)} days of history`)
  if (commits.length < 3) {
    console.log('Not enough history to measure decay. Pick a different path.')
    return
  }

  const lastIndex = commits.length - 1
  const captureIndices = [...new Set(Array.from(
    { length: Math.min(captureCount, lastIndex) },
    (_unused, i) => Math.round((i * (lastIndex - 1)) / Math.max(captureCount - 1, 1)),
  ))]

  const allSamples: SamplePoint[] = []
  const firstBreakDays: number[] = []
  let censored = 0

  for (const captureIndex of captureIndices) {
    const capture = commits[captureIndex]
    if (capture === undefined) continue
    const captured = withWorktree(capture.hash, dir => deriveCapturedProbes(dir, targetPath))

    const sampleIndices = commits
      .map((_unused, index) => index)
      .filter(index => index > captureIndex)
      .slice(0, maxSamplesPerCapture)
    if (!sampleIndices.includes(lastIndex)) sampleIndices.push(lastIndex)

    let brokeAtDays: number | undefined
    for (const sampleIndex of sampleIndices) {
      const target = commits[sampleIndex]
      if (target === undefined) continue
      const daysSince = (target.epochSeconds - capture.epochSeconds) / 86400
      const { verdictDefault, verdictNoScope } = withWorktree(target.hash, dir => ({
        verdictDefault: replayChecklist(dir, captured, capture.hash, [targetPath]).verdict,
        verdictNoScope: replayChecklist(dir, captured, capture.hash, [targetPath], { partialThreshold: 0.5, scopeThreshold: 0 }).verdict,
      }))
      allSamples.push({ commitDistance: sampleIndex - captureIndex, verdictNoScope, verdictDefault })
      if (brokeAtDays === undefined && verdictNoScope !== 'fresh') brokeAtDays = daysSince
    }
    if (brokeAtDays === undefined) censored += 1
    else firstBreakDays.push(brokeAtDays)
    console.log(`capture #${captureIndex} (${capture.hash.slice(0, 8)}, ${captured.length - 1} symbols): first break at ${
      brokeAtDays === undefined ? '>= end of window (still fresh)' : `${brokeAtDays.toFixed(2)} days`
    }`)
  }

  console.log(`\nCapture points: ${captureIndices.length}, still-fresh-at-end-of-window (censored): ${censored}`)
  if (firstBreakDays.length > 0) {
    const sorted = [...firstBreakDays].sort((left, right) => left - right)
    const median = sorted[Math.floor(sorted.length / 2)]
    console.log(`Days until first probe break (n=${sorted.length}): median=${median?.toFixed(2)}, min=${sorted[0]?.toFixed(2)}, max=${sorted.at(-1)?.toFixed(2)}`)
  }

  console.log('\ncommitDistance | fresh fraction, prefix-only (scope guard off) | fresh fraction, default (scope guard on)')
  for (const distance of [1, 2, 3, 5, 10]) {
    const atDistance = allSamples.filter(sample => sample.commitDistance === distance)
    if (atDistance.length === 0) continue
    const freshNoScope = atDistance.filter(sample => sample.verdictNoScope === 'fresh').length / atDistance.length
    const freshDefault = atDistance.filter(sample => sample.verdictDefault === 'fresh').length / atDistance.length
    console.log(`${distance} | ${(freshNoScope * 100).toFixed(0)}% (n=${atDistance.length}) | ${(freshDefault * 100).toFixed(0)}%`)
  }
}

main()
