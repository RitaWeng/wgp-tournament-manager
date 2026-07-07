// append-only 稽核（規劃文件 4.3）：只 INSERT，無任何 UPDATE/DELETE 路徑
// （「結束賽事」整場刪除是唯一例外，見 admin close）
import type { Env } from './index';

export function auditStmt(
    db: D1Database,
    eventId: string,
    actor: string,
    action: string,
    payload: unknown,
    ip: string
): D1PreparedStatement {
    return db.prepare(
        'INSERT INTO audit_log (event_id, actor, action, payload_json, ip) VALUES (?, ?, ?, ?, ?)'
    ).bind(eventId, actor, action, payload == null ? null : JSON.stringify(payload), ip);
}
