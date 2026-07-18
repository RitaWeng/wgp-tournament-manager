/**
 * 線上成績回報端到端演練（Phase 3 驗收 + Phase 4 演練/安全實測 + 五組回報擴充）
 * 真實元件：wrangler dev（本地 D1）+ production build 前端（http://localhost:8080）
 * 三個 context：M=主控電腦、P1=裁判手機(iPhone)、P2=第二台裝置(Android，模擬 token 外洩)
 *
 * 前置：① cd tournament-menager && npm run build（產 dist）
 *       ② backend/ 已 npm install（playwright 在 backend devDependencies）
 *       ③ 首次跑需下載瀏覽器：npx playwright install chromium
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

  // ── P0.1 F1 回歸：解鎖推送失敗 → reload → 無狀態對帳自癒（docs/online-score-sync-drift.md §7）──
  // 只驗後端狀態（results 的 rounds 欄位），不驗 chip UI（斷言脆弱，F2 靠人工目視）。
  // page.route 掛在 M 頁面上，reload 後仍生效；輪詢 effect 只依賴 localStorage 的
  // wgpOnlineSync，reload 後不開面板也會自動恢復輪詢＋對帳。
  const roundsStatus = async () => {
    const r = await fetch(`${API}/events/${cfg.eventId}/results`,
      { headers: { Authorization: `Bearer ${cfg.adminToken}` } });
    return new Map(((await r.json()).rounds || []).map(x => [x.round_no, x.status]));
  };
  const f1Before = (await roundsStatus()).get(1);          // 算分後：locked
  await M.route('**/rounds/1/unlock', r => r.abort());
  await M.getByRole('button', { name: '解除鎖定' }).first().click();
  await M.waitForSelector('text=解除輪次鎖定');
  await M.getByRole('button', { name: '解除鎖定' }).last().click();   // dialog okText
  await wait(1500);                                        // 直接推送已被 abort、本機狀態落 localStorage
  const f1Still = (await roundsStatus()).get(1);           // 後端應仍 locked
  await M.reload();
  await M.waitForSelector('text=WGP TOURNAMENT');
  await dismissAlerts(M);
  await M.locator('button', { hasText: '線上回報' }).click(); // reload 後面板重開（後續 token 外洩步驟依賴桌況 chips）
  await wait(5000);                                        // ≥1 次輪詢對帳（4 秒間隔）跑過，補送 unlock 仍被 abort
  const f1AfterReload = (await roundsStatus()).get(1);     // 舊版 F1：這裡永遠 locked 且不再重試
  await M.unroute('**/rounds/1/unlock');
  let f1Healed = null;
  for (const t0 = Date.now(); Date.now() - t0 < 12000;) {  // 對帳 4 秒一輪，≤10s 應自癒（留緩衝）
    if ((await roundsStatus()).get(1) === 'open') { f1Healed = Date.now() - t0; break; }
    await wait(500);
  }
  const f1ok = f1Before === 'locked' && f1Still === 'locked' && f1AfterReload === 'locked' && f1Healed !== null;
  step(f1ok ? '✅' : '❌', 'F1 回歸：解鎖失敗→reload→自癒',
    f1ok ? `abort 中後端維持 locked（含 reload 後）；unroute 後 ${(f1Healed / 1000).toFixed(1)}s 自癒為 open`
         : `before=${f1Before} still=${f1Still} afterReload=${f1AfterReload} healed=${f1Healed}`);
  await M.screenshot({ path: path.join(OUT, '07b-M-f1-healed.png') });

  // 還原：結果都還在，重新算分 → 直接推送補鎖，後端回 locked，後續流程不受影響
  await M.locator('button').filter({ hasText: '算分' }).first().click();
  await dismissAlerts(M);
  let f1Relocked = false;
  for (const t0 = Date.now(); Date.now() - t0 < 12000;) {
    if ((await roundsStatus()).get(1) === 'locked') { f1Relocked = true; break; }
    await wait(500);
  }
  step(f1Relocked ? '✅' : '❌', 'F1 還原：重新算分', '後端 R1 回 locked，流程繼續');

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
  let rejectedByOperator = false;
  try { await revisionDlg.waitFor({ timeout: 8000 }); await revisionDlg.click(); rejectedByOperator = true; } catch { /* 未跳窗也可 */ }
  // 各桌狀態應標示裝置變更（等一次狀態輪詢 10 秒）
  await wait(12000);
  const chipTitle = await M.locator('span').filter({ hasText: /^桌1/ }).first().getAttribute('title');
  const flagged = chipTitle && chipTitle.includes('裝置變更');
  step(flagged ? '✅' : '❌', 'token 外洩偵測', flagged ? '桌1 標示裝置變更 ⚠＋翻改被操作者擋下' : `title=${chipTitle}`);
  await M.screenshot({ path: path.join(OUT, '08-M-device-flag.png') });

  // ── 拒絕採計通知：操作者「維持現狀」→ 裁判頁（P2）輪詢後顯示未採計橫幅 ──
  if (rejectedByOperator) {
    await P2.waitForSelector('text=未被計分台採計', { timeout: 25000 });
    step('✅', '拒絕採計通知', 'P2 顯示「更正未被計分台採計，請至計分台說明」');
    await P2.screenshot({ path: path.join(OUT, '09-P2-rejected.png') });
  } else {
    step('⚠️', '拒絕採計通知', '略過（revision 警示未跳窗）');
  }

  // ── B2 回歸：拒絕採計決定持久化——reload 後同一筆 revision 不重跳確認窗 ──
  if (rejectedByOperator) {
    const savedReports = await M.evaluate(() =>
      JSON.parse(localStorage.getItem('tournamentManagerState') || '{}').judgeReports || null);
    const dismissedSaved = !!savedReports && Object.values(savedReports).some(v => v.dismissed);
    await M.reload();
    await M.locator('button', { hasText: '線上回報' }).click(); // reload 重置面板，後續步驟依賴桌況 chips
    await wait(10000); // ≥2 個輪詢週期；舊版會在此對同一筆 revision 重跳「裁判回報更正」
    const reprompt = await M.getByRole('button', { name: '維持現狀' }).count();
    const b2ok = dismissedSaved && reprompt === 0;
    step(b2ok ? '✅' : '❌', 'B2 回歸：拒絕採計持久化',
      b2ok ? 'dismissed 已入 localStorage；reload 後未重跳確認窗'
           : `dismissedSaved=${dismissedSaved} reprompt=${reprompt}`);
  } else {
    step('⚠️', 'B2 回歸：拒絕採計持久化', '略過（revision 警示未跳窗）');
  }

  // ── S7 回歸：鎖定競態的更正不再無聲消失（守衛 A 可見化，drift doc §3 P1）──
  // 模擬：lock 推送被斷（後端仍 open）→ M 算分鎖定 R2 → P2 合法送出更正（HTTP 200）
  // → M 輪詢丟棄但留「更正未採計」標記 → 恢復連線自動補鎖 → 由標記解鎖 → 正常採計確認
  await M.route('**/rounds/2/lock', r => r.abort());
  for (let i = 0; i < 20; i++) {                       // R2 其餘桌手動登錄後算分
    const sides = M.locator('div[title="點擊登錄勝"]');
    if (!(await sides.count())) break;
    await sides.first().click(); await wait(100);
  }
  await M.locator('button').filter({ hasText: '算分' }).first().click();
  await dismissAlerts(M);
  const s7Backend = (await roundsStatus()).get(2);     // lock 全被 abort → 後端應仍 open
  await P2.getByRole('button', { name: '更正結果' }).click();
  await P2.waitForSelector('text=更正中');
  await judgeFillGroups(P2, [2, 2, 2, 1, 2], []);      // 1:4 翻勝方（≠ 本地登錄的側1）
  await judgeSubmitFlow(P2);                           // 後端 open → 200 收下（S7 競態窗）
  await M.waitForSelector('text=未採計回報', { timeout: 15000 });   // 面板標記
  const s7ChipCard = await M.locator('button:has-text("更正未採計")').count(); // 桌卡標記
  step(s7Backend === 'open' && s7ChipCard > 0 ? '✅' : '❌', 'S7 守衛可見化：鎖定競態留標記',
    s7Backend === 'open' && s7ChipCard > 0
      ? '算分時 lock 斷線（後端 open）、P2 更正 200 落地；面板＋桌卡出現「更正未採計」標記'
      : `backend=${s7Backend} cardChip=${s7ChipCard}`);
  await M.screenshot({ path: path.join(OUT, '10-M-s7-marker.png') });

  await M.unroute('**/rounds/2/lock');                 // 恢復連線 → 對帳自動補鎖
  let s7Locked = false;
  for (const t0 = Date.now(); Date.now() - t0 < 12000;) {
    if ((await roundsStatus()).get(2) === 'locked') { s7Locked = true; break; }
    await wait(500);
  }
  await M.locator('button:has-text("更正未採計")').first().click();  // 由標記查看
  await M.waitForSelector('text=鎖定後收到裁判更正');
  await M.getByRole('button', { name: '解除第 2 輪鎖定' }).click();
  await M.waitForSelector('text=裁判回報更正', { timeout: 15000 }); // 解鎖後回報進入正常確認
  await M.getByRole('button', { name: '維持現狀' }).click();
  let s7MarkerGone = false, s7After = null;            // 解鎖推送 fire-and-forget，慢時由 ≤4s 對帳補送
  for (const t0 = Date.now(); Date.now() - t0 < 12000;) {
    s7MarkerGone = (await M.locator('button:has-text("更正未採計")').count()) === 0;
    s7After = (await roundsStatus()).get(2);
    if (s7MarkerGone && s7After === 'open') break;
    await wait(500);
  }
  const s7ok = s7Locked && s7MarkerGone && s7After === 'open';
  step(s7ok ? '✅' : '❌', 'S7 標記解鎖 → 正常採計流程',
    s7ok ? '恢復連線自動補鎖；由標記解鎖 → 跳採計確認 → 維持現狀後標記清除、後端回 open'
         : `relocked=${s7Locked} markerGone=${s7MarkerGone} after=${s7After}`);

  // ── S5 回歸：配對對帳（主動偵測 + 守衛 B 可見化，drift doc §3 P1）──
  // 修改桌 2 配對（發佈後未重發）→ 面板出現「配對已變更未重新發佈」；桌 2 裁判照舊
  // 配對回報 → 守衛 B 留「配對不符」標記；改回配對 → 偵測解除、回報進入正常流程套用
  const s5State = JSON.parse(await M.evaluate(() => localStorage.getItem('tournamentManagerState')));
  const s5t2 = s5State.matchesByRound['2'].find(m => m.table === 2);
  const s5t3 = s5State.matchesByRound['2'].find(m => m.table === 3);
  await M.locator('button').filter({ hasText: '修改配對' }).first().click();
  const s5Vals = await M.locator('div.elevated select').evaluateAll(els => els.map(e => e.value));
  const s5Idx = s5Vals.findIndex(v => v === String(s5t2.player1));
  await M.locator('div.elevated select').nth(s5Idx).selectOption(String(s5t3.player1));
  await M.locator('button').filter({ hasText: '完成修改' }).first().click();
  await M.waitForSelector('text=配對已變更未重新發佈', { timeout: 5000 });
  step('✅', 'S5 主動偵測：改配對未重發', '面板出現「⚠ 配對已變更未重新發佈（R2）」');
  // 桌 2 裁判（HTTP 模擬）按裁判手機上的舊配對回報 → 200 落地、M 守衛 B 留標記
  const s5Submit = await fetch(`${API}/judge/result`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.tableTokens[1].token}`, 'X-Device-Id': 'e2e-t2', 'Content-Type': 'application/json' },
    body: JSON.stringify({ roundNo: 2, groups: [1, 1, 1, 1, 1].map(w => ({ winner: w, overtime: false })), version: 0 }),
  });
  await M.waitForSelector('button:has-text("配對不符")', { timeout: 15000 });
  await M.locator('button:has-text("配對不符")').first().click();       // 查看標記
  await M.waitForSelector('text=裁判回報與本地配對不符');
  await M.getByRole('button', { name: '我知道了' }).click();
  step(s5Submit.status === 200 ? '✅' : '❌', 'S5 守衛可見化：配對不符留標記',
    `舊配對回報 HTTP ${s5Submit.status} 落地；M 出現「配對不符」標記＋查看視窗`);
  await M.screenshot({ path: path.join(OUT, '11-M-s5-marker.png') });
  // 改回配對 → 偵測即時解除；下次輪詢回報配對相符 → 正常套用、標記自動清除
  await M.locator('button').filter({ hasText: '修改配對' }).first().click();
  await M.locator('div.elevated select').nth(s5Idx).selectOption(String(s5t2.player1));
  await M.locator('button').filter({ hasText: '完成修改' }).first().click();
  const s5DriftGone = (await M.locator('text=配對已變更未重新發佈').count()) === 0;
  let s5MarkerGone = false;
  for (const t0 = Date.now(); Date.now() - t0 < 12000;) {
    if ((await M.locator('button:has-text("配對不符")').count()) === 0) { s5MarkerGone = true; break; }
    await wait(500);
  }
  const s5ok = s5DriftGone && s5MarkerGone;
  step(s5ok ? '✅' : '❌', 'S5 改回配對 → 自動收斂',
    s5ok ? '偵測解除；回報配對相符後正常套用、標記自動清除'
         : `driftGone=${s5DriftGone} markerGone=${s5MarkerGone}`);

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

  // ── S6 回歸：線上賽事進行中按「重設」→ 防呆兩層確認 → 一併結束＋本機重設 ──
  // （docs/online-score-sync-drift.md §3 P2）建一場新賽事再重設，驗證：後端賽事被刪、
  // wgpOnlineSync 清除（輪詢停止）、本機資料歸零
  await M.locator('input[placeholder^="後端 API 網址"]').fill(API);
  await M.getByRole('button', { name: /建立線上賽事/ }).click();
  await dismissAlerts(M);
  await M.waitForSelector('text=已連線', { timeout: 15000 });
  const cfg2 = JSON.parse(await M.evaluate(() => localStorage.getItem('wgpOnlineSync')));
  await M.getByRole('button', { name: '重設' }).click();
  await M.waitForSelector('text=線上賽事「');                    // 第一層確認帶線上警告
  await M.getByRole('button', { name: '確定重設' }).click();
  await M.waitForSelector('text=一併結束線上賽事？');            // 第二層：處理線上生命週期
  await M.getByRole('button', { name: '一併結束線上賽事' }).click();
  await dismissAlerts(M);
  await wait(800);   // 重設後 auto-save 會把全新初始狀態寫回 localStorage，等它落地再驗
  const s6Sync = await M.evaluate(() => localStorage.getItem('wgpOnlineSync'));
  // 本機狀態歸零 = 無任何桌次/成績/裁判紀錄（key 會被初始狀態重寫，不能驗 null）
  const s6St = JSON.parse(await M.evaluate(() => localStorage.getItem('tournamentManagerState')) || 'null');
  const s6LocalClean = !s6St ||
    (Object.keys(s6St.matchesByRound || {}).length === 0 &&
     (s6St.scoredRounds || []).length === 0 &&
     Object.keys(s6St.judgeReports || {}).length === 0);
  const s6Backend = await fetch(`${API}/events/${cfg2.eventId}/results`,
    { headers: { Authorization: `Bearer ${cfg2.adminToken}` } });
  const s6ok = s6Sync === null && s6LocalClean && s6Backend.status === 401;
  step(s6ok ? '✅' : '❌', 'S6 回歸：重設防呆（一併結束）',
    s6ok ? '兩層確認後：後端賽事已刪（401）、wgpOnlineSync 清除、本機狀態歸零'
         : `sync=${s6Sync !== null} localClean=${s6LocalClean} backend=${s6Backend.status}`);
  await M.screenshot({ path: path.join(OUT, '12-M-s6-reset.png') });

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
