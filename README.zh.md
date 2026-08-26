# DeepSeek Harness

[English](README.md) | 中文

<p align="center"><img src="website/public/favicon.svg" alt="" width="84" height="84"></p>

<p align="center"><strong>构建能沉淀工作、清晰分支，并可通过插件持续扩展的编码智能体。</strong></p>

<p align="center">一个开源、插件原生的智能体运行时，内置 Web UI、持久会话、工具、子智能体、工作流与可复用项目上下文。</p>

<p align="center"><a href="https://www.npmjs.com/package/@deepseek-ai/dsh"><img src="https://img.shields.io/npm/v/@deepseek-ai/dsh?color=4d6bfe&label=npm" alt="npm 版本"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4d6bfe" alt="MIT 许可证"></a> <img src="https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933" alt="Node.js 22.19 或 24 以上版本"></p>

DeepSeek Harness（`dsh`）由 [DeepSeek AI](https://deepseek.com) 开发。它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动；其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 为什么值得一试？

| | |
|---|---|
| **保留有用上下文** | 持久会话日志会形成按项目组织的工作树，记录完成轮次、显式 fork 与有界复用。 |
| **扩展运行时，而非修改循环** | 模型、工具、存储、权限、UI 视图、子智能体与工作流都以插件组合。 |
| **选择合适的入口** | 可以使用本地 Web UI、CLI、ACP 自动化服务、TypeScript SDK 或 Python SDK。 |
| **看清发生了什么** | 模型可见输入、工具活动、token 用量、会话血缘与复用来源都可以重建。 |

## 可复用轨迹树的上下文系统

上下文系统把已完成轮次投影成项目树：连续工作沿同一主干延伸，同一父节点的 fork 在同一层并排；全新的根任务还可以获得来自同一工作区的一条小型匹配检查点。节点文字直接复用可见的最终回答；轨迹树不包含隐藏推理，也不会为了渲染而额外调用模型生成摘要。

![DeepSeek Harness 上下文树：一条主线与三个同层 Codex fork](https://raw.githubusercontent.com/wr-web/deepseek-harness/context-graph-assets/context-graph/context-tree-compact-3d61bdc.gif)

演示使用了六个真实迁入的 Codex 会话，其中包括三个显式 fork 与一个 sidechat 式 fork。详细语义和评测方式见[上下文图文档](packages/context/context-graph/README.zh.md)。

> **开发者预览：** DeepSeek Harness 正在快速迭代；首个稳定版本发布前可能出现破坏兼容性的变更。

<a id="run"></a>

## 运行

安装 [Node.js 22.19 或 24+](https://nodejs.org)，然后启动本地 Web UI：

```sh
npx @deepseek-ai/dsh web
```

打开命令打印的地址，添加工作区，再到**设置 → 模型**配置模型。[DeepSeek API Key](https://platform.deepseek.com/)可以直接使用，也支持其他提供方和自定义 OpenAI 兼容端点。

第一次可以尝试这个任务：

> 总结这个仓库，找出一个安全且有价值的改进，完成实现并验证结果。

[Web UI 入门指南](docs/user/guide/index.zh.md)与[模型配置指南](docs/user/guide/providers.zh.md)提供完整步骤。如果只需要打印地址而不打开浏览器，请传入 `--no-open`。

<a id="run-from-source"></a>

### 从源码运行

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## 继续探索

- [了解整体架构](docs/architecture.zh.md)
- [开发一个插件](docs/user/develop/basic/index.zh.md)
- [使用 CLI 与自动化模式](apps/cli/README.zh.md)
- [通过 Python 驱动 DSH](docs/user/guide/python-sdk.zh.md)
- [浏览 package 地图](packages/README.zh.md)

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)分享想法或报告问题。
- 为插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，方便其他用户发现。
- 欢迎加入 [DeepSeek Harness Discord 社区](https://discord.gg/Ycq5dCaS4)。
- 中文用户也可以加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md) 与[开发指南](docs/development.zh.md)。面向智能体的要求见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)。第三方许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
