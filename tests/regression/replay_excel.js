// Replay historical tournament Excel results through the TournamentManager
// pairing algorithm and compare round-by-round.
//
// Run from anywhere:
//   node tests/regression/replay_excel.js
// Or via npm (from tournament-menager/):
//   npm run test:regression
//
// IMPORTANT: this file is a PORT of the algorithm in
// tournament-menager/src/TournamentManager.tsx (computeFloatBalance,
// calculateAuxiliaryScores, generateSwissPairings). If you change the algorithm
// in the TSX, you MUST mirror the change here — otherwise this test will pass
// spuriously.

const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', '..', 'tournament-menager', 'node_modules', 'xlsx'));

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const FIXTURES = [
  { file: 'read_2025南北區競賽結果.xlsx', label: '2025 南北區' },
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
        isBlack: false, // not relevant for pairing logic
      });
    }
    players.push({
      number,
      name,
      country: '',
      rounds,
      totalScore: 0,
      auxScore1: 0,
      auxScore2: 0,
      auxScore3: 0,
    });
  }
  return { players, roundCount };
}

// ---- Algorithm port (mirror of TournamentManager.tsx) ---------------------

function computeFloatBalance(playersList) {
  const fb = new Map(playersList.map((p) => [p.number, 0]));
  if (playersList.length === 0) return fb;
  const roundCount = playersList[0].rounds.length;
  for (let r = 0; r < roundCount; r++) {
    if (!playersList.every((p) => p.rounds[r] && p.rounds[r].score !== null)) break;
    const scoresBefore = new Map(
      playersList.map((p) => [p.number, p.rounds.slice(0, r).reduce((s, rd) => s + (rd.score ?? 0), 0)])
    );
    const processed = new Set();
    playersList.forEach((p) => {
      const rd = p.rounds[r];
      if (!rd || rd.score === null || !rd.opponent || rd.opponent === 0) return;
      const k = Math.min(p.number, rd.opponent) + '-' + Math.max(p.number, rd.opponent);
      if (processed.has(k)) return;
      processed.add(k);
      const ps = scoresBefore.get(p.number) ?? 0;
      const os = scoresBefore.get(rd.opponent) ?? 0;
      if (ps > os) {
        fb.set(p.number, (fb.get(p.number) ?? 0) - 1);
        fb.set(rd.opponent, (fb.get(rd.opponent) ?? 0) + 1);
      } else if (ps < os) {
        fb.set(p.number, (fb.get(p.number) ?? 0) + 1);
        fb.set(rd.opponent, (fb.get(rd.opponent) ?? 0) - 1);
      }
    });
  }
  return fb;
}

function calculateAuxiliaryScores(playersList) {
  const ps = playersList.map((p) => ({ ...p, auxScore1: 0, auxScore2: 0, auxScore3: 0 }));
  const byNum = new Map(ps.map((p) => [p.number, p]));
  ps.forEach((p) => {
    p.rounds.forEach((rd) => {
      if (rd.opponent && rd.opponent !== 0) {
        const opp = byNum.get(rd.opponent);
        if (opp) p.auxScore1 += opp.totalScore;
      }
    });
  });
  ps.forEach((p) => {
    p.rounds.forEach((rd) => {
      if (rd.opponent && rd.opponent !== 0 && rd.score !== null && rd.score < WIN_POINT / 2) {
        const opp = byNum.get(rd.opponent);
        if (opp) p.auxScore2 += opp.totalScore;
      }
    });
  });
  // aux3: head-to-head among players tied on (totalScore, aux1, aux2)
  const processed = new Set();
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (processed.has(p.number)) continue;
    const grp = [p];
    processed.add(p.number);
    for (let j = 0; j < ps.length; j++) {
      const q = ps[j];
      if (q.number === p.number || processed.has(q.number)) continue;
      if (q.totalScore === p.totalScore && q.auxScore1 === p.auxScore1 && q.auxScore2 === p.auxScore2) {
        grp.push(q);
        processed.add(q.number);
      }
    }
    if (grp.length > 1) {
      grp.forEach((g) => {
        let s = 0;
        grp.forEach((h) => {
          if (g.number === h.number) return;
          const m = g.rounds.find((rd) => rd.opponent === h.number);
          if (m && m.score !== null && m.score !== undefined) s += m.score - WIN_POINT / 2;
        });
        g.auxScore3 = s;
      });
    }
  }
  return ps;
}

