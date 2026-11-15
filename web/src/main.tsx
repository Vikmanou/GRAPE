import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerOffline } from './offline';
import { startApp } from './state/app';
import { App } from './ui/App';
import './ui/styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

startApp();
registerOffline();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
