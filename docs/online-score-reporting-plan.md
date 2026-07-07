# 線上成績回報後端 — 規劃文件

> **狀態：已驗收、後端已部署上線（2026-07-07）**
> 驗收過程、部署紀錄與維運手冊（正式網址、Cloudflare 帳號資訊、每次比賽的操作、
> 免費額度預算）見 **`online-score-reporting-ops.md`**。
> （2026-07-06 擬定並兩次修訂；2026-07-07 rita 核准後 commit `1f8ce27`，同日完成 Phase 0–4 實作。）
> 本文件即執行規格。**實作結果與驗證方式見第 8.5 節「實作紀錄」**；
> 兩次修訂：① 紅隊推演——QR 由桌牌改為裁判隨身卡＋硬性裝置綁定；
> ② 依 rita 提議簡化——QR 改由**計分台保管**、硬綁定改為**軟性裝置偵測**（見 4.1）。
> 執行前請先讀最後一節「給執行者的注意事項」。

---

## 1. 目的與背景

比賽進行時，讓**各桌裁判用手機直接輸入該桌勝負結果**，主控端即時收到並彙整，取代目前「裁判舉手回報 → 主控端手動點選」的流程。

### 現況（2026-07 v1.3.1）

- 純前端 SPA：React 18 + TypeScript + Tailwind，Webpack 5 打包，部署 GitHub Pages。
- 所有賽事狀態存於主控電腦瀏覽器 localStorage；無任何伺服器端。
- 抓對／算分邏輯在 `tournament-menager/src/lib/swissPairing.js`，有回歸測試
  （`npm run test:regression`，以歷年比賽 Excel 為 ground truth，吻合率 100%）。
- 正式紀錄 = 賽後匯出的 Excel／JSON 備份檔。

---

## 2. 架構決策

### 決策：主控端維持「唯一權威」，後端只做「成績中繼站」

```
┌─────────────┐  發佈桌次/鎖定    ┌──────────────┐   掃 QR 看對局/送結果   ┌──────────┐
│ 主控端(現有) │ ───────────────▶ │  輕量後端 API │ ◀──────────────────── │ 裁判手機  │
│ localStorage │ ◀─────────────── │  (成績中繼站) │                        │ (新頁面)  │
└─────────────┘  輪詢收裁判成績    └──────────────┘                        └──────────┘
```

後端**完全不懂瑞士制**：不抓對、不算分、不排名。它只保管「本輪配對、裁判回報、輪次鎖定狀態、稽核紀錄」。

### 理由

| 考量 | 說明 |
|------|------|
| 演算法風險 | 抓對／算分邏輯已通過歷年賽果回歸驗證；搬上後端等於重寫再驗證，風險高、收益低 |
| 離線韌性 | 會場網路不可靠。主控端保持權威，後端掛掉隨時退回現行手動輸入，比賽不中斷 |
| 規模 | 賽事約 20–30 隊（10–15 桌），每輪十幾筆成績；輪詢 3–5 秒一次已足夠 |
| 改動範圍 | 主控端只加一個同步模組；`swissPairing.js` 完全不動 |

### 捨棄的替代方案

| 方案 | 不採用原因 |
|------|-----------|
| 全後端重寫（賽事狀態搬伺服器） | 重寫已驗證的演算法；離線即癱瘓；維運負擔大 |
| Firebase / Supabase (BaaS) | 安全規則（RLS）寫錯難察覺；vendor lock-in；此規模自寫 API 更透明 |
| 會場筆電自架 server 走區網 | GitHub Pages 是 HTTPS，呼叫 http 區網後端會被 mixed content 擋掉；IP／憑證麻煩 |
| WebRTC 手機直連主控瀏覽器（零儲存） | 手機 4G 的 NAT 穿透不穩、仍需 signaling server，複雜度高可靠度低 |
| WebSocket 即時推播 | 此規模是過度設計；輪詢簡單、可靠、好除錯 |

---

## 3. 技術選型

| 項目 | 選型 | 理由 |
|------|------|------|
| 後端 runtime | **Cloudflare Workers + Hono** | 免費額度遠超需求、內建 HTTPS、零維運、冷啟動快 |
| 後端儲存 | **Cloudflare D1（SQLite）** | serverless、免備份免遷移維運；幾張表配 SQL 好除錯 |
| 裁判頁面 | **同 repo hash route（`#/judge`）** | 跟 GitHub Pages 一起部署，不多養一個前端 |
| 即時性 | **輪詢（polling，3–5 秒）** | 見上表 |
| 認證 | **能力型 token（capability token）+ QR code** | 裁判是臨時人員，不做帳號系統 |

