// Admin API（規劃文件第 7 節）：建立賽事、發佈桌次、鎖定/解鎖、收成績、
// 各桌狀態、稽核查詢、結束賽事。除 POST /events 外皆需 admin token。
import { Hono } from 'hono';
import type { AppEnv } from './index';
import { randomHex, sha256Hex, clientIp, requireAdmin } from './auth';
import { auditStmt } from './audit';

export const admin = new Hono<AppEnv>();

// 建立賽事：回傳 admin token 與各桌 table token（僅此一次明文回傳，之後只存雜湊）
admin.post('/events', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    const { name, tables } = (body ?? {}) as { name?: unknown; tables?: unknown };
    if (typeof name !== 'string' || !name.trim() || name.length > 100)
        return c.json({ error: 'invalid_name' }, 400);
    if (!Number.isInteger(tables) || (tables as number) < 1 || (tables as number) > 50)
        return c.json({ error: 'invalid_tables' }, 400);

    const eventId = randomHex(16);
    const adminToken = randomHex(16);
    const tableTokens: { tableNo: number; token: string }[] = [];
    const stmts: D1PreparedStatement[] = [
        c.env.DB.prepare('INSERT INTO events (id, name, admin_token_hash) VALUES (?, ?, ?)')
            .bind(eventId, name.trim(), await sha256Hex(adminToken)),
    ];
    for (let t = 1; t <= (tables as number); t++) {
        const token = randomHex(16);
        tableTokens.push({ tableNo: t, token });
        stmts.push(
            c.env.DB.prepare('INSERT INTO tables (event_id, table_no, token_hash) VALUES (?, ?, ?)')
                .bind(eventId, t, await sha256Hex(token))
        );
    }
    stmts.push(auditStmt(c.env.DB, eventId, 'admin', 'create_event',
        { name: name.trim(), tables }, clientIp(c)));
    await c.env.DB.batch(stmts);
    return c.json({ eventId, adminToken, tableTokens });
});

