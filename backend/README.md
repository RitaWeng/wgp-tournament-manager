# wgp-score-relay — 線上成績回報後端

比賽時各桌裁判用手機回報勝負的**成績中繼站**（Cloudflare Workers + Hono + D1）。
完整規格（架構決策、安全設計、API、分階段計劃）見
[`docs/online-score-reporting-plan.md`](../docs/online-score-reporting-plan.md)。

重要定位：本服務**不是** system of record——權威資料永遠在主控端
localStorage 與賽後 Excel/JSON 匯出；後端只暫存當場賽事的配對／回報／
鎖定／稽核，賽後即刪（另有 7 天 retention 保險）。

## 本地開發（不需 Cloudflare 帳號）

```bash
cd backend
npm install
npm run db:local     # 把 schema.sql 套進本地 D1（Miniflare SQLite）
npm run dev          # wrangler dev，預設 http://localhost:8787
curl http://localhost:8787/health   # → {"ok":true,...}
```

## 正式部署前置（由 rita 操作，一次性）

1. `wrangler login`
2. `wrangler d1 create wgp_score_relay` → 把 `database_id` 填進 `wrangler.toml`
3. `wrangler d1 execute wgp_score_relay --remote --file=./schema.sql`
4. `npm run deploy`