### 儲存定位（重要）

| 角色 | 在哪 | 性質 |
|------|------|------|
| **權威資料（system of record）** | 主控機 localStorage + 賽後 Excel/JSON 存檔 | 與現在完全相同，**不變** |
| **後端 D1** | Cloudflare | **暫存中繼**：只放當場賽事的配對／回報／鎖定／稽核，賽後即刪 |

- **不是** Postgres 式的常駐資料庫：無 DB server、無備份需求、無遷移維運。
- 一場賽事資料量約數十 KB。
- 賽後由主控端按「結束賽事」刪除伺服器資料，並設 **7 天自動清除**（retention）雙保險。
- 為何不能零儲存：裁判送出成績與主控端輪詢取走之間有時間差，這段期間成績必須落地；
  純記憶體（serverless 程序隨時可能回收）會在比賽中途掉成績，不可接受。

---

## 4. 安全設計

### 4.1 認證與授權模型

```
建立賽事時，後端產生：
├── 1 把 admin token  → 只存主控端 localStorage；管發佈、鎖定、覆寫、結束賽事
└── N 把 table token  → 每桌一把，印成 QR 卡，整場比賽由「計分台」保管
```

- **QR 卡不上桌、不隨身帶，全程放計分台**：裁判報到時在計分台人員面前掃碼，
  token 隨即存入裁判手機，QR 卡收回保管。之後要拿到 token 只剩兩條路——
  在有人盯著的計分台掃碼，或直接拿走裁判的手機；桌上、走道上沒有任何可掃的東西。
  （token 就是憑證——初版印在桌牌等於把鑰匙放在選手面前，紅隊推演發現後修正。）
- 手機沒電／換機／瀏覽器清資料：回計分台重掃即可，**免綁定、免重設流程**。
- QR 內容：`https://ritaweng.github.io/wgp-tournament-manager/#/judge?e=<eventId>&t=<tableToken>`。
  token 放 URL fragment（`#` 之後），不進任何伺服器 access log；
  裁判頁載入後立即把 token 收進 localStorage 並以 `history.replaceState` 清掉網址，
  避免留在手機瀏覽歷史。
- **軟性裝置偵測**（取代硬性綁定）：裁判頁首次啟動時自產隨機 `device_id`，
  隨每次請求送出。伺服器**不拒絕**新裝置（回計分台重掃本來就合法），
  但同桌 device_id 一旦變化即記入稽核並在主控端標示，
  操作者可對照「該桌裁判剛剛是否真的來過計分台」。
- 裁判掃碼後只能：看**自己這桌**當前輪次的對局、送**自己這桌**的結果。
  一位裁判管多桌時在計分台掃多張卡（裁判頁支援多 token 切換為 nice-to-have）。
- token 規格：128-bit 隨機值；伺服器只存 SHA-256 雜湊（資料庫外洩也拿不到可用 token）；
  賽事結束即失效。eventId 亦為隨機值，不可循序猜測。
- **admin token 絕不出現在裁判 QR**，權限完全分離。

### 4.2 伺服器端強制驗證（不信任前端）

| 威脅 | 防護 |
|------|------|
| **選手／旁人取得 QR** | QR 卡全程由計分台保管，只在報到時於計分台人員面前掃碼；桌上、裁判身上都沒有可掃的 token |
| token 仍外洩（掃碼瞬間被偷拍、裁判手機被拿走） | 軟性偵測：同桌 device_id 變化記稽核＋主控端標示；配合 revision 警示，翻改成績必留痕跡 |
| 越權提交（改別桌） | token 綁桌次；提交的 match 必須屬於該桌、該輪、且該輪為 open |
| 已算分輪次被改 | 主控端「算分」同步鎖定該輪；伺服器拒收 locked 輪次提交；「解除鎖定」才重開 |
| 成績遭翻改（鎖定前的更正窗口） | 更正（result 已存在又被改）在主控端**醒目標示為 revision，需操作者確認**才採計 |
| 重複提交／手滑連按 | 提交帶版本號（optimistic versioning），idempotent |
| 暴力猜 token | 每 IP + 每 token rate limit；token 空間 2^128 |
| 輸入竄改 | 伺服器驗證 `winner ∈ {1, 2}`，其餘欄位一律不收 |
| 跨站呼叫 | CORS allowlist：僅 `https://ritaweng.github.io`（Bearer header 授權，無 cookie，CSRF 不適用） |
| 傳輸竊聽 | 全程 HTTPS（平台內建） |
| token 留在手機瀏覽歷史 | 裁判頁載入即收進 localStorage 並清掉網址（見 4.1） |

