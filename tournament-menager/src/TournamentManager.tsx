import React, { useState, useEffect } from 'react';

// 上傳用於Excel處理的函數
import * as XLSX from 'xlsx';

import packageInfo from '../package.json';

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

// ─────────────────────────────────────────────────────────────────
// 自定義基本組件（重構：套用 CSS 變數主題系統）
// ─────────────────────────────────────────────────────────────────
const Title = ({ level, children, className }: { level?: number; children?: React.ReactNode; className?: string }) => {
  const Tag = `h${level || 2}` as keyof JSX.IntrinsicElements;
  return <Tag className={`font-bold mb-2 ${className || ''}`}>{children}</Tag>;
};

// Button：保留既有 API（type='primary' / danger / block / size='small'），改用 .btn-* utility
const Button = ({ onClick, type, block, danger, size, children, className, disabled, title }: {
  onClick?: () => void;
  type?: string;
  block?: boolean;
  danger?: boolean;
  size?: string;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
}) => {
  const getButtonClass = () => {
    let classes = "inline-flex items-center justify-center gap-1.5 rounded-md font-medium focus:outline-none ";

    // 尺寸
    if (size === 'small') classes += "px-2.5 h-7 text-xs ";
    else classes += "px-3 h-8 text-sm ";

    // 配色（disabled 由 .btn-* 內建處理）
    if (type === 'primary') classes += "btn-primary ";
    else if (danger) classes += "btn-danger ";
    else classes += "btn-ghost ";

    if (block) classes += "w-full ";
    return classes + (className || "");
  };

  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={getButtonClass()}
      disabled={disabled}
      title={title}
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
      className="w-full px-2 h-8 text-sm"
      style={style}
    >
      {children}
    </select>
  );
};

const Option = ({ value, children }) => {
  return <option value={value}>{children}</option>;
};

const InputNumber = ({ min, max, value, onChange, style }: { min?: number; max?: number; value: number; onChange: (v: number) => void; style?: React.CSSProperties }) => {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value) || 0)}
      className="w-full px-2 h-8 text-base font-mono-num"
      style={style}
    />
  );
};

const Checkbox = ({ checked, onChange, children }) => {
  return (
    <label className="inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mr-2 accent-[var(--accent)]"
      />
      <span className="text-sm text-[var(--text-secondary)]">{children}</span>
    </label>
  );
};

const Card = ({ className, children }) => {
  return (
    <div className={`surface rounded-lg p-3 ${className || ''}`}>
      {children}
    </div>
  );
};

const Divider = ({ className }: { className?: string } = {}) => {
  return <hr className={`my-2 border-t-0 divider-h ${className || ''}`} />;
};

// ─────────────────────────────────────────────────────────────────
// Icon 元件 — 線稿風 SVG，沿用 design-mock/components.jsx 的圖示集
// ─────────────────────────────────────────────────────────────────
type IconName =
  | 'chevronDown' | 'chevronUp' | 'chevronRight' | 'chevronLeft'
  | 'settings' | 'play' | 'pause' | 'refresh' | 'upload' | 'download'
  | 'monitor' | 'dice' | 'swap' | 'calculator' | 'check' | 'x'
  | 'info' | 'help' | 'edit' | 'eye' | 'lock' | 'unlock'
  | 'crown' | 'trophy' | 'list' | 'grid' | 'expand' | 'minimize'
  | 'arrow_right' | 'sparkle' | 'search' | 'alert' | 'plus' | 'minus' | 'palette';

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp:   <path d="M6 15l6-6 6 6" />,
  chevronRight:<path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  settings:    <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />,
  play:        <path d="M5 3l14 9-14 9V3z" />,
  pause:       <><path d="M6 4h4v16H6z" /><path d="M14 4h4v16h-4z" /></>,
  refresh:     <><path d="M21 12a9 9 0 01-15 6.7L3 16" /><path d="M3 12a9 9 0 0115-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></>,
  upload:      <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></>,
  download:    <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>,
  monitor:     <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  dice:        <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/></>,
  swap:        <><path d="M7 16V4M3 8l4-4 4 4" /><path d="M17 8v12M21 16l-4 4-4-4" /></>,
  calculator:  <><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" /></>,
  check:       <path d="M5 13l4 4L19 7" />,
  x:           <path d="M18 6L6 18M6 6l12 12" />,
  info:        <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></>,
  help:        <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/></>,
  edit:        <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
  eye:         <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>,
  lock:        <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></>,
  unlock:      <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 019.9-1" /></>,
  crown:       <path d="M2 18l3-12 5 6 2-9 2 9 5-6 3 12H2zm0 2h20v2H2v-2z" />,
  trophy:      <><path d="M6 9H4.5a2.5 2.5 0 010-5H6m12 5h1.5a2.5 2.5 0 000-5H18M6 4h12v6a6 6 0 01-12 0V4zM12 16v4M8 22h8" /></>,
  list:        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  grid:        <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
  expand:      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>,
  minimize:    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>,
  arrow_right: <path d="M5 12h14M13 5l7 7-7 7" />,
  sparkle:     <path d="M12 2l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" />,
  search:      <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></>,
  alert:       <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></>,
  plus:        <path d="M12 5v14M5 12h14" />,
  minus:       <path d="M5 12h14" />,
  palette:     <><circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9z"/></>,
};

// 主題切換清單（與 index.css 中的 :root[data-theme=...] 對應）
type ThemeId = 'light' | 'dark' | 'paper' | 'navy';
const THEMES: { id: ThemeId; label: string; swatch: [string, string, string] }[] = [
  { id: 'light', label: '淺色極簡', swatch: ['#FFFFFF', '#EBEEF2', 'oklch(0.62 0.17 50)'] },
  { id: 'dark',  label: '深色競技', swatch: ['#131820', '#0B0E13', 'oklch(0.75 0.18 55)'] },
  { id: 'paper', label: '紙本資料', swatch: ['#FFFFFF', '#F5F2EC', 'oklch(0.42 0.18 28)'] },
  { id: 'navy',  label: '午夜寶藍', swatch: ['#17222F', '#0F1822', 'oklch(0.78 0.14 195)'] },
];

const Icon = ({ name, className = "w-4 h-4", strokeWidth = 2 }: { name: IconName; className?: string; strokeWidth?: number }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {ICON_PATHS[name] || null}
  </svg>
);

// ─────────────────────────────────────────────────────────────────
// Pill — 標籤膠囊，配合不同 tone 與尺寸
// ─────────────────────────────────────────────────────────────────
type PillTone = 'default' | 'accent' | 'win' | 'loss' | 'info' | 'warn' | 'muted';
type PillSize = 'xs' | 'sm' | 'md';

const PILL_TONES: Record<PillTone, string> = {
  default: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-default)]',
  accent:  'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-border)]',
  win:     'bg-[var(--win-soft)] text-[var(--win)] border border-[oklch(0.55_0.16_150_/_0.25)]',
  loss:    'bg-[var(--loss-soft)] text-[var(--loss)] border border-[oklch(0.55_0.16_25_/_0.25)]',
  info:    'bg-[var(--info-soft)] text-[var(--info)] border border-[oklch(0.55_0.16_240_/_0.25)]',
  warn:    'bg-[var(--warn-soft)] text-[var(--warn)] border border-[oklch(0.65_0.16_70_/_0.30)]',
  muted:   'bg-transparent text-[var(--text-muted)] border border-[var(--border-subtle)]',
};
const PILL_SIZES: Record<PillSize, string> = {
  xs: 'text-[10px] px-1.5 py-0.5',
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-2.5 py-1',
};

const Pill = ({ children, tone = 'default', size = 'sm', className = '' }: {
  children?: React.ReactNode; tone?: PillTone; size?: PillSize; className?: string;
}) => (
  <span className={`inline-flex items-center gap-1 rounded-full font-medium ${PILL_TONES[tone]} ${PILL_SIZES[size]} ${className}`}>
    {children}
  </span>
);

// ─────────────────────────────────────────────────────────────────
// RankMedal — 名次徽章
// ─────────────────────────────────────────────────────────────────
const RankMedal = ({ rank }: { rank?: number }) => {
  const cls = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-other';
  return <span className={`rank-medal ${cls}`}>{rank ?? '—'}</span>;
};

