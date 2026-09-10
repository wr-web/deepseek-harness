# Agent Note: Turn-boundary capture for replay-verified recall

Status: proposed

English | [中文](2026-09-11-turn-capture-for-replay-verification.zh.md)

## Problem

`@deepseek-ai/dsh-context-graph` has a working, tested replay-verification primitive (`src/replay.ts`: `replayChecklist`, `fingerprintProbe`, `computeScopeRatio`) and no data to run it on. `ContextGraphNode` carries no probes and no captured commit, so nothing in production ever calls the primitive — recall still gates on `graph.ts`'s purely age-based `fresh`/`aging`/`stale`, exactly the gap [the replay-verification note](2026-09-05-context-graph-replay-verification.md) set out to close.

Running a checklist needs two facts that exist nowhere in the durable event log: **which paths a turn actually touched**, and **the git `HEAD` at the moment that turn completed**. Neither can be recovered afterwards. That note established why they cannot be derived retroactively inside `buildContextGraph`: `graph.ts` is documented and tested as pure extraction, `computeScopeRatio` is a `git diff` subprocess call, and the snapshot cache rebuilds on every `session/event` — so retroactive derivation would put one subprocess spawn per historical node on every rebuild of a function that is currently synchronous, mockable, and pure.

So the missing piece is capture, not verification: something has to record those two facts once, at the real turn boundary, into somewhere durable.

## Decision

Capture at the turn boundary, in the durable session log, behind optional fields.

**Where.** `packages/core/agent-loop/src/agent.ts:319` — `this.session.append('turn/end', { turn, reason: turnEnds! })`, already inside a `finally` with its own try/catch. This is the only place a turn is finalized, and it is the moment whose working-tree state a checkpoint's probes describe.

**What.** Extend `SessionEventMap['turn/end']` (`packages/core/session/src/types.ts:252`) with one optional field:

```ts
'turn/end': {
  turn: number
  reason: TurnEndReason
  /** Working-tree facts observed as this turn closed; absent when unavailable. */
  capture?: {
    /** `git rev-parse HEAD` in the session cwd at turn close. */
    head?: string
    /** Cwd-relative paths this turn's tool calls read or wrote, first-use order. */
    touchedPaths?: readonly string[]
  }
}
```

**Compatibility.** The field is optional and purely additive, so `SESSION_FORMAT_VERSION` stays `0` and no migration is needed: an old log simply has no `capture`, which yields no probes, which falls back to today's age-based freshness. That fallback is not a degraded path bolted on for migration — it is the behavior every session predating this change keeps forever, so it has to stay a first-class branch regardless.

**Touched paths** come from the `tool/call` events already in the log (`{ name, arguments }`, arguments recorded verbatim), through an explicit tool-name → path-argument-key map rather than fuzzy JSON-key sniffing across an unaudited 200+-package tool ecosystem. Confirmed by reading the tool definitions: `read`, `edit`, and `write` (`packages/fs/tool-fs`) take `file_path`; `str_replace_editor` (`packages/fs/tool-str-replace-editor`) takes `path`. A tool absent from the map contributes no probe — the map's failure mode is capturing less, never capturing wrong.

**Read side.** `graph.ts` then builds each node's checklist from data already in the events it projects, staying pure with no new I/O; `index.ts` runs `replayChecklist` against the live tree at recall time and uses the verdict as a **gate on whether `recallForFirstTurn` recalls at all** — never as text inside the recalled block. That direction is not a preference: [the replay-verification note](2026-09-05-context-graph-replay-verification.md) measured injecting a real computed verdict as text and found it roughly halved recall's benefit on the one task where recall clearly helps (pooled 80% → 40%, Fisher p=0.06), performing worse than saying nothing about freshness at all. The same note also measured that the gate must admit `partial`, not just `fresh` — the one clearly-beneficial task's real verdict is `partial`, so a `fresh`-only gate would suppress precisely the case worth keeping.

## Alternatives considered

**A context-graph-owned sidecar store, avoiding the core schema change entirely.** The plugin already subscribes to `session/event` (`index.ts:74`), so it could observe `turn/end` and record probes into its own storage without touching `core/session`. Rejected as currently unbuildable, not as wrong: the harness has no general persistence seam yet. [The domain KV storage note](2026-07-24-domain-kv-storage-and-workspace.md) is still `Status: proposed` and no `ctx.kv` exists in the codebase; that note's own problem statement says the session event log is "the host's only persistence surface." This alternative becomes the better design the moment that seam lands, and the capture data is deliberately shaped as a self-contained record so it could move there later.

**Capture asynchronously, off the turn-end hot path.** Rejected on correctness: probes describe the tree *as it was at the boundary*, and anything captured later can silently disagree with it. Capture that races the thing it is meant to fingerprint is worse than no capture, because the resulting verdict looks authoritative.

**Capture once per session rather than per turn.** Wrong granularity — a checkpoint is a turn, and a session's later turns can sit many commits away from its first.

**Do nothing; keep age-based freshness.** The honest baseline, and stronger than it sounds. The same note's measurements found today's production shape (content only, no freshness commentary) is already the best-performing arm tested, and that recall's aggregate token benefit is not established at all. This proposal is enabling work for a gate whose benefit is *not yet demonstrated* — see Verification.

## Verification

Two things must be measured, and the second should probably gate the first:

- **Turn-boundary cost.** `git rev-parse HEAD` is a subprocess spawn in a `finally` on the core loop's hot path, per turn, on a platform (Windows) where spawns are not cheap. It must be bounded, must never throw, and must never fail a turn that otherwise succeeded — a capture failure means `capture` is absent, nothing more. The added per-turn latency needs measuring before this ships, not after.
- **Whether gating helps at all.** Every arm measured so far compares *content* variants; no experiment has yet tested the gate itself — suppressing recall on a `dead`/`locational` verdict versus recalling anyway. That experiment does not need this schema change: it can run in the existing pilot harness (`scripts/run-layer2-verdict-pilot.ts` already computes real verdicts via `git worktree`), by adding an arm that withholds the recall block when the verdict is bad. Running it first would establish whether the gate is worth the capture cost, rather than building capture on the assumption that it is.

## Consequences

- `core/session`'s event schema gains an optional field, and `core/agent-loop` gains a bounded, failure-tolerant capture step at turn close — a small change in a load-bearing place, which is why the cost measurement above is a precondition rather than a follow-up.
- Sessions recorded before this change never gain probes; age-based freshness remains permanently live as the fallback branch, not a temporary migration path.
- The captured record is shaped to be relocatable: if the domain KV seam lands, capture can move out of the session log without changing what is captured or how it is consumed.
- This note does not implement the gate's behavior beyond naming it (`dead`/`locational` suppress; `fresh`/`partial` recall as plain content). The verdict-as-text question is already settled empirically and should not be relitigated per-implementation.
