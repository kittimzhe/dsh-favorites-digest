# Contributing / 贡献指南

```sh
npm ci && npx playwright install chromium && npm run typecheck && npm test && npm run bundle
```

Behavior changes need tests. Keep `README.md` and `README.zh.md` in sync.

Collectors live in `src/collectors/` (Playwright). Parsing lives in `src/ingest.ts` so list-JSON fixtures can be tested without a browser.
