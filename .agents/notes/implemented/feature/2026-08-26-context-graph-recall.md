# Agent Note: Completed-turn context graph and bounded recall

Status: implemented

English | [中文](2026-08-26-context-graph-recall.zh.md)

## Problem

Independent sessions repeatedly pay for the same project orientation, code search, and explanation. Session forks preserve an exact prefix when a user already knows the useful source and sequence, while session references copy a source selected by the user. Neither mechanism discovers a related completed turn for a new request or shows how reusable work relates across projects and forks.

Treating hidden model reasoning as durable memory would expose content that the product does not otherwise project, would depend on provider-specific reasoning availability, and would encourage replaying instructions from an older task. Copying whole sessions automatically would also spend tokens on irrelevant history and make stale context harder to identify.

## Decision

`@deepseek-ai/dsh-context-graph` derives a bounded forest from durable session events without adding a new stored format. Each reusable node is one completed turn identified by session id, turn, and terminal sequence. Its prompt uses direct user text, its key and summary use visible final assistant text, and its actions count logged tool calls. Reasoning blocks, unfinished turns, and inherited seed events are excluded. Provider usage remains attached to each node for measurement.

Continuation and session-fork edges form the structural forest. Working directory provides the initial project root. An automatically recalled node creates a separate recall edge reconstructed from an identified `user/message` source. The recall record carries source node/session ids, capture sequence, match score, and exact UTF-8 bytes, so replay does not depend on a mutable external index.

The web profile automatically recalls only on the first step of a fresh root session. Deterministic lexical matching covers prompt, visible summary, and tool names, supports CJK characters and bigrams, requires the same recorded working directory, and excludes stale nodes. At most one complete checkpoint is appended, under a 2048-byte limit. It is marked untrusted, read-only background; metadata that cannot fit causes that candidate to be skipped. The plugin uses `agent/pre-step` and the session-query service instead of changing `agent-loop`.

Freshness is an age classification. A 30-day web threshold divides nodes into fresh, aging, and stale; stale nodes remain inspectable but cannot be automatically recalled. This classification prevents indefinite silent reuse without pretending to validate project files.

`@deepseek-ai/dsh-client-ui-context-graph` registers a conversation view and renders completed turns as circular nodes. Continuations share a vertical lane; sibling forks occupy compact lanes at their parent's next depth row. Recalls use dashed links that do not affect structural placement. Selection moves request, visible conclusion, tools, token totals, provenance, and the exact-boundary fork action into an inspector. Automatic recall supplies a checkpoint to the current root session; it is deliberately distinct from explicit session forking, which inherits the selected prefix.

The Web profile mounts the Host and browser packages as one feature. Both are members of the shared `dsh-v*` release family and publish at the running DSH version. They are not a second optional Profile Bundle: installing or removing only one half cannot produce a working feature, while a bundle layered over Web would duplicate rows that Web already owns.

The public evaluation helpers aggregate actual provider usage from baseline and recalled session logs and report uncached-input savings, total-input savings, reduction rate, output delta, recall count, and injected bytes. Product evaluation pairs those cost measurements with independent task-success, edit, test, and latency checks.

## Alternatives considered

**Persist hidden `think` text as the node.** Rejected because hidden reasoning is not a stable public model output and may contain sensitive or misleading intermediate content. Visible completed answers provide a replayable checkpoint without creating a chain-of-thought archive.

**Generate a new model summary for every turn.** Rejected for the first version because it adds the token cost the feature is meant to reduce and introduces another provider-dependent failure path. A future summarizer may be an explicit provider while visible text remains the durable source.

**Automatically fork the current session after matching.** Rejected because a fresh session already exists when pre-step matching runs, and replacing its Agent/session identity would interfere with inbox, RPC, and lifecycle ownership. Bounded recall serves automatic discovery; exact fork remains an explicit session operation.

**Use semantic embeddings immediately.** Rejected as a required foundation because it adds storage, model choice, invalidation, and credential concerns. Deterministic lexical ranking gives a keyless baseline and leaves ranking replaceable.

**Store a separate graph database.** Rejected because session headers and events already own all required facts. A derived, event-invalidated cache cannot drift from durable logs and needs no schema migration.

**Hide old nodes.** Rejected because age does not prove invalidity. Stale nodes remain useful for inspection and explicit fork while automatic recall stays conservative.

**Publish a separately installable context-graph bundle.** Rejected because the browser and Host packages require each other and the Web profile already owns both configuration rows. A second bundle would make installation and removal semantics misleading without creating an independently usable composition.

## Verification

Pure graph tests cover inherited-event exclusion, continuation/fork/recall edges, exact recall bytes, English and Chinese matching, workspace affinity, stale exclusion, provider token projection, UTF-8 truncation, and baseline comparison. Service tests mount the real Session Store and Session Query Engine, run the `agent/pre-step` waterfall, verify one bounded first-step recall, confirm hidden reasoning is absent, and cover metadata that cannot fit. Client layout tests cover parent-relative rows, compact sibling forks, recall independence, and malformed cycles. A keyless snapshot boots the real Loader composition with two fresh root sessions; its target adapter refuses the request unless the source checkpoint arrives with logged provenance and without private reasoning. Host and client TypeScript faces compile, Typert generates the `snapshot` and `match` remote clients, and focused package bundles build.

## Consequences

New root tasks can reuse a small, logged checkpoint without carrying an entire old conversation. Users can inspect why a branch exists and fork any retained completed turn. The feature arrives with the standard Web profile and cannot drift to a different package version through a separate install. The bounded scan and lexical score have predictable keyless cost, but they may miss paraphrases or select a coincidental term match. Age-based decay can suppress old context but cannot recognize a repository revision; Git/file fingerprints and semantic ranking remain provider opportunities.

Token savings are an empirical result rather than a design guarantee. A recall consumes a bounded suffix and saves tokens only when it replaces more repeated work than it adds. The evaluation helpers make that tradeoff measurable while leaving task-quality judgment to the benchmark that owns the task.
