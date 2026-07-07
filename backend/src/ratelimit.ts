// 簡易 rate limit（規劃文件 4.2：每 IP + 每 token）
// 固定視窗、per-isolate 記憶體。Workers isolate 可能隨時回收、多 isolate 各自計數，
// 屬 best-effort——以本賽事規模（每輪十幾筆）足以擋暴力猜 token 與手滑連打；
// 不追求分散式精確計數（那需要 Durable Objects，過度設計）。
import type { Context, Next } from 'hono';
import type { AppEnv } from './index';
import { clientIp } from './auth';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function hit(key: string, limit: number): boolean {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + 60_000 });
        return true;
    }
    b.count += 1;
    return b.count <= limit;
}

export function rateLimit() {
    return async (c: Context<AppEnv>, next: Next) => {
        const limit = Number(c.env.RATE_LIMIT_PER_MIN) > 0 ? Number(c.env.RATE_LIMIT_PER_MIN) : 120;
        const ipOk = hit(`ip:${clientIp(c)}`, limit);
        const auth = c.req.header('Authorization') || '';
        // token 各自限流（取雜湊前先截斷即可，僅作分桶 key 用）
        const tokenOk = auth ? hit(`tok:${auth.slice(-24)}`, limit) : true;
        if (!ipOk || !tokenOk) return c.json({ error: 'rate_limited' }, 429);
        return next();
    };
}
