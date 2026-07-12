import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';

// 上傳用於Excel處理的函數
import * as XLSX from 'xlsx';

import packageInfo from '../package.json';

// 抓對 / 輔分演算法（與 tests/regression/replay_excel.js 共用同一份程式碼）
import {
  calculateAuxiliaryScores as calculateAuxiliaryScoresCore,
  generateSwissPairings as generateSwissPairingsCore,
  isWithdrawn,
  isActiveForRound,
  compareByScoreThenAux,
} from './lib/swissPairing';

// in-page 對話框（取代原生 alert / confirm / prompt）
import { dialog } from './lib/dialog';

// 線上成績回報同步（規格：docs/online-score-reporting-plan.md）。
// 只在建立線上賽事後啟用；後端不可用時所有既有功能行為不變（不變式 2）
import * as onlineSync from './lib/sync';
import QRCode from 'qrcode';

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
// FitText — 自動縮字以避免溢出（投影模式長隊名）
// 容器寬度不夠時，二分搜尋出能塞下的最大字級；最小字級下限仍裝不下才會被裁。
// ─────────────────────────────────────────────────────────────────
const FitText = ({
  text,
  maxFontPx,
  minFontPx,
  className = '',
  title,
}: {
  text: string;
  maxFontPx: number;
  minFontPx: number;
  className?: string;
  title?: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fontPx, setFontPx] = useState(maxFontPx);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const fit = () => {
      // 用 getBoundingClientRect 取次像素寬度：scrollWidth 是整數，文字寬剛好等於
      // 容器寬時會誤判塞得下，實際渲染卻因次像素溢位觸發刪節號；再留 0.5px 安全邊
      const containerWidth = container.getBoundingClientRect().width;
      if (containerWidth <= 0) return;
      let lo = minFontPx;
      let hi = maxFontPx;
      let best = minFontPx;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        measure.style.fontSize = `${mid}px`;
        if (measure.getBoundingClientRect().width <= containerWidth - 0.5) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      setFontPx(best);
    };

    fit();
    // 網頁字體（如 extrabold 字重）是首次使用才觸發下載，載完字寬會變，
    // 每次載入完成都要重量，否則以 fallback 字體量出的字級會溢出被裁
    document.fonts?.addEventListener?.('loadingdone', fit);
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => {
      document.fonts?.removeEventListener?.('loadingdone', fit);
      ro.disconnect();
    };
  }, [text, maxFontPx, minFontPx]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={{ minWidth: 0 }}
      title={title}
    >
      <span
        ref={measureRef}
        aria-hidden="true"
        className="invisible absolute left-0 top-0 whitespace-nowrap pointer-events-none"
      >
        {text}
      </span>
      <span
        className="block whitespace-nowrap overflow-hidden text-ellipsis"
        style={{ fontSize: `${fontPx}px`, lineHeight: 1.15 }}
      >
        {text}
      </span>
    </div>
  );
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
  | 'arrow_right' | 'sparkle' | 'search' | 'alert' | 'plus' | 'minus' | 'palette'
  | 'sun' | 'moon';

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
  sun:         <><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></>,
  moon:        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />,
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

const Pill = ({ children, tone = 'default', size = 'sm', className = '', style }: {
  children?: React.ReactNode; tone?: PillTone; size?: PillSize; className?: string; style?: React.CSSProperties;
}) => (
  <span className={`inline-flex items-center gap-1 rounded-full font-medium ${PILL_TONES[tone]} ${PILL_SIZES[size]} ${className}`} style={style}>
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
// 各方法皆 fire-and-forget；呼叫端不需 await，原本 20+ 個呼叫點不必更動。
const message = {
  success: (content: React.ReactNode) => { void dialog.alert({ tone: 'success', message: content }); },
  warning: (content: React.ReactNode) => { void dialog.alert({ tone: 'warn',    message: content }); },
  error:   (content: React.ReactNode) => { void dialog.alert({ tone: 'error',   message: content }); },
};

// 棄賽 / 恢復參賽按鈕（僅編輯模式顯示）。定義在模組層級：
// 若定義在元件 render body 內，每次 render 都是新的元件型別，React 會整批 unmount/remount
const WithdrawButton = ({ player, onToggle }: { player: any; onToggle: (n: number) => void }) => (
  <button
    onClick={() => onToggle(player.number)}
    title={isWithdrawn(player) ? '恢復參賽' : '標記棄賽'}
    className={`px-2 h-7 rounded-md text-[11px] border transition-colors whitespace-nowrap flex-shrink-0
      ${isWithdrawn(player)
        ? 'border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--bg-hover)]'
        : 'border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--loss)] hover:border-[var(--loss)]'}`}
  >
    {isWithdrawn(player) ? '恢復' : '棄賽'}
  </button>
);

// 載入存檔（localStorage 還原 / JSON 匯入）時的選手正規化：
// 舊存檔缺 withdrawnRound 補預設值（缺欄位才補，既有值保留），並剝除已廢棄的 status 欄位
// （棄賽狀態以 withdrawnRound 為唯一事實來源）
const normalizePlayers = (list) =>
  (list || []).map(({ status, ...p }) => ({ withdrawnRound: null, ...p }));

const TournamentManager = () => {
  // 狀態管理
  const [allPlayers, setAllPlayers] = useState(10);
  const [rounds, setRounds] = useState(5);
  // 輪數輸入框的草稿值：編輯期間先存字串、不立刻寫入 rounds，避免多位數輸入被自身 controlled value 中途夾斷
  const [roundsDraft, setRoundsDraft] = useState<string | null>(null);
  const [winPoint, setWinPoint] = useState(1);
  const [players, setPlayers] = useState([]);
  // const [matches, setMatches] = useState([]);
  const [matches, setMatches] = useState([]);
  // 以 {1: [round1 matches], 2: […], …} 格式儲存
  const [matchesByRound, setMatchesByRound] = useState({});
  const [sortByRank, setSortByRank] = useState(false);
  // 預設 true（不擋同國）：UI 上沒有暴露此設定，預設 false 會讓 Excel 帶 country
  // 欄的使用者出現「不能改也不知為何被擋」的隱性限制；要重新啟用同國檢查時，
  // 接 UI 開關即可。
  const [allowSameCountry, setAllowSameCountry] = useState(true);
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
  // 投影專用主題：只套在投影 overlay 上，裁判操作介面維持全域主題。
  // 預設深色——投影機亮度全部用在字上，昏暗禮堂對比最強。
  const [projTheme, setProjTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('wgp-proj-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const toggleProjTheme = () => {
    setProjTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('wgp-proj-theme', next); } catch {}
      return next;
    });
  };
  // 投影名次表：自訂競賽名稱（空字串時 fallback 到 gameTitle）
  const [projectionTitle, setProjectionTitle] = useState<string>('');
  // 投影名次表：只顯示前 N 名（null = 全部）
  const [standingsTopN, setStandingsTopN] = useState<number | null>(null);
  // 投影桌次表：依容器尺寸與桌數動態計算 — 卡片寬、欄數、列數、每列高
  // 演算法挑「能塞下的最少欄數」以最大化卡片寬度，再用 grid 強制每欄列數相同
  const tablesLayoutRef = useRef<HTMLDivElement>(null);
  const [tablesCardWidth, setTablesCardWidth] = useState<number>(480);
  const [tablesCols, setTablesCols] = useState<number>(2);
  const [tablesRowsPerCol, setTablesRowsPerCol] = useState<number>(1);
  const [tablesRowH, setTablesRowH] = useState<number>(76);
  // UI 重構：Header 是否摺疊
  // 頂部兩段獨立摺疊：設定列（賽制/隊數/輪數…）與操作區（流程提示＋按鈕列）分開收合
  const [settingsCollapsed, setSettingsCollapsed] = useState<boolean>(false);
  const [actionsCollapsed, setActionsCollapsed] = useState<boolean>(false);
  // UI 重構：左欄排行榜顯示模式（compact = 卡片式、detail = 詳細表格）
  const [viewMode, setViewMode] = useState<'compact' | 'detail'>('detail');

  // ── 線上成績回報（規格：docs/online-score-reporting-plan.md）──
  const [onlineCfg, setOnlineCfg] = useState<onlineSync.SyncConfig | null>(() => onlineSync.loadSyncConfig());
  const [showOnlinePanel, setShowOnlinePanel] = useState(false);
  const [onlineApiDraft, setOnlineApiDraft] = useState('');
  // 建立賽事金鑰（後端 SETUP_KEY）：擋垃圾賽事灌爆免費額度；輸入一次記在 localStorage
  const [onlineKeyDraft, setOnlineKeyDraft] = useState<string>(() => {
    try { return localStorage.getItem('wgpOnlineSetupKey') || ''; } catch { return ''; }
  });
  const [onlineLastSync, setOnlineLastSync] = useState<string | null>(null);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [tablesStatus, setTablesStatus] = useState<onlineSync.TableStatusRow[] | null>(null);
  // P0 鎖定狀態對帳（docs/online-score-sync-drift.md）：本機 scoredRounds 為權威，
  // 尚未確認同步到後端的已鎖輪次（顯示「鎖定同步中」，由輪詢重試直到清空）
  const [lockSyncPending, setLockSyncPending] = useState<number[]>([]);
  // 已處理的裁判回報：key `${round}-${table}` → 已見版本與勝方；dismissed = 操作者拒絕採計該版本
  const [judgeReports, setJudgeReports] = useState<Record<string, { version: number; winner: number; dismissed?: boolean }>>({});
  // matchesByRound 經裁判回報批次更新後，讓 matches（當前輪視圖）跟上的訊號
  const [judgeApplyTick, setJudgeApplyTick] = useState(0);
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
      setWinPoint(appState.winPoint);
      setPlayers(normalizePlayers(appState.players));
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
        const appState = JSON.parse(e.target.result as string);
        
        // 檢查上傳的數據是否包含必要的字段
        if (!appState.players || !appState.matchesByRound) {
          throw new Error('上傳的 JSON 檔案格式不正確');
        }
        
        // 恢復各個狀態
        setAllPlayers(appState.allPlayers);
        setRounds(appState.rounds);
        setWinPoint(appState.winPoint);
        setPlayers(normalizePlayers(appState.players));
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

