// WGP 線上成績回報後端（成績中繼站）
// 架構與 API 規格見 docs/online-score-reporting-plan.md。
// 本服務完全不懂瑞士制：不抓對、不算分、不排名，只保管
// 「本輪配對、裁判回報、輪次鎖定狀態、稽核紀錄」。
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { rateLimit } from './ratelimit';
import { admin } from './admin';
import { judge } from './judge';

export type Env = {
    DB: D1Database;
    ALLOWED_ORIGINS?: string;     // 逗號分隔 CORS allowlist
    RATE_LIMIT_PER_MIN?: string;  // 每分鐘請求上限（每 token 與未認證 IP；帶 token 的 IP 桶為此值 ×10，容納場地共用 IP）
    SETUP_KEY?: string;           // 建立賽事金鑰（wrangler secret；未設定 = 不驗，本地開發/測試用）
};

// c.set / c.get 共用的變數型別（auth 中介層填入）
export type AppEnv = {
    Bindings: Env;
    Variables: { eventId: string; tableNo: number; deviceId: string | null };
};

const app = new Hono<AppEnv>();

// CORS allowlist（4.2）：預設只允許 GitHub Pages 正式來源；
// 本地開發來源由 wrangler.toml vars 補充。Bearer header 授權、無 cookie，CSRF 不適用。
app.use('*', async (c, next) => {
    const allowed = (c.env.ALLOWED_ORIGINS || 'https://ritaweng.github.io')
        .split(',').map((s) => s.trim()).filter(Boolean);
    return cors({
        origin: (origin) => (allowed.includes(origin) ? origin : null),
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type', 'X-Device-Id', 'X-Setup-Key'],
        maxAge: 600,
    })(c, next);
});

app.use('*', rateLimit());

// 健康檢查（Phase 0 驗收端點）：確認 Worker 起得來且 D1 binding 可用
app.get('/health', async (c) => {
    const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return c.json({
        ok: row?.ok === 1,
        service: 'wgp-score-relay',
        db: row?.ok === 1 ? 'up' : 'down',
    });
});

app.route('/', admin);
app.route('/', judge);

app.onError((err, c) => {
    console.error('unhandled error:', err);
    return c.json({ error: 'internal' }, 500);
});

export default {
    fetch: app.fetch,
    // 7 天 retention 雙保險（第 3 節）：主控端「結束賽事」是主要刪除路徑，
    // 這裡清掉忘了關的賽事。cron 排程見 wrangler.toml。
    async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
        // cutoff 必須與 created_at 的預設格式（datetime('now')，空格分隔）一致：
        // TEXT 比較下 ISO 的 'T' > ' '，拿 toISOString() 當 cutoff 會把同一 UTC 日
        // 但較晚時刻的賽事誤判為過期，提早最多近 5 小時刪除
        const stale = await env.DB.prepare(
            "SELECT id FROM events WHERE created_at < datetime('now', '-7 days')"
        ).all<{ id: string }>();
        for (const { id } of stale.results) {
            await env.DB.batch([
                env.DB.prepare('DELETE FROM pairings WHERE event_id = ?').bind(id),
                env.DB.prepare('DELETE FROM rounds WHERE event_id = ?').bind(id),
                env.DB.prepare('DELETE FROM tables WHERE event_id = ?').bind(id),
                env.DB.prepare('DELETE FROM audit_log WHERE event_id = ?').bind(id),
                env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id),
            ]);
        }
    },
};
