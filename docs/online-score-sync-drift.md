# 線上成績回報 — 主控端／後端狀態錯位分析與修法規劃

> 2026-07-12。起因：實測發現「先在主控端算分鎖定第 1 輪，之後才建立線上賽事」時，
> 裁判端不知道該輪已鎖定，送出的更正被主控端靜默忽略、兩端皆無提示。
> 循此系統性列舉並實測所有同類「本機狀態 ↔ 後端/裁判端狀態」錯位情境，本文件記錄
> 根本原因、六個已重現情境、以及分優先級的修法規劃。
> 相關文件：`online-score-reporting-plan.md`（架構與安全規格）、`online-score-reporting-ops.md`（維運）。

---

## 1. 根本原因

主控端有 **三條各自獨立、彼此不對帳** 的非同步流程：

1. **本機算分鎖定** — `calculateScores` 把該輪加入 `scoredRounds`（本機權威狀態）。
2. **推送鎖定到後端** — `onlineSync.lockRound()`／`unlockRoundRemote()`，**fire-and-forget、失敗只跳一次 toast**（`TournamentManager.tsx:1335`、`:2083`）。
3. **輪詢收裁判回報** — `processJudgeResults` 每 4 秒抓一次結果並套用。

三者之間沒有「以本機 `scoredRounds` 為權威、把後端鎖定狀態校正到一致」的對帳步驟。只要三條流程的狀態對不齊，就會出現黑洞。放大黑洞的兩個具體機制：

- **靜默守衛 A（鎖定輪次丟回報）**：`processJudgeResults` 有一行
  `if (scoredRounds.includes(row.round_no)) continue;`（`TournamentManager.tsx:2132`）。
  本機認為已鎖定的輪次，任何裁判回報都被直接 `continue` 丟棄——**不提示、不留痕**。
  但後端若不知道該輪已鎖（S1/S2），會照常回 HTTP 200 收下裁判的更正，於是
  「裁判以為成功、主控端當沒發生」。
- **靜默守衛 B（配對不符丟回報）**：`if (match.player1 !== row.player1_id || match.player2 !== row.player2_id) continue;`（`TournamentManager.tsx:2136`）。
  本機配對與回報的選手對不上時直接丟棄——同樣不提示（S5）。

- **後端非權威、也不主動校正**：後端只是中繼，鎖定狀態完全跟隨主控端推送。
  主控端從不在「建立賽事後、頁面重載後、算分後」主動把 `scoredRounds` 對帳推給後端，
  因此任何一次 push 失敗或時序錯位都會**永久殘留**，直到有人手動重發或重鎖。

一句話：**後端的鎖定狀態不保證等於本機 `scoredRounds`，而回報處理又用本機 `scoredRounds`
靜默丟棄回報**——兩者一旦分歧，落在夾縫裡的裁判回報就無聲消失。

---

## 2. 已重現情境（皆以本機 wrangler dev 後端 ＋ 真實主控端 UI ＋ HTTP 模擬裁判實測）

