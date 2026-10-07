# dsh-favorites-digest

[中文](https://github.com/kittimzhe/dsh-favorites-digest/blob/main/README.zh.md) | English

[![CI](https://github.com/kittimzhe/dsh-favorites-digest/actions/workflows/test.yml/badge.svg)](https://github.com/kittimzhe/dsh-favorites-digest/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/kittimzhe/dsh-favorites-digest/blob/main/LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that exports **your own** Douyin and Xiaohongshu web favorites into Markdown (topic groups + optional LLM digest). It reuses a logged-in Playwright / Chrome session. Do not use it on anyone else's account.

## Install

Requires Node.js 20 or 22 and a Harness profile that mounts the `commands` and `sessionQuery` services (the official `web` / `agent` profiles do).

```sh
dsh plugin --profile web add dsh-favorites-digest
npx playwright install chromium
```

Local checkout:

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-favorites-digest
```

Then in any session:

```text
/favorites login
/favorites
```

Files land in `<session cwd>/dsh-favorites/favorites-<timestamp>.md` (and `.json`). The browser profile is stored at `~/.dsh/favorites-digest/profile`.

## Commands

| Input | Result |
| --- | --- |
| `/favorites login` | Open Douyin + Xiaohongshu and wait until the web session is logged in |
| `/favorites` / `/favorites run` | Collect + write Markdown/JSON (LLM digest if an API key is set) |
| `/favorites collect` | Collect only (still writes the Markdown catalog, no LLM call) |
| `/favorites digest` | Rebuild Markdown from the latest JSON in the output dir |
| `/favorites --platform xiaohongshu` | One site |
| `/favorites --limit 50` | Cap per site (debug) |
| `/favorites --likes` | Also export Douyin 喜欢 |
| `/favorites --cdp-url http://127.0.0.1:9222` | Attach to an already-logged-in Chrome |
| `/favorites --no-llm` | Skip the digest section |
| `/favorites --out /path` | Output directory |

Same as other `ctx.commands` handlers: results stay off the model transcript (zero tokens).

## Optional model tool

Off by default. Set `exposeTool: true` on the plugin row to register `favorites_digest` for the agent.

```yaml
- insert:
    - id: favorites-digest
      name: dsh-favorites-digest
      config:
        exposeTool: true
```

## Optional LLM digest

If `OPENAI_API_KEY` or `DEEPSEEK_API_KEY` is set, `/favorites run` appends an AI 综述 section. Compatible OpenAI-style bases work via `OPENAI_BASE_URL` / `OPENAI_MODEL`. Topic grouping still works with no key.

## How collection works

1. Open the logged-in 收藏 surfaces (Xiaohongshu profile → 收藏 → 笔记; Douyin `/user/self?showTab=favorite_collection`).
2. Listen to the page's own list JSON **and** scrape visible cards.
3. Scroll until the count stops growing.

Site redesigns can break selectors. Captchas must be solved in the opened window.

## Development

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run bundle
```
