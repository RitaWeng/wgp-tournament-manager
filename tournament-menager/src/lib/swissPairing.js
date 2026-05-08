// Swiss-pairing 演算法核心：抓對 + 輪動平衡 + 輔分計算
//
// 此模組為純函式，不依賴 React 也不產生副作用，可在瀏覽器（透過 webpack
// 打包）與 Node（測試腳本 require）兩端共用。所有 React 端的 setState /
// alert 由 TournamentManager.tsx 包裝層處理。
//
// 對應 VBA Sub VS 的分組回溯法。

/**
 * @typedef {{ score: number|null, opponent: number|null, isBlack?: boolean }} Round
 *   單輪結果。score：勝=winPoint、和=winPoint/2、負=0；尚未結算為 null。opponent：對手籤號，輪空為 0。
 *
 * @typedef {{
 *   number: number,
 *   name?: string,
 *   country?: string,
 *   rounds: Round[],
 *   totalScore: number,
 *   auxScore1: number,
 *   auxScore2: number,
 *   auxScore3: number,
 *   [key: string]: any
 * }} Player
 *   選手物件。索引簽章 `[key: string]: any` 允許 React 端附加額外欄位（如 rank、顯示用 flag）。
 *
 * @typedef {{ table: number, player1: number, player2: number }} PairingMatch
 *   桌次。player2 為 0 表示輪空。
 *
 * @typedef {{
 *   ok: boolean,
 *   matches?: PairingMatch[],
 *   sortedPlayers?: Player[],
 *   reason?: string,
 *   hint?: string
 * }} PairingResult
 *   抓對結果。ok=true 時 matches / sortedPlayers 必有值；ok=false 時 reason / hint 必有值。
 *   （未用 discriminated union 是因 JSDoc 對 literal type narrowing 支援不穩，採選用欄位型保守處理。）
 */

/**
 * 計算各選手的「輪動平衡」（對應 VBA CountTurn）。
 * 輪高（被分到比自己分數高的對手）+1；輪低 -1；同分 0。
 * 比較的是「配對當輪開始前的累積分數」，而非結算後的分數。
 *
 * @param {Player[]} playersList
 * @returns {Map<number, number>} 籤號 → 累積輪動值
 */
function computeFloatBalance(playersList) {
  const fb = new Map(playersList.map((p) => [p.number, 0]));
  if (playersList.length === 0) return fb;

  const roundCount = playersList[0].rounds.length;
  for (let r = 0; r < roundCount; r++) {
    if (!playersList.every((p) => p.rounds[r] && p.rounds[r].score !== null)) break;

    const scoresBefore = new Map(
      playersList.map((p) => [
        p.number,
        p.rounds.slice(0, r).reduce((sum, rd) => sum + ((rd.score) ?? 0), 0),
      ])
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
      // 同分：不更新
    });
  }
  return fb;
}

/**
 * 計算輔分一/二/三。**會直接 mutate 輸入 player 物件**（與舊版行為一致），
 * 同時回傳同一陣列以便鏈式使用。
 *
 *  - 輔分一：所遇對手之總分和
 *  - 輔分二：所負對手之總分和（負＝score < winPoint/2）
 *  - 輔分三：在 (總分, 輔一, 輔二) 全相同的群組內，計算彼此直接對戰差（勝 +0.5、負 -0.5）
 *
 * @param {Player[]} playersList
 * @param {number} winPoint
 * @returns {Player[]}
 */
function calculateAuxiliaryScores(playersList, winPoint) {
  const updatedPlayers = [...playersList];

  updatedPlayers.forEach((player) => {
    player.auxScore1 = 0;
    player.auxScore2 = 0;
    player.auxScore3 = 0;
  });

  // 輔分一：所遇對手之總分和
  updatedPlayers.forEach((player) => {
    player.rounds.forEach((round) => {
      if (round.opponent && round.opponent !== 0) {
        const opponent = updatedPlayers.find((p) => p.number === round.opponent);
        if (opponent) player.auxScore1 += opponent.totalScore;
      }
    });
  });

  // 輔分二：所負對手之總分和
  updatedPlayers.forEach((player) => {
    player.rounds.forEach((round) => {
      if (
        round.opponent &&
        round.opponent !== 0 &&
        round.score !== null &&
        round.score < winPoint / 2
      ) {
        const opponent = updatedPlayers.find((p) => p.number === round.opponent);
        if (opponent) player.auxScore2 += opponent.totalScore;
      }
    });
  });

  // 輔分三：(總分, 輔一, 輔二) 同群組內 head-to-head
  const playerGroups = [];
  const processed = new Set();
  for (let i = 0; i < updatedPlayers.length; i++) {
    const player = updatedPlayers[i];
    if (processed.has(player.number)) continue;
    const group = [player];
    processed.add(player.number);
    for (let j = 0; j < updatedPlayers.length; j++) {
      const other = updatedPlayers[j];
      if (other.number === player.number || processed.has(other.number)) continue;
      if (
        player.totalScore === other.totalScore &&
        player.auxScore1 === other.auxScore1 &&
        player.auxScore2 === other.auxScore2
      ) {
        group.push(other);
        processed.add(other.number);
      }
    }
    if (group.length > 1) playerGroups.push(group);
  }

  playerGroups.forEach((group) => {
    for (let i = 0; i < group.length; i++) {
      const player = group[i];
      let directMatchupScore = 0;
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const opponent = group[j];
        const matchup = player.rounds.find((rd) => rd.opponent === opponent.number);
        if (matchup && matchup.score !== null && matchup.score !== undefined) {
          directMatchupScore += matchup.score - winPoint / 2;
        }
      }
      const idx = updatedPlayers.findIndex((p) => p.number === player.number);
      updatedPlayers[idx].auxScore3 = directMatchupScore;
    }
  });

  return updatedPlayers;
}

