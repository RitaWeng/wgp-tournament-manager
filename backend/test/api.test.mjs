// 後端整合測試：spawn 真實 wrangler dev（本地 D1、乾淨 persist 目錄）打 HTTP。
// 覆蓋 Phase 1 驗收條件：越權提交被拒、locked 輪次提交被拒、重複提交 idempotent、
// 錯誤 token 401、device_id 變化入稽核並可由主控端查得；另加 CORS 與 rate limit。
// 跑法：npm test（結束碼 0 = 全過）
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Windows 相容：spawn 'npx' 在 Windows 找不到執行檔（ENOENT），且經 shell 會讓
// kill 只殺到外殼、wrangler 殘留佔埠。改以 node 直接執行 wrangler 的 JS 入口，
// 跨平台一致、kill 也確實。URL.pathname 在 Windows 是 /C:/... 需 fileURLToPath 轉換。
const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));
const WRANGLER_JS = join(BACKEND_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'https://ritaweng.github.io';

let passed = 0;
const failures = [];
async function t(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failures.push(name); console.log(`  ❌ ${name}: ${e.message}`); }
}

function startServer(persistDir, extraArgs = []) {
    const proc = spawn(process.execPath, [
        WRANGLER_JS, 'dev', '--port', String(PORT), '--persist-to', persistDir, ...extraArgs,
    ], { cwd: BACKEND_DIR, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore' });
    return proc;
}

// 停伺服器：Windows 的 kill() 是強制終止、wrangler 來不及收掉 workerd 子程序
// （殘留佔埠會讓後面的測試打到舊伺服器），改用 taskkill 殺整個程序樹
function stopServer(proc) {
    if (process.platform === 'win32' && proc.pid) {
        spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
    } else {
        proc.kill('SIGTERM');
    }
}

async function waitReady() {
    for (let i = 0; i < 60; i++) {
        try { await fetch(`${BASE}/health`); return; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('wrangler dev 起不來');
}

async function applySchema(persistDir) {
    await new Promise((resolve, reject) => {
        const p = spawn(process.execPath, [
            WRANGLER_JS, 'd1', 'execute', 'wgp_score_relay', '--local',
            '--file=./schema.sql', '--persist-to', persistDir,
        ], { cwd: BACKEND_DIR, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore' });
        p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`schema exit ${code}`))));
    });
}

// 帶 Origin 的 helper（模擬瀏覽器跨站呼叫）
const api = (path, { method = 'GET', token, body, device, key } = {}) =>
    fetch(`${BASE}${path}`, {
        method,
        headers: {
            Origin: ORIGIN,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(device ? { 'X-Device-Id': device } : {}),
            ...(key ? { 'X-Setup-Key': key } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });

// 五組（ABCDE）結果 helper：winners = [1|2 ×5]，otIdx = 加賽的組索引
const mkGroups = (winners, otIdx = []) =>
    winners.map((w, i) => ({ winner: w, overtime: otIdx.includes(i) }));

const SETUP_KEY = 'test-setup-key';
const persist = mkdtempSync(join(tmpdir(), 'wgp-relay-test-'));
await applySchema(persist);
let server = startServer(persist, ['--var', `SETUP_KEY:${SETUP_KEY}`]);

try {
    await waitReady();
    console.log('▶ 基本功能');

    await t('建立賽事需 SETUP_KEY：未帶 401、帶錯 401', async () => {
        const noKey = await api('/events', { method: 'POST', body: { name: 'x', tables: 3 } });
        assert.equal(noKey.status, 401);
        assert.equal((await noKey.json()).error, 'setup_key_required');
        const badKey = await api('/events', { method: 'POST', key: 'wrong-key', body: { name: 'x', tables: 3 } });
        assert.equal(badKey.status, 401);
    });

    let eventId, adminToken, tableTokens;
    await t('建立賽事回傳 token（僅此一次）', async () => {
        const r = await api('/events', { method: 'POST', key: SETUP_KEY, body: { name: '整合測試賽', tables: 3 } });
        assert.equal(r.status, 200);
        ({ eventId, adminToken, tableTokens } = await r.json());
        assert.equal(tableTokens.length, 3);
        assert.match(adminToken, /^[0-9a-f]{32}$/);
    });

    await t('建立賽事輸入驗證（tables=0 → 400）', async () => {
        const r = await api('/events', { method: 'POST', key: SETUP_KEY, body: { name: 'x', tables: 0 } });
        assert.equal(r.status, 400);
    });

    await t('錯誤 token → 401（admin 與 judge）', async () => {
        const bad = '0'.repeat(32);
        assert.equal((await api(`/events/${eventId}/results`, { token: bad })).status, 401);
        assert.equal((await api('/judge/pairing', { token: bad })).status, 401);
        assert.equal((await api(`/events/${eventId}/results`, {})).status, 401);
    });

    await t('judge token 打 admin API → 401（權限分離）', async () => {
        const r = await api(`/events/${eventId}/rounds/1/lock`, { method: 'POST', token: tableTokens[0].token });
        assert.equal(r.status, 401);
    });

    await t('發佈 R1 配對（桌 1、2）', async () => {
        const r = await api(`/events/${eventId}/rounds/1/pairings`, {
            method: 'POST', token: adminToken,
            body: { pairings: [
                { tableNo: 1, player1Id: 1, player1Name: '學校01', player2Id: 2, player2Name: '學校02' },
                { tableNo: 2, player1Id: 3, player1Name: '學校03', player2Id: 4, player2Name: '學校04' },
            ] },
        });
        assert.equal(r.status, 200);
        assert.equal((await r.json()).published, 2);
    });

    await t('裁判只看得到自己桌的對局（未回報時 groups=null）', async () => {
        const r = await api('/judge/pairing', { token: tableTokens[0].token, device: 'device-A' });
        const j = await r.json();
        assert.equal(j.roundNo, 1);
        assert.equal(j.tableNo, 1);
        assert.equal(j.pairing.player1_name, '學校01');
        assert.equal(j.pairing.groups, null);
        assert.equal(j.locked, false);
    });

    await t('未排桌的裁判（桌 3）拿到空配對、提交被拒 404', async () => {
        const r = await api('/judge/pairing', { token: tableTokens[2].token, device: 'device-C' });
        assert.equal((await r.json()).pairing, null);
        const s = await api('/judge/result', {
            method: 'POST', token: tableTokens[2].token, device: 'device-C',
            body: { roundNo: 1, groups: mkGroups([1, 1, 1, 1, 1]), version: 0 },
        });
        assert.equal(s.status, 404); // 越權（本桌無此對局）被拒
    });

    await t('提交五組結果成功（3:2、D 組加賽 → 伺服器推導勝方 1）', async () => {
        const r = await api('/judge/result', {
            method: 'POST', token: tableTokens[0].token, device: 'device-A',
            body: { roundNo: 1, groups: mkGroups([1, 2, 1, 2, 1], [3]), version: 0 },
        });
        assert.equal(r.status, 200);
        const j = await r.json();
        assert.deepEqual([j.result, j.version, j.revision], [1, 1, false]);
        assert.equal(j.groups[3].overtime, true);
    });

    await t('重複提交同內容 → idempotent（版本不變）', async () => {
        const r = await api('/judge/result', {
            method: 'POST', token: tableTokens[0].token, device: 'device-A',
            body: { roundNo: 1, groups: mkGroups([1, 2, 1, 2, 1], [3]), version: 0 },
        });
        assert.equal(r.status, 200);
        const j = await r.json();
        assert.deepEqual([j.result, j.version, j.revision], [1, 1, false]);
    });

    await t('更正（改 C 組 → 桌勝方翻成 2）→ revision＋版本遞增', async () => {
        const r = await api('/judge/result', {
            method: 'POST', token: tableTokens[0].token, device: 'device-A',
            body: { roundNo: 1, groups: mkGroups([1, 2, 2, 2, 1], [3]), version: 1 },
        });
        const j = await r.json();
        assert.deepEqual([j.result, j.version, j.revision], [2, 2, true]);
    });

    await t('只改組明細（桌勝方不變：補記 A 組加賽）→ 仍為 revision、版本遞增', async () => {
        const r = await api('/judge/result', {
            method: 'POST', token: tableTokens[0].token, device: 'device-A',
            body: { roundNo: 1, groups: mkGroups([1, 2, 2, 2, 1], [0, 3]), version: 2 },
        });
        const j = await r.json();
        assert.deepEqual([j.result, j.version, j.revision], [2, 3, true]);
    });

    await t('拿舊版本改結果 → 409 version_conflict', async () => {
        const r = await api('/judge/result', {
            method: 'POST', token: tableTokens[0].token, device: 'device-A',
            body: { roundNo: 1, groups: mkGroups([1, 1, 1, 1, 1]), version: 0 },
        });
        assert.equal(r.status, 409);
    });

    await t('輸入竄改被拒：組勝方=3、四組、group 多餘鍵、overtime 非布林、body 多餘欄位、version 非整數', async () => {
        const mk = (body) => api('/judge/result', { method: 'POST', token: tableTokens[1].token, device: 'device-B', body });
        assert.equal((await mk({ roundNo: 1, groups: mkGroups([3, 1, 1, 1, 1]), version: 0 })).status, 400);
        assert.equal((await mk({ roundNo: 1, groups: mkGroups([1, 1, 1, 1]), version: 0 })).status, 400);
        assert.equal((await mk({ roundNo: 1, groups: [{ winner: 1, overtime: false, hack: 1 }, ...mkGroups([1, 1, 1, 1])], version: 0 })).status, 400);
        assert.equal((await mk({ roundNo: 1, groups: [{ winner: 1, overtime: 'yes' }, ...mkGroups([1, 1, 1, 1])], version: 0 })).status, 400);
        assert.equal((await mk({ roundNo: 1, groups: mkGroups([1, 1, 1, 1, 1]), version: 0, hack: true })).status, 400);
        assert.equal((await mk({ roundNo: 1, groups: mkGroups([1, 1, 1, 1, 1]), version: 'x' })).status, 400);
    });

    await t('鎖定後提交 → 409 round_locked；解鎖後恢復可交', async () => {
        await api(`/events/${eventId}/rounds/1/lock`, { method: 'POST', token: adminToken });
        const locked = await api('/judge/result', {
            method: 'POST', token: tableTokens[1].token, device: 'device-B',
            body: { roundNo: 1, groups: mkGroups([1, 1, 1, 2, 2]), version: 0 },
        });
        assert.equal(locked.status, 409);
        assert.equal((await locked.json()).error, 'round_locked');
        const pv = await (await api('/judge/pairing', { token: tableTokens[1].token, device: 'device-B' })).json();
        assert.equal(pv.locked, true);
        await api(`/events/${eventId}/rounds/1/unlock`, { method: 'POST', token: adminToken });
        const ok = await api('/judge/result', {
            method: 'POST', token: tableTokens[1].token, device: 'device-B',
            body: { roundNo: 1, groups: mkGroups([2, 2, 1, 2, 1]), version: 0 },
        });
        assert.equal(ok.status, 200);
    });

    await t('locked 輪不可重新發佈 → 409', async () => {
        await api(`/events/${eventId}/rounds/1/lock`, { method: 'POST', token: adminToken });
        const r = await api(`/events/${eventId}/rounds/1/pairings`, {
            method: 'POST', token: adminToken,
            body: { pairings: [{ tableNo: 1, player1Id: 5, player1Name: 'x', player2Id: 6, player2Name: 'y' }] },
        });
        assert.equal(r.status, 409);
    });

    await t('主控端收成績：兩桌結果、五組明細、revision 可辨識（version≥2）', async () => {
        const r = await api(`/events/${eventId}/results`, { token: adminToken });
        const j = await r.json();
        assert.equal(j.results.length, 2);
        const t1 = j.results.find((x) => x.table_no === 1);
        assert.deepEqual([t1.result, t1.version], [2, 3]); // 更正兩次（翻勝方＋補加賽）
        const g1 = JSON.parse(t1.groups_json);
        assert.equal(g1.length, 5);
        assert.deepEqual([g1[0].overtime, g1[3].overtime], [true, true]);
        const t2 = j.results.find((x) => x.table_no === 2);
        assert.deepEqual([t2.result, t2.version], [2, 1]); // 一次到位
    });

    await t('results 附帶各輪鎖定狀態（P0.1 無狀態對帳）：lock/unlock 反映於 rounds', async () => {
        // 上個測項結束時第 1 輪為 locked
        const j1 = await (await api(`/events/${eventId}/results`, { token: adminToken })).json();
        assert.deepEqual(j1.rounds, [{ round_no: 1, status: 'locked' }]);
        // 解鎖後 rounds 反映 open（下個 reject 測項本就預期第 1 輪開放，先解無妨）
        await api(`/events/${eventId}/rounds/1/unlock`, { method: 'POST', token: adminToken });
        const j2 = await (await api(`/events/${eventId}/results`, { token: adminToken })).json();
        assert.deepEqual(j2.rounds, [{ round_no: 1, status: 'open' }]);
    });

    await t('拒絕採計：reject 後裁判頁標示、再更正即解除、過時版本 409、權限分離', async () => {
        // 前一個測項讓第 1 輪停在 locked，先解鎖（reject/更正都是開放輪次的情境）
        await api(`/events/${eventId}/rounds/1/unlock`, { method: 'POST', token: adminToken });
        // 操作者「維持現狀」→ 記下被拒版本（桌 1 目前 version=3）
        const rj = await api(`/events/${eventId}/rounds/1/tables/1/reject`, {
            method: 'POST', token: adminToken, body: { version: 3 },
        });
        assert.equal(rj.status, 200);
        let pv = await (await api('/judge/pairing', { token: tableTokens[0].token, device: 'device-A' })).json();
        assert.equal(pv.pairing.rejected, true);
        // 裁判再更正（version 3→4）→ 未採計標示自動解除
        const ok = await api('/judge/result', {
            method: 'POST', token: tableTokens[0].token, device: 'device-A',
            body: { roundNo: 1, groups: mkGroups([1, 2, 1, 2, 1]), version: 3 },
        });
        assert.equal(ok.status, 200);
        pv = await (await api('/judge/pairing', { token: tableTokens[0].token, device: 'device-A' })).json();
        assert.equal(pv.pairing.rejected, false);
        // 拿已過時的版本 reject → 409（裁判已送新版本，這筆拒絕作廢）
        assert.equal((await api(`/events/${eventId}/rounds/1/tables/1/reject`, {
            method: 'POST', token: adminToken, body: { version: 3 },
        })).status, 409);
        // judge token 打 reject → 401（權限分離）
        assert.equal((await api(`/events/${eventId}/rounds/1/tables/1/reject`, {
            method: 'POST', token: tableTokens[0].token, body: { version: 4 },
        })).status, 401);
    });

    await t('device_id 變化：不拒絕、入稽核、狀態一覽可查', async () => {
        // 桌 1 換裝置（模擬 token 外洩或換機）
        const r = await api('/judge/pairing', { token: tableTokens[0].token, device: 'device-EVIL' });
        assert.equal(r.status, 200); // 軟性偵測：不拒絕
        const st = await (await api(`/events/${eventId}/tables/status`, { token: adminToken })).json();
        const t1 = st.tables.find((x) => x.table_no === 1);
        assert.equal(t1.device_change_count, 1);
        assert.equal(t1.last_device_id, 'device-EVIL');
        const au = await (await api(`/events/${eventId}/audit`, { token: adminToken })).json();
        const chg = au.audit.find((a) => a.action === 'device_change');
        assert.ok(chg, '稽核應有 device_change');
        assert.match(chg.payload_json, /device-EVIL/);
    });

    await t('稽核 append-only：submit / revision / lock 全都在', async () => {
        const au = await (await api(`/events/${eventId}/audit`, { token: adminToken })).json();
        const actions = au.audit.map((a) => a.action);
        for (const a of ['create_event', 'publish_pairings', 'submit', 'duplicate_submit', 'revision', 'lock_round', 'unlock_round'])
            assert.ok(actions.includes(a), `缺 ${a}`);
    });

    console.log('▶ CORS');
    await t('allowlist 內 preflight 放行、外部 origin 不給 ACAO', async () => {
        const ok = await fetch(`${BASE}/judge/pairing`, {
            method: 'OPTIONS',
            headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
        });
        assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
        const evil = await fetch(`${BASE}/judge/pairing`, {
            method: 'OPTIONS',
            headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
        });
        assert.equal(evil.headers.get('Access-Control-Allow-Origin'), null);
    });

    console.log('▶ 結束賽事');
    await t('close 即刪資料、兩種 token 全部失效', async () => {
        const r = await api(`/events/${eventId}/close`, { method: 'POST', token: adminToken });
        assert.equal(r.status, 200);
        assert.equal((await api(`/events/${eventId}/results`, { token: adminToken })).status, 401);
        assert.equal((await api('/judge/pairing', { token: tableTokens[0].token })).status, 401);
    });

    await t('未知路由 404', async () => {
        assert.equal((await api('/nope', {})).status, 404);
    });
} finally {
    stopServer(server);
    await new Promise((r) => setTimeout(r, 1500));
}

// ── rate limit：另起低限額伺服器驗證 429 ───────────────────
console.log('▶ Rate limit（RATE_LIMIT_PER_MIN=5）');
const persist2 = mkdtempSync(join(tmpdir(), 'wgp-relay-rl-'));
await applySchema(persist2);
server = startServer(persist2, ['--var', 'RATE_LIMIT_PER_MIN:5', '--var', `SETUP_KEY:${SETUP_KEY}`]);
try {
    await waitReady();

    // 順序刻意：先建賽事（未認證額度還沒被吃）→ 帶 token 測試 → 最後才連打 /health
    let rlTokens;
    await t('低限額伺服器建立賽事', async () => {
        const r = await api('/events', { method: 'POST', key: SETUP_KEY, body: { name: 'rl', tables: 3 } });
        assert.equal(r.status, 200);
        rlTokens = (await r.json()).tableTokens;
    });

    await t('場地共用 IP：多桌 token 各自輪詢不觸發 IP 限流', async () => {
        // 3 桌 × 4 次 = 12 次同 IP 請求 > 未認證額度 5，但帶 token 的 IP 桶是 5×10，
        // 每 token 4 次也在額度內 → 全數放行（模擬全場裁判在同一個場地 Wi-Fi/NAT 後面）
        for (const { token } of rlTokens) {
            for (let i = 0; i < 4; i++) {
                const r = await api('/judge/pairing', { token });
                assert.notEqual(r.status, 429, '正常輪詢不應被限流');
            }
        }
    });

    await t('單一 token 連打仍會 429（per-token 桶未鬆綁）', async () => {
        let got429 = false;
        for (let i = 0; i < 10; i++) {
            const r = await api('/judge/pairing', { token: rlTokens[0].token });
            if (r.status === 429) { got429 = true; break; }
        }
        assert.ok(got429, '同一 token 超打應出現 429');
    });

    await t('格式錯誤的 Authorization 拿不到放寬額度（輪換也沒用）', async () => {
        let got429 = false;
        for (let i = 0; i < 10; i++) {
            const r = await fetch(`${BASE}/judge/pairing`, {
                headers: { Origin: ORIGIN, Authorization: `Bearer not-hex-${i}` },
            });
            if (r.status === 429) { got429 = true; break; }
        }
        assert.ok(got429, '亂寫 header 連打應回到未認證窄桶而 429');
    });

    await t('連打超過限額 → 429', async () => {
        let got429 = false;
        for (let i = 0; i < 10; i++) {
            const r = await fetch(`${BASE}/health`);
            if (r.status === 429) { got429 = true; break; }
        }
        assert.ok(got429, '10 連打內應出現 429');
    });
} finally {
    stopServer(server);
    await new Promise((r) => setTimeout(r, 1000));
    // Windows 上 workerd 釋放檔案較慢，加 retry
    rmSync(persist, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    rmSync(persist2, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}

console.log(`\n${failures.length === 0 ? `ALL PASS (${passed} tests)` : `${failures.length} FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length ? 1 : 0);
