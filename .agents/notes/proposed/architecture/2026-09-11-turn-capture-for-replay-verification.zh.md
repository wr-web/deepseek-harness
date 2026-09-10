# Agent Note: 为重放验证式召回做的轮次边界捕获

Status: proposed

[English](2026-09-11-turn-capture-for-replay-verification.md) | 中文

## 问题

`@deepseek-ai/dsh-context-graph` 已经有一套能跑、有测试的重放验证原语（`src/replay.ts`：`replayChecklist`、`fingerprintProbe`、`computeScopeRatio`），但没有任何数据可以喂给它。`ContextGraphNode` 既不带探针，也不带捕获时的 commit，所以生产环境里根本没有任何地方调用过这个原语——召回至今仍然是靠 `graph.ts` 里纯按年龄算的 `fresh`/`aging`/`stale` 来把关，而这正是[重放验证那份笔记](2026-09-05-context-graph-replay-verification.zh.md)一开始就想补上的缺口。

要跑一份 checklist，需要两个在持久化事件日志里根本不存在的事实：**这一轮到底碰了哪些路径**，以及**这一轮结束那一刻的 git `HEAD`**。两个都没法事后补回来。那份笔记里已经论证过为什么不能在 `buildContextGraph` 里事后推导：`graph.ts` 的文档和测试都把它定义为纯提取，`computeScopeRatio` 本身是一次 `git diff` 子进程调用，而快照缓存每来一个 `session/event` 就会重建——所以事后推导等于在一个目前同步、可 mock、纯函数的东西上，每次重建都按历史节点数去 spawn 子进程。

所以缺的这一块是捕获，不是验证：得有个东西在真实的轮次边界上，把这两个事实记录一次，写到某个持久的地方去。

## 决定

在轮次边界上捕获，写进持久化的 session 日志，用可选字段承载。

**在哪捕获。** `packages/core/agent-loop/src/agent.ts:319`——`this.session.append('turn/end', { turn, reason: turnEnds! })`，本来就在一个带自己 try/catch 的 `finally` 里。这是唯一一处 finalize 轮次的地方，也正是 checkpoint 的探针所描述的那个工作区状态所对应的时刻。

**捕获什么。** 给 `SessionEventMap['turn/end']`（`packages/core/session/src/types.ts:252`）加一个可选字段：

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

**兼容性。** 这个字段是可选的、纯增量的，所以 `SESSION_FORMAT_VERSION` 保持 `0`，也不需要迁移：老日志就是没有 `capture`，于是产不出探针，于是退回到今天这套按年龄判断新鲜度的逻辑。这个退路并不是为了迁移临时糊上去的降级路径——所有早于这次改动的 session 会永远走这条路，所以它必须一直是一等公民分支。

**碰过的路径**来自日志里本来就有的 `tool/call` 事件（`{ name, arguments }`，arguments 是原样记录的），通过一张明确的"工具名 → 路径参数名"映射表来提取，而不是在一个没审计过的 200 多个包的工具生态里到处猜 JSON 字段名。读实际工具定义确认过：`read`、`edit`、`write`（`packages/fs/tool-fs`）用 `file_path`；`str_replace_editor`（`packages/fs/tool-str-replace-editor`）用 `path`。不在映射表里的工具就不产出探针——这张表的失败模式是少捕获，永远不会捕获错。

**读取侧。** 之后 `graph.ts` 就能从它本来就在投影的那些事件里构造出每个节点的 checklist，保持纯函数、不引入新的 I/O；`index.ts` 在召回时针对活的工作区跑 `replayChecklist`，把 verdict 当作**决定 `recallForFirstTurn` 到底要不要召回的门槛**——绝不当成召回块里的文字。这个方向不是偏好问题：[重放验证那份笔记](2026-09-05-context-graph-replay-verification.zh.md)实测过把真实计算出来的 verdict 当文字注入，结果在召回明显有用的那个任务上，把收益砍掉了大约一半（汇总 80% → 40%，Fisher p=0.06），比什么都不说还差。同一份笔记也测出门槛必须放行 `partial`，而不能只放行 `fresh`——那个唯一明确有收益的任务，真实 verdict 恰好就是 `partial`，所以只认 `fresh` 的门槛会精准地把唯一值得留下的那个情形压掉。

