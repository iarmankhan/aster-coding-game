import assert from 'node:assert/strict';
import { getQuickJS } from 'quickjs-emscripten';
import { executeBatch, prepareRunner, disposeRunner } from '../src/runner';
import { executeJavaScript } from '../src/runner-core';
import { LIMITS } from '../src/runner-protocol';
import type { BatchResult, WireBatch } from '../src/runner-protocol';
import { missionIds, missionCatalog } from '../src/mission-catalog';

const engine = await getQuickJS();
const original = { Worker: globalThis.Worker, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, performance: globalThis.performance };
let now = 0, timerID = 0, checks = 0;
const timers = new Map<number, { at: number; delay: number; callback: () => void }>();
const workers: WorkerDouble[] = [];
let post: (worker: WorkerDouble, request: WireBatch) => void = () => {};
class WorkerDouble {
  terminated = false;
  terminateCalls = 0;
  messages: WireBatch[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() { workers.push(this); }
  emit(data: unknown) { this.onmessage?.({ data }); }
  postMessage(request: WireBatch) { this.messages.push(request); post(this, request); }
  terminate() { this.terminated = true; this.terminateCalls++; }
}
function advance(milliseconds: number) {
  const end = now + milliseconds;
  while (timers.size) {
    const [id, timer] = [...timers].sort(([, a], [, b]) => a.at - b.at)[0];
    if (timer.at > end) break;
    now = timer.at;
    timers.delete(id);
    timer.callback();
  }
  now = end;
}
const latest = () => workers[workers.length - 1];
const started = (worker: WorkerDouble, index = 0, attempt = worker.messages[0].attempt) => worker.emit({type: 'fixtureStarted', attempt, fixtureIndex: index});
const result = (worker: WorkerDouble, index = 0, value: unknown = ['A', 'D']) => worker.emit({type: 'fixtureResult', attempt: worker.messages[0].attempt, fixtureIndex: index, envelopeJSON: JSON.stringify({ok: true, value, logs: []})});
const finished = (worker: WorkerDouble) => worker.emit({type: 'finished', attempt: worker.messages[0].attempt});
const fixtures = Array.from({length: 3}, (_, i) => ({id: `fixture-${i}`, args: [{A: ['D'], D: []}, 'A', 'D']}));
const code = 'function route(g, s, t) { return [s, t]; }';
function setup() {
  disposeRunner();
  assert.equal(timers.size, 0);
  assert.ok(workers.every((worker) => worker.terminated));
  post = () => {};
  prepareRunner();
  return latest();
}
function cleanup() {
  disposeRunner();
  assert.equal(timers.size, 0, 'all boot, fixture, and batch timers are removed');
  assert.ok(workers.every((worker) => worker.terminated && worker.terminateCalls === 1), 'every created worker terminates exactly once');
}
function failure(value: BatchResult, pattern: RegExp) {
  assert.ok(!value.ok, JSON.stringify(value));
  assert.match(value.error, pattern);
}
async function test(name: string, action: () => Promise<void> | void) {
  await action();
  cleanup();
  checks++;
  console.log(`PASS ${name}`);
}
try {
  Object.defineProperty(globalThis, 'Worker', {configurable: true, writable: true, value: WorkerDouble});
  Object.defineProperty(globalThis, 'performance', {configurable: true, writable: true, value: {now: () => now}});
  Object.defineProperty(globalThis, 'setTimeout', {configurable: true, writable: true, value: (callback: () => void, delay: number) => {
    timers.set(++timerID, {at: now + delay, delay, callback}); return timerID;
  }});
  Object.defineProperty(globalThis, 'clearTimeout', {configurable: true, writable: true, value: (id: number) => timers.delete(id)});

  await test('prewarm executes no user code and is idempotent', () => {
    const worker = setup();
    const count = workers.length;
    prepareRunner(); prepareRunner();
    assert.equal(workers.length, count);
    worker.emit({type: 'ready'});
    assert.equal(worker.messages.length, 0);
    assert.equal(timers.size, 0);
  });
  await test('one batch executes same JS-only core on three fresh fixtures and replaces finished worker', async () => {
    const worker = setup();
    post = (w, request) => {
      for (let i = 0; i < request.fixtures.length; i++) {
        started(w, i);
        const envelope = executeJavaScript(engine, request.javascript, request.entry, request.fixtures[i].argsJSON);
        w.emit({type: 'fixtureResult', attempt: request.attempt, fixtureIndex: i, envelopeJSON: JSON.stringify(envelope)});
      }
      finished(w);
    };
    const statuses: string[] = [];
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal, onFixture: (i, status) => statuses.push(`${i}:${status}`)});
    assert.equal(worker.messages.length, 0);
    worker.emit({type: 'ready'});
    assert.deepEqual(await pending, {ok: true, results: fixtures.map(() => ({ok: true, value: ['A', 'D'], logs: []}))});
    assert.deepEqual(statuses, ['0:running', '0:complete', '1:running', '1:complete', '2:running', '2:complete']);
    assert.equal(worker.terminated, true);
    assert.notEqual(latest(), worker);
    assert.equal(latest().messages.length, 0);
  });
  await test('ready after 7.5 seconds remains valid without code before ready', async () => {
    const worker = setup();
    const pending = executeBatch(code, 'route', fixtures.slice(0, 1), {signal: new AbortController().signal});
    advance(7500);
    assert.equal(worker.terminated, false);
    assert.equal(worker.messages.length, 0);
    worker.emit({type: 'ready'});
    started(worker); result(worker); finished(worker);
    assert.equal((await pending).ok, true);
  });
  await test('local completion callback receives only parsed fixture results in real time', async () => {
    const worker = setup();
    const notifications: unknown[] = [];
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal, onFixture: (index, status, value) => notifications.push({index, status, value})});
    worker.emit({type: 'ready'});
    started(worker);
    assert.deepEqual(notifications, [{index: 0, status: 'running', value: undefined}]);
    result(worker);
    assert.deepEqual(notifications[1], {index: 0, status: 'complete', value: {ok: true, value: ['A', 'D'], logs: []}});
    started(worker, 1);
    assert.equal(notifications.length, 3, 'first completion delivered before next case finishes');
    worker.emit({type: 'fixtureResult', attempt: worker.messages[0].attempt, fixtureIndex: 1, envelopeJSON: '{'});
    failure(await pending, /Invalid sandbox/);
    assert.equal(notifications.length, 3, 'malformed fixture never reaches the result callback');
  });
  await test('local callback can cancel on running without later completion callbacks', async () => {
    const worker = setup(), controller = new AbortController();
    let count = 0;
    const pending = executeBatch(code, 'route', fixtures, {signal: controller.signal, onFixture: (_index, status, value) => {
      count++;
      assert.equal(status, 'running');
      assert.equal(value, undefined);
      controller.abort();
    }});
    worker.emit({type: 'ready'});
    const late = worker.onmessage;
    started(worker);
    failure(await pending, /cancelled/);
    late?.({data: {type: 'fixtureResult', attempt: worker.messages[0].attempt, fixtureIndex: 0, envelopeJSON: JSON.stringify({ok: true, value: ['A'], logs: []})}});
    assert.equal(count, 1);
    assert.equal(worker.terminated, true);
  });
  await test('boot deadline starts at construction, not Run, and late ready is ignored', async () => {
    const worker = setup();
    advance(29000);
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal});
    const late = worker.onmessage;
    advance(999);
    assert.equal(worker.terminated, false);
    advance(1);
    failure(await pending, /30 seconds.*has not run/);
    late?.({data: {type: 'ready'}});
    assert.equal(worker.messages.length, 0);
  });
  await test('idle failed or expired boot resets cleanly before next attempt', async () => {
    const stale = setup();
    stale.emit({type: 'bootError'});
    const pending = executeBatch(code, 'route', fixtures.slice(0, 1), {signal: new AbortController().signal});
    const worker = latest();
    assert.notEqual(worker, stale);
    worker.emit({type: 'ready'}); started(worker); result(worker); finished(worker);
    assert.equal((await pending).ok, true);
  });
  await test('late boot message cannot bypass absolute deadline when timer task is delayed', async () => {
    const worker = setup();
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal});
    now += 30000;
    worker.emit({type: 'ready'});
    failure(await pending, /30 seconds/);
    assert.equal(worker.messages.length, 0);
  });
  await test('late result cannot bypass absolute fixture deadline when timer task is delayed', async () => {
    const worker = setup();
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal});
    worker.emit({type: 'ready'}); started(worker);
    now += 1000;
    result(worker);
    failure(await pending, /1 second/);
  });
  await test('pre-aborted attempt never sends code or creates active worker', async () => {
    const worker = setup();
    const controller = new AbortController(); controller.abort();
    const count = workers.length;
    failure(await executeBatch(code, 'route', fixtures, {signal: controller.signal}), /cancelled/);
    assert.equal(workers.length, count);
    assert.equal(worker.messages.length, 0);
  });
  await test('abort while booting immediately terminates own worker', async () => {
    const worker = setup(), controller = new AbortController();
    const pending = executeBatch(code, 'route', fixtures, {signal: controller.signal});
    controller.abort();
    assert.equal(worker.terminated, true);
    assert.equal(worker.messages.length, 0);
    failure(await pending, /cancelled/);
  });
  await test('abort while executing immediately terminates active worker', async () => {
    const worker = setup(), controller = new AbortController();
    const pending = executeBatch(code, 'route', fixtures, {signal: controller.signal});
    worker.emit({type: 'ready'}); started(worker);
    controller.abort();
    assert.equal(worker.terminated, true);
    failure(await pending, /cancelled/);
  });
  await test('abort between fixtures preserves completed prefix', async () => {
    const worker = setup(), controller = new AbortController();
    const pending = executeBatch(code, 'route', fixtures, {signal: controller.signal, onFixture: (_i, status) => {if (status === 'complete') controller.abort();}});
    worker.emit({type: 'ready'}); started(worker); result(worker);
    const value = await pending;
    failure(value, /cancelled/);
    assert.equal(value.results.length, 1);
    assert.equal(worker.terminated, true);
  });
  await test('abort after completion does not kill replenished idle or change result', async () => {
    const worker = setup(), controller = new AbortController();
    const pending = executeBatch(code, 'route', fixtures.slice(0, 1), {signal: controller.signal});
    worker.emit({type: 'ready'}); started(worker); result(worker); finished(worker);
    const value = await pending;
    const spare = latest();
    controller.abort();
    assert.equal(value.ok, true);
    assert.equal(spare.terminated, false);
  });
  await test('dispose terminates active and does not replenish', async () => {
    const worker = setup();
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal});
    worker.emit({type: 'ready'}); started(worker);
    const count = workers.length;
    disposeRunner();
    failure(await pending, /cancelled/);
    assert.equal(workers.length, count);
    assert.equal(worker.terminated, true);
  });
  await test('concurrent non-aborted attempt rejected without creating another worker', async () => {
    const worker = setup(), controller = new AbortController();
    const pending = executeBatch(code, 'route', fixtures, {signal: controller.signal});
    const count = workers.length;
    failure(await executeBatch(code, 'route', fixtures, {signal: new AbortController().signal}), /Another/);
    assert.equal(workers.length, count);
    controller.abort(); await pending;
    assert.equal(worker.terminated, true);
  });
  for (const status of ['running', 'complete'] as const) await test(`callback exception during ${status} fails closed`, async () => {
    const worker = setup();
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal, onFixture: (_i, next) => {if (next === status) throw new Error('boom');}});
    worker.emit({type: 'ready'}); started(worker);
    if (status === 'complete') result(worker);
    failure(await pending, /callback failed/);
    assert.equal(worker.terminated, true);
  });
  for (const [name, emit] of [
    ['duplicate ready', (w: WorkerDouble) => w.emit({type: 'ready'})],
    ['result before start', (w: WorkerDouble) => result(w)],
    ['out-of-order fixture', (w: WorkerDouble) => started(w, 1)],
    ['invalid attempt ID', (w: WorkerDouble) => started(w, 0, w.messages[0].attempt + 1)],
    ['unknown message', (w: WorkerDouble) => w.emit({type: 'anything', attempt: w.messages[0].attempt})],
    ['extra protocol field', (w: WorkerDouble) => w.emit({type: 'fixtureStarted', attempt: w.messages[0].attempt, fixtureIndex: 0, extra: true})],
    ['early finished', (w: WorkerDouble) => finished(w)],
    ['malformed JSON', (w: WorkerDouble) => {started(w); w.emit({type: 'fixtureResult', attempt: w.messages[0].attempt, fixtureIndex: 0, envelopeJSON: '{'});}],
    ['oversized envelope', (w: WorkerDouble) => {started(w); w.emit({type: 'fixtureResult', attempt: w.messages[0].attempt, fixtureIndex: 0, envelopeJSON: ' '.repeat(LIMITS.envelopeChars + 1)});}],
    ['malformed result', (w: WorkerDouble) => {started(w); result(w, 0, [7]);}],
    ['duplicate start', (w: WorkerDouble) => {started(w); started(w);}],
    ['duplicate result', (w: WorkerDouble) => {started(w); result(w); result(w);}],
  ] as const) await test(`${name} fails closed once`, async () => {
    const worker = setup();
    let notifications = 0;
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal, onFixture: () => {notifications++;}});
    worker.emit({type: 'ready'});
    const late = worker.onmessage;
    emit(worker);
    failure(await pending, /Invalid sandbox/);
    const count = notifications;
    late?.({data: {type: 'fixtureStarted', attempt: worker.messages[0].attempt, fixtureIndex: 1}});
    assert.equal(notifications, count);
    assert.equal(worker.terminateCalls, 1);
  });
  await test('hung execution has finite 1000ms deadline after late boot', async () => {
    const worker = setup();
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal});
    advance(29999); worker.emit({type: 'ready'});
    advance(999); started(worker);
    advance(1);
    failure(await pending, /1 second/);
    assert.equal(worker.terminated, true);
  });
  await test('fixture progress cannot refresh deadline and batch deadline stays fixed', async () => {
    const worker = setup();
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal});
    worker.emit({type: 'ready'});
    const batch = [...timers.values()].find((timer) => timer.delay === fixtures.length * LIMITS.fixtureMs)!;
    const at = batch.at;
    advance(900); started(worker); result(worker);
    assert.ok([...timers.values()].some((timer) => timer === batch && timer.at === at));
    advance(900); started(worker, 1); result(worker, 1);
    assert.ok([...timers.values()].some((timer) => timer === batch && timer.at === at));
    advance(999); started(worker, 2);
    advance(1);
    failure(await pending, /1 second/);
  });
  await test('fixed batch budget survives fixture timer transitions without refresh', async () => {
    const worker = setup();
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal});
    worker.emit({type: 'ready'});
    const batchID = [...timers].find(([, timer]) => timer.delay === 3000)![0];
    for (let i = 0; i < 2; i++) {advance(999); started(worker, i); result(worker, i);}
    assert.equal(timers.has(batchID), true);
    // Simulate a fixture host timer being unavailable. The independent batch timer still bounds a hung host protocol.
    for (const [id, timer] of timers) if (id !== batchID && timer.delay === 1000) timers.delete(id);
    advance(1002);
    failure(await pending, /fixed batch/);
  });
  await test('valid guest failure includes failed fixture and stops batch', async () => {
    const worker = setup();
    const completed: unknown[] = [];
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal, onFixture: (_index, status, value) => {if (status === 'complete') completed.push(value);}});
    worker.emit({type: 'ready'}); started(worker); result(worker);
    started(worker, 1);
    worker.emit({type: 'fixtureResult', attempt: worker.messages[0].attempt, fixtureIndex: 1, envelopeJSON: JSON.stringify({ok: false, error: 'blocked', logs: ['real log']})});
    finished(worker);
    const value = await pending;
    failure(value, /blocked/);
    assert.equal(value.results.length, 2);
    assert.ok(!value.ok); assert.equal(value.fixtureIndex, 1);
    assert.deepEqual(completed, [{ok: true, value: ['A', 'D'], logs: []}, {ok: false, error: 'blocked', logs: ['real log']}], 'validated guest failure and its logs reach only the local completion callback');
  });
  for (const kind of ['error', 'messageerror', 'send'] as const) await test(`${kind} infrastructure failure cleans worker and preserves prefix`, async () => {
    const worker = setup();
    if (kind === 'send') post = () => {throw new Error('clone failed');};
    const pending = executeBatch(code, 'route', fixtures, {signal: new AbortController().signal});
    worker.emit({type: 'ready'});
    if (kind !== 'send') {
      started(worker); result(worker);
      if (kind === 'error') worker.onerror?.({preventDefault() {}}); else worker.onmessageerror?.();
    }
    const value = await pending;
    failure(value, /Could not/);
    assert.equal(value.results.length, kind === 'send' ? 0 : 1);
  });
  await test('eight fixtures accepted, ninth rejected before posting', async () => {
    const worker = setup();
    const eight = Array.from({length: 8}, (_, i) => ({...fixtures[0], id: `f${i}`}));
    failure(await executeBatch(code, 'route', [...eight, {...fixtures[0], id: 'ninth'}], {signal: new AbortController().signal}), /eight/);
    const pending = executeBatch(code, 'route', eight, {signal: new AbortController().signal});
    worker.emit({type: 'ready'});
    for (let i = 0; i < 8; i++) {started(worker, i); result(worker, i);}
    finished(worker);
    const value = await pending;
    assert.equal(value.ok, true); assert.equal(value.results.length, 8);
  });
  for (const id of missionIds.slice(2)) await test(`${id} uses catalog entry and exact arity through the worker protocol`, async () => {
    const worker = setup();
    const {entry, args} = missionCatalog[id];
    post = (w, request) => {
      assert.equal(request.entry, entry);
      started(w);
      const actual = executeJavaScript(engine, request.javascript, request.entry, request.fixtures[0].argsJSON);
      w.emit({type: 'fixtureResult', attempt: request.attempt, fixtureIndex: 0, envelopeJSON: JSON.stringify(actual)});
      finished(w);
    };
    const pending = executeBatch(`function ${entry}(...args) { return {arity: args.length, args}; }`, entry, [{id: 'arity', args: args.map((_name, i) => i)}], {signal: new AbortController().signal});
    worker.emit({type: 'ready'});
    assert.deepEqual(await pending, {ok: true, results: [{ok: true, value: {arity: args.length, args: args.map((_name, i) => i)}, logs: []}]});
  });
} finally {
  disposeRunner();
  if (original.Worker === undefined) Reflect.deleteProperty(globalThis, 'Worker'); else globalThis.Worker = original.Worker;
  globalThis.setTimeout = original.setTimeout;
  globalThis.clearTimeout = original.clearTimeout;
  Object.defineProperty(globalThis, 'performance', {configurable: true, writable: true, value: original.performance});
}
console.log(`Runner protocol checks passed (${checks}). All workers terminated once, zero retained timers.`);
