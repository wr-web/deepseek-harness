# `@deepseek-ai/dsh-client-ui-context-graph`

English | [中文](README.zh.md)

This browser plugin registers the Context tree conversation view. It groups completed-turn checkpoints by project, renders continuation and fork depth as branch rails, labels fresh, aging, stale, and recalled nodes, and displays recorded tool counts and provider token totals. The header summarizes projects, nodes, and recall edges. A node action forks its source session at the exact recorded `turn/end` sequence and opens the child session.

The view reads the bounded graph through `ctx.remote.contextGraph.snapshot`. Session updates refresh the view, while an explicit refresh button supports persisted changes that did not enter the current client window. Recall edges are badges rather than structural indentation so cross-branch reuse cannot distort tree depth. Malformed structural cycles are bounded in the pure layout projection.

## Model Experience

None, as this package provides browser-side graph projection and fork controls; the Host context-graph package owns automatic model-visible recall.

#### KV Cache effect

None from rendering. Starting a fork follows the session service's existing inherited-history behavior.

## Known Limitations and Deferred Work

- The view uses a compact chronological tree rather than a pan-and-zoom canvas; very large forests depend on the host's configured session and node bounds.
- Recall is shown as source provenance on the target node, not as a second visual line crossing project sections.
- Freshness explains age classification only; no file or Git revision is displayed until a provider supplies that evidence.
