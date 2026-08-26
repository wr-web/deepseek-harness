# `@deepseek-ai/dsh-client-ui-context-graph`

[English](README.md) | 中文

此浏览器插件注册“上下文树”会话视图。它按项目分组已完成轮次检查点，用分支轨道呈现连续与 fork 深度，标记新鲜、老化中、已腐败和已复用节点，并显示已记录的工具计数与提供方 token 总量。页头汇总项目、节点与复用边数量。节点操作会在准确记录的 `turn/end` 序列 fork 源会话并打开子会话。

视图通过 `ctx.remote.contextGraph.snapshot` 读取有界图。会话更新会刷新视图；显式刷新按钮用于读取未进入当前客户端窗口的持久变化。复用边显示为 badge，而不参与结构缩进，因此跨分支复用不会扭曲树深。纯 layout 投影会限制异常结构循环。

## Model Experience

无，因为此包提供浏览器侧的图投影与 fork 控件；自动的模型可见复用由 Host 的 context-graph 包负责。

#### KV Cache effect

渲染不会产生影响。发起 fork 遵循会话服务现有的继承历史行为。

## 已知限制与后续工作

- 视图使用紧凑的时间顺序树，而不是可平移缩放的画布；超大森林依赖 Host 配置的会话与节点上限。
- 复用关系在目标节点显示为来源 badge，不会绘制一条跨越项目区块的第二连线。
- 新鲜度只解释年龄分类；在 provider 提供依据前，不显示文件或 Git revision。
