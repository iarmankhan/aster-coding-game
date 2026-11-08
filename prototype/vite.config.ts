import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  optimizeDeps: { include: ['quickjs-emscripten', 'typescript'] },
});