function recomputeTotals(players, throughRound /* 1-based, inclusive */) {
  return players.map((p) => ({
    ...p,
    totalScore: p.rounds.slice(0, throughRound).reduce((s, rd) => s + (rd.score ?? 0), 0),
  }));
}

// trim each player's `rounds` array to length `throughRound`
function viewThrough(players, throughRound) {
  return players.map((p) => ({ ...p, rounds: p.rounds.slice(0, throughRound) }));
}

function generateSwissPairings(players, currentRound, allowSameCountry = true) {
  const sortedPlayers = [...players];
  const playerCount = sortedPlayers.length;
  const fb = computeFloatBalance(sortedPlayers);
  sortedPlayers.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    const fa = fb.get(a.number) ?? 0;
    const fbb = fb.get(b.number) ?? 0;
    if (fa !== fbb) return fa - fbb;
    if (b.auxScore1 !== a.auxScore1) return b.auxScore1 - a.auxScore1;
    if (b.auxScore2 !== a.auxScore2) return b.auxScore2 - a.auxScore2;
    if (b.auxScore3 !== a.auxScore3) return b.auxScore3 - a.auxScore3;
    return a.number - b.number;
  });

  const isOdd = playerCount % 2 === 1;
  const vsPlayerCount = playerCount + (isOdd ? 1 : 0);
  const groupNum = new Array(vsPlayerCount).fill(1);
  const groupOrder = new Array(vsPlayerCount).fill(0);
  const getNum = (i) => (i < playerCount ? sortedPlayers[i].number : 0);
  const getScore = (i) => (i < playerCount ? sortedPlayers[i].totalScore : -Infinity);
  const getCountry = (i) => (i < playerCount ? sortedPlayers[i].country || '' : '');
  const hasReceivedBye = (i) => i < playerCount && sortedPlayers[i].rounds.some((r) => r.opponent === 0);
  const hasPlayedBefore = (i, j) => {
    if (i >= playerCount && j < playerCount) return hasReceivedBye(j);
    if (j >= playerCount && i < playerCount) return hasReceivedBye(i);
    if (i >= playerCount || j >= playerCount) return false;
    return sortedPlayers[i].rounds.some((r) => r.opponent === getNum(j));
  };
  const conflictsCountry = (i, j) => {
    if (allowSameCountry) return false;
    const c1 = getCountry(i),
      c2 = getCountry(j);
    return c1 !== '' && c2 !== '' && c1 === c2;
  };

  groupNum[0] = 1;
  if (vsPlayerCount > 1) groupNum[1] = 1;
  for (let i = 2; i < vsPlayerCount; i += 2) {
    const g = getScore(i) === getScore(i - 2) ? groupNum[i - 2] : groupNum[i - 2] + 1;
    groupNum[i] = g;
    if (i + 1 < vsPlayerCount) groupNum[i + 1] = g;
  }

  const vsRecord = Array.from({ length: Math.max(...groupNum) + 2 }, () => []);
  let nowGroup = 1;

  groupLoop: while (true) {
    let groupPlayerCount = 0;
    let totalWait = 0;
    for (let i = 0; i < vsPlayerCount; i++) {
      if (groupNum[i] === nowGroup) {
        groupOrder[i] = 0;
        groupPlayerCount++;
      }
    }
    for (let i = 0; i < vsPlayerCount; i++) if (groupOrder[i] === 0) totalWait++;
    if (totalWait === 0) break;
    if (groupPlayerCount === 0) {
      for (let i = 0; i < vsPlayerCount; i++) if (groupNum[i] > nowGroup) groupNum[i]--;
      continue groupLoop;
    }
    let nowGroupWait = groupPlayerCount;
    vsRecord[nowGroup] = [];
    let nowGroupOrder = 1;
    let needReCrawl = false;

    vsNextLoop: while (true) {
      let iIdx = -1;
      for (let i = vsPlayerCount - 1; i >= 0; i--) {
        if (groupNum[i] === nowGroup && groupOrder[i] === 0) {
          iIdx = i;
          break;
        }
      }
      if (iIdx === -1) {
        nowGroup++;
        while (vsRecord.length <= nowGroup) vsRecord.push([]);
        continue groupLoop;
      }
      let searchI = iIdx;
      let iiStart = iIdx - 1;
      innerSearch: while (true) {
        for (let ii = iiStart; ii >= 0; ii--) {
          if (groupNum[ii] === nowGroup && groupOrder[ii] === 0) {
            if (!hasPlayedBefore(searchI, ii) && !conflictsCountry(searchI, ii)) {
              groupOrder[searchI] = nowGroupOrder;
              groupOrder[ii] = nowGroupOrder;
              vsRecord[nowGroup].push({ i: searchI, ii });
              nowGroupOrder++;
              nowGroupWait -= 2;
              if (nowGroupWait === 0) {
                nowGroup++;
                while (vsRecord.length <= nowGroup) vsRecord.push([]);
                continue groupLoop;
              }
              continue vsNextLoop;
            }
          }
        }
        if (vsRecord[nowGroup].length > 0) {
          const lp = vsRecord[nowGroup].pop();
          groupOrder[lp.i] = 0;
          groupOrder[lp.ii] = 0;
          nowGroupOrder--;
          nowGroupWait += 2;
          searchI = lp.i;
          iiStart = lp.ii - 1;
          continue innerSearch;
        } else {
          needReCrawl = true;
          break vsNextLoop;
        }
      }
    }
    if (needReCrawl) {
      reCrawlLoop: while (true) {
        vsRecord[nowGroup] = [];
        let added = 0;
        for (let j = 0; j < vsPlayerCount; j++) {
          if (groupNum[j] > nowGroup) {
            groupNum[j] = nowGroup;
            added++;
            if (added === 2) continue groupLoop;
          }
        }
        if (nowGroup > 1) {
          nowGroup--;
          continue reCrawlLoop;
        } else {
          throw new Error(`No valid pairing for round ${currentRound}`);
        }
      }
    }
  }

  // Build pairings, keep group/order ordering for table number
  const pairMap = new Map();
  for (let i = 0; i < vsPlayerCount; i++) {
    if (groupOrder[i] === 0) continue;
    const k = `${groupNum[i]}-${groupOrder[i]}`;
    if (!pairMap.has(k)) pairMap.set(k, []);
    pairMap.get(k).push(i);
  }
  const sortedKeys = Array.from(pairMap.keys()).sort((a, b) => {
    const [ag, ao] = a.split('-').map(Number);
    const [bg, bo] = b.split('-').map(Number);
    return ag !== bg ? ag - bg : bo - ao;
  });
  const matches = [];
  let table = 1;
  for (const k of sortedKeys) {
    const idxs = pairMap.get(k);
    if (idxs.length !== 2) continue;
    const i1 = Math.min(idxs[0], idxs[1]);
    const i2 = Math.max(idxs[0], idxs[1]);
    if (i2 >= playerCount) {
      matches.push({ table: table++, p1: getNum(i1), p2: 0 });
    } else {
      matches.push({ table: table++, p1: sortedPlayers[i1].number, p2: sortedPlayers[i2].number });
    }
  }
  return { matches, sortedPlayers };
}

