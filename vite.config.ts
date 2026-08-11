import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: { port: process.env.PORT ? Number(process.env.PORT) : undefined },
  build: { target: 'esnext' },
});
