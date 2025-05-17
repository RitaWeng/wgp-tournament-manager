import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import TournamentManager from './TournamentManager';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <TournamentManager />
  </React.StrictMode>
);