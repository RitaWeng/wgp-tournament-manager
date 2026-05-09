/**
 * 對話框元件 — 取代原生 alert / confirm / prompt。
 *
 * 對外提供 imperative API（`dialog.alert / confirm / prompt`），呼叫端拿到 Promise；
 * 內部把每筆呼叫推進 FIFO queue，由 <DialogHost /> 渲染隊首一筆。
 *
 * 使用：
 *   1. 在 root 掛載一次 `<DialogHost />`（見 index.tsx）
 *   2. 任何模組 `import { dialog } from './lib/dialog'` 即可呼叫
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// ─────────────────────────────────────────────────────────────────
// 公開型別
// ─────────────────────────────────────────────────────────────────
export type DialogTone = 'info' | 'warn' | 'error' | 'success';

export type AlertOptions = {
  title?: string;
  message: React.ReactNode;
  tone?: DialogTone;
  okText?: string;
};

export type ConfirmOptions = {
  title?: string;
  message: React.ReactNode;
  tone?: Exclude<DialogTone, 'success'>;
  okText?: string;
  cancelText?: string;
  /** danger=true：OK 鈕用警示色；點背景 / ESC 不會關閉，避免誤觸 */
  danger?: boolean;
};

export type PromptOptions = {
  title?: string;
  message?: React.ReactNode;
  defaultValue?: string;
  placeholder?: string;
  okText?: string;
  cancelText?: string;
  /** 回傳錯誤訊息字串代表驗證失敗，回傳 null 代表通過 */
  validate?: (value: string) => string | null;
};

// ─────────────────────────────────────────────────────────────────
// 內部 queue store（module-level；React 透過 useSyncExternalStore 訂閱）
// ─────────────────────────────────────────────────────────────────
type AlertEntry   = { id: number; kind: 'alert';   options: AlertOptions;   resolve: () => void };
type ConfirmEntry = { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void };
type PromptEntry  = { id: number; kind: 'prompt';  options: PromptOptions;  resolve: (v: string | null) => void };
type Entry = AlertEntry | ConfirmEntry | PromptEntry;

const QUEUE_WARN_THRESHOLD = 5;

let queue: Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((fn) => fn());

const enqueue = (entry: Omit<AlertEntry, 'id'> | Omit<ConfirmEntry, 'id'> | Omit<PromptEntry, 'id'>) => {
  const id = nextId++;
  queue = [...queue, { ...entry, id } as Entry];
  if (queue.length > QUEUE_WARN_THRESHOLD) {
    // 排隊過多通常是程式邏輯卡住，留 console 訊息協助 debug
    console.warn(`[dialog] queue length=${queue.length}, expected to be small`);
  }
  emit();
};

const popHead = () => {
  queue = queue.slice(1);
  emit();
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

const getSnapshot = () => queue;

// ─────────────────────────────────────────────────────────────────
// 對外 imperative API
// ─────────────────────────────────────────────────────────────────
export const dialog = {
  alert(options: AlertOptions): Promise<void> {
    return new Promise<void>((resolve) => enqueue({ kind: 'alert', options, resolve }));
  },
  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => enqueue({ kind: 'confirm', options, resolve }));
  },
  prompt(options: PromptOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => enqueue({ kind: 'prompt', options, resolve }));
  },
};

// ─────────────────────────────────────────────────────────────────
// 視覺常數
// ─────────────────────────────────────────────────────────────────
const TONE_ICON_CLASS: Record<DialogTone, string> = {
  info:    'text-[var(--info)]',
  warn:    'text-[var(--warn)]',
  error:   'text-[var(--loss)]',
  success: 'text-[var(--win)]',
};

const FOCUSABLE_SELECTOR =
  'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ─────────────────────────────────────────────────────────────────
// DialogHost — 掛在 root，渲染隊首
// ─────────────────────────────────────────────────────────────────
export const DialogHost: React.FC = () => {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const head = snapshot[0];
  if (!head) return null;
  return <DialogView key={head.id} entry={head} onClose={popHead} />;
};

