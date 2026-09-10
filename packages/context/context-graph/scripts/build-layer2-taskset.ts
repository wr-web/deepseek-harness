/**
 * Layer 2 task-set mining (docs: 2026-09-05-context-graph-replay-verification, section "Layer 2").
 *
 * Not a unit test — a one-off mining tool. Layer 2 needs tasks with an
 * automatically-checkable success oracle. The design spec's first source is
 * "pick a commit from the repo's own history, the task is reproducing that
 * change, the oracle is the tests passing." This script does exactly that
 * and, critically, *validates* the oracle by actually running the tests
 * rather than trusting the commit message: for each candidate commit that
 * pairs a source change with a test change, it temporarily rewrites the
 * working tree to the parent commit's source + the new commit's test, runs
 * that test expecting failure (RED — the fix isn't applied yet), then
 * rewrites to the new commit's source and reruns expecting success (GREEN).
 * Only commits that actually reproduce this FAIL_TO_PASS pattern become
 * tasks; every touched file is restored to its original on-disk content
 * immediately after each candidate, success or failure.
 *
 * Deliberately excludes commits that add or delete files, or touch
 * package.json/the lockfile, to keep the oracle well-defined: a plain
 * "checkout old source, keep new test, does it fail; checkout new source,
 * does it pass" story requires every touched path to already exist as a
 * plain modification on both sides.
 *
 * Also runs a PASS_TO_PASS check (SWE-bench's term): after GREEN, the
 * package's whole test directory must still pass, not just the targeted
 * spec file — otherwise "fixing" the target test could have quietly broken
 * something else in the same package, which is not a task worth keeping.
 *
 * Run from the repository root:
 *   npx tsx packages/context/context-graph/scripts/build-layer2-taskset.ts [maxCandidates] [maxAccepted]
 * Requires a clean working tree (refuses to run otherwise) and restores it
 * exactly before exiting.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Mirrors vitest.config.ts's windows-unsupported package list: these need a
// real POSIX shell, pwsh, or a Windows-only ACL surface this host can't
// exercise, so mining their history would only produce unrunnable oracles.
const WINDOWS_UNSUPPORTED_SUBSTRINGS = [
  'shell/bash-local', 'shell/bash-sandbox', 'shell/tool-bash', 'hooks/',
  'terminal/terminal-bash', 'sandbox/sandbox-local', 'subprocess/',
]

function discoverPackages(repoRoot: string): string[] {
  const groups = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true }).filter(entry => entry.isDirectory())
  const packages: string[] = []
  for (const group of groups) {
    const groupPath = join('packages', group.name)
    const names = readdirSync(join(repoRoot, groupPath), { withFileTypes: true }).filter(entry => entry.isDirectory())
    for (const name of names) {
      const packagePath = `${groupPath}/${name.name}`.replaceAll('\\', '/')
      if (WINDOWS_UNSUPPORTED_SUBSTRINGS.some(substring => packagePath.includes(substring))) continue
      if (existsSync(join(repoRoot, packagePath, 'src')) && existsSync(join(repoRoot, packagePath, 'tests'))) {
        packages.push(packagePath)
      }
    }
  }
  return packages
}

const maxCandidates = Number(process.argv[2] ?? 60)
const maxAccepted = Number(process.argv[3] ?? 20)

interface ChangedFile {
  readonly status: string
  readonly path: string
}

interface Candidate {
  readonly commit: string
  readonly parent: string
  readonly package: string
  readonly message: string
  readonly committedAt: string
  readonly sourceFiles: string[]
  readonly testFiles: string[]
  readonly insertions: number
  readonly deletions: number
}

interface ValidatedTask extends Candidate {
  readonly redExitCode: number
}

type RejectionReason = 'parent-already-passes' | 'commit-still-fails' | 'regression-in-package-suite'

type ValidationOutcome =
  | { readonly ok: true; readonly task: ValidatedTask }
  | { readonly ok: false; readonly reason: RejectionReason }

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

interface RawCommit {
  readonly hash: string
  readonly subject: string
  readonly committedAt: string
  readonly files: ChangedFile[]
}

/** One `git log` spawn per package instead of several per commit — the difference between minutes and seconds across ~200 packages. */
function logWithNameStatus(cwd: string, packagePath: string): RawCommit[] {
  const output = git(['log', '--no-merges', '--format=%x00%H%x01%s%x01%cI', '--name-status', '--', packagePath], cwd)
  return output.split('\x00').filter(chunk => chunk.trim() !== '').map((chunk): RawCommit => {
    const lines = chunk.split('\n').filter(line => line !== '')
    const [hash, subject, committedAt] = (lines[0] ?? '').split('\x01')
    const files = lines.slice(1).map((line): ChangedFile => {
      const [status, path] = line.split('\t')
      return { status: status ?? '', path: path ?? '' }
    })
    return { hash: hash ?? '', subject: subject ?? '', committedAt: committedAt ?? '', files }
  })
}

