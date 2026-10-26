import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startApp } from './state/app';
import { App } from './ui/App';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

startApp();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