| # | 情境 | 實測結果（✗ = 重現問題） | 根因歸類 | 狀態 |
|---|------|--------------------------|----------|------|
| **S1** | **先本機算分鎖定 R1，才建立線上賽事** | 建立賽事不推既有鎖定狀態 → 後端 R1 為 open；裁判端 `locked=false`、翻盤更正被 HTTP 200 收下；主控端輪詢因守衛 A 靜默丟棄，**無確認視窗、無提示** | 鎖定狀態未對帳 ＋ 守衛 A | **✅ P0 已修** |
| **S2** | 正常流程，**算分當下 lock 請求斷線** | 有警告 toast，但**之後無重試/補救**；後端 R1 仍 open，裁判翻盤照收、主控端靜默忽略（同 S1 黑洞） | lock push 失敗無重試 ＋ 守衛 A | **✅ P0 已修**（見下註） |
| **S3** | **主控端頁面重載／換機用 JSON 還原後接手** | `onlineCfg` 與 `scoredRounds` 各自從 localStorage 還原，但**兩者從不對帳**；先前 S1/S2 造成的鎖定分歧在重載後**永久殘留**且更難察覺 | 鎖定狀態未對帳 | **✅ P0 已修** |
| **S4** | 正常鎖定後，**解除鎖定時 unlock 請求斷線**（反向） | 有警告 toast，但後端仍 locked；主控端等裁判更正、裁判端卻被擋（HTTP 409），**雙方卡死**、無補救 | unlock push 失敗無重試 | **✅ P0 已修** |
| **S5** | **發佈後本地改了配對但忘記重發** | 裁判手機顯示舊配對、照舊配對回報（HTTP 200）；主控端因選手對不上（守衛 B）**靜默略過**，雙方都不知道回報去哪 | 配對未對帳 ＋ 守衛 B | ⬜ P1 待修 |
| **S6** | **線上賽事進行中按「重設」** | `wgpOnlineSync` 殘留、輪詢照跑、後端賽事與 QR 卡全部有效，但本機桌次已清空 → 回報無處可套。重設完全不碰線上狀態 | 生命週期未連動 | ⬜ P2 待修 |
| **S7** | **鎖定競態**：裁判在鎖定前一刻送出更正，主控端輪詢在鎖定後才處理到 | 合法送出（HTTP 200）的更正被守衛 A 靜默丟棄，**兩端皆無提示** | 時序競態 ＋ 守衛 A | ⬜ P1 待修 |

> **S2 註**：P0 消除了「持久錯位」——推送失敗後由輪詢自動補鎖，後端不再永遠停在 open。
> 但在斷線的短暫視窗內（補鎖成功前）落地的裁判更正，仍會被守衛 A 靜默丟棄；
> 要讓這種「視窗內落地的更正」現身，需 P1（把守衛 A/B 的丟棄變成可見標記）。

> 共通惡性後果是 **靜默**：裁判端顯示送出成功、主控端毫無痕跡。現場會演變成
> 「裁判堅持有回報、成績卻不對」的爭議，且沒人會當場去翻後端 audit log。
> 修法的共同目標是把「靜默丟棄」變成「可見事件 ＋ 自動校正」。

---

## 3. 修法規劃（分優先級）

### P0 — 鎖定狀態對帳（一次解掉 S1 / S2 / S3 / S4）✅ 已實作

核心：讓 **本機 `scoredRounds` 成為後端鎖定狀態的唯一權威**，在四個時機以同一個
`reconcileRoundLocks(cfg, scored)` 對帳函式把後端每個輪次校正到「本機已算分 ⇔ locked」。

實作摘要（`TournamentManager.tsx`）：

- **對帳函式 `reconcileRoundLocks`**：對每個「後端已知輪次」推導 desired（本機已算分 ⇔ locked，
  否則 open），狀態不符才推送、**失敗不拋、留待下次輪詢重試**；`reconcilingRef` 防止重入。
  以兩個 ref 支撐：`lockReconcileRef`（`Map<roundNo,'locked'|'open'>`，記已確認狀態避免重複請求）、
  `backendKnownRef`（`Set<roundNo>`，驅動 unlock 方向，見下「Codex review 修正」）。
  尚未確認的輪次寫入 `lockSyncPending` state，面板顯示「⟳ 鎖定同步中（R…）」。
- **建立賽事後**（`createOnlineEvent`）：清空對帳快取並立即 `reconcileRoundLocks(cfg, scoredRounds)`，
  把建賽前已鎖的輪次同步到後端 → 解 **S1**。
- **算分後**（`calculateScores`）：以 `reconcileRoundLocks` 取代原本 fire-and-forget 的
  `lockRound`；推送失敗改由輪詢自動補鎖 → 解 **S2**（持久錯位）。
- **解鎖後**（`unlockRound`）：同樣改走對帳，推送失敗自動補解鎖 → 解 **S4**。
- **每次成績輪詢**（4 秒 tick）：`await reconcileLocksRef.current?.()`，持續把任何漂移推平 →
  解 **S3**（重載後 `lockReconcileRef` 為空、首次輪詢即重建同步）。
- **發佈桌次後**：若該輪本機已算分（重發舊輪的罕見情形），發佈會把後端 status 重設為 open，
  故 `delete` 對帳快取該輪並立即補鎖，關掉空窗。

