// Judge API（規劃文件第 7 節）：裁判只能看自己桌、送自己桌——
// 桌次由 token 決定，body 不能指定別桌（越權從結構上不可能）。
// GiveMe5 賽制：每桌五組（ABCDE）各分勝負（單組平手以加賽分出、標 overtime），
// 裁判回報「五組結果」，桌勝方由伺服器多數決推導（不信任前端）。
import { Hono } from 'hono';
import type { AppEnv } from './index';
import { requireJudge, clientIp } from './auth';
import { auditStmt } from './audit';

export const judge = new Hono<AppEnv>();

judge.use('/judge/*', requireJudge);

export type GroupResult = { winner: 1 | 2; overtime: boolean };

// 驗證並正規化五組結果；不合法回 null。
// 正規化字串同時作為重複提交（idempotent）比對的 canonical form。
export function normalizeGroups(raw: unknown): { groups: GroupResult[]; canonical: string; winner: 1 | 2 } | null {
    if (!Array.isArray(raw) || raw.length !== 5) return null;
    const groups: GroupResult[] = [];
    for (const g of raw) {
        if (typeof g !== 'object' || g === null) return null;
        const keys = Object.keys(g as object);
        if (keys.some((k) => k !== 'winner' && k !== 'overtime')) return null;
        const { winner, overtime } = g as Record<string, unknown>;
        if (winner !== 1 && winner !== 2) return null;
        if (typeof overtime !== 'boolean') return null;
        groups.push({ winner, overtime });
    }
    const wins1 = groups.filter((g) => g.winner === 1).length;
    // 五組無平手 → wins1 ∈ 0..5 且 ≠ 2.5，多數決恆明確
    const winner: 1 | 2 = wins1 >= 3 ? 1 : 2;
    return { groups, canonical: JSON.stringify(groups), winner };
}

// 取自己桌的當前輪次對局：回最新已發佈輪次＋該桌配對（含鎖定狀態與已回報的五組明細，
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
        `SELECT player1_id, player1_name, player2_id, player2_name, result, groups_json, version, rejected_version
           FROM pairings WHERE event_id = ? AND round_no = ? AND table_no = ?`
    ).bind(eventId, round.round_no, tableNo).first<any>();
    return c.json({
        eventName: event?.name ?? '',
        tableNo,
        roundNo: round.round_no,
        locked: round.status === 'locked',
        pairing: p ? {
            ...p,
            groups: p.groups_json ? JSON.parse(p.groups_json) : null,
            groups_json: undefined,
            // 目前這個版本被操作者「維持現狀」拒絕採計 → 裁判頁顯示「請洽計分台」；
            // 裁判再更正（版本遞增）後自動解除
            rejected: p.rejected_version !== null && p.rejected_version === p.version,
            rejected_version: undefined,
        } : null,
    });
});

// 提交五組結果：groups 必為 5 筆 {winner∈{1,2}, overtime:boolean}，其餘欄位一律不收（4.2）。
// 桌勝方由伺服器推導。optimistic versioning：version 對上才寫入；
// 重複送同內容 → idempotent；內容有變（更正）→ 記 revision 稽核（桌勝方是否改變一併入稽核，
// 主控端據此決定醒目警示或靜默更新組明細）。
judge.post('/judge/result', async (c) => {
    const eventId = c.get('eventId');
    const tableNo = c.get('tableNo');
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    const keys = Object.keys((body ?? {}) as object);
    if (keys.some((k) => !['roundNo', 'groups', 'version'].includes(k)))
        return c.json({ error: 'unexpected_field' }, 400);
    const { roundNo, groups: rawGroups, version } = (body ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(roundNo) || (roundNo as number) < 1) return c.json({ error: 'invalid_round' }, 400);
    if (!Number.isInteger(version) || (version as number) < 0) return c.json({ error: 'invalid_version' }, 400);
    const norm = normalizeGroups(rawGroups);
    if (!norm) return c.json({ error: 'invalid_groups' }, 400);

    const round = await c.env.DB.prepare(
        'SELECT status FROM rounds WHERE event_id = ? AND round_no = ?'
    ).bind(eventId, roundNo).first<{ status: string }>();
    if (!round) return c.json({ error: 'round_not_found' }, 404);
    if (round.status === 'locked') return c.json({ error: 'round_locked' }, 409);

    const p = await c.env.DB.prepare(
        `SELECT result, groups_json, version FROM pairings
          WHERE event_id = ? AND round_no = ? AND table_no = ?`
    ).bind(eventId, roundNo, tableNo).first<{ result: number | null; groups_json: string | null; version: number }>();
    if (!p) return c.json({ error: 'pairing_not_found' }, 404);

    // 重複提交（五組內容完全相同）→ idempotent，不改狀態；稽核記 duplicate 供比對
    if (p.result !== null && p.groups_json === norm.canonical) {
        await auditStmt(c.env.DB, eventId, `table:${tableNo}`, 'duplicate_submit',
            { roundNo, groups: norm.groups, deviceId: c.get('deviceId') }, clientIp(c)).run();
        return c.json({ ok: true, result: p.result, groups: norm.groups, version: p.version, revision: false });
    }
    // 版本對不上（並發更正 / 拿舊畫面送出）→ 讓裁判頁重抓再送
    if (version !== p.version) return c.json({ error: 'version_conflict', version: p.version }, 409);

    const isRevision = p.result !== null;
    const resultChanged = isRevision && p.result !== norm.winner;
    const now = new Date().toISOString();
    const upd = await c.env.DB.prepare(
        `UPDATE pairings SET result = ?, groups_json = ?, version = version + 1, submitted_at = ?
          WHERE event_id = ? AND round_no = ? AND table_no = ? AND version = ?`
    ).bind(norm.winner, norm.canonical, now, eventId, roundNo, tableNo, version).run();
    if (!upd.meta.changes) return c.json({ error: 'version_conflict' }, 409);

    await auditStmt(c.env.DB, eventId, `table:${tableNo}`,
        isRevision ? 'revision' : 'submit',
        { roundNo, winner: norm.winner, groups: norm.groups, prev: p.result, resultChanged, deviceId: c.get('deviceId') },
        clientIp(c)).run();
    return c.json({ ok: true, result: norm.winner, groups: norm.groups, version: (version as number) + 1, revision: isRevision });
});
