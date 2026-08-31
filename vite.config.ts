import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig(({ command }) => ({
  plugins: [svelte()],
  // GitHub Pages serves a project site from /<repo>/, so a build has to be
  // rooted there or every asset 404s. The dev server stays at / — setting it
  // globally would move localhost to /trees/ for no reason.
  base: command === 'build' ? '/trees/' : '/',
  server: { port: process.env.PORT ? Number(process.env.PORT) : undefined },
  build: { target: 'esnext' },
}));