// ---- Compare per-round -----------------------------------------------------

function actualPairingsForRound(allPlayers, round /* 1-based */) {
  // Round k uses rounds[k-1]. Build a unique pair set.
  const pairs = new Set();
  const list = [];
  allPlayers.forEach((p) => {
    const rd = p.rounds[round - 1];
    if (!rd) return;
    const opp = rd.opponent ?? 0;
    const a = p.number;
    const b = opp;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (pairs.has(key)) return;
    pairs.add(key);
    list.push({ a: Math.min(a, b === 0 ? Infinity : b), b: b === 0 ? 0 : Math.max(a, b) });
  });
  return list;
}

function asPairKey(p1, p2) {
  if (p2 === 0) return `${p1}-BYE`;
  return p1 < p2 ? `${p1}-${p2}` : `${p2}-${p1}`;
}

function replay(label, allPlayers, totalRounds) {
  console.log(`\n========== ${label} (${allPlayers.length} 隊, ${totalRounds} 輪) ==========`);
  let allMatch = true;
  for (let target = 2; target <= totalRounds; target++) {
    // State input: rounds 1..target-1 known. So slice rounds.
    const view = viewThrough(allPlayers, target - 1).map((p) => ({ ...p, rounds: p.rounds.map((r) => ({ ...r })) }));
    const withTotals = recomputeTotals(view, target - 1);
    const withAux = calculateAuxiliaryScores(withTotals);
    const { matches: programMatches } = generateSwissPairings(withAux, target);

    const programSet = new Set(programMatches.map((m) => asPairKey(m.p1, m.p2)));
    const actualPairsRaw = [];
    const seen = new Set();
    allPlayers.forEach((p) => {
      const rd = p.rounds[target - 1];
      if (!rd) return;
      const opp = rd.opponent ?? 0;
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

      // Show context for diagnosis: top of pre-round standings
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
    console.log('       (Excel fixtures are gitignored — see tests/README.md)');
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
