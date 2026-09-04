import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  computeScopeRatio, fingerprintProbe, replayChecklist, type ContextGraphProbe,
} from '@deepseek-ai/dsh-context-graph'

// Layer 0 (noise baseline) and Layer 1 (verifier accuracy against real git
// history) from .agents/notes/proposed/architecture/2026-09-05-context-graph-replay-verification.md.
// Both run against real temporary git repositories rather than mocks: the
// verifier's whole premise is that it observes the actual working tree, so a
// mock would test nothing.

const dirs: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'context-graph-replay-'))
  dirs.push(dir)
  git(dir, ['init', '--quiet'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  // Pinned per-repo (not relying on the host's global config) so a file-hash
  // probe sees identical bytes after a real `git clone` regardless of the
  // host's autocrlf setting — without this, Windows's default CRLF rewrite
  // makes a byte-for-byte hash differ across clones of the same commit,
  // which is exactly the kind of environment noise Layer 0 exists to catch.
  git(dir, ['config', 'core.autocrlf', 'false'])
  return dir
}

function commit(cwd: string, message: string): string {
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '--quiet', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD']).trim()
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function pathExistsProbe(cwd: string, seq: number, path: string, loadBearing = true): ContextGraphProbe {
  const draft: ContextGraphProbe = { seq, kind: 'path-exists', path, capturedFingerprint: '', loadBearing }
  return { ...draft, capturedFingerprint: fingerprintProbe(cwd, draft) }
}

function fileHashProbe(cwd: string, seq: number, path: string, loadBearing = true): ContextGraphProbe {
  const draft: ContextGraphProbe = { seq, kind: 'file-hash', path, capturedFingerprint: '', loadBearing }
  return { ...draft, capturedFingerprint: fingerprintProbe(cwd, draft) }
}

function grepProbe(cwd: string, seq: number, path: string, pattern: string, loadBearing = true): ContextGraphProbe {
  const draft: ContextGraphProbe = { seq, kind: 'grep', path, pattern, capturedFingerprint: '', loadBearing }
  return { ...draft, capturedFingerprint: fingerprintProbe(cwd, draft) }
}

describe('Layer 0: noise baseline', () => {
  it('replays fresh on every repeated pass of an unchanged commit', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    const head = commit(repo, 'add auth')
    const probes = [
      pathExistsProbe(repo, 1, 'auth.ts'),
      fileHashProbe(repo, 2, 'auth.ts'),
      grepProbe(repo, 3, 'auth.ts', 'function login'),
    ]
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(replayChecklist(repo, probes, head, ['auth.ts'])).toMatchObject({
        verdict: 'fresh', k: 3, n: 3, scopeRatio: 1,
      })
    }
  })

  it('produces identical results across an independent clone of the same commit', () => {
    const repoA = tempRepo()
    writeFileSync(join(repoA, 'auth.ts'), 'export function login() {}\n')
    const head = commit(repoA, 'add auth')
    const probes = [pathExistsProbe(repoA, 1, 'auth.ts'), fileHashProbe(repoA, 2, 'auth.ts')]

    const repoB = mkdtempSync(join(tmpdir(), 'context-graph-replay-clone-'))
    dirs.push(repoB)
    // -c applies before checkout: a plain clone would otherwise pick up the
    // host's global autocrlf setting (commonly true on Windows) and rewrite
    // line endings on checkout, corrupting the byte-for-byte comparison below.
    git(tmpdir(), ['clone', '--quiet', '-c', 'core.autocrlf=false', repoA, repoB])

    expect(replayChecklist(repoB, probes, head, ['auth.ts']))
      .toEqual(replayChecklist(repoA, probes, head, ['auth.ts']))
  })
})

