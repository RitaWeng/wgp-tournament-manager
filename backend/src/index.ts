// WGP 線上成績回報後端（成績中繼站）
// 架構與 API 規格見 docs/online-score-reporting-plan.md。
// 本服務完全不懂瑞士制：不抓對、不算分、不排名，只保管
// 「本輪配對、裁判回報、輪次鎖定狀態、稽核紀錄」。
import { Hono } from 'hono';

export type Env = {
    DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

// Phase 0 驗收端點：確認 Worker 起得來且 D1 binding 可用
app.get('/health', async (c) => {
    const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return c.json({
        ok: row?.ok === 1,
        service: 'wgp-score-relay',
        db: row?.ok === 1 ? 'up' : 'down',
    });
});

// Phase 1 起實作 Admin / Judge API（見規劃文件第 7 節）

export default app;