> 後端 `admin.post lock/unlock`（`backend/src/admin.ts:99`）本就是冪等 upsert，
> 重複補送無副作用，對帳可無腦重送。

**Codex review 修正（重載後解鎖漏送）**：初版對帳的 unlock 方向只掃 in-memory 快取
`lockReconcileRef`——頁面重載後快取清空，若此時解鎖一個「上個 session 就鎖定」的輪次，
unlock 迴圈無來源可掃、**永不送 `unlockRoundRemote`**，導致本機已解鎖、後端仍鎖、裁判卡死
（S4 的重載變體，S8）。改以 `backendKnownRef`（後端已知輪次集合）驅動 unlock 方向，
並在 `unlockRound` 明確把被解鎖輪次加入該集合，使解鎖能跨 session 正確送達。

**實測驗證**（本機 wrangler dev ＋ 真實主控端 UI ＋ HTTP 模擬裁判，2026-07-12）：

| 情境 | 修復後實測 |
|------|-----------|
| S1 | 建立賽事後（未發佈 R1）裁判端 `locked=true`，送出被 `409 round_locked` 擋 ✓ |
| S2 | lock 斷線時面板顯示「鎖定同步中」；恢復後下個輪詢週期後端自動變 locked、裁判翻盤被 409 擋 ✓ |
| S3 | 以殘留分歧（本機已算分、後端 open）載入頁面，首次輪詢後後端自動補鎖、裁判被 409 擋 ✓ |
| S4 | unlock 斷線後恢復連線，下個輪詢週期後端自動變 open、裁判可正常送出更正（200）✓ |
| S8 | 算分鎖定 → **重載頁面** → 解鎖 R1，後端自動變 open、裁判恢復可更正（200）✓（Codex 找到的漏洞，已修並回歸） |

後端測試 28 項、前端回歸 fixture 全數通過，happy path（正常建賽→發佈→回報→算分）不受影響。

> **殘留缺口**：P0 只保證「後端鎖定狀態最終與本機一致」。斷線視窗內落地、或鎖定競態
> （S7）中鎖定前送出的更正，仍會被守衛 A 靜默丟棄——這需要 P1 把丟棄變成可見標記才能根治。

### P1 — 把「靜默丟棄」變成「可見事件」（S1/S2/S7 的止血；即使 P0 未完成也有價值）

守衛 A（`:2132`）目前直接 `continue`。改為：若丟棄的回報其**桌勝方與本機登錄不同**
（亦即這是一筆有意義的更正，而非重複回報），在「各桌狀態」或稽核面板留一個可見標記
（例：「桌 N 有一筆鎖定後的更正未採計」），並可一鍵查看內容決定是否解鎖採計。
→ 讓 S1/S2/S7 的黑洞至少「看得見」，不再是無聲消失。

### P1 — 配對不符的偵測與提示（S5）

- **主動偵測**：發佈後若本地配對再被修改（`applyPairingEdit`／重抓對）而未重發，
  在狀態列或「發佈桌次」按鈕旁顯示「本地配對已變更，尚未重新發佈」提醒。
- **被動止血**：守衛 B（`:2136`）丟棄配對不符的回報時，比照 P1 留可見標記，
  而非純 `continue`。

### P2 — 生命週期連動（S6）

`resetSystem`（`TournamentManager.tsx:2033`）在 `onlineCfg` 存在時，先跳確認：
「目前有進行中的線上賽事，重設將清空本機資料但不會結束線上賽事。建議先『結束線上賽事』。」
提供「一併結束線上賽事」選項（呼叫 `closeEvent` ＋ 清 `wgpOnlineSync`）。
避免重設後輪詢仍對著孤兒賽事跑、QR 卡仍有效。

### 設計原則（貫穿所有修法）

- **本機 `scoredRounds`／配對為權威**，後端只是其投影；任何分歧一律以「把後端校正到
  本機」的方向自動收斂。
- **拒收/丟棄回報時永不靜默**：至少留一個操作者看得見、可追查的標記。
- 對帳操作全部走**冪等重送**，搭既有 4 秒輪詢，不新增計時器、不改輪詢頻率
  （現場裁判輪詢節奏不動，見 memory「裁判輪詢 10 秒勿調快」）。

