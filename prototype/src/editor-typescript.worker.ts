// Monaco ships this worker implementation as JS without declarations.
// @ts-expect-error Internal entry reuses the installed Monaco worker, not a second compiler.
import { initialize, TypeScriptWorker } from 'monaco-editor/languages/features/typescript/ts.worker';

self.onmessage = () => initialize((context: unknown, data: unknown) => {
  const worker = new TypeScriptWorker(context, data);
  const fileNames = worker.getScriptFileNames.bind(worker) as () => string[];
  let activeFile = '';
  // Each mission is a standalone script. Inactive models must not contribute globals or errors.
  worker.getScriptFileNames = () => fileNames().filter((file) => file === activeFile || !/^file:\/\/\/aster-\d+\//.test(file));
  const service: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of Object.getOwnPropertyNames(TypeScriptWorker.prototype)) {
    if (name === 'constructor' || name.startsWith('_') || typeof worker[name] !== 'function') continue;
    service[name] = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && /^file:\/\/\/aster-\d+\//.test(args[0])) activeFile = args[0];
      return worker[name](...args);
    };
  }
  return service;
});
