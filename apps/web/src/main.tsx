import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { loadPrivateFonts } from './private-fonts';
import './styles.css';
import './deck-theme.css';

loadPrivateFonts();

const root = document.getElementById('root');

if (!root) {
  throw new Error('Не найден корневой элемент приложения');
}

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