---

## 4. 建議測試（把本次驗證固化為回歸）

本次以 `scratchpad/sync-test.js` 一次性腳本驗證了 S1/S2/S4/S5/S6/S7。修法時應把這些
情境搬進 `backend/test/` 或前端測試，成為長期回歸：每個情境斷言「錯位不再靜默」——
即修法後：後端鎖定狀態與本機一致（S1–S4）、配對不符會提示（S5）、重設有防呆（S6）、
競態回報留可見標記（S7）。

---

## 5. 現況與範圍

- 以上皆為 **既有問題**，非近期投影改版引入；線上回報自 v1.4.x 上線即存在。
- 影響面僅限 **有啟用線上回報** 的比賽；純手動流程完全不受影響。
- 嚴重度：S1/S2/S3/S7 會導致**裁判更正靜默遺失**（資料正確性，最高）；S4 造成雙方
  卡死（需人工介入）；S5/S6 為操作陷阱（有正確操作順序可規避，但缺防呆）。
- **進度（2026-07-12）**：P0（鎖定狀態對帳）已實作並實測，S1/S2/S3/S4 修復（commit `d50f990`）；
  但後續自我 code-review 在 P0 內找到殘留缺口 **F1–F5（見 §7）**，其中 F1（解鎖失敗後重載永久
  漂移）、F2（解鎖失敗無提示）應排 **P0.1** 修——建議走「後端狀態端點 → 無狀態對帳」。
- **進度（2026-07-18）**：**P0.1 已實作並全數驗證 ✅**（實作 `fe8cd31`，無狀態鎖定對帳）——
  後端 29 項整合測試、前端 build＋fixture、e2e 20 步（含新增 F1 回歸段：解鎖失敗 → reload →
  unroute 後 1.6s 自癒）全綠。**F1/F2/F5 已修**；F3 刻意維持（S1 保護行為）、F4 殘餘
  ≤4s 收斂屬可接受。詳 §7。
  S5（P1 配對對帳）、S6（P2 重設防呆）、S7＋守衛可見化（P1）尚未動工。

---

## 6. 附錄：P0 實作與驗證歷程（2026-07-12）

留作日後接手 P1/P2 或回顧設計取捨的紀錄。

1. **問題發現**：使用者實測「先本機算分鎖定 R1，才建立線上賽事」，發現裁判送出的更正
   被主控端靜默忽略、兩端皆無提示。
2. **系統性列舉＋實測**：讀通 `sync.ts`／`backend/src/*`／輪詢與發佈流程後，以「本機動作 ×
   線上賽事生命週期」矩陣列出 S1–S7；架本機後端（`wrangler dev`）＋真實主控端 UI
   （Playwright 驅動）＋ HTTP 模擬裁判，**六個情境（S1/S2/S4/S5/S6/S7）全部重現**。
3. **根因定位**：三條互不對帳的非同步流程 ＋ 兩個靜默守衛 ＋ 後端非權威（見 §1）。
4. **P0 實作**：新增 `reconcileRoundLocks` 對帳機制（見 §3 P0），改 `calculateScores`／
   `unlockRound`／`createOnlineEvent`／發佈流程／輪詢 tick。
5. **第一次 Codex review（gpt-5.5）找到真漏洞**：初版 unlock 方向只掃 in-memory 快取
   `lockReconcileRef`，**頁面重載後快取清空 → 解鎖跨 session 的已鎖輪次時漏送 unlock**，
   後端持續鎖定卡死裁判。這是我原本 S4 測試（同 session 完成）沒覆蓋的路徑。
6. **修正並補測**：改用 `backendKnownRef` 驅動 unlock 方向、`unlockRound` 明確納入被解鎖
   輪次；新增 **S8**（算分鎖定 → 重載 → 解鎖）實測確認後端自動變 open、裁判恢復可更正。
   過程中另發現 S8 首度失敗是**測試腳本假象**（Playwright `addInitScript` 在 reload 時重跑、
   覆蓋 app 已寫入的真實狀態），改為「localStorage 為空才 seed」後排除——非產品問題。
