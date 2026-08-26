# `@deepseek-ai/dsh-client-ui-context-graph`

English | [中文](README.zh.md)

This browser plugin registers the Context tree conversation view. It groups completed-turn checkpoints by project and renders each checkpoint as a circle in a spatial tree: continuations stay on one vertical lane, sibling forks share their parent's next depth row in compact new lanes, and recalls use dashed cross-branch links. Selecting a circle opens its request, visible conclusion, freshness, recorded tool counts, provider token total, and exact `turn/end` fork action in the inspector. Circle labels come from the visible final assistant text; the view never spends another model call to summarize them.

The view reads the bounded graph through `ctx.remote.contextGraph.snapshot`. Session updates refresh the view, while an explicit refresh button supports persisted changes that did not enter the current client window. Recall links do not allocate branch lanes, so cross-branch reuse cannot distort the structural tree. Parents that appear after a child or are absent leave that child on the root lane instead of introducing layout recursion.

## Model Experience

None, as this package provides browser-side graph projection and fork controls; the Host context-graph package owns automatic model-visible recall.

#### KV Cache effect

None from rendering. Starting a fork follows the session service's existing inherited-history behavior.

## Known Limitations and Deferred Work

- The view uses a scrollable parent-relative canvas without pan-and-zoom controls; very large forests depend on the host's configured session and node bounds.
- Recall links render only when both endpoints belong to the same displayed project; the inspector still identifies provenance for every recalled node.
- Freshness explains age classification only; no file or Git revision is displayed until a provider supplies that evidence.
