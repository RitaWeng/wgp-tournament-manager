// Judge API（規劃文件第 7 節）：裁判只能看自己桌、送自己桌——
// 桌次由 token 決定，body 不能指定別桌（越權從結構上不可能）。
import { Hono } from 'hono';
import type { AppEnv } from './index';
import { requireJudge, clientIp } from './auth';
import { auditStmt } from './audit';

export const judge = new Hono<AppEnv>();

judge.use('/judge/*', requireJudge);

// 取自己桌的當前輪次對局：回最新已發佈輪次＋該桌配對（含鎖定狀態，
// 鎖定時裁判頁顯示「該輪已鎖定」而非送出按鈕）
judge.get('/judge/pairing', async (c) => {
    const eventId = c.get('eventId');
    const tableNo = c.get('tableNo');
    const round = await c.env.DB.prepare(
        'SELECT round_no, status FROM rounds WHERE event_id = ? ORDER BY round_no DESC LIMIT 1'
    ).bind(eventId).first<{ round_no: number; status: string }>();
    if (!round) return c.json({ roundNo: null, pairing: null });

    const event = await c.env.DB.prepare('SELECT name FROM events WHERE id = ?')
        .bind(eventId).first<{ name: string }>();
    const p = await c.env.DB.prepare(
        `SELECT player1_id, player1_name, player2_id, player2_name, result, version
           FROM pairings WHERE event_id = ? AND round_no = ? AND table_no = ?`
    ).bind(eventId, round.round_no, tableNo).first();
    return c.json({
        eventName: event?.name ?? '',
        tableNo,
        roundNo: round.round_no,
        locked: round.status === 'locked',
        pairing: p ?? null,
    });
});

// 提交結果：winner ∈ {1,2}，其餘欄位一律不收（4.2）。
// optimistic versioning：version 對上才寫入；重複送同結果 → idempotent；
// 改結果（更正）→ 記 revision 稽核，主控端醒目警示待確認。
judge.post('/judge/result', async (c) => {
    const eventId = c.get('eventId');
    const tableNo = c.get('tableNo');
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    const keys = Object.keys((body ?? {}) as object);
    if (keys.some((k) => !['roundNo', 'winner', 'version'].includes(k)))
        return c.json({ error: 'unexpected_field' }, 400);
    const { roundNo, winner, version } = (body ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(roundNo) || (roundNo as number) < 1) return c.json({ error: 'invalid_round' }, 400);
    if (winner !== 1 && winner !== 2) return c.json({ error: 'invalid_winner' }, 400);
    if (!Number.isInteger(version) || (version as number) < 0) return c.json({ error: 'invalid_version' }, 400);

    const round = await c.env.DB.prepare(
        'SELECT status FROM rounds WHERE event_id = ? AND round_no = ?'
    ).bind(eventId, roundNo).first<{ status: string }>();
    if (!round) return c.json({ error: 'round_not_found' }, 404);
    if (round.status === 'locked') return c.json({ error: 'round_locked' }, 409);

    const p = await c.env.DB.prepare(
        `SELECT result, version FROM pairings
          WHERE event_id = ? AND round_no = ? AND table_no = ?`
    ).bind(eventId, roundNo, tableNo).first<{ result: number | null; version: number }>();
    if (!p) return c.json({ error: 'pairing_not_found' }, 404);

    // 重複提交（同結果）→ idempotent，不改狀態；稽核記 duplicate 供比對
    if (p.result !== null && p.result === winner) {
        await auditStmt(c.env.DB, eventId, `table:${tableNo}`, 'duplicate_submit',
            { roundNo, winner, deviceId: c.get('deviceId') }, clientIp(c)).run();
        return c.json({ ok: true, result: p.result, version: p.version, revision: false });
    }
    // 版本對不上（並發更正 / 拿舊畫面送出）→ 讓裁判頁重抓再送
    if (version !== p.version) return c.json({ error: 'version_conflict', version: p.version }, 409);

    const isRevision = p.result !== null;
    const now = new Date().toISOString();
    const upd = await c.env.DB.prepare(
        `UPDATE pairings SET result = ?, version = version + 1, submitted_at = ?
          WHERE event_id = ? AND round_no = ? AND table_no = ? AND version = ?`
    ).bind(winner, now, eventId, roundNo, tableNo, version).run();
    if (!upd.meta.changes) return c.json({ error: 'version_conflict' }, 409);

    await auditStmt(c.env.DB, eventId, `table:${tableNo}`,
        isRevision ? 'revision' : 'submit',
        { roundNo, winner, prev: p.result, deviceId: c.get('deviceId') }, clientIp(c)).run();
    return c.json({ ok: true, result: winner, version: (version as number) + 1, revision: isRevision });
});
