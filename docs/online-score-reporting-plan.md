# 線上成績回報後端 — 規劃文件

> **狀態：草稿，待 rita 審閱**（2026-07-06 擬定；同日兩次修訂——
> ① 紅隊推演：QR 由桌牌改為裁判隨身卡＋硬性裝置綁定；
> ② 依 rita 提議簡化：QR 改由**計分台保管**、硬綁定改為**軟性裝置偵測**，見 4.1）
> 審閱通過後，本文件即為執行規格：依「分階段執行計劃」逐 Phase 動工，每個 Phase 以其驗收條件收尾。
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

### Phase 0：基礎建設（~0.5 天）
- [ ] Cloudflare 帳號 + wrangler CLI（帳號建立與登入由 rita 操作）
- [ ] repo 新增 `backend/` 目錄（monorepo）：Hono 專案骨架 + D1 schema + `wrangler dev` 本地環境
- **驗收**：`wrangler dev` 起得來，health check 回 200；既有前端 build 不受影響

### Phase 1：後端 MVP（~2 天）
- [ ] Admin API 全套（見第 7 節，含各桌上線狀態）
- [ ] Judge API 全套
- [ ] 第 4.2 節所有伺服器端驗證 + rate limit + CORS
- [ ] 後端單元測試（本地 D1）
- **驗收**：測試涵蓋——越權提交被拒、locked 輪次提交被拒、重複提交 idempotent、
  錯誤 token 401、**同桌 device_id 變化入稽核並可由主控端查得**

### Phase 2：主控端整合（~2 天）
- [ ] 新增同步模組 `tournament-menager/src/lib/sync.ts`（獨立檔案，不碰演算法）
- [ ] UI：「建立線上賽事／連線」設定區、「發佈桌次」按鈕、成績回報即時標示
      （來源＋衝突提示＋**revision 醒目警示與確認**）
- [ ] 裁判 QR 卡列印頁（印出後由計分台保管）＋各桌**上線狀態一覽**（含 device_id 變化標示）
- [ ] 「算分／解除鎖定」掛上鎖定同步
- **驗收**：後端不可用時，現有全部功能行為不變；`npm run test:regression` 全過

### Phase 3：裁判手機頁（~1.5 天）
- [ ] `#/judge` route：大字體、大按鈕、送出前確認、成功畫面
- [ ] 首次啟動自產 `device_id`；token／device_id 收進 localStorage 並以
      `history.replaceState` 清掉網址中的 token
- [ ] 斷線重試＋「該輪已鎖定」明確提示
- [ ] 沿用現有主題 token（`.btn-*` / `--bg-*` / `--text-*`），RWD 比照現有行動版
- **驗收**：手機實測（iOS Safari + Android Chrome）完整走完一輪回報

### Phase 4：安全強化與演練（~1 天）
- [ ] 依 4.2 檢查表逐項實測（越權、鎖後提交、token 猜測、重放、
      **token 外洩情境：第二台裝置提交須觸發 device_id 變化標示、revision 須在主控端跳警示**）
- [ ] 端到端演練：一台電腦主控 + 2–3 支手機裁判，含刻意斷網再恢復
- [ ] 跑回歸測試確認演算法零影響
- [ ] README 補「線上成績回報」章節
- **驗收**：演練整場走完；安全檢查表全數通過並留下實測紀錄

### Phase 5：實戰試用
- [ ] 小型練習賽試跑，主控端保留手動輸入備援
- [ ] 收集裁判回饋，回頭迭代

**總估：約 6–7 個工作天**。各 Phase 獨立驗收；Phase 2 完成後即使 Phase 3 未動工，現有系統也不受影響。

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
