// 裁判手機頁（#/judge；規格：docs/online-score-reporting-plan.md Phase 3）
// 設計目標：裁判 10 秒內完成一筆——顯示自己桌的對局、點大按鈕選勝方、確認、完成。
// token 由計分台 QR 掃入：#/judge?e=<eventId>&t=<tableToken>&a=<apiBase>
// 載入即收進 localStorage 並以 history.replaceState 清掉網址（不留瀏覽歷史；規劃 4.1）
import React, { useState, useEffect, useRef } from 'react';
import { judgeGetPairing, judgeSubmitResult } from './lib/sync';

type JudgeConfig = { apiBase: string; eventId: string; token: string };

type PairingView = {
    eventName: string;
    tableNo: number;
    roundNo: number | null;
    locked: boolean;
    pairing: {
        player1_id: number; player1_name: string;
        player2_id: number; player2_name: string;
        result: 1 | 2 | null; version: number;
    } | null;
};

const CFG_KEY = 'wgpJudgeConfig';
const DEVICE_KEY = 'wgpJudgeDeviceId';

// 首次啟動自產隨機 device_id（軟性裝置偵測用；授權仍以 token 為準）
function getDeviceId(): string {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
        const buf = new Uint8Array(8);
        crypto.getRandomValues(buf);
        id = [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
}

// 從 hash 收 token → localStorage → 清網址。無參數時沿用既有設定（整天只需掃一次碼）
function captureConfig(): JudgeConfig | null {
    const m = window.location.hash.match(/^#\/judge\?(.*)$/);
    if (m) {
        const q = new URLSearchParams(m[1]);
        const e = q.get('e'), t = q.get('t'), a = q.get('a');
        if (e && t && a && /^https?:\/\//.test(a)) {
            const cfg: JudgeConfig = { eventId: e, token: t, apiBase: a.replace(/\/+$/, '') };
            try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* 私密模式等情境：本次仍可用 */ }
            history.replaceState(null, '', `${location.pathname}#/judge`);
            return cfg;
        }
    }
    try {
        const raw = localStorage.getItem(CFG_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* 解析失敗視同未設定 */ }
    return null;
}

const JudgePage = () => {
    const [cfg] = useState<JudgeConfig | null>(() => captureConfig());
    const deviceId = useRef(getDeviceId());
    const [view, setView] = useState<PairingView | null>(null);
    const [offline, setOffline] = useState(false);
    const [unauthorized, setUnauthorized] = useState(false);
    // 送出流程：pick（選勝方）→ confirm（確認）→ sending → done（成功畫面）
    const [confirmWinner, setConfirmWinner] = useState<1 | 2 | null>(null);
    const [sending, setSending] = useState(false);
    const [justSubmitted, setJustSubmitted] = useState<1 | 2 | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // 輪詢自己桌的對局（4 秒）；斷線不清畫面、亮重試橫幅
    useEffect(() => {
        if (!cfg) return;
        let cancelled = false;
        const tick = async () => {
            try {
                const v = await judgeGetPairing(cfg.apiBase, cfg.token, deviceId.current);
                if (cancelled) return;
                setView(v);
                setOffline(false);
                setUnauthorized(false);
            } catch (e: any) {
                if (cancelled) return;
                if (e.message === 'unauthorized') setUnauthorized(true);
                else setOffline(true);
            }
        };
        tick();
        const id = setInterval(tick, 4000);
        return () => { cancelled = true; clearInterval(id); };
    }, [cfg]);

    const submit = async (winner: 1 | 2) => {
        if (!cfg || !view?.roundNo || !view.pairing) return;
        setSending(true);
        setSubmitError(null);
        try {
            const r = await judgeSubmitResult(cfg.apiBase, cfg.token, deviceId.current, {
                roundNo: view.roundNo, winner, version: view.pairing.version,
            });
            setView(v => v && v.pairing ? {
                ...v,
                pairing: { ...v.pairing, result: r.result, version: r.version },
            } : v);
            setJustSubmitted(winner);
            setConfirmWinner(null);
        } catch (e: any) {
            if (e.message === 'round_locked') {
                setView(v => (v ? { ...v, locked: true } : v));
                setConfirmWinner(null);
            } else if (e.message === 'version_conflict') {
                setSubmitError('結果剛剛在別處更新過，畫面已重新整理，請再確認一次');
                setConfirmWinner(null);
            } else {
                setSubmitError('送出失敗（網路不穩？），請再試一次');
            }
        } finally {
            setSending(false);
        }
    };

    // ── 版面：行動裝置優先、大字體大按鈕，沿用主題 token ──

    const Shell = ({ children }: { children: React.ReactNode }) => (
        <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] flex flex-col">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <div className="text-xs uppercase tracking-widest text-[var(--text-muted)]">裁判成績回報</div>
                {view && (
                    <div className="text-sm text-[var(--text-secondary)] mt-0.5 truncate">
                        {view.eventName} · <span className="font-semibold">桌 {view.tableNo}</span>
                        {view.roundNo && <> · 第 {view.roundNo} 輪</>}
                    </div>
                )}
            </div>
            {offline && (
                <div className="px-4 py-2 text-sm text-center bg-[var(--warn-soft)] text-[var(--warn)]">
                    連線中斷，自動重試中…（成績不會遺失，恢復連線後照常送出）
                </div>
            )}
            <div className="flex-1 flex flex-col justify-center px-5 py-6 max-w-md w-full mx-auto">
                {children}
            </div>
        </div>
    );

    const BigMsg = ({ icon, title, sub }: { icon: string; title: string; sub?: React.ReactNode }) => (
        <div className="text-center space-y-3">
            <div className="text-5xl">{icon}</div>
            <div className="text-xl font-bold">{title}</div>
            {sub && <div className="text-base text-[var(--text-muted)] leading-relaxed">{sub}</div>}
        </div>
    );

    if (!cfg) {
        return <Shell><BigMsg icon="📷" title="請掃描本桌 QR 卡"
            sub="QR 卡由計分台保管；請至計分台報到，由工作人員協助掃碼。" /></Shell>;
    }
    if (unauthorized) {
        return <Shell><BigMsg icon="⛔" title="憑證已失效"
            sub="賽事可能已結束，或 QR 卡已更換。請回計分台重新掃碼。" /></Shell>;
    }
    if (!view) {
        return <Shell><BigMsg icon="⏳" title="連線中…" sub="正在取得本桌對局資料" /></Shell>;
    }
    if (!view.roundNo || !view.pairing) {
        return <Shell><BigMsg icon="🕐" title="等待桌次發佈"
            sub={<>主控端尚未發佈本輪桌次。<br />頁面會自動更新，請稍候。</>} /></Shell>;
    }

    const p = view.pairing;
    const nameOf = (w: 1 | 2) => (w === 1 ? p.player1_name : p.player2_name);

    if (view.locked) {
        return <Shell><BigMsg icon="🔒" title={`第 ${view.roundNo} 輪已鎖定`}
            sub={<>{p.result ? <>已登錄：<b>{nameOf(p.result)}</b> 勝。<br /></> : null}
                如需更正結果，請洽計分台（主控端解除鎖定後才能修改）。</>} /></Shell>;
    }

    // 確認畫面（送出前確認；規劃 Phase 3）
    if (confirmWinner) {
        return (
            <Shell>
                <div className="space-y-6">
                    <BigMsg icon="❓" title={`確認：${nameOf(confirmWinner)} 獲勝？`}
                        sub={`第 ${view.roundNo} 輪 · 桌 ${view.tableNo}`} />
                    {submitError && <div className="text-center text-sm text-[var(--loss)]">{submitError}</div>}
                    <button
                        onClick={() => submit(confirmWinner)}
                        disabled={sending}
                        className="btn-primary w-full h-16 rounded-xl text-xl font-bold"
                    >{sending ? '送出中…' : '確定送出'}</button>
                    <button
                        onClick={() => { setConfirmWinner(null); setSubmitError(null); }}
                        disabled={sending}
                        className="btn-ghost w-full h-12 rounded-xl text-base"
                    >返回</button>
                </div>
            </Shell>
        );
    }

    // 成功畫面：送出後顯示；鎖定前可自行更正（更正會在主控端跳 revision 警示）
    if (p.result && justSubmitted) {
        return (
            <Shell>
                <div className="space-y-6">
                    <BigMsg icon="✅" title="已送出" sub={<><b className="text-[var(--text-primary)]">{nameOf(p.result)}</b> 獲勝
                        <br /><span className="text-sm">主控端已收到，本頁會隨輪次自動更新</span></>} />
                    <button
                        onClick={() => setJustSubmitted(null)}
                        className="btn-ghost w-full h-12 rounded-xl text-base"
                    >更正結果</button>
                </div>
            </Shell>
        );
    }

    // 選勝方（主畫面）：已有結果時顯示現況並可更正
    return (
        <Shell>
            <div className="space-y-4">
                <div className="text-center text-base text-[var(--text-muted)]">
                    {p.result
                        ? <>目前登錄：<b className="text-[var(--text-primary)]">{nameOf(p.result)}</b> 勝——如需更正請重新點選勝方</>
                        : '請點選獲勝隊伍'}
                </div>
                {submitError && <div className="text-center text-sm text-[var(--loss)]">{submitError}</div>}
                {([1, 2] as const).map(w => (
                    <button
                        key={w}
                        onClick={() => setConfirmWinner(w)}
                        className={`w-full min-h-24 rounded-2xl border-2 px-4 py-5 text-center transition-colors
                            ${p.result === w
                                ? 'border-[var(--win)] bg-[var(--win-soft)]'
                                : 'border-[var(--border-default)] bg-[var(--bg-surface)] active:bg-[var(--bg-hover)]'}`}
                    >
                        <div className="text-2xl font-extrabold leading-snug break-words">{nameOf(w)}</div>
                        <div className={`text-sm mt-1 ${p.result === w ? 'text-[var(--win)] font-semibold' : 'text-[var(--text-muted)]'}`}>
                            {p.result === w ? '✓ 目前登錄為勝方' : '點我登錄獲勝'}
                        </div>
                    </button>
                ))}
                <div className="text-center text-xs text-[var(--text-muted)] pt-2">
                    送出前會再跳確認 · 本輪鎖定前皆可更正
                </div>
            </div>
        </Shell>
    );
};

export default JudgePage;
