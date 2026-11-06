import { defineConfig } from 'vite';

// Relative base so the site also works under a GitHub Pages project path (/<repo>/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
});
