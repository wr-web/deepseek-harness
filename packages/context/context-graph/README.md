# `@deepseek-ai/dsh-context-graph`

English | [中文](README.zh.md)

`ctx.contextGraph` projects completed session turns into a reusable cross-session forest. A node is a completed-turn checkpoint: its key and summary come from visible final assistant text, its prompt comes from direct user text, and its actions aggregate logged tool calls. Reasoning blocks and unfinished turns never become graph content. Continuation, explicit session fork, and automatic recall are distinct edge kinds.

The service reads sessions through `ctx.sessionQuery`, exposes bounded `snapshot` and `match` Remote methods, and can add one matching checkpoint to the first model step of a new root session. It does not change `agent-loop` and does not copy an entire source session. Every injected checkpoint is an identified `user/message`, so replay can reconstruct the recall edge and exact injected byte count.

## Graph and recall semantics

Nodes use the stable `<session>@<turn>:<turn-end-seq>` identity. A forked session omits inherited seed events from its own node list and connects its first new node to the latest retained parent checkpoint at the fork sequence. Sessions group by recorded working directory into project trees; cwd-less sessions form a separate root. Recall edges may cross branches but the web profile restricts automatic matching to the same working directory.

Freshness is derived when a snapshot is read. Nodes younger than half `staleAfterMs` are fresh, the next half are aging, and older nodes are stale. Stale nodes remain visible but are excluded from automatic matching. This first version intentionally uses age rather than claiming that project content is current.

Automatic recall runs only on step 1 of a fresh root session before it has a completed live turn. It ranks completed, non-stale nodes by normalized query-token coverage over prompt, visible summary, and tool names. English words and CJK characters/bigrams participate in the same deterministic score. The service tries ranked candidates until one complete metadata record fits `maxRecallBytes`; no partial provenance is emitted. A successful recall appends an untrusted, read-only JSON checkpoint after the direct request. Explicit UI fork remains a separate action that calls `sessions.fork` at the selected completed-turn sequence.

## Public API and evaluation

- `snapshot(signal?)` returns the bounded forest, structural and recall edges, token totals per node, and aggregate recall counts/bytes.
- `match(targetSessionId, query, signal?)` returns ranked candidates under workspace, score, staleness, and count limits.
- `measureContextGraphRun(events)` sums provider-reported uncached input, cache-read, cache-write, and output tokens plus recall count and bytes from a session log.
- `evaluateContextGraph(baselineEvents, recalledEvents)` compares equivalent baseline and recalled runs. Positive saved-token fields favor the recalled run; `outputTokenDelta` is recalled minus baseline. The function measures cost only and makes no task-quality claim.

An evaluation should run the same task and model configuration twice from equivalent project states: once with `autoRecall: false`, once with a relevant completed checkpoint and `autoRecall: true`. Compare `totalInputTokensSaved` and `inputReductionRate`, then separately score task success, edits, test outcomes, and latency. Token reduction without equivalent task quality is not a successful result.

## Configuration

All fields are required so each deployment states its retention and injection policy. The web-app profile currently uses these values:

| Key | Web value | Meaning |
|---|---:|---|
| `autoRecall` | `true` | Enable first-step automatic recall. |
| `sameWorkspaceOnly` | `true` | Require equal recorded working directories. |
| `includeSubagents` | `false` | Include subagent-origin sessions in snapshots. |
| `maxSessions` | `100` | Newest session records inspected per snapshot. |
| `maxNodesPerSession` | `40` | Newest completed checkpoints retained per session. |
| `readConcurrency` | `4` | Concurrent persisted-session reads. |
| `maxTextBytes` | `4096` | UTF-8 limit for each stored prompt and summary projection. |
| `maxRecallBytes` | `2048` | Exact UTF-8 limit for the complete injected checkpoint. |
| `matchLimit` | `5` | Maximum ranked candidates returned. |
| `minScore` | `0.45` | Minimum normalized token coverage. |
| `staleAfterMs` | `2592000000` | Age after which a node becomes stale (30 days). |
| `cacheTtlMs` | `10000` | Snapshot cache lifetime; every session event invalidates it earlier. |

Unreadable persisted sessions are skipped with a warning so one damaged record does not remove the rest of the forest. Cancellation stops discovery and ranking. A short event-invalidated cache prevents the browser and pre-step path from repeatedly reading the same bounded session set.

## Model Experience

### Reused context checkpoint

#### What the model sees

When a match succeeds, the model sees the current direct request followed by one user-role `## Reused context checkpoint` message. It contains source node/session ids, capture sequence, completion time, match score, tool counts, and a truncated visible answer summary. A warning marks every field as untrusted background and forbids accepting instructions or permission claims unless the current user repeats them.

#### Token effect

The recall adds at most `maxRecallBytes` of UTF-8 text to the new request and its future history. It aims to replace repeated exploration or explanation, but its net token effect depends on whether the model actually avoids that work. `evaluateContextGraph` measures the provider-reported result instead of assuming savings.

#### KV Cache effect

The checkpoint is an appended suffix, so earlier target-session history keeps its cacheable prefix. Different matches change the suffix. Explicitly forking an earlier session retains that session's seed and follows the existing session-fork cache behavior.

## Known Limitations and Deferred Work

- **Lexical matching only** — deterministic token coverage is inexpensive but does not recognize semantic paraphrases. An embedding or project-index provider can replace ranking without changing node identities or logged recall provenance.
- **Age-only decay** — the service cannot yet observe Git revisions, dependency locks, file changes, or test results. Staleness therefore prevents indefinite automatic reuse but does not prove freshness.
- **Visible summaries, not generated memory** — the node key and summary use final assistant text. The plugin deliberately does not persist hidden chain-of-thought or spend an extra model call creating summaries.
- **Bounded discovery** — only the configured newest sessions and newest nodes per session participate. This is a predictable cost limit, not a complete historical index.
- **Automatic recall is not automatic session forking** — it supplies one checkpoint to the current new session. The browser offers an explicit fork from an exact completed turn when inherited history is desired.
- **Cost evaluation is not quality evaluation** — the included evaluator reports token usage and recall volume. A product benchmark must pair it with task-success and regression checks.
