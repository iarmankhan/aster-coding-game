import { newQuickJSWASMModule, newVariant, RELEASE_SYNC } from 'quickjs-emscripten';
import type { QuickJSWASMModule } from 'quickjs-emscripten';
import { executeJavaScript } from './runner-core';
import { LIMITS, parseEnvelope, validBatch } from './runner-protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: QuickJSWASMModule | undefined;
let used = false;
scope.onmessage = ({ data }: MessageEvent<unknown>) => {
  if (used || !engine || !validBatch(data)) {
    used = true;
    scope.postMessage({ type: 'protocolError' });
    return;
  }
  used = true;
  for (let fixtureIndex = 0; fixtureIndex < data.fixtures.length; fixtureIndex++) {
    scope.postMessage({ type: 'fixtureStarted', attempt: data.attempt, fixtureIndex });
    const result = executeJavaScript(engine, data.javascript, data.entry, data.fixtures[fixtureIndex].argsJSON);
    const envelopeJSON = JSON.stringify(result);
    if (envelopeJSON.length > LIMITS.envelopeChars) {
      scope.postMessage({ type: 'protocolError' });
      return;
    }
    parseEnvelope(envelopeJSON, data.entry);
    scope.postMessage({ type: 'fixtureResult', attempt: data.attempt, fixtureIndex, envelopeJSON });
    if (!result.ok) {
      scope.postMessage({ type: 'finished', attempt: data.attempt });
      return;
    }
  }
  scope.postMessage({ type: 'finished', attempt: data.attempt });
};

// Prewarm only the module and WASM. Guest contexts are created only for a real fixture.
import('@jitl/quickjs-wasmfile-release-sync/wasm?url')
  .then(({ default: wasmLocation }) => newQuickJSWASMModule(newVariant(RELEASE_SYNC, { wasmLocation })))
  .then((loaded) => { engine = loaded; scope.postMessage({ type: 'ready' }); })
  .catch(() => scope.postMessage({ type: 'bootError' }));
