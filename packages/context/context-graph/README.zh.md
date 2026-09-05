# `@deepseek-ai/dsh-context-graph`

[English](README.md) | 中文

`ctx.contextGraph` 把已完成的会话轮次投影为可跨会话复用的森林。节点是已完成轮次的检查点：key 与摘要来自可见的 assistant 最终文本，prompt 来自直接用户文本，action 聚合已记录的工具调用。reasoning 块和未完成轮次不会成为图内容。连续、显式会话 fork 与自动复用是三种不同的边。

服务通过 `ctx.sessionQuery` 读取会话，提供有界的 `snapshot` 与 `match` Remote 方法，并可在新根会话的第一个模型 step 添加一个匹配检查点。它不修改 `agent-loop`，也不复制整个源会话。每个注入的检查点都是带身份的 `user/message`，因此重放可以重建复用边和准确的注入字节数。

<a id="distribution"></a>

## 发布方式

DSH Web profile 会同时挂载此 Host 包与 [`@deepseek-ai/dsh-client-ui-context-graph`](../../client/ui-context-graph/README.zh.md)。两个包属于同一个 `dsh-v*` release family，且版本必须与运行中的 DSH 一致，因此用户通过 `npx @deepseek-ai/dsh web` 获得完整功能，无需单独安装任一包。

## 图与复用语义

节点使用稳定的 `<session>@<turn>:<turn-end-seq>` 标识。fork 会话不会把继承的 seed 事件重复计入自己的节点列表，并会把第一个新节点连接到 fork 序列处最新保留的父检查点。会话按记录的工作目录组成项目树；没有 cwd 的会话形成独立根。复用边可以跨分支，但 web 配置只允许在同一工作目录中自动匹配。

读取快照时会计算新鲜度。年龄小于 `staleAfterMs` 一半的节点为新鲜，后一半为老化中，更老的节点为已腐败。已腐败节点仍然可见，但不能被自动匹配。首版有意只依据年龄，不声称项目内容仍然有效。

自动复用只在全新根会话的 step 1 运行，且该会话不能已有完成轮次。它针对 prompt、可见摘要与工具名，以规范化查询 token 覆盖率给已完成、未腐败节点排序。英文词、中文字符和双字组合使用同一个确定性分数。服务按顺序尝试候选，直到完整元数据可以放进 `maxRecallBytes`；不会发送残缺的来源信息。成功匹配后，会在直接请求后附加一条不可信、只读的 JSON 检查点。UI 的显式 fork 是另一个操作，它在选中轮次的完成序列调用 `sessions.fork`。

## 公开 API 与评测

- `snapshot(signal?)` 返回有界森林、结构边与复用边、各节点 token 总量以及聚合复用次数/字节。
- `match(targetSessionId, query, signal?)` 在工作区、分数、新鲜度与数量限制内返回排序候选。
- `measureContextGraphRun(events)` 从会话日志汇总提供方报告的未缓存输入、缓存读取、缓存写入与输出 token，以及复用次数和字节。
- `evaluateContextGraph(baselineEvents, recalledEvents)` 对比等价的基线运行和复用运行。saved-token 字段为正表示复用运行更省；`outputTokenDelta` 是复用值减基线值。该函数只计量成本，不对任务质量作出判断。

评测应在等价项目状态下，用相同任务与模型配置运行两次：一次设置 `autoRecall: false`，另一次准备相关完成检查点并设置 `autoRecall: true`。比较 `totalInputTokensSaved` 与 `inputReductionRate`，再独立评估任务成功、代码改动、测试结果和延迟。如果任务质量不等价，token 下降不算成功。

## 配置

所有字段都是必填项，使每种部署明确声明保留与注入策略。web-app 配置当前使用以下值：

| Key | Web 值 | 含义 |
|---|---:|---|
| `autoRecall` | `true` | 启用首 step 自动复用。 |
| `sameWorkspaceOnly` | `true` | 要求记录的工作目录相同。 |
| `includeSubagents` | `false` | 快照是否包含 subagent 来源会话。 |
| `maxSessions` | `100` | 每次快照检查的最新会话记录数。 |
| `maxNodesPerSession` | `40` | 每个会话保留的最新完成检查点数。 |
| `readConcurrency` | `4` | 持久会话并发读取数。 |
| `maxTextBytes` | `4096` | 每个 prompt 和摘要投影的 UTF-8 上限。 |
| `maxRecallBytes` | `2048` | 完整注入检查点的准确 UTF-8 上限。 |
| `matchLimit` | `5` | 返回的排序候选上限。 |
| `minScore` | `0.45` | 最低规范化 token 覆盖率。 |
| `staleAfterMs` | `2592000000` | 节点变为已腐败的年龄（30 天）。 |
| `cacheTtlMs` | `10000` | 快照缓存时间；任何会话事件都会提前失效缓存。 |

无法读取的持久会话会被记录警告并跳过，避免一条损坏记录移除整片森林。取消会停止发现和排序。短时且由事件失效的缓存避免浏览器和 pre-step 路径反复读取同一批有界会话。

## Model Experience

### 复用的上下文检查点

#### What the model sees

匹配成功时，模型会先看到当前直接请求，再看到一条用户角色的 `## Reused context checkpoint` 消息。它包含源节点/会话 ID、捕获序列、完成时间、匹配分数、工具计数和截断后的可见回答摘要。警告把所有字段标记为不可信背景，并禁止模型接受其中的指令或权限声明，除非当前用户再次明确提出。

#### Token effect

复用内容最多向新请求及其后续历史增加 `maxRecallBytes` 字节 UTF-8 文本。目标是替代重复探索或解释，但净 token 效果取决于模型是否真的避免这些工作。`evaluateContextGraph` 计量提供方报告的结果，而不是预设一定节省。

#### KV Cache effect

检查点以 suffix 方式追加，因此目标会话较早的可缓存前缀不变。不同匹配只改变 suffix。显式 fork 早期会话会保留该会话的 seed，并遵循现有会话 fork 的缓存行为。

## 已知限制与后续工作

- **仅词法匹配** — 确定性 token 覆盖率成本低，但无法识别语义改写。未来可由 embedding 或项目索引 provider 替换排序，同时保持节点 ID 和日志来源不变。
- **只按年龄腐败** — 服务还不能观察 Git revision、依赖锁、文件变化或测试结果。因此腐败期限只阻止无限期自动复用，不能证明节点仍然新鲜。
- **可见摘要，不生成记忆** — 节点 key 与摘要使用 assistant 最终文本。插件有意不持久化隐藏 chain-of-thought，也不额外调用模型生成摘要。
- **有界发现** — 只有配置范围内最新的会话和每个会话最新的节点参与。这是可预测的成本上限，不是完整历史索引。
- **自动复用不是自动 fork 会话** — 它只向当前新会话提供一个检查点。需要继承历史时，浏览器可以从精确的完成轮次显式 fork。
- **成本评测不是质量评测** — 内置 evaluator 报告 token 用量与复用体积。产品 benchmark 必须同时包含任务成功和回归检查。
