// 認證與 token 工具
// 模型見規劃文件 4.1：capability token（admin / table 兩種，權限嚴格分離），
// 伺服器只存 SHA-256 雜湊；token 為 128-bit 隨機值 hex 編碼。
import type { Context, Next } from 'hono';
import type { AppEnv } from './index';

export function randomHex(bytes: number): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bearerToken(c: Context): string | null {
    const h = c.req.header('Authorization') || '';
    const m = h.match(/^Bearer\s+([0-9a-f]{32,64})$/i);
    return m ? m[1].toLowerCase() : null;
}

// Admin 中介層：Bearer token 必須對上路由參數 :id 那場賽事的 admin_token_hash，
// 且賽事仍為 active（結束賽事即失效）
export async function requireAdmin(c: Context<AppEnv>, next: Next) {
    const token = bearerToken(c);
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    const eventId = c.req.param('id');
    const hash = await sha256Hex(token);
    const event = await c.env.DB.prepare(
        "SELECT id, name FROM events WHERE id = ? AND admin_token_hash = ? AND status = 'active'"
    ).bind(eventId, hash).first<{ id: string; name: string }>();
    if (!event) return c.json({ error: 'unauthorized' }, 401);
    c.set('eventId', event.id);
    return next();
}

// Judge 中介層：以 table token 反查桌次；順帶做軟性裝置偵測——
// device_id 變化「不拒絕」（回計分台重掃本來就合法），但入稽核並累計，
// 由主控端「各桌狀態」標示異常
export async function requireJudge(c: Context<AppEnv>, next: Next) {
    const token = bearerToken(c);
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    const hash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
        `SELECT t.event_id, t.table_no, t.last_device_id
           FROM tables t JOIN events e ON e.id = t.event_id
          WHERE t.token_hash = ? AND e.status = 'active'`
    ).bind(hash).first<{ event_id: string; table_no: number; last_device_id: string | null }>();
    if (!row) return c.json({ error: 'unauthorized' }, 401);

    const deviceId = (c.req.header('X-Device-Id') || '').slice(0, 64) || null;
    const now = new Date().toISOString();
    if (deviceId && row.last_device_id && deviceId !== row.last_device_id) {
        await c.env.DB.batch([
            c.env.DB.prepare(
                'UPDATE tables SET last_device_id = ?, last_seen_at = ?, device_change_count = device_change_count + 1 WHERE event_id = ? AND table_no = ?'
            ).bind(deviceId, now, row.event_id, row.table_no),
            c.env.DB.prepare(
                'INSERT INTO audit_log (event_id, actor, action, payload_json, ip) VALUES (?, ?, ?, ?, ?)'
            ).bind(row.event_id, `table:${row.table_no}`, 'device_change',
                JSON.stringify({ from: row.last_device_id, to: deviceId }), clientIp(c)),
        ]);
    } else {
        await c.env.DB.prepare(
            'UPDATE tables SET last_device_id = COALESCE(?, last_device_id), last_seen_at = ? WHERE event_id = ? AND table_no = ?'
        ).bind(deviceId, now, row.event_id, row.table_no).run();
    }

    c.set('eventId', row.event_id);
    c.set('tableNo', row.table_no);
    c.set('deviceId', deviceId);
    return next();
}

export function clientIp(c: Context): string {
    return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
}