7. **二次驗證**：重跑 Codex review → **無發現**；S1–S4＋S8 全綠；後端 28 項＋前端 fixture
   全過；happy path 不受影響。P0 於 commit `d50f990` 落地。

> 方法論備忘：這次「自寫 Playwright＋本機後端重現 → 修 → 對抗式 review 找補漏 → 補測 →
> 再 review」的循環有效抓到單靠單元測試會漏的跨 session／時序類缺口，值得沿用到 P1/P2。

---

## 7. P0 殘留缺口（自我 code-review 發現，2026-07-12）— P0.1 已修 F1/F2/F5（2026-07-18 驗證 ✅）

P0 commit `d50f990` 後再跑一次 high-effort 多角度 code-review（8 角度 finder + 驗證輪），
在 P0 自己的實作裡找到以下殘留缺口。**F1/F2 是 P0 沒完全解決其宣稱要解決問題的證據**，
應排 P0.1 修。程式位置以 commit `d50f990` 當時行號為準（之後可能位移，以符號為準）。

| # | 嚴重度 | 缺口 | 觸發 / 後果 |
|---|--------|------|-------------|
| **F1** | **高（CONFIRMED）→ ✅ P0.1 已修（e2e 回歸驗證）** | **解鎖失敗後重載 → 永久鎖定漂移** | 解鎖 R 但 `unlockRoundRemote` 失敗，於下次 4 秒輪詢重試前重載。`backendKnownRef`（in-memory、未持久化）清空、`scoredRounds` 還原後不含 R → 對帳只掃由 scored 重建的 `known`、永不再考慮 R → 後端永久 locked、裁判被擋。且 R 本地顯示為「未鎖定可編輯」（`isLocked=scoredRounds.includes` 為 false），操作者無從再觸發解鎖，**UI 無法恢復、兩端無訊號**。與 §6 步驟 5 Codex 找到的是同類漏洞，往下深一層。 |
| **F2** | **中高（CONFIRMED，regression）→ ✅ P0.1 已修** | **解鎖失敗完全無提示** | `lockSyncPending = scored.filter(r => confirmed.get(r)!=='locked')` 只涵蓋「應鎖定」方向；解鎖目標不在 scored → 永不進 pending → 無「⟳ 鎖定同步中」chip。且此 commit 把舊版 unlock 失敗的 `message.warning` 移除。解鎖失敗比改動前更隱形，與 F1 加乘。 |
| **F3** | 低-中（CONFIRMED，transient）→ 維持原樣（S1 依賴，P1 再議） | **幽靈鎖定輪次** | `createOnlineEvent` 對所有 scoredRounds 發 `lockRound`，會替「從未發佈」的輪次在後端 upsert 出無 pairing 的 locked round。離線打完 1-5 輪才建賽時，第 6 輪發佈前掃碼的裁判從 `/judge/pairing` 取到 `MAX(round_no)=5, locked, pairing=null`，看到「第 5 輪已鎖定、無對戰」。發佈下一輪即消失；重發 1-5 輪會 409。 |
| **F4** | 低-中（PLAUSIBLE）→ P0.1 大幅緩解（殘餘 ≤4s 收斂） | **重入守衛丟立即推送＋舊閉包瞬間反向** | 慢速對帳（await 最長 8s）進行中時的算分/解鎖 reconcile 撞 `reconcilingRef` early-return、延後一個輪詢週期，窗內裁判可提交到「操作者以為已鎖」的輪次；或 in-flight 對帳用舊 scored 閉包＋最新 known 誤送反向 lock/unlock。最終收斂但有短暫錯態。 |
| **F5** | 低（PLAUSIBLE）→ ✅ P0.1 已修（狀態源頭移除） | **非陣列 scoredRounds 卡死對帳** | `scored.forEach` 在 `try` 之前；損毀/手改的匯入狀態（`scoredRounds` 為 null/純量，還原僅 `!==undefined` 防呆）→ forEach 拋錯逃過 finally → `reconcilingRef` 永久卡 true → 整個 session 鎖定對帳靜默死亡＋unhandledrejection。 |

### 建議修法：P0.1（後端狀態端點 → 無狀態對帳）— 一次解 F1/F2/F5 根因

