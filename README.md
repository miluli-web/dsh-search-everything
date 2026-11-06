[中文](README.md) | [English](README.en.md)

# dsh-search-everything

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的网页搜索提供方，在 **AnySearch**、**Firecrawl**、**TinyFish** 与 **DeepSeek Search** 之间自动路由，以 `search-everything` 为 id 注册到 `ctx.web`。

> 基于 [`dsh-all-search`](https://github.com/RetiredPhysicist/dsh-plugins/tree/main/packages/dsh-all-search)（MIT，作者 Alexandre@AI）适配 DeepSeek Harness **0.2.2-rc.1**：重命名、把 provider id 收敛为 `search-everything`，并附带让它真正接管搜索后端的 bundle patch。

## 为什么需要 patch 覆盖 `web` 行

`dsh-base` 把 `ctx.web` 固定在 `searchProvider: deepseek-official`。一旦固定，自动选择不会再换 provider，因此只注册新 provider 的插件不会被使用。所以本 bundle 同时覆盖 `web` 行：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: search-everything
    fetchProvider: http
```

`fetchProvider: http` 必须一起写出，因为 patch 会整体替换目标行的 config。之后在设置页（Settings → Web search）写入的用户级 `web` 行优先级更高，会覆盖本 bundle 层。

## 安装

从 npm 安装：

```sh
dsh plugin --profile desktop add dsh-search-everything
```

或从本地目录安装（以 junction 方式链接目录）：

```sh
dsh plugin --profile desktop add ./dsh-search-everything
```

或在当前工作区用 `plugin_manager` 的 `install_bundle` 安装目录。然后在 profile 的 `cordis.patch.yml` 插件行上配置密钥：

```yaml
- id: search-everything
  name: dsh-search-everything
  config:
    api_key: <你的 anysearch 密钥>
```

## 配置项

| 配置 | 必填 | 含义 |
|---|---|---|
| `api_key` | - | AnySearch 密钥。设置后走 AnySearch 网关。 |
| `base_url` | - | AnySearch MCP 端点覆盖（默认 `https://api.anysearch.com/mcp`） |
| `firecrawl_api_key` | - | 可选 Firecrawl 密钥（Bearer 配额）。配置 AnySearch 时还会为仓库/issue/PR/skill 类查询启用 Developer Index。 |
| `tinyfish_api_key` | - | 可选 TinyFish 密钥：免费新闻/学术搜索与全浏览器抓取。 |
| `tinyfish_fetch` | - | 把 TinyFish 注册为抓取提供方（默认 `false`，宿主自带本地 HTTP 抓取）。 |
| `deepseek_api_key` | - | 可选 DeepSeek 密钥：在 provider 内部启用 DeepSeek Search（`POST /v1/tools/search`）。 |
| `deepseek_fetch` | - | 把 DeepSeek 注册为抓取提供方（默认 `false`）。 |

没有任何密钥时，provider 仍报告 `available() = true`，走 Firecrawl 免密钥搜索。NAT/CI 等共享出口 IP 的环境会共享每日额度；要独立额度请配置 `firecrawl_api_key`。

搜索路由：开发者查询 → Developer Index → TinyFish（新闻/学术）→ DeepSeek → AnySearch → TinyFish → Firecrawl。每个密钥都可选，任意组合都能出结果。

## 隐私

- 密钥只存在配置文件里，不写日志。
- 配置 `api_key` 时，只有查询词和结果数量发往 AnySearch 网关。
- 未配置 `api_key` 时，查询发往 Firecrawl `/v1/search`。
- 配置 `tinyfish_api_key` 时，TinyFish 会在其 `/usage` 端点保留全部查询与抓取 URL，应视为非私有检索层。
- 配置 `deepseek_api_key` 时，查询发往 DeepSeek `tools/search`（可选 `tools/fetch`），隐私属性与 DeepSeek 对话 API 相同。

## 文件

| 文件 | 作用 |
|---|---|
| `dist/index.js` | 运行时插件（ESM，无需构建） |
| `src/index.ts` | 同一实现的 TypeScript 源码 |
| `cordis.patch.yml` | bundle patch：插件行 + `web` 行覆盖 |
| `locale/en.json`、`locale/zh.json` | 插件管理器的展示元数据（含中文详情文档指向） |
| `icon.svg` | 插件图标 |

## 许可证

MIT。原始作品 Copyright (c) 2026 Alexandre@AI，适配版沿用同一授权，见 `LICENSE`。
