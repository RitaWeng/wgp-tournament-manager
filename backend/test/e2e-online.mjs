/**
 * 線上成績回報端到端演練（Phase 3 驗收 + Phase 4 演練/安全實測）
 * 真實元件：wrangler dev（本地 D1）+ production build 前端（http://localhost:8080）
 * 三個 context：M=主控電腦、P1=裁判手機(iPhone)、P2=第二台裝置(Android，模擬 token 外洩)
 *
 * 前置：① cd tournament-menager && npm run build（產 dist）
 *       ② backend/ 已 npm install
 *       ③ 本檔需要 playwright（不列入 backend 相依；請 `npm i -D playwright` 或全域安裝後再跑）
 * 跑法：node backend/test/e2e-online.mjs
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');   // backend/test → repo root
const OUT = path.join(__dirname, 'evidence-online');
const API = 'http://127.0.0.1:8787';
const FRONT = 'http://localhost:8080';

const results = [];
const step = (icon, name, detail) => { results.push(icon); console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`); };

const sh = (cmd, args, opts) => spawn(cmd, args, { stdio: 'ignore', ...opts });
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { await fetch(url); return; } catch { await wait(1000); }
  }
  throw new Error(`起不來: ${url}`);
}

async function dismissAlerts(page, ms = 1200) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const btn = page.getByRole('button', { name: '我知道了' });
    if (await btn.count()) { await btn.first().click(); await wait(150); }
    else await wait(120);
  }
}

(async () => {
  mkdirSync(OUT, { recursive: true });

  // ── 起後端（乾淨 D1）與前端靜態伺服器 ──
  const persist = mkdtempSync(path.join(tmpdir(), 'wgp-online-e2e-'));
  await new Promise((res, rej) => {
    const p = sh('npx', ['wrangler', 'd1', 'execute', 'wgp_score_relay', '--local', '--file=./schema.sql', '--persist-to', persist],
      { cwd: `${REPO}/backend`, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    p.on('exit', c => c === 0 ? res() : rej(new Error('schema fail')));
  });
  let backend = sh('npx', ['wrangler', 'dev', '--port', '8787', '--persist-to', persist],
    { cwd: `${REPO}/backend`, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  const front = sh('python3', ['-m', 'http.server', '8080', '--directory', `${REPO}/tournament-menager/dist`]);
  await waitHttp(`${API}/health`);
  await waitHttp(FRONT);
  step('✅', '環境', '後端(wrangler dev+D1) 與前端(8080) 皆就緒');

  const browser = await chromium.launch();
  const ctxM = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxP1 = await browser.newContext({ ...devices['iPhone 13'] });
  const ctxP2 = await browser.newContext({ ...devices['Pixel 7'] });
  const M = await ctxM.newPage();
  const errs = { M: [], P1: [], P2: [] };
  M.on('pageerror', e => errs.M.push(e.message));

  // ── 主控端：建立線上賽事 ──
  await M.goto(`${FRONT}/index.html`);
  await M.waitForSelector('text=WGP TOURNAMENT');
  await M.locator('button', { hasText: '線上回報' }).click();
  await M.locator('input[placeholder^="後端 API 網址"]').fill(API);
  await M.getByRole('button', { name: /建立線上賽事（5 桌）/ }).click();
  await dismissAlerts(M);
  const connected = await M.locator('text=已連線').count();
  const cfg = JSON.parse(await M.evaluate(() => localStorage.getItem('wgpOnlineSync')));
  if (!connected || !cfg || cfg.tableTokens.length !== 5) step('❌', '建立線上賽事', `connected=${connected}`);
  else step('✅', '建立線上賽事', `5 桌 token 已存主控端 localStorage、面板顯示已連線`);
  await M.screenshot({ path: path.join(OUT, '01-M-created.png') });

  // ── 裁判手機 P1（桌 1）先掃碼：應顯示「等待桌次發佈」 ──
  const judgeUrl = (t) => `${FRONT}/index.html#/judge?e=${cfg.eventId}&t=${t.token}&a=${encodeURIComponent(API)}`;
  const P1 = await ctxP1.newPage();
  P1.on('pageerror', e => errs.P1.push(e.message));
  await P1.goto(judgeUrl(cfg.tableTokens[0]));
  await P1.waitForSelector('text=等待桌次發佈', { timeout: 15000 });
  const hashClean = await P1.evaluate(() => location.hash);
  const p1cfg = await P1.evaluate(() => !!localStorage.getItem('wgpJudgeConfig'));
  if (hashClean !== '#/judge' || !p1cfg) step('❌', 'P1 掃碼', `hash=${hashClean} cfg=${p1cfg}`);
  else step('✅', 'P1 掃碼（桌1）', 'token 收進 localStorage、網址已清（#/judge）、顯示等待桌次');
  await P1.screenshot({ path: path.join(OUT, '02-P1-waiting.png') });

  // ── R1：抓對 → 發佈桌次 → P1 自動看到對局 ──
  await M.locator('button').filter({ hasText: '抓對' }).first().click();
  await wait(400);
  await M.locator('button').filter({ hasText: '發佈桌次' }).first().click();
  await dismissAlerts(M);
  await P1.waitForSelector('text=請點選獲勝隊伍', { timeout: 15000 });
  const p1Header = await P1.locator('text=桌 1').count();
  step(p1Header ? '✅' : '❌', 'R1 發佈 → P1 自動更新', '裁判頁輪詢後顯示第 1 輪本桌對局');
  await P1.screenshot({ path: path.join(OUT, '03-P1-pairing.png') });

  // ── P1 回報：點勝方 → 確認 → 成功畫面 ──
  const teamBtns = P1.locator('button.w-full.min-h-24');
  const winnerName = (await teamBtns.first().locator('div').first().innerText()).trim();
  await teamBtns.first().click();
  await P1.waitForSelector(`text=確認：${winnerName} 獲勝？`);
  await P1.getByRole('button', { name: '確定送出' }).click();
  await P1.waitForSelector('text=已送出', { timeout: 10000 });
  step('✅', 'P1 回報勝方', `${winnerName} 勝 → 確認 → 已送出畫面`);
  await P1.screenshot({ path: path.join(OUT, '04-P1-done.png') });

  // ── 主控端 ~4 秒內收到，桌卡標「裁判」，結果正確 ──
  // 斷言用「勝方側別」而非隊名：P1 點 first button = 側別 1 = player1 勝 → player1Score > 0
  await M.waitForSelector('span[title="此結果由裁判線上回報"]', { timeout: 15000 });
  const state1 = JSON.parse(await M.evaluate(() => localStorage.getItem('tournamentManagerState')));
  const t1 = state1.matchesByRound['1'].find(m => m.table === 1);
  if (!(t1.player1Score > 0)) step('❌', 'M 收成績', `桌1 player1Score=${t1.player1Score}（P1 選左側應為 player1 勝）`);
  else step('✅', 'M 自動收成績', `桌1 記錄 ${winnerName} 勝（player1 側）＋「裁判」來源標示`);
  await M.screenshot({ path: path.join(OUT, '05-M-received.png') });

  // ── P1 更正（改點 nth(1)=側別 2=player2）→ M 跳醒目警示，操作者確認採計 ──
  await P1.getByRole('button', { name: '更正結果' }).click();
  await P1.waitForSelector('text=目前登錄');
  await teamBtns.nth(1).click();
  await P1.getByRole('button', { name: '確定送出' }).click();
  await P1.waitForSelector('text=已送出');
  await M.waitForSelector('text=裁判回報更正', { timeout: 15000 });
  await M.screenshot({ path: path.join(OUT, '06-M-revision-warn.png') });
  await M.getByRole('button', { name: '採計裁判回報' }).click();
  await wait(800);
  const state2 = JSON.parse(await M.evaluate(() => localStorage.getItem('tournamentManagerState')));
  const t1b = state2.matchesByRound['1'].find(m => m.table === 1);
  if (t1b.player1Score !== 0) step('❌', 'revision 採計', `player1Score=${t1b.player1Score}（更正後應為 player2 勝）`);
  else step('✅', 'P1 更正 → M 醒目警示 → 採計', `勝方改為 player2（側別 2）`);

  // ── 其餘桌手動登錄（混用模式）→ 算分 → 後端鎖定 → P1 顯示已鎖定 ──
  for (let i = 0; i < 20; i++) {
    const sides = M.locator('div[title="點擊登錄勝"]');
    if (!(await sides.count())) break;
    await sides.first().click(); await wait(100);
  }
  await M.locator('button').filter({ hasText: '算分' }).first().click();
  await dismissAlerts(M);
  await P1.waitForSelector('text=第 1 輪已鎖定', { timeout: 15000 });
  step('✅', '算分 → 鎖定同步', 'P1 顯示 🔒 已鎖定與洽計分台提示');
  await P1.screenshot({ path: path.join(OUT, '07-P1-locked.png') });

  // ── R2：換輪 → 抓對 → 發佈 → P1 自動進入第 2 輪並回報 ──
  await M.locator('button[title^="切換當前輪次到 R2"]').click();
  await M.locator('button').filter({ hasText: '抓對' }).first().click();
  await wait(400);
  await M.locator('button').filter({ hasText: '發佈桌次' }).first().click();
  await dismissAlerts(M);
  await P1.waitForSelector('text=第 2 輪', { timeout: 15000 });
  await P1.locator('button.w-full.min-h-24').first().click();
  await P1.getByRole('button', { name: '確定送出' }).click();
  await P1.waitForSelector('text=已送出');
  step('✅', 'R2 換輪回報', 'P1 自動切到第 2 輪、成功回報');

  // ── P1 斷線重試 ──
  await ctxP1.setOffline(true);
  await P1.waitForSelector('text=連線中斷，自動重試中', { timeout: 15000 });
  await ctxP1.setOffline(false);
  await P1.waitForSelector('text=連線中斷', { state: 'detached', timeout: 15000 });
  step('✅', 'P1 斷線→恢復', '斷線橫幅出現、恢復後自動消失');

  // ── token 外洩模擬：關掉 P1（停其輪詢，避免同 token 並發），P2 用桌 1 token 掃入 ──
  // 換裝置本身即觸發軟性偵測（judgeGetPairing 帶新 device_id）；再提交一筆更正
  await P1.close();
  await wait(1000);
  const P2 = await ctxP2.newPage();
  P2.on('pageerror', e => errs.P2.push(e.message));
  await P2.goto(judgeUrl(cfg.tableTokens[0]));
  await P2.waitForSelector('text=第 2 輪', { timeout: 15000 });
  // 若本桌已有結果則提交相反側作為更正（觸發 M 端 revision），否則直接送一筆
  await P2.locator('button.w-full.min-h-24').nth(1).click();
  await P2.getByRole('button', { name: '確定送出' }).click();
  await P2.waitForSelector('text=已送出', { timeout: 10000 });
  // M 端可能跳 revision 警示（第二台裝置改動已登錄結果）→ 操作者「維持現狀」擋下
  const revisionDlg = M.getByRole('button', { name: '維持現狀' });
  try { await revisionDlg.waitFor({ timeout: 8000 }); await revisionDlg.click(); } catch { /* 未跳窗也可 */ }
  // 各桌狀態應標示裝置變更（等一次狀態輪詢 10 秒）
  await wait(12000);
  const chipTitle = await M.locator('span').filter({ hasText: /^桌1/ }).first().getAttribute('title');
  const flagged = chipTitle && chipTitle.includes('裝置變更');
  step(flagged ? '✅' : '❌', 'token 外洩偵測', flagged ? '桌1 標示裝置變更 ⚠（軟性偵測，不拒絕但留痕）' : `title=${chipTitle}`);
  await M.screenshot({ path: path.join(OUT, '08-M-device-flag.png') });

  // ── 後端掛掉：主控端顯示異常但手動登錄照常（不變式 2）──
  // 用 route abort 模擬後端不可用（比殺進程樹可靠），只影響主控端 context
  await ctxM.route(`${API}/**`, r => r.abort());
  await M.waitForSelector('text=連線異常', { timeout: 25000 });
  const sidesLeft = M.locator('div[title="點擊登錄勝"]');
  const before = await sidesLeft.count();
  if (before > 0) { await sidesLeft.first().click(); await wait(300); }
  const after = await sidesLeft.count();
  step(before === 0 || after < before ? '✅' : '❌', '後端掛掉退回手動', `顯示連線異常；手動登錄照常（未登錄桌 ${before}→${after}）`);
  await M.screenshot({ path: path.join(OUT, '09-M-backend-down.png') });

  // ── 恢復連線 → 結束賽事 → 裁判憑證失效、面板回到建立畫面 ──
  await ctxM.unroute(`${API}/**`);
  await M.waitForSelector('text=已連線', { timeout: 25000 });
  await M.getByRole('button', { name: '結束線上賽事' }).click();
  await M.getByRole('button', { name: '結束並刪除' }).click();
  await dismissAlerts(M);
  await P2.waitForSelector('text=憑證已失效', { timeout: 15000 });
  const backToCreate = await M.locator('text=建立線上賽事').count();
  step(backToCreate ? '✅' : '❌', '結束賽事', '伺服器資料刪除、裁判頁顯示憑證失效、面板回到建立畫面');
  await P2.screenshot({ path: path.join(OUT, '10-P2-invalid.png') });

  for (const [k, v] of Object.entries(errs)) {
    if (v.length) step('⚠️', `${k} pageerror`, v.join(' | '));
  }
  if (!errs.M.length && !errs.P1.length && !errs.P2.length) step('✅', '全程 console', '三個 context 皆無 pageerror');

  await browser.close();
  backend.kill('SIGTERM');
  front.kill('SIGTERM');
  const failed = results.filter(r => r === '❌').length;
  console.log(`\n=== ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} steps) ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('SCRIPT ERROR:', e.message);
  process.exit(2);
});