F1/F2/F5 的共同根因（code-review altitude 角度亦指出）：**後端沒有「查各輪 status」端點，
逼前端維護 `confirmed` Map ＋ `known` Set 兩份客端狀態鏡像**，任何鏡像失憶（重載）或未同步
路徑都會漏送。正解：

1. **後端**：於既有 `GET /events/:id/results`（4 秒輪詢已在打）的回應**附帶各輪 status**
   （`rounds: [{round_no, status}]`，一次小 SELECT、零額外 round-trip），或新增
   `GET /events/:id/rounds`。
2. **前端**：`reconcileRoundLocks` 改為**無狀態**——拿後端回報的各輪 status，與本機
   `scoredRounds` 推導的 desired 逐輪 diff，只推送不一致者。刪除 `lockReconcileRef`／
   `backendKnownRef`／三處 reset。如此：
   - F1 自癒：重載後首次輪詢就看到「後端 R=locked 但本機未算分」→ 補送 unlock。
   - F2 可見：pending 由「後端狀態≠本機 desired」推導，涵蓋 unlock 方向。
   - F5 消失：不再有跨呼叫的 in-memory 狀態可卡死。
3. **F3**：`createOnlineEvent`／對帳只鎖「後端已知（已發佈或已回報）」的輪次，別替從未發佈的
   已算分舊輪造 round row；或建賽時只同步 ≤ 當前輪的已發佈輪次。
4. **F4**：把「進行中被守衛丟棄」的呼叫記一個 dirty flag，reconcile 結束時若 dirty 再跑一次，
   而非只等下個輪詢；或直接接受 ≤4s 收斂並補一行註解。
5. **F2 立即止血（不等 P0.1）**：可先在 unlock 推送失敗時加回一則 warning，或把 unlock 方向
   也納入 `lockSyncPending`（`known` 中 desired=open 但 confirmed≠open 者）。

### P0.1 實作進度（2026-07-12 實作交接；2026-07-18 ✅ 已驗證——驗證清單全數完成）

**已完成（都在 working tree，尚未 commit 時見 git status；若已 commit 見 git log）**：

1. **後端** `backend/src/admin.ts` — `GET /events/:id/results` 以 `DB.batch` 一併查
   `rounds` 表，回應多帶 `rounds: [{round_no, status}]`。
2. **前端** `tournament-menager/src/lib/sync.ts` — 新型別 `RoundStatusRow`／`ResultsResponse`；
   `fetchResults` 改回傳 `{ results, rounds }`（舊後端不回 rounds 時容錯為 `[]`，
   此時對帳只做 lock 方向、不會誤發 unlock）。
3. **前端** `TournamentManager.tsx` — `reconcileRoundLocks(cfg, scored, backendRounds)`
   改**無狀態**：拿後端 rounds 與本機 scoredRounds 逐輪 diff，`toLock`（已算分但後端非
   locked，含 S1 的 upsert 補建）＋ `toUnlock`（後端 locked 但本機未算分 = F1 自癒路徑）；
   推送失敗者進 `lockSyncPending`（**兩個方向都涵蓋 → F2 修復**）。
   已刪除 `lockReconcileRef`／`backendKnownRef` 及三處 reset（F5 隨之消失）。
   - `calculateScores`／`unlockRound` 改回**直接推送**（低延遲）＋失敗 `message.warning`
     （F2 立即止血）＋輪詢對帳 ≤4s 補送；unlock 警語「將自動重試；成功前裁判端仍被擋」。
   - `createOnlineEvent` 不再顯式對帳：setOnlineCfg 觸發輪詢 effect 立即 tick，首次對帳補鎖（S1）。
   - 發佈已算分輪次後的補鎖改直接 `lockRound`＋catch（失敗留給輪詢）。
   - 輪詢 tick 改 `const { results: rows, rounds } = await fetchResults(...)`，
     `reconcileLocksRef.current?.(rounds)`。
   - 面板 chip title 改「鎖定/解鎖狀態尚未同步到後端，將自動重試」。
4. **後端測試** `backend/test/api.test.mjs` — 「主控端收成績」後新增一測項：
   results 附帶 rounds、lock/unlock 反映於 status。