// 發佈本輪配對：round 為 open（或尚未發佈）時可重複發佈（重新抓對情境），
// 舊配對整輪換掉；locked 輪須先解鎖。輪空（BYE）由主控端過濾，不會進來。
admin.post('/events/:id/rounds/:n/pairings', requireAdmin, async (c) => {
    const eventId = c.get('eventId');
    const roundNo = Number(c.req.param('n'));
    if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > 99)
        return c.json({ error: 'invalid_round' }, 400);

    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    const pairings = (body as { pairings?: unknown })?.pairings;
    if (!Array.isArray(pairings) || pairings.length === 0 || pairings.length > 50)
        return c.json({ error: 'invalid_pairings' }, 400);
    for (const p of pairings) {
        const { tableNo, player1Id, player1Name, player2Id, player2Name } = (p ?? {}) as Record<string, unknown>;
        if (!Number.isInteger(tableNo) || (tableNo as number) < 1) return c.json({ error: 'invalid_table_no' }, 400);
        if (!Number.isInteger(player1Id) || !Number.isInteger(player2Id) ||
            (player1Id as number) < 1 || (player2Id as number) < 1 || player1Id === player2Id)
            return c.json({ error: 'invalid_player_ids' }, 400);
        if (typeof player1Name !== 'string' || typeof player2Name !== 'string' ||
            (player1Name as string).length > 100 || (player2Name as string).length > 100)
            return c.json({ error: 'invalid_player_names' }, 400);
    }

    const round = await c.env.DB.prepare(
        'SELECT status FROM rounds WHERE event_id = ? AND round_no = ?'
    ).bind(eventId, roundNo).first<{ status: string }>();
    if (round?.status === 'locked') return c.json({ error: 'round_locked' }, 409);

    const now = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [
        c.env.DB.prepare('DELETE FROM pairings WHERE event_id = ? AND round_no = ?').bind(eventId, roundNo),
        c.env.DB.prepare(
            `INSERT INTO rounds (event_id, round_no, status, published_at) VALUES (?, ?, 'open', ?)
             ON CONFLICT (event_id, round_no) DO UPDATE SET status = 'open', published_at = ?`
        ).bind(eventId, roundNo, now, now),
    ];
    for (const p of pairings as Record<string, number & string>[]) {
        stmts.push(c.env.DB.prepare(
            `INSERT INTO pairings (event_id, round_no, table_no, player1_id, player1_name, player2_id, player2_name)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(eventId, roundNo, p.tableNo, p.player1Id, p.player1Name, p.player2Id, p.player2Name));
    }
    stmts.push(auditStmt(c.env.DB, eventId, 'admin', 'publish_pairings',
        { roundNo, tables: (pairings as unknown[]).length }, clientIp(c)));
    await c.env.DB.batch(stmts);
    return c.json({ ok: true, roundNo, published: (pairings as unknown[]).length });
});

// 鎖定/解鎖輪次：主控端「算分」→ lock（伺服器即拒收該輪提交）；「解除鎖定」→ unlock
admin.post('/events/:id/rounds/:n/:op{lock|unlock}', requireAdmin, async (c) => {
    const eventId = c.get('eventId');
    const roundNo = Number(c.req.param('n'));
    const op = c.req.param('op');
    if (!Number.isInteger(roundNo) || roundNo < 1) return c.json({ error: 'invalid_round' }, 400);
    const status = op === 'lock' ? 'locked' : 'open';
    await c.env.DB.batch([
        c.env.DB.prepare(
            `INSERT INTO rounds (event_id, round_no, status) VALUES (?, ?, ?)
             ON CONFLICT (event_id, round_no) DO UPDATE SET status = ?`
        ).bind(eventId, roundNo, status, status),
        auditStmt(c.env.DB, eventId, 'admin', op === 'lock' ? 'lock_round' : 'unlock_round',
            { roundNo }, clientIp(c)),
    ]);
    return c.json({ ok: true, roundNo, status });
});

// 拒絕採計（操作者對 revision 警示按「維持現狀」）：記下被拒的 version，
// 裁判頁輪詢看到後顯示「更正未被採計，請洽計分台」。不動 result/groups——
// 伺服器只是中繼，主控端本地的結果即為權威；帶 version 守衛避免誤拒裁判剛送的新版本
admin.post('/events/:id/rounds/:n/tables/:t/reject', requireAdmin, async (c) => {
    const eventId = c.get('eventId');
    const roundNo = Number(c.req.param('n'));
    const tableNo = Number(c.req.param('t'));
    if (!Number.isInteger(roundNo) || roundNo < 1 || !Number.isInteger(tableNo) || tableNo < 1)
        return c.json({ error: 'invalid_params' }, 400);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    const { version } = (body ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(version) || (version as number) < 1) return c.json({ error: 'invalid_version' }, 400);

    const upd = await c.env.DB.prepare(
        `UPDATE pairings SET rejected_version = ?
          WHERE event_id = ? AND round_no = ? AND table_no = ? AND version = ?`
    ).bind(version, eventId, roundNo, tableNo, version).run();
    // 版本已前進（裁判又送了更新的版本）→ 這筆拒絕作廢，主控端會再收到新版本重新判斷
    if (!upd.meta.changes) return c.json({ error: 'version_conflict' }, 409);

    await auditStmt(c.env.DB, eventId, 'admin', 'reject_result',
        { roundNo, tableNo, version }, clientIp(c)).run();
    return c.json({ ok: true, roundNo, tableNo, rejectedVersion: version });
});

// 收裁判回報：規模小（每輪十幾桌），直接回傳全部已回報配對，主控端冪等合併；
// ?since=<ISO> 可做增量（比較 submitted_at）
admin.get('/events/:id/results', requireAdmin, async (c) => {
    const eventId = c.get('eventId');
    const since = c.req.query('since') || '';
    const rows = await c.env.DB.prepare(
        `SELECT round_no, table_no, player1_id, player2_id, result, groups_json, version, submitted_at
           FROM pairings
          WHERE event_id = ? AND result IS NOT NULL AND submitted_at > ?
          ORDER BY submitted_at`
    ).bind(eventId, since).all();
    return c.json({ serverTime: new Date().toISOString(), results: rows.results });
});

// 各桌狀態（開賽前檢查 + 全程監看）：last_seen、目前 device、device 變化次數
admin.get('/events/:id/tables/status', requireAdmin, async (c) => {
    const eventId = c.get('eventId');
    const rows = await c.env.DB.prepare(
        `SELECT table_no, last_seen_at, last_device_id, device_change_count
           FROM tables WHERE event_id = ? ORDER BY table_no`
    ).bind(eventId).all();
    return c.json({ tables: rows.results });
});

// 稽核紀錄查詢（4.3：主控端可查「異動紀錄」）
admin.get('/events/:id/audit', requireAdmin, async (c) => {
    const eventId = c.get('eventId');
    const limit = Math.min(Number(c.req.query('limit')) || 200, 1000);
    const rows = await c.env.DB.prepare(
        'SELECT ts, actor, action, payload_json FROM audit_log WHERE event_id = ? ORDER BY id DESC LIMIT ?'
    ).bind(eventId, limit).all();
    return c.json({ audit: rows.results });
});

// 結束賽事：立即刪除該場全部資料（token 隨之失效）。個資最小化的主要手段；
// 另有 7 天 retention 排程作雙保險（見 index.ts scheduled）
admin.post('/events/:id/close', requireAdmin, async (c) => {
    const eventId = c.get('eventId');
    await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM pairings WHERE event_id = ?').bind(eventId),
        c.env.DB.prepare('DELETE FROM rounds WHERE event_id = ?').bind(eventId),
        c.env.DB.prepare('DELETE FROM tables WHERE event_id = ?').bind(eventId),
        c.env.DB.prepare('DELETE FROM audit_log WHERE event_id = ?').bind(eventId),
        c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId),
    ]);
    return c.json({ ok: true, deleted: eventId });
});
