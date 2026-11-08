import { build } from 'vite';

await build({
  configFile: false,
  worker: {
    format: 'es',
    plugins: () => [{
      name: 'runtime-import-evidence',
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === 'chunk' && Object.keys(chunk.modules).some((id) => id.endsWith('/src/runner.worker.ts'))) {
            const modules = Object.keys(chunk.modules);
            if (modules.some((id) => /(?:typescript|monaco-editor|runner-node-adapter)/.test(id))) throw new Error('Execution worker imports a compiler or test adapter.');
            this.emitFile({type: 'asset', fileName: 'runtime-worker-import-graph.json', source: JSON.stringify({entry: chunk.fileName, modules}, null, 2)});
          }
        }
      },
    }],
  },
  build: {
    target: 'es2022', outDir: 'research/evidence/runtime-production', emptyOutDir: true,
    rollupOptions: {input: 'research/runtime-fixture.html'},
  },
});