### 4.3 稽核、衝突、個資

- **append-only 稽核紀錄**：每筆提交記 token（桌號）、device_id、時間、內容、來源 IP，
  不可修改；主控端可查「異動紀錄」；同桌 device_id 變化也入稽核並於主控端標示。
- **裁判提交 = 提案**：主控端合併時標示來源（裁判回報 vs 主控手動）；同桌兩邊都有動作時
  跳衝突提示由裁判長裁決，不默默覆蓋。**revision（已送出結果又被更改）一律醒目警示、
  需操作者確認**，即使 token 外洩翻改成績也會被人看到。
- **個資最小化**：伺服器只存桌號、隊伍名稱、勝負（參賽者多為學生）；賽後刪除見第 3 節 retention。

---

## 5. 比賽日流程

1. **賽前**：主控端「建立線上賽事」→ 列印各桌 QR 卡、**集中放計分台保管** →
   裁判報到時在計分台掃碼（token 進手機，卡收回）→ 主控端確認各桌都已上線。
2. **每輪抓對後**：主控端按「發佈桌次」→ 上傳本輪配對。
3. **裁判**：打開裁判頁（整天只需報到時掃一次碼；手機沒電換機則回計分台重掃）→
   顯示「第 N 輪：學校A vs 學校B」→ 點大按鈕【A 勝】→ 確認 → 完成。
   該輪鎖定前可自行更正（更正會在主控端跳 revision 警示）。
4. **主控端**：輪詢收成績，桌次表即時打勾；到齊後照現行流程「算分」→ 鎖定自動同步後端。
5. **網路掛掉**：退回現行手動點選；資料模型不變，零切換成本。

設計目標：**裁判 10 秒內完成一筆**。

---

## 6. 資料模型（D1）

| 表 | 欄位（要點） |
|----|-------------|
| `events` | id, name, admin_token_hash, status(active/closed), created_at |
| `tables` | event_id, table_no, token_hash, last_device_id(nullable), last_seen_at |
| `rounds` | event_id, round_no, status(open/locked), published_at |
| `pairings` | event_id, round_no, table_no, player1_id, player1_name, player2_id, player2_name, result(nullable), version, submitted_at |
| `audit_log` | event_id, ts, actor(token 桌號或 admin), action, payload_json, ip — **append-only** |

輪空（BYE，`player2 === 0`）不發佈給裁判頁，由主控端照現行邏輯處理。

## 7. API 草案

Admin（`Authorization: Bearer <admin token>`）：

| Method | Path | 用途 |
|--------|------|------|
| POST | `/events` | 建立賽事；回 admin token + 各桌 table token（僅此一次明文回傳） |
| POST | `/events/:id/rounds/:n/pairings` | 發佈本輪配對 |
| POST | `/events/:id/rounds/:n/lock` / `unlock` | 同步鎖定狀態 |
| GET | `/events/:id/results?since=<ts>` | 增量輪詢裁判回報 |
| GET | `/events/:id/tables/status` | 各桌上線狀態（last_seen、device_id 變化，開賽前檢查用） |
| POST | `/events/:id/close` | 結束賽事：token 失效、資料標記刪除 |

Judge（`Authorization: Bearer <table token>`）：

| Method | Path | 用途 |
|--------|------|------|
| GET | `/judge/pairing` | 取自己桌的當前 open 輪次對局 |
| POST | `/judge/result` | 提交結果 `{ matchId, winner, version }`，idempotent |

所有 Judge 請求附 table token 與裁判頁自產的 `device_id`
（device_id 僅供稽核與異常標示，授權仍以 token 為準，不做硬性驗證）。

---

## 8. 分階段執行計劃

### Phase 0：基礎建設（~0.5 天）✅ 2026-07-07
- [ ] Cloudflare 帳號 + wrangler CLI（帳號建立與登入由 rita 操作；本地開發不需要，部署前補即可）
- [x] repo 新增 `backend/` 目錄（monorepo）：Hono 專案骨架 + D1 schema + `wrangler dev` 本地環境
- **驗收**：`wrangler dev` 起得來，health check 回 200；既有前端 build 不受影響