// 切換棄賽 / 恢復參賽。棄賽採「從下一個尚未配對的輪次起生效」：
// 已打成績保留並照算進對手輔分，但退賽隊不再被抓對、不佔正式名次。
// 切換後立即重排名次（在賽隊名次連號；恢復的隊馬上取回名次），不需等下一次算分。
// 賽前（尚無任何成績）不重排，維持初始的籤號名次。
const handleToggleWithdraw = async (playerNumber) => {
  const player = players.find(p => p.number === playerNumber);
  if (!player) return;

  // 用 functional setState 避免 confirm 開窗期間落地的其他更新被舊 snapshot 覆蓋；
  // recomputeRanks 會 mutate 元素，先淺拷貝每個 player 再交給它。
  const toggleAndRerank = (newWithdrawnRound) => {
    setPlayers(prev => {
      const toggled = prev.map(p =>
        p.number === playerNumber ? { ...p, withdrawnRound: newWithdrawnRound } : { ...p }
      );
      const anyScored = toggled.some(p => p.rounds.some(r => r && r.score !== null));
      return anyScored ? recomputeRanks(toggled) : toggled;
    });
  };

  if (isWithdrawn(player)) {
    const ok = await dialog.confirm({
      title: '恢復參賽',
      message: `確定讓「${player.name}」恢復參賽？\n將重新納入正式名次與後續抓對。`,
      tone: 'info',
      okText: '恢復參賽',
    });
    if (!ok) return;
    toggleAndRerank(null);
    return;
  }

  // 當輪若已產生桌次，退賽從下一輪起生效（當輪維持原桌次）；否則從當輪起生效
  const currentRoundPaired = !!(matchesByRound[currentRound] && matchesByRound[currentRound].length);
  const effectiveRound = currentRoundPaired ? currentRound + 1 : currentRound;
  const ok = await dialog.confirm({
    title: '標記棄賽',
    message: `確定將「${player.name}」標記為棄賽？\n將從第 ${effectiveRound} 輪起不再被抓對；已打成績保留並計入對手輔分，但不佔正式名次。`,
    tone: 'warn',
    danger: true,
    okText: '標記棄賽',
  });
  if (!ok) return;
  toggleAndRerank(effectiveRound);
};

  // 預設選手物件的唯一定義：所有初始化路徑（開賽初始化、名單上傳重建）共用，
  // 新增選手欄位時只需改這裡（載入舊存檔的補欄位見 normalizePlayers）
  const createDefaultPlayer = (i: number) => ({
    number: i,
    name: `隊伍${i}`,
    level: '',
    country: '',
    withdrawnRound: null,    // 從第幾輪起棄賽（1-based）；null 表示未棄賽（唯一事實來源）
    totalScore: 0,
    rank: i,
    auxScore1: 0, // 輔分一：所遇對手之總分和
    auxScore2: 0, // 輔分二：所負對手之總分和
    auxScore3: 0, // 輔分三：彼此對戰之勝負
    rounds: Array(rounds).fill(null).map(() => ({ score: null, opponent: null, isBlack: false }))
  });

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
  }, [allPlayers, rounds, winPoint, players, matches, matchesByRound, sortByRank, allowSameCountry, currentRound, gameTitle, selectedRound, isPairingButtonDisabled, showAuxScoreHelp, scoredRounds, projectionTitle, standingsTopN]);
  
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

  // 桌次表投影（堆疊版）：每張卡 = 桌號跨兩行 + 兩隊上下堆疊
  // 逐一嘗試欄數，挑「隊名可達字級」最大的組合（欄多→卡高→行高大，但卡不能太窄）
  useLayoutEffect(() => {
    if (projectionMode !== 'tables') return;
    const total = (matchesByRound[selectedRound] || []).length;
    if (total <= 0) return;
    const el = tablesLayoutRef.current;
    if (!el) return;

    const compute = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (W <= 0 || H <= 0) return;
      const GAP_Y = 10;
      const GAP_X = 20;
      const MIN_CARD_H = 104; // 兩行隊伍 + padding 的最小高度
      const MAX_CARD_H = 300;
      const MIN_W = 360;
      const MAX_W = 1440;

      let best: null | { score: number; cols: number; rows: number; rowH: number; cardW: number } = null;
      for (let cols = 1; cols <= Math.min(8, total); cols++) {
        const rows = Math.ceil(total / cols);
        const rowH = Math.min(MAX_CARD_H, (H - GAP_Y * (rows - 1)) / rows);
        const cardW = Math.min(MAX_W, (W - GAP_X * (cols - 1)) / cols - 4);
        if (rowH < MIN_CARD_H || cardW < MIN_W) continue;
        const lineH = (rowH - 32) / 2; // 扣 padding 與分隔線後的單行高
        const score = Math.min(cardW * 0.10, lineH * 0.8); // ≈ 該組合下隊名可達字級
        if (!best || score > best.score) best = { score, cols, rows, rowH, cardW };
      }
      if (!best) {
        // 桌數多到塞不下時的保底：以最小卡高推欄數、寬度夾在下限，寧可擠也不裁列
        const maxRows = Math.max(1, Math.floor((H + GAP_Y) / (MIN_CARD_H + GAP_Y)));
        const cols = Math.max(1, Math.ceil(total / maxRows));
        const rows = Math.ceil(total / cols);
        best = {
          score: 0, cols, rows,
          rowH: Math.max(88, (H - GAP_Y * (rows - 1)) / rows),
          cardW: Math.max(320, Math.min(MAX_W, (W - GAP_X * (cols - 1)) / cols - 4)),
        };
      }
      setTablesCardWidth(Math.round(best.cardW));
      setTablesCols(best.cols);
      setTablesRowsPerCol(best.rows);
      setTablesRowH(Math.round(best.rowH));
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [projectionMode, selectedRound, matchesByRound]);

  const initializePlayers = (forceNew = forceNewPlayers) => {
    // 檢查是否為現有玩家資料更新
    if (!forceNew && players.length > 0 && players.length === allPlayers) {
      // 只更新輪數變動
      const updatedPlayers = players.map(player => {
        // 確保 rounds 陣列長度為當前的輪數
        const newRounds = Array(rounds).fill(null).map((_, i) => {
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
        newPlayers.push(createDefaultPlayer(i));
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
  const handleDrawLots = async () => {
    if (currentRound !== 1) {
        message.warning('只有第 1 輪可以抽籤');
        return;
    }

    // 檢查是否有任何輪次的桌次表存在
    const existingRounds = Object.keys(matchesByRound).map(r => parseInt(r, 10));
    const hasAnyRounds = existingRounds.length > 0;

    const ok = await dialog.confirm({
      title: '抽籤確認',
      message: hasAnyRounds
        ? `已存在桌次表！\n抽籤將會清除所有輪次的桌次和比賽結果。\n\n確定要在第 ${currentRound} 輪執行抽籤嗎？`
        : `確定要在第 ${currentRound} 輪執行抽籤嗎？`,
      tone: hasAnyRounds ? 'warn' : 'info',
      danger: hasAnyRounds,
      okText: '執行抽籤',
    });
    if (!ok) return;

    // 如果確認，清除所有輪次的桌次表
    if (hasAnyRounds) {
      setMatchesByRound({});
    }

    // 執行抽籤
    drawLots();
  };

  // 生成配對
  const generatePairings = async () => {
    // 如果按鈕已被禁用，則不執行任何操作
    if (isPairingButtonDisabled) {
      message.warning('已生成本輪桌次表，請完成本輪比賽結果輸入並按下「算分」後再生成下一輪桌次表。');
      return;
    }

    // R1 抓對時提前提示輪數設定是否合理（不擋流程；真的無解時下方
    // generateSwissPairings 會回報失敗）
    if (currentRound === 1) {
      const oddRoundCap = allPlayers % 2 === 1 ? allPlayers : allPlayers - 1;
      if (rounds > oddRoundCap) {
        message.warning(`瑞士制輪數設定過多，將造成最後無法抓對。\n參賽 ${allPlayers} 人建議可採 ${oddRoundCap} 輪以下的瑞士制`);
      }
      const minRounds = Math.ceil(Math.log2(allPlayers));
      if (Math.pow(2, rounds) < allPlayers) {
        message.warning(`${rounds} 輪瑞士制在參賽人數超過 ${Math.pow(2, rounds)} 人時，恐無法分出勝負。\n參賽 ${allPlayers} 人建議至少打 ${minRounds} 輪以上的瑞士制`);
      }
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
      const ok = await dialog.confirm({
        title: '清除後續輪次',
        message:
          `已存在第 ${currentRound + 1} 輪或更高輪次的桌次表。\n` +
          `抓對將會清除第 ${currentRound + 1} 到第 ${maxRound} 輪的所有桌次和比賽結果。\n\n` +
          `確定要在第 ${currentRound} 輪執行抓對嗎？`,
        tone: 'warn',
        danger: true,
        okText: '執行抓對',
      });
      if (!ok) return;

      // 如果確認，清除高於當前輪次的桌次表
      const updatedMatchesByRound = { ...matchesByRound };
      existingRounds.forEach(round => {
        if (round > currentRound) {
          delete updatedMatchesByRound[round];
        }
      });
      setMatchesByRound(updatedMatchesByRound);
    }
    
    // 繼續正常的抓對流程；失敗（人數不足 / 無解）時不要鎖按鈕，讓使用者調整後重試
    const ok = await generateSwissPairings();
    if (!ok) return;

    // 更新選中的輪次為當前輪次
    setSelectedRound(currentRound);

    // 設置抓對按鈕為禁用狀態，直到完成算分
    setIsPairingButtonDisabled(true);
  };
  


  // 瑞士制抓對：薄包裝層，把純演算法（src/lib/swissPairing.js）回傳的對局
  // 包成 React state 需要的格式（補上 round / player1IsBlack），並把無解情境
  // 轉成對話框訊息。回傳 true 代表已產生桌次表，false 代表中止（呼叫端應據此決定是否鎖按鈕）。
  const generateSwissPairings = async (): Promise<boolean> => {
    // 棄賽隊不進入配對池；過濾採 round-aware（棄賽生效輪之前的輪次重抓時，該隊仍應在池中）
    const activePlayers = players.filter(p => isActiveForRound(p, currentRound));
    if (activePlayers.length < 2) {
      message.warning('在賽隊伍人數不足，無法抓對');
      return false;
    }

    // allPlayers 傳完整名單：輪動平衡需查退賽對手的歷史分數（已打成績照算）
    const result = generateSwissPairingsCore(activePlayers, currentRound, { allowSameCountry, allPlayers: players });
    if (!result.ok) {
      await dialog.alert({
        tone: 'error',
        title: '抓對失敗',
        message: `${result.reason}\n${result.hint}\n\n建議：檢查選手資料，或考慮減少輪數。`,
      });
      return false;
    }

    const playerByNumber = new Map(players.map(p => [p.number, p]));
    const newMatches = result.matches.map(m => {
      if (m.player2 === 0) {
        return {
          table: m.table,
          player1: m.player1,
          player2: 0,
          round: currentRound,
          player1IsBlack: true,
        };
      }
      const p1 = playerByNumber.get(m.player1);
      const p2 = playerByNumber.get(m.player2);
      return {
        table: m.table,
        player1: m.player1,
        player2: m.player2,
        round: currentRound,
        player1IsBlack: determineFirstMove(p1, p2, currentRound),
      };
    });

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
    return true;
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

  // 輔分計算包裝層：注入當前 winPoint 給共用模組
  const calculateAuxiliaryScores = (playersList) =>
    calculateAuxiliaryScoresCore(playersList, winPoint);

  // 重算輔分與名次（會 mutate 傳入陣列的元素並回傳同一陣列，呼叫端須傳入可變的拷貝）：
  // 退賽隊 rank=null 不佔正式名次；在賽隊伍依總分→輔分一二三→籤號排序，支援並列名次 (1,1,3,4,4,6...)
  const recomputeRanks = (playerList) => {
    const playersWithAuxScores = calculateAuxiliaryScores(playerList);

    playersWithAuxScores.forEach(p => { if (isWithdrawn(p)) p.rank = null; });
    const rankedPlayers = playersWithAuxScores
      .filter(p => !isWithdrawn(p))
      .sort((a, b) => {
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

    return playersWithAuxScores;
  };

  // 計算得分
  const calculateScores = async () => {
    // 算分前先驗證配對：hardErrors 必擋；softErrors 彈 confirm 可覆寫
    const { hardErrors, softErrors } = getPairingIssues(currentRound);
    if (hardErrors.length > 0) {
      setPairingValidation({ round: currentRound, errors: [...hardErrors, ...softErrors] });
      return;
    }
    if (softErrors.length > 0) {
      const ok = await dialog.confirm({
        title: '偵測到重複對戰',
        message: `${softErrors.join('\n')}\n\n仍要算分嗎？`,
        tone: 'warn',
        okText: '仍要算分',
      });
      if (!ok) {
        setPairingValidation({ round: currentRound, errors: softErrors });
        return;
      }
      setPairingValidation(null);
    }

    // 深拷貝玩家數據
    const updatedPlayers = JSON.parse(JSON.stringify(players));

    // 計算每輪的分數，並產出新的對戰陣列（輪空場次補上勝分；不變異原 state 物件）
    const updatedRoundMatches = matches.map(match => {
      const p1Index = updatedPlayers.findIndex(p => p.number === match.player1);
      const p2Index = match.player2 === 0 ? -1 : updatedPlayers.findIndex(p => p.number === match.player2);

      // 如果有比賽結果或是輪空情況
      if (match.player1Score !== undefined && match.player1Score !== null) {
        updatedPlayers[p1Index].rounds[match.round - 1] = {
          score: match.player1Score,
          opponent: match.player2,
          isBlack: match.player1IsBlack
        };

        if (p2Index !== -1) {
          updatedPlayers[p2Index].rounds[match.round - 1] = {
            score: winPoint - match.player1Score,
            opponent: match.player1,
            isBlack: !match.player1IsBlack
          };
        }
        return match;
      }

      // 自動處理輪空情況 - 確保輪空選手得到勝分
      if (match.player2 === 0) {
        updatedPlayers[p1Index].rounds[match.round - 1] = {
          score: winPoint,
          opponent: 0,
          isBlack: match.player1IsBlack
        };
        return { ...match, player1Score: winPoint };
      }

      return match;
    });

    // 將輪空場次的勝分回寫到 state（取代原本的直接變異）
    setMatchesByRound(prev => ({ ...prev, [currentRound]: updatedRoundMatches }));
    setMatches(updatedRoundMatches);
    
    // 計算總分
    updatedPlayers.forEach(player => {
      player.totalScore = player.rounds.reduce((total, round) => {
        return total + (round.score || 0);
      }, 0);
    });
    
    // 計算輔分與名次
    const playersWithAuxScores = recomputeRanks(updatedPlayers);

    // 在計算完分數後，啟用「抓對」按鈕
    setIsPairingButtonDisabled(false);
    // 將此輪加入鎖定清單
    const nextScored = scoredRounds.includes(currentRound) ? scoredRounds : [...scoredRounds, currentRound];
    setScoredRounds(nextScored);

    // 線上模式：算分即同步鎖定該輪，伺服器拒收裁判再提交（規劃 §5）。
    // 立即推送求低延遲；失敗由輪詢的無狀態對帳在 ≤4 秒內自動補鎖（docs/online-score-sync-drift.md S2）
    if (onlineCfg) {
      onlineSync.lockRound(onlineCfg, currentRound)
        .catch(e => message.warning(`線上鎖定第 ${currentRound} 輪失敗（${e.message}），將自動重試`));
    }

    setPlayers(playersWithAuxScores);
  };

  // 桌次表匯出的五組（ABCDE）欄位：各組勝方以黑/白表示（對照同列的黑方/白方欄），
  // 加賽組附註「(加賽)」；末欄組數為 黑:白。輪空或無裁判回報（手動登錄）時留空。
  const GROUP_EXPORT_HEADERS = ['A組', 'B組', 'C組', 'D組', 'E組', '組數(黑:白)'];
  const groupExportCells = (match) => {
    if (!match.groups || match.player2 === 0) return ['', '', '', '', '', ''];
    const sideIsBlack = (w) => (w === 1) === !!match.player1IsBlack;
    const cells = match.groups.map(g => `${sideIsBlack(g.winner) ? '黑' : '白'}${g.overtime ? '(加賽)' : ''}`);
    const blackWins = match.groups.filter(g => sideIsBlack(g.winner)).length;
    return [...cells, `${blackWins}:${5 - blackWins}`];
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
        // 輪空（opponent=0）明確寫 0，空白保留給未出賽（棄賽後輪次）——
        // 與回歸測試 fixture 的解析規則一致（0＝輪空、空白＝棄賽）
        row.push(round.opponent != null ? round.opponent : '');
      }

      // 添加統計數據；棄賽隊不佔名次，名次欄標示「棄賽」
      row.push(player.totalScore, player.auxScore1, player.auxScore2, player.auxScore3,
        isWithdrawn(player) ? '棄賽' : player.rank);
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
        tableData = [['桌號', '黑方', '白方', '勝方', ...GROUP_EXPORT_HEADERS]];
        
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
          
          tableData.push([match.table, blackPlayer, whitePlayer, winner, ...groupExportCells(match)]);
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
    tableData.push(['桌號', '黑方', '白方', '勝方', ...GROUP_EXPORT_HEADERS]);
    
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
      
      tableData.push([match.table, blackPlayer, whitePlayer, winner, ...groupExportCells(match)]);
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
  const data = new Uint8Array(e.target.result as ArrayBuffer);
  
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
  const binaryString = Array.from(new Uint8Array(e.target.result as ArrayBuffer))
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
          (headers as any[]).forEach((header, index) => {
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
        ([
          { header: 'A', defval: '', raw: false },
          { defval: '', raw: false },
          { header: 1, defval: '', raw: false }
        ] as XLSX.Sheet2JSONOpts[]).some(options => {
          try {
            console.log(`嘗試工作表 ${sheetName} 使用選項:`, options);
          const tempData = XLSX.utils.sheet_to_json(worksheet, options);
          
        if (tempData.length > 0) {
          if (options.header === 1) {
              // 如果使用 header: 1，需要手動轉換
              const headers = tempData[0];
              jsonData = tempData.slice(1).map(row => {
              const obj = {};
              (headers as any[]).forEach((header, index) => {
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
      
      // 檢查是否找到了必要欄位（標頭驗證）
      console.log("檢查是否可找到必要欄位...");
      const sampleRow = jsonData[0];
      const headerKeys = Object.keys(sampleRow);
      // xlsx 對空標頭儲存格會自動命名為 __EMPTY、__EMPTY_1...，需排除
      const meaningfulHeaders = headerKeys.filter(k => k && !k.startsWith('__EMPTY'));
      console.log("偵測到的標頭:", headerKeys, "有效標頭:", meaningfulHeaders);

      const formatHint = '請確保 Excel 第一列為欄位標頭（不要先放標題列或空白列），且需包含「籤號」與「隊伍」兩個欄位，從第二列開始輸入資料。可接受的標頭名稱：籤號／編號／No、隊伍／隊名／團隊／名稱。';

      // 案例 1：整張表只有一欄（例如把籤號和隊伍寫在同一格）
      if (headerKeys.length < 2) {
        const onlyHeader = headerKeys[0] || '(空)';
        throw new Error(`Excel 僅偵測到一個欄位（${onlyHeader}）。請將「籤號」與「隊伍」分別放在不同欄位（例如 A 欄為籤號、B 欄為隊伍），不要寫在同一格。`);
      }

      // 案例 2：第一列完全沒有有效標頭（全部空白或非預期內容）
      if (meaningfulHeaders.length === 0) {
        throw new Error(`找不到欄位標頭。${formatHint}`);
      }

      // 嘗試找到籤號 / 隊伍欄位
      const possibleNumberField = numberFieldNames.find(fieldName =>
        meaningfulHeaders.includes(fieldName)
      );
      const possibleNameField = nameFieldNames.find(fieldName =>
        meaningfulHeaders.includes(fieldName)
      );

      console.log("可能的籤號欄位:", possibleNumberField);
      console.log("可能的隊伍欄位:", possibleNameField);

      // 案例 3：兩個必要欄位都找不到
      if (!possibleNumberField && !possibleNameField) {
        throw new Error(`找不到「籤號」與「隊伍」欄位標頭。目前偵測到的標頭：${meaningfulHeaders.join('、')}。${formatHint}`);
      }
      // 案例 4：只有籤號欄位
      if (!possibleNameField) {
        throw new Error(`找不到「隊伍」欄位標頭。目前偵測到的標頭：${meaningfulHeaders.join('、')}。請在第一列加入「隊伍」欄位（其他可接受名稱：隊名、團隊、名稱）。`);
      }
      // 案例 5：只有隊伍欄位
      if (!possibleNumberField) {
        throw new Error(`找不到「籤號」欄位標頭。目前偵測到的標頭：${meaningfulHeaders.join('、')}。請在第一列加入「籤號」欄位（其他可接受名稱：編號、No、序號）。`);
      }
      
      // 解析所有列，收集成功項目，再統一決定隊伍總數
      let fieldErrors = [];
      const parsedRows = []; // 成功解析的列：{ number, name, country, level }

      console.log("開始解析隊伍資料...");

      jsonData.forEach((row, rowIndex) => {
        // 獲取籤號（已驗證標頭存在，不再猜其他欄位）
        let numberValue = getValueByPossibleFieldNames(row, numberFieldNames);
        let number = NaN;
        if (numberValue !== null) {
          if (typeof numberValue === 'string') {
            numberValue = numberValue.replace(/[^0-9]/g, '');
          }
          number = parseInt(numberValue);
        }

        // 獲取隊伍名稱
        const name = getValueByPossibleFieldNames(row, nameFieldNames);

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
            newPlayers.push(createDefaultPlayer(i));
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
      message.error(`處理檔案時發生錯誤: ${error.message}請確認檔案格式是否正確。`);
    }
  };
  
  reader.onerror = (error) => {
    console.error('檔案讀取錯誤:', error);
    const errMsg = reader.error?.message || '未知錯誤';
    message.error(`讀取檔案時發生錯誤: ${errMsg}`);
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
    const allMatchesData = [['輪次', '桌號', '黑方', '白方', '勝方', ...GROUP_EXPORT_HEADERS]];
    
    // 按照輪次排序
    const sortedRounds = Object.keys(matchesByRound).map(Number).sort((a, b) => a - b);
    
    // 對每一輪的每一桌比賽
    sortedRounds.forEach(round => {
      const roundMatches = matchesByRound[round] || [];
      
      // 每輪的數據
      const roundData = [['桌號', '黑方', '白方', '勝方', ...GROUP_EXPORT_HEADERS]];
      
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
        roundData.push([match.table, blackPlayer, whitePlayer, winner, ...groupExportCells(match)]);
        
        // 添加到全部輪次數據
        allMatchesData.push([round, match.table, blackPlayer, whitePlayer, winner, ...groupExportCells(match)]);
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
      // 退賽隊一律沉到最後一區
      const aw = isWithdrawn(a) ? 1 : 0;
      const bw = isWithdrawn(b) ? 1 : 0;
      if (aw !== bw) return aw - bw;
      if (sortByRank) {
        // 退賽隊無正式名次（rank=null），彼此間依凍結分數（總分→輔分→籤號）排序
        if (aw === 1) return compareByScoreThenAux(a, b);
        return (a.rank ?? 9999) - (b.rank ?? 9999);
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
  const resetSystem = async () => {
    const ok = await dialog.confirm({
      title: '重設系統',
      message: '確定要重設系統嗎？\n所有輪次的桌次、比賽結果及選手資料將全部清除，此操作無法復原。',
      tone: 'error',
      danger: true,
      okText: '確定重設',
    });
    if (!ok) return;

    // 設置強制初始化標記，確保創建全新玩家資料
    setForceNewPlayers(true);
    
    // 重置所有數據
    initializePlayers(true); // 傳入 true 強制創建新的玩家數據
    setCurrentRound(1);
    setSortByRank(false);
    setAllowSameCountry(true);
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
  const unlockRound = async (round: number) => {
    const ok = await dialog.confirm({
      title: '解除輪次鎖定',
      message: `確定要解除第 ${round} 輪的鎖定嗎？\n解除後可重新修改結果，再按「算分」重新計算。`,
      tone: 'warn',
      okText: '解除鎖定',
    });
    if (!ok) return;
    const nextScored = scoredRounds.filter(r => r !== round);
    setScoredRounds(nextScored);
    setCurrentRound(round);
    setSelectedRound(round);
    setMatches(matchesByRound[round] || []);
    setIsPairingButtonDisabled(true); // 禁止重新抓對，直到重新算分

    // 線上模式：解除鎖定同步到後端，裁判端恢復可更正。立即推送求低延遲；
    // 失敗時警示（F2）並由輪詢的無狀態對帳自動補送——對帳以後端回報的各輪 status 為準，
    // 重載後也能看見「後端 locked、本機未算分」而自癒（docs/online-score-sync-drift.md §7 F1/S4）
    if (onlineCfg) {
      onlineSync.unlockRoundRemote(onlineCfg, round)
        .catch(e => message.warning(`線上解除鎖定第 ${round} 輪失敗（${e.message}），將自動重試；成功前裁判端仍被擋`));
    }
  };

  // ── 線上成績回報：輪詢與套用（規格 §5；所有邏輯以 onlineCfg 存在為前提）──

  // 輪詢 handler 透過 ref 呼叫「當次 render 的新函式」，避免 interval 閉包吃到舊 state
  const processJudgeResultsRef = useRef<(rows: onlineSync.JudgeResultRow[]) => Promise<void>>();
  // 正在跳確認視窗的桌次，避免同一筆更正重複開窗
  const revisionPromptOpen = useRef<Set<string>>(new Set());

  // 批次套用裁判回報（functional update：同一次輪詢多筆結果不互相蓋寫）。
  // groups = 五組（ABCDE）明細，一併存進 match 供桌次表 Excel 匯出
  const applyJudgeWins = (wins: { roundNo: number; tableNo: number; winnerNumber: number; groups: onlineSync.GroupResult[] | null }[]) => {
    if (!wins.length) return;
    setMatchesByRound(prev => {
      const next = { ...prev };
      for (const w of wins) {
        const arr = [...(next[w.roundNo] || [])];
        const idx = arr.findIndex((m: any) => m.table === w.tableNo);
        if (idx === -1) continue;
        const m = { ...arr[idx] };
        if (m.player2 === 0) continue; // 輪空桌不會發佈，防禦性略過
        m.player1Score = m.player1 === w.winnerNumber ? winPoint : 0;
        if (w.groups) m.groups = w.groups;
        arr[idx] = m;
        next[w.roundNo] = arr;
      }
      return next;
    });
    setJudgeApplyTick(t => t + 1);
  };

  // matches（當前輪視圖）跟上 matchesByRound 的裁判回報更新
  useEffect(() => {
    if (!judgeApplyTick) return;
    setMatches(matchesByRound[currentRound] || []);
  }, [judgeApplyTick]);

  const processJudgeResults = async (rows: onlineSync.JudgeResultRow[]) => {
    const autoWins: { roundNo: number; tableNo: number; winnerNumber: number; groups: onlineSync.GroupResult[] | null }[] = [];
    const reportMarks: Record<string, { version: number; winner: number; dismissed?: boolean }> = {};
    const conflicts: { row: onlineSync.JudgeResultRow; winnerNumber: number; localWinner: number | null }[] = [];

    for (const row of rows) {
      const key = `${row.round_no}-${row.table_no}`;
      const known = judgeReports[key];
      if (known && known.version >= row.version) continue;      // 這個版本已處理（採計或拒絕）過
      if (scoredRounds.includes(row.round_no)) continue;         // 本地已算分鎖定，不動既有結果
      const match = (matchesByRound[row.round_no] || []).find((m: any) => m.table === row.table_no);
      if (!match || match.player2 === 0) continue;
      // 桌次重發過（本地選手與回報不一致）→ 忽略舊回報
      if (match.player1 !== row.player1_id || match.player2 !== row.player2_id) continue;

      const winnerNumber = row.result === 1 ? match.player1 : match.player2;
      const localRecorded = match.player1Score !== undefined;
      const localWinner = localRecorded ? (match.player1Score === winPoint ? match.player1 : match.player2) : null;

      if (localRecorded && localWinner === winnerNumber) {
        // 桌勝方一致：組明細（ABCDE）有更新就靜默帶入——不影響排名，不跳警示；
        // 稽核在伺服器端已留 revision 紀錄
        const groupsChanged = JSON.stringify(match.groups ?? null) !== JSON.stringify(row.groups ?? null);
        if (groupsChanged) autoWins.push({ roundNo: row.round_no, tableNo: row.table_no, winnerNumber, groups: row.groups });
        reportMarks[key] = { version: row.version, winner: winnerNumber };
      } else if (localRecorded || (known && !known.dismissed)) {
        conflicts.push({ row, winnerNumber, localWinner });                // 桌勝方改變 → 需操作者確認（4.3）
      } else {
        autoWins.push({ roundNo: row.round_no, tableNo: row.table_no, winnerNumber, groups: row.groups });
        reportMarks[key] = { version: row.version, winner: winnerNumber };
      }
    }

    applyJudgeWins(autoWins);
    if (Object.keys(reportMarks).length) setJudgeReports(prev => ({ ...prev, ...reportMarks }));

    // 衝突逐筆確認：revision（已送出又被更改）一律醒目警示，採計與否都記版本避免重複跳窗
    for (const c of conflicts) {
      const key = `${c.row.round_no}-${c.row.table_no}`;
      if (revisionPromptOpen.current.has(key)) continue;
      revisionPromptOpen.current.add(key);
      try {
        // 附上五組比數讓操作者好判斷（如 3:2、B組加賽）
        const wins1 = (c.row.groups || []).filter(g => g.winner === 1).length;
        const otLabels = (c.row.groups || [])
          .map((g, i) => (g.overtime ? 'ABCDE'[i] : null)).filter(Boolean).join('、');
        const groupsNote = c.row.groups
          ? `（五組 ${c.row.result === 1 ? wins1 : 5 - wins1}:${c.row.result === 1 ? 5 - wins1 : wins1}${otLabels ? `，${otLabels}組加賽` : ''}）`
          : '';
        const ok = await dialog.confirm({
          title: '裁判回報更正',
          message: `第 ${c.row.round_no} 輪・桌 ${c.row.table_no}：裁判回報勝方為「${getPlayerName(c.winnerNumber)}」${groupsNote}，` +
            `與目前登錄（${c.localWinner != null ? `「${getPlayerName(c.localWinner)}」勝` : '未登錄'}）不同。\n要採計裁判的回報嗎？`,
          tone: 'warn',
          danger: true,
          okText: '採計裁判回報',
          cancelText: '維持現狀',
        });
        if (ok) {
          applyJudgeWins([{ roundNo: c.row.round_no, tableNo: c.row.table_no, winnerNumber: c.winnerNumber, groups: c.row.groups }]);
          setJudgeReports(prev => ({ ...prev, [key]: { version: c.row.version, winner: c.winnerNumber } }));
        } else {
          setJudgeReports(prev => ({ ...prev, [key]: { version: c.row.version, winner: c.winnerNumber, dismissed: true } }));
          // 記到伺服器讓裁判頁顯示「更正未被採計，請洽計分台」；
          // 失敗只影響裁判端提示（409 = 裁判又送了新版本，下次輪詢會重新判斷），不擋主控操作
          if (onlineCfg) {
            onlineSync.rejectJudgeResult(onlineCfg, c.row.round_no, c.row.table_no, c.row.version)
              .catch(() => { /* 見上：非關鍵路徑 */ });
          }
        }
      } finally {
        revisionPromptOpen.current.delete(key);
      }
    }
  };
  processJudgeResultsRef.current = processJudgeResults;

  // ── P0.1 鎖定狀態無狀態對帳（docs/online-score-sync-drift.md §3 P0、§7 P0.1；修 S1–S4、F1/F2/F5）──
  // 以本機 scoredRounds 為權威：每次成績輪詢後端會一併回傳各輪 status（rounds），
  // 逐輪 diff「後端 status ↔ 本機 desired（已算分 ⇔ locked）」，只推送不一致者。
  // 不維護任何跨呼叫的客端狀態鏡像——P0 初版的 confirmed Map＋known Set 在重載後失憶，
  // 造成「解鎖失敗後重載 → 後端永久 locked」（F1）；改讀後端真實狀態後，重載後首次輪詢即自癒。
  // 後端 lock/unlock 為冪等 upsert，重複推送無副作用；推送失敗的輪次進 lockSyncPending
  // （lock 與 unlock 方向都涵蓋，F2），面板顯示「鎖定同步中」、下次輪詢自動重試。
  const reconcilingRef = useRef(false);
  const reconcileRoundLocks = async (
    cfg: onlineSync.SyncConfig, scored: number[], backendRounds: onlineSync.RoundStatusRow[],
  ) => {
    if (reconcilingRef.current) return;        // 前一輪對帳（最長 8 秒逾時）未結束就跳過，避免重入
    reconcilingRef.current = true;
    try {
      const scoredSet = new Set(Array.isArray(scored) ? scored : []);
      const status = new Map(backendRounds.map(r => [r.round_no, r.status]));
      // 該鎖未鎖：本機已算分、後端非 locked（含後端還沒有該輪 row 的 S1 情形，upsert 會補建）
      const toLock = [...scoredSet].filter(r => status.get(r) !== 'locked');
      // 該解未解：後端 locked、本機未算分（F1 的自癒路徑：重載後第一次輪詢就會走到這裡）
      const toUnlock = [...status.keys()].filter(r => status.get(r) === 'locked' && !scoredSet.has(r));
      const pending: number[] = [];
      for (const r of toLock) {
        try { await onlineSync.lockRound(cfg, r); } catch { pending.push(r); }
      }
      for (const r of toUnlock) {
        try { await onlineSync.unlockRoundRemote(cfg, r); } catch { pending.push(r); }
      }
      pending.sort((a, b) => a - b);
      setLockSyncPending(prev =>
        prev.length === pending.length && prev.every((v, i) => v === pending[i]) ? prev : pending);
    } finally {
      reconcilingRef.current = false;
    }
  };
  // 每次 render 重新綁定，讓輪詢閉包吃到最新的 onlineCfg / scoredRounds
  const reconcileLocksRef = useRef<(rounds: onlineSync.RoundStatusRow[]) => Promise<void>>();
  reconcileLocksRef.current = async (rounds) => { if (onlineCfg) await reconcileRoundLocks(onlineCfg, scoredRounds, rounds); };

  // 成績輪詢（4 秒；規劃 §2 規模下輪詢已足夠）
  useEffect(() => {
    if (!onlineCfg) { setOnlineLastSync(null); setOnlineError(null); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const { results: rows, rounds } = await onlineSync.fetchResults(onlineCfg);
        if (cancelled) return;
        setOnlineError(null);
        setOnlineLastSync(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
        await processJudgeResultsRef.current?.(rows);
        await reconcileLocksRef.current?.(rounds);   // 每次輪詢以後端回報的各輪 status 對帳到本機權威
      } catch (e: any) {
        if (!cancelled) setOnlineError(e.message === 'unauthorized' ? '賽事已結束或憑證失效' : `連線失敗：${e.message}`);
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [onlineCfg]);

  // 各桌狀態輪詢（面板開著才跑，10 秒一次）
  useEffect(() => {
    if (!showOnlinePanel || !onlineCfg) return;
    let cancelled = false;
    const tick = () => onlineSync.fetchTablesStatus(onlineCfg)
      .then(t => { if (!cancelled) setTablesStatus(t); })
      .catch(() => { if (!cancelled) setTablesStatus(null); });
    tick();
    const id = setInterval(tick, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [showOnlinePanel, onlineCfg]);

  // 建立線上賽事：桌數 = ceil(隊數/2)（含可能的輪空桌，桌號與桌次表一致）
  const createOnlineEvent = async () => {
    const apiBase = onlineApiDraft.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/.+/.test(apiBase)) {
      message.warning('請先輸入後端 API 網址（如 https://wgp-score-relay.xxx.workers.dev）');
      return;
    }
    const tables = Math.ceil(allPlayers / 2);
    const setupKey = onlineKeyDraft.trim();
    try {
      const cfg = await onlineSync.createEvent(apiBase, gameTitle, tables, setupKey);
      onlineSync.saveSyncConfig(cfg);
      setOnlineCfg(cfg);
      setJudgeReports({});
      // 「建立賽事前已在本機算分鎖定」的輪次（S1）由成績輪詢的無狀態對帳同步：
      // setOnlineCfg 觸發輪詢 effect 立即 tick，首次對帳就會補鎖，毋須在此另行推送
      try { localStorage.setItem('wgpOnlineSetupKey', setupKey); } catch { /* 存不進去下次再輸入 */ }
      message.success(`線上賽事已建立（${tables} 桌）。請按「列印 QR 卡」交給計分台保管，裁判報到時當面掃碼。`);
    } catch (e: any) {
      message.error(e.message === 'setup_key_required'
        ? '建立金鑰錯誤或未填。請輸入部署後端時設定的建立金鑰（SETUP_KEY）。'
        : `建立線上賽事失敗：${e.message}`);
    }
  };

  // 發佈本輪桌次（輪空桌不發佈，由主控端照現行邏輯處理；規劃 §6）
  const publishCurrentRoundPairings = async () => {
    if (!onlineCfg) return;
    const roundMatches = matchesByRound[currentRound] || [];
    if (!roundMatches.length) {
      message.warning(`第 ${currentRound} 輪尚未抓對，無桌次可發佈`);
      return;
    }
    const pairings = roundMatches
      .filter((m: any) => m.player2 !== 0)
      .map((m: any) => ({
        tableNo: m.table,
        player1Id: m.player1, player1Name: getPlayerName(m.player1),
        player2Id: m.player2, player2Name: getPlayerName(m.player2),
      }));
    try {
      await onlineSync.publishPairings(onlineCfg, currentRound, pairings);
      // 發佈會把該輪 status 重設為 open；若本輪本機已算分（少見，但如重發舊輪），
      // 立即補鎖回來以免出現「已鎖輪次在後端變 open」的空窗（docs/online-score-sync-drift.md）；
      // 失敗由輪詢對帳 ≤4 秒內補上
      if (scoredRounds.includes(currentRound)) {
        onlineSync.lockRound(onlineCfg, currentRound).catch(() => { /* 留待輪詢對帳補鎖 */ });
      }
      // 重發同一輪時伺服器 pairings 整輪刪除重建、version 歸 0；本輪已處理紀錄一併清掉，
      // 否則舊 version 會在 processJudgeResults 把新配對的回報永遠擋掉
      setJudgeReports(prev => {
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) {
          if (!k.startsWith(`${currentRound}-`)) next[k] = v;
        }
        return next;
      });
      message.success(`已發佈第 ${currentRound} 輪桌次（${pairings.length} 桌），裁判手機數秒內會更新`);
    } catch (e: any) {
      message.error(e.message === 'round_locked'
        ? `第 ${currentRound} 輪在伺服器上為鎖定狀態，請先解除鎖定再發佈`
        : `發佈桌次失敗：${e.message}`);
    }
  };

  // 結束線上賽事：伺服器資料立即刪除、token 全數失效（個資最小化；規劃 §3）
  const closeOnlineEvent = async () => {
    if (!onlineCfg) return;
    const ok = await dialog.confirm({
      title: '結束線上賽事',
      message: '確定要結束線上賽事嗎？\n伺服器上的配對、回報與稽核資料將立即刪除，所有 QR 卡隨之失效。\n（本機的比賽資料不受影響）',
      tone: 'warn',
      danger: true,
      okText: '結束並刪除',
    });
    if (!ok) return;
    try {
      await onlineSync.closeEvent(onlineCfg);
      message.success('線上賽事已結束，伺服器資料已刪除');
    } catch (e: any) {
      // 憑證已失效（多半是已被結束過）→ 照樣清掉本機設定
      if (e.message !== 'unauthorized') {
        message.error(`結束線上賽事失敗：${e.message}`);
        return;
      }
    }
    onlineSync.saveSyncConfig(null);
    setOnlineCfg(null);
    setTablesStatus(null);
    setJudgeReports({});
    setLockSyncPending([]);
  };

  // 列印裁判 QR 卡（印出後由計分台保管——卡片上有註記；規劃 4.1）
  const printQrCards = async () => {
    if (!onlineCfg) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
    const cards = await Promise.all(onlineCfg.tableTokens.map(async t => ({
      tableNo: t.tableNo,
      dataUrl: await QRCode.toDataURL(onlineSync.judgeUrl(onlineCfg, t), { width: 240, margin: 1 }),
    })));
    const w = window.open('', '_blank');
    if (!w) {
      message.error('瀏覽器擋下了彈出視窗，請允許本站開新視窗後再試一次');
      return;
    }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>裁判 QR 卡 — ${esc(onlineCfg.eventName)}</title>
<style>
  body{font-family:system-ui,-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;margin:0;padding:16px;}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;}
  .card{border:1.5px dashed #999;border-radius:12px;padding:16px;text-align:center;page-break-inside:avoid;}
  .t{font-size:28px;font-weight:800;margin-bottom:2px;}
  .e{font-size:14px;color:#555;margin-bottom:8px;}
  .warn{font-size:12px;color:#a33;margin-top:8px;line-height:1.6;}
</style></head><body><div class="grid">${cards.map(c => `
  <div class="card">
    <div class="t">桌 ${c.tableNo}</div>
    <div class="e">${esc(onlineCfg.eventName)} · 裁判成績回報</div>
    <img src="${c.dataUrl}" width="240" height="240"/>
    <div class="warn">本卡由<b>計分台</b>保管，不上桌、不隨身帶。<br/>裁判報到時當面掃碼，掃完即收回。</div>
  </div>`).join('')}</div><script>window.onload = () => window.print();</script></body></html>`);
    w.document.close();
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

    // 檢查2（hard）：有選手未排入本輪（該輪已棄賽的隊本來就不在桌次中，不視為錯誤）
    players.filter(p => isActiveForRound(p, round)).forEach(p => {
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
            <div className="flex-1 flex flex-col sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-subtle)] min-w-0">
              <div className="px-2 py-1.5">{renderSelect(match.player1, true)}</div>
              <div className="px-3 py-1 sm:py-1.5 text-center flex-shrink-0">
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
              <Pill tone="muted" size="sm" className="w-12 justify-center tabular flex-shrink-0">#{p1?.number}</Pill>
              <FitText
                text={p1?.name || ''}
                maxFontPx={20}
                minFontPx={14}
                className="flex-1 font-semibold"
                title={p1?.name}
              />
              <Pill tone="accent" size="sm" className="flex-shrink-0">輪空勝</Pill>
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
            <Pill tone="muted" size="sm" className="w-12 justify-center tabular flex-shrink-0">#{player.number}</Pill>
            <FitText
              text={player.name}
              maxFontPx={20}
              minFontPx={14}
              className={`flex-1 font-semibold ${isWinner ? 'text-[var(--win)]' : ''}`}
              title={player.name}
            />
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

    // 線上模式：此桌結果採計自裁判回報時顯示來源標示
    const judgeReported = onlineCfg && recorded &&
      judgeReports[`${round}-${match.table}`] && !judgeReports[`${round}-${match.table}`].dismissed;
    // 五組（ABCDE）明細：裁判回報帶入後顯示組數比，hover 看各組勝方與加賽註記
    const groupsDetail: onlineSync.GroupResult[] | undefined = match.groups;
    const gWins1 = groupsDetail ? groupsDetail.filter(x => x.winner === 1).length : 0;
    const groupsTitle = groupsDetail
      ? groupsDetail.map((x, i) =>
          `${'ABCDE'[i]} 組：${getPlayerName(x.winner === 1 ? match.player1 : match.player2)} 勝${x.overtime ? '（加賽）' : ''}`
        ).join('\n')
      : '';

    return (
      <div className="elevated rounded-lg overflow-hidden relative">
        {(judgeReported || groupsDetail) && (
          <span className="absolute top-0.5 right-0.5 z-10 flex items-center gap-1">
            {groupsDetail && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono-num tabular"
                title={groupsTitle}
              >{gWins1}:{5 - gWins1}{groupsDetail.some(x => x.overtime) ? '·含加賽' : ''}</span>
            )}
            {judgeReported && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--info-soft)] text-[var(--info)] font-medium"
                title="此結果由裁判線上回報"
              >裁判</span>
            )}
          </span>
        )}
        <div className="flex items-stretch">
          {TableCell}
          <div className="flex-1 flex flex-col sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-subtle)] min-w-0">
            {renderSide(p1, p1Won, () => recordResult(matchIndex, match.player1, round))}
            <div className="px-4 py-1 sm:py-4 text-center flex-shrink-0">
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

  // 勝負紀錄條：每輪一格對戰方塊 — 顯示對手隊名前兩字，hover 顯示完整對戰資訊
  // 顏色：勝=實心綠、負=淺紅、輪空勝=灰、進行中=藍（虛線框）、未開始=空框
  const RecordBar = ({ player }: { player: any }) => {
    const oppName = (n: number) => players.find(p => p.number === n)?.name || `選手${n}`;
    // 縮寫規則：取前兩字；隊名 5 字以上時再附上隊名中最後一個英文字母（分隊尾碼）
    // 例：「建國中學A」→「建國A」、「建國中學」→「建國」；用 Array.from 切字避免特殊字元被切壞
    const abbrev = (s: string) => {
      const chars = Array.from(s.trim());
      const head = chars.slice(0, 2).join('');
      if (chars.length >= 5) {
        for (let j = chars.length - 1; j >= 0; j--) {
          if (/[A-Za-z]/.test(chars[j])) return head + chars[j];
        }
      }
      return head;
    };
    return (
      <div className="flex gap-1">
        {Array.from({ length: rounds }).map((_, i) => {
          const r = player.rounds[i] || {};
          const isScored = scoredRounds.includes(i + 1);
          const isCurrent = i + 1 === currentRound;
          let cls = 'border border-[var(--border-default)] text-[var(--text-disabled)]';
          let text = '—';
          let tip = `R${i + 1} 未開始`;
          if (isScored && r.score !== null && r.score !== undefined) {
            if (r.opponent === 0) {
              cls = 'bg-[var(--border-default)] text-[var(--text-secondary)]';
              text = '輪空'; tip = `R${i + 1} 輪空勝`;
            } else if (r.score > 0) {
              cls = 'bg-[var(--win)] text-[var(--win-contrast)]';
              text = abbrev(oppName(r.opponent)); tip = `R${i + 1} 勝 vs ${getPlayerName(r.opponent)}`;
            } else {
              cls = 'bg-[var(--loss-soft)] text-[var(--loss)]';
              text = abbrev(oppName(r.opponent)); tip = `R${i + 1} 負 vs ${getPlayerName(r.opponent)}`;
            }
          } else if (isCurrent) {
            // 進行中：player.rounds 要算分才有對手，先從本輪桌次表撈目前配對
            const m = (matchesByRound[i + 1] || []).find(
              (mm: any) => mm.player1 === player.number || mm.player2 === player.number
            );
            const opp = m ? (m.player1 === player.number ? m.player2 : m.player1) : null;
            cls = 'bg-[var(--info-soft)] text-[var(--info)] border border-dashed border-[color-mix(in_oklab,var(--info)_45%,transparent)]';
            if (opp === null) { text = ''; tip = `R${i + 1} 進行中`; }
            else if (opp === 0) { text = '輪空'; tip = `R${i + 1} 進行中・本輪輪空`; }
            else { text = abbrev(oppName(opp)); tip = `R${i + 1} 進行中 vs ${getPlayerName(opp)}`; }
          }
          return (
            <span key={i} data-tip={tip}
              className={`tip-host w-14 h-8 px-1 rounded-md inline-flex items-center justify-center text-base font-semibold whitespace-nowrap ${cls}`}
            >{text}</span>
          );
        })}
      </div>
    );
  };

  // 緊湊視圖：前三名突顯卡片 + 其他列表
  const renderCompactStandings = (sortedPlayers: any[]) => {
    const hasRanking = sortedPlayers.length > 0 && sortedPlayers[0].rank;
    // 突顯卡只給在賽隊伍：getSortedPlayers 已把棄賽隊沉底，取前段在賽隊即可；
    // 在賽隊不足 3 隊時卡片數跟著減少，棄賽隊一律進「其他」列表（該處才有棄賽樣式）
    const activeCount = sortedPlayers.filter(p => !isWithdrawn(p)).length;
    const top3 = hasRanking && sortByRank ? sortedPlayers.slice(0, Math.min(3, activeCount)) : [];
    const rest = hasRanking && sortByRank ? sortedPlayers.slice(top3.length) : sortedPlayers;

    return (
      <div className="p-3 space-y-3">
        {top3.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] px-2 font-semibold">領先三隊</div>
            {top3.map(p => {
              const accent = p.rank === 1 ? 'border-[oklch(0.82_0.15_90_/_0.5)] bg-[oklch(0.82_0.15_90_/_0.04)]'
                          : p.rank === 2 ? 'border-[oklch(0.82_0.02_250_/_0.4)]'
                          : 'border-[oklch(0.70_0.13_55_/_0.4)]';
              // 單行版型：與「其他」列共用欄位結構（名次 w-7｜籤號 w-7｜隊名 flex｜方塊｜分數 w-16）
              // px-[7px]+1px 邊框 = 下方列的 px-2，讓方塊與分數欄上下對齊
              return (
                <div key={p.number} className={`elevated rounded-lg px-[7px] py-2.5 border ${accent} flex items-center gap-3`}>
                  <span className="w-7 flex justify-center flex-shrink-0"><RankMedal rank={p.rank}/></span>
                  <span className="font-mono-num text-xs text-[var(--text-disabled)] w-7 tabular flex-shrink-0">#{p.number}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {editMode
                      ? <input type="text" value={p.name} onChange={e => handlePlayerNameChange(p.number, e.target.value)} className="px-2 h-8 text-base font-semibold flex-1"/>
                      : <div className="font-bold text-2xl truncate" title={p.name}>{p.name}</div>
                    }
                    {editMode && <WithdrawButton player={p} onToggle={handleToggleWithdraw}/>}
                  </div>
                  <RecordBar player={p}/>
                  <div className="text-right flex-shrink-0 w-16">
                    <div className="font-mono-num text-2xl font-bold text-[var(--text-primary)] leading-none tabular">{p.totalScore}</div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-1 tabular tracking-wide">
                      輔 <span className="font-mono-num font-semibold text-[var(--text-secondary)]">{p.auxScore1}</span>
                      {'·'}
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
              <div key={p.number} className={`flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors ${isWithdrawn(p) ? 'opacity-55' : ''}`}>
                <span className="font-mono-num text-sm font-semibold text-[var(--text-secondary)] w-7 text-center tabular">{isWithdrawn(p) ? '—' : (p.rank || '—')}</span>
                <span className="font-mono-num text-xs text-[var(--text-disabled)] w-7 tabular">#{p.number}</span>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  {editMode
                    ? <input type="text" value={p.name} onChange={e => handlePlayerNameChange(p.number, e.target.value)} className="px-2 h-8 text-base flex-1"/>
                    : <div className={`text-xl font-medium truncate ${isWithdrawn(p) ? 'line-through' : ''}`} title={p.name}>{p.name}</div>
                  }
                  {isWithdrawn(p) && <Pill tone="muted" size="sm">棄賽</Pill>}
                  {editMode && <WithdrawButton player={p} onToggle={handleToggleWithdraw}/>}
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
      <table className="grid-table w-full text-base">
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
            <tr key={p.number} className={isWithdrawn(p) ? 'opacity-55' : ''}>
              <td className="px-3 py-1.5"><RankMedal rank={isWithdrawn(p) ? undefined : p.rank}/></td>
              <td className="px-2 py-1.5 font-mono-num text-base text-[var(--text-muted)]">#{p.number}</td>
              <td className="px-2 py-1.5 max-w-40">
                <div className="flex items-center gap-2 min-w-0">
                  {editMode
                    ? <input type="text" value={p.name} onChange={e => handlePlayerNameChange(p.number, e.target.value)} className="px-2 h-8 text-base w-full"/>
                    : <span className={`font-semibold text-lg block truncate ${isWithdrawn(p) ? 'line-through' : ''}`} title={p.name}>{p.name}</span>
                  }
                  {isWithdrawn(p) && <Pill tone="muted" size="sm">棄賽</Pill>}
                  {editMode && <WithdrawButton player={p} onToggle={handleToggleWithdraw}/>}
                </div>
              </td>
              <td className="px-2 py-1.5 text-center font-mono-num font-bold text-xl tabular col-total">{p.totalScore}</td>
              <td className="px-2 py-1.5 text-center font-mono-num text-[var(--text-secondary)] tabular col-aux">{p.auxScore1}</td>
              <td className="px-2 py-1.5 text-center font-mono-num text-[var(--text-secondary)] tabular col-aux">{p.auxScore2}</td>
              <td className="px-2 py-1.5 text-center font-mono-num text-[var(--text-secondary)] tabular col-aux">{p.auxScore3}</td>
              {Array.from({ length: rounds }).map((_, i) => {
                const r = p.rounds[i] || { score: null, opponent: null };
                const isScored = scoredRounds.includes(i + 1);
                return (
                  <td key={i} className="px-1 py-1.5 text-center text-sm">
                    {isScored && r.score !== null ? (
                      <div
                        className="flex flex-col items-center tip-host"
                        data-tip={r.opponent === 0 ? undefined : `vs ${getPlayerName(r.opponent)}`}
                      >
                        <span className={`font-mono-num font-bold text-lg leading-tight ${r.score > 0 ? 'text-[var(--win)]' : 'text-[var(--loss)]'}`}>{r.score}</span>
                        <span className="text-xs text-[var(--text-muted)]">{r.opponent === 0 ? '輪空' : `vs ${r.opponent}`}</span>
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
            <span className="hidden lg:contents">
              <Button onClick={() => setProjectionMode('standings')} title="投影名次表" className="whitespace-nowrap">
                <Icon name="monitor" className="w-4 h-4"/> 投影
              </Button>
            </span>
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
            <span className="hidden lg:contents">
              <Button onClick={() => setProjectionMode('tables')} disabled={total === 0} title="投影桌次表" className="whitespace-nowrap">
                <Icon name="monitor" className="w-4 h-4"/> 投影
              </Button>
            </span>
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
    // 堆疊版字級：以單行高（卡高扣 padding 與分隔線再除 2）與卡寬推算
    const lineH = Math.max(24, (tablesRowH - 32) / 2);
    const nameMaxFont = Math.min(80, Math.max(22, Math.round(Math.min(tablesCardWidth * 0.10, lineH * 0.8))));
    // 下限抓上限一半：長隊名（英文全名）優先縮小塞完整，仍塞不下才截斷
    const nameMinFont = Math.max(15, Math.round(nameMaxFont * 0.5));
    // 桌次號碼是全場掃視重點，跨兩行置中、字級最大
    const tableNumFont = Math.min(96, Math.max(36, Math.round(tablesRowH * 0.4)));
    const tableLabelFont = Math.max(12, Math.round(tableNumFont * 0.3));
    const pillFont = Math.min(52, Math.max(18, Math.round(lineH * 0.58)));

    return (
      <div className="flex-1 flex flex-col items-center px-6 pt-6 pb-5 overflow-hidden min-h-0 standings-stage">
        <div className="text-center mb-4 flex-shrink-0">
          <div className="text-[10px] tracking-[0.4em] text-[var(--accent)] font-medium mb-2">WGP TOURNAMENT</div>
          <h1 className="text-5xl font-bold tracking-tight">{gameTitle}</h1>
          <div className="mt-2 text-2xl text-[var(--text-secondary)] tracking-wide">第 {selectedRound} 輪 · 桌次表</div>
          <div className="mt-3 mx-auto w-20 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent"></div>
        </div>
        {total === 0 ? (
          <div className="flex-1 flex items-center justify-center text-3xl text-[var(--text-muted)]">尚未生成桌次表</div>
        ) : (
          <div
            ref={tablesLayoutRef}
            className="flex-1 w-full min-h-0 overflow-hidden grid content-center justify-center"
            style={{
              gridTemplateColumns: `repeat(${tablesCols}, ${tablesCardWidth}px)`,
              gridTemplateRows: `repeat(${tablesRowsPerCol}, ${tablesRowH}px)`,
              gridAutoFlow: 'column',
              columnGap: '20px',
              rowGap: '10px',
            }}
          >
            {matchesForRound.map((m: any, mi: number) => {
              const isBye = m.player2 === 0;
              const isOdd = m.table % 2 === 1;
              // 對照排行榜：from-[色/透明度] to-transparent + 同色 border
              // 透明度/邊框比排行榜濃一級：投影機色彩衰減大，淡色帶會直接消失
              const cardClass = isBye
                ? 'bg-gradient-to-r from-[oklch(0.85_0.02_250_/_0.28)] to-transparent border-[oklch(0.70_0.02_250_/_0.50)]'
                : isOdd
                ? 'bg-gradient-to-r from-[oklch(0.78_0.14_85_/_0.32)] to-transparent border-[oklch(0.70_0.15_85_/_0.65)]'   /* 暖琥珀 */
                : 'bg-gradient-to-r from-[oklch(0.72_0.13_240_/_0.28)] to-transparent border-[oklch(0.58_0.14_240_/_0.60)]'; /* 冷藍 */
              const numColor = isBye
                ? 'text-[var(--text-muted)]'
                : isOdd
                ? 'text-[var(--proj-table-odd)]'
                : 'text-[var(--proj-table-even)]';
              // 隊伍編號：純數字不加膠囊框（Pill 的圓角底在投影上是多餘視覺元素）
              const seedColor = isBye ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]';
              return (
                <div key={mi} className={`flex items-center gap-4 px-5 py-2.5 rounded-xl border-2 h-full ${cardClass}`} style={{ width: `${tablesCardWidth}px` }}>
                  {/* 桌號跨兩行垂直置中，「桌」標籤放數字左側 */}
                  <div className="flex items-center justify-center gap-1.5 flex-shrink-0" style={{ minWidth: `${Math.ceil(tableNumFont * 1.5)}px` }}>
                    <div className="text-[var(--text-secondary)] leading-none" style={{ fontSize: `${tableLabelFont}px` }}>桌</div>
                    <div className={`font-mono-num font-extrabold leading-none tabular ${numColor}`} style={{ fontSize: `${tableNumFont}px` }}>{isBye ? '—' : m.table}</div>
                  </div>
                  {/* 兩隊上下堆疊（結構參考 screenshot/投影參考.png）：每隊獨佔一行，
                      隊名擁有整行寬度不再與對手搶空間；輪空放在對手那一行 */}
                  <div className="flex-1 min-w-0 self-stretch flex flex-col justify-center">
                    <div className="flex-1 min-h-0 flex items-center gap-3 min-w-0">
                      <span className={`inline-flex justify-center items-center tabular font-bold flex-shrink-0 ${seedColor}`} style={{ fontSize: `${pillFont}px`, minWidth: `${Math.ceil(pillFont * 2.2)}px` }}>{m.player1}</span>
                      <FitText
                        text={nameOf(m.player1)}
                        maxFontPx={nameMaxFont}
                        minFontPx={nameMinFont}
                        className={`flex-1 font-extrabold${isBye ? ' text-[var(--text-secondary)]' : ''}`}
                      />
                    </div>
                    <div className="flex-1 min-h-0 flex items-center gap-3 min-w-0 border-t border-[var(--border-default)]">
                      {isBye ? (
                        <Pill tone="muted" size="md" style={{ fontSize: `${pillFont}px` }}>輪空</Pill>
                      ) : (
                        <>
                          <span className={`inline-flex justify-center items-center tabular font-bold flex-shrink-0 ${seedColor}`} style={{ fontSize: `${pillFont}px`, minWidth: `${Math.ceil(pillFont * 2.2)}px` }}>{m.player2}</span>
                          <FitText
                            text={nameOf(m.player2)}
                            maxFontPx={nameMaxFont}
                            minFontPx={nameMinFont}
                            className="flex-1 font-extrabold"
                          />
                        </>
                      )}
                    </div>
                  </div>
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
    // 在賽隊依名次排，棄賽隊沉底、彼此間依凍結分數排（與名次表頁的排序一致）
    const sorted = [
      ...players.filter(p => !isWithdrawn(p)).sort((a, b) => (a.rank || 9999) - (b.rank || 9999)),
      ...players.filter(p => isWithdrawn(p)).sort(compareByScoreThenAux),
    ];
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
            const wd = isWithdrawn(p);
            const isTop3 = !wd && (p.rank || 99) <= 3;
            const cardClass = wd ? 'elevated opacity-55' :
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
                  <div className={`font-mono-num font-bold tabular leading-none ${isTop3 ? 'text-3xl' : 'text-2xl text-[var(--text-secondary)]'}`}>{wd ? '—' : (p.rank || '—')}</div>
                  {wd
                    ? <div className="text-xs text-[var(--text-muted)] mt-1">棄賽</div>
                    : p.rank && p.rank <= 4 && <div className="text-xs text-[var(--text-muted)] mt-1">{labels[p.rank - 1]}</div>}
                </div>
                <Pill tone="muted" size="md" className="w-16 justify-center tabular flex-shrink-0">#{p.number}</Pill>
                <div className="flex-1 min-w-0">
                  <FitText
                    text={p.name}
                    maxFontPx={isTop3 ? 48 : 36}
                    minFontPx={isTop3 ? 28 : 22}
                    className={`font-bold ${wd ? 'line-through' : ''}`}
                  />
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
    <div className="min-h-[100dvh] md:h-screen flex flex-col p-3 gap-3">
      {/* ─── Header（可摺疊） ─────────────────────────────── */}
      {(() => {
        const existingRounds = Object.keys(matchesByRound).map(r => parseInt(r, 10));
        const isCurrentScored = scoredRounds.includes(currentRound);
        const isCurrentPaired = existingRounds.includes(currentRound);
        const allDone = scoredRounds.length >= rounds;
        // 比賽是否已開始：任一輪已生成桌次或已算分。用於鎖定影響計分的設定欄位（參賽隊伍 / 輪數 / 勝方得分）
        const tournamentStarted = existingRounds.length > 0 || scoredRounds.length > 0;
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDrawLots}
              disabled={currentRound !== 1}
              className="btn-ghost px-3 h-9 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap"
              title={currentRound !== 1 ? '僅第 1 輪可抽籤' : '抽籤'}
            >
              <Icon name="dice" className="w-4 h-4"/> 抽籤
            </button>
            <button
              onClick={generatePairings}
              disabled={isPairingButtonDisabled}
              className="btn-primary px-4 h-9 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap"
            >
              <Icon name="swap" className="w-4 h-4"/> 抓對 R{currentRound}
            </button>
            <button
              onClick={calculateScores}
              disabled={!isPairingButtonDisabled}
              className={`px-4 h-9 rounded-md text-sm flex items-center gap-1.5 font-medium whitespace-nowrap
                ${isPairingButtonDisabled ? 'btn-success' : 'btn-ghost opacity-50 cursor-not-allowed'}`}
            >
              <Icon name="calculator" className="w-4 h-4"/> 算分
            </button>
            {onlineCfg && (
              <button
                onClick={publishCurrentRoundPairings}
                disabled={!(matchesByRound[currentRound] || []).length}
                className="btn-ghost px-3 h-9 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap"
                title="把本輪桌次上傳到線上回報後端，裁判手機掃碼後即可看到"
              >
                <Icon name="upload" className="w-4 h-4"/> 發佈桌次
              </button>
            )}
          </div>
        );

        return (
          <div className="surface rounded-xl flex-shrink-0">
            {/* 頂部品牌列 */}
            <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 py-2 md:py-0 md:h-12 border-b border-[var(--border-subtle)]">
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

              <div className="flex flex-wrap items-center gap-2">
                {/* 輪次燈號（可點切換當前輪次） */}
                <div className="flex items-center gap-1 md:mr-2">
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
                    className="btn-ghost px-2 sm:px-3 h-8 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap"
                    title="切換主題"
                    aria-haspopup="true"
                    aria-expanded={themePickerOpen}
                  >
                    <Icon name="palette" className="w-4 h-4"/> <span className="hidden sm:inline">主題</span>
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
                <button onClick={() => setShowAuxScoreHelp(true)} className="btn-ghost px-2 sm:px-3 h-8 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap" title="輔分說明">
                  <Icon name="help" className="w-4 h-4"/> <span className="hidden sm:inline">輔分說明</span>
                </button>
                <button onClick={() => setShowAboutInfo(true)} className="btn-ghost px-2 sm:px-3 h-8 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap" title="關於">
                  <Icon name="info" className="w-4 h-4"/> <span className="hidden sm:inline">關於</span>
                </button>
                <button
                  onClick={() => setSettingsCollapsed(v => !v)}
                  className="btn-ghost px-2 sm:px-3 h-8 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap"
                  title={settingsCollapsed ? '展開設定列（賽制、隊數、輪數…）' : '摺疊設定列（賽制、隊數、輪數…）'}
                >
                  <Icon name={settingsCollapsed ? 'chevronDown' : 'chevronUp'} className="w-3.5 h-3.5"/>
                  <span className="hidden sm:inline">設定</span>
                </button>
                <button
                  onClick={() => setActionsCollapsed(v => !v)}
                  className="btn-ghost px-2 sm:px-3 h-8 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap"
                  title={actionsCollapsed ? '展開操作區（流程提示與完整按鈕列）' : '摺疊操作區（保留主要按鈕的精簡列）'}
                >
                  <Icon name={actionsCollapsed ? 'chevronDown' : 'chevronUp'} className="w-3.5 h-3.5"/>
                  <span className="hidden sm:inline">操作</span>
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

            {/* 兩段獨立摺疊：設定列與操作區各自收合，互不影響 */}
              <div className="px-4 py-3 space-y-3">
                {/* 設定列（上半部）：手機 2 欄、桌面 12 欄 */}
                {/* 比賽一旦開始（任一輪已生成桌次或已算分），這 3 個欄位鎖為唯讀，避免追溯改寫已紀錄的勝負與分數 */}
                {/* 例外：輪數允許「只降不升」— 上限為當前值，下限為已涵蓋資料（避免抹掉已抓對 / 已計分的輪次） */}
                {!settingsCollapsed && (() => {
                  const lockedTitle = '比賽已開始，無法修改。如需更動，請先點「重設」清除資料。';
                  // 下限只看實際有資料的輪次（已抓對 / 已計分），不把 UI 導覽中的 currentRound 算進來
                  const roundsFloor = Math.max(1, ...existingRounds, ...scoredRounds);
                  const roundsLockedTitle = roundsFloor >= rounds
                    ? `比賽已開始，輪數無法上調；目前已涵蓋至第 ${roundsFloor} 輪，亦無法再下調。`
                    : `比賽已開始，輪數只能由 ${rounds} 下調至最少 ${roundsFloor}（保留所有已抓對 / 已計分輪次）；不可上調。`;
                  return (
                <div className="grid grid-cols-2 sm:grid-cols-12 gap-3">
                  <Field label="賽制" col={2}><Static>瑞士制</Static></Field>
                  <Field label="比賽項目" col={3}><Static>{gameTitle}</Static></Field>
                  <Field label="參賽隊伍" col={2}>
                    {tournamentStarted
                      ? <Static title={lockedTitle}>{allPlayers}</Static>
                      : <input type="number" min={2} value={allPlayers} onChange={e => setAllPlayers(parseInt(e.target.value) || 2)} className="w-full px-2 h-9 text-base font-mono-num"/>}
                  </Field>
                  <Field label="輪數" col={2}>
                    {tournamentStarted
                      ? <input
                          type="number"
                          min={roundsFloor}
                          max={rounds}
                          value={roundsDraft ?? String(rounds)}
                          disabled={roundsFloor >= rounds}
                          title={roundsLockedTitle}
                          onChange={e => setRoundsDraft(e.target.value)}
                          onBlur={() => {
                            const raw = roundsDraft;
                            setRoundsDraft(null);
                            if (raw === null) return;
                            const v = parseInt(raw, 10);
                            if (!Number.isFinite(v)) return;
                            // 上限固定用編輯前的 rounds（編輯期間不會被 onChange 改寫），下限為實際資料覆蓋的輪次
                            const next = Math.min(rounds, Math.max(roundsFloor, v));
                            if (next !== rounds) {
                              setRounds(next);
                              // 下修總輪數時，把導覽中的 currentRound 也夾回新上限，避免停留在已不存在的輪次
                              setCurrentRound(prev => Math.min(prev, next));
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                          className="w-full px-2 h-9 text-base font-mono-num disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                      : <input type="number" min={1} value={rounds} onChange={e => setRounds(parseInt(e.target.value) || 1)} className="w-full px-2 h-9 text-base font-mono-num"/>}
                  </Field>
                  <Field label="勝方得分" col={1}>
                    {tournamentStarted
                      ? <Static title={lockedTitle}>{winPoint}</Static>
                      : <input type="number" min={1} value={winPoint} onChange={e => setWinPoint(parseInt(e.target.value) || 1)} className="w-full px-2 h-9 text-base font-mono-num"/>}
                  </Field>
                  <Field label="當前輪次" col={2}>
                    <input type="number" min={1} max={rounds} value={currentRound} onChange={e => setCurrentRound(parseInt(e.target.value) || 1)} className="w-full px-2 h-9 text-base font-mono-num"/>
                  </Field>
                </div>
                  );
                })()}

                {/* 操作區（下半部）：摺疊時縮成「流程提示＋主動作」一列 */}
                {actionsCollapsed ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className={`flex items-center gap-2 flex-1 min-w-[200px] px-3 py-2 rounded-md text-sm ${stageBg}`}>
                      <Icon name={stage.icon} className="w-4 h-4 flex-shrink-0"/>
                      <span className="truncate">{stage.msg}</span>
                    </div>
                    {compactActions}
                  </div>
                ) : (
                  <>
                {/* 流程提示 */}
                <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm ${stageBg}`}>
                  <Icon name={stage.icon} className="w-4 h-4 flex-shrink-0"/>
                  <span>{stage.msg}</span>
                  <div className="ml-auto text-xs opacity-70 tabular">STEP {stage.step} / 4</div>
                </div>

                {/* 主操作 + 輔助操作 */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleDrawLots}
                    disabled={currentRound !== 1}
                    className="btn-ghost px-4 h-10 rounded-md text-sm flex items-center gap-2 whitespace-nowrap"
                    title={currentRound !== 1 ? '僅第 1 輪可抽籤' : '隨機重排籤號'}
                  >
                    <Icon name="dice" className="w-4 h-4"/> 抽籤
                  </button>
                  <button
                    onClick={generatePairings}
                    disabled={isPairingButtonDisabled}
                    className="btn-primary px-5 h-10 rounded-md text-sm flex items-center gap-2 flex-1 justify-center whitespace-nowrap"
                  >
                    <Icon name="swap" className="w-4 h-4"/>
                    <span>抓對</span>
                    <span className="opacity-70 text-sm font-normal hidden sm:inline">生成 R{currentRound} 桌次</span>
                    <span className="opacity-70 text-sm font-normal sm:hidden">R{currentRound}</span>
                  </button>
                  <button
                    onClick={calculateScores}
                    disabled={!isPairingButtonDisabled}
                    className={`px-5 h-10 rounded-md text-sm flex items-center gap-2 flex-1 justify-center font-medium whitespace-nowrap
                      ${isPairingButtonDisabled ? 'btn-success' : 'btn-ghost opacity-50 cursor-not-allowed'}`}
                  >
                    <Icon name="calculator" className="w-4 h-4"/>
                    <span>算分</span>
                    <span className="opacity-70 text-sm font-normal hidden sm:inline">結算 R{currentRound}</span>
                    <span className="opacity-70 text-sm font-normal sm:hidden">R{currentRound}</span>
                  </button>
                  {onlineCfg && (
                    <button
                      onClick={publishCurrentRoundPairings}
                      disabled={!(matchesByRound[currentRound] || []).length}
                      className="btn-ghost px-3 h-10 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap"
                      title="把本輪桌次上傳到線上回報後端，裁判手機掃碼後即可看到"
                    >
                      <Icon name="upload" className="w-4 h-4"/>
                      <span className="hidden xl:inline">發佈桌次</span>
                      <span className="xl:hidden">發佈</span>
                    </button>
                  )}

                  <div className="hidden sm:block w-px h-8 bg-[var(--border-default)] mx-1"/>

                  <label className="btn-ghost px-3 h-10 rounded-md text-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap" title="上傳隊伍表 Excel">
                    <Icon name="upload" className="w-4 h-4"/>
                    <span className="hidden xl:inline">上傳</span>
                    <input type="file" className="hidden" onChange={handleFileUpload} onClick={e => { (e.target as HTMLInputElement).value = ''; }} accept=".xlsx,.xls"/>
                  </label>
                  <button
                    onClick={() => setShowImportExport(v => !v)}
                    className="btn-ghost px-3 h-10 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap"
                    title="匯入/匯出 Excel 與狀態備份"
                  >
                    <Icon name="download" className="w-4 h-4"/>
                    <span className="hidden xl:inline">匯入/匯出</span>
                  </button>
                  <button
                    onClick={() => setShowOnlinePanel(v => !v)}
                    className={`btn-ghost px-3 h-10 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap ${onlineCfg ? 'text-[var(--win)]' : ''}`}
                    title="線上成績回報：裁判用手機回報該桌勝負"
                  >
                    <Icon name="monitor" className="w-4 h-4"/>
                    <span className="hidden xl:inline">線上回報</span>
                    {onlineCfg && <span className={`w-1.5 h-1.5 rounded-full ${onlineError ? 'bg-[var(--warn)]' : 'bg-[var(--win)]'}`}/>}
                  </button>
                  <button
                    onClick={resetSystem}
                    className="btn-danger px-3 h-10 rounded-md text-sm flex items-center gap-1.5 whitespace-nowrap"
                    title="清除所有資料、回到第 1 輪"
                  >
                    <Icon name="refresh" className="w-4 h-4"/>
                    <span>重設</span>
                  </button>
                </div>
                  </>
                )}

                {/* 匯入/匯出區塊（沿用既有狀態；操作區摺疊時開著的面板仍可見） */}
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

                {/* 線上成績回報區塊（規格：docs/online-score-reporting-plan.md） */}
                {showOnlinePanel && (
                  <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-3 text-sm">
                    {!onlineCfg ? (
                      <div>
                        <div className="font-semibold text-[var(--text-secondary)] mb-1.5">建立線上賽事</div>
                        <div className="text-[var(--text-muted)] text-xs mb-2 leading-relaxed">
                          建立後會產生各桌裁判 QR 卡（交由計分台保管），裁判掃碼即可用手機回報該桌勝負；
                          主控端自動收成績。後端不可用時，照常手動點選登錄，比賽不中斷。
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={onlineApiDraft}
                            onChange={e => setOnlineApiDraft(e.target.value)}
                            placeholder="後端 API 網址（https://wgp-score-relay.….workers.dev）"
                            className="px-2 h-8 text-sm flex-1 min-w-64"
                          />
                          <input
                            type="password"
                            value={onlineKeyDraft}
                            onChange={e => setOnlineKeyDraft(e.target.value)}
                            placeholder="建立金鑰（SETUP_KEY）"
                            title="部署後端時以 wrangler secret 設定的建立賽事金鑰；後端未設定時可留空"
                            className="px-2 h-8 text-sm w-44"
                          />
                          <Button onClick={createOnlineEvent} type="primary">建立線上賽事（{Math.ceil(allPlayers / 2)} 桌）</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[var(--text-secondary)]">線上賽事</span>
                          <span>{onlineCfg.eventName} · {onlineCfg.tableTokens.length} 桌</span>
                          <Pill tone={onlineError ? 'muted' : 'accent'} size="sm">{onlineError ? '連線異常' : '已連線'}</Pill>
                          {onlineLastSync && !onlineError && (
                            <span className="text-xs text-[var(--text-muted)] tabular">上次同步 {onlineLastSync}</span>
                          )}
                          {lockSyncPending.length > 0 && (
                            <span className="text-xs text-[var(--warn)]" title="鎖定/解鎖狀態尚未同步到後端，將自動重試">
                              ⟳ 鎖定同步中（R{lockSyncPending.join('、R')}）
                            </span>
                          )}
                          {onlineError && <span className="text-xs text-[var(--warn)]">{onlineError}</span>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={printQrCards}><Icon name="grid" className="w-4 h-4"/> 列印 QR 卡</Button>
                          <Button onClick={publishCurrentRoundPairings} disabled={!(matchesByRound[currentRound] || []).length}>
                            <Icon name="upload" className="w-4 h-4"/> 發佈桌次 R{currentRound}
                          </Button>
                          <Button onClick={closeOnlineEvent} danger><Icon name="x" className="w-4 h-4"/> 結束線上賽事</Button>
                        </div>
                        <div>
                          <div className="font-semibold text-[var(--text-secondary)] mb-1.5">各桌狀態</div>
                          {!tablesStatus ? (
                            <div className="text-xs text-[var(--text-muted)]">讀取中…（裁判尚未掃碼前不會有上線紀錄）</div>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {tablesStatus.map(t => {
                                const seen = t.last_seen_at ? Math.round((Date.now() - Date.parse(t.last_seen_at)) / 1000) : null;
                                const fresh = seen !== null && seen < 30;
                                return (
                                  <span
                                    key={t.table_no}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs tabular
                                      ${t.device_change_count > 0 ? 'border-[var(--warn)] text-[var(--warn)]'
                                        : fresh ? 'border-[var(--win)] text-[var(--win)]'
                                        : 'border-[var(--border-default)] text-[var(--text-muted)]'}`}
                                    title={t.last_seen_at
                                      ? `最後上線 ${new Date(t.last_seen_at).toLocaleTimeString('zh-TW', { hour12: false })}${t.device_change_count > 0 ? `；裝置變更 ${t.device_change_count} 次（若非裁判剛到計分台重掃，請注意）` : ''}`
                                      : '尚未掃碼上線'}
                                  >
                                    {/* 桌號與時間各自包 span：flex 的 gap 只隔開元素，相鄰純文字會黏在一起（桌11分前） */}
                                    <span>桌{t.table_no}</span>
                                    <span>{seen === null ? '未上線' : fresh ? '在線' : `${Math.round(seen / 60)}分前`}</span>
                                    {t.device_change_count > 0 && <Icon name="alert" className="w-3 h-3"/>}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
          </div>
        );
      })()}

      {/* ─── 兩欄主內容：左排行榜、右桌次表（手機堆疊、桌面並排） ─── */}
      <div className="flex-1 flex flex-col md:flex-row gap-3 md:overflow-hidden md:min-h-0" id="split-container">
        <div className="split-pane flex-shrink-0 min-w-0" style={{ width: `${splitRatio}%` }}>
          {renderPlayerList()}
        </div>

        {/* 分割線 - 可拖動（僅桌面顯示） */}
        <div
          className="hidden md:block w-1 -mx-1.5 bg-transparent cursor-col-resize hover:bg-[var(--accent-soft)] active:bg-[var(--accent)] flex-shrink-0"
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

        <div className="split-pane flex-1 min-w-0">
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
            <div className="flex gap-2 items-start"><Pill tone="accent" size="sm" className="w-14 justify-center flex-shrink-0 mt-0.5">總分</Pill><div>每輪勝者獲得勝方得分，敗者得 0 分，輪空獲得勝方得分。</div></div>
            <div className="flex gap-2 items-start"><Pill tone="accent" size="sm" className="w-14 justify-center flex-shrink-0 mt-0.5">輔分一</Pill><div>所遇對手之總分和。各對手最終總分加總。</div></div>
            <div className="flex gap-2 items-start"><Pill tone="accent" size="sm" className="w-14 justify-center flex-shrink-0 mt-0.5">輔分二</Pill><div>所負對手之總分和。僅計算落敗場次中對手的最終總分加總。</div></div>
            <div className="flex gap-2 items-start"><Pill tone="accent" size="sm" className="w-14 justify-center flex-shrink-0 mt-0.5">輔分三</Pill><div>直接對戰結果。僅在前述均相同時啟用。</div></div>
          </div>
          <p className="text-xs text-[var(--text-disabled)]">* 輪空場次不計入輔分計算。</p>
          <div className="pt-2 text-right">
            <Button onClick={() => setShowAuxScoreHelp(false)} type="primary">關閉</Button>
          </div>
        </div>
      </Modal>

      {/* ─── 投影模式（桌次表 / 名次表） ─────────────────── */}
      {projectionMode && (
        <div className="fixed inset-0 z-50 flex flex-col proj-bg" data-theme={projTheme}>
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
              onClick={toggleProjTheme}
              className="btn-ghost px-3 h-9 rounded-md text-sm flex items-center gap-1.5"
              title="切換投影亮/暗主題（只影響投影畫面）"
            >
              <Icon name={projTheme === 'dark' ? 'sun' : 'moon'} className="w-4 h-4"/> {projTheme === 'dark' ? '亮色' : '深色'}
            </button>
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
// 手機（<sm）每欄佔 1 格（2 欄 grid），桌面用 col span（12 欄 grid）
const Field = ({ label, children, col = 2 }: { label: string; children?: React.ReactNode; col?: number }) => (
  <div
    className="flex flex-col gap-1 col-span-1"
    style={{ ['--field-col' as any]: col }}
  >
    <label className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">{label}</label>
    {children}
  </div>
);

const Static = ({ children, title }: { children?: React.ReactNode; title?: string }) => (
  <div
    className={`px-2 h-9 flex items-center text-base text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md font-medium ${title ? 'cursor-help' : ''}`}
    title={title}
  >
    {children}
  </div>
);

export default TournamentManager;