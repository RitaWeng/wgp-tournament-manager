// 裁判手機頁（#/judge；規格：docs/online-score-reporting-plan.md Phase 3 + 五組回報擴充）
// GiveMe5 賽制：每桌五組（ABCDE）對戰，桌勝負由五組結果多數決自動判定。
// 裁判逐組點選勝方（單組平手經加賽分出者標「加賽」）→ 確認 → 送出；
// 桌勝方由畫面即時推導顯示，伺服器端會再推導一次（不信任前端）。
// token 由計分台 QR 掃入：#/judge?e=<eventId>&t=<tableToken>&a=<apiBase>
// 載入即收進 localStorage 並以 history.replaceState 清掉網址（不留瀏覽歷史；規劃 4.1）
import React, { useState, useEffect, useRef } from 'react';
import { judgeGetPairing, judgeSubmitResult, GroupResult } from './lib/sync';

type JudgeConfig = { apiBase: string; eventId: string; token: string };

type PairingView = {
    eventName: string;
    tableNo: number;
    roundNo: number | null;
    locked: boolean;
    pairing: {
        player1_id: number; player1_name: string;
        player2_id: number; player2_name: string;
        result: 1 | 2 | null; groups: GroupResult[] | null; version: number;
        rejected: boolean;  // 目前版本被操作者「維持現狀」拒絕採計（再更正自動解除）
    } | null;
};

