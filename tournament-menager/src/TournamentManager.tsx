import React, { useState, useEffect } from 'react';

// 導入用於Excel處理的函數
import * as XLSX from 'xlsx';

// 下載CSV函數
const downloadCSV = (content, fileName) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// 下載Excel函數
const downloadExcel = (data, fileName) => {
  const wb = XLSX.utils.book_new();
  
  // 添加各分頁
  data.forEach(sheet => {
    const ws = XLSX.utils.aoa_to_sheet(sheet.data);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  });
  
  // 生成Excel並下載
  XLSX.writeFile(wb, fileName);
};

// 自定義基本組件
const Title = ({ level, children }) => {
  const Tag = `h${level || 2}`;
  return <Tag className="font-bold mb-2">{children}</Tag>;
};

const Button = ({ onClick, type, block, danger, size, children, className, disabled }) => {
  const getButtonClass = () => {
    let classes = "px-3 py-1 rounded font-medium focus:outline-none ";
    
    if (disabled) {
      classes += "bg-gray-300 text-gray-500 cursor-not-allowed ";
    } else {
      if (type === 'primary') classes += "bg-blue-500 text-white hover:bg-blue-600 ";
      else if (danger) classes += "bg-red-500 text-white hover:bg-red-600 ";
      else classes += "bg-gray-200 text-gray-800 hover:bg-gray-300 ";
    }
    
    if (block) classes += "w-full ";
    if (size === 'small') classes += "px-2 py-1 text-sm ";
    
    return classes + (className || "");
  };
  
  return (
    <button 
      onClick={disabled ? undefined : onClick} 
      className={getButtonClass()}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

const Select = ({ value, onChange, style, children }) => {
  return (
    <select 
      value={value} 
      onChange={(e) => onChange(e.target.value)}
      className="w-full p-1 border rounded"
      style={style}
    >
      {children}
    </select>
  );
};

const Option = ({ value, children }) => {
  return <option value={value}>{children}</option>;
};

const InputNumber = ({ min, max, value, onChange, style }) => {
  return (
    <input 
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value) || 0)}
      className="w-full p-1 border rounded"
      style={style}
    />
  );
};

const Checkbox = ({ checked, onChange, children }) => {
  return (
    <label className="inline-flex items-center">
      <input 
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mr-2"
      />
      <span>{children}</span>
    </label>
  );
};

const Card = ({ className, children }) => {
  return (
    <div className={`bg-white shadow rounded p-2 ${className || ''}`}>
      {children}
    </div>
  );
};

const Divider = () => {
  return <hr className="my-2" />;
};

const Row = ({ gutter, className, children }) => {
  return (
    <div className={`flex flex-wrap -mx-2 ${className || ''}`}>
      {React.Children.map(children, child => {
        if (!child) return null;
        return React.cloneElement(child, {
          gutter,
          ...child.props
        });
      })}
    </div>
  );
};

const Col = ({ span, className, children, gutter }) => {
  const width = span ? `${(span / 24) * 100}%` : "auto";
  const padding = gutter ? `px-${gutter/8}` : "px-2";
  
  return (
    <div className={`${padding} mb-2 ${className || ''}`} style={{ width }}>
      {children}
    </div>
  );
};

const Tabs = ({ defaultActiveKey, children }) => {
  const [activeKey, setActiveKey] = useState(defaultActiveKey);
  
  return (
    <div>
      <div className="flex border-b mb-4">
        {React.Children.map(children, child => (
          <div 
            className={`px-4 py-2 cursor-pointer ${activeKey === child.key ? 'border-b-2 border-blue-500 font-medium' : ''}`}
            onClick={() => setActiveKey(child.key)}
          >
            {child.props.tab}
          </div>
        ))}
      </div>
      {React.Children.map(children, child => {
        if (child.key === activeKey) {
          return child.props.children;
        }
        return null;
      })}
    </div>
  );
};

const TabPane = ({ tab, children, key }) => {
  return <div key={key}>{children}</div>;
};

// 分割視窗組件
const SplitPane = ({ leftPane, rightPane, splitRatio = 50 }) => {
  return (
    <div className="flex flex-row h-full">
      <div className="overflow-auto" style={{ width: `${splitRatio}%` }}>
        {leftPane}
      </div>
      <div className="border-l border-gray-300"></div>
      <div className="overflow-auto" style={{ width: `${100 - splitRatio}%` }}>
        {rightPane}
      </div>
    </div>
  );
};

// 簡單的消息通知功能
const message = {
  success: (content) => {
    alert(content);
  },
  warning: (content) => {
    alert(content);
  },
  error: (content) => {
    alert(content);
  }
};

