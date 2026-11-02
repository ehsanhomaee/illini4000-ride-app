import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/** Writes dist/sw.js with this build's file list, so the whole app works offline after the first visit. */
function serviceWorker(): Plugin {
  return {
    name: 'ride-day-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      // Fonts: only the latin .woff2 files every phone uses; the rest load on demand.
      const files = Object.keys(bundle).filter(f => !f.endsWith('.map') && (!/\.woff2?$/.test(f) || /-latin-\d+-normal-.*\.woff2$/.test(f)));
      const precache = ['./', './index.html', './manifest.webmanifest', './config.json', './icons/icon-192.png', './icons/icon-512.png',
        ...files.map(f => './' + f)];
      const src = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', Date.now().toString(36))
        .replace('__PRECACHE__', JSON.stringify([...new Set(precache)]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  build: { target: 'es2020', sourcemap: false },
});