/**
 * Insertions/deletions between two revisions, or undefined if the diff
 * itself fails (most commonly: `parent` doesn't resolve, i.e. a root commit).
 */
function shortstat(cwd: string, parent: string, commit: string): { insertions: number; deletions: number } | undefined {
  try {
    const output = git(['diff', '--shortstat', parent, commit], cwd)
    const insertions = /(\d+) insertion/u.exec(output)
    const deletions = /(\d+) deletion/u.exec(output)
    return { insertions: Number(insertions?.[1] ?? 0), deletions: Number(deletions?.[1] ?? 0) }
  } catch {
    return undefined
  }
}

function findCandidates(cwd: string, packagePath: string): Candidate[] {
  const candidates: Candidate[] = []
  for (const { hash, subject, committedAt, files } of logWithNameStatus(cwd, packagePath)) {
    if (files.some(file => file.status !== 'M')) continue
    if (files.some(file => file.path.endsWith('package.json') || file.path.includes('pnpm-lock'))) continue
    const sourceFiles = files.filter(file => file.path.startsWith(`${packagePath}/src/`) && file.path.endsWith('.ts')).map(file => file.path)
    const testFiles = files.filter(file => file.path.startsWith(`${packagePath}/tests/`) && file.path.endsWith('.spec.ts')).map(file => file.path)
    if (sourceFiles.length === 0 || testFiles.length === 0) continue
    // Every changed file must stay within this package (a cross-package
    // change would need another package's history to reproduce), but an
    // incidental non-code file (README, config) inside it doesn't disqualify
    // the commit — it isn't part of the fix and is left at its current
    // on-disk content throughout, same as every other untouched file.
    if (!files.every(file => file.path.startsWith(`${packagePath}/`))) continue
    // A path can be a plain modification at this commit yet be renamed or
    // deleted later in history; the restore-based validation needs it to
    // still exist on disk at HEAD to snapshot and restore its content.
    if (![...sourceFiles, ...testFiles].every(path => existsSync(join(cwd, path)))) continue
    const stat = shortstat(cwd, `${hash}^`, hash)
    if (stat === undefined || stat.insertions + stat.deletions > 400) continue
    candidates.push({
      commit: hash, parent: `${hash}^`, package: packagePath, message: subject, committedAt,
      sourceFiles, testFiles, insertions: stat.insertions, deletions: stat.deletions,
    })
  }
  return candidates
}

function withRestoredFiles<T>(cwd: string, paths: readonly string[], run: () => T): T {
  const original = new Map(paths.map(path => [path, readFileSync(join(cwd, path))]))
  try {
    return run()
  } finally {
    for (const [path, content] of original) writeFileSync(join(cwd, path), content)
  }
}

function writeBlob(cwd: string, ref: string, path: string): void {
  const content = execFileSync('git', ['show', `${ref}:${path}`], { cwd, maxBuffer: 1024 * 1024 * 16 })
  writeFileSync(join(cwd, path), content)
}

const PASS_TO_PASS_TIMEOUT_MS = 60_000

/** Exit code of a scoped vitest run: 0 if every listed test file/path passed, otherwise the process's nonzero status. */
function runVitestExitCode(cwd: string, targets: readonly string[], timeout?: number): number {
  try {
    execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...targets], {
      cwd, stdio: 'ignore', ...(timeout === undefined ? {} : { timeout }),
    })
    return 0
  } catch (error: unknown) {
    return (error as { status?: number }).status ?? 1
  }
}