// ─────────────────────────────────────────────────────────────────
// DialogView — 單一對話框實作（focus trap / ESC / backdrop / a11y）
// ─────────────────────────────────────────────────────────────────
const DialogView: React.FC<{ entry: Entry; onClose: () => void }> = ({ entry, onClose }) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closedRef = useRef(false);

  const isPrompt = entry.kind === 'prompt';
  const promptOptions = isPrompt ? entry.options : null;

  const [value, setValue] = useState<string>(promptOptions?.defaultValue ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);

  const tone: DialogTone = entry.kind === 'alert'
    ? entry.options.tone ?? 'info'
    : entry.kind === 'confirm'
      ? entry.options.tone ?? 'info'
      : 'info';

  const isDanger = entry.kind === 'confirm' && entry.options.danger === true;
  const dismissOnBackdrop = !isDanger;

  const titleText =
    entry.options.title ??
    (entry.kind === 'alert'
      ? (tone === 'error' ? '錯誤' : tone === 'warn' ? '提醒' : tone === 'success' ? '完成' : '訊息')
      : entry.kind === 'confirm' ? '請確認' : '請輸入');

  const titleId = `dialog-title-${entry.id}`;
  const bodyId = `dialog-body-${entry.id}`;

  const finish = (settle: () => void) => {
    if (closedRef.current) return;
    closedRef.current = true;
    settle();
    onClose();
  };

  const handleCancel = () => {
    if (entry.kind === 'alert') finish(() => entry.resolve());
    else if (entry.kind === 'confirm') finish(() => entry.resolve(false));
    else finish(() => entry.resolve(null));
  };

  const handleConfirm = () => {
    if (entry.kind === 'alert') {
      finish(() => entry.resolve());
      return;
    }
    if (entry.kind === 'confirm') {
      finish(() => entry.resolve(true));
      return;
    }
    // prompt
    const validate = entry.options.validate;
    if (validate) {
      const err = validate(value);
      if (err) {
        setValidationError(err);
        return;
      }
    }
    finish(() => entry.resolve(value));
  };

  // focus trap、ESC、return focus
  useEffect(() => {
    previousFocusRef.current = (document.activeElement as HTMLElement) ?? null;

    const surface = surfaceRef.current;
    if (surface) {
      // 初始 focus：prompt 進 input；其餘進 primary 按鈕
      const initial =
        surface.querySelector<HTMLInputElement>('input[data-dialog-input]') ??
        surface.querySelector<HTMLButtonElement>('button[data-dialog-primary]') ??
        surface.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      initial?.focus();
      if (initial && initial.tagName === 'INPUT') {
        (initial as HTMLInputElement).select();
      }
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dismissOnBackdrop) {
          e.preventDefault();
          handleCancel();
        }
        return;
      }
      if (e.key === 'Tab' && surface) {
        const focusables = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
          .filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !surface.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !surface.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      // 卸載時把焦點還給觸發元素
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
    // 此 effect 僅在元件 mount/unmount 觸發；entry 不會在生命週期中變動（每筆 entry 都是新的 key）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onBackdropMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (e.target !== e.currentTarget) return;
    if (!dismissOnBackdrop) return;
    handleCancel();
  };

  const onPromptSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    handleConfirm();
  };

  // 按鈕視覺
  const okText =
    (entry.kind !== 'alert' ? entry.options.okText : entry.options.okText) ??
    (entry.kind === 'alert' ? '我知道了' : '確定');
  const cancelText =
    entry.kind === 'alert'
      ? null
      : entry.options.cancelText ?? '取消';
  const okClass = isDanger ? 'btn-danger' : 'btn-primary';

  const messageNode =
    entry.kind === 'prompt' ? entry.options.message : entry.options.message;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={onBackdropMouseDown}
      role="presentation"
    >
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="surface rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <ToneIcon tone={tone} />
            <h3 id={titleId} className="font-semibold text-[var(--text-primary)]">
              {titleText}
            </h3>
          </div>
          {dismissOnBackdrop && (
            <button
              type="button"
              onClick={handleCancel}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1"
              aria-label="關閉"
            >
              <CloseIcon />
            </button>
          )}
        </div>

        {entry.kind === 'prompt' ? (
          <form onSubmit={onPromptSubmit}>
            <DialogBody bodyId={bodyId} message={messageNode}>
              <input
                type="text"
                data-dialog-input
                value={value}
                placeholder={entry.options.placeholder}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                className="w-full px-3 h-9 mt-3 text-sm"
              />
              {validationError && (
                <div className="mt-2 text-xs text-[var(--loss)]">{validationError}</div>
              )}
            </DialogBody>
            <DialogFooter
              cancelText={cancelText}
              okText={okText}
              okClass={okClass}
              onCancel={handleCancel}
            />
          </form>
        ) : (
          <>
            <DialogBody bodyId={bodyId} message={messageNode} />
            <DialogFooter
              cancelText={cancelText}
              okText={okText}
              okClass={okClass}
              onCancel={handleCancel}
              onConfirm={handleConfirm}
            />
          </>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// 子元件
// ─────────────────────────────────────────────────────────────────
const DialogBody: React.FC<{ bodyId: string; message: React.ReactNode; children?: React.ReactNode }> = ({
  bodyId,
  message,
  children,
}) => (
  <div id={bodyId} className="p-5 text-sm text-[var(--text-secondary)] leading-relaxed">
    {/* 保留 \n 換行（既有訊息字串多用 \n 分段） */}
    <div className="whitespace-pre-line">{message}</div>
    {children}
  </div>
);

const DialogFooter: React.FC<{
  cancelText: string | null;
  okText: string;
  okClass: string;
  onCancel: () => void;
  onConfirm?: () => void;
}> = ({ cancelText, okText, okClass, onCancel, onConfirm }) => (
  <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-subtle)]">
    {cancelText !== null && (
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center justify-center gap-1.5 rounded-md font-medium focus:outline-none px-3 h-8 text-sm btn-ghost"
      >
        {cancelText}
      </button>
    )}
    <button
      type={onConfirm ? 'button' : 'submit'}
      data-dialog-primary
      onClick={onConfirm}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium focus:outline-none px-3 h-8 text-sm ${okClass}`}
    >
      {okText}
    </button>
  </div>
);

const ToneIcon: React.FC<{ tone: DialogTone }> = ({ tone }) => {
  const cls = `w-5 h-5 ${TONE_ICON_CLASS[tone]}`;
  if (tone === 'success') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={cls}>
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12l3 3 5-6" />
      </svg>
    );
  }
  if (tone === 'warn' || tone === 'error') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
};

const CloseIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
