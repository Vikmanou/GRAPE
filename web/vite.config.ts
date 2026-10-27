import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the static build works from a GitHub Pages subpath.
  base: './',
  plugins: [react()],
  // Fixed and strict so GRAPE never drifts onto another project's port.
  server: { port: 5190, strictPort: true },
  preview: { port: 5190, strictPort: true },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2023',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
