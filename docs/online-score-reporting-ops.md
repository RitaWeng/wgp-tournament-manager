# 線上成績回報 — 驗收與部署紀錄（維運手冊）

> 2026-07-07 完成。本文件記錄「從功能分支審查到後端正式上線」的完整過程與結果，
> 以及日後維運需要知道的一切。設計規格見 `online-score-reporting-plan.md`。

---

## 1. 正式環境資訊（速查）

| 項目 | 值 |
|------|-----|
| 後端網址 | `https://wgp-score-relay.rita6656.workers.dev` |
| Cloudflare 帳號 | rita6656@gmail.com（免費方案） |
| workers.dev 子網域 | `rita6656.workers.dev`（全帳號共用，一次性註冊） |
| D1 資料庫 | `wgp_score_relay`，region APAC，database_id `c1defc9f-e9a1-429b-8a80-0390ef9c8aff`（已寫入 `backend/wrangler.toml`，非機密） |
| retention cron | 每日 UTC 19:17（台北 03:17）自動刪 7 天前的賽事 |
| CORS allowlist | `https://ritaweng.github.io` + localhost:8080（開發用） |
| rate limit | 每 IP / 每 token 各 120 次/分 |
| 建立金鑰 SETUP_KEY | wrangler secret（**不在 repo、只在 rita 腦中與主控端 localStorage**）；「建立線上賽事」時要填。忘記就 `npx wrangler secret put SETUP_KEY` 重設一個新的 |

---

## 2. 2026-07-07 做了什麼（時間序）

### 2.1 分支審查（`feat/online-score-reporting`，7 個 commit）

逐檔審查了後端全部原始碼（`backend/src/*`、schema、wrangler.toml）、前端
`sync.ts` / `JudgePage.tsx` / `TournamentManager.tsx` diff / `index.tsx`，
確認與核准規格（plan 文件 §4 安全設計、§9 不變式）一致。實際跑過的驗證：

| 驗證 | 結果 |
|------|------|
| 後端整合測試（`backend/ npm test`，22 項） | ✅ 全過（修 Windows 相容後，見 2.2） |
| E2E 演練（`node backend/test/e2e-online.mjs`，17 步） | ✅ 全過（主控 + iPhone13 + Pixel7 模擬，含 token 外洩、斷網、後端掛掉退手動） |
| 演算法回歸（`npm run test:regression`） | ✅ 北區＋南區 fixture 全過；`swissPairing.js` 確認零改動 |
| 前端 production build | ✅ |

審查發現的**次要問題**（不擋上線，留待 Phase 5 迭代）：

1. retention cron 的日期比較有格式不一致（ISO `T` vs SQLite 空格），會提早最多約 5 小時刪資料——無實害。
2. `POST /events` 無認證，理論上可被灌垃圾賽事（有 rate limit 擋，風險低）。
   —— **已於 2026-07-08 補上 SETUP_KEY 建立金鑰**（wrangler secret），此項已解決。
3. 主控端「拒絕採計」的 revision 決定只存在記憶體，重新整理頁面後同一筆會再跳一次確認窗。

### 2.2 修正 commit `ddf3a2e`（審查中發現並修復）

- **測試腳本 Windows 相容**（`api.test.mjs`、`e2e-online.mjs`，不碰產品碼）：
  - `spawn('npx', …)` 在 Windows 會 ENOENT → 改以 node 直接執行
    `node_modules/wrangler/bin/wrangler.js`（Mac/Linux 行為等價）。
  - `proc.kill()` 在 Windows 收不掉 wrangler 的 workerd 子程序，殘留程序佔住測試埠，
    造成後續測試打到舊伺服器（rate limit 測項因此誤判失敗）→ Windows 改用
    `taskkill /F /T` 殺整個程序樹。
  - `python3` → 依平台選 `python`（Windows）/`python3`；`rmSync` 加 retry
    （Windows 檔案釋放較慢）。
- **裁判頁輪詢 4 → 10 秒**（`JudgePage.tsx`，唯一的產品碼改動）：
  每次輪詢伺服器都寫一筆 `last_seen`（D1 免費額度 10 萬寫/日）。
  4 秒 × 十幾桌 × 整天 ≈ 9.4 萬寫，貼著上限；10 秒 ≈ 3.7 萬，留足餘裕。
  **勿再調快**。改完後 E2E 17 步重跑全過（時序未受影響）。

### 2.3 Merge 進 develop

`feat/online-score-reporting` 基於 develop 最新 commit 切出、無分岔，
fast-forward 併入 develop（`c1cf006..ddf3a2e`）並推上 GitHub。

### 2.4 Cloudflare 部署（一次性設定）

實際執行的步驟與踩到的坑：

1. **註冊帳號**：https://dash.cloudflare.com/sign-up （免費、不需信用卡）。
2. **登入 CLI**：`cd backend && npx wrangler login`（開瀏覽器授權）。
3. **建 D1**：`npx wrangler d1 create wgp_score_relay` → 回傳 database_id，
   填入 `wrangler.toml`（binding 名稱維持程式碼用的 `DB`，不要照它回的片段改名）。
