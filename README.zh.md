# dsh-favorites-digest

[English](https://github.com/kittimzhe/dsh-favorites-digest/blob/main/README.md) | 中文

[![CI](https://github.com/kittimzhe/dsh-favorites-digest/actions/workflows/test.yml/badge.svg)](https://github.com/kittimzhe/dsh-favorites-digest/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/kittimzhe/dsh-favorites-digest/blob/main/LICENSE)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：用**你自己的**抖音 / 小红书 web 登录态读取收藏，写成带主题分组（和可选 AI 综述）的 Markdown。请只导出自己的收藏。

## 安装

需要 Node.js 20 或 22，以及挂载了 `commands` 与 `sessionQuery` 服务的 Harness profile（官方 `web` / `agent` 均可）。

```sh
dsh plugin --profile web add dsh-favorites-digest
npx playwright install chromium
```

本地开发目录：

```sh
dsh plugin --profile web add link:/绝对路径/dsh-favorites-digest
```

任意会话里：

```text
/favorites login
/favorites
```

产物在 `<会话 cwd>/dsh-favorites/favorites-<时间戳>.md`（另有 `.json`）。浏览器登录态保存在 `~/.dsh/favorites-digest/profile`。

## 命令

| 输入 | 结果 |
| --- | --- |
| `/favorites login` | 打开抖音和小红书，等到 web 端登录完成 |
| `/favorites` / `/favorites run` | 抓取并写出 Markdown/JSON（配置了 API key 时带综述） |
| `/favorites collect` | 只抓取（仍写目录 Markdown，不调大模型） |
| `/favorites digest` | 用输出目录里最近一份 JSON 重写 Markdown |
| `/favorites --platform xiaohongshu` | 只跑一个平台 |
| `/favorites --limit 50` | 每平台上限（调试） |
| `/favorites --likes` | 抖音同时导出「喜欢」 |
| `/favorites --cdp-url http://127.0.0.1:9222` | 挂到已经登录的 Chrome |
| `/favorites --no-llm` | 不要综述 |
| `/favorites --out /path` | 输出目录 |

与其他 `ctx.commands` 一样，结果不进模型历史，零 token。

## 可选 model tool

默认关闭。在插件行设置 `exposeTool: true` 后，会注册给模型用的 `favorites_digest`。

```yaml
- insert:
    - id: favorites-digest
      name: dsh-favorites-digest
      config:
        exposeTool: true
```

## 可选 AI 综述

设置 `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY` 后，`/favorites run` 会追加「AI 综述」。也可用 `OPENAI_BASE_URL` / `OPENAI_MODEL` 指向兼容接口。没有 key 时仍有关键词主题分组。

## 抓取方式

1. 打开已登录的收藏页（小红书：我 → 收藏 → 笔记；抖音：`/user/self?showTab=favorite_collection`）。
2. 监听页面自己发出的列表 JSON，并用可见卡片补齐。
3. 滚动直到数量不再增加。

站点改版可能导致选择器失效。验证码请在弹出窗口里手动过。

## 开发

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run bundle
```
