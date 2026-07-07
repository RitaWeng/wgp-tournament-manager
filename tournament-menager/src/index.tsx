import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import TournamentManager from './TournamentManager';
import JudgePage from './JudgePage';
import { DialogHost } from './lib/dialog';

// hash route：#/judge 為裁判手機回報頁（QR 掃入），其餘為主控端。
// 載入時決定即可——QR 開的是全新頁面，不需要執行期切換
const isJudgeRoute = window.location.hash.startsWith('#/judge');

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    {isJudgeRoute ? <JudgePage /> : (
      <>
        <TournamentManager />
        <DialogHost />
      </>
    )}
  </React.StrictMode>
);