const TournamentManager = () => {
  // 狀態管理
  const [allPlayers, setAllPlayers] = useState(32);
  const [rounds, setRounds] = useState(5);
  const [gameType, setGameType] = useState('瑞士制');
  const [winPoint, setWinPoint] = useState(1);
  const [players, setPlayers] = useState([]);
  // const [matches, setMatches] = useState([]);
  const [matches, setMatches] = useState([]);
  // 以 {1: [round1 matches], 2: […], …} 格式儲存
  const [matchesByRound, setMatchesByRound] = useState({});
  const [sortByRank, setSortByRank] = useState(false);
  const [allowSameCountry, setAllowSameCountry] = useState(false);
  const [currentRound, setCurrentRound] = useState(1);
  const [gameTitle, setGameTitle] = useState('WGP GiveMe5');
  const [editMode, setEditMode] = useState(false);
  // 新增狀態用於控制「抓對」按鈕是否可用
  const [isPairingButtonDisabled, setIsPairingButtonDisabled] = useState(false);
  
  // 新增狀態用於控制選擇要顯示的回合
  const [selectedRound, setSelectedRound] = useState(1);
  // 新增狀態用於控制分割視窗比例
  const [splitRatio, setSplitRatio] = useState(65);

// 處理選手隊伍變更
const handlePlayerNameChange = (playerNumber, newName) => {
  const updatedPlayers = [...players];
  const playerIndex = updatedPlayers.findIndex(p => p.number === playerNumber);
  if (playerIndex !== -1) {
    updatedPlayers[playerIndex].name = newName;
    setPlayers(updatedPlayers);
  }
};

// 處理選手段位變更
const handlePlayerLevelChange = (playerNumber, newLevel) => {
  const updatedPlayers = [...players];
  const playerIndex = updatedPlayers.findIndex(p => p.number === playerNumber);
  if (playerIndex !== -1) {
    updatedPlayers[playerIndex].level = newLevel;
    setPlayers(updatedPlayers);
  }
};

// 處理選手國家變更
const handlePlayerCountryChange = (playerNumber, newCountry) => {
  const updatedPlayers = [...players];
  const playerIndex = updatedPlayers.findIndex(p => p.number === playerNumber);
  if (playerIndex !== -1) {
    updatedPlayers[playerIndex].country = newCountry;
    setPlayers(updatedPlayers);
  }
};

  // 初始化玩家數據
  useEffect(() => {
    initializePlayers();
  }, [allPlayers, rounds]);

  const initializePlayers = () => {
    // 檢查是否為現有玩家資料更新
    if (players.length > 0 && players.length === allPlayers) {
      // 只更新輪數變動
      const updatedPlayers = players.map(player => {
        // 確保 rounds 陣列長度為當前的輪數
        const newRounds = Array(rounds).fill().map((_, i) => {
          // 保留現有輪次資料，只為新增的輪次創建空資料
          return i < player.rounds.length 
            ? player.rounds[i] 
            : { score: null, opponent: null, isBlack: false };
        });
        return { ...player, rounds: newRounds };
      });
      setPlayers(updatedPlayers);
    } else {
      // 創建全新的玩家資料
      const newPlayers = [];
      for (let i = 1; i <= allPlayers; i++) {
        newPlayers.push({
          number: i,
          name: `隊伍${i}`,
          level: '',
          country: '',
          totalScore: 0,
          rank: i,
          auxScore1: 0, // 輔分一：所遇對手之總分和
          auxScore2: 0, // 輔分二：所負對手之總分和
          auxScore3: 0, // 輔分三：彼此對戰之勝負
          rounds: Array(rounds).fill().map(() => ({ score: null, opponent: null, isBlack: false }))
        });
      }
      setPlayers(newPlayers);
    }
    setMatches([]);
  };

  // 抽籤功能
  const drawLots = () => {
    const shuffledPlayers = [...players];
    // 隨機洗牌算法
    for (let i = shuffledPlayers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
    }
   
    // 更新籤號
    const updatedPlayers = shuffledPlayers.map((player, index) => ({
      ...player,
      number: index + 1
    }));
    
    setPlayers(updatedPlayers);
    message.success('抽籤完成！');
  };

  // 取代直接呼叫 drawLots 的 onClick
  const handleDrawLots = () => {
    if (currentRound !== 1) {
        message.warning('只有第 1 輪可以抽籤');
        return;
    }
    
    // 檢查是否有任何輪次的桌次表存在
    const existingRounds = Object.keys(matchesByRound).map(r => parseInt(r, 10));
    const hasAnyRounds = existingRounds.length > 0;
    
    if (hasAnyRounds) {
      const maxRound = Math.max(...existingRounds);
      message.warning(`已存在桌次表！抽籤將會清除所有輪次的桌次表和比賽結果。`);
    }
    
    if (window.confirm(`確定要在第 ${currentRound} 輪執行抽籤${hasAnyRounds ? '，並清除所有輪次的桌次和比賽結果' : ''}嗎？`)) {
      // 如果確認，清除所有輪次的桌次表
      if (hasAnyRounds) {
        setMatchesByRound({});
      }
      
      // 執行抽籤
      drawLots();
    }
  };

  // 生成配對
  const generatePairings = () => {
    // 如果按鈕已被禁用，則不執行任何操作
    if (isPairingButtonDisabled) {
      message.warning('已生成本輪桌次表，請完成本輪比賽結果輸入並按下「算分」後再生成下一輪桌次表。');
      return;
    }

    // 檢查當前輪次是否已經有桌次表存在
    const existingRounds = Object.keys(matchesByRound).map(r => parseInt(r, 10));
    if (existingRounds.includes(currentRound)) {
      message.warning(`第 ${currentRound} 輪已經抓對過，不能重複抓對。如需重新抓對，請先更換輪次。`);
      return;
    }

    // 檢查是否有高於當前輪次的桌次表存在
    const hasNextRounds = existingRounds.some(round => round > currentRound);
    
    // 如果當前輪次不是最高輪次，顯示警告
    if (hasNextRounds) {
      const maxRound = Math.max(...existingRounds);
      message.warning(`已存在第 ${currentRound + 1} 輪或更高輪次的桌次表！抓對將會清除第 ${currentRound + 1} 到第 ${maxRound} 輪的所有桌次和比賽結果。`);
      
      // 詢問確認
      if (!window.confirm(`確定要在第 ${currentRound} 輪執行抓對並清除後續輪次的資料嗎？`)) {
        return;
      }
      
      // 如果確認，清除高於當前輪次的桌次表
      const updatedMatchesByRound = { ...matchesByRound };
      existingRounds.forEach(round => {
        if (round > currentRound) {
          delete updatedMatchesByRound[round];
        }
      });
      setMatchesByRound(updatedMatchesByRound);
    }
    
    // 繼續正常的抓對流程
    if (gameType === '瑞士制') {
      generateSwissPairings();
    } else if (gameType === '單循環') {
      generateRoundRobinPairings();
    }
    
    // 更新選中的輪次為當前輪次
    setSelectedRound(currentRound);
    
    // 設置抓對按鈕為禁用狀態，直到完成算分
    setIsPairingButtonDisabled(true);
  };
  


  // 瑞士制配對
  // 嘗試配對未對戰過的選手
  const attemptPairingWithoutRematches = (sortedPlayers, paired, newMatches) => {
    for (let i = 0; i < sortedPlayers.length; i++) {
      if (paired.has(sortedPlayers[i].number)) continue;
      
      const player1 = sortedPlayers[i];
      
      for (let j = i + 1; j < sortedPlayers.length; j++) {
        const player2 = sortedPlayers[j];
        
        if (paired.has(player2.number)) continue;
        
        // 檢查是否已經對戰過
        const alreadyPlayed = player1.rounds.some(round => 
          round.opponent === player2.number
        );
        
        // 檢查國家限制
        const sameCountry = !allowSameCountry && 
                            player1.country && 
                            player2.country && 
                            player1.country === player2.country;
        
        if (!alreadyPlayed && !sameCountry) {
          newMatches.push({
            table: newMatches.length + 1,
            player1: player1.number,
            player2: player2.number,
            round: currentRound,
            // 決定誰先手 (黑方)
            player1IsBlack: determineFirstMove(player1, player2, currentRound)
          });
          
          paired.add(player1.number);
          paired.add(player2.number);
          break;
        }
      }
    }
  };

  // 允許重複對戰的配對
  const attemptPairingWithRematches = (sortedPlayers, paired, newMatches) => {
    for (let i = 0; i < sortedPlayers.length; i++) {
      if (paired.has(sortedPlayers[i].number)) continue;
      
      const player1 = sortedPlayers[i];
      
      for (let j = i + 1; j < sortedPlayers.length; j++) {
        const player2 = sortedPlayers[j];
        
        if (paired.has(player2.number)) continue;
        
        // 只檢查國家限制，忽略是否已對戰過
        const sameCountry = !allowSameCountry && 
                            player1.country && 
                            player2.country && 
                            player1.country === player2.country;
        
        if (!sameCountry) {
          newMatches.push({
            table: newMatches.length + 1,
            player1: player1.number,
            player2: player2.number,
            round: currentRound,
            player1IsBlack: determineFirstMove(player1, player2, currentRound)
          });
          
          paired.add(player1.number);
          paired.add(player2.number);
          break;
        }
      }
    }
    
    // 如果仍有未配對的選手，忽略所有限制進行配對
    for (let i = 0; i < sortedPlayers.length; i++) {
      if (paired.has(sortedPlayers[i].number)) continue;
      
      const player1 = sortedPlayers[i];
      
      for (let j = i + 1; j < sortedPlayers.length; j++) {
        const player2 = sortedPlayers[j];
        
        if (paired.has(player2.number)) continue;
        
        // 無條件配對
        newMatches.push({
          table: newMatches.length + 1,
          player1: player1.number,
          player2: player2.number,
          round: currentRound,
          player1IsBlack: determineFirstMove(player1, player2, currentRound)
        });
        
        paired.add(player1.number);
        paired.add(player2.number);
        break;
      }
    }
  };
  // 處理輪空選手
  const handleByePlayer = (sortedPlayers, paired, newMatches) => {
    // 尋找最低分且尚未配對的選手
    const byePlayer = [...sortedPlayers].reverse().find(player => 
      !paired.has(player.number)
    );
    
    if (byePlayer) {
      newMatches.push({
        table: newMatches.length + 1,
        player1: byePlayer.number,
        player2: 0, // 0 表示輪空
        round: currentRound,
        player1IsBlack: true
      });
      
      paired.add(byePlayer.number);
    }
  };

  //瑞士制抓對主函數
  const generateSwissPairings = () => {
    // 根據總分排序
    const sortedPlayers = [...players].sort((a, b) => b.totalScore - a.totalScore);
    const newMatches = [];
    const paired = new Set();
    
    // 判斷是否為奇數人參賽
    const isOddPlayers = sortedPlayers.length % 2 === 1;
    
    // 第一階段：嘗試找未對戰過的對手
    attemptPairingWithoutRematches(sortedPlayers, paired, newMatches);
    
    // 第二階段：允許重複對戰
    if (paired.size < sortedPlayers.length - (isOddPlayers ? 1 : 0)) {
      attemptPairingWithRematches(sortedPlayers, paired, newMatches);
    }
    
    // 處理未配對的選手（只有奇數人時才應該有一人輪空）
    if (isOddPlayers && paired.size < sortedPlayers.length) {
      handleByePlayer(sortedPlayers, paired, newMatches);
    }
    
    // 更新 matchesByRound，保留之前輪次的比賽記錄
    setMatchesByRound(prev => {
      // 創建新的 matchesByRound 狀態，只保留不大於當前輪次的輪次資料
      const updatedMatchesByRound = {};
      
      // 複製之前的輪次資料
      Object.keys(prev).forEach(round => {
        const roundNum = parseInt(round, 10);
        if (roundNum <= currentRound) {
          updatedMatchesByRound[roundNum] = roundNum === currentRound ? newMatches : prev[roundNum];
        }
      });
      
      // 確保當前輪次存在
      if (!updatedMatchesByRound[currentRound]) {
        updatedMatchesByRound[currentRound] = newMatches;
      }
      
      return updatedMatchesByRound;
    });
    
    // 更新當前顯示的桌次
    setMatches(newMatches);
    message.success('第 ' + currentRound + ' 輪配對完成！');
  };
  // 單循環配對
  const generateRoundRobinPairings = () => {
    // 實現單循環配對邏輯
    // 這裡使用貝格爾表(Berger tables)算法生成單循環配對
    const n = allPlayers;
    
    // 如果是奇數，添加一個虛擬選手 (0) 表示輪空
    const adjustedN = n % 2 === 0 ? n : n + 1;
    const allRoundMatches = {}; // 儲存所有輪次的配對
    
    for (let round = 1; round <= rounds; round++) {
      const roundMatches = [];
      
      for (let i = 0; i < adjustedN / 2; i++) {
        let player1 = (round + i) % (adjustedN - 1);
        player1 = player1 === 0 ? adjustedN - 1 : player1;
        
        let player2 = (adjustedN - 1 - i + round) % (adjustedN - 1);
        player2 = player2 === 0 ? adjustedN - 1 : player2;
        
        if (i === 0) {
          player2 = adjustedN;
        }
        
        // 調整為實際選手編號
        const p1 = player1 > n ? 0 : player1;
        const p2 = player2 > n ? 0 : player2;
        
        if (p1 !== 0 && p2 !== 0) {
          roundMatches.push({
            table: roundMatches.length + 1,
            player1: p1,
            player2: p2,
            round: round,
            player1IsBlack: round % 2 === 1 // 奇數輪第一位是黑方
          });
        }
      }
      
      // 儲存每一輪的配對
      allRoundMatches[round] = roundMatches;
    }
    
    // 更新當前輪次的桌次
    setMatches(allRoundMatches[currentRound] || []);
    
    // 更新 matchesByRound
    setMatchesByRound(prev => {
      // 創建新的 matchesByRound 狀態
      const updatedMatchesByRound = {};
      
      // 複製之前的輪次資料，只保留不大於當前輪次的輪次
      Object.keys(prev).forEach(round => {
        const roundNum = parseInt(round, 10);
        if (roundNum < currentRound) { // 注意這裡只保留之前輪次的記錄
          updatedMatchesByRound[roundNum] = prev[roundNum];
        }
      });
      
      // 添加或更新當前輪次的資料
      updatedMatchesByRound[currentRound] = allRoundMatches[currentRound] || [];
      
      return updatedMatchesByRound;
    });
    
    message.success('第 ' + currentRound + ' 輪配對完成！');
  };

  // 決定誰先手 (黑方)
  const determineFirstMove = (player1, player2, round) => {
    // 計算兩位選手之前當黑方的次數
    const p1BlackCount = player1.rounds.filter(r => r.isBlack).length;
    const p2BlackCount = player2.rounds.filter(r => r.isBlack).length;
    
    // 如果有一位選手明顯比另一位更少當黑方，則讓他當黑方
    if (p1BlackCount < p2BlackCount) {
      return true;
    } else if (p2BlackCount < p1BlackCount) {
      return false;
    } else {
      // 如果兩位選手當黑方次數相同，則依照籤號決定
      // 奇數輪：較小籤號當黑方；偶數輪：較大籤號當黑方
      return round % 2 === 1 ? player1.number < player2.number : player1.number > player2.number;
    }
  };

  // 計算各種輔分
  const calculateAuxiliaryScores = (playersList) => {
    const updatedPlayers = [...playersList];
    
    // 初始化輔分
    updatedPlayers.forEach(player => {
      player.auxScore1 = 0;
      player.auxScore2 = 0;
      player.auxScore3 = 0;
    });
    
    // 輔分一：所遇對手之總分和
    updatedPlayers.forEach(player => {
      player.rounds.forEach(round => {
        if (round.opponent && round.opponent !== 0) {
          const opponent = updatedPlayers.find(p => p.number === round.opponent);
          if (opponent) {
            player.auxScore1 += opponent.totalScore;
          }
        }
      });
    });
    
    // 輔分二：所負對手之總分和
    updatedPlayers.forEach(player => {
      player.rounds.forEach(round => {
        if (round.opponent && round.opponent !== 0 && round.score < (winPoint / 2)) {
          const opponent = updatedPlayers.find(p => p.number === round.opponent);
          if (opponent) {
            player.auxScore2 += opponent.totalScore;
          }
        }
      });
    });
    
    // 修改後的輔分三計算：在總分、輔分一、輔分二相同的情況下，計算直接對戰結果
    // 先根據總分、輔分一、輔分二分組
    const playerGroups = [];
    const processed = new Set();
    
    for (let i = 0; i < updatedPlayers.length; i++) {
      const player = updatedPlayers[i];
      if (processed.has(player.number)) continue;
      
      const group = [player];
      processed.add(player.number);
      
      // 找出所有總分、輔分一、輔分二相同的選手
      for (let j = 0; j < updatedPlayers.length; j++) {
        const otherPlayer = updatedPlayers[j];
        if (player.number === otherPlayer.number) continue;
        if (processed.has(otherPlayer.number)) continue;
        
        if (player.totalScore === otherPlayer.totalScore && 
            player.auxScore1 === otherPlayer.auxScore1 && 
            player.auxScore2 === otherPlayer.auxScore2) {
          group.push(otherPlayer);
          processed.add(otherPlayer.number);
        }
      }
      
      if (group.length > 1) {
        playerGroups.push(group);
      }
    }
    
    // 對每個分組計算選手之間的直接對戰結果
    playerGroups.forEach(group => {
      for (let i = 0; i < group.length; i++) {
        const player = group[i];
        let directMatchupScore = 0;
        
        for (let j = 0; j < group.length; j++) {
          if (i === j) continue;
          const opponent = group[j];
          
          // 查找直接對戰結果
          const matchup = player.rounds.find(round => round.opponent === opponent.number);
          if (matchup) {
            if (matchup.score > (winPoint / 2)) {
              directMatchupScore += 1; // 勝利
            } else if (matchup.score < (winPoint / 2)) {
              directMatchupScore -= 1; // 失敗
            }
          }
        }
        
        // 更新輔分三
        const playerIndex = updatedPlayers.findIndex(p => p.number === player.number);
        updatedPlayers[playerIndex].auxScore3 = directMatchupScore;
      }
    });


    return updatedPlayers;
  };

  // 計算得分
  const calculateScores = () => {
    // 深拷貝玩家數據
    const updatedPlayers = JSON.parse(JSON.stringify(players));
    
    // 計算每輪的分數
    matches.forEach(match => {
      const p1Index = updatedPlayers.findIndex(p => p.number === match.player1);
      const p2Index = match.player2 === 0 ? -1 : updatedPlayers.findIndex(p => p.number === match.player2);
      
      // 如果有比賽結果或是輪空情況
      if (match.player1Score !== undefined && match.player1Score !== null) {
        // 更新選手1的記錄
        updatedPlayers[p1Index].rounds[match.round - 1] = {
          score: match.player1Score,
          opponent: match.player2,
          isBlack: match.player1IsBlack
        };
        
        // 更新選手2的記錄 (如果不是輪空)
        if (p2Index !== -1) {
          updatedPlayers[p2Index].rounds[match.round - 1] = {
            score: winPoint - match.player1Score, // 對手的分數
            opponent: match.player1,
            isBlack: !match.player1IsBlack
          };
        }
      }
      // 自動處理輪空情況 - 確保輪空選手得到勝分
      else if (match.player2 === 0) {
        // 輪空選手自動得到勝分
        updatedPlayers[p1Index].rounds[match.round - 1] = {
          score: winPoint, // 輪空獲得勝分
          opponent: 0, // 輪空
          isBlack: match.player1IsBlack
        };
        // 設置比賽結果，以便顯示
        match.player1Score = winPoint;
      }
    });
    
    // 計算總分
    updatedPlayers.forEach(player => {
      player.totalScore = player.rounds.reduce((total, round) => {
        return total + (round.score || 0);
      }, 0);
    });
    
    // 計算輔分
    const playersWithAuxScores = calculateAuxiliaryScores(updatedPlayers);
    
    // 更新排名
    const rankedPlayers = [...playersWithAuxScores].sort((a, b) => {
      // 先按總分排序
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      
      // 如果總分相同，按輔分一排序
      if (b.auxScore1 !== a.auxScore1) {
        return b.auxScore1 - a.auxScore1;
      }
      
      // 如果輔分一相同，按輔分二排序
      if (b.auxScore2 !== a.auxScore2) {
        return b.auxScore2 - a.auxScore2;
      }
      
      // 如果輔分二相同，按輔分三排序
      if (b.auxScore3 !== a.auxScore3) {
        return b.auxScore3 - a.auxScore3;
      }
      
      // 所有輔分相同，按籤號排序
      return a.number - b.number;
    });
    
    // 分配名次 - 修改為支援並列名次 (1, 1, 3, 4, 4, 6...)
    let currentRank = 1;
    let skipCount = 0;

    for (let i = 0; i < rankedPlayers.length; i++) {
      // 找出此選手在原數組中的索引
      const playerIndex = playersWithAuxScores.findIndex(p => p.number === rankedPlayers[i].number);
      
      if (i > 0) {
        // 檢查和前一位選手是否得分相同
        const prevPlayer = rankedPlayers[i - 1];
        const currentPlayer = rankedPlayers[i];
        
        const isTied = currentPlayer.totalScore === prevPlayer.totalScore && 
                      currentPlayer.auxScore1 === prevPlayer.auxScore1 && 
                      currentPlayer.auxScore2 === prevPlayer.auxScore2 &&
                      currentPlayer.auxScore3 === prevPlayer.auxScore3;

        if (isTied) {
          // 與前一位選手並列，使用相同名次
          playersWithAuxScores[playerIndex].rank = currentRank;
          skipCount++;
        } else {
          // 不是並列，名次需要跳過已經使用的數量
          currentRank += skipCount + 1;
          skipCount = 0;
          playersWithAuxScores[playerIndex].rank = currentRank;
        }
      } else {
        // 第一位選手，名次為1
        playersWithAuxScores[playerIndex].rank = currentRank;
      }
    }

    // 在計算完分數後，啟用「抓對」按鈕
    setIsPairingButtonDisabled(false);
    
    setPlayers(playersWithAuxScores);
    message.success('得分計算完成！');
  };

  // 將選手成績下載為Excel格式
  const exportPlayersToExcel = () => {
    // 根據顯示排序獲取選手清單
    const sortedPlayers = getSortedPlayers();
    
    // 準備選手成績的數據
    const playerData = [];
    
    // 建立標題行
    const headers = ['籤號', '隊伍'];
    
    // 添加輪次標題
    for (let i = 1; i <= rounds; i++) {
      headers.push(`第${i}輪分數`, `第${i}輪對手`);
    }
    
    // 添加結算標題
    headers.push('總分', '輔分一', '輔分二', '輔分三', '名次');
    playerData.push(headers);
    
    // 添加每位選手的數據
    sortedPlayers.forEach(player => {
      const row = [player.number, player.name];
      
      // 添加每輪的比賽結果
      for (let i = 0; i < rounds; i++) {
        const round = player.rounds[i] || { score: null, opponent: null };
        row.push(round.score !== null ? round.score : '');
        row.push(round.opponent ? round.opponent : '');
      }
      
      // 添加統計數據
      row.push(player.totalScore, player.auxScore1, player.auxScore2, player.auxScore3, player.rank);
      playerData.push(row);
    });
    
    // 準備桌次表數據
    let tableData = [];
    let sheets = [];
    
    // 添加選手成績分頁
    sheets.push({
      name: '選手成績',
      data: playerData
    });
    
    // 添加各輪桌次表數據
    const sortedRounds = Object.keys(matchesByRound).map(Number).sort((a, b) => a - b);
    
    sortedRounds.forEach(round => {
      const matchesToExport = matchesByRound[round] || [];
      
      if (matchesToExport.length > 0) {
        // 建立標題行
        tableData = [['桌號', '黑方', '白方', '勝方']];
        
        // 添加每桌的比賽資訊
        matchesToExport.forEach(match => {
          const blackPlayer = match.player1IsBlack ? getPlayerName(match.player1) : (match.player2 === 0 ? '輪空' : getPlayerName(match.player2));
          const whitePlayer = !match.player1IsBlack ? getPlayerName(match.player1) : (match.player2 === 0 ? '輪空' : getPlayerName(match.player2));
          
          // 決定勝方
          let winner = '';
          if (match.player2 === 0) {
            winner = getPlayerName(match.player1); // 輪空勝
          } else if (match.player1Score === winPoint) {
            winner = getPlayerName(match.player1);
          } else if (match.player1Score === 0) {
            winner = getPlayerName(match.player2);
          }
          
          tableData.push([match.table, blackPlayer, whitePlayer, winner]);
        });
        
        // 添加該輪次桌次表分頁
        sheets.push({
          name: `第${round}輪桌次表`,
          data: tableData
        });
      }
    });
    
    // 下載Excel檔案
    downloadExcel(sheets, `${gameTitle}_比賽資料_${new Date().toISOString().slice(0, 10)}.xlsx`);
    message.success('下載比賽資料成功！');
  };
  
  // 將桌次表下載為Excel格式
  const exportMatchesToExcel = () => {
    if (Object.keys(matchesByRound).length === 0) {
      message.warning('無桌次表可下載！');
      return;
    }
    
    // 決定要下載的輪次
    const roundToExport = selectedRound;
    const matchesToExport = matchesByRound[roundToExport] || [];
    
    if (matchesToExport.length === 0) {
      message.warning(`第 ${roundToExport} 輪無桌次表可下載！`);
      return;
    }
    
    // 準備數據
    const tableData = [];
    
    // 建立標題行
    tableData.push(['桌號', '黑方', '白方', '勝方']);
    
    // 添加每桌的比賽資訊
    matchesToExport.forEach(match => {
      const blackPlayer = match.player1IsBlack ? getPlayerName(match.player1) : (match.player2 === 0 ? '輪空' : getPlayerName(match.player2));
      const whitePlayer = !match.player1IsBlack ? getPlayerName(match.player1) : (match.player2 === 0 ? '輪空' : getPlayerName(match.player2));
      
      // 決定勝方
      let winner = '';
      if (match.player2 === 0) {
        winner = getPlayerName(match.player1); // 輪空勝
      } else if (match.player1Score === winPoint) {
        winner = getPlayerName(match.player1);
      } else if (match.player1Score === 0) {
        winner = getPlayerName(match.player2);
      }
      
      tableData.push([match.table, blackPlayer, whitePlayer, winner]);
    });
    
    // 下載Excel檔案
    downloadExcel([{ name: `第${roundToExport}輪桌次表`, data: tableData }], `${gameTitle}_第${roundToExport}輪_桌次表_${new Date().toISOString().slice(0, 10)}.xlsx`);
    message.success(`下載第 ${roundToExport} 輪桌次表成功！`);
  };
  
  // 處理上傳籤號與隊伍對應表
const handleFileUpload = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  
  reader.onload = (e) => {
  try {
  // 顯示處理過程的訊息，方便除錯
  console.log("開始處理檔案...");
  
  // 嘗試直接以 ArrayBuffer 方式讀取，這對所有 Excel 格式最通用
  let workbook;
  const data = new Uint8Array(e.target.result);
  
  try {
  console.log("嘗試以 array 類型讀取...");
  workbook = XLSX.read(data, { 
  type: 'array',
    cellDates: true,
      cellStyles: true,
    cellNF: true
  });
  } catch (err) {
  console.warn('array 類型讀取失敗，錯誤:', err);
  console.log("嘗試以 binary 類型讀取...");
  
  // 如果 array 讀取失敗，嘗試 binary 類型
  const binaryString = Array.from(new Uint8Array(e.target.result))
    .map(byte => String.fromCharCode(byte))
      .join('');
      
    workbook = XLSX.read(binaryString, { 
      type: 'binary',
      cellDates: true,
      cellStyles: true,
      cellNF: true
    });
  }
  
  console.log("Excel 讀取成功，工作表:", workbook.SheetNames);
  
  // 使用更寬容的方式處理工作表
  let jsonData = [];
  let sheetProcessed = false;
  
  // 首先嘗試直接處理第一個工作表，不要進行標題驗證
  if (workbook.SheetNames.length > 0) {
  try {
  console.log("直接處理第一個工作表...");
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  // 先嘗試標準轉換
  jsonData = XLSX.utils.sheet_to_json(worksheet, {
  defval: '',
  raw: false
  });
  
  console.log("工作表轉換結果:", jsonData.length > 0 ? "成功" : "無數據");
  
  // 如果標準轉換沒有數據，嘗試使用 header: 1 來獲取原始數據
  if (jsonData.length === 0) {
  console.log("嘗試使用 header: 1 方式讀取原始數據...");
    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
    raw: false
  });
  
  if (rawData.length > 1) { // 確保至少有標題行和一行數據
    const headers = rawData[0];
    
    // 手動將原始數據轉換為對象數組
    jsonData = rawData.slice(1).map(row => {
        const obj = {};
          headers.forEach((header, index) => {
              if (header) { // 只處理有標題的列
                obj[header] = row[index] || '';
              }
            });
          return obj;
        });
        
      console.log("原始數據手動轉換結果:", jsonData.length > 0 ? "成功" : "無數據");
    }
    }
    
      sheetProcessed = jsonData.length > 0;
    } catch (sheetErr) {
      console.warn("處理第一個工作表時出錯:", sheetErr);
    }
  }
  
  // 如果第一個工作表處理失敗，再嘗試其他工作表和更多讀取方式
  if (!sheetProcessed) {
    console.log("第一個工作表處理失敗，嘗試檢查所有工作表...");
  
  // 嘗試所有工作表
  for (const sheetName of workbook.SheetNames) {
  try {
      const worksheet = workbook.Sheets[sheetName];
      
        // 嘗試使用不同的轉換選項
        [
          { header: 'A', defval: '', raw: false },
          { defval: '', raw: false },
          { header: 1, defval: '', raw: false }
        ].some(options => {
          try {
            console.log(`嘗試工作表 ${sheetName} 使用選項:`, options);
          const tempData = XLSX.utils.sheet_to_json(worksheet, options);
          
        if (tempData.length > 0) {
          if (options.header === 1) {
              // 如果使用 header: 1，需要手動轉換
              const headers = tempData[0];
              jsonData = tempData.slice(1).map(row => {
              const obj = {};
              headers.forEach((header, index) => {
                  if (header) {
                    obj[header] = row[index] || '';
                  }
              });
              return obj;
              });
            } else if (options.header === 'A') {
              // 如果使用 header: 'A'，檢查第一行作為標題
            const headers = tempData[0];
            const headerValues = Object.values(headers);
              
              // 轉換數據
              jsonData = tempData.slice(1).map(row => {
                const obj = {};
                Object.keys(headers).forEach(key => {
                  const header = headers[key];
                  obj[header] = row[key] || '';
              });
              return obj;
          });
          } else {
            jsonData = tempData;
            }
            
            sheetProcessed = jsonData.length > 0;
            console.log(`工作表 ${sheetName} 處理結果:`, sheetProcessed ? "成功" : "無數據");
            return sheetProcessed; // 如果成功處理，中斷 some 循環
          }
          return false;
      } catch (optErr) {
        console.warn(`工作表 ${sheetName} 使用選項處理失敗:`, optErr);
          return false;
        }
      });
      
    if (sheetProcessed) break; // 如果成功處理了一個工作表，跳出循環
  } catch (err) {
    console.warn(`處理工作表 ${sheetName} 時出錯:`, err);
  }
  }
  }
  
  // 在顯示錯誤前，嘗試最後一種方法：直接轉換為 CSV 再解析
  if (!sheetProcessed && workbook.SheetNames.length > 0) {
  try {
  console.log("嘗試 CSV 轉換方法...");
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
    // 將工作表轉換為 CSV
  const csv = XLSX.utils.sheet_to_csv(worksheet);
    console.log("CSV 轉換結果前 100 字元:", csv.substring(0, 100));
      
      // 簡單的 CSV 解析
      const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length > 1) { // 至少有標題和一行數據
      const headers = lines[0].split(',').map(h => h.trim());
      
      jsonData = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
      const obj = {};
      
        headers.forEach((header, index) => {
          if (header && index < values.length) {
            obj[header] = values[index] || '';
            }
        });
        
          return obj;
      });
        
          sheetProcessed = jsonData.length > 0;
        console.log("CSV 處理結果:", sheetProcessed ? "成功" : "無數據");
      }
      } catch (csvErr) {
          console.warn("CSV 處理方法失敗:", csvErr);
        }
      }
    
    // 如果仍然沒有數據，拋出錯誤
      if (jsonData.length === 0) {
        throw new Error('找不到有效的資料，請檢查Excel檔案格式，或確認檔案是否為空');
      }
      
    console.log("成功獲取數據，數據筆數:", jsonData.length);
      console.log("數據範例:", jsonData.slice(0, 2));
    
  // 輔助函數：嘗試各種可能的欄位名稱
    const getValueByPossibleFieldNames = (row, possibleNames) => {
    for (const name of possibleNames) {
        if (row[name] !== undefined && row[name] !== '') {
            return row[name];
          }
        }
        return null;
      };
      
      // 更寬容的欄位名稱檢測
      const numberFieldNames = [
        '籤號', '編號', '號碼', 'No', 'no', '序號', '序', 'number', 'Number',
        'id', 'ID', '識別碼', 'num', 'Num', '選手編號', 'player number'
      ];
      
      const nameFieldNames = [
        '隊伍', '隊名', '團隊', '名稱', 'name', 'Name', '名字', '選手', '參賽者',
        'team', 'Team', 'teamname', 'TeamName', 'player', 'Player', '選手名稱'
      ];
      
      const countryFieldNames = [
        '國家', '城市', '地區', 'country', 'Country', '地點', '所屬', '城市',
        'region', 'Region', 'area', 'Area', 'location', 'Location'
      ];
      
      const levelFieldNames = [
        '段位', '級別', '等級', 'level', 'Level', '排名', '技術等級', '段數',
        'rank', 'Rank', 'rating', 'Rating', 'class', 'Class'
      ];
      
      // 嘗試查找合適的欄位名稱
      console.log("檢查是否可找到必要欄位...");
      const sampleRow = jsonData[0];
      
      // 嘗試找到籤號欄位
      const possibleNumberField = numberFieldNames.find(fieldName => 
        sampleRow[fieldName] !== undefined
      );
      
      // 嘗試找到隊伍名稱欄位
      const possibleNameField = nameFieldNames.find(fieldName => 
        sampleRow[fieldName] !== undefined
      );
      
      console.log("可能的籤號欄位:", possibleNumberField);
      console.log("可能的隊伍欄位:", possibleNameField);
      
      // 檢查是否找到了必要欄位
      if (!possibleNumberField && !possibleNameField) {
        console.log("數據欄位示例:", Object.keys(sampleRow));
        // 嘗試使用任何可能是數字的欄位作為籤號
        const anyNumberField = Object.keys(sampleRow).find(key => {
          const value = sampleRow[key];
          return !isNaN(parseInt(value));
        });
        
        // 嘗試使用任何可能是字串的欄位作為隊伍名稱
        const anyStringField = Object.keys(sampleRow).find(key => {
          const value = sampleRow[key];
          return typeof value === 'string' && value.trim() !== '';
        });
        
        console.log("備用籤號欄位:", anyNumberField);
        console.log("備用隊伍欄位:", anyStringField);
        
        if (!anyNumberField || !anyStringField) {
          throw new Error('無法辨識必要欄位（籤號和隊伍名稱）。請確保Excel表格包含這些欄位，並且欄位名稱明確。');
        }
      }
      
      // 更新選手資料
      const updatedPlayers = [...players];
      let updatedCount = 0;
      let fieldErrors = [];
      
      console.log("開始更新選手資料...");
      
      jsonData.forEach((row, rowIndex) => {
        // 獲取籤號，如果是字串，轉換為數字
        let numberValue = getValueByPossibleFieldNames(row, numberFieldNames);
        
        // 如果找不到標準籤號欄位，嘗試使用任何數字欄位
        if (numberValue === null) {
          // 尋找任何可能是數字的欄位
          for (const key in row) {
            const value = row[key];
            if (!isNaN(parseInt(value))) {
              numberValue = value;
              break;
            }
          }
        }
        
        let number;
        if (numberValue !== null) {
          // 如果是字串，移除非數字字元
          if (typeof numberValue === 'string') {
            numberValue = numberValue.replace(/[^0-9]/g, '');
          }
          number = parseInt(numberValue);
        }
        
        // 獲取隊伍名稱
        let name = getValueByPossibleFieldNames(row, nameFieldNames);
        
        // 如果找不到標準隊伍欄位，嘗試使用任何字串欄位
        if (!name) {
          // 尋找任何可能是字串的欄位
          for (const key in row) {
            const value = row[key];
            if (typeof value === 'string' && value.trim() !== '' && key !== possibleNumberField) {
              name = value;
              break;
            }
          }
        }
        
        // 輸出除錯訊息
        console.log(`第 ${rowIndex + 1} 行解析結果: 籤號=${number}, 隊伍=${name}`);
        
        // 檢查是否缺少必要欄位
        if (isNaN(number) || !name) {
          fieldErrors.push(`第 ${rowIndex + 1} 行: ${isNaN(number) ? '缺少有效籤號' : ''} ${!name ? '缺少有效隊伍名稱' : ''}`);
          return; // 跳過此行
        }
        
        const playerIndex = updatedPlayers.findIndex(p => p.number === number);
        if (playerIndex !== -1) {
          updatedPlayers[playerIndex].name = name;
          updatedCount++;
          
          // 如果有國家/城市資料，也可以一併更新
          const country = getValueByPossibleFieldNames(row, countryFieldNames);
          if (country) {
            updatedPlayers[playerIndex].country = country;
          }
          
          // 如果有段位資料，也可以一併更新
          const level = getValueByPossibleFieldNames(row, levelFieldNames);
          if (level) {
            updatedPlayers[playerIndex].level = level;
          }
        } else {
          fieldErrors.push(`第 ${rowIndex + 1} 行: 籤號 ${number} 不在系統中`);
        }
      });
      
      console.log(`更新完成: 成功=${updatedCount}, 錯誤=${fieldErrors.length}`);
      
      if (updatedCount > 0) {
        setPlayers(updatedPlayers);
        let successMessage = `成功上傳籤號與隊伍對應表！已更新 ${updatedCount} 筆資料。`;
        
        // 如果有錯誤，但也有成功的更新，顯示組合訊息
        if (fieldErrors.length > 0) {
          const errorCount = fieldErrors.length > 3 ? `${fieldErrors.length} 筆` : fieldErrors.join('；');
          successMessage += `\n但有 ${errorCount} 資料有問題，已忽略。`;
        }
        
        message.success(successMessage);
      } else if (fieldErrors.length > 0) {
        // 只有錯誤，沒有成功更新
        message.warning(`上傳失敗：${fieldErrors.length} 筆資料有問題，請檢查Excel格式。具體錯誤: ${fieldErrors.slice(0, 3).join('；')}${fieldErrors.length > 3 ? '...' : ''}`);
      } else {
        message.warning('沒有更新任何資料。請確認Excel表格包含「籤號」和「隊伍」欄位，且籤號與系統中的籤號相符。');
      }
      
    } catch (error) {
      console.error('檔案處理錯誤:', error);
      message.error(`處理檔案時發生錯誤: ${error.message}。請確認檔案格式是否正確或檢查控制台獲取更多資訊。`);
    }
  };
  
  reader.onerror = (error) => {
    console.error('檔案讀取錯誤:', error);
    message.error(`讀取檔案時發生錯誤: ${error.message || '未知錯誤'}`);
  };
  
  // 使用 ArrayBuffer 模式讀取所有檔案，簡化邏輯
  reader.readAsArrayBuffer(file);
};

  // 下載所有桌次表
  const exportAllMatchesToExcel = () => {
    if (Object.keys(matchesByRound).length === 0) {
      message.warning('無桌次表可下載！');
      return;
    }
    
    // 準備分頁數據
    const sheets = [];
    
    // 準備全部輪次合併的數據
    const allMatchesData = [['輪次', '桌號', '黑方', '白方', '勝方']];
    
    // 按照輪次排序
    const sortedRounds = Object.keys(matchesByRound).map(Number).sort((a, b) => a - b);
    
    // 對每一輪的每一桌比賽
    sortedRounds.forEach(round => {
      const roundMatches = matchesByRound[round] || [];
      
      // 每輪的數據
      const roundData = [['桌號', '黑方', '白方', '勝方']];
      
      roundMatches.forEach(match => {
        const blackPlayer = match.player1IsBlack ? getPlayerName(match.player1) : (match.player2 === 0 ? '輪空' : getPlayerName(match.player2));
        const whitePlayer = !match.player1IsBlack ? getPlayerName(match.player1) : (match.player2 === 0 ? '輪空' : getPlayerName(match.player2));
        
        // 決定勝方
        let winner = '';
        if (match.player2 === 0) {
          winner = getPlayerName(match.player1); // 輪空勝
        } else if (match.player1Score === winPoint) {
          winner = getPlayerName(match.player1);
        } else if (match.player1Score === 0) {
          winner = getPlayerName(match.player2);
        }
        
        // 添加到各輪數據
        roundData.push([match.table, blackPlayer, whitePlayer, winner]);
        
        // 添加到全部輪次數據
        allMatchesData.push([round, match.table, blackPlayer, whitePlayer, winner]);
      });
      
      // 添加該輪數據為一個分頁
      if (roundData.length > 1) {
        sheets.push({
          name: `第${round}輪桌次表`,
          data: roundData
        });
      }
    });
    
    // 添加全部輪次的合併數據為首頁
    if (allMatchesData.length > 1) {
      sheets.unshift({
        name: '全部桌次表',
        data: allMatchesData
      });
    }
    
    // 下載Excel檔案
    downloadExcel(sheets, `${gameTitle}_全部桌次表_${new Date().toISOString().slice(0, 10)}.xlsx`);
    message.success('下載全部桌次表成功！');
  };

  // 取得兩名選手間的直接對戰結果
  const getDirectMatchupResult = (playerA, playerB) => {
    // 查找 A 對 B 的對戰記錄
    const aVsB = playerA.rounds.find(round => round.opponent === playerB.number);
    const bVsA = playerB.rounds.find(round => round.opponent === playerA.number);
    
    if (!aVsB && !bVsA) return 0; // 沒有直接對戰記錄
    
    // 計算第三輔分：如曾對戰過，彼此交戰之勝負(勝方+1)
    if (aVsB) {
      if (aVsB.score > (winPoint / 2)) {
        return -1; // A 贏 B，A 的排名靠前
      } else if (aVsB.score < (winPoint / 2)) {
        return 1; // B 贏 A，B 的排名靠前
      }
    }
    
    // 以防萬一檢查 B 對 A 的記錄（理論上不需要，因為對戰記錄應該是互相對應的）
    if (bVsA) {
      if (bVsA.score > (winPoint / 2)) {
        return 1; // B 贏 A，B 的排名靠前
      } else if (bVsA.score < (winPoint / 2)) {
        return -1; // A 贏 B，A 的排名靠前
      }
    }
    
    return 0; // 平局或沒有對戰記錄
  };


  // 切換排序方式
  const toggleSortOrder = () => {
    setSortByRank(!sortByRank);
  };

  // 根據名次或籤號排序
  const getSortedPlayers = () => {
    return [...players].sort((a, b) => {
      if (sortByRank) {
        return a.rank - b.rank;
      }
      return a.number - b.number;
    });
  };

  // 紀錄比賽結果
  const recordResult = (matchIndex, winnerNumber) => {
    const newMatches = [...matches];
    const match = newMatches[matchIndex];
    
    // 如果是輪空場次，自動設置player1為勝方
    if (match.player2 === 0) {
      match.player1Score = winPoint;
    }
    // 如果獲勝者是player1，則player1得分為winPoint，否則為0
    else if (match.player1 === winnerNumber) {
      match.player1Score = winPoint;
    } else if (match.player2 === winnerNumber) {
      match.player1Score = 0;
    }
    
    setMatches(newMatches);
    
    // 更新matchesByRound中的對應比賽記錄
    const roundMatches = [...matchesByRound[match.round]];
    const roundMatchIndex = roundMatches.findIndex(m => m.table === match.table);
    if (roundMatchIndex !== -1) {
      roundMatches[roundMatchIndex] = match;
      setMatchesByRound(prev => ({
        ...prev,
        [match.round]: roundMatches
      }));
    }
  };

  // 重設系統
  const resetSystem = () => {
    // 檢查瑞士制輪數設定
    if (gameType === '瑞士制') {
      const maxRounds = Math.ceil(Math.log2(allPlayers));
      const minRounds = Math.ceil(Math.log2(allPlayers));
      
      if (rounds > (allPlayers % 2 === 1 ? allPlayers : allPlayers - 1)) {
        message.warning(`瑞士制輪數設定過多，將造成最後無法抓對。
參賽 ${allPlayers} 人建議可採 ${allPlayers % 2 === 1 ? allPlayers : allPlayers - 1} 輪單循環賽制，或 ${allPlayers % 2 === 1 ? allPlayers : allPlayers - 1} 輪以下的瑞士制`);
        return;
      }
      
      if (Math.pow(2, rounds) < allPlayers) {
        message.warning(`${rounds} 輪瑞士制在參賽人數超過 ${Math.pow(2, rounds)} 人時，恐無法分出勝負。
參賽 ${allPlayers} 人建議至少打 ${minRounds} 輪以上的瑞士制`);
      }
    }
    
    // 重置所有數據
    initializePlayers();
    setCurrentRound(1);
    setSortByRank(false);
    setAllowSameCountry(false);
    // 重設 matchesByRound
    setMatchesByRound({});
    // 重設當前顯示的桌次
    setMatches([]);
    // 重設選中的輪次
    setSelectedRound(1);
    // 重設抓對按鈕狀態
    setIsPairingButtonDisabled(false);
    message.success('系統已重設！');
  };

  // 生成桌次表
  const generateTableView = (matchesForRound = matches, round = currentRound) => {
    return (
      <div className="p-4">
        <h2 className="text-xl font-bold mb-4">第 {round} 輪桌次表</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border">
            <thead>
              <tr className="bg-gray-200">
                <th className="border p-2">桌號</th>
                <th className="border p-2">黑方</th>
                <th className="border p-2">白方</th>
                <th className="border p-2">結果</th>
              </tr>
            </thead>
            <tbody>
              {matchesForRound.map((match, index) => (
                <tr key={index} className="hover:bg-blue-100">
                  <td className="border p-2 text-center">{match.table}</td>
                  <td className="border p-2">
                    {match.player1IsBlack 
                      ? getPlayerName(match.player1) 
                      : match.player2 === 0 ? '輪空' : getPlayerName(match.player2)}
                  </td>
                  <td className="border p-2">
                    {!match.player1IsBlack 
                      ? getPlayerName(match.player1) 
                      : match.player2 === 0 ? '輪空' : getPlayerName(match.player2)}
                  </td>
                  <td className="border p-2 text-center">
                    {match.player2 !== 0 ? (
                      <div className="flex flex-col items-center">
                        <div className="flex justify-center space-x-2">
                          <Button 
                            size="small"
                            onClick={() => recordResult(index, match.player1)}
                            type={match.player1Score === winPoint ? 'primary' : 'default'}
                          >
                            {getPlayerName(match.player1)} 勝
                          </Button>
                          <Button 
                            size="small"
                            onClick={() => recordResult(index, match.player2)}
                            type={match.player1Score === 0 ? 'primary' : 'default'}
                          >
                            {getPlayerName(match.player2)} 勝
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <Button 
                          size="small"
                          onClick={() => recordResult(index, match.player1)}
                          type="primary"
                        >
                          {getPlayerName(match.player1)} 輪空勝
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // 獲取選手隊伍
  const getPlayerName = (number) => {
    if (number === 0) return '輪空';
    const player = players.find(p => p.number === number);
    return player ? `${number}. ${player.name}` : `選手${number}`;
  };

  // 渲染選手列表
  const renderPlayerList = () => {
    const sortedPlayers = getSortedPlayers();
    
    return (
      <div>
        <div className="mb-4 relative">
          <Button 
            onClick={() => setEditMode(!editMode)}
            type={editMode ? 'primary' : 'default'}
            className="absolute left-0 top-0"
          >
            {editMode ? '完成編輯' : '編輯選手資料'}
          </Button>
          
          <div className="text-center font-bold w-full">隊伍列表及成績</div>
        </div>
        
        <div className="overflow-x-auto max-h-[calc(100vh-180px)]">
          <table className="w-full border-collapse border table-fixed">
            <thead>
              <tr className="bg-gray-200 sticky top-0">
                <th className="border p-2 w-10">籤號</th>
                <th className="border p-2 w-32">隊伍</th>
                {Array.from({ length: rounds }).map((_, i) => (
                  <React.Fragment key={i}>
                    <th className="border p-2 w-12">R{i + 1}</th>
                    <th className="border p-2 w-24">R{i + 1}對手</th>
                  </React.Fragment>
                ))}
                <th className="border p-2 bg-red-100 w-12">總分</th>
                <th className="border p-2 bg-green-100 w-12">輔分一</th>
                <th className="border p-2 bg-green-100 w-12">輔分二</th>
                <th className="border p-2 bg-green-100 w-12">輔分三</th>
                <th className="border p-2 bg-yellow-100 w-12">名次</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.map((player, index) => (
                <tr key={index} className="hover:bg-blue-100">
                  <td className="border p-2 text-center">{player.number}</td>
                  <td className="border p-2">
                    {editMode ? (
                      <input
                        type="text"
                        className="w-full p-1 border rounded"
                        value={player.name}
                        onChange={(e) => handlePlayerNameChange(player.number, e.target.value)}
                      />
                    ) : (
                      player.name
                    )}
                  </td>
                  {/* 確保輪次資料顯示正確 */}
                  {Array.from({ length: rounds }).map((_, i) => {
                    const round = player.rounds[i] || { score: null, opponent: null };
                    return (
                      <React.Fragment key={i}>
                        <td className="border p-2 text-center">
                          {round.score !== null ? round.score : ''}
                        </td>
                        <td className="border p-2 text-center">
                          {round.opponent ? getPlayerName(round.opponent) : ''}
                        </td>
                      </React.Fragment>
                    );
                  })}
                  <td className="border p-2 text-center">{player.totalScore}</td>
                  <td className="border p-2 text-center">{player.auxScore1}</td>
                  <td className="border p-2 text-center">{player.auxScore2}</td>
                  <td className="border p-2 text-center">{player.auxScore3}</td>
                  <td className="border p-2 text-center">{player.rank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // 渲染分割視窗中的右側面板（桌次選擇器和桌次表）
  const renderRightPane = () => {
    const roundOptions = Object.keys(matchesByRound).map(round => parseInt(round, 10)).sort((a, b) => a - b);
    
    return (
      <div className="p-4">
        {roundOptions.length > 0 ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="font-bold">桌次表</div>
              <div className="flex items-center">
                <div className="mr-2">選擇輪次：</div>
                <Select 
                  value={selectedRound} 
                  onChange={setSelectedRound} 
                  style={{ width: '100px' }}
                >
                  {roundOptions.map(round => (
                    <Option key={round} value={round}>第 {round} 輪</Option>
                  ))}
                </Select>
              </div>
            </div>
            {generateTableView(matchesByRound[selectedRound], selectedRound)}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center p-8 text-gray-500">
              尚未生成任何輪次的桌次表。請點擊「抓對」按鈕生成桌次表。
            </div>
          </div>
        )}
      </div>
    );
  };

  // 控制分割比例
  const handleSplitDragChange = (e) => {
    const container = document.getElementById('split-container');
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const ratio = ((e.clientX - containerRect.left) / containerRect.width) * 100;
      setSplitRatio(Math.max(30, Math.min(70, ratio))); // 限制比例在 30% 到 70% 之間
    }
  };

  return (
    <div className="p-2 max-w-full h-screen flex flex-col">
      <Card className="mb-2 py-1">
        <Title level={3} className="mb-1">WGP比賽管理系統</Title>
        <Divider className="my-1" />
        
        <Row gutter={16} className="mb-1">
          <Col span={6}>
            <div className="text-sm">賽制:</div>
            <Select 
              value={gameType} 
              onChange={setGameType} 
              style={{ width: '100%' }}
            >
              <Option value="瑞士制">瑞士制</Option>
              <Option value="單循環">單循環</Option>
            </Select>
          </Col>
          
          <Col span={6}>
            <div className="text-sm">比賽項目:</div>
            <Select 
              value={gameTitle} 
              onChange={setGameTitle} 
              style={{ width: '100%' }}
            >
              <Option value="WGP">WGP GiveMe5</Option>
            </Select>
          </Col>
          
          <Col span={6}>
            <div className="text-sm">參賽隊伍數:</div>
            <InputNumber 
              min={2} 
              value={allPlayers} 
              onChange={setAllPlayers} 
              style={{ width: '100%' }}
            />
          </Col>
          
          <Col span={6}>
            <div className="text-sm">比賽輪數:</div>
            <InputNumber 
              min={1} 
              value={rounds} 
              onChange={setRounds} 
              style={{ width: '100%' }}
            />
          </Col>
        </Row>
        
        <Row gutter={16} className="mb-1">
          <Col span={12}>
            <div className="text-sm">勝方得分:</div>
            <InputNumber 
              min={1} 
              value={winPoint} 
              onChange={setWinPoint} 
              style={{ width: '100%' }}
            />
          </Col>
          
          <Col span={12}>
            <div className="text-sm">當前輪次:</div>
            <InputNumber 
              min={1} 
              max={rounds} 
              value={currentRound} 
              onChange={setCurrentRound} 
              style={{ width: '100%' }}
            />
          </Col>
        </Row>
        
        <Row gutter={16}>
          <Col span={6}>
            <Button onClick={handleDrawLots} type="primary" block>
              抽籤
            </Button>
          </Col>
          <Col span={6}>
            <Button 
              onClick={generatePairings} 
              type="primary" 
              block
              disabled={isPairingButtonDisabled}
            >
              抓對
            </Button>
          </Col>
          <Col span={6}>
            <Button onClick={calculateScores} type="primary" block>
              算分
            </Button>
          </Col>
          <Col span={6}>
            <Button onClick={toggleSortOrder} type="primary" block>
              {sortByRank ? '籤號排序' : '名次排序'}
            </Button>
          </Col>
        </Row>
        
        <Row gutter={16} className="mt-2">
          <Col span={6}>
            <Button onClick={resetSystem} danger block>
              重設
            </Button>
          </Col>
          <Col span={6}>
            <div>
              <input
                type="file"
                id="fileUpload"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
                accept=".xlsx,.xls"
              />
              <Button
                onClick={() => document.getElementById('fileUpload').click()}
                type="primary"
                block
              >
                上傳隊伍表
              </Button>
            </div>
          </Col>
          <Col span={6}>
            <Button onClick={exportPlayersToExcel} type="primary" block>
            {/* <Button onClick={exportPlayersToExcel} className="bg-green-500 text-white hover:bg-green-600" block> */}
              下載選手成績
            </Button>
          </Col>
          <Col span={6}>
            <Button onClick={exportMatchesToExcel} type="primary" block>
            {/* <Button onClick={exportMatchesToExcel} className="bg-green-500 text-white hover:bg-green-600" block> */}
              下載桌次表
            </Button>
          </Col>
        </Row>
      </Card>
      
      {/* 分割視窗 */}
      <div 
        id="split-container"
        className="flex flex-grow bg-white shadow rounded overflow-hidden relative"
      >
        {/* 左側面板：選手列表 */}
        <div className="overflow-auto" style={{ width: `${splitRatio}%` }}>
          {renderPlayerList()}
        </div>
        
        {/* 分割線 - 可拖動 */}
        <div 
          className="w-1 bg-gray-300 cursor-col-resize hover:bg-blue-500 active:bg-blue-600"
          onMouseDown={(e) => {
            const handleMouseMove = (e) => handleSplitDragChange(e);
            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        ></div>
        
        {/* 右側面板：桌次表 */}
        <div className="overflow-auto" style={{ width: `${100 - splitRatio}%` }}>
          {renderRightPane()}
        </div>
      </div>
      
      <div className="mt-1 p-2 bg-white shadow rounded">
        <Title level={4}>輔分說明</Title>
        <p><strong>輔分一</strong>：所遇對手之總分和。隊伍遇到的所有對手總分加總。</p>
        <p><strong>輔分二</strong>：所負對手之總分和。隊伍輸掉的比賽中，對手的總分加總。</p>
        <p><strong>輔分三</strong>：(待確認)如曾對戰過，彼此交戰之勝負(勝方+1)。</p>
        {/* 彼此對戰之勝負差。當總分、輔分一及輔分二皆相同時，計算在這組選手中的勝負差（勝場數減去負場數）。正數表示贏多輸少，負數表示輸多贏少。</p> */}
      </div>
    </div>
  );
};

export default TournamentManager;