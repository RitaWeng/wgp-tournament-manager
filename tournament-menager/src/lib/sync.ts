// 線上成績回報同步模組（規劃文件 docs/online-score-reporting-plan.md）
// 主控端 ↔ 成績中繼站（Cloudflare Workers）之間的所有 HTTP 呼叫都收在這裡；
// 不碰 swissPairing.js、不碰任何算分邏輯。後端不可用時所有函式只會 throw，
// 呼叫端以非阻斷方式提示，既有功能完全不受影響（不變式 2）。

export type TableToken = { tableNo: number; token: string };

export type SyncConfig = {
    apiBase: string;      // 後端網址，如 https://wgp-score-relay.xxx.workers.dev
    eventId: string;
    adminToken: string;   // 只存主控端 localStorage（規劃 4.1）
    tableTokens: TableToken[];
    eventName: string;
};

// 單組（ABCDE 其一）結果：winner=該組勝方側別；overtime=平手後加賽分出
export type GroupResult = { winner: 1 | 2; overtime: boolean };

export type JudgeResultRow = {
    round_no: number;
    table_no: number;
    player1_id: number;
    player2_id: number;
    result: 1 | 2;          // 桌勝方（伺服器由五組多數決推導）
    groups: GroupResult[] | null;  // 五組明細（由 groups_json 解析）
    version: number;
    submitted_at: string;
};

export type TableStatusRow = {
    table_no: number;
    last_seen_at: string | null;
    last_device_id: string | null;
    device_change_count: number;
};

const STORAGE_KEY = 'wgpOnlineSync';

export function loadSyncConfig(): SyncConfig | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const cfg = JSON.parse(raw);
        return cfg && cfg.apiBase && cfg.eventId && cfg.adminToken ? cfg : null;
    } catch {
        return null;
    }
}

export function saveSyncConfig(cfg: SyncConfig | null): void {
    try {
        if (cfg) localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
        else localStorage.removeItem(STORAGE_KEY);
    } catch { /* localStorage 不可用時線上功能靜默失效 */ }
}

// 統一的 fetch：8 秒逾時、非 2xx 轉成帶後端錯誤碼的 Error
async function call(
    apiBase: string,
    path: string,
    opts: { method?: string; token?: string; body?: unknown; setupKey?: string } = {}
): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
        const res = await fetch(`${apiBase}${path}`, {
            method: opts.method || 'GET',
            signal: ctrl.signal,
            headers: {
                ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
                ...(opts.setupKey ? { 'X-Setup-Key': opts.setupKey } : {}),
                ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    } finally {
        clearTimeout(timer);
    }
}

// ── Admin（主控端）──────────────────────────────────────

// setupKey = 部署時設定的建立賽事金鑰（wrangler secret SETUP_KEY）；
// 後端未設定金鑰時可留空
export async function createEvent(apiBase: string, name: string, tables: number, setupKey?: string): Promise<SyncConfig> {
    const base = apiBase.replace(/\/+$/, '');
    const r = await call(base, '/events', { method: 'POST', body: { name, tables }, setupKey: setupKey || undefined });
    return { apiBase: base, eventId: r.eventId, adminToken: r.adminToken, tableTokens: r.tableTokens, eventName: name };
}

export type PublishPairing = {
    tableNo: number;
    player1Id: number; player1Name: string;
    player2Id: number; player2Name: string;
};

export function publishPairings(cfg: SyncConfig, roundNo: number, pairings: PublishPairing[]): Promise<any> {
    return call(cfg.apiBase, `/events/${cfg.eventId}/rounds/${roundNo}/pairings`,
        { method: 'POST', token: cfg.adminToken, body: { pairings } });
}

export function lockRound(cfg: SyncConfig, roundNo: number): Promise<any> {
    return call(cfg.apiBase, `/events/${cfg.eventId}/rounds/${roundNo}/lock`, { method: 'POST', token: cfg.adminToken });
}

export function unlockRoundRemote(cfg: SyncConfig, roundNo: number): Promise<any> {
    return call(cfg.apiBase, `/events/${cfg.eventId}/rounds/${roundNo}/unlock`, { method: 'POST', token: cfg.adminToken });
}

export async function fetchResults(cfg: SyncConfig): Promise<JudgeResultRow[]> {
    const r = await call(cfg.apiBase, `/events/${cfg.eventId}/results`, { token: cfg.adminToken });
    return r.results.map((row: any) => ({
        ...row,
        groups: row.groups_json ? JSON.parse(row.groups_json) : null,
    }));
}

export async function fetchTablesStatus(cfg: SyncConfig): Promise<TableStatusRow[]> {
    const r = await call(cfg.apiBase, `/events/${cfg.eventId}/tables/status`, { token: cfg.adminToken });
    return r.tables;
}

// 操作者對 revision 警示按「維持現狀」→ 通知伺服器該版本未被採計，
// 裁判頁輪詢看到後顯示「請洽計分台」（裁判再更正即自動解除）
export function rejectJudgeResult(cfg: SyncConfig, roundNo: number, tableNo: number, version: number): Promise<any> {
    return call(cfg.apiBase, `/events/${cfg.eventId}/rounds/${roundNo}/tables/${tableNo}/reject`,
        { method: 'POST', token: cfg.adminToken, body: { version } });
}

export function closeEvent(cfg: SyncConfig): Promise<any> {
    return call(cfg.apiBase, `/events/${cfg.eventId}/close`, { method: 'POST', token: cfg.adminToken });
}

// 裁判頁 QR 內容：token 放 URL fragment（# 之後），不進伺服器 access log（規劃 4.1）。
// a=<apiBase> 一併帶入，裁判頁才知道要打哪個後端（部署網址建立賽事時才確定）
export function judgeUrl(cfg: SyncConfig, t: TableToken): string {
    const base = `${location.origin}${location.pathname}`;
    return `${base}#/judge?e=${cfg.eventId}&t=${t.token}&a=${encodeURIComponent(cfg.apiBase)}`;
}

// ── Judge（裁判頁）──────────────────────────────────────

export function judgeGetPairing(apiBase: string, token: string, deviceId: string): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    return fetch(`${apiBase}/judge/pairing`, {
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': deviceId },
    }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }).finally(() => clearTimeout(timer));
}

export function judgeSubmitResult(
    apiBase: string, token: string, deviceId: string,
    payload: { roundNo: number; groups: GroupResult[]; version: number }
): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    return fetch(`${apiBase}/judge/result`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Device-Id': deviceId,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { const e: any = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; e.version = data.version; throw e; }
        return data;
    }).finally(() => clearTimeout(timer));
}