function validate(cwd: string, candidate: Candidate): ValidationOutcome {
  const touched = [...candidate.sourceFiles, ...candidate.testFiles]
  return withRestoredFiles(cwd, touched, (): ValidationOutcome => {
    for (const path of candidate.sourceFiles) writeBlob(cwd, candidate.parent, path)
    for (const path of candidate.testFiles) writeBlob(cwd, candidate.commit, path)
    const redExitCode = runVitestExitCode(cwd, candidate.testFiles)
    if (redExitCode === 0) return { ok: false, reason: 'parent-already-passes' }

    for (const path of candidate.sourceFiles) writeBlob(cwd, candidate.commit, path)
    const greenExitCode = runVitestExitCode(cwd, candidate.testFiles)
    if (greenExitCode !== 0) return { ok: false, reason: 'commit-still-fails' }

    // PASS_TO_PASS (SWE-bench's term): the fix must not have broken anything
    // else already covered by this package's own suite. Bounded by a timeout
    // rather than left unbounded, since package suite size varies widely.
    const regressionExitCode = runVitestExitCode(cwd, [`${candidate.package}/tests`], PASS_TO_PASS_TIMEOUT_MS)
    if (regressionExitCode !== 0) return { ok: false, reason: 'regression-in-package-suite' }

    return { ok: true, task: { ...candidate, redExitCode } }
  })
}

/** Deterministic Fisher-Yates shuffle (fixed seed) so repeated runs sample the same set. */
function shuffled<T>(items: readonly T[]): T[] {
  let seed = 42
  const random = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const temp = result[i] as T
    result[i] = result[j] as T
    result[j] = temp
  }
  return result
}

function main(): void {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  // Untracked files are fine (this script itself is one on first run) — only
  // uncommitted changes to already-tracked files would make the restore step
  // below overwrite something worth keeping.
  if (git(['diff', '--name-only', 'HEAD'], repoRoot).trim() !== '') {
    console.error('Tracked files have uncommitted changes. Commit or stash before running this tool.')
    process.exitCode = 1
    return
  }

  const packagePaths = discoverPackages(repoRoot)
  const allCandidates = packagePaths.flatMap(packagePath => findCandidates(repoRoot, packagePath))
  console.log(`${allCandidates.length} structurally-qualifying candidates across ${packagePaths.length} packages`)
  // Shuffle (deterministic seed) before capping so the sample spans many
  // packages instead of exhausting the first alphabetically-discovered one.
  const sampled = shuffled(allCandidates).slice(0, maxCandidates)

  const accepted: ValidatedTask[] = []
  const rejections: Record<RejectionReason, number> = {
    'parent-already-passes': 0, 'commit-still-fails': 0, 'regression-in-package-suite': 0,
  }
  for (const candidate of sampled) {
    if (accepted.length >= maxAccepted) break
    const outcome = validate(repoRoot, candidate)
    if (!outcome.ok) {
      rejections[outcome.reason] += 1
      continue
    }
    accepted.push(outcome.task)
    console.log(`accepted ${outcome.task.commit.slice(0, 8)} "${outcome.task.message}" (+${outcome.task.insertions}/-${outcome.task.deletions}, ${outcome.task.sourceFiles.length} src, ${outcome.task.testFiles.length} test)`)
  }

  const finalStatus = git(['diff', '--name-only', 'HEAD'], repoRoot).trim()
  console.log(`\nSampled: ${sampled.length}, accepted: ${accepted.length}`)
  console.log(`Rejected — parent already passes (not a real fail-to-pass): ${rejections['parent-already-passes']}`)
  console.log(`Rejected — commit's own change insufficient in isolation: ${rejections['commit-still-fails']}`)
  console.log(`Rejected — regression elsewhere in the package suite (PASS_TO_PASS failed): ${rejections['regression-in-package-suite']}`)
  console.log(`Working tree clean at exit: ${finalStatus === ''}`)
  if (finalStatus !== '') console.error(`WARNING: working tree not restored cleanly:\n${finalStatus}`)

  const outPath = join(repoRoot, 'packages/context/context-graph/scripts/layer2-taskset.json')
  writeFileSync(outPath, JSON.stringify(accepted, undefined, 2))
  console.log(`Wrote ${accepted.length} validated tasks to ${outPath}`)
}

main()