### Phase 1：後端 MVP（~2 天）✅ 2026-07-07
- [x] Admin API 全套（見第 7 節，含各桌上線狀態；另加 GET audit 查稽核）
- [x] Judge API 全套
- [x] 第 4.2 節所有伺服器端驗證 + rate limit + CORS
- [x] 後端測試（`backend/npm test`：spawn 真實 wrangler dev + 本地 D1 的 HTTP 整合測試，21 項）
- **驗收**：測試涵蓋——越權提交被拒、locked 輪次提交被拒、重複提交 idempotent、
  錯誤 token 401、**同桌 device_id 變化入稽核並可由主控端查得**

### Phase 2：主控端整合（~2 天）✅ 2026-07-07
- [x] 新增同步模組 `tournament-menager/src/lib/sync.ts`（獨立檔案，不碰演算法）
- [x] UI：「線上回報」設定區（建立賽事）、「發佈桌次」按鈕（摺疊/展開兩處操作列）、
      成績回報即時標示（桌卡「裁判」來源標籤＋衝突/revision 確認對話框）
- [x] 裁判 QR 卡列印頁（qrcode 套件產 QR；卡面註記由計分台保管）＋各桌上線狀態一覽
      （在線/未上線/幾分前＋device_id 變化 ⚠ 標示）
- [x] 「算分／解除鎖定」掛上鎖定同步（fire-and-forget，失敗以非阻斷警告提示）
- **驗收**：後端不可用時，現有全部功能行為不變；`npm run test:regression` 全過

### Phase 3：裁判手機頁（~1.5 天）✅ 2026-07-07
- [x] `#/judge` route（`src/JudgePage.tsx`）：大字體、大按鈕、送出前確認、成功畫面
- [x] 首次啟動自產 `device_id`；token／device_id 收進 localStorage 並以
      `history.replaceState` 清掉網址中的 token
- [x] 斷線重試（橫幅＋自動恢復）＋「該輪已鎖定」明確提示（洽計分台）
- [x] 沿用現有主題 token（`.btn-*` / `--bg-*` / `--text-*`），行動版單欄大按鈕
      （以 Playwright iPhone 13 / Pixel 7 裝置模擬實測）
- **驗收**：手機實測（iOS Safari + Android Chrome）完整走完一輪回報

### Phase 4：安全強化與演練（~1 天）✅ 2026-07-07
- [x] 依 4.2 檢查表逐項實測（越權、鎖後提交、錯誤 token 401、輸入竄改、CORS、rate limit）
      —— `backend/npm test` 21 項；token 外洩情境（第二台裝置提交觸發 device_id 標示、
      revision 主控端跳警示）於前端 E2E 實測
- [x] 端到端演練：主控電腦 + 2 支模擬手機（iPhone 13 / Pixel 7），含刻意斷網再恢復、
      後端不可用退回手動 —— `backend/test/e2e-online.mjs`，14 步全過
- [x] 跑回歸測試確認演算法零影響（`npm run test:regression` 全過）
- [x] README 補「線上成績回報」章節
- **驗收**：演練整場走完；安全檢查表全數通過並留下實測紀錄

### Phase 5：實戰試用
- [ ] 小型練習賽試跑，主控端保留手動輸入備援
- [ ] 收集裁判回饋，回頭迭代

**總估：約 6–7 個工作天**。各 Phase 獨立驗收；Phase 2 完成後即使 Phase 3 未動工，現有系統也不受影響。

---

## 8.5 實作紀錄（2026-07-07）

Phase 0–4 於 2026-07-07 一日內完成，開發分支 `feat/online-score-reporting`（從 `develop` 切出）。
**尚未 push、未合併**，等 rita 驗收。Phase 5（實戰試用）尚未動工。

### commit 對照（每 Phase 一個 commit，未 push）

| Phase | commit | 摘要 |
|-------|--------|------|
| 規格核准 | `1f8ce27` | 本規劃文件進 develop |
| 0 骨架 | `8693c9c` | `backend/`：Hono + wrangler + D1 schema |
| 1 後端 API | `9648d29` | Admin/Judge API + 伺服器端驗證 + 21 項整合測試 |
| 2 主控端整合 | `f95c27a` | `sync.ts` + 線上面板/發佈/輪詢/revision/QR |
| 3 裁判手機頁 | `8bf3a0c` | `JudgePage.tsx`、`#/judge` route |
| 4 安全演練 | `7932637` | E2E 演練腳本 + README 章節 |

### 實際檔案結構

