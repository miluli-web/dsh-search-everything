[English](README.en.md) | [中文](README.md)

# dsh-search-everything

One web-search provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that routes across **AnySearch**, **Firecrawl**, **TinyFish**, and **DeepSeek Search** — registered into `ctx.web` as `search-everything`.

> Adapted from [`dsh-all-search`](https://github.com/RetiredPhysicist/dsh-plugins/tree/main/packages/dsh-all-search) (MIT, by Alexandre@AI) for DeepSeek Harness **0.2.2-rc.1**. Renamed, re-scoped to the `search-everything` provider id, and shipped with a bundle patch that makes it the active search backend.

## Why a patch override

`dsh-base` pins `ctx.web` with `searchProvider: deepseek-official`. A pinned provider is never replaced by automatic selection, so a plugin that only registers another provider would stay unused. This bundle therefore also overrides the `web` row:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: search-everything
    fetchProvider: http
```

`fetchProvider: http` is restated because a patch replaces the whole config of the targeted row. A later user-level `web` row (for example written by Settings → Web search) wins over this bundle layer.

## Install

From npm:

```sh
dsh plugin --profile desktop add dsh-search-everything
```

Or from a local checkout (installed as a junction over the folder):

```sh
dsh plugin --profile desktop add ./dsh-search-everything
```

or, from this workspace, install the directory through `plugin_manager` (`install_bundle`). Then configure keys on the plugin row in the profile's `cordis.patch.yml`:

```yaml
- id: search-everything
  name: dsh-search-everything
  config:
    api_key: <your anysearch key>
```

## Configuration

| key | required | meaning |
|---|---|---|
| `api_key` | - | AnySearch key. When set, queries use the AnySearch gateway. |
| `base_url` | - | AnySearch MCP endpoint override (default `https://api.anysearch.com/mcp`) |
| `firecrawl_api_key` | - | Optional Firecrawl key (Bearer quota). Also enables the Developer Index branch for repo/issue/PR/skill queries when AnySearch is configured. |
| `tinyfish_api_key` | - | Optional TinyFish key. Enables free news/academic search and full-browser fetch. |
| `tinyfish_fetch` | - | Register TinyFish as the fetch provider (default `false`; the host supplies local HTTP fetch). |
| `deepseek_api_key` | - | Optional DeepSeek key. Enables DeepSeek Search inside the provider (`POST /v1/tools/search`). |
| `deepseek_fetch` | - | Register DeepSeek as a fetch provider (default `false`). |

Without an AnySearch key the provider still reports `available() = true` and searches Firecrawl keyless. Hosts that share an egress IP (NAT, CI) share those daily credits; set `firecrawl_api_key` for a private quota.

Search routing: developer queries → Developer Index → TinyFish (news/academic) → DeepSeek → AnySearch → TinyFish → Firecrawl. Every key is optional, so any subset of providers still answers queries.

## Privacy

- Keys live only in your config file — never logged.
- With `api_key`, only your query and result count go to the AnySearch gateway.
- Without `api_key`, the query goes to Firecrawl `/v1/search`.
- With `tinyfish_api_key`, TinyFish keeps every query and fetched URL under its `/usage` endpoint. Treat it as a non-private retrieval layer.
- With `deepseek_api_key`, queries go to DeepSeek `tools/search` (and optionally `tools/fetch`); same privacy posture as the DeepSeek chat API.

## Files

| file | role |
|---|---|
| `dist/index.js` | runtime plugin (ESM, no build step needed) |
| `src/index.ts` | TypeScript source of the same implementation |
| `cordis.patch.yml` | bundle patch: plugin row + `web` row override |
| `locale/en.json`, `locale/zh.json` | Plugin Manager display metadata (Chinese detail document pointer included) |
| `icon.svg` | plugin icon |

## License

MIT. Original work Copyright (c) 2026 Alexandre@AI; adaptation maintains the same grant. See `LICENSE`.
