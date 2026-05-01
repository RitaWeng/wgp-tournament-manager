# 測試套件

本目錄是 WGP 比賽管理系統的回歸測試集。每次改版（特別是改動到抓對 / 算分邏輯）都應該跑一次。

## 結構

```
tests/
├── README.md                   # 本檔
├── fixtures/                   # 歷年比賽 Excel 原始檔（gitignored，含選手個資）
└── regression/
    └── replay_excel.js         # Excel 重放測試：把實際比賽重新抓對一次，比對是否一致
```

`fixtures/` 下的 Excel **必須先做學校去識別化**才會進版控。`.gitignore` 預設仍排除 `*.xlsx`，但對 `tests/fixtures/*.xlsx` 設了例外放行（見 `.gitignore` 中 `!tests/fixtures/*.xlsx`）。備份檔（`*.bak`）一律不上版控。

去識別化規則：將學校名稱替換為 `學校NN`（兩位數編號，依首次出現順序），保留 A/B/C 隊伍後綴。例：`衛理女中A` → `學校01-A`、`深坑國中` → `學校02`。籤號、勝負、對手籤號、輔分等數值欄位不動。

## 怎麼跑

```bash
cd tournament-menager
npm run test:regression
```

或在專案根目錄：

```bash
node tests/regression/replay_excel.js
```

回傳碼：
- `0` 全部 fixture 通過
- `1` 有差異
- `2` 找不到任何 fixture

## Excel 重放測試（replay_excel.js）

### 它做什麼

讀取 `fixtures/` 下每個 Excel，把每一張工作表（一場錦標賽）當作一筆 ground truth：對 R2 ~ Rn 每一輪，**只用該輪之前的結果**重新跑一次抓對演算法，檢查程式產出的桌次表是否與 Excel 實際的對局完全一致。

驗證涵蓋：
- 排序鍵（總分、輪動平衡、輔分一/二/三、籤號）
- 分組與邊界洩漏（boundary leakage）
- 回溯與借人（backtrack / ReCrawl）
- 輪空輪轉（避免重複輪空）
- 輔分三的 head-to-head 計算

### Excel 格式要求

每張工作表第一列為標題列，從第二列起為選手資料。欄位順序固定：

| 欄 | 內容 |
|---|---|
| A | `籤號` |
| B | `姓名` 或隊伍名稱 |
| C, D | `R1` 結果（1 / 0）, `對手`（對手籤號；輪空填 0）|
| E, F | `R2` 結果, 對手 |
| ... | ... 重複 N 輪 |
| 後 4 欄 | `總分`, `名次`, `輔一`, `輔二`, `輔三`（讀取時不會用到，僅作 sanity check） |

範例見 `fixtures/read_2025南北區競賽結果.xlsx`（北區 29 隊 × 5 輪、南區 22 隊 × 4 輪）。

### 加入新的 fixture

1. 把 Excel 放進 `tests/fixtures/`
2. 在 `tests/regression/replay_excel.js` 頂端的 `FIXTURES` 陣列新增一筆：
   ```js
   const FIXTURES = [
     { file: 'read_2025南北區競賽結果.xlsx', label: '2025 南北區' },
     { file: 'your-new-fixture.xlsx',         label: '簡短描述' },
   ];
   ```
3. 跑 `npm run test:regression`，確認新 fixture 也是 `全部相符`

## ⚠ 重要限制：演算法是「複製」而非「共用」

`replay_excel.js` 內的 `computeFloatBalance` / `calculateAuxiliaryScores` / `generateSwissPairings` 是 `tournament-menager/src/TournamentManager.tsx` 對應函式的**手動 port**。

意思是：
- ✅ 修了 bug 並更新此測試 → 會抓到回歸
- ❌ 改了 TSX 但忘了更新此測試 → 測試會「假性通過」

**改動配對 / 算分相關的 TSX 程式碼時，務必同步更新 `replay_excel.js`。** 將來若要根除這個風險，建議把演算法抽到獨立模組（例如 `tournament-menager/src/lib/swissPairing.ts`），讓 React 元件與測試 import 同一份。

## 後續可加入的測試類型（建議）

- **Bug 重現腳手架**：`test-data/` 已經有零散的 bug fixture（bug5、bug9、輪空雙重等），可考慮整理進 `tests/fixtures/bugs/`，用 JSON 狀態快照的形式做斷言
- **隨機模擬**：對 N 隊隨機產生勝負結果並跑 K 輪，斷言不出現重複對戰、不出現重複輪空、輔分恆為非負等不變量
- **UI 端對端**：搭配 Playwright 對主要操作流程錄製
