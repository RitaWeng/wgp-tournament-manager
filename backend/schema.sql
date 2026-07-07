-- WGP 線上成績回報後端 D1 schema
-- 資料模型定義見 docs/online-score-reporting-plan.md 第 6 節。
-- 定位是「暫存中繼」：只放當場賽事資料，賽後由主控端刪除＋7 天 retention 雙保險；
-- system of record 永遠是主控端 localStorage 與賽後 Excel/JSON 匯出。

-- 賽事：id 與 token 皆為隨機值（不可循序猜測）；token 只存 SHA-256 雜湊
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    admin_token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 各桌：table token 綁桌次；last_device_id / device_change_count 供軟性裝置偵測
-- （device_id 變化不拒絕、只入稽核並累計次數，主控端據此標示）
CREATE TABLE IF NOT EXISTS tables (
    event_id TEXT NOT NULL REFERENCES events(id),
    table_no INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    last_device_id TEXT,
    last_seen_at TEXT,
    device_change_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, table_no)
);
CREATE INDEX IF NOT EXISTS idx_tables_token ON tables (token_hash);

-- 輪次狀態：主控端「算分」→ locked（伺服器拒收提交）；「解除鎖定」→ open
CREATE TABLE IF NOT EXISTS rounds (
    event_id TEXT NOT NULL REFERENCES events(id),
    round_no INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked')),
    published_at TEXT,
    PRIMARY KEY (event_id, round_no)
);

-- 本輪配對與裁判回報：
--   groups_json：五組（ABCDE）各組結果 [{"winner":1|2,"overtime":bool}×5]，
--                裁判只回報這個；桌勝方由伺服器以多數決推導（不信任前端）
--   result     ：1/2 = 桌勝方（由 groups 推導；NULL = 未回報）
--   version    ：optimistic versioning（重複提交 idempotent）
-- 輪空（BYE）不發佈進此表，由主控端照現行邏輯處理
CREATE TABLE IF NOT EXISTS pairings (
    event_id TEXT NOT NULL REFERENCES events(id),
    round_no INTEGER NOT NULL,
    table_no INTEGER NOT NULL,
    player1_id INTEGER NOT NULL,
    player1_name TEXT NOT NULL,
    player2_id INTEGER NOT NULL,
    player2_name TEXT NOT NULL,
    result INTEGER CHECK (result IN (1, 2)),
    groups_json TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    -- 操作者「維持現狀」（不採計裁判更正）時記下被拒的 version；
    -- 裁判頁看到自己目前版本被拒即顯示「請洽計分台」，再更正（版本遞增）自動解除。
    -- 既有部署升級：ALTER TABLE pairings ADD COLUMN rejected_version INTEGER;
    rejected_version INTEGER,
    submitted_at TEXT,
    PRIMARY KEY (event_id, round_no, table_no)
);

-- 稽核紀錄（append-only，僅 INSERT）：所有提交、鎖定、device_id 變化都入此表
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    payload_json TEXT,
    ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log (event_id, ts);