// ─────────────────────────────────────────────────────────────────
// Modal — 通用對話框
// ─────────────────────────────────────────────────────────────────
const Modal = ({ open, onClose, title, children, size = 'md' }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; children?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) => {
  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm anim-slide-up" onClick={onClose}>
      <div className={`surface rounded-xl shadow-2xl w-full ${widths[size]} overflow-hidden`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)]">
          <h3 className="font-semibold text-[var(--text-primary)]">{title}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1">
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 text-sm text-[var(--text-secondary)] leading-relaxed">{children}</div>
      </div>
    </div>
  );
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
  const [allPlayers, setAllPlayers] = useState(10);
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
  // 修改配對驗證結果 {round, errors}
  const [pairingValidation, setPairingValidation] = useState<{round: number, errors: string[]} | null>(null);
  // 匯入／匯出區塊預設折疊
  const [showImportExport, setShowImportExport] = useState(false);
  // 新增狀態用於控制「抓對」按鈕是否可用
  const [isPairingButtonDisabled, setIsPairingButtonDisabled] = useState(false);
  // 記錄哪些輪次已完成算分（鎖定）
  const [scoredRounds, setScoredRounds] = useState<number[]>([]);
  
  // 新增狀態用於控制選擇要顯示的回合
  const [selectedRound, setSelectedRound] = useState(1);
  // 定義一個標誌，用於強制初始化全新數據
  const [forceNewPlayers, setForceNewPlayers] = useState(false);
  
  // 新增狀態用於控制分割視窗比例
  const [splitRatio, setSplitRatio] = useState(65);
  // 新增狀態用於控制輔分說明的顯示
  const [showAuxScoreHelp, setShowAuxScoreHelp] = useState(false);
  // 新增狀態用於控制關於/聯絡資訊的顯示
  const [showAboutInfo, setShowAboutInfo] = useState(false);
  // 投影模式：'tables' = 桌次表投影、'standings' = 名次表投影、null = 關閉
  const [projectionMode, setProjectionMode] = useState<null | 'tables' | 'standings'>(null);
  // 投影名次表：自訂競賽名稱（空字串時 fallback 到 gameTitle）
  const [projectionTitle, setProjectionTitle] = useState<string>('');
  // 投影名次表：只顯示前 N 名（null = 全部）
  const [standingsTopN, setStandingsTopN] = useState<number | null>(null);
  // UI 重構：Header 是否摺疊
  const [headerCollapsed, setHeaderCollapsed] = useState<boolean>(false);
  // UI 重構：左欄排行榜顯示模式（compact = 卡片式、detail = 詳細表格）
  const [viewMode, setViewMode] = useState<'compact' | 'detail'>('detail');
  // UI 重構：桌次卡片是否進入「修改配對」模式（兩側選手變成 select 可換人）
  const [pairingEditMode, setPairingEditMode] = useState<boolean>(false);
  // 初次使用引導橫幅是否已被使用者手動關閉
  const [welcomeDismissed, setWelcomeDismissed] = useState<boolean>(false);
  // 主題切換：從 localStorage 讀回，預設 light
  const [theme, setTheme] = useState<ThemeId>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = window.localStorage.getItem('wgp-theme') as ThemeId | null;
    return saved && THEMES.some(t => t.id === saved) ? saved : 'light';
  });
  const [themePickerOpen, setThemePickerOpen] = useState<boolean>(false);
  // 主題改變時：套用到 <html data-theme=...> 並寫回 localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { window.localStorage.setItem('wgp-theme', theme); } catch {}
  }, [theme]);
  // 點外面收合主題選單
  useEffect(() => {
    if (!themePickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = document.getElementById('theme-picker-root');
      if (el && !el.contains(e.target as Node)) setThemePickerOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [themePickerOpen]);
  const saveStateToLocalStorage = () => {
    try {
      // 建立一個包含所有需要保存的狀態的對象
      const appState = {
        allPlayers,
        rounds,
        gameType,
        winPoint,
        players,
        matches,
        matchesByRound,
        sortByRank,
        allowSameCountry,
        currentRound,
        gameTitle,
        selectedRound,
        splitRatio,
        isPairingButtonDisabled,
        showAuxScoreHelp,
        scoredRounds,
        projectionTitle,
        standingsTopN,
        lastSaved: new Date().toISOString() // 記錄最後保存時間
      };
      
      // 將狀態轉換為 JSON 字符串並保存到 localStorage
      localStorage.setItem('tournamentManagerState', JSON.stringify(appState));
      console.log('狀態已自動保存', new Date().toLocaleTimeString());
    } catch (error) {
      console.error('保存狀態時發生錯誤:', error);
    }
  };

  // 定義一個函數來從 localStorage 加載狀態
  const loadStateFromLocalStorage = () => {
    try {
      // 從 localStorage 獲取保存的 JSON 狀態字符串
      const savedState = localStorage.getItem('tournamentManagerState');
      
      // 如果沒有保存的狀態，直接返回
      if (!savedState) {
        console.log('沒有找到保存的狀態');
        return false;
      }
      
      // 將 JSON 字符串轉換回對象
      const appState = JSON.parse(savedState);
      
      // 恢復各個狀態
      setAllPlayers(appState.allPlayers);
      setRounds(appState.rounds);
      setGameType(appState.gameType);
      setWinPoint(appState.winPoint);
      setPlayers(appState.players);
      setMatches(appState.matches);
      setMatchesByRound(appState.matchesByRound);
      setSortByRank(appState.sortByRank);
      setAllowSameCountry(appState.allowSameCountry);
      setCurrentRound(appState.currentRound);
      setGameTitle(appState.gameTitle);
      setSelectedRound(appState.selectedRound);
      setSplitRatio(appState.splitRatio);
      setIsPairingButtonDisabled(appState.isPairingButtonDisabled);
      if (appState.showAuxScoreHelp !== undefined) {
        setShowAuxScoreHelp(appState.showAuxScoreHelp);
      }
      if (appState.scoredRounds !== undefined) {
        setScoredRounds(appState.scoredRounds);
      }
      if (appState.projectionTitle !== undefined) {
        setProjectionTitle(appState.projectionTitle);
      }
      if (appState.standingsTopN !== undefined) {
        setStandingsTopN(appState.standingsTopN);
      }

      console.log('成功加載狀態，最後保存於:', new Date(appState.lastSaved).toLocaleString());

      return true;
    } catch (error) {
      console.error('加載狀態時發生錯誤:', error);
      return false;
    }
  };

  // 定義一個函數來下載狀態到 JSON 檔案
  const exportStateToJSON = () => {
    try {
      // 建立一個包含所有需要保存的狀態的對象
      const appState = {
        allPlayers,
        rounds,
        gameType,
        winPoint,
        players,
        matches,
        matchesByRound,
        sortByRank,
        allowSameCountry,
        currentRound,
        gameTitle,
        selectedRound,
        splitRatio,
        isPairingButtonDisabled,
        showAuxScoreHelp,
        scoredRounds,
        projectionTitle,
        standingsTopN,
        exportedAt: new Date().toISOString() // 記錄下載時間
      };
      
      // 將狀態轉換為格式化的 JSON 字符串
      const jsonString = JSON.stringify(appState, null, 2);
      
      // 創建下載用的 Blob
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      // 創建一個臨時的 <a> 元素來觸發下載
      const link = document.createElement('a');
      link.href = url;
      link.download = `${gameTitle}_狀態備份_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('下載狀態時發生錯誤:', error);
      message.error('下載狀態時發生錯誤');
    }
  };

  // 定義一個函數來從 JSON 檔案上傳狀態
  const importStateFromJSON = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const appState = JSON.parse(e.target.result);
        
        // 檢查上傳的數據是否包含必要的字段
        if (!appState.players || !appState.matchesByRound) {
          throw new Error('上傳的 JSON 檔案格式不正確');
        }
        
        // 恢復各個狀態
        setAllPlayers(appState.allPlayers);
        setRounds(appState.rounds);
        setGameType(appState.gameType);
        setWinPoint(appState.winPoint);
        setPlayers(appState.players);
        setMatches(appState.matches);
        setMatchesByRound(appState.matchesByRound);
        setSortByRank(appState.sortByRank);
        setAllowSameCountry(appState.allowSameCountry);
        setCurrentRound(appState.currentRound);
        setGameTitle(appState.gameTitle);
        setSelectedRound(appState.selectedRound);
        setSplitRatio(appState.splitRatio);
        setIsPairingButtonDisabled(appState.isPairingButtonDisabled);
        if (appState.showAuxScoreHelp !== undefined) {
          setShowAuxScoreHelp(appState.showAuxScoreHelp);
        }
        if (appState.scoredRounds !== undefined) {
          setScoredRounds(appState.scoredRounds);
        }
        if (appState.projectionTitle !== undefined) {
          setProjectionTitle(appState.projectionTitle);
        }
        if (appState.standingsTopN !== undefined) {
          setStandingsTopN(appState.standingsTopN);
        }

        message.success(`成功上傳狀態，創建於: ${new Date(appState.exportedAt || appState.lastSaved).toLocaleString()}`);
      } catch (error) {
        console.error('上傳狀態時發生錯誤:', error);
        message.error(`上傳狀態時發生錯誤: ${error.message}`);
      }
    };
    
    reader.onerror = (error) => {
      console.error('讀取檔案時發生錯誤:', error);
      message.error('讀取檔案時發生錯誤');
    };
    
    reader.readAsText(file);
    
    // 重置 input 以便下次選擇相同檔案時仍然觸發 onChange 事件
    event.target.value = null;
  };

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
    // 嘗試從 localStorage 加載狀態，如果沒有再初始化玩家
    const loaded = loadStateFromLocalStorage();
    if (!loaded) {
      initializePlayers();
    }
  }, []);
  
  // 當 allPlayers 或 rounds 變化時初始化玩家
  useEffect(() => {
    if (players.length > 0) { // 避免和初始加載衝突
      initializePlayers();
    }
  }, [allPlayers, rounds]);
  
  // 使用 useEffect 監聽狀態變化，在變化時自動保存
  useEffect(() => {
    // 防止在初始渲染時保存
    if (players.length > 0) {
      saveStateToLocalStorage();
    }
  }, [allPlayers, rounds, gameType, winPoint, players, matches, matchesByRound, sortByRank, allowSameCountry, currentRound, gameTitle, selectedRound, isPairingButtonDisabled, showAuxScoreHelp, scoredRounds, projectionTitle, standingsTopN]);
  
  // 在組件卸載前執行最後一次保存
  useEffect(() => {
    return () => {
      if (players.length > 0) {
        saveStateToLocalStorage();
      }
    };
  }, []);

  // 投影模式時按 ESC 關閉
  useEffect(() => {
    if (!projectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProjectionMode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projectionMode]);

  const initializePlayers = (forceNew = forceNewPlayers) => {
    // 檢查是否為現有玩家資料更新
    if (!forceNew && players.length > 0 && players.length === allPlayers) {
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
    // 重設強制初始化標記
    setForceNewPlayers(false);
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
  


  // 瑞士制抓對主函數（分組回溯法，對應 VBA Sub VS 邏輯）
  // 計算輪動平衡（對應 VBA CountTurn）
  // 輪高（對手分較高）：+1；輪低（對手分較低）：-1；同分：0
  // 對應 VBA 以儲存格顏色記錄：16754599（黃=輪高）+1，16764108（綠=輪低）-1
  const computeFloatBalance = (playersList) => {
    const floatBalances = new Map<number, number>(playersList.map(p => [p.number as number, 0]));
    if (playersList.length === 0) return floatBalances;

    const roundCount = playersList[0].rounds.length;
    for (let r = 0; r < roundCount; r++) {
      // 確認本輪所有選手皆有結果，否則停止
      if (!playersList.every(p => p.rounds[r] && p.rounds[r].score !== null)) break;

      // 計算第 r 輪（0-indexed）前各選手的分數（rounds 0..r-1 之和）
      const scoresBeforeRound = new Map<number, number>(
        playersList.map(p => [
          p.number as number,
          p.rounds.slice(0, r).reduce((sum: number, rd) => sum + ((rd.score as number) ?? 0), 0)
        ])
      );

      const processed = new Set();
      playersList.forEach(p => {
        const rd = p.rounds[r];
        if (!rd || rd.score === null || !rd.opponent || rd.opponent === 0) return;
        const pairKey = Math.min(p.number, rd.opponent) + '-' + Math.max(p.number, rd.opponent);
        if (processed.has(pairKey)) return;
        processed.add(pairKey);

        const pScore = scoresBeforeRound.get(p.number) ?? 0;
        const oppScore = scoresBeforeRound.get(rd.opponent) ?? 0;
        if (pScore > oppScore) {
          floatBalances.set(p.number, (floatBalances.get(p.number) ?? 0) - 1);
          floatBalances.set(rd.opponent, (floatBalances.get(rd.opponent) ?? 0) + 1);
        } else if (pScore < oppScore) {
          floatBalances.set(p.number, (floatBalances.get(p.number) ?? 0) + 1);
          floatBalances.set(rd.opponent, (floatBalances.get(rd.opponent) ?? 0) - 1);
        }
        // 同分：不更新輪動平衡
      });
    }
    return floatBalances;
  };

  const generateSwissPairings = () => {
    const playerCount = players.length;
    if (playerCount < 2) {
      message.warning('選手人數不足，無法抓對');
      return;
    }

    // 計算輪動平衡（VBA VS() 明確排序鍵之一）
    const floatBalances = computeFloatBalance(players);

    // VBA VS() 排序的實效鍵（穩定排序複合效果）：
    // 1. 總分降冪（VS() 明確鍵）
    // 2. 輪動平衡升冪（VS() 明確鍵；被輪高多者排後，下輪較可能輪低）
    // 3. 輔分一/二/三降冪（繼承 SortRank() 的行順序，透過穩定排序傳遞）
    // 4. 籤號升冪（最終穩定排序）
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
    // 補成偶數；index >= playerCount 的位置為輪空虛擬槽
    const vsPlayerCount = playerCount + (isOdd ? 1 : 0);

    // groupNum[i]：選手 i 所屬組別（從 1 開始）
    const groupNum = new Array(vsPlayerCount).fill(1);
    // groupOrder[i]：組內配對序號（0 = 尚未配對）
    const groupOrder = new Array(vsPlayerCount).fill(0);

    const getNum     = (idx) => idx < playerCount ? sortedPlayers[idx].number : 0;
    const getScore   = (idx) => idx < playerCount ? sortedPlayers[idx].totalScore : -Infinity;
    const getCountry = (idx) => idx < playerCount ? (sortedPlayers[idx].country || '') : '';

    const hasPlayedBefore = (idx1, idx2) => {
      if (idx1 >= playerCount || idx2 >= playerCount) return false;
      const p2Num = getNum(idx2);
      return sortedPlayers[idx1].rounds.some(r => r.opponent === p2Num);
    };

    const conflictsCountry = (idx1, idx2) => {
      if (allowSameCountry) return false;
      const c1 = getCountry(idx1), c2 = getCountry(idx2);
      return c1 !== '' && c2 !== '' && c1 === c2;
    };

    // 分組：相同總分的選手依序兩兩分到同一組（確保每組人數為偶數）
    groupNum[0] = 1;
    if (vsPlayerCount > 1) groupNum[1] = 1;
    for (let i = 2; i < vsPlayerCount; i += 2) {
      const g = getScore(i) === getScore(i - 2) ? groupNum[i - 2] : groupNum[i - 2] + 1;
      groupNum[i] = g;
      if (i + 1 < vsPlayerCount) groupNum[i + 1] = g;
    }

    // vsRecord[g]：本組已完成的配對記錄（供回溯使用）
    const vsRecord = Array.from({ length: Math.max(...groupNum) + 2 }, () => []);

    let nowGroup = 1;

    groupLoop: while (true) {
      // ===== GroupOK：重設當前組的配對狀態 =====
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
      if (totalWait === 0) break; // 全部配對完成（VSOK）

      if (groupPlayerCount === 0) {
        // 此組無人，將後面各組號碼縮減
        for (let i = 0; i < vsPlayerCount; i++) {
          if (groupNum[i] > nowGroup) groupNum[i]--;
        }
        continue groupLoop;
      }

      let nowGroupWait = groupPlayerCount;
      vsRecord[nowGroup] = [];
      let nowGroupOrder = 1;
      let needReCrawl = false;

      // ===== VSNext：組內配對（含回溯） =====
      vsNextLoop: while (true) {
        // 尋找本組索引最大（分數最低）的未配對選手
        let iIdx = -1;
        for (let i = vsPlayerCount - 1; i >= 0; i--) {
          if (groupNum[i] === nowGroup && groupOrder[i] === 0) { iIdx = i; break; }
        }
        if (iIdx === -1) {
          // 本組全部配對完畢
          nowGroup++;
          while (vsRecord.length <= nowGroup) vsRecord.push([]);
          continue groupLoop;
        }

        let searchI = iIdx;
        let iiStart = iIdx - 1;

        // 含回溯的搜尋迴圈
        innerSearch: while (true) {
          for (let iiIdx = iiStart; iiIdx >= 0; iiIdx--) {
            if (groupNum[iiIdx] === nowGroup && groupOrder[iiIdx] === 0) {
              if (!hasPlayedBefore(searchI, iiIdx) && !conflictsCountry(searchI, iiIdx)) {
                // 找到合法配對
                groupOrder[searchI] = nowGroupOrder;
                groupOrder[iiIdx]   = nowGroupOrder;
                vsRecord[nowGroup].push({ i: searchI, ii: iiIdx });
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
          // 找不到配對對象
          if (vsRecord[nowGroup].length > 0) {
            // 回溯：撤銷最後一組配對，改試其他組合
            const lp = vsRecord[nowGroup].pop();
            groupOrder[lp.i]  = 0;
            groupOrder[lp.ii] = 0;
            nowGroupOrder--;
            nowGroupWait += 2;
            searchI = lp.i;
            iiStart = lp.ii - 1;
            continue innerSearch;
          } else {
            // 連第一組都無法配對，需要向後組借人
            needReCrawl = true;
            break vsNextLoop;
          }
        }
      }

      // ===== ReCrawlBeforePlayer：向後借人擴大本組 =====
      if (needReCrawl) {
        reCrawlLoop: while (true) {
          vsRecord[nowGroup] = [];
          let added = 0;
          for (let j = 0; j < vsPlayerCount; j++) {
            if (groupNum[j] > nowGroup) {
              groupNum[j] = nowGroup;
              added++;
              if (added === 2) continue groupLoop; // 借到 2 人，回到 GroupOK 重試
            }
          }
          // 借不到 2 人，往前一組退
          if (nowGroup > 1) {
            nowGroup--;
            continue reCrawlLoop;
          } else {
            alert('無法完成配對，請確認選手資料是否正常。');
            return;
          }
        }
      }
    }

    // ===== 建立桌次表 =====
    const pairMap = new Map();
    for (let i = 0; i < vsPlayerCount; i++) {
      if (groupOrder[i] === 0) continue;
      const key = `${groupNum[i]}-${groupOrder[i]}`;
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key).push(i);
    }

    const newMatches = [];
    let tableNum = 1;

    const sortedKeys = Array.from(pairMap.keys()).sort((a, b) => {
      const [ag, ao] = a.split('-').map(Number);
      const [bg, bo] = b.split('-').map(Number);
      // 組號升冪（分數高的組排前面），組內序號降冪（排名最高的對局排前面拿到低桌號）
      return ag !== bg ? ag - bg : bo - ao;
    });

    for (const key of sortedKeys) {
      const idxs = pairMap.get(key);
      if (idxs.length !== 2) continue;
      const idx1 = Math.min(idxs[0], idxs[1]); // 分數較高（索引較小）
      const idx2 = Math.max(idxs[0], idxs[1]); // 分數較低（索引較大）

      if (idx2 >= playerCount) {
        // 輪空
        newMatches.push({
          table: tableNum++,
          player1: getNum(idx1),
          player2: 0,
          round: currentRound,
          player1IsBlack: true
        });
      } else {
        const p1 = sortedPlayers[idx1];
        const p2 = sortedPlayers[idx2];
        newMatches.push({
          table: tableNum++,
          player1: p1.number,
          player2: p2.number,
          round: currentRound,
          player1IsBlack: determineFirstMove(p1, p2, currentRound)
        });
      }
    }

    // 更新 matchesByRound，保留之前輪次的比賽記錄
    setMatchesByRound(prev => {
      const updated = {};
      Object.keys(prev).forEach(r => {
        const rn = parseInt(r, 10);
        if (rn <= currentRound) {
          updated[rn] = rn === currentRound ? newMatches : prev[rn];
        }
      });
      if (!updated[currentRound]) updated[currentRound] = newMatches;
      return updated;
    });

    setMatches(newMatches);
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
          if (matchup && matchup.score !== null && matchup.score !== undefined) {
            directMatchupScore += matchup.score - (winPoint / 2);
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
    // 算分前先驗證配對：hardErrors 必擋；softErrors 彈 confirm 可覆寫
    const { hardErrors, softErrors } = getPairingIssues(currentRound);
    if (hardErrors.length > 0) {
      setPairingValidation({ round: currentRound, errors: [...hardErrors, ...softErrors] });
      return;
    }
    if (softErrors.length > 0) {
      const ok = window.confirm(
        `偵測到下列重複對戰：\n\n${softErrors.join('\n')}\n\n仍要算分嗎？`
      );
      if (!ok) {
        setPairingValidation({ round: currentRound, errors: softErrors });
        return;
      }
      setPairingValidation(null);
    }

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
    // 將此輪加入鎖定清單
    setScoredRounds(prev => prev.includes(currentRound) ? prev : [...prev, currentRound]);

    setPlayers(playersWithAuxScores);
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
  };

  // 下載隊伍表範例 Excel 檔
  const downloadSampleTeamList = () => {
    const sample = [
      ['籤號', '隊伍'],
      [1, '範例隊伍 A'],
      [2, '範例隊伍 B'],
      [3, '範例隊伍 C'],
    ];
    downloadExcel([{ name: '隊伍表範例', data: sample }], `隊伍表範例_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
      
      // 解析所有列，收集成功項目，再統一決定隊伍總數
      let fieldErrors = [];
      const parsedRows = []; // 成功解析的列：{ number, name, country, level }

      console.log("開始解析隊伍資料...");

      jsonData.forEach((row, rowIndex) => {
        // 獲取籤號，如果是字串，轉換為數字
        let numberValue = getValueByPossibleFieldNames(row, numberFieldNames);

        // 如果找不到標準籤號欄位，嘗試使用任何數字欄位
        if (numberValue === null) {
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
          if (typeof numberValue === 'string') {
            numberValue = numberValue.replace(/[^0-9]/g, '');
          }
          number = parseInt(numberValue);
        }

        // 獲取隊伍名稱
        let name = getValueByPossibleFieldNames(row, nameFieldNames);
        if (!name) {
          for (const key in row) {
            const value = row[key];
            if (typeof value === 'string' && value.trim() !== '' && key !== possibleNumberField) {
              name = value;
              break;
            }
          }
        }

        console.log(`第 ${rowIndex + 1} 行解析結果: 籤號=${number}, 隊伍=${name}`);

        if (isNaN(number) || number < 1 || !name) {
          fieldErrors.push(`第 ${rowIndex + 1} 行: ${(isNaN(number) || number < 1) ? '缺少有效籤號' : ''} ${!name ? '缺少有效隊伍名稱' : ''}`);
          return;
        }

        const country = getValueByPossibleFieldNames(row, countryFieldNames);
        const level = getValueByPossibleFieldNames(row, levelFieldNames);
        parsedRows.push({ number, name, country, level });
      });

      const parsedCount = parsedRows.length;
      console.log(`解析完成: 成功=${parsedCount}, 錯誤=${fieldErrors.length}`);

      if (parsedCount > 0) {
        // 以最大籤號決定隊伍總數
        const newSize = Math.max(...parsedRows.map(r => r.number));
        const sizeChanged = newSize !== allPlayers;

        // 以新尺寸建立 players 陣列：保留現有資料，缺位補預設選手
        const newPlayers = [];
        for (let i = 1; i <= newSize; i++) {
          const existing = players.find(p => p.number === i);
          if (existing) {
            newPlayers.push({ ...existing });
          } else {
            newPlayers.push({
              number: i,
              name: `隊伍${i}`,
              level: '',
              country: '',
              totalScore: 0,
              rank: i,
              auxScore1: 0,
              auxScore2: 0,
              auxScore3: 0,
              rounds: Array(rounds).fill().map(() => ({ score: null, opponent: null, isBlack: false }))
            });
          }
        }

        // 套用上傳的隊伍資料
        parsedRows.forEach(({ number, name, country, level }) => {
          const idx = newPlayers.findIndex(p => p.number === number);
          if (idx !== -1) {
            newPlayers[idx].name = name;
            if (country) newPlayers[idx].country = country;
            if (level) newPlayers[idx].level = level;
          }
        });

        setPlayers(newPlayers);
        if (sizeChanged) {
          setAllPlayers(newSize);
        }

        let successMessage = `成功上傳籤號與隊伍對應表！已更新 ${parsedCount} 筆資料`;
        if (sizeChanged) {
          successMessage += `，參賽隊伍數已自動調整為 ${newSize}`;
        }
        successMessage += '。';

        if (fieldErrors.length > 0) {
          const errorCount = fieldErrors.length > 3 ? `${fieldErrors.length} 筆` : fieldErrors.join('；');
          successMessage += `\n但有 ${errorCount} 資料有問題，已忽略。`;
        }

        message.success(successMessage);
      } else if (fieldErrors.length > 0) {
        message.warning(`上傳失敗：${fieldErrors.length} 筆資料有問題，請檢查Excel格式。具體錯誤: ${fieldErrors.slice(0, 3).join('；')}${fieldErrors.length > 3 ? '...' : ''}`);
      } else {
        message.warning('沒有更新任何資料。請確認Excel表格包含「籤號」和「隊伍」欄位。');
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
  const recordResult = (matchIndex, winnerNumber, roundNum = currentRound) => {
    // 鎖定防呆：已算分的輪次不允許修改
    if (scoredRounds.includes(roundNum)) return;

    // 從正確輪次取得比賽資料（修復原本永遠修改 matches 的 bug）
    const roundMatchesCopy = [...(matchesByRound[roundNum] || [])];
    const match = { ...roundMatchesCopy[matchIndex] };
    if (!match) return;

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

    roundMatchesCopy[matchIndex] = match;

    // 更新 matchesByRound
    setMatchesByRound(prev => ({
      ...prev,
      [roundNum]: roundMatchesCopy
    }));

    // 若修改的是當前輪次，同步更新 matches state
    if (roundNum === currentRound) {
      setMatches(roundMatchesCopy);
    }
  };

  // 重設系統
  const resetSystem = () => {
    if (!window.confirm('確定要重設系統嗎？\n所有輪次的桌次、比賽結果及選手資料將全部清除，此操作無法復原。')) return;

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
    
    // 設置強制初始化標記，確保創建全新玩家資料
    setForceNewPlayers(true);
    
    // 重置所有數據
    initializePlayers(true); // 傳入 true 強制創建新的玩家數據
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
    // 清除鎖定輪次清單
    setScoredRounds([]);

    // 清除 localStorage 中保存的狀態
    localStorage.removeItem('tournamentManagerState');
  };

  // 解除輪次鎖定，允許重新登錄結果並算分
  const unlockRound = (round: number) => {
    if (!window.confirm(`確定要解除第 ${round} 輪的鎖定嗎？\n解除後可重新修改結果，再按「算分」重新計算。`)) return;
    setScoredRounds(prev => prev.filter(r => r !== round));
    setCurrentRound(round);
    setSelectedRound(round);
    setMatches(matchesByRound[round] || []);
    setIsPairingButtonDisabled(true); // 禁止重新抓對，直到重新算分
  };

  // 直接修改某桌某方的選手
  const applyPairingEdit = (matchIndex: number, isBlackSide: boolean, newPlayerNum: number, round: number) => {
    if (scoredRounds.includes(round)) return;

    const roundMatches = [...(matchesByRound[round] || [])];
    const match = { ...roundMatches[matchIndex] };

    // 依黑白方決定要更新 player1 還是 player2
    if (isBlackSide) {
      if (match.player1IsBlack) match.player1 = newPlayerNum;
      else match.player2 = newPlayerNum;
    } else {
      if (match.player1IsBlack) match.player2 = newPlayerNum;
      else match.player1 = newPlayerNum;
    }

    // 清除舊結果（對手已變，舊結果無效）
    delete match.player1Score;

    roundMatches[matchIndex] = match;
    setMatchesByRound(prev => ({ ...prev, [round]: roundMatches }));
    if (round === currentRound) setMatches(roundMatches);
    // 清除上一次的驗證結果
    setPairingValidation(null);
  };

  // 取得本輪配對的錯誤分類（hard=必擋，soft=可覆寫）
  const getPairingIssues = (round: number): { hardErrors: string[], softErrors: string[] } => {
    const roundMatches = matchesByRound[round] || [];
    const hardErrors: string[] = [];
    const softErrors: string[] = [];

    // 收集本輪所有出場選手
    const appearing: number[] = [];
    roundMatches.forEach(m => {
      if (m.player1) appearing.push(m.player1);
      if (m.player2 && m.player2 !== 0) appearing.push(m.player2);
    });

    // 檢查1（hard）：同一選手重複出現
    const seen = new Set<number>();
    appearing.forEach(n => {
      if (seen.has(n)) hardErrors.push(`⚠ 選手 ${getPlayerName(n)} 在本輪重複出現`);
      seen.add(n);
    });

    // 檢查2（hard）：有選手未排入本輪
    players.forEach(p => {
      if (!appearing.includes(p.number)) {
        hardErrors.push(`⚠ 選手 ${getPlayerName(p.number)} 未排入本輪配對`);
      }
    });

    // 檢查3（soft）：重複對戰（已在前幾輪交手過），瑞士制末輪可能避不掉，允許覆寫
    roundMatches.forEach(m => {
      if (m.player2 === 0) return;
      const p1 = players.find(p => p.number === m.player1);
      if (!p1) return;
      const alreadyPlayed = p1.rounds
        .slice(0, round - 1)
        .some(r => r.opponent === m.player2 && r.score !== null);
      if (alreadyPlayed) {
        softErrors.push(`⚠ ${getPlayerName(m.player1)} 與 ${getPlayerName(m.player2)} 已在先前對戰過`);
      }
    });

    return { hardErrors, softErrors };
  };

  // 驗證本輪配對是否合法（給「🔍 驗證配對」按鈕用）
  const validatePairings = (round: number) => {
    const { hardErrors, softErrors } = getPairingIssues(round);
    setPairingValidation({ round, errors: [...hardErrors, ...softErrors] });
  };

  // 桌次表卡片：顯示單場對戰，點擊登錄勝方
  const MatchCard = ({ match, matchIndex, isLocked, round }: {
    match: any; matchIndex: number; isLocked: boolean; round: number;
  }) => {
    const p1 = players.find(p => p.number === match.player1);
    const p2 = match.player2 === 0 ? null : players.find(p => p.number === match.player2);
    const p1Won = match.player1Score === winPoint;
    const p2Won = match.player1Score === 0;
    const recorded = match.player1Score !== undefined || match.player2 === 0;
    const editing = pairingEditMode && !isLocked;

    const TableCell = (
      <div className="flex items-center justify-center w-14 bg-[var(--bg-base)] border-r border-[var(--border-subtle)] flex-shrink-0">
        <div className="flex items-baseline gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium">桌</span>
          <span className="font-mono-num text-xl font-bold text-[var(--text-primary)] tabular leading-none">{match.table}</span>
        </div>
      </div>
    );

    // 修改配對模式：兩側用 select，可換人；輪空也可改
    if (editing) {
      // 替換 player1 → applyPairingEdit 第二參數要傳 match.player1IsBlack
      // 替換 player2 → 傳 !match.player1IsBlack
      const renderSelect = (currentNum: number, isP1Side: boolean) => (
        <select
          value={currentNum || 0}
          onChange={e => applyPairingEdit(matchIndex, isP1Side ? !!match.player1IsBlack : !match.player1IsBlack, parseInt(e.target.value), round)}
          className="px-2 h-10 text-base font-medium w-full bg-[var(--bg-surface)]"
        >
          {match.player2 === 0 && (<option value={0}>（輪空）</option>)}
          {players.map(opt => (
            <option key={opt.number} value={opt.number}>{opt.number}. {opt.name}</option>
          ))}
        </select>
      );
      return (
        <div className="elevated rounded-lg overflow-hidden border-2 border-[var(--accent-border)]">
          <div className="flex items-stretch">
            {TableCell}
            <div className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center divide-x divide-[var(--border-subtle)] min-w-0">
              <div className="px-2 py-1.5">{renderSelect(match.player1, true)}</div>
              <div className="px-3 py-1.5 text-center flex-shrink-0">
                <div className="text-xs tracking-[0.25em] text-[var(--text-muted)] font-mono-num font-semibold">VS</div>
              </div>
              <div className="px-2 py-1.5">{renderSelect(match.player2, false)}</div>
            </div>
          </div>
        </div>
      );
    }

    // 輪空場次（非編輯模式）
    if (!p2) {
      return (
        <div className="elevated rounded-lg overflow-hidden border-l-2 border-[var(--accent)]">
          <div className="flex items-stretch">
            {TableCell}
            <div className="flex-1 flex items-center gap-2 px-3 py-2">
              <Pill tone="muted" size="sm">#{p1?.number}</Pill>
              <span className="font-semibold text-base truncate">{p1?.name}</span>
              <span className="ml-auto"><Pill tone="accent" size="sm">輪空勝</Pill></span>
            </div>
          </div>
        </div>
      );
    }

    const renderSide = (player: any, isWinner: boolean, onPick: () => void) => {
      // 樣式：鎖定後的勝方加底色、敗方半透明；未鎖定時兩邊都可點，敗方半透明但 hover 復原
      const stateCls = isLocked
        ? (recorded ? (isWinner ? 'bg-[var(--win-soft)]' : 'opacity-40') : '')
        : recorded
          ? (isWinner
              ? 'bg-[var(--win-soft)] cursor-default'
              : 'opacity-50 cursor-pointer hover:opacity-100 hover:bg-[var(--bg-hover)]')
          : 'cursor-pointer hover:bg-[var(--bg-hover)]';
      return (
        <div
          className={`relative px-3 py-2 transition-all duration-150 group min-w-0 ${stateCls}`}
          onClick={!isLocked && !isWinner ? onPick : undefined}
          title={isLocked ? undefined : (isWinner ? `${player.name} 勝` : recorded ? '點擊改為勝方' : '點擊登錄勝')}
        >
          <div className="flex items-center gap-2">
            <Pill tone="muted" size="sm">#{player.number}</Pill>
            <span className={`font-semibold text-base truncate flex-1 min-w-0 ${isWinner ? 'text-[var(--win)]' : ''}`}>{player.name}</span>
            <span className="text-xs text-[var(--text-muted)] font-mono-num tabular flex-shrink-0">{player.totalScore} 分</span>
            {recorded && isWinner ? (
              <span className="flex items-center gap-0.5 text-[var(--win)] text-sm font-semibold flex-shrink-0">
                <Icon name="check" className="w-4 h-4" strokeWidth={3}/>
              </span>
            ) : recorded ? (
              <span className="text-[var(--text-muted)] text-xs flex-shrink-0">負</span>
            ) : null}
          </div>
        </div>
      );
    };

    return (
      <div className="elevated rounded-lg overflow-hidden">
        <div className="flex items-stretch">
          {TableCell}
          <div className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center divide-x divide-[var(--border-subtle)] min-w-0">
            {renderSide(p1, p1Won, () => recordResult(matchIndex, match.player1, round))}
            <div className="px-4 py-4 text-center flex-shrink-0">
              <div className="text-xs tracking-[0.25em] text-[var(--text-muted)] font-mono-num font-semibold">VS</div>
            </div>
            {renderSide(p2, p2Won, () => recordResult(matchIndex, match.player2, round))}
          </div>
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

  // 勝負紀錄條：每輪一格，顯示勝/負/輪空/進行中/未開始
  const RecordBar = ({ player }: { player: any }) => (
    <div className="flex gap-0.5">
      {Array.from({ length: rounds }).map((_, i) => {
        const r = player.rounds[i] || {};
        const isScored = scoredRounds.includes(i + 1);
        const isCurrent = i + 1 === currentRound;
        let cls = 'bg-[var(--border-default)]';
        let label = `R${i + 1} 未開始`;
        if (isScored && r.score !== null) {
          if (r.opponent === 0) { cls = 'bg-[var(--accent)]'; label = `R${i + 1} 輪空勝`; }
          else if (r.score > 0) { cls = 'bg-[var(--win)]'; label = `R${i + 1} 勝 vs #${r.opponent}`; }
          else { cls = 'bg-[var(--loss)] opacity-60'; label = `R${i + 1} 負 vs #${r.opponent}`; }
        } else if (isCurrent) {
          cls = 'bg-[var(--info)] opacity-50'; label = `R${i + 1} 進行中`;
        }
        return <span key={i} className={`w-3.5 h-6 rounded-sm ${cls}`} title={label}/>;
      })}
    </div>
  );

  // 緊湊視圖：前三名突顯卡片 + 其他列表
  const renderCompactStandings = (sortedPlayers: any[]) => {
    const hasRanking = sortedPlayers.length > 0 && sortedPlayers[0].rank;
    const top3 = hasRanking && sortByRank ? sortedPlayers.slice(0, 3) : [];
    const rest = hasRanking && sortByRank ? sortedPlayers.slice(3) : sortedPlayers;

    return (
      <div className="p-3 space-y-3">
        {top3.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] px-2 font-semibold">領先三隊</div>
            {top3.map(p => {
              const accent = p.rank === 1 ? 'border-[oklch(0.82_0.15_90_/_0.5)] bg-[oklch(0.82_0.15_90_/_0.04)]'
                          : p.rank === 2 ? 'border-[oklch(0.82_0.02_250_/_0.4)]'
                          : 'border-[oklch(0.70_0.13_55_/_0.4)]';
              return (
                <div key={p.number} className={`elevated rounded-lg p-4 border ${accent} flex items-center gap-3`}>
                  <RankMedal rank={p.rank}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      {editMode
                        ? <input type="text" value={p.name} onChange={e => handlePlayerNameChange(p.number, e.target.value)} className="px-2 h-8 text-base font-semibold flex-1"/>
                        : <div className="font-bold text-lg truncate">{p.name}</div>
                      }
                      <Pill tone="muted" size="sm">#{p.number}</Pill>
                    </div>
                    <RecordBar player={p}/>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono-num text-3xl font-bold text-[var(--text-primary)] leading-none">{p.totalScore}</div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-1.5 tabular tracking-wide">
                      輔分 <span className="font-mono-num font-semibold text-[var(--text-secondary)]">{p.auxScore1}</span>
                      {' · '}
                      <span className="font-mono-num font-semibold text-[var(--text-secondary)]">{p.auxScore2}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {rest.length > 0 && (
          <div className="space-y-1">
            {top3.length > 0 && (
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] px-2 pt-2 font-semibold">其他</div>
            )}
            {rest.map(p => (
              <div key={p.number} className="flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors">
                <span className="font-mono-num text-sm font-semibold text-[var(--text-secondary)] w-7 text-center tabular">{p.rank || '—'}</span>
                <span className="font-mono-num text-xs text-[var(--text-disabled)] w-7 tabular">#{p.number}</span>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  {editMode
                    ? <input type="text" value={p.name} onChange={e => handlePlayerNameChange(p.number, e.target.value)} className="px-2 h-8 text-base flex-1"/>
                    : <div className="text-base font-medium truncate">{p.name}</div>
                  }
                </div>
                <RecordBar player={p}/>
                <div className="text-right flex-shrink-0 w-16">
                  <div className="font-mono-num text-lg font-semibold tabular">{p.totalScore}</div>
                  <div className="text-[10px] text-[var(--text-muted)] tabular">輔 {p.auxScore1}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 詳細視圖：完整表格（保留所有輔分與每輪細節）
  const renderDetailStandings = (sortedPlayers: any[]) => (
    <div className="overflow-auto h-full">
      <table className="grid-table w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="text-left px-3 py-3 w-14">名次</th>
            <th className="text-left px-2 py-3 w-12">#</th>
            <th className="text-left px-2 py-3 w-40">隊伍</th>
            <th className="text-center px-2 py-3 w-14 col-total">總分</th>
            <th className="text-center px-2 py-3 w-14 col-aux">輔一</th>
            <th className="text-center px-2 py-3 w-14 col-aux">輔二</th>
            <th className="text-center px-2 py-3 w-14 col-aux">輔三</th>
            {Array.from({ length: rounds }).map((_, i) => (
              <th key={i} className={`text-center px-1 py-3 w-20 ${i + 1 === currentRound ? 'text-[var(--accent)]' : ''}`}>R{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedPlayers.map(p => (
            <tr key={p.number}>
              <td className="px-3 py-2.5"><RankMedal rank={p.rank}/></td>
              <td className="px-2 py-2.5 font-mono-num text-sm text-[var(--text-muted)]">#{p.number}</td>
              <td className="px-2 py-2.5 max-w-40">
                {editMode
                  ? <input type="text" value={p.name} onChange={e => handlePlayerNameChange(p.number, e.target.value)} className="px-2 h-8 text-base w-full"/>
                  : <span className="font-semibold text-base block truncate" title={p.name}>{p.name}</span>
                }
              </td>
              <td className="px-2 py-2.5 text-center font-mono-num font-bold text-lg tabular col-total">{p.totalScore}</td>
              <td className="px-2 py-2.5 text-center font-mono-num text-[var(--text-secondary)] tabular col-aux">{p.auxScore1}</td>
              <td className="px-2 py-2.5 text-center font-mono-num text-[var(--text-secondary)] tabular col-aux">{p.auxScore2}</td>
              <td className="px-2 py-2.5 text-center font-mono-num text-[var(--text-secondary)] tabular col-aux">{p.auxScore3}</td>
              {Array.from({ length: rounds }).map((_, i) => {
                const r = p.rounds[i] || { score: null, opponent: null };
                const isScored = scoredRounds.includes(i + 1);
                return (
                  <td key={i} className="px-1 py-2.5 text-center text-xs">
                    {isScored && r.score !== null ? (
                      <div className="flex flex-col items-center">
                        <span className={`font-mono-num font-bold text-base ${r.score > 0 ? 'text-[var(--win)]' : 'text-[var(--loss)]'}`}>{r.score}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{r.opponent === 0 ? '輪空' : `vs ${r.opponent}`}</span>
                      </div>
                    ) : <span className="text-[var(--text-disabled)]">·</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // 排行榜面板（左欄）
  const renderPlayerList = () => {
    const sortedPlayers = getSortedPlayers();

    return (
      <div className="surface rounded-xl flex flex-col h-full overflow-hidden">
        {/* 標題列（窄寬時自動 wrap） */}
        <div className="flex flex-wrap items-center justify-between px-4 py-2 min-h-14 border-b border-[var(--border-subtle)] flex-shrink-0 gap-x-2 gap-y-2">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <Icon name="trophy" className="w-5 h-5 text-[var(--accent)]"/>
            <h2 className="text-base font-semibold tracking-wide whitespace-nowrap">排行榜</h2>
            <span className="text-sm text-[var(--text-muted)] tabular whitespace-nowrap">{players.length} 隊</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* 視圖切換 */}
            <div className="flex bg-[var(--bg-elevated)] rounded-md p-0.5 border border-[var(--border-default)] flex-shrink-0">
              {[
                { value: 'compact', icon: 'list' as IconName, label: '緊湊' },
                { value: 'detail',  icon: 'grid' as IconName, label: '詳細' },
              ].map(o => (
                <button key={o.value}
                  onClick={() => setViewMode(o.value as 'compact' | 'detail')}
                  className={`px-2 h-6 rounded-[5px] text-[11px] flex items-center gap-1 transition-colors
                    ${viewMode === o.value
                      ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                  title={o.label}
                >
                  <Icon name={o.icon} className="w-3 h-3"/>
                </button>
              ))}
            </div>
            <Button
              onClick={toggleSortOrder}
              title={sortByRank ? '目前依名次排序，點擊改為依籤號' : '目前依籤號排序，點擊改為依名次'}
              className="whitespace-nowrap"
            >
              {sortByRank ? '依籤號' : '依名次'}
            </Button>
            <Button onClick={() => setEditMode(!editMode)} type={editMode ? 'primary' : undefined} className="whitespace-nowrap">
              <Icon name="edit" className="w-4 h-4"/> {editMode ? '完成' : '編輯'}
            </Button>
            <Button onClick={() => setProjectionMode('standings')} title="投影名次表" className="whitespace-nowrap">
              <Icon name="monitor" className="w-4 h-4"/> 投影
            </Button>
          </div>
        </div>

        {/* 內容區 */}
        <div className="flex-1 overflow-auto">
          {viewMode === 'compact'
            ? renderCompactStandings(sortedPlayers)
            : renderDetailStandings(sortedPlayers)}
        </div>
      </div>
    );
  };

  // 桌次表面板（右欄）：輪次切換 tab + 狀態列 + 卡片列表
  const renderRightPane = () => {
    const roundOptions = Object.keys(matchesByRound).map(round => parseInt(round, 10)).sort((a, b) => a - b);
    const matchesForRound = matchesByRound[selectedRound] || [];
    const isLocked = scoredRounds.includes(selectedRound);
    const isCurrent = selectedRound === currentRound;
    const total = matchesForRound.length;
    const completed = matchesForRound.filter((m: any) => m.player1Score !== undefined || m.player2 === 0).length;

    return (
      <div className="surface rounded-xl flex flex-col h-full overflow-hidden">
        {/* 標題列：輪次切換 + 操作（窄寬時自動 wrap） */}
        <div className="flex flex-wrap items-center justify-between px-4 py-2 min-h-14 border-b border-[var(--border-subtle)] flex-shrink-0 gap-x-2 gap-y-2">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <Icon name="grid" className="w-5 h-5 text-[var(--accent)] flex-shrink-0"/>
            <h2 className="text-base font-semibold tracking-wide whitespace-nowrap">桌次表</h2>
            {total > 0 && (
              <span className="text-sm text-[var(--text-muted)] tabular whitespace-nowrap">{completed}/{total} 桌完成</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {roundOptions.length > 0 && (
              <div className="flex bg-[var(--bg-elevated)] rounded-md p-0.5 border border-[var(--border-default)] flex-shrink-0">
                {roundOptions.map(r => {
                  const done = scoredRounds.includes(r);
                  const cur = r === currentRound;
                  const sel = r === selectedRound;
                  return (
                    <button key={r}
                      onClick={() => setSelectedRound(r)}
                      className={`px-3 h-8 rounded-[5px] text-sm flex items-center gap-1 transition-colors font-medium whitespace-nowrap
                        ${sel
                          ? 'bg-[var(--bg-base)] text-[var(--text-primary)] shadow-inner'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                    >
                      R{r}
                      {done && <Icon name="check" className="w-3.5 h-3.5 text-[var(--win)]" strokeWidth={3}/>}
                      {cur && !done && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]"/>}
                    </button>
                  );
                })}
              </div>
            )}
            {!isLocked && total > 0 && (
              <>
                <Button
                  onClick={() => setPairingEditMode(!pairingEditMode)}
                  type={pairingEditMode ? 'primary' : undefined}
                  title="修改配對：把任一方換成其他選手（會清掉該桌結果）"
                  className="whitespace-nowrap"
                >
                  <Icon name="edit" className="w-4 h-4"/> {pairingEditMode ? '完成修改' : '修改配對'}
                </Button>
                <Button onClick={() => validatePairings(selectedRound)} title="檢查本輪配對" className="whitespace-nowrap">
                  <Icon name="search" className="w-4 h-4"/> 驗證配對
                </Button>
              </>
            )}
            <Button onClick={() => setProjectionMode('tables')} disabled={total === 0} title="投影桌次表" className="whitespace-nowrap">
              <Icon name="monitor" className="w-4 h-4"/> 投影
            </Button>
          </div>
        </div>

        {/* 狀態列 */}
        {total > 0 && (
          <div className={`px-4 py-2.5 text-sm border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-x-3 gap-y-1 flex-shrink-0
            ${isLocked
              ? 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
              : isCurrent
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'bg-transparent text-[var(--text-secondary)]'}`}>
            <div className="flex items-center gap-2">
              {isLocked ? (
                <><Icon name="lock" className="w-4 h-4"/> R{selectedRound} 已鎖定 — 結果不可更改</>
              ) : isCurrent ? (
                <><span className="w-2 h-2 bg-[var(--accent)] rounded-full pulse"/> R{selectedRound} 進行中 — 點擊勝方登錄結果</>
              ) : (
                <>R{selectedRound} 未開始</>
              )}
            </div>
            {isLocked ? (
              <button
                onClick={() => unlockRound(selectedRound)}
                className="px-2.5 h-7 rounded text-xs flex items-center gap-1 border border-[var(--border-default)] hover:border-[oklch(0.65_0.16_70)] hover:text-[oklch(0.55_0.16_70)] transition-colors"
                title="解除鎖定後可重新登錄結果，需再次按「算分」"
              >
                <Icon name="unlock" className="w-3.5 h-3.5"/> 解除鎖定
              </button>
            ) : completed === total && total > 0 && (
              <span className="text-[var(--win)] flex items-center gap-1">
                <Icon name="check" className="w-4 h-4" strokeWidth={3}/> 所有結果已登錄，可以算分
              </span>
            )}
          </div>
        )}

        {/* 配對驗證結果（沿用現有 pairingValidation 狀態） */}
        {pairingValidation && pairingValidation.round === selectedRound && (
          <div className={`mx-3 mt-3 px-3 py-2 rounded-md text-sm border flex items-start gap-2
            ${pairingValidation.errors.length === 0
              ? 'bg-[var(--win-soft)] border-[oklch(0.55_0.16_150_/_0.3)] text-[var(--win)]'
              : 'bg-[var(--loss-soft)] border-[oklch(0.55_0.16_25_/_0.3)] text-[var(--loss)]'}`}>
            <Icon name={pairingValidation.errors.length === 0 ? 'check' : 'alert'} className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={pairingValidation.errors.length === 0 ? 3 : 2}/>
            <div className="flex-1">
              {pairingValidation.errors.length === 0 ? (
                <span>配對無誤，可以開始比賽。</span>
              ) : (
                <>
                  <div className="font-semibold mb-1">發現以下問題：</div>
                  {pairingValidation.errors.map((e, i) => <div key={i}>• {e}</div>)}
                </>
              )}
            </div>
            <button onClick={() => setPairingValidation(null)} className="text-xs underline opacity-70 flex-shrink-0">關閉</button>
          </div>
        )}

        {/* 卡片列表 */}
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {total === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-[var(--text-muted)]">
                <Icon name="grid" className="w-12 h-12 mx-auto mb-3 opacity-30"/>
                <div className="text-base">尚未生成桌次表</div>
                <div className="text-sm mt-1 opacity-70">請設定當前輪次後點擊「抓對」</div>
              </div>
            </div>
          ) : (
            matchesForRound.map((m: any, idx: number) => (
              <MatchCard key={idx} match={m} matchIndex={idx} isLocked={isLocked} round={selectedRound}/>
            ))
          )}
        </div>
      </div>
    );
  };

  // 名次中文標籤（投影名次表用）：1→冠軍、2→亞軍、3→季軍、4→殿軍、5+→第N名優勝
  const getRankLabel = (rank: number): string => {
    if (!rank || rank < 1) return '—';
    if (rank === 1) return '冠軍';
    if (rank === 2) return '亞軍';
    if (rank === 3) return '季軍';
    if (rank === 4) return '殿軍';
    const cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    let numText: string;
    if (rank <= 10) numText = cn[rank];
    else if (rank < 20) numText = `十${cn[rank - 10]}`;
    else if (rank < 100) {
      const t = Math.floor(rank / 10);
      const o = rank % 10;
      numText = `${cn[t]}十${o === 0 ? '' : cn[o]}`;
    } else {
      numText = String(rank);
    }
    return `第${numText}名優勝`;
  };

  // 桌次表投影視圖：對齊排行榜風格 — 色帶 gradient + 同色邊線，置中分欄一頁呈現
  const renderTablesProjection = () => {
    const matchesForRound = matchesByRound[selectedRound] || [];
    const total = matchesForRound.length;
    const nameOf = (num: number) => players.find(p => p.number === num)?.name || '';

    return (
      <div className="flex-1 flex flex-col items-center p-8 overflow-hidden min-h-0 standings-stage">
        <div className="text-center mb-6 flex-shrink-0">
          <div className="text-[10px] tracking-[0.4em] text-[var(--accent)] font-medium mb-2">WGP TOURNAMENT</div>
          <h1 className="text-5xl font-bold tracking-tight">{gameTitle}</h1>
          <div className="mt-2 text-2xl text-[var(--text-secondary)] tracking-wide">第 {selectedRound} 輪 · 桌次表</div>
          <div className="mt-3 mx-auto w-20 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent"></div>
        </div>
        {total === 0 ? (
          <div className="flex-1 flex items-center justify-center text-3xl text-[var(--text-muted)]">尚未生成桌次表</div>
        ) : (
          <div className="flex-1 w-full flex flex-col flex-wrap content-center justify-center items-center gap-x-6 gap-y-2 min-h-0 overflow-hidden">
            {matchesForRound.map((m: any, mi: number) => {
              const isBye = m.player2 === 0;
              const isOdd = m.table % 2 === 1;
              // 對照排行榜：from-[色/透明度] to-transparent + 同色 border
              const cardClass = isBye
                ? 'bg-gradient-to-r from-[oklch(0.85_0.02_250_/_0.20)] to-transparent border-[oklch(0.70_0.02_250_/_0.35)]'
                : isOdd
                ? 'bg-gradient-to-r from-[oklch(0.78_0.14_85_/_0.22)] to-transparent border-[oklch(0.70_0.15_85_/_0.45)]'   /* 暖琥珀 */
                : 'bg-gradient-to-r from-[oklch(0.72_0.13_240_/_0.18)] to-transparent border-[oklch(0.58_0.14_240_/_0.42)]'; /* 冷藍 */
              const numColor = isBye
                ? 'text-[var(--text-muted)]'
                : isOdd
                ? 'text-[oklch(0.55_0.15_85)]'
                : 'text-[oklch(0.48_0.16_240)]';
              return (
                <div key={mi} className={`flex items-center gap-4 px-5 py-3 rounded-xl border w-[30rem] ${cardClass}`}>
                  <div className="flex flex-col items-center w-14 flex-shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none mb-1">桌</div>
                    <div className={`font-mono-num text-3xl font-bold leading-none tabular ${numColor}`}>{isBye ? '—' : m.table}</div>
                  </div>
                  {isBye ? (
                    <>
                      <Pill tone="muted" size="sm">#{m.player1}</Pill>
                      <span className="text-2xl font-bold truncate flex-1 text-[var(--text-secondary)]">{nameOf(m.player1)}</span>
                      <Pill tone="muted" size="md">輪空</Pill>
                    </>
                  ) : (
                    <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Pill tone="muted" size="sm">#{m.player1}</Pill>
                        <span className="text-2xl font-bold truncate">{nameOf(m.player1)}</span>
                      </div>
                      <div className="text-[10px] tracking-[0.3em] text-[var(--text-muted)] font-mono-num font-semibold px-1">VS</div>
                      <div className="flex items-center gap-2 min-w-0">
                        <Pill tone="muted" size="sm">#{m.player2}</Pill>
                        <span className="text-2xl font-bold truncate">{nameOf(m.player2)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // 名次表投影視圖：突顯冠亞季軍漸層卡片 + 獎盃
  const renderStandingsProjection = () => {
    const sorted = [...players].sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
    const limit = standingsTopN ?? sorted.length;
    const display = sorted.slice(0, limit);
    const labels = ['冠軍', '亞軍', '季軍', '殿軍'];

    return (
      <div className="flex-1 flex flex-col items-center justify-start py-16 px-12 overflow-auto standings-stage">
        <div className="mb-10 text-center">
          <div className="text-[10px] tracking-[0.4em] text-[var(--accent)] font-medium mb-3">FINAL STANDINGS</div>
          <input
            type="text"
            value={projectionTitle}
            onChange={(e) => setProjectionTitle(e.target.value)}
            placeholder={gameTitle}
            title="點擊可修改競賽名稱"
            className="text-6xl font-bold tracking-tight bg-transparent border-none text-center hover:bg-[var(--bg-elevated)] focus:bg-[var(--bg-elevated)] rounded-lg px-4 py-2 transition-colors"
          />
        </div>

        <div className="w-full max-w-4xl space-y-2">
          {display.map((p) => {
            const isTop3 = (p.rank || 99) <= 3;
            const cardClass =
              p.rank === 1 ? 'bg-gradient-to-r from-[oklch(0.78_0.14_85_/_0.20)] to-transparent border-[oklch(0.70_0.15_85_/_0.45)]' :
              p.rank === 2 ? 'bg-gradient-to-r from-[oklch(0.85_0.02_250_/_0.30)] to-transparent border-[oklch(0.70_0.02_250_/_0.40)]' :
              p.rank === 3 ? 'bg-gradient-to-r from-[oklch(0.72_0.13_45_/_0.15)] to-transparent border-[oklch(0.58_0.13_45_/_0.40)]' :
              'elevated';
            return (
              <div key={p.number} className={`flex items-center gap-6 p-5 rounded-xl border ${cardClass}`}>
                <div className="flex flex-col items-center w-24 flex-shrink-0">
                  {isTop3 && (
                    <Icon
                      name={p.rank === 1 ? 'crown' : 'trophy'}
                      className={`w-8 h-8 mb-1 ${p.rank === 1 ? 'text-[oklch(0.65_0.15_85)]' : p.rank === 2 ? 'text-[oklch(0.55_0.02_250)]' : 'text-[oklch(0.58_0.13_45)]'}`}
                    />
                  )}
                  <div className={`font-mono-num font-bold tabular leading-none ${isTop3 ? 'text-3xl' : 'text-2xl text-[var(--text-secondary)]'}`}>{p.rank || '—'}</div>
                  {p.rank && p.rank <= 4 && <div className="text-xs text-[var(--text-muted)] mt-1">{labels[p.rank - 1]}</div>}
                </div>
                <Pill tone="muted" size="md">#{p.number}</Pill>
                <div className="flex-1 min-w-0">
                  <div className={`font-bold truncate ${isTop3 ? 'text-5xl' : 'text-4xl'}`}>{p.name}</div>
                </div>
                <div className="text-right">
                  <div className={`font-mono-num font-bold tabular ${isTop3 ? 'text-6xl' : 'text-5xl'}`}>{p.totalScore}</div>
                  <div className="text-sm text-[var(--text-muted)] mt-1 tabular">輔分 {p.auxScore1} / {p.auxScore2}</div>
                </div>
              </div>
            );
          })}
        </div>
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
    <div className="h-screen flex flex-col p-3 gap-3">
      {/* ─── Header（可摺疊） ─────────────────────────────── */}
      {(() => {
        const existingRounds = Object.keys(matchesByRound).map(r => parseInt(r, 10));
        const isCurrentScored = scoredRounds.includes(currentRound);
        const isCurrentPaired = existingRounds.includes(currentRound);
        const allDone = scoredRounds.length >= rounds;
        // 初次使用 / 全新空白狀態：尚未上傳名單、尚未抓對、尚未算分
        const isInitialState =
          players.length > 0 &&
          players.every(p => p.name === `隊伍${p.number}`) &&
          existingRounds.length === 0 &&
          scoredRounds.length === 0;

        type Stage = { msg: string; tone: 'win' | 'warn' | 'info'; step: number; icon: IconName };
        let stage: Stage;
        if (allDone) {
          stage = { msg: `所有 ${rounds} 輪賽事均已完成`, tone: 'win', step: 4, icon: 'trophy' };
        } else if (isCurrentScored) {
          stage = { msg: `第 ${currentRound} 輪已算分。將「當前輪次」改為 ${currentRound + 1}，並按「抓對」開始下一輪。`, tone: 'win', step: 3, icon: 'check' };
        } else if (isPairingButtonDisabled || isCurrentPaired) {
          stage = { msg: `第 ${currentRound} 輪桌次已生成。請在右側登錄各場結果，完成後點擊「算分」。`, tone: 'warn', step: 2, icon: 'play' };
        } else {
          stage = { msg: `準備第 ${currentRound} 輪：${currentRound === 1 ? '可先「抽籤」再' : ''}點擊「抓對」生成本輪桌次。`, tone: 'info', step: 1, icon: 'arrow_right' };
        }
        const stageBg =
          stage.tone === 'win'  ? 'bg-[var(--win-soft)] text-[var(--win)]' :
          stage.tone === 'warn' ? 'bg-[var(--warn-soft)] text-[var(--warn)]' :
                                   'bg-[var(--info-soft)] text-[var(--info)]';

        const compactActions = (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleDrawLots}
              disabled={currentRound !== 1}
              className="btn-ghost px-3 h-9 rounded-md text-sm flex items-center gap-1.5"
              title={currentRound !== 1 ? '僅第 1 輪可抽籤' : '抽籤'}
            >
              <Icon name="dice" className="w-4 h-4"/> 抽籤
            </button>
            <button
              onClick={generatePairings}
              disabled={isPairingButtonDisabled}
              className="btn-primary px-4 h-9 rounded-md text-sm flex items-center gap-1.5"
            >
              <Icon name="swap" className="w-4 h-4"/> 抓對 R{currentRound}
            </button>
            <button
              onClick={calculateScores}
              disabled={!isPairingButtonDisabled}
              className={`px-4 h-9 rounded-md text-sm flex items-center gap-1.5 font-medium
                ${isPairingButtonDisabled ? 'btn-success' : 'btn-ghost opacity-50 cursor-not-allowed'}`}
            >
              <Icon name="calculator" className="w-4 h-4"/> 算分
            </button>
          </div>
        );

        return (
          <div className="surface rounded-xl flex-shrink-0">
            {/* 頂部品牌列 */}
            <div className="flex items-center justify-between px-4 h-12 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[var(--accent)] to-[oklch(0.55_0.17_30)] flex items-center justify-center flex-shrink-0">
                    <Icon name="trophy" className="w-4 h-4 text-white" strokeWidth={2.5}/>
                  </div>
                  <div className="leading-tight min-w-0">
                    <div className="text-base font-semibold tracking-wide truncate">WGP TOURNAMENT</div>
                    <div className="text-xs text-[var(--text-muted)] tabular truncate">{gameTitle} · {allPlayers} 隊 · {rounds} 輪</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* 輪次燈號（可點切換當前輪次） */}
                <div className="flex items-center gap-1 mr-2">
                  {Array.from({ length: rounds }, (_, i) => i + 1).map(r => {
                    const done = scoredRounds.includes(r);
                    const cur = r === currentRound;
                    return (
                      <div key={r} className="flex items-center">
                        <button
                          onClick={() => setCurrentRound(r)}
                          className={`step-dot inline-flex items-center justify-center font-mono-num text-[11px] font-semibold rounded-full w-6 h-6 transition-all hover:scale-110
                            ${done ? 'bg-[var(--win)] text-white hover:brightness-110' :
                              cur ? 'bg-[var(--accent)] text-white pulse' :
                                    'bg-transparent text-[var(--text-muted)] border border-[var(--border-default)] hover:border-[var(--accent)] hover:text-[var(--accent)]'}`}
                          title={`切換當前輪次到 R${r}${done ? '（已完成）' : cur ? '（進行中）' : ''}`}
                        >
                          {done ? <Icon name="check" className="w-3 h-3" strokeWidth={3}/> : r}
                        </button>
                        {r < rounds && <span className={`w-2 h-px ${done ? 'bg-[var(--win)]' : 'bg-[var(--border-default)]'}`}/>}
                      </div>
                    );
                  })}
                </div>

                <div id="theme-picker-root" className="relative">
                  <button
                    onClick={() => setThemePickerOpen(o => !o)}
                    className="btn-ghost px-3 h-8 rounded-md text-sm flex items-center gap-1.5"
                    title="切換主題"
                    aria-haspopup="true"
                    aria-expanded={themePickerOpen}
                  >
                    <Icon name="palette" className="w-4 h-4"/> 主題
                    <Icon name="chevronDown" className="w-3 h-3 opacity-60"/>
                  </button>
                  {themePickerOpen && (
                    <div
                      className="absolute right-0 top-full mt-1 z-30 w-56 p-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)]"
                      style={{ boxShadow: '0 8px 24px -8px rgba(15, 20, 30, 0.18)' }}
                      role="menu"
                    >
                      {THEMES.map(t => {
                        const active = t.id === theme;
                        return (
                          <button
                            key={t.id}
                            onClick={() => { setTheme(t.id); setThemePickerOpen(false); }}
                            className={`w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm text-left transition-colors ${active ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'}`}
                            role="menuitemradio"
                            aria-checked={active}
                          >
                            <span className="flex h-5 w-9 rounded border border-[var(--border-default)] overflow-hidden flex-shrink-0">
                              <span className="flex-1" style={{ background: t.swatch[0] }}/>
                              <span className="flex-1" style={{ background: t.swatch[1] }}/>
                              <span className="flex-1" style={{ background: t.swatch[2] }}/>
                            </span>
                            <span className="flex-1 font-medium">{t.label}</span>
                            {active && <Icon name="check" className="w-4 h-4 flex-shrink-0" strokeWidth={3}/>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button onClick={() => setShowAuxScoreHelp(true)} className="btn-ghost px-3 h-8 rounded-md text-sm flex items-center gap-1.5">
                  <Icon name="help" className="w-4 h-4"/> 輔分說明
                </button>
                <button onClick={() => setShowAboutInfo(true)} className="btn-ghost px-3 h-8 rounded-md text-sm flex items-center gap-1.5">
                  <Icon name="info" className="w-4 h-4"/> 關於
                </button>
                <button
                  onClick={() => setHeaderCollapsed(!headerCollapsed)}
                  className="btn-ghost px-3 h-8 rounded-md text-sm flex items-center gap-1.5"
                  title={headerCollapsed ? '展開設定' : '摺疊設定'}
                >
                  <Icon name={headerCollapsed ? 'chevronDown' : 'chevronUp'} className="w-3.5 h-3.5"/>
                  {headerCollapsed ? '展開' : '摺疊'}
                </button>
              </div>
            </div>

            {/* 初次使用引導橫幅（任何時候都顯示，可手動關閉） */}
            {isInitialState && !welcomeDismissed && (
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--win-soft)] flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0 text-[var(--win)]">
                  <Icon name="sparkle" className="w-5 h-5 flex-shrink-0"/>
                  <div className="text-sm">
                    <span className="font-semibold">歡迎使用！</span>
                    <span className="ml-2 opacity-90">
                      請先上傳隊伍表 Excel（或下載範例），即可開始比賽配對。之後可在【匯入/匯出】中找到隊伍表範例。
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <label className="btn-success inline-flex items-center justify-center gap-1.5 rounded-md px-4 h-9 text-sm cursor-pointer whitespace-nowrap">
                    <Icon name="upload" className="w-4 h-4"/> 上傳隊伍表
                    <input type="file" className="hidden" onChange={handleFileUpload} onClick={e => { (e.target as HTMLInputElement).value = ''; }} accept=".xlsx,.xls"/>
                  </label>
                  <button
                    onClick={downloadSampleTeamList}
                    className="btn-ghost inline-flex items-center justify-center gap-1.5 rounded-md px-3 h-9 text-sm whitespace-nowrap border-[var(--win)] text-[var(--win)] hover:bg-[var(--win-soft)]"
                  >
                    <Icon name="download" className="w-4 h-4"/> 下載範例
                  </button>
                  <button
                    onClick={() => setWelcomeDismissed(true)}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--win)] hover:bg-[var(--win-soft)] transition-colors"
                    title="關閉歡迎提示"
                    aria-label="關閉歡迎提示"
                  >
                    <Icon name="x" className="w-4 h-4"/>
                  </button>
                </div>
              </div>
            )}

            {/* 摺疊狀態：只顯示流程提示 + 主動作 */}
            {headerCollapsed ? (
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className={`flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-md text-sm ${stageBg}`}>
                  <Icon name={stage.icon} className="w-4 h-4 flex-shrink-0"/>
                  <span className="truncate">{stage.msg}</span>
                </div>
                {compactActions}
              </div>
            ) : (
              <div className="px-4 py-3 space-y-3">
                {/* 設定列：grid 排版 */}
                <div className="grid grid-cols-12 gap-3">
                  <Field label="賽制" col={2}><Static>瑞士制</Static></Field>
                  <Field label="比賽項目" col={3}><Static>{gameTitle}</Static></Field>
                  <Field label="參賽隊伍" col={2}>
                    <input type="number" min={2} value={allPlayers} onChange={e => setAllPlayers(parseInt(e.target.value) || 2)} className="w-full px-2 h-9 text-base font-mono-num"/>
                  </Field>
                  <Field label="輪數" col={2}>
                    <input type="number" min={1} value={rounds} onChange={e => setRounds(parseInt(e.target.value) || 1)} className="w-full px-2 h-9 text-base font-mono-num"/>
                  </Field>
                  <Field label="勝方得分" col={1}>
                    <input type="number" min={1} value={winPoint} onChange={e => setWinPoint(parseInt(e.target.value) || 1)} className="w-full px-2 h-9 text-base font-mono-num"/>
                  </Field>
                  <Field label="當前輪次" col={2}>
                    <input type="number" min={1} max={rounds} value={currentRound} onChange={e => setCurrentRound(parseInt(e.target.value) || 1)} className="w-full px-2 h-9 text-base font-mono-num"/>
                  </Field>
                </div>

                {/* 流程提示 */}
                <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm ${stageBg}`}>
                  <Icon name={stage.icon} className="w-4 h-4 flex-shrink-0"/>
                  <span>{stage.msg}</span>
                  <div className="ml-auto text-xs opacity-70 tabular">STEP {stage.step} / 4</div>
                </div>

                {/* 主操作 + 輔助操作 */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDrawLots}
                    disabled={currentRound !== 1}
                    className="btn-ghost px-4 h-10 rounded-md text-sm flex items-center gap-2"
                    title={currentRound !== 1 ? '僅第 1 輪可抽籤' : '隨機重排籤號'}
                  >
                    <Icon name="dice" className="w-4 h-4"/> 抽籤
                  </button>
                  <button
                    onClick={generatePairings}
                    disabled={isPairingButtonDisabled}
                    className="btn-primary px-5 h-10 rounded-md text-sm flex items-center gap-2 flex-1 justify-center"
                  >
                    <Icon name="swap" className="w-4 h-4"/>
                    <span>抓對</span>
                    <span className="opacity-70 text-sm font-normal">生成 R{currentRound} 桌次</span>
                  </button>
                  <button
                    onClick={calculateScores}
                    disabled={!isPairingButtonDisabled}
                    className={`px-5 h-10 rounded-md text-sm flex items-center gap-2 flex-1 justify-center font-medium
                      ${isPairingButtonDisabled ? 'btn-success' : 'btn-ghost opacity-50 cursor-not-allowed'}`}
                  >
                    <Icon name="calculator" className="w-4 h-4"/>
                    <span>算分</span>
                    <span className="opacity-70 text-sm font-normal">結算 R{currentRound}</span>
                  </button>

                  <div className="w-px h-8 bg-[var(--border-default)] mx-1"/>

                  <label className="btn-ghost px-3 h-10 rounded-md text-sm flex items-center gap-1.5 cursor-pointer" title="上傳隊伍表 Excel">
                    <Icon name="upload" className="w-4 h-4"/>
                    <span className="hidden xl:inline">上傳</span>
                    <input type="file" className="hidden" onChange={handleFileUpload} onClick={e => { (e.target as HTMLInputElement).value = ''; }} accept=".xlsx,.xls"/>
                  </label>
                  <button
                    onClick={() => setShowImportExport(v => !v)}
                    className="btn-ghost px-3 h-10 rounded-md text-sm flex items-center gap-1.5"
                    title="匯入/匯出 Excel 與狀態備份"
                  >
                    <Icon name="download" className="w-4 h-4"/>
                    <span className="hidden xl:inline">匯入/匯出</span>
                  </button>
                  <button
                    onClick={resetSystem}
                    className="btn-danger px-3 h-10 rounded-md text-sm flex items-center gap-1.5"
                    title="清除所有資料、回到第 1 輪"
                  >
                    <Icon name="refresh" className="w-4 h-4"/>
                    <span>重設</span>
                  </button>
                </div>

                {/* 匯入/匯出區塊（沿用既有狀態） */}
                {showImportExport && (
                  <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-3 text-sm">
                    <div>
                      <div className="font-semibold text-[var(--text-secondary)] mb-1.5">Excel 下載 / 範例</div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Button onClick={exportPlayersToExcel}><Icon name="download" className="w-4 h-4"/> 下載選手成績</Button>
                        <Button onClick={exportMatchesToExcel}><Icon name="download" className="w-4 h-4"/> 下載桌次表</Button>
                        <Button onClick={downloadSampleTeamList}><Icon name="download" className="w-4 h-4"/> 下載隊伍表範例</Button>
                      </div>
                      <div className="text-[var(--text-muted)] text-xs leading-relaxed">
                        <div>
                          <span className="font-semibold">隊伍表必填欄位：</span>
                          <code className="bg-[var(--bg-surface)] px-1 rounded border border-[var(--border-default)] ml-1">籤號</code>（數字，從 1 開始）、
                          <code className="bg-[var(--bg-surface)] px-1 rounded border border-[var(--border-default)]">隊伍</code>（文字）
                        </div>
                        <div className="mt-0.5">欄位名稱可使用同義字（如「籤號／編號／號碼／No」、「隊伍／隊名／團隊／名稱」）。第一列為標題，其後每列一隊。</div>
                      </div>
                    </div>
                    <div className="border-t border-[var(--border-subtle)] pt-3">
                      <div className="font-semibold text-[var(--text-secondary)] mb-1.5">狀態備份</div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <label className="btn-ghost inline-flex items-center justify-center gap-1.5 rounded-md font-medium px-3 h-8 text-sm cursor-pointer">
                          <Icon name="upload" className="w-4 h-4"/> 上傳狀態
                          <input type="file" className="hidden" onChange={importStateFromJSON} onClick={e => { (e.target as HTMLInputElement).value = ''; }} accept=".json"/>
                        </label>
                        <Button onClick={exportStateToJSON}><Icon name="download" className="w-4 h-4"/> 下載狀態</Button>
                      </div>
                      <div className="text-[var(--text-muted)] text-xs">把目前所有資料（隊伍、輪次、分數）打包為 JSON 檔，可匯出備份或在另一台電腦上「上傳狀態」還原。</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ─── 兩欄主內容：左排行榜、右桌次表 ─────────────────── */}
      <div className="flex-1 flex gap-3 overflow-hidden min-h-0" id="split-container">
        <div className="flex-shrink-0 min-w-0" style={{ width: `${splitRatio}%` }}>
          {renderPlayerList()}
        </div>

        {/* 分割線 - 可拖動 */}
        <div
          className="w-1 -mx-1.5 bg-transparent cursor-col-resize hover:bg-[var(--accent-soft)] active:bg-[var(--accent)] flex-shrink-0"
          onMouseDown={() => {
            const onMove = (ev: MouseEvent) => handleSplitDragChange(ev as any);
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        />

        <div className="flex-1 min-w-0">
          {renderRightPane()}
        </div>
      </div>

      {/* ─── Modal：關於 ─────────────────────────────────── */}
      <Modal open={showAboutInfo} onClose={() => setShowAboutInfo(false)} title="關於本系統">
        <div className="space-y-3">
          <div>
            <div className="font-semibold text-[var(--text-primary)]">WGP 比賽管理系統</div>
            <div className="text-xs text-[var(--text-muted)] mt-0.5">v{packageInfo.version}</div>
          </div>
          <p>瑞士制對戰配對與積分管理工具，專為 WGP GiveMe5 桌遊賽事設計。</p>
          <div>
            <div className="text-[var(--text-muted)] text-xs mb-1">開發者</div>
            <div>Rita Weng · <a className="text-[var(--accent)] hover:underline" href="mailto:rita6656@gmail.com">rita6656@gmail.com</a></div>
          </div>
          <div>
            <div className="text-[var(--text-muted)] text-xs mb-1">GitHub 專案</div>
            <a
              href="https://github.com/RitaWeng/wgp-tournament-manager"
              target="_blank" rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline break-all"
            >
              github.com/RitaWeng/wgp-tournament-manager
            </a>
          </div>
          <div className="pt-2 text-right">
            <Button onClick={() => setShowAboutInfo(false)} type="primary">關閉</Button>
          </div>
        </div>
      </Modal>

      {/* ─── Modal：輔分說明 ─────────────────────────────── */}
      <Modal open={showAuxScoreHelp} onClose={() => setShowAuxScoreHelp(false)} title="輔分說明">
        <div className="space-y-3">
          <p className="text-[var(--text-muted)]">排名依以下順序依序比較：</p>
          <div className="space-y-2">
            <div className="flex gap-2"><Pill tone="accent" size="xs" className="flex-shrink-0 mt-0.5">總分</Pill><div>每輪勝者獲得勝方得分，敗者得 0 分，輪空獲得勝方得分。</div></div>
            <div className="flex gap-2"><Pill tone="accent" size="xs" className="flex-shrink-0 mt-0.5">輔分一</Pill><div>所遇對手之總分和。所有對手（不含輪空）的最終總分加總。</div></div>
            <div className="flex gap-2"><Pill tone="accent" size="xs" className="flex-shrink-0 mt-0.5">輔分二</Pill><div>所負對手之總分和。僅計算落敗場次中對手的最終總分加總。</div></div>
            <div className="flex gap-2"><Pill tone="accent" size="xs" className="flex-shrink-0 mt-0.5">輔分三</Pill><div>直接對戰結果。僅在前述均相同時啟用。</div></div>
          </div>
          <p className="text-xs text-[var(--text-disabled)]">* 輪空場次不計入輔分計算。</p>
          <div className="pt-2 text-right">
            <Button onClick={() => setShowAuxScoreHelp(false)} type="primary">關閉</Button>
          </div>
        </div>
      </Modal>

      {/* ─── 投影模式（桌次表 / 名次表） ─────────────────── */}
      {projectionMode && (
        <div className="fixed inset-0 z-50 flex flex-col proj-bg">
          <div className="absolute top-4 right-4 z-10 flex gap-2 items-center">
            {projectionMode === 'standings' && (
              <div className="flex items-center gap-2 px-3 h-9 bg-[var(--bg-elevated)] rounded-md border border-[var(--border-default)] text-sm">
                <span className="text-[var(--text-muted)]">前</span>
                <input
                  type="number" min={1} max={Math.max(1, players.length)}
                  value={standingsTopN ?? players.length}
                  onChange={e => {
                    const v = parseInt(e.target.value) || 1;
                    setStandingsTopN(v >= players.length ? null : v);
                  }}
                  className="w-14 h-7 px-1 text-center text-sm font-mono-num"
                />
                <span className="text-[var(--text-muted)]">名 / {players.length}</span>
                {standingsTopN !== null && (
                  <button onClick={() => setStandingsTopN(null)} className="ml-1 text-xs text-[var(--accent)] hover:underline">全部</button>
                )}
              </div>
            )}
            <button
              onClick={() => {
                if (document.fullscreenElement) document.exitFullscreen?.();
                else document.documentElement.requestFullscreen?.();
              }}
              className="btn-ghost px-3 h-9 rounded-md text-sm flex items-center gap-1.5"
            >
              <Icon name="expand" className="w-4 h-4"/> 全螢幕
            </button>
            <button
              onClick={() => setProjectionMode(null)}
              className="btn-ghost px-3 h-9 rounded-md text-sm flex items-center gap-1.5"
              title="關閉（ESC）"
            >
              <Icon name="x" className="w-4 h-4"/> 關閉
            </button>
          </div>
          {projectionMode === 'tables' ? renderTablesProjection() : renderStandingsProjection()}
        </div>
      )}
    </div>
  );
};

// Header 設定列：欄位 + 唯讀靜態值
const Field = ({ label, children, col = 2 }: { label: string; children?: React.ReactNode; col?: number }) => (
  <div className="flex flex-col gap-1" style={{ gridColumn: `span ${col} / span ${col}` }}>
    <label className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">{label}</label>
    {children}
  </div>
);

const Static = ({ children }: { children?: React.ReactNode }) => (
  <div className="px-2 h-9 flex items-center text-base text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md font-medium">
    {children}
  </div>
);

export default TournamentManager;