/**
 * 產生本輪桌次表。純函式：不存取 DOM、不改 state，回傳對局列表或無解原因。
 *
 * 排序鍵（複合）：
 *   1. 總分 降冪
 *   2. 輪動平衡 升冪（被輪高多者排後）
 *   3. 輔分一 / 二 / 三 降冪
 *   4. 籤號 升冪（最終穩定排序）
 *
 * 註：VBA 原版 `Sub VS` 字面只用 (總分, 輪動, [stable])，但其 stable 來自上一輪
 * post-pair 排序留下的 row 歷史，本質上等價於以「過去對手強度」為 tiebreaker。
 * 輔分一/二/三在 JS 中扮演同樣角色 — 雖非 VBA 字面實作，但回歸測試（2025 南北區
 * 去識別化 fixture）顯示此版本與 VBA 實際輸出一致；移除輔分會讓 R3 起的配對發散。
 *
 * 分組策略：步長 2 比較相鄰位置，分數相同視為同組。奇數組會把下一組第一人
 * 納入（boundary leakage）以保持每組偶數，符合瑞士制借人規則。
 *
 * 配對策略：組內由分數最低（索引最大）的選手往前找配對；若整組無解則
 * 從下一組借兩人（ReCrawl）；仍無解則往前一組退；都失敗則回 PairingResultErr。
 *
 * @param {Player[]} players
 * @param {number} currentRound       當前要產生的輪次（1-based，僅用於錯誤訊息）
 * @param {{ allowSameCountry?: boolean }} [options]
 * @returns {PairingResult}
 */
function generateSwissPairings(players, currentRound, options) {
  const allowSameCountry = options && options.allowSameCountry !== undefined
    ? options.allowSameCountry
    : true;
  const playerCount = players.length;
  if (playerCount < 2) {
    return { ok: false, reason: '選手人數不足，無法抓對', hint: '至少需要 2 名選手' };
  }

  const floatBalances = computeFloatBalance(players);

  const sortedPlayers = [...players].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    const fa = floatBalances.get(a.number) ?? 0;
    const fb = floatBalances.get(b.number) ?? 0;
    if (fa !== fb) return fa - fb;
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

  const hasReceivedBye = (i) =>
    i < playerCount && sortedPlayers[i].rounds.some((r) => r.opponent === 0);

  const hasPlayedBefore = (i, j) => {
    if (i >= playerCount && j < playerCount) return hasReceivedBye(j);
    if (j >= playerCount && i < playerCount) return hasReceivedBye(i);
    if (i >= playerCount || j >= playerCount) return false;
    return sortedPlayers[i].rounds.some((r) => r.opponent === getNum(j));
  };

  const conflictsCountry = (i, j) => {
    if (allowSameCountry) return false;
    const c1 = getCountry(i);
    const c2 = getCountry(j);
    return c1 !== '' && c2 !== '' && c1 === c2;
  };

  // 分組
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
    for (let i = 0; i < vsPlayerCount; i++) {
      if (groupOrder[i] === 0) totalWait++;
    }
    if (totalWait === 0) break;

    if (groupPlayerCount === 0) {
      for (let i = 0; i < vsPlayerCount; i++) {
        if (groupNum[i] > nowGroup) groupNum[i]--;
      }
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
          const allByed = sortedPlayers.every((p) => p.rounds.some((r) => r.opponent === 0));
          const hint =
            isOdd && allByed
              ? '所有選手都已輪空過，無法再安排輪空。'
              : '可能因為剩餘可配對選手都已對戰過，或同國衝突無解。';
          return {
            ok: false,
            reason: `無法完成第 ${currentRound} 輪配對。`,
            hint,
          };
        }
      }
    }
  }

  // 建桌次表
  const pairMap = new Map();
  for (let i = 0; i < vsPlayerCount; i++) {
    if (groupOrder[i] === 0) continue;
    const key = `${groupNum[i]}-${groupOrder[i]}`;
    if (!pairMap.has(key)) pairMap.set(key, []);
    pairMap.get(key).push(i);
  }

  const sortedKeys = Array.from(pairMap.keys()).sort((a, b) => {
    const [ag, ao] = a.split('-').map(Number);
    const [bg, bo] = b.split('-').map(Number);
    return ag !== bg ? ag - bg : bo - ao;
  });

  const matches = [];
  let tableNum = 1;
  for (const key of sortedKeys) {
    const idxs = pairMap.get(key);
    if (idxs.length !== 2) continue;
    const idx1 = Math.min(idxs[0], idxs[1]);
    const idx2 = Math.max(idxs[0], idxs[1]);
    if (idx2 >= playerCount) {
      matches.push({ table: tableNum++, player1: getNum(idx1), player2: 0 });
    } else {
      matches.push({
        table: tableNum++,
        player1: sortedPlayers[idx1].number,
        player2: sortedPlayers[idx2].number,
      });
    }
  }

  return { ok: true, matches, sortedPlayers };
}

module.exports = {
  computeFloatBalance,
  calculateAuxiliaryScores,
  generateSwissPairings,
};
