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
        const auth = c.req.header('Authorization') || '';
        // 只有格式正確的 Bearer token（同 auth.ts 的驗法）才視為「帶 token」；
        // 亂寫 header 的探測回到未認證窄桶，拿不到放寬額度
        const wellFormed = /^Bearer\s+[0-9a-f]{32,64}$/i.test(auth);
        // token 各自限流（取尾段即可，僅作分桶 key 用）
        const tokenOk = wellFormed ? hit(`tok:${auth.slice(-24)}`, limit) : true;
        // 帶 token 的請求以 per-token 桶為主，IP 桶放寬 10 倍：場地 Wi-Fi/NAT 下全場共用
        // 一個公網 IP，50 桌 × 每 10 秒輪詢 ≈ 300 req/min，基本額度會誤傷正常流量。
        // 未帶 token 的請求（建立賽事等）維持基本額度，且與帶 token 流量分桶，
        // 裁判輪詢才不會把未認證端點的額度吃光。偽造正確格式仍可拿到寬桶——
        // token 為 128-bit 隨機值猜不中，剩餘風險是燒每日請求額度，屬既有攻擊面
        // （多 IP 本就繞得過 per-IP 限流），邊緣防護應由 Cloudflare WAF 規則承擔。
        const ipOk = wellFormed
            ? hit(`ipa:${clientIp(c)}`, limit * 10)
            : hit(`ip:${clientIp(c)}`, limit);
        if (!ipOk || !tokenOk) return c.json({ error: 'rate_limited' }, 429);
        return next();
    };
}
