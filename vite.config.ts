import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative Pfade: funktioniert auf GitHub Pages im Unterordner
  build: { target: 'es2022' },
  esbuild: { target: 'es2022' },
});