```
backend/                        # 成績中繼站（Cloudflare Workers）
├── src/
│   ├── index.ts                # Hono app、CORS、rate limit、/health、7 天 retention cron
│   ├── admin.ts                # Admin API（建立/發佈/鎖定/收成績/各桌狀態/稽核/結束）
│   ├── judge.ts                # Judge API（看自己桌/提交結果）
│   ├── auth.ts                 # token 雜湊、admin/judge 中介層、軟性裝置偵測
│   ├── ratelimit.ts            # 每 IP / 每 token 固定視窗限流
│   └── audit.ts                # append-only 稽核 INSERT
├── schema.sql                  # D1 五張表
├── wrangler.toml               # D1 binding、CORS vars、retention cron
├── test/
│   ├── api.test.mjs            # 後端整合測試（21 項）
│   └── e2e-online.mjs          # 前端端到端演練（Playwright，14 步）
└── README.md

tournament-menager/src/
├── lib/sync.ts                 # 主控端↔後端所有 HTTP（不碰 swissPairing.js）
├── JudgePage.tsx               # 裁判手機頁
├── qrcode.d.ts                 # qrcode 套件型別宣告
├── index.tsx                   # 加 #/judge hash route 分流
└── TournamentManager.tsx       # 加線上面板、發佈、輪詢、revision 確認、QR 列印
```

### 與原規劃的差異（都在原精神內，實作時的細節決定）

- **schema**：`tables` 表加 `device_change_count` 欄，讓主控端「各桌狀態」直接顯示裝置變更次數（原規劃只說「入稽核並標示」，這欄是實作它的方式）。
- **API 微調**：
  - 新增 `GET /events/:id/audit`（原規劃 4.3 說「主控端可查異動紀錄」但第 7 節未列端點，補上）。
  - `lock`/`unlock` 以單一路由 `/rounds/:n/:op{lock|unlock}` 實作（等價）。
  - `POST /judge/result` 的 body 是 `{ roundNo, winner, version }`（原規劃寫 `matchId`；改以「桌次由 token 決定 + roundNo」定位，裁判端不需知道 matchId，越權從結構上更不可能）。
  - `GET /results` 目前回全部已回報配對（規模小），`?since=` 參數已支援增量但主控端採全量冪等合併。
- **裁判頁隊名帶籤號**：沿用既有 `getPlayerName`，顯示「1. 隊伍1」。對裁判對照桌牌方便，若要純隊名可改。

### 驗證方式（可重跑）

1. **後端整合測試**（不需 Cloudflare 帳號、不需前端）：
   ```bash
   cd backend && npm install && npm test
   ```
   spawn 真實 `wrangler dev` + 本地 D1 打 HTTP，21 項全過：越權被拒、鎖定拒收、
   重複提交 idempotent、更正 revision、錯誤 token 401、權限分離、device_id 稽核、
   輸入竄改被拒、CORS allowlist、rate limit 429。

2. **前端端到端演練**（需先 build；playwright 在 backend devDependencies，
   首次跑需 `npx playwright install chromium` 下載瀏覽器）：
   ```bash
   cd tournament-menager && npm install && npm run build
   cd ../backend && npm install
   cd .. && node backend/test/e2e-online.mjs
   ```
   主控 + 2 支模擬手機（iPhone 13 / Pixel 7），14 步全過：建立賽事→掃碼→發佈→
   裁判回報→主控自動收（標「裁判」）→更正跳 revision 警示→算分鎖定→換輪→
   斷網恢復→**後端掛掉退回手動登錄照常**→token 外洩 device 標示→結束賽事憑證失效。

3. **回歸測試**（確認演算法零影響）：`cd tournament-menager && npm run test:regression` 全過；`swissPairing.js` 未動。

### 8.6 擴充：五組（ABCDE）對戰結果回報（2026-07-07 追加）

每桌的桌勝負實際由同桌五組（ABCDE）對戰結果決定（多數決），原始規劃只設計了裁判直接回報「桌勝方」。
應 rita 要求追加：裁判改為逐組回報 ABCDE 五組勝負，桌勝方由**伺服器**依多數決推導（不信任前端）；
單組平手需加賽分出，加賽結果需標記可辨識。

**資料結構**：`pairings` 表加 `groups_json`（五組 `[{winner:1|2, overtime:bool}]` 的 JSON），`result` 欄位語意不變（伺服器推導的桌勝方，非裁判直填）。

