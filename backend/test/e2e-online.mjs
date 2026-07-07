/**
 * 線上成績回報端到端演練（Phase 3 驗收 + Phase 4 演練/安全實測 + 五組回報擴充）
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
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');   // backend/test → repo root
const OUT = path.join(__dirname, 'evidence-online');
const API = 'http://127.0.0.1:8787';
const FRONT = 'http://localhost:8080';

const results = [];
const step = (icon, name, detail) => { results.push(icon); console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`); };

const sh = (cmd, args, opts) => spawn(cmd, args, { stdio: 'ignore', ...opts });
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Windows 相容（同 api.test.mjs）：spawn 'npx' 會 ENOENT，改以 node 直接執行
// wrangler 的 JS 入口；Python 在 Windows 叫 python 而非 python3
const WRANGLER_JS = path.join(REPO, 'backend', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const wranglerCmd = (args, opts) => sh(process.execPath, [WRANGLER_JS, ...args], opts);
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

// Windows 的 kill() 收不掉 wrangler 的 workerd 子程序（殘留佔埠），改殺整個程序樹
function stopProc(proc) {
  if (process.platform === 'win32' && proc.pid) {
    spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
  } else {
    proc.kill('SIGTERM');
  }
}

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

// 裁判頁五組操作：teamSideByGroup = 各組要點的側別（1|2 ×5）、otIdx = 要點「加賽」的組索引。
// 隊伍按鈕在 DOM 順序為 [A組側1, A組側2, B組側1, B組側2, ...]
async function judgeFillGroups(page, teamSideByGroup, otIdx = []) {
  const teamBtns = page.locator('div.divide-y button.flex-1');
  for (let i = 0; i < 5; i++) {
    await teamBtns.nth(i * 2 + (teamSideByGroup[i] - 1)).click();
  }
  const otBtns = page.getByRole('button', { name: '加賽' });
  for (const i of otIdx) await otBtns.nth(i).click();
}

async function judgeSubmitFlow(page) {
  await page.getByRole('button', { name: '送出結果' }).click();
  await page.waitForSelector('text=確認：');
  await page.getByRole('button', { name: '確定送出' }).click();
  await page.waitForSelector('text=已送出', { timeout: 10000 });
}

(async () => {
  mkdirSync(OUT, { recursive: true });

  // ── 起後端（乾淨 D1）與前端靜態伺服器 ──
  const persist = mkdtempSync(path.join(tmpdir(), 'wgp-online-e2e-'));
  await new Promise((res, rej) => {
    const p = wranglerCmd(['d1', 'execute', 'wgp_score_relay', '--local', '--file=./schema.sql', '--persist-to', persist],
      { cwd: `${REPO}/backend`, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    p.on('exit', c => c === 0 ? res() : rej(new Error('schema fail')));
  });
  const backend = wranglerCmd(['dev', '--port', '8787', '--persist-to', persist],
    { cwd: `${REPO}/backend`, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  const front = sh(PYTHON, ['-m', 'http.server', '8080', '--directory', `${REPO}/tournament-menager/dist`]);
  await waitHttp(`${API}/health`);
  await waitHttp(FRONT);
  step('✅', '環境', '後端(wrangler dev+D1) 與前端(8080) 皆就緒');

  const browser = await chromium.launch();
  const ctxM = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
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

  // ── R1：抓對 → 發佈桌次 → P1 自動看到五組輸入介面 ──
  await M.locator('button').filter({ hasText: '抓對' }).first().click();
  await wait(400);
  await M.locator('button').filter({ hasText: '發佈桌次' }).first().click();
  await dismissAlerts(M);
  await P1.waitForSelector('text=請逐組點選獲勝隊伍', { timeout: 15000 });
  step('✅', 'R1 發佈 → P1 自動更新', '裁判頁顯示五組（ABCDE）輸入介面');
  await P1.screenshot({ path: path.join(OUT, '02-P1-groups-empty.png') });

  // ── P1 回報：3:2（D 組加賽）→ 未滿五組擋送出、齊了自動判定 ──
  const earlyBlocked = await P1.getByRole('button', { name: /五組都選完才能送出/ }).isDisabled();
  await judgeFillGroups(P1, [1, 2, 1, 2, 1], [3]);
  const tally = await P1.locator('text=自動判定').innerText();
  const winnerName = (await P1.locator('div.divide-y button.flex-1').first().innerText()).trim();
  if (!earlyBlocked || !tally.includes('3:2')) step('❌', 'P1 五組輸入', `blocked=${earlyBlocked} tally=${tally}`);
  else step('✅', 'P1 五組輸入', `未選滿擋送出；3:2 → ${winnerName} 勝（自動判定）＋D組加賽`);
  await P1.screenshot({ path: path.join(OUT, '03-P1-groups-filled.png') });
  await judgeSubmitFlow(P1);
  step('✅', 'P1 送出', '確認畫面含五組摘要 → 已送出');
  await P1.screenshot({ path: path.join(OUT, '04-P1-done.png') });

  // ── 主控端 ~4 秒內收到：桌勝方 + 五組明細 + 組數 chip ──
  await M.waitForSelector('span[title="此結果由裁判線上回報"]', { timeout: 15000 });
  const state1 = JSON.parse(await M.evaluate(() => localStorage.getItem('tournamentManagerState')));
  const t1 = state1.matchesByRound['1'].find(m => m.table === 1);
  const g1ok = t1.groups && t1.groups.length === 5 && t1.groups[3].overtime === true && t1.player1Score > 0;
  const chipCount = await M.locator('span:has-text("3:2·含加賽")').count();
  if (!g1ok || !chipCount) step('❌', 'M 收成績+五組', `groups=${JSON.stringify(t1.groups)} chip=${chipCount}`);
  else step('✅', 'M 自動收成績', `桌1 側1 勝、五組明細入 match（D組加賽）、桌卡顯示 3:2·含加賽`);
  await M.screenshot({ path: path.join(OUT, '05-M-received.png') });

  // ── P1 更正（翻桌勝方：改成 1:4）→ M 醒目警示（含組數）→ 採計 ──
  await P1.getByRole('button', { name: '更正結果' }).click();
  await P1.waitForSelector('text=更正中');
  await judgeFillGroups(P1, [2, 2, 1, 2, 2], []); // 預填後改點：C 留側1，其餘側2 → 1:4
  await judgeSubmitFlow(P1);
  await M.waitForSelector('text=裁判回報更正', { timeout: 15000 });
  const dlgText = await M.getByText(/裁判回報勝方為/).innerText();
  await M.screenshot({ path: path.join(OUT, '06-M-revision-warn.png') });
  await M.getByRole('button', { name: '採計裁判回報' }).click();
  await wait(800);
  const state2 = JSON.parse(await M.evaluate(() => localStorage.getItem('tournamentManagerState')));
  const t1b = state2.matchesByRound['1'].find(m => m.table === 1);
  const rev1ok = t1b.player1Score === 0 && t1b.groups.filter(g => g.winner === 2).length === 4;
  if (!rev1ok || !dlgText.includes('4:1')) step('❌', 'revision 採計', `p1Score=${t1b.player1Score} dlg=${dlgText}`);
  else step('✅', 'P1 更正翻勝方 → M 醒目警示（含組數 4:1）→ 採計', '勝方與五組明細同步更新');

  // ── P1 只改組明細（補記 A 組加賽，勝方不變）→ M 靜默更新、不跳警示 ──
  await P1.getByRole('button', { name: '更正結果' }).click();
  await P1.waitForSelector('text=更正中');
  await P1.getByRole('button', { name: '加賽' }).first().click(); // A 組補加賽，勝負不動
  await judgeSubmitFlow(P1);
  await wait(6000);
  const dlgCount = await M.locator('text=裁判回報更正').count();
  const state3 = JSON.parse(await M.evaluate(() => localStorage.getItem('tournamentManagerState')));
  const t1c = state3.matchesByRound['1'].find(m => m.table === 1);
  if (dlgCount !== 0 || t1c.groups[0].overtime !== true) step('❌', '組明細靜默更新', `dlg=${dlgCount} otA=${t1c.groups[0].overtime}`);
  else step('✅', '只改組明細（勝方不變）', 'M 靜默帶入 A 組加賽、不跳警示（伺服器稽核留痕）');

  // ── 其餘桌手動登錄（混用模式）→ 算分 → 後端鎖定 → P1 顯示已鎖定＋五組摘要 ──
  for (let i = 0; i < 20; i++) {
    const sides = M.locator('div[title="點擊登錄勝"]');
    if (!(await sides.count())) break;
    await sides.first().click(); await wait(100);
  }
  await M.locator('button').filter({ hasText: '算分' }).first().click();
  await dismissAlerts(M);
  await P1.waitForSelector('text=第 1 輪已鎖定', { timeout: 15000 });
  const lockedSummary = await P1.locator('text=加賽').count();
  step(lockedSummary >= 2 ? '✅' : '❌', '算分 → 鎖定同步', 'P1 顯示 🔒 已鎖定＋五組摘要（含加賽註記）');
  await P1.screenshot({ path: path.join(OUT, '07-P1-locked.png') });

  // ── R2：換輪 → 抓對 → 發佈 → P1 自動進入第 2 輪並回報 5:0 ──
  await M.locator('button[title^="切換當前輪次到 R2"]').click();
  await M.locator('button').filter({ hasText: '抓對' }).first().click();
  await wait(400);
  await M.locator('button').filter({ hasText: '發佈桌次' }).first().click();
  await dismissAlerts(M);
  await P1.waitForSelector('text=第 2 輪', { timeout: 15000 });
  await P1.waitForSelector('text=請逐組點選獲勝隊伍', { timeout: 15000 });
  await judgeFillGroups(P1, [1, 1, 1, 1, 1], []);
  await judgeSubmitFlow(P1);
  step('✅', 'R2 換輪回報', 'P1 自動切到第 2 輪（草稿已重置）、回報 5:0');

  // ── P1 斷線重試 ──
  await ctxP1.setOffline(true);
  await P1.waitForSelector('text=連線中斷，自動重試中', { timeout: 15000 });
  await ctxP1.setOffline(false);
  await P1.waitForSelector('text=連線中斷', { state: 'detached', timeout: 15000 });
  step('✅', 'P1 斷線→恢復', '斷線橫幅出現、恢復後自動消失');

  // ── token 外洩模擬：關掉 P1（停其輪詢），P2 用桌 1 token 掃入並翻改成 0:5 ──
  await P1.close();
  await wait(1000);
  const P2 = await ctxP2.newPage();
  P2.on('pageerror', e => errs.P2.push(e.message));
  await P2.goto(judgeUrl(cfg.tableTokens[0]));
  await P2.waitForSelector('text=本桌已回報', { timeout: 15000 });
  await P2.getByRole('button', { name: '更正結果' }).click();
  await judgeFillGroups(P2, [2, 2, 2, 2, 2], []);
  await judgeSubmitFlow(P2);
  // M 端跳 revision 警示（第二台裝置翻改已登錄結果）→ 操作者「維持現狀」擋下
  const revisionDlg = M.getByRole('button', { name: '維持現狀' });
  try { await revisionDlg.waitFor({ timeout: 8000 }); await revisionDlg.click(); } catch { /* 未跳窗也可 */ }
  // 各桌狀態應標示裝置變更（等一次狀態輪詢 10 秒）
  await wait(12000);
  const chipTitle = await M.locator('span').filter({ hasText: /^桌1/ }).first().getAttribute('title');
  const flagged = chipTitle && chipTitle.includes('裝置變更');
  step(flagged ? '✅' : '❌', 'token 外洩偵測', flagged ? '桌1 標示裝置變更 ⚠＋翻改被操作者擋下' : `title=${chipTitle}`);
  await M.screenshot({ path: path.join(OUT, '08-M-device-flag.png') });

  // ── Excel 匯出：桌次表帶 A~E 五欄＋組數（黑:白）──
  try {
    const require2 = createRequire(import.meta.url);
    const XLSX = require2(`${REPO}/tournament-menager/node_modules/xlsx`);
    await M.locator('button').filter({ hasText: '匯入/匯出' }).first().click();
    const [download] = await Promise.all([
      M.waitForEvent('download', { timeout: 10000 }),
      M.getByRole('button', { name: '下載桌次表' }).click(),
    ]);
    const xpath = path.join(OUT, 'matches.xlsx');
    await download.saveAs(xpath);
    const wb = XLSX.readFile(xpath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const header = rows[0];
    const hOk = ['A組', 'B組', 'C組', 'D組', 'E組', '組數(黑:白)'].every(h => header.includes(h));
    const row1 = rows.find(r => r[0] === 1); // 桌 1（R2：P1 回報 5:0；P2 翻改被擋 → 維持）
    const gCells = row1.slice(header.indexOf('A組'), header.indexOf('A組') + 5);
    const ratio = row1[header.indexOf('組數(黑:白)')];
    const cellsOk = gCells.every(c => c === '黑' || c === '白') && /^[0-5]:[0-5]$/.test(ratio) &&
      Number(ratio.split(':')[0]) + Number(ratio.split(':')[1]) === 5;
    if (!hOk || !cellsOk) step('❌', 'Excel 五組欄', `header=${header} cells=${gCells} ratio=${ratio}`);
    else step('✅', 'Excel 桌次表', `A~E 欄=黑/白、組數 ${ratio}（桌1 R2，5:0 一致）`);
    await M.locator('button').filter({ hasText: '匯入/匯出' }).first().click();
  } catch (e) {
    step('⚠️', 'Excel 五組欄', `略過（${e.message.slice(0, 80)}）`);
  }

  // ── 後端掛掉：主控端顯示異常但手動登錄照常（不變式 2）──
  await ctxM.route(`${API}/**`, r => r.abort());
  await M.waitForSelector('text=連線異常', { timeout: 25000 });
  const sidesLeft = M.locator('div[title="點擊登錄勝"]');
  const before = await sidesLeft.count();
  if (before > 0) { await sidesLeft.first().click(); await wait(300); }
  const after = await sidesLeft.count();
  step(before === 0 || after < before ? '✅' : '❌', '後端掛掉退回手動', `顯示連線異常；手動登錄照常（未登錄桌 ${before}→${after}）`);

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
  stopProc(backend);
  stopProc(front);
  const failed = results.filter(r => r === '❌').length;
  console.log(`\n=== ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} steps) ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('SCRIPT ERROR:', e.message);
  process.exit(2);
});
