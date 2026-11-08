import assert from 'node:assert/strict';
import { getQuickJS } from 'quickjs-emscripten';
import { executeMission } from '../src/mission-runtime';
import { disposeRunner, prepareRunner } from '../src/runner';
import { executeJavaScript } from '../src/runner-core';
import type { WireBatch } from '../src/runner-protocol';
import { solution, starter } from '../src/mission';
import { deliveryMission } from '../src/delivery-mission';
import { challengeCases, type AttemptMode, type CaseReport } from '../src/challenge';
import { compileTestSource } from './runner-node-adapter';
import { missions } from '../src/missions';
import { missionCatalog, missionIds } from '../src/mission-catalog';

const engine = await getQuickJS();
const nativeWorker = globalThis.Worker;
let corruptAt = -1;
let bootError = false;
const requests: WireBatch[] = [];
const workers: BridgeWorker[] = [];
class BridgeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  terminated = false;
  constructor() {
    workers.push(this);
    queueMicrotask(() => this.onmessage?.({ data: { type: bootError ? 'bootError' : 'ready' } }));
  }
  postMessage(request: WireBatch) {
    requests.push(request);
    for (let index = 0; index < request.fixtures.length; index++) {
      if (this.terminated) return;
      this.onmessage?.({ data: { type: 'fixtureStarted', attempt: request.attempt, fixtureIndex: index } });
      if (this.terminated) return;
      if (corruptAt === index) {
        this.onmessage?.({ data: { type: 'fixtureResult', attempt: request.attempt, fixtureIndex: index, envelopeJSON: '{' } });
        return;
      }
      const result = executeJavaScript(engine, request.javascript, request.entry, request.fixtures[index].argsJSON);
      this.onmessage?.({ data: { type: 'fixtureResult', attempt: request.attempt, fixtureIndex: index, envelopeJSON: JSON.stringify(result) } });
      if (!result.ok) break;
    }
    if (!this.terminated) this.onmessage?.({ data: { type: 'finished', attempt: request.attempt } });
  }
  terminate() { this.terminated = true; }
}
const compiled = (source: string) => {
  const result = compileTestSource(source);
  assert(result.ok);
  return result.javascript;
};
const updates: CaseReport[] = [];
const options = (mode: AttemptMode = 'submit') => ({ mode, signal: new AbortController().signal, onCheck: (report: CaseReport) => updates.push(report) });
const states = (reports: CaseReport[]) => reports.map((report) => report.status);
const memorizedRoute = `function route(g, s, t) {
  if (s === 'greenhouse' && t === 'greenhouse') return [s];
  if (!g.garden?.includes('greenhouse')) return [];
  return ['dock', 'relay', 'junction', 'garden', 'greenhouse'];
}`;
const exampleIntake = challengeCases('one-crate-one-receipt', 'examples');
const memorizedIntake = `function acceptDeliveries(deliveries, seen) {
  const examples = ${JSON.stringify(exampleIntake.map((test) => ({ args: test.args, expected: test.expected })))};
  const match = examples.find(e => JSON.stringify(e.args) === JSON.stringify([deliveries, seen]));
  return match ? match.expected : { deliveries: [], seen: [...seen] };
}`;
try {
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: BridgeWorker });
  prepareRunner();
  for (const mission of missionIds) {
    const source = missions[mission].solution;
    const count = mission === 'first-light' ? 6 : 8;
    updates.length = 0;
    const examples = await executeMission(mission, compiled(source), options('examples'));
    assert(examples.ok && examples.mode === 'examples');
    assert.equal(examples.reports.length, 3);
    assert(!('route' in examples) && !('deliveries' in examples) && !('accepted' in examples) && !('canonical' in examples), 'examples expose no world playback');
    assert.equal(requests.at(-1)!.fixtures.length, 3);
    assert.deepEqual(updates.map((report) => report.status), ['running', 'passed', 'running', 'passed', 'running', 'passed'], 'per-case final status arrives before the next running status');
    const submission = await executeMission(mission, compiled(source), options());
    assert(submission.ok && submission.mode === 'submit');
    assert.equal(submission.reports.length, count);
    assert.deepEqual(states(submission.reports), Array(count).fill('passed'));
    assert.equal(requests.at(-1)!.fixtures.length, count);
    if (submission.missionId === 'first-light') assert.deepEqual(submission.route, ['dock', 'relay', 'junction', 'garden', 'greenhouse']);
    else if (submission.missionId === 'one-crate-one-receipt') {
      assert.deepEqual(submission.accepted, deliveryMission.checks[0].expected.deliveries);
      assert.deepEqual(submission.deliveries, deliveryMission.checks[0].args[0]);
    } else {
      const test = challengeCases(mission, 'examples')[0];
      const report = submission.reports.find((report) => report.id === test.id)!;
      assert(report.visibility === 'public');
      assert.equal(submission.canonical.missionId, mission);
      assert.equal(submission.canonical.caseId, test.id);
      assert.deepEqual(submission.canonical.args, test.args);
      assert.notEqual(submission.canonical.args, test.args, 'canonical args are cloned');
      assert.deepEqual(submission.canonical.output, report.actual, 'canonical contains actual validated first-public output');
    }
    const publicTests = challengeCases(mission, 'examples');
    const memorized = mission === 'first-light' ? memorizedRoute : mission === 'one-crate-one-receipt' ? memorizedIntake : `function ${missionCatalog[mission].entry}(...args) {
      const examples = ${JSON.stringify(publicTests.map((test) => ({args: test.args, expected: test.expected})))};
      const found = examples.find(test => JSON.stringify(test.args) === JSON.stringify(args));
      return found ? found.expected : null;
    }`;
    assert((await executeMission(mission, memorized, options('examples'))).ok);
    const rejected = await executeMission(mission, memorized, options());
    assert(!rejected.ok);
    assert(rejected.reports.slice(0, 3).every((report) => report.status === 'passed'));
    assert(rejected.reports.slice(3).some((report) => report.status === 'failed'));
    assert.equal(rejected.reports.length, count);
    assert(!('route' in rejected) && !('accepted' in rejected) && !('canonical' in rejected));
  }

  const tolerated = await executeMission('read-the-weather', `${compiled(missions['read-the-weather'].solution)}
    const originalWeather = parseTelemetry;
    parseTelemetry = function(lines) { const result = originalWeather(lines); for (const row of result.readings) row.celsius += 5e-10; return result; };`, options());
  assert(tolerated.ok && tolerated.mode === 'submit' && tolerated.missionId === 'read-the-weather');
  const expectedWeather = challengeCases('read-the-weather', 'examples')[0];
  assert(expectedWeather.kind === 'program' && expectedWeather.missionId === 'read-the-weather');
  assert.notDeepEqual(tolerated.canonical.output, expectedWeather.expected, 'tolerated actual values are never replaced by static expected output');
  assert.equal(tolerated.canonical.output.readings[0].celsius, expectedWeather.expected.readings[0].celsius + 5e-10);

  for (const mission of missionIds.slice(2)) {
    const controller = new AbortController();
    const notifications: CaseReport[] = [];
    const aborted = await executeMission(mission, compiled(missions[mission].solution), {mode: 'submit', signal: controller.signal, onCheck(report) {
      notifications.push(report);
      if (report.status === 'passed') controller.abort();
    }});
    assert(!aborted.ok && !('canonical' in aborted));
    assert.deepEqual(states(aborted.reports), ['passed', ...Array(7).fill('not-run')]);
    assert.deepEqual(notifications.map((report) => report.status), ['running', 'passed']);
    const publicTests = challengeCases(mission, 'examples');
    const hiddenThrow = `function ${missionCatalog[mission].entry}(...args) {
      const fixtures = ${JSON.stringify(publicTests.map((test) => ({args: test.args, expected: test.expected})))};
      const match = fixtures.find(test => JSON.stringify(test.args) === JSON.stringify(args));
      if (match) return match.expected;
      console.log('PRIVATE-PROGRAM', args); throw Error('PRIVATE-PROGRAM ' + JSON.stringify(args));
    }`;
    const crashed = await executeMission(mission, hiddenThrow, options());
    assert(!crashed.ok && !('canonical' in crashed));
    assert(!JSON.stringify(crashed).includes('PRIVATE-PROGRAM'));
    assert.deepEqual(states(crashed.reports), ['passed', 'passed', 'passed', 'failed', ...Array(4).fill('not-run')]);
    const lastCase = challengeCases(mission, 'submit').at(-1)!.id;
    const malformedFinish = await executeMission(mission, compiled(missions[mission].solution), {...options(), onCheck(report) {
      if (report.id === lastCase && report.status === 'passed') workers.find((worker) => !worker.terminated)!.onmessage?.({data: {type: 'bad-finish'}});
    }});
    assert(!malformedFinish.ok && !('canonical' in malformedFinish));
    assert.deepEqual(states(malformedFinish.reports), Array(8).fill('passed'));
  }

  const semantic = await executeMission('first-light', compiled(starter), options());
  assert(!semantic.ok);
  assert.deepEqual(states(semantic.reports), ['failed', 'failed', 'failed', 'failed', 'failed', 'failed'], 'all actually executed semantic results are judged');
  assert.equal(semantic.reports[0].visibility, 'public');
  if (semantic.reports[0].visibility === 'public') {
    assert.deepEqual(semantic.reports[0].actual, ['dock', 'greenhouse']);
    assert(semantic.reports[0].diagnostic);
    assert(semantic.reports[0].input && semantic.reports[0].expected);
  }
  const alternate = await executeMission('first-light', `${compiled(solution)}\nconst originalRoute = route; route = function(g,s,t) { if (s === 'dock' && t === 'greenhouse' && g.garden.includes(t)) return ['dock','relay','junction','observatory','garden','greenhouse']; return originalRoute(g,s,t); };`, options());
  assert(alternate.ok && alternate.mode === 'submit' && alternate.missionId === 'first-light');
  assert.deepEqual(alternate.route, ['dock', 'relay', 'junction', 'observatory', 'garden', 'greenhouse'], 'a non-shortest legal path is both accepted and used for canonical playback');

  const runtime = await executeMission('first-light', `${compiled(solution)}\nconst originalRoute = route; route = function(g,s,t) { if (s === t) throw Error('public runtime failure'); return originalRoute(g,s,t); };`, options());
  assert(!runtime.ok);
  assert.deepEqual(states(runtime.reports), ['passed', 'passed', 'failed', 'not-run', 'not-run', 'not-run']);
  assert.match(runtime.error, /public runtime failure/);

  updates.length = 0;
  const hiddenSource = `${compiled(solution)}\nconst originalRoute = route; route = function(g,s,t) { if (!g.dock) { console.log('PRIVATE-LOG', s); throw Error('PRIVATE-ERROR ' + s); } console.log('public-log'); return originalRoute(g,s,t); };`;
  const hiddenCrash = await executeMission('first-light', hiddenSource, options());
  assert(!hiddenCrash.ok);
  assert.deepEqual(states(hiddenCrash.reports), ['passed', 'passed', 'passed', 'failed', 'not-run', 'not-run']);
  const projected = JSON.stringify({ result: hiddenCrash, updates });
  assert(!projected.includes('PRIVATE-LOG') && !projected.includes('PRIVATE-ERROR'));
  assert(!projected.includes('fern') && !projected.includes('a'.repeat(32)));
  for (const report of hiddenCrash.reports.filter((report) => report.visibility === 'hidden')) assert.deepEqual(Object.keys(report).sort(), ['category', 'id', 'status', 'title', 'visibility']);
  assert(hiddenCrash.reports[0].visibility === 'public' && hiddenCrash.reports[0].logs.includes('public-log'));
  const corruptAfterHiddenCrash = await executeMission('first-light', hiddenSource, {
    ...options(), onCheck(report) { if (report.id === 'route-hidden-1' && report.status === 'failed') workers.find((worker) => !worker.terminated)!.onmessage?.({ data: { type: 'bad-finish' } }); },
  });
  assert(!corruptAfterHiddenCrash.ok);
  assert.match(corruptAfterHiddenCrash.attemptError!, /Invalid sandbox/);
  assert(!JSON.stringify(corruptAfterHiddenCrash).includes('PRIVATE-'));

  corruptAt = 2;
  const corrupt = await executeMission('first-light', 'function route() { return ["dock", "relay", "greenhouse"]; }', options());
  assert(!corrupt.ok);
  assert.equal(corrupt.checkId, 'delivery');
  assert.match(corrupt.error, /broken/);
  assert.match(corrupt.attemptError!, /Invalid sandbox/);
  assert.deepEqual(states(corrupt.reports), ['failed', 'failed', 'not-run', 'not-run', 'not-run', 'not-run']);
  assert(!('prefix' in corrupt), 'failed prefixes do not enter world playback');
  corruptAt = -1;
  const lastProtocol = await executeMission('first-light', compiled(solution), {
    ...options(), onCheck(report) { if (report.id === 'route-hidden-3' && report.status === 'passed') workers.find((worker) => !worker.terminated)!.onmessage?.({ data: { type: 'bad-finish' } }); },
  });
  assert(!lastProtocol.ok, 'even 6 validated passes cannot award progress when final protocol is corrupt');
  assert.deepEqual(states(lastProtocol.reports), Array(6).fill('passed'));

  const controller = new AbortController();
  updates.length = 0;
  const cancelled = await executeMission('first-light', compiled(solution), { mode: 'submit', signal: controller.signal, onCheck(report) { updates.push(report); if (report.status === 'passed') controller.abort(); } });
  assert(!cancelled.ok);
  assert.deepEqual(states(cancelled.reports), ['passed', 'not-run', 'not-run', 'not-run', 'not-run', 'not-run']);
  assert.deepEqual(updates.map((report) => report.status), ['running', 'passed'], 'no UI callbacks after abort');
  const preabort = new AbortController(); preabort.abort();
  const requestCount = requests.length;
  const stopped = await executeMission('first-light', compiled(solution), { mode: 'submit', signal: preabort.signal, onCheck() { assert.fail('pre-aborted checks must not update UI'); } });
  assert(!stopped.ok && /stopped/.test(stopped.error));
  assert.equal(requests.length, requestCount);
  assert.deepEqual(states(stopped.reports), Array(6).fill('not-run'));

  disposeRunner();
  bootError = true;
  prepareRunner();
  const beforeBoot = requests.length;
  const boot = await executeMission('first-light', compiled(solution), options());
  assert(!boot.ok);
  assert.equal(boot.checkId, null, 'boot failures are attempt-level, not a made-up test failure');
  assert.deepEqual(states(boot.reports), Array(6).fill('not-run'));
  assert.equal(requests.length, beforeBoot);
} finally {
  disposeRunner();
  if (nativeWorker === undefined) Reflect.deleteProperty(globalThis, 'Worker');
  else globalThis.Worker = nativeWorker;
}
assert(workers.every((worker) => worker.terminated));
console.log('Mission bridge checks passed. Eleven actual QuickJS programs via WorkerDouble, examples 3 versus submissions 6/8, actual public canonical values including permitted tolerance, hidden lookup/crash redaction, nine program cancellation/final-protocol gates and retained route/intake negative cases. Not browser or performance evidence.');