4. **建表**：`npx wrangler d1 execute wgp_score_relay --remote --file=./schema.sql`。
   注意：wrangler 4.x 對 `--file` **不會跳確認**、直接執行；輸出 `num_tables: 5` 即成功。
5. **部署**：`npm run deploy`。
   - 【坑】第一次會失敗：帳號要先有 workers.dev 子網域。錯誤訊息給的 onboarding
     連結 404（Cloudflare 改版），實際位置：Dashboard → Workers & Pages →
     右側 Account Details → Subdomain。本帳號註冊為 `rita6656`。
   - 【坑】部署警告 `workers_dev` / `preview_urls` 未設定 → 已在 `wrangler.toml`
     明寫 `workers_dev = true`（我們需要公開網址）、`preview_urls = false`
     （用不到版本預覽網址，少一個對外入口），警告消失。
6. **驗證**：`/health` 回 `{"ok":true,"db":"up"}`；未知路由 404；無 token 打 API 401。

---

## 3. 日後維運

### 每次比賽（不用碰 Cloudflare）

1. 主控端（GitHub Pages 開）→「線上回報」→ 貼後端網址 → 建立線上賽事。
2. 「列印 QR 卡」→ 交計分台保管，裁判報到時當面掃碼。
3. 每輪抓對後按「發佈桌次」；算分自動鎖定該輪。
4. 賽後按「結束線上賽事」立即刪伺服器資料（忘了按也有 7 天自動清除兜底）。

**發佈桌次後有人棄賽**：當桌直接手動點對手勝（判輸）＋按該隊「棄賽」即可——
棄賽從下一輪生效，不需要中途重發佈。賽前棄賽（R1 抓對前按）該隊整場不入配對池。

### 後端程式碼有改動時

```bash
cd backend
npm test          # 22 項整合測試（Windows/Mac 都能跑）
npm run deploy    # 重新部署（需已 wrangler login）
```

schema 有改動時需另外 `npx wrangler d1 execute wgp_score_relay --remote --file=./schema.sql`
（現有 schema 全部 `IF NOT EXISTS`，重跑安全；但改既有欄位需自行寫 migration）。

### 換電腦部署

repo clone 下來 → `cd backend && npm install && npx wrangler login` → 即可 deploy。
database_id 已在 `wrangler.toml`，不需重建資料庫。

### 免費額度（目前用量遠低於上限）

| 資源 | 免費上限/日 | 預估賽事日用量 |
|------|------------|---------------|
| Workers 請求 | 100,000 | ~2 萬（主控 4 秒輪詢＋裁判 10 秒輪詢） |
| D1 寫入 | 100,000 | ~4 萬（主要是裁判輪詢的 last_seen） |
| D1 讀取 | 5,000,000 | 遠低於 |

裁判頁輪詢 10 秒是配合 D1 寫入額度算出來的，**調快前先重算上表**。

---

## 4. 剩餘待辦

### 2026-07-10 已上線：SETUP_KEY 建立金鑰（防額度濫用）

程式碼 2026-07-08 完成（後端 24 項測試、E2E 18 步全過），2026-07-10 部署完成：

1. ✅ 後端部署（`cd backend && npm run deploy`），含金鑰驗證的新版 Worker 上線
2. ✅ rita 執行 `npx wrangler secret put SETUP_KEY` 設定密語
   （`npx wrangler secret list` 確認 SETUP_KEY 存在；密語不在 repo、不在對話紀錄）
3. ✅ 版號 1.4.3（commit `ed15e3a`、tag `v1.4.3`），preview 已部署並確認出 1.4.3
4. ✅ 401 驗證通過：`POST /events` 不帶金鑰、帶錯誤金鑰皆回 `401 setup_key_required`
   （擋在寫入資料庫之前），`/health` 正常

5. ✅ rita 於 preview 實測 UI 成功路徑：填正確金鑰建立賽事成功，金鑰已記在
   主控端瀏覽器 localStorage，之後不用重填。**本項結案。**

維運備忘：忘記或想更換密語就再 `npx wrangler secret put SETUP_KEY` 一次
（舊的直接被覆蓋、立即生效，不用重新部署）；主控端下次建立賽事會 401 提示，
重填新密語即可。金鑰只在建立賽事時檢查，進行中賽事的 admin／table token 不受影響。

### 其他待辦

- [x] 前端 develop → gh-pages preview 部署（主控端需從 GitHub Pages 開，QR 卡網址才正確）——已完成，preview 現為 v1.4.3（2026-07-10）
- [ ] 真手機實測（iOS Safari + Android Chrome 各走完一輪回報）——Phase 3 驗收的最後一項
- [ ] 小型練習賽試跑（Phase 5），收集裁判回饋
- [ ] §2.1 列的三個次要問題，Phase 5 迭代時處理