5. `npx tsc --noEmit` 已過；`grep lockReconcileRef|backendKnownRef` 無殘留。

**驗證清單（1–3 於 2026-07-18 執行，全綠）**：

1. ✅ `cd backend && npm test` — ALL PASS（29 項，含 P0.1 新測項
   「results 附帶各輪鎖定狀態：lock/unlock 反映於 rounds」）。
2. ✅ `cd tournament-menager && npm run build` ＋ `npm test` — build 過（僅既有 bundle
   大小警告）；全部 fixture 回歸通過。
3. ✅ `node backend/test/e2e-online.mjs` — ALL PASS（18 步，含「算分 → 鎖定同步」、
   後端掛掉退回手動、結束賽事），三 context 無 pageerror。
4. ✅ **F1 回歸測試（2026-07-18 瘦身版完成）**：已併入 `backend/test/e2e-online.mjs`
   （「算分 → 鎖定同步」之後插入兩步），只驗後端狀態自癒、不驗 chip UI。實際情境：
   算分後以 `rounds` 欄位斷言 R1=locked → `M.route('**/rounds/1/unlock', abort)` →
   按「解除鎖定」＋確認 → 驗後端仍 locked → **reload（保持 abort）**＋等 ≥1 次對帳 →
   驗仍 locked（舊版 F1 在此永久卡死）→ unroute → **1.6s 自癒為 open** → 重新算分還原
   （後端回 locked），後續 18 步不受影響。e2e 共 20 步 ALL PASS。
   實作備忘：e2e 的 M 端沒用 `addInitScript`（狀態自然存 localStorage），§6 seed 教訓
   不適用；但 **reload 會重置 `showOnlinePanel`**，需重點「線上回報」開面板，否則後面
   「token 外洩偵測」步驟找不到桌況 chip。
5. ✅ 本節已更新為已驗證、§5 進度與 §7 表格已更新（F1/F2/F5 → 已修），commit。

**設計取捨備忘**：F3（幽靈鎖定輪次）**維持原樣未修**——scored 但後端無 row 的輪次仍會
upsert 出無 pairing 的 locked row，因為這正是 S1 的保護行為（裁判端看到鎖定、409 擋更正），
且 S1 既有 e2e 斷言依賴它；要修 F3 需連動改 S1 策略，留 P1 再議。F4 大幅緩解：立即推送
不再走 reconcile（不會被重入守衛吞掉）、對帳參數逐次傳入（無舊閉包反向）；殘餘為
「in-flight 對帳用舊 scored 短暫回鎖剛解鎖的輪次」，≤4s 由下次輪詢自癒，屬可接受收斂。

**P0.1 設計後果補記（2026-07-18 評估）**——兩項已知行為，非缺陷，需知悉：

- **舊後端容錯路徑會變吵**：`fetchResults` 對不回 `rounds` 的舊後端容錯為 `[]`，此時
  `toLock`＝全部已算分輪次、**每 4 秒重複推一次 lock**（冪等無害，但前後端部署落差拖長
  可能撞限流分桶）。**部署順序務必後端先上**；已同步記於 ops 手冊。
- **「本機為權威」由被動轉主動**：P0 時代的失效模式是「該解鎖而永不解鎖」（F1）；P0.1
  之後反轉——任何持 admin token 但本機狀態較舊的主控端（舊備份還原、第二台裝置手動輸入
  同組憑證）會**主動解鎖後端已鎖的輪次**。與既定權威模型（`d50f990`）一致、單一主控裝置
  前提下即正確，但屬行為反轉，異地接手主控時應以最新匯出檔還原後再連線。

### 本次 code-review 的重現/驗證方式（P0.1 沿用）

- 本機後端：`cd backend && npm run db:local && npx wrangler dev --port 8787`
- 前端：`cd tournament-menager && npm run build`，`cd dist && python -m http.server 8080`
- 驅動：Playwright（`playwright-core` + 本機 chromium）真實開主控端 UI ＋ `fetch` 模擬裁判
  打 `/judge/pairing`、`/judge/result`。情境腳本形態見 §6（S1–S8）；為 F1 應新增
  「解鎖失敗（route abort）→ 重載 → 驗後端仍 locked 且無重試」的回歸。
