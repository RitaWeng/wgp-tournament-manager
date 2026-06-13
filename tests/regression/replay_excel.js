// Replay historical tournament Excel results through the TournamentManager
// pairing algorithm and compare round-by-round.
//
// Run from anywhere:
//   node tests/regression/replay_excel.js
// Or via npm (from tournament-menager/):
//   npm run test:regression
//
// This test imports the SAME pairing module that the React component uses
// (tournament-menager/src/lib/swissPairing.js), so any algorithm change in
// that module is automatically exercised here.

const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', '..', 'tournament-menager', 'node_modules', 'xlsx'));
const {
  computeFloatBalance,
  calculateAuxiliaryScores,
  generateSwissPairings,
} = require(path.join(__dirname, '..', '..', 'tournament-menager', 'src', 'lib', 'swissPairing.js'));

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const FIXTURES = [
  { file: 'read_2025南北區競賽結果.xlsx', label: '2025 南北區' },
  { file: 'WGP_選手成績_2026-04-18_萬中.xlsx', label: '2026萬中微型競賽' },
  { file: '2026北區.xlsx', label: '2026北區 GM5' },
  { file: '2026南區.xlsx', label: '2026南區 GM5' },
];
const WIN_POINT = 1;

// ---- Excel parsing ---------------------------------------------------------
function parseSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const header = rows[0];
  const roundCount = header.filter((h) => typeof h === 'string' && /^R\d+$/.test(h)).length;
  const players = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] == null) continue;
    const number = Number(r[0]);
    const name = r[1];
    const rounds = [];
    for (let k = 0; k < roundCount; k++) {
      const score = r[2 + k * 2];
      const opp = r[2 + k * 2 + 1];
      rounds.push({
        score: score == null ? null : Number(score),
        opponent: opp == null ? null : Number(opp),
        isBlack: false,
      });
    }
    // 偵測中途棄賽：找最後一個「有對手記錄」的輪次（輪空 opponent=0 仍算有出賽；
    // 棄賽後未出賽的輪次 opponent=null/空白）。若之後仍有未打的輪次，視為從下一輪起棄賽。
    let lastPlayed = 0;
    for (let k = 0; k < roundCount; k++) {
      if (rounds[k].opponent !== null) lastPlayed = k + 1;
    }
    const withdrawnRound = lastPlayed >= 1 && lastPlayed < roundCount ? lastPlayed + 1 : null;

    players.push({
      number,
      name,
      country: '',
      rounds,
      withdrawnRound,
      totalScore: 0,
      auxScore1: 0,
      auxScore2: 0,
      auxScore3: 0,
    });
  }
  return { players, roundCount };
}

// ---- Test-only state helpers ----------------------------------------------

function recomputeTotals(players, throughRound /* 1-based, inclusive */) {
  return players.map((p) => ({
    ...p,
    totalScore: p.rounds.slice(0, throughRound).reduce((s, rd) => s + (rd.score ?? 0), 0),
  }));
}

// trim each player's `rounds` array to length `throughRound` and clone deeply
function viewThrough(players, throughRound) {
  return players.map((p) => ({
    ...p,
    rounds: p.rounds.slice(0, throughRound).map((r) => ({ ...r })),
  }));
}

// ---- Compare per-round -----------------------------------------------------

function asPairKey(p1, p2) {
  if (p2 === 0) return `${p1}-BYE`;
  return p1 < p2 ? `${p1}-${p2}` : `${p2}-${p1}`;
}