## 考虑过的替代方案

**让 context-graph 自己存一份 sidecar，完全绕开 core 的 schema 改动。** 这个插件本来就订阅了 `session/event`（`index.ts:74`），所以它完全可以自己观察 `turn/end`、把探针记进自己的存储，不用碰 `core/session`。之所以否掉，是因为现在还建不了，不是因为方向不对：这套 harness 目前根本没有通用的持久化接缝。[domain KV 存储那份笔记](2026-07-24-domain-kv-storage-and-workspace.zh.md)至今还是 `Status: proposed`，代码里也没有 `ctx.kv`；那份笔记自己的问题陈述里就写着，session 事件日志是"宿主唯一的持久化面"。等那个接缝落地之后，这个替代方案就会变成更好的设计，所以这里捕获的数据被刻意设计成一条自包含的记录，将来可以整体搬过去。

**异步捕获，避开轮次结束的热路径。** 因为正确性否掉：探针描述的是*边界那一刻*的工作区，任何晚一点捕获的东西都可能悄悄跟它对不上。一个跟自己要指纹的对象赛跑的捕获，比不捕获更糟，因为算出来的 verdict 看起来像是权威的。

**按 session 捕获一次，而不是每轮捕获。** 粒度不对——checkpoint 的单位就是轮次，而一个 session 靠后的轮次，可能离它第一轮已经隔了很多个 commit。

**什么都不做，继续用按年龄判断新鲜度。** 这是诚实的基线，而且比听起来更有说服力。同一份笔记的实测发现，今天生产环境的这个形状（只有内容、不带任何新鲜度评论）已经是测过的所有臂里表现最好的，而且召回在 token 上的整体收益压根就没被证实过。这份提案是在为一个**收益尚未被证明**的门槛做铺垫工作——见"验证"一节。

## 验证

有两件事必须测，而且第二件大概率应该排在第一件前面：

- **轮次边界的开销。** `git rev-parse HEAD` 是在核心循环热路径的 `finally` 里、每轮一次的子进程 spawn，而且是在一个 spawn 并不便宜的平台（Windows）上。它必须有上界、必须永远不抛异常、也必须永远不能让一个本来成功的轮次失败——捕获失败就意味着没有 `capture` 字段，仅此而已。每轮增加的延迟需要在上线*之前*测，而不是之后。
- **门槛到底有没有用。** 到目前为止测过的所有臂，比的都是*内容*的变体；还没有任何一个实验测过门槛本身——也就是在 verdict 为 `dead`/`locational` 时压制召回，对比照样召回。这个实验并不需要这次 schema 改动：完全可以在现有的 pilot harness 里跑（`scripts/run-layer2-verdict-pilot.ts` 已经能通过 `git worktree` 算出真实 verdict），只要加一个"verdict 不好就不给召回块"的臂就行。先把这个跑出来，才能确定这个门槛值不值得为它付出捕获的代价，而不是先假设它值得、然后把捕获建在这个假设上。

## 影响

- `core/session` 的事件 schema 多一个可选字段，`core/agent-loop` 在轮次结束处多一个有上界、能容错的捕获步骤——改动不大，但位置很关键，这也正是上面那条开销测量是前置条件而不是后续事项的原因。
- 这次改动之前记录的 session 永远不会有探针；按年龄判断新鲜度会作为退路分支长期存在，而不是一条临时的迁移路径。
- 捕获下来的记录被设计成可搬迁的：如果 domain KV 接缝落地，捕获可以整体搬出 session 日志，而捕获什么、怎么消费都不用变。
- 这份笔记除了点明门槛的行为（`dead`/`locational` 压制，`fresh`/`partial` 以纯内容形式召回）之外，并不去实现它。verdict 要不要当文字注入这个问题已经有实测结论了，不应该在每次实现时再翻一遍。
