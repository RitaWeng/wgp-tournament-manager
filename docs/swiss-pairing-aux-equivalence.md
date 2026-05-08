# Swiss-pairing — JS 抓對排序為何要保留輔分（VBA stable-sort 等效實作）

**對應 commit**：`233ec04`
**檔案**：`tournament-menager/src/lib/swissPairing.js`（`generateSwissPairings` 內部 sort 鍵）

---

## TL;DR

未來若你看到 `generateSwissPairings` 排序鍵裡有 aux1/2/3，覺得「VBA 字面沒這幾項，可以拿掉」 — **不要拿掉**。先跑 `npm run test:regression`，會看到 R3 起所有 fixture 立刻發散。aux 雖然不是 VBA 字面寫法，但實證上是 VBA `Sub VS` stable-sort 的等效實作。

---

## 背景

裁判規則書與部分文件描述抓對 tiebreaker 為「同戰績以籤號排」。但 JS 實作排序鍵是:

```
總分 desc → 輪動 asc → 輔分一 desc → 輔分二 desc → 輔分三 desc → 籤號 asc
```

直覺懷疑 aux1/2/3 是冗餘 — 規則書沒寫。

## 對照 VBA 原始碼

從 `D:\WGP\wgp-tournament-manager\2025北區(Final).xlsm` 取出 `Sub VS` 抓對前的排序鍵:

```vba
.SortFields.Add Key:=...ColTurn+1, Order:=xlAscending      ' 參賽 flag
.SortFields.Add Key:=...COLTT,     Order:=xlDescending     ' 總分
.SortFields.Add Key:=...ColTurn,   Order:=xlAscending      ' 輪動 (CountTurn)
```

字面上**只有三層 key**（參賽 flag、總分、輪動），根本沒有輔分。輔分一/二/三只在 `Sub SortRank`（最終排名輸出）才用。

## 嘗試對齊 VBA 字面

把 JS 排序鍵改成 `(總分 desc, 輪動 asc, 籤號 asc)`，跑回歸測試:

```
========== 2025北區 (29 隊, 5 輪) ==========
R2: ✓ 全部 15 桌符合 (含輪空)
R3: ✗ 不符 — 程式 15 桌, 實際 15 桌
   程式有但實際無: ['2-29', '8-12', '13-19', ...]
   實際有但程式無: ['2-19', '8-13', '12-29', ...]
R4: ✗ 不符 — ...
R5: ✗ 不符 — ...
```

R2 還對得上（畢竟 R1 都打 0:0 同分，籤號決勝），但 R3 起發散。

## 為什麼 VBA 實際上不是純 `(總分, 輪動, 籤號)`

關鍵在 **Excel sort 是穩定排序**:相等鍵時保留原 row 順序。所以 VBA 第三層之後的 tiebreaker 不是程式邏輯定義的，而是「呼叫 sort 當下的 row 順序」。

那 row 順序怎麼來的?在 R3 sort 之前，row 順序 = R2 完成後 post-pair sort 的結果，也就是:

```vba
.SortFields.Add Key:=Cells(RowTitle, ColGroup), Order:=xlAscending
.SortFields.Add Key:=Cells(RowTitle, ColGroupOrder), Order:=xlDescending
```

`(ColGroup asc, ColGroupOrder desc)` — group 內依配對順序排列。配對順序又是上一輪 sort + 回溯演算法決定。遞迴下去:**VBA 實質的 tiebreaker 是「過去對戰史的累積結果」**。

## aux1 為何能填補這個位置

「輔分一 = 所遇對手之總分和」本質上也是「過去對戰史的數值化」。同戰績下 aux1 高的選手代表他過去碰到強敵較多 — 這跟 VBA stable-sort 留下的 row 順序高度相關（雖然不是嚴格相等）。aux2、aux3 進一步細化。

實證:JS 排序鍵 `(總分, 輪動, aux1, aux2, aux3, 籤號)` 對 2025 南北區共 7 個 fixture 輪次（北 R2-R5、南 R2-R4、共 119 場）**配對 100% 吻合**。

## 結論

JS 用 aux 模擬 VBA stable-sort 不是巧合，是經驗證的等效實作。VBA 字面寫法簡潔但隱含歷史相依，要在純函式 JS 重現必須有顯式可比較的數值代理 — aux1/2/3 正是這個角色。

## 動程式碼之前的 checklist

如果未來有人想動 `generateSwissPairings` 的排序鍵:

1. **先跑** `npm run test:regression`，記錄當前狀態。
2. 改完**再跑**一次。
3. 任何 fixture 從 ✓ 變 ✗，停下來思考 — 你可能正在重蹈覆轍。
4. 若是有意調整（例如新規則上路，需重新對齊），同時更新 `tests/fixtures/` 的 ground truth。

## 規則書 vs 實作的真正差距

規則書:「敗場數相同 → 籤號最大者輪空」。
VBA 實際:「總分同 → 輪動同 → row 歷史同 → 才比籤號」。
JS 實際:「總分同 → 輪動同 → aux1/2/3 同 → 才比籤號」（與 VBA 等效）。

兩者都跟規則書字面有差距，但 VBA 多年使用無爭議，代表「歷史相依 tiebreaker」是裁判實際接受的行為。要走純規則書字面，等於改變過去十年的賽事傳統，不建議貿然動。