function replay(label, allPlayers, totalRounds) {
  console.log(`\n========== ${label} (${allPlayers.length} 隊, ${totalRounds} 輪) ==========`);
  let allMatch = true;
  for (let target = 2; target <= totalRounds; target++) {
    // Build pre-round state: rounds 1..target-1 known.
    const view = viewThrough(allPlayers, target - 1);
    const withTotals = recomputeTotals(view, target - 1);
    const withAux = calculateAuxiliaryScores(withTotals, WIN_POINT);

    // 棄賽隊不再進入配對池（鏡像 App wrapper：呼叫核心前過濾 active 名單）。
    // 注意輔分仍以全體計算（withAux），讓退賽隊已打成績照算進對手輔分一/二。
    const active = withAux.filter((p) => p.withdrawnRound == null || p.withdrawnRound > target);

    const result = generateSwissPairings(active, target);
    if (!result.ok) {
      allMatch = false;
      console.log(`R${target}: ✗ 演算法回報無解 — ${result.reason} ${result.hint}`);
      continue;
    }
    const programMatches = result.matches;

    const programSet = new Set(programMatches.map((m) => asPairKey(m.player1, m.player2)));
    const actualPairsRaw = [];
    const seen = new Set();
    allPlayers.forEach((p) => {
      const rd = p.rounds[target - 1];
      if (!rd) return;
      if (rd.opponent === null) return; // 該輪未出賽（已棄賽），不納入比對；真正輪空 opponent=0 仍照算
      const opp = rd.opponent;
      const k = asPairKey(p.number, opp);
      if (seen.has(k)) return;
      seen.add(k);
      actualPairsRaw.push({ p1: p.number, p2: opp });
    });
    const actualSet = new Set(actualPairsRaw.map((m) => asPairKey(m.p1, m.p2)));

    const inProgramOnly = [...programSet].filter((k) => !actualSet.has(k));
    const inActualOnly = [...actualSet].filter((k) => !programSet.has(k));

    if (inProgramOnly.length === 0 && inActualOnly.length === 0) {
      console.log(`R${target}: ✓ 全部 ${programMatches.length} 桌符合 (含輪空)`);
    } else {
      allMatch = false;
      console.log(`R${target}: ✗ 不符 — 程式 ${programMatches.length} 桌, 實際 ${actualPairsRaw.length} 桌`);
      console.log(`   程式有但實際無:`, inProgramOnly);
      console.log(`   實際有但程式無:`, inActualOnly);

      console.log(`   (排名輸入): score / fb / aux1 / aux2 / aux3 / number / name`);
      const fb = computeFloatBalance(withAux);
      const sorted = [...withAux].sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        const fa = fb.get(a.number) ?? 0;
        const fbb = fb.get(b.number) ?? 0;
        if (fa !== fbb) return fa - fbb;
        if (b.auxScore1 !== a.auxScore1) return b.auxScore1 - a.auxScore1;
        if (b.auxScore2 !== a.auxScore2) return b.auxScore2 - a.auxScore2;
        if (b.auxScore3 !== a.auxScore3) return b.auxScore3 - a.auxScore3;
        return a.number - b.number;
      });
      sorted.forEach((p) => {
        console.log(
          `      ${p.totalScore} / ${fb.get(p.number) ?? 0} / ${p.auxScore1} / ${p.auxScore2} / ${p.auxScore3} / #${p.number} ${p.name}`
        );
      });
    }
  }
  return allMatch;
}

// ---- Main ----

let allOk = true;
let ranAny = false;

for (const fx of FIXTURES) {
  const fp = path.join(FIXTURES_DIR, fx.file);
  if (!fs.existsSync(fp)) {
    console.log(`\n[skip] ${fx.label}: fixture not found at ${fp}`);
    continue;
  }
  ranAny = true;
  console.log(`\n###### Fixture: ${fx.label} (${fx.file}) ######`);
  const wb = XLSX.readFile(fp);
  for (const sheetName of wb.SheetNames) {
    const { players, roundCount } = parseSheet(wb.Sheets[sheetName]);
    if (players.length === 0) continue;
    const ok = replay(sheetName, players, roundCount);
    if (!ok) allOk = false;
  }
}

console.log('\n========== 結論 ==========');
if (!ranAny) {
  console.log('沒有任何 fixture 可跑，請參考 tests/README.md 放置測試檔。');
  process.exit(2);
}
console.log(allOk ? '全部 fixture 通過。' : '有差異，請檢視上方 ✗ 區塊。');
process.exit(allOk ? 0 : 1);
