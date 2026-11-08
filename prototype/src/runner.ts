import { LIMITS, exactKeys, isRecord, makeBatch, parseEnvelope } from './runner-protocol';
import type { BatchResult, FixtureResult, RunnerEntry, RunnerFixture, WireBatch } from './runner-protocol';
export type { BatchResult, FixtureResult, RunnerEntry, RunnerFixture } from './runner-protocol';

type Boot = {
  worker: Worker;
  state: 'booting' | 'ready' | 'active' | 'closed';
  timer: ReturnType<typeof setTimeout> | undefined;
  deadline: number;
  start?: () => void;
  fail?: (error: string) => void;
};
let idle: Boot | undefined;
let active: { stop: (error: string) => void } | undefined;
let disposed = false;
let attemptID = 0;
const invalid = 'Invalid sandbox response. Retry.';

function close(boot: Boot) {
  if (boot.state === 'closed') return;
  boot.state = 'closed';
  clearTimeout(boot.timer);
  boot.timer = undefined;
  boot.worker.onmessage = null;
  boot.worker.onerror = null;
  boot.worker.onmessageerror = null;
  boot.worker.terminate();
  if (idle === boot) idle = undefined;
}

function createBoot(): Boot {
  const deadline = performance.now() + LIMITS.bootMs;
  const worker = new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module' });
  const boot: Boot = { worker, state: 'booting', timer: undefined, deadline };
  const fail = (error: string) => {
    const callback = boot.fail;
    close(boot);
    callback?.(error);
  };
  const expired = () => fail('Sandbox download or initialization exceeded 30 seconds. Your code has not run. Check your connection and retry.');
  boot.timer = setTimeout(expired, Math.max(0, deadline - performance.now()));
  worker.onerror = (event) => { event.preventDefault?.(); fail('Could not run the JavaScript sandbox. Retry.'); };
  worker.onmessageerror = () => fail('Could not read the sandbox response. Retry.');
  worker.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (boot.state === 'closed') return;
    if (boot.state === 'booting' && performance.now() >= boot.deadline) { expired(); return; }
    if (!isRecord(data) || !exactKeys(data, ['type']) || data.type !== 'ready' || boot.state !== 'booting') {
      fail(isRecord(data) && data.type === 'bootError' ? 'Could not load the JavaScript sandbox. Retry.' : invalid);
      return;
    }
    clearTimeout(boot.timer);
    boot.timer = undefined;
    boot.state = 'ready';
    boot.start?.();
  };
  return boot;
}

export function prepareRunner(): void {
  disposed = false;
  if (idle || active) return;
  try { idle = createBoot(); } catch { /* A real attempt reports unavailable workers. */ }
}

export function disposeRunner(): void {
  disposed = true;
  active?.stop('Run cancelled.');
  if (idle) close(idle);
}

export async function executeBatch(
  javascript: string, entry: RunnerEntry, fixtures: RunnerFixture[],
  options: { signal: AbortSignal; onFixture?: (index: number, status: 'running' | 'complete', result?: FixtureResult) => void },
): Promise<BatchResult> {
  const failed = (error: string): BatchResult => ({ ok: false, results: [], error, fixtureIndex: null });
  if (options.signal.aborted) return failed('Run cancelled.');
  if (disposed) return failed('Runner is disposed. Prepare the runner before running again.');
  if (active) return failed('Another sandbox attempt is still running. Stop it before retrying.');
  let request: WireBatch;
  try { request = makeBatch(javascript, entry, fixtures, ++attemptID); }
  catch (error) { return failed(error instanceof Error ? error.message : 'Invalid sandbox input.'); }
  return new Promise<BatchResult>((resolve) => {
    let boot: Boot | undefined;
    let state: 'booting' | 'awaitingStart' | 'running' | 'awaitingFinish' | 'finished' = 'booting';
    let index = 0;
    let fixtureTimer: ReturnType<typeof setTimeout> | undefined;
    let batchTimer: ReturnType<typeof setTimeout> | undefined;
    let fixtureDeadline = 0;
    let batchDeadline = 0;
    const results: FixtureResult[] = [];
    const finish = (result: BatchResult) => {
      if (state === 'finished') return;
      state = 'finished';
      clearTimeout(fixtureTimer);
      clearTimeout(batchTimer);
      options.signal.removeEventListener('abort', abort);
      if (boot) close(boot);
      active = undefined;
      resolve(result);
      if (!disposed) prepareRunner();
    };
    const stop = (error: string) => finish({ ok: false, results: [...results], error, fixtureIndex: state === 'booting' ? null : Math.min(index, request.fixtures.length - 1) });
    const abort = () => stop('Run cancelled.');
    const notify = (status: 'running' | 'complete', result?: FixtureResult) => {
      try { options.onFixture?.(index, status, result); }
      catch { stop('Fixture callback failed. Run cancelled.'); }
      return state !== 'finished';
    };
    const setFixtureDeadline = () => {
      clearTimeout(fixtureTimer);
      fixtureDeadline = performance.now() + LIMITS.fixtureMs;
      fixtureTimer = setTimeout(() => stop('Execution exceeded the 1 second worker time limit.'), LIMITS.fixtureMs);
    };
    const start = () => {
      if (state !== 'booting' || !boot || boot.state !== 'ready') return;
      if (options.signal.aborted) { abort(); return; }
      state = 'awaitingStart';
      boot.state = 'active';
      batchDeadline = performance.now() + request.fixtures.length * LIMITS.fixtureMs;
      batchTimer = setTimeout(() => stop('Execution exceeded the fixed batch time limit.'), request.fixtures.length * LIMITS.fixtureMs);
      setFixtureDeadline();
      boot.worker.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (state === 'finished') return;
        if (performance.now() >= batchDeadline) { stop('Execution exceeded the fixed batch time limit.'); return; }
        if (performance.now() >= fixtureDeadline) { stop('Execution exceeded the 1 second worker time limit.'); return; }
        try {
          if (!isRecord(data) || data.attempt !== request.attempt) throw new Error(invalid);
          if (data.type === 'fixtureStarted' && exactKeys(data, ['type', 'attempt', 'fixtureIndex']) && data.fixtureIndex === index && state === 'awaitingStart') {
            state = 'running';
            notify('running');
          } else if (data.type === 'fixtureResult' && exactKeys(data, ['type', 'attempt', 'fixtureIndex', 'envelopeJSON']) && data.fixtureIndex === index && state === 'running') {
            const result = parseEnvelope(data.envelopeJSON, entry);
            results.push(result);
            if (result.ok && index + 1 < request.fixtures.length) setFixtureDeadline();
            if (!notify('complete', result)) return;
            index++;
            if (!result.ok || index === request.fixtures.length) state = 'awaitingFinish';
            else state = 'awaitingStart';
          } else if (data.type === 'finished' && exactKeys(data, ['type', 'attempt']) && state === 'awaitingFinish') {
            const last = results[results.length - 1];
            finish(last.ok ? { ok: true, results } : { ok: false, results, error: last.error, fixtureIndex: results.length - 1 });
          } else throw new Error(invalid);
        } catch { stop(invalid); }
      };
      try { boot.worker.postMessage(request); }
      catch { stop('Could not send code to the sandbox. Retry.'); }
    };
    active = { stop };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      boot = idle ?? createBoot();
      idle = undefined;
      boot.start = start;
      boot.fail = stop;
      if (options.signal.aborted) abort();
      else if (boot.state === 'ready') start();
    } catch { stop('This browser could not start the JavaScript sandbox.'); }
  });
}
