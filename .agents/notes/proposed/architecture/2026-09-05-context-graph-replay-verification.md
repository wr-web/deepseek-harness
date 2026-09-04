# Agent Note: Replay-verified checkpoint freshness for the context graph

Status: proposed

English | [中文](2026-09-05-context-graph-replay-verification.zh.md)

## Problem

`@deepseek-ai/dsh-context-graph`'s freshness classification (`fresh`/`aging`/`stale` in `src/graph.ts`) is purely age-based: a node younger than half its configured lifetime is `fresh` regardless of whether the code it describes still looks the way it did at capture time. The prior design note's Consequences section already names this gap: "Age-based decay can suppress old context but cannot recognize a repository revision; Git/file fingerprints ... remain provider opportunities." A stale-looking but still-accurate node is discarded for no reason, and a fresh-looking but since-rewritten node is injected as if it were still true — the second failure mode is the dangerous one, because an agent has no way to tell a confidently wrong checkpoint from a correct one.

Replacing age with a full re-derivation (re-run the whole trajectory) is not viable: it would spend the tokens the feature exists to save. The alternative is to check whether the specific facts a checkpoint depends on — the files, symbols, and command outputs its trajectory actually read — still hold, without another model call.

## Decision

Split a checkpoint into three parts with independent invalidation speed: identity/matching fields (unchanged), structured conclusions plus a separate dead-ends field, and a new **replay checklist** — an ordered list of no-model-call probes recorded at capture time. Each probe records `{ seq, kind, path, capturedFingerprint, loadBearing }`. `loadBearing` is set by a cheap write-time heuristic (did this probe's output feed a later tool argument, a subsequently-edited file's last read, or the final conclusion text); only load-bearing probes count toward the freshness prefix, so an incidental drift (an added comment, an unrelated line) cannot invalidate a node whose actual dependency still holds.

Replay runs in confidence tiers, not a generic diff: `path-exists` and `file-hash` are exact (L0); `grep` presence (a symbol still appears somewhere in the file; line-number shift is not a failure) is structural (L1). Both participate in the verdict. A tier for scrubbed command stdout (L2) is deliberately deferred — it needs a noise baseline first (see Verification) before it can safely participate.

The verdict is a longest-consistent-prefix computation: `k` is how many load-bearing probes, in `seq` order, replay consistently before the first inconsistency; `n` is the total load-bearing probe count. `k === n` with the recorded touched paths mostly covering what changed since capture (`scopeRatio`, see below) is `fresh`; a large-enough consistent prefix is `partial`; a small prefix whose paths still exist is `locational`; every probe fingerprinting to `missing` is `dead`. `scopeRatio` is a coarse guard against the blind spot where the codebase changed substantially but happened not to touch anything the checkpoint's probes read: it downgrades an otherwise-full pass rather than trusting it unconditionally. `computeScopeRatio` reads `git diff --name-only <capturedHead>` against the live working tree (not a clean checkout of `HEAD`), because uncommitted changes are exactly the state a forked agent will actually face.

This first slice (`packages/context/context-graph/src/replay.ts`) implements only the no-sandbox probes above (`path-exists`, `file-hash`, `grep`) — what the design spec calls Phase 1. Phase 2 (copy-on-write sandboxed re-execution of exec probes, gated on Phase 1 passing) is not implemented here; a checkpoint with only Phase 1 probes already produces a real verdict without it.

`replayChecklist` never throws: a replay-infrastructure failure — most concretely, the captured commit no longer resolving because history was pruned, rebased, or the checkout is shallow — reports `dead` rather than propagating an exception. This is deliberate, not defensive-programming reflex: environment drift of that kind is itself a strong freshness signal, not an error state the caller should have to guard against separately.

## Alternatives considered

**Keep age-based freshness and only add manual staleness marking.** Rejected because it depends on a person noticing drift; the design goal is a check that runs for free on every candidate.

**Treat any probe drift as invalidating.** Rejected: an unrelated comment or reformatted neighboring line would kill a node whose actual dependency is untouched, which is a bigger practical cost than a slightly more permissive verdict. The load-bearing/non-load-bearing split exists specifically to avoid this false-positive class.

**Compare `HEAD` at replay time instead of the working tree.** Rejected because a fork inherits the user's actual uncommitted state, not a clean checkout; validating against `HEAD` would validate a world the forked agent will not be in.

**Let every probe kind participate in the verdict, including raw command stdout.** Rejected until a scrubber's noise floor is measured (Layer 0 below); unscrubbed non-determinism would make the verdict noisier than the thing it replaces.

## Verification

`packages/context/context-graph/tests/replay.spec.ts` covers the two layers that can run before any model call or paired online trial: a noise baseline (replaying an unchanged commit twenty times, and replaying the same commit from an independent clone, both asserting an identical `fresh` verdict) and verifier accuracy against real git history used as ground truth (a real commit that only touches recorded paths stays `fresh`; an unrecorded-path change downgrades a full pass to `partial` through the scope guard; drift confined to a non-load-bearing probe is ignored; a real content change past a given probe produces the exact expected `k`/`partial`; a broken prefix over a still-present path is `locational`; a deleted path is `dead`). All of it runs against real temporary git repositories rather than mocks, because the verifier's premise is that it observes the actual working tree.

Not yet built: the paired six-arm cost/quality trial and the shadow-mode online loop from the full design spec are gated on this verifier layer holding up on a real project's commit history first — they are expensive, and an inaccurate verifier makes their result meaningless.

## Consequences

A checkpoint can now report a specific, falsifiable reason to trust or distrust it, instead of only its age. The load-bearing distinction and the scope-ratio guard are both intentionally coarse, conservative heuristics rather than a proof of correctness: `scopeRatio` in particular will downgrade some checkpoints that are actually still fine whenever unrelated files move without being listed as touched, trading recall for a lower false-`fresh` rate. Phase 2 (sandboxed exec-probe replay) and the L2 confidence tier remain open work, as does wiring this verdict into `graph.ts`'s node projection and the recall-injection path in `index.ts` — this note covers the probe/verdict primitive and its own test layer, not yet its integration into automatic recall.
