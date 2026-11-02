import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadAppConfig, applySavedConfig } from './api/client';
import { prefs } from './lib/db';

const theme = prefs.get<'auto' | 'light' | 'dark'>('theme', 'auto');
if (theme !== 'auto') document.documentElement.setAttribute('data-theme', theme);

// Keep photos and files on the phone even when it runs low on space.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

const render = () => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
const saved = prefs.get<{ apiUrl: string } | null>('appConfig', null);
if (saved) {
  // Open straight away with the saved settings; reload only if a leader changed the backend.
  void applySavedConfig(saved).then(render);
  void loadAppConfig().then(fresh => { if (fresh.apiUrl !== saved.apiUrl) location.reload(); });
} else {
  loadAppConfig().finally(render);
}
