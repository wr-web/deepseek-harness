# DeepSeek Harness

English | [中文](README.zh.md)

<p align="center"><img src="website/public/favicon.svg" alt="" width="84" height="84"></p>

<p align="center"><strong>Build coding agents that keep their work, fork cleanly, and grow through plugins.</strong></p>

<p align="center">An open-source, plugin-native agent runtime with a Web UI, durable sessions, tools, subagents, workflows, and reusable project context.</p>

<p align="center"><a href="https://www.npmjs.com/package/@deepseek-ai/dsh"><img src="https://img.shields.io/npm/v/@deepseek-ai/dsh?color=4d6bfe&label=npm" alt="npm version"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4d6bfe" alt="MIT license"></a> <img src="https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933" alt="Node.js 22.19 or 24 and newer"></p>

DeepSeek Harness (`dsh`) is developed by [DeepSeek AI](https://deepseek.com). Its **everything is a plugin** architecture is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Why try it?

| | |
|---|---|
| **Keep useful context** | Durable session logs become a project-scoped tree of completed work, explicit forks, and bounded recall. |
| **Change the runtime, not the loop** | Models, tools, storage, permissions, UI views, subagents, and workflows compose as plugins. |
| **Use the interface that fits** | Work through the local Web UI, CLI, ACP automation server, TypeScript SDK, or Python SDK. |
| **Inspect what happened** | Model-visible inputs, tool activity, token usage, session lineage, and recall provenance remain reconstructable. |

## Reusable context, shown as a tree

The context system projects completed turns into project trees. Continuations stay on one lane, sibling forks share one depth row, and a new root task may receive one small matching checkpoint from the same workspace. Node labels reuse visible final answers: the tree excludes hidden reasoning, and rendering it does not spend another model call on summaries.

![A DeepSeek Harness context tree showing one main-line continuation and three sibling Codex forks](https://raw.githubusercontent.com/wr-web/deepseek-harness/context-graph-assets/context-graph/context-tree-compact-3d61bdc.gif)

The demo uses six imported Codex sessions, including three explicit forks and a sidechat-style fork. See the [context-graph semantics and evaluation contract](packages/context/context-graph/README.md).

> **Developer preview:** DeepSeek Harness changes rapidly. Compatibility-breaking changes are expected before the first stable release.

## Run

Install [Node.js 22.19 or 24+](https://nodejs.org), then start the local Web UI:

```sh
npx @deepseek-ai/dsh web
```

Open the printed URL, add a workspace, and configure a model under **Settings → Models**. A [DeepSeek API key](https://platform.deepseek.com/) works out of the box; other providers and custom OpenAI-compatible endpoints are also supported.

Try this first task:

> Summarize this repository, identify the safest useful improvement, implement it, and verify the result.

The Web UI guide covers [first-run setup](docs/user/guide/index.md) and [model providers](docs/user/guide/providers.md). Pass `--no-open` when the process should print the URL without opening a browser.

<a id="run-from-source"></a>

### Run from source

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## Go further

- [Understand the architecture](docs/architecture.md)
- [Develop a plugin](docs/user/develop/basic/index.md)
- [Use CLI and automation modes](apps/cli/README.md)
- [Drive DSH from Python](docs/user/guide/python-sdk.md)
- [Browse the package map](packages/README.md)

## Community and support

- Share ideas and report bugs in [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to plugin repositories.
- Join the [DeepSeek Harness Discord community](https://discord.gg/Ycq5dCaS4).
- Chinese-speaking users can also join the DeepSeek Harness WeCom group by adding the assistant below and completing the survey.

<table>
  <thead>
    <tr>
      <th align="center">WeCom assistant</th>
      <th align="center">Group survey</th>
      <th align="center">WeChat official account</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness WeCom assistant QR code" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness group survey QR code" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness WeChat official account QR code" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [development guide](docs/development.md). Agents should follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE). Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
