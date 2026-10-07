import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

const root = document.getElementById('root');

if (root === null) throw new Error('o elemento #root não existe no index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