describe('Layer 1: verifier accuracy against git-history ground truth', () => {
  it('stays fresh across a commit whose changed paths are all recorded as touched', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    writeFileSync(join(repo, 'routes.ts'), 'register(login)\n')
    const head = commit(repo, 'add auth and routes')
    const probes = [
      pathExistsProbe(repo, 1, 'auth.ts'),
      fileHashProbe(repo, 2, 'auth.ts'),
      grepProbe(repo, 3, 'auth.ts', 'function login'),
    ]
    writeFileSync(join(repo, 'routes.ts'), 'register(login)\nregister(logout)\n')
    commit(repo, 'register logout too')

    expect(replayChecklist(repo, probes, head, ['auth.ts', 'routes.ts'])).toMatchObject({
      verdict: 'fresh', k: 3, n: 3, scopeRatio: 1,
    })
  })

  it('downgrades a full pass to partial when unrelated, unrecorded paths move (scope guard)', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    writeFileSync(join(repo, 'routes.ts'), 'register(login)\n')
    const head = commit(repo, 'add auth and routes')
    const probes = [pathExistsProbe(repo, 1, 'auth.ts'), fileHashProbe(repo, 2, 'auth.ts')]
    writeFileSync(join(repo, 'routes.ts'), 'register(login)\nregister(logout)\n')
    commit(repo, 'register logout too')

    // Every auth.ts probe still holds (k === n), but the checkpoint never
    // recorded routes.ts as touched, so the scope-ratio guard trades a
    // possible false "fresh" for a conservative "partial" — see the coarse
    // patch discussed in .agents/notes/proposed/architecture/2026-09-05-context-graph-replay-verification.md.
    expect(replayChecklist(repo, probes, head, ['auth.ts'])).toMatchObject({
      verdict: 'partial', k: 2, n: 2, scopeRatio: 0,
    })
  })

  it('ignores drift in a non-load-bearing probe instead of killing the node', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    writeFileSync(join(repo, 'notes.md'), 'first draft\n')
    const head = commit(repo, 'add auth and notes')
    const probes = [
      pathExistsProbe(repo, 1, 'auth.ts'),
      fileHashProbe(repo, 2, 'auth.ts'),
      fileHashProbe(repo, 3, 'notes.md', false),
    ]
    writeFileSync(join(repo, 'notes.md'), 'first draft, with an extra aside\n')
    commit(repo, 'annotate notes')

    const replay = replayChecklist(repo, probes, head, ['auth.ts', 'notes.md'])
    expect(replay).toMatchObject({ verdict: 'fresh', k: 2, n: 2 })
    expect(replay.results.find(result => result.seq === 3)?.consistent).toBe(false)
  })

  it('reports partial with the exact break point when a later load-bearing probe is invalidated', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\nexport function logout() {}\n')
    writeFileSync(join(repo, 'routes.ts'), 'register(login)\n')
    const head = commit(repo, 'add auth and routes')
    const probes = [
      pathExistsProbe(repo, 1, 'auth.ts'),
      fileHashProbe(repo, 2, 'routes.ts'),
      grepProbe(repo, 3, 'auth.ts', 'function logout'),
      pathExistsProbe(repo, 4, 'auth.ts'),
    ]
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    commit(repo, 'remove logout')

    expect(replayChecklist(repo, probes, head, ['auth.ts', 'routes.ts'])).toMatchObject({
      verdict: 'partial', k: 2, n: 4,
    })
  })

  it('reports locational when the prefix breaks immediately but the path still exists', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\nexport function logout() {}\n')
    const head = commit(repo, 'add auth')
    const probes = [
      grepProbe(repo, 1, 'auth.ts', 'function logout'),
      fileHashProbe(repo, 2, 'auth.ts'),
    ]
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    commit(repo, 'remove logout')

    expect(replayChecklist(repo, probes, head, ['auth.ts'])).toMatchObject({
      verdict: 'locational', k: 0, n: 2,
    })
  })

  it('reports dead when the probed path is deleted from the working tree', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    const head = commit(repo, 'add auth')
    const probes = [pathExistsProbe(repo, 1, 'auth.ts'), fileHashProbe(repo, 2, 'auth.ts')]
    rmSync(join(repo, 'auth.ts'))
    commit(repo, 'remove auth')

    expect(replayChecklist(repo, probes, head, ['auth.ts'])).toMatchObject({
      verdict: 'dead', k: 0, n: 2,
    })
  })

  it('sorts an out-of-order checklist by seq before computing the prefix', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\nexport function logout() {}\n')
    const head = commit(repo, 'add auth')
    // Recorded out of seq order: the break (seq 2) is listed before the
    // probe that should still count toward k (seq 1).
    const probes = [
      grepProbe(repo, 2, 'auth.ts', 'function logout'),
      pathExistsProbe(repo, 1, 'auth.ts'),
    ]
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    commit(repo, 'remove logout')

    expect(replayChecklist(repo, probes, head, ['auth.ts'])).toMatchObject({ k: 1, n: 2 })
  })

  it('reports dead instead of throwing when the captured commit can no longer be resolved', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    commit(repo, 'add auth')
    const probes = [pathExistsProbe(repo, 1, 'auth.ts'), fileHashProbe(repo, 2, 'auth.ts')]

    // Environment drift stand-in: a commit hash that was never part of this
    // repository (pruned history, a shallow clone, a rebased branch) makes
    // `git diff` itself fail rather than report an ordinary path change.
    const unresolvableCommit = '0'.repeat(40)
    expect(replayChecklist(repo, probes, unresolvableCommit, ['auth.ts'])).toEqual({
      verdict: 'dead', k: 0, n: 2, scopeRatio: 0, results: [],
    })
  })
})

describe('computeScopeRatio', () => {
  it('returns 1 when nothing changed since the captured commit', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    const head = commit(repo, 'add auth')
    expect(computeScopeRatio(repo, head, ['auth.ts'])).toBe(1)
  })

  it('excludes changes outside the touched path\'s directory instead of counting them against the ratio', () => {
    const repo = tempRepo()
    mkdirSync(join(repo, 'sub'))
    writeFileSync(join(repo, 'sub', 'auth.ts'), 'export function login() {}\n')
    writeFileSync(join(repo, 'other.ts'), 'export const x = 1\n')
    const head = commit(repo, 'add sub/auth.ts and other.ts')
    // Before directory-scoping, this unrelated repo-root change would have
    // dominated the denominator (changed=['other.ts'], overlap=0 -> ratio 0)
    // even though nothing under sub/ — the checkpoint's actual scope — moved.
    writeFileSync(join(repo, 'other.ts'), 'export const x = 2\n')
    commit(repo, 'change unrelated file outside the touched directory')
    expect(computeScopeRatio(repo, head, ['sub/auth.ts'])).toBe(1)
  })

  it('falls back to no directory restriction when there are no touched paths', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\n')
    const head = commit(repo, 'add auth')
    writeFileSync(join(repo, 'auth.ts'), 'export function login() {}\nexport function logout() {}\n')
    commit(repo, 'add logout')
    expect(computeScopeRatio(repo, head, [])).toBe(0)
  })
})