**API 變更**：`POST /judge/result` body 由 `{roundNo, winner, version}` 改為 `{roundNo, groups, version}`；伺服器驗證 groups 恰為 5 筆、每筆 `winner∈{1,2}` 且 `overtime` 為布林，推導 `wins1>=3 ? 1 : 2` 存回 `result`。`GET /events/:id/results` 回傳多帶 `groups_json`。

**裁判頁**：五組逐組點選勝方＋「加賽」切換鈕，未選滿擋送出，即時顯示自動判定的桌勝方比數（如「3:2 → 隊伍1 勝」）；確認/完成/鎖定畫面均附五組摘要。更正時以既有五組預填方便微調（如只補記加賽）。

**主控端**：桌卡新增五組比數 chip（hover 看各組明細），含加賽時標「·含加賽」；revision 確認對話框附五組比數方便操作者判斷；**桌勝方不變但組明細有更新（如補記加賽）時靜默套用、不跳警示**（伺服器稽核已留痕，不需每次都要操作者確認，否則裁判補記小地方也會一直跳窗）。

**Excel 匯出**：三處桌次表匯出（單輪／全部／選手成績內嵌桌次）都加 `A組`～`E組`（黑/白）+ `組數(黑:白)` 六欄；手動登錄（無裁判回報）或輪空桌該六欄留空。

**驗證**：後端整合測試由 21→22 項（新增「只改組明細、桌勝方不變」情境）；E2E 演練由 14→17 步（新增五組輸入完整流程、只改組明細靜默更新、Excel 五組欄下載驗證），全過。

### 已知事項 / 小 caveat

- **rate limit 是 per-isolate 記憶體**（原規劃 4.2 已預期）：Cloudflare 免費方案多 isolate 下是 best-effort，擋暴力猜 token 夠用；嚴格分散式計數需 Durable Objects，屬過度設計，未做。
- **`min-h-24`**：裁判頁用了非 Tailwind 3.3 內建的 class 名（靠 `min-h` fallback，視覺 OK 但非標準），可日後清理。

### 待 rita 操作（部署時才需要，一次性）

```bash
cd backend
wrangler login
wrangler d1 create wgp_score_relay          # 把回傳的 database_id 填進 wrangler.toml
wrangler d1 execute wgp_score_relay --remote --file=./schema.sql
npm run deploy                               # 得到 https://wgp-score-relay.<帳號>.workers.dev
```
部署後把該網址填進主控端「線上回報」面板建立賽事。`ALLOWED_ORIGINS` 已含 GitHub Pages 正式來源。

---

## 9. 不變式（執行期間不得違反）

1. `swissPairing.js` **一行都不改**；回歸測試在 Phase 2、4 各跑一次確認。
2. 後端不可用時，主控端所有既有功能（含手動登錄結果）行為與現在完全相同。
3. 伺服器永遠不是 system of record；賽後正式紀錄仍是 Excel/JSON 匯出。
4. admin token 與 table token 權限嚴格分離。

## 10. 待決事項（rita 已於 2026-07-06 決定）

- [x] **和局**：**不做**。裁判頁照現行語意（只能點選勝方）；若日後 GiveMe5 出現平手規則，
      另開工作項先改核心計分，不在本計劃內。
- [x] **retention 天數**：賽後 **7 天**自動清除（主控端「結束賽事」可立即刪，此為保險）。
- [x] **裁判更正權限**：**該輪鎖定前可自行更正**，主控端跳 revision 醒目警示、
      需操作者確認才採計（即 4.2／4.3 節現行設計）。
- [x] **Cloudflare 帳號**：用 **rita 個人帳號**（免費方案）；帳號建立與 wrangler 登入由 rita 操作。

## 11. 給執行者的注意事項

- 本 repo 慣例見根目錄 `README.md`：部署走 `gh-pages`（正式 `master`／預覽 `develop`）、
  版號 bump 有 gotcha（`npm version` 在子目錄不會自動 commit/tag，需手動補）。
- 前端主程式為單一大檔 `tournament-menager/src/TournamentManager.tsx`（~3200 行）；
  同步邏輯務必放獨立的 `src/lib/sync.ts`，避免再增肥。
- 新功能先在 `develop` 分支開發、部署 preview 給 rita 測，確認後才進 `master`。
- **禁止自動 commit / push**；每個 Phase 完成後回報實測輸出，由 rita 決定何時 commit。
- 裁判頁 UI 文案用繁體中文；程式註解繁體中文、識別字英文，比照既有風格。