const CFG_KEY = 'wgpJudgeConfig';
const DEVICE_KEY = 'wgpJudgeDeviceId';
const GROUP_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

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
    // 五組草稿：winners[i]=該組勝方（null=未選）、overtimes[i]=該組經加賽
    const [winners, setWinners] = useState<(1 | 2 | null)[]>([null, null, null, null, null]);
    const [overtimes, setOvertimes] = useState<boolean[]>([false, false, false, false, false]);
    const [editing, setEditing] = useState(false);       // 已有結果時是否進入更正模式
    const [confirming, setConfirming] = useState(false); // 送出前確認畫面
    const [sending, setSending] = useState(false);
    const [justSubmitted, setJustSubmitted] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const lastRound = useRef<number | null>(null);

    // 輪詢自己桌的對局（10 秒）；斷線不清畫面、亮重試橫幅。
    // 每次輪詢伺服器都會寫一筆 last_seen（D1 免費額度 10 萬寫/日），
    // 10 秒 × 十幾桌 × 整天 ≈ 3–4 萬寫，留足餘裕；別再調快
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
        const id = setInterval(tick, 10000);
        return () => { cancelled = true; clearInterval(id); };
    }, [cfg]);

    // 換輪（主控端發佈新桌次）時重置草稿與畫面狀態
    useEffect(() => {
        const r = view?.roundNo ?? null;
        if (r !== lastRound.current) {
            lastRound.current = r;
            setWinners([null, null, null, null, null]);
            setOvertimes([false, false, false, false, false]);
            setEditing(false);
            setConfirming(false);
            setJustSubmitted(false);
            setSubmitError(null);
        }
    }, [view?.roundNo]);

    const chosenAll = winners.every(w => w !== null);
    const wins1 = winners.filter(w => w === 1).length;
    const derived: 1 | 2 | null = chosenAll ? (wins1 >= 3 ? 1 : 2) : null;

    const startEditing = () => {
        // 更正：以已回報的五組結果預填
        const g = view?.pairing?.groups;
        setWinners(g ? g.map(x => x.winner) : [null, null, null, null, null]);
        setOvertimes(g ? g.map(x => x.overtime) : [false, false, false, false, false]);
        setEditing(true);
        setJustSubmitted(false);
        setSubmitError(null);
    };

    const submit = async () => {
        if (!cfg || !view?.roundNo || !view.pairing || !chosenAll) return;
        const groups: GroupResult[] = winners.map((w, i) => ({ winner: w as 1 | 2, overtime: overtimes[i] }));
        setSending(true);
        setSubmitError(null);
        try {
            const r = await judgeSubmitResult(cfg.apiBase, cfg.token, deviceId.current, {
                roundNo: view.roundNo, groups, version: view.pairing.version,
            });
            setView(v => v && v.pairing ? {
                ...v,
                // 新版本送出成功 → 先前的「未採計」標示即失效
                pairing: { ...v.pairing, result: r.result, groups: r.groups, version: r.version, rejected: false },
            } : v);
            setConfirming(false);
            setEditing(false);
            setJustSubmitted(true);
        } catch (e: any) {
            if (e.message === 'round_locked') {
                setView(v => (v ? { ...v, locked: true } : v));
                setConfirming(false);
            } else if (e.message === 'version_conflict') {
                setSubmitError('結果剛剛在別處更新過，畫面已重新整理，請再確認一次');
                setConfirming(false);
                setEditing(false);
            } else {
                setSubmitError('送出失敗（網路不穩？），請再試一次');
            }
        } finally {
            setSending(false);
        }
    };

    // ── 版面：行動裝置優先、大按鈕，沿用主題 token ──

    const Shell = ({ children }: { children: React.ReactNode }) => (
        <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] flex flex-col">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <div className="text-lg uppercase tracking-widest text-[var(--text-muted)]">裁判成績回報</div>
                {view && (
                    <div className="text-xl text-[var(--text-secondary)] mt-0.5 truncate">
                        {view.eventName} · <span className="font-semibold">桌 {view.tableNo}</span>
                        {view.roundNo && <> · 第 {view.roundNo} 輪</>}
                    </div>
                )}
            </div>
            {offline && (
                <div className="px-4 py-2 text-xl text-center bg-[var(--warn-soft)] text-[var(--warn)]">
                    連線中斷，自動重試中…（成績不會遺失，恢復連線後照常送出）
                </div>
            )}
            {view?.pairing?.rejected && !editing && (
                <div className="px-4 py-3 text-center bg-[var(--loss-soft)] text-[var(--loss)]">
                    <div className="text-2xl font-bold">⚠ 你送出的更正未被計分台採計</div>
                    <div className="text-xl mt-1">請至計分台向工作人員說明</div>
                </div>
            )}
            <div className="flex-1 flex flex-col justify-center px-4 py-5 max-w-md w-full mx-auto">
                {children}
            </div>
        </div>
    );

    const BigMsg = ({ icon, title, sub }: { icon: string; title: string; sub?: React.ReactNode }) => (
        <div className="text-center space-y-3">
            <div className="text-6xl">{icon}</div>
            <div className="text-4xl font-bold">{title}</div>
            {sub && <div className="text-2xl text-[var(--text-muted)] leading-relaxed">{sub}</div>}
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

    // 五組結果摘要（確認/完成/鎖定畫面共用）
    const GroupSummary = ({ groups }: { groups: GroupResult[] }) => (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
            {groups.map((g, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-xl">
                    <span className="font-mono-num font-bold w-8 text-[var(--text-muted)]">{GROUP_LABELS[i]}</span>
                    <span className="flex-1 truncate font-medium">{nameOf(g.winner)} 勝</span>
                    {g.overtime && <span className="text-base px-2 py-0.5 rounded bg-[var(--warn-soft)] text-[var(--warn)] flex-shrink-0">加賽</span>}
                </div>
            ))}
        </div>
    );

    if (view.locked) {
        return <Shell>
            <div className="space-y-5">
                <BigMsg icon="🔒" title={`第 ${view.roundNo} 輪已鎖定`}
                    sub={<>{p.result ? <>已登錄：<b>{nameOf(p.result)}</b> 勝。<br /></> : null}
                        如需更正結果，請洽計分台（主控端解除鎖定後才能修改）。</>} />
                {p.groups && <GroupSummary groups={p.groups} />}
            </div>
        </Shell>;
    }

    // 確認畫面（送出前確認）
    if (confirming && derived) {
        const draftGroups: GroupResult[] = winners.map((w, i) => ({ winner: w as 1 | 2, overtime: overtimes[i] }));
        return (
            <Shell>
                <div className="space-y-5">
                    <BigMsg icon="❓" title={`確認：${nameOf(derived)} 獲勝？`}
                        sub={`五組 ${derived === 1 ? wins1 : 5 - wins1}:${derived === 1 ? 5 - wins1 : wins1} · 桌勝方依五組結果自動判定`} />
                    <GroupSummary groups={draftGroups} />
                    {submitError && <div className="text-center text-xl text-[var(--loss)]">{submitError}</div>}
                    <button
                        onClick={submit}
                        disabled={sending}
                        className="btn-primary w-full h-20 rounded-xl text-3xl font-bold"
                    >{sending ? '送出中…' : '確定送出'}</button>
                    <button
                        onClick={() => { setConfirming(false); setSubmitError(null); }}
                        disabled={sending}
                        className="btn-ghost w-full h-14 rounded-xl text-2xl"
                    >返回修改</button>
                </div>
            </Shell>
        );
    }

    // 已回報且非更正模式 → 現況摘要畫面（送出成功後也停在這）
    if (p.result && !editing) {
        return (
            <Shell>
                <div className="space-y-5">
                    <BigMsg icon={justSubmitted ? '✅' : '📋'} title={justSubmitted ? '已送出' : '本桌已回報'}
                        sub={<><b className="text-[var(--text-primary)]">{nameOf(p.result)}</b> 獲勝
                            <br /><span className="text-xl">主控端已收到，本頁會隨輪次自動更新</span></>} />
                    {p.groups && <GroupSummary groups={p.groups} />}
                    <button
                        onClick={startEditing}
                        className="btn-ghost w-full h-14 rounded-xl text-2xl"
                    >更正結果</button>
                </div>
            </Shell>
        );
    }

    // 主畫面：逐組點選勝方＋加賽註記，五組齊後可送出（桌勝方即時推導顯示）
    return (
        <Shell>
            <div className="space-y-3">
                <div className="text-center text-xl text-[var(--text-muted)]">
                    請逐組點選獲勝隊伍{editing ? '（更正中）' : ''} · 該組若加賽才分出勝負，請點「加賽」
                </div>
                {submitError && <div className="text-center text-xl text-[var(--loss)]">{submitError}</div>}
                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)] overflow-hidden">
                    {GROUP_LABELS.map((label, i) => (
                        <div key={label} className="px-2.5 py-2">
                            <div className="flex items-center gap-2">
                                <span className="font-mono-num text-3xl font-extrabold w-9 text-center text-[var(--text-muted)]">{label}</span>
                                {([1, 2] as const).map(w => (
                                    <button
                                        key={w}
                                        onClick={() => setWinners(prev => prev.map((v, j) => (j === i ? w : v)))}
                                        className={`flex-1 min-w-0 h-16 rounded-lg border-2 px-2 text-xl font-bold truncate transition-colors
                                            ${winners[i] === w
                                                ? 'border-[var(--win)] bg-[var(--win-soft)] text-[var(--win)]'
                                                : 'border-[var(--border-default)] active:bg-[var(--bg-hover)]'}`}
                                        title={nameOf(w)}
                                    >{nameOf(w)}</button>
                                ))}
                                <button
                                    onClick={() => setOvertimes(prev => prev.map((v, j) => (j === i ? !v : v)))}
                                    className={`h-16 px-2 rounded-lg border text-base leading-tight flex-shrink-0 transition-colors
                                        ${overtimes[i]
                                            ? 'border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)] font-bold'
                                            : 'border-[var(--border-default)] text-[var(--text-muted)]'}`}
                                    title="此組平手後經加賽分出勝負"
                                >加賽</button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className={`text-center text-2xl rounded-xl px-3 py-2.5 font-semibold
                    ${derived ? 'bg-[var(--win-soft)] text-[var(--win)]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'}`}>
                    {derived
                        ? <>五組 {derived === 1 ? wins1 : 5 - wins1}:{derived === 1 ? 5 - wins1 : wins1} → <b>{nameOf(derived)}</b> 勝（自動判定）</>
                        : `已選 ${winners.filter(w => w !== null).length} / 5 組`}
                </div>
                <button
                    onClick={() => setConfirming(true)}
                    disabled={!chosenAll}
                    className={`w-full h-16 rounded-xl text-3xl font-bold ${chosenAll ? 'btn-primary' : 'btn-ghost opacity-50'}`}
                >{chosenAll ? '送出結果' : '五組都選完才能送出'}</button>
                {editing && (
                    <button
                        onClick={() => { setEditing(false); setSubmitError(null); }}
                        className="btn-ghost w-full h-14 rounded-xl text-2xl"
                    >取消更正</button>
                )}
                <div className="text-center text-lg text-[var(--text-muted)]">
                    送出前會再跳確認 · 本輪鎖定前皆可更正
                </div>
            </div>
        </Shell>
    );
};

export default JudgePage;
