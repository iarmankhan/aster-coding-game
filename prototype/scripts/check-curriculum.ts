import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firstMission, nextExercises } from '../src/curriculum';
import { checkNavigation, graph, navigationChecks, solution, starter, validateRoute } from '../src/mission';
import type { Graph } from '../src/mission';
import { executeInQuickJS } from './runner-node-adapter';

type Delivery = { receiptId: string; item: string; units: number };
function acceptDeliveries(input: { deliveries: Delivery[]; seen: string[] }) {
  const known = new Set(input.seen);
  const deliveries = input.deliveries.filter((delivery) => {
    if (known.has(delivery.receiptId)) return false;
    known.add(delivery.receiptId);
    return true;
  });
  return { deliveries, seen: [...known] };
}

function parseTelemetry({ lines }: { lines: string[] }) {
  const readings: { sensor: string; celsius: number }[] = [];
  const rejected: number[] = [];
  lines.forEach((line, index) => {
    const fields = line.split('|').map((field) => field.trim());
    const [sensor, number, unit] = fields;
    if (fields.length !== 3 || !/^[a-z][a-z0-9-]{0,15}$/.test(sensor) ||
        !/^-?\d+(?:\.\d+)?$/.test(number) || !['C', 'F'].includes(unit)) {
      rejected.push(index);
      return;
    }
    const celsius = unit === 'F' ? (Number(number) - 32) * 5 / 9 : Number(number);
    if (!Number.isFinite(celsius) || celsius < -50 || celsius > 80) rejected.push(index);
    else readings.push({ sensor, celsius });
  });
  return { readings, rejected };
}

type StockChange = { id: string; item: string; delta: number };
function balanceStock({ stock, changes }: { stock: Record<string, number>; changes: StockChange[] }) {
  const counts = new Map(Object.entries(stock));
  const rejected: string[] = [];
  for (const change of changes) {
    const next = (counts.get(change.item) ?? 0) + change.delta;
    if (next < 0) rejected.push(change.id);
    else counts.set(change.item, next);
  }
  const balances = [...counts.keys()].sort().map((item) => ({ item, units: counts.get(item)! }));
  return { balances, rejected };
}

type PowerRequest = { id: string; demand: number; priority: number };
function allocatePower({ energy, requests }: { energy: number; requests: PowerRequest[] }) {
  let remaining = energy;
  const powered: string[] = [];
  const ordered = requests.map((request, index) => ({ ...request, index }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index);
  for (const request of ordered) {
    if (request.demand <= remaining) {
      remaining -= request.demand;
      powered.push(request.id);
    }
  }
  return { powered, remaining };
}

type RepairJob = { id: string; requires: string[] };
function scheduleRepairs({ jobs, done }: { jobs: RepairJob[]; done: string[] }) {
  const completed = new Set(done);
  const batches: string[][] = [];
  let pending = jobs.filter((job) => !completed.has(job.id));
  while (pending.length) {
    const ready = pending.filter((job) => job.requires.every((id) => completed.has(id)));
    if (!ready.length) break;
    batches.push(ready.map((job) => job.id));
    for (const job of ready) completed.add(job.id);
    pending = pending.filter((job) => !completed.has(job.id));
  }
  return { batches, blocked: pending.map((job) => job.id) };
}

type SensorSample = { t: number; sensor: string; value: number };
function smoothSensors({ samples, window }: { samples: SensorSample[]; window: number }) {
  return samples.map((sample, index) => {
    const active = samples.slice(0, index + 1).filter((previous) =>
      previous.sensor === sample.sensor && previous.t >= sample.t - window);
    return { t: sample.t, sensor: sample.sensor, mean: active.reduce((sum, item) => sum + item.value, 0) / active.length };
  });
}

type GrowthState = { phase: 'seed' | 'sprout' | 'ready' | 'wilted'; streak: number };
type GrowthDay = { water: boolean; light: boolean };
function growBed({ initial, days }: { initial: GrowthState; days: GrowthDay[] }) {
  let state = { ...initial };
  const timeline: GrowthState[] = [];
  for (const day of days) {
    const favorable = day.water && day.light;
    if (state.phase === 'seed' && favorable) state = { phase: 'sprout', streak: 0 };
    else if (state.phase === 'sprout') {
      if (!favorable) state = { phase: 'wilted', streak: 0 };
      else if (state.streak === 2) state = { phase: 'ready', streak: 0 };
      else state = { phase: 'sprout', streak: state.streak + 1 };
    }
    timeline.push({ ...state });
  }
  return { timeline, final: { ...state } };
}

type FailedSend = { id: string; attempt: number; failedAt: number };
function scheduleRetries({ failures, baseDelay, maxDelay, maxAttempts }: {
  failures: FailedSend[]; baseDelay: number; maxDelay: number; maxAttempts: number;
}) {
  const retries: { id: string; attempt: number; dueAt: number }[] = [];
  const exhausted: string[] = [];
  for (const failure of failures) {
    if (failure.attempt >= maxAttempts) exhausted.push(failure.id);
    else retries.push({ id: failure.id, attempt: failure.attempt + 1,
      dueAt: failure.failedAt + Math.min(maxDelay, baseDelay * 2 ** (failure.attempt - 1)) });
  }
  return { retries, exhausted };
}

type QueueTick = { arrivals: string[]; slots: number };
function queueTimeline({ capacity, ticks }: { capacity: number; ticks: QueueTick[] }) {
  const waiting: string[] = [];
  const history: { started: string[]; waiting: string[]; rejected: string[] }[] = [];
  for (const tick of ticks) {
    const started = waiting.splice(0, tick.slots);
    const rejected: string[] = [];
    for (const id of tick.arrivals) {
      if (waiting.length < capacity) waiting.push(id);
      else rejected.push(id);
    }
    history.push({ started, waiting: [...waiting], rejected });
  }
  return { history, waiting: [...waiting] };
}

type BeaconEvent = { id: string; version: number } & ({ kind: 'set'; value: string } | { kind: 'delete' });
function reconcileBeacons({ events }: { events: BeaconEvent[] }) {
  const latest = new Map<string, BeaconEvent>();
  const ignored: number[] = [];
  events.forEach((event, index) => {
    const previous = latest.get(event.id);
    if (previous && previous.version >= event.version) ignored.push(index);
    else latest.set(event.id, event);
  });
  const entities: { id: string; value: string; version: number }[] = [];
  const tombstones: { id: string; version: number }[] = [];
  for (const id of [...latest.keys()].sort()) {
    const event = latest.get(id)!;
    if (event.kind === 'set') entities.push({ id, value: event.value, version: event.version });
    else tombstones.push({ id, version: event.version });
  }
  return { entities, tombstones, ignored };
}

assert.equal(nextExercises.length, 10);
assert.equal(new Set(nextExercises.map((exercise) => exercise.id)).size, 10);
assert.equal(new Set(nextExercises.map((exercise) => exercise.title)).size, 10);
assert.equal(new Set(nextExercises.map((exercise) => exercise.concept)).size, 10);
assert.deepEqual(nextExercises.map((exercise) => exercise.order), Array.from({ length: 10 }, (_, index) => index + 2));
for (const exercise of nextExercises) {
  assert.match(exercise.id, /^[a-z]+(?:-[a-z]+)*$/);
  assert.ok(Number.isInteger(exercise.minutes) && exercise.minutes >= 25 && exercise.minutes <= 45);
  for (const key of ['id', 'title', 'concept', 'premise', 'signature', 'input', 'output', 'explanation', 'worldEffect'] as const) {
    assert.equal(typeof exercise[key], 'string', `${exercise.id}.${key} must be a string`);
    assert.ok(exercise[key].trim().length > 0);
  }
  assert.match(exercise.premise, /^Planned\./);
  assert.match(exercise.worldEffect, /^Planned simulation\./);
  assert.match(exercise.signature, /function \w+\(/);
  JSON.parse(exercise.input);
  JSON.parse(exercise.output);
}
for (const key of ['title', 'lead', 'story', 'objective', 'signature'] as const) assert.equal(typeof firstMission[key], 'string');
assert.deepEqual(firstMission.parameters.map((parameter) => parameter.name), ['graph', 'start', 'goal']);
for (const parameter of firstMission.parameters) {
  for (const value of Object.values(parameter)) assert.ok(typeof value === 'string' && value.length > 0);
}
assert.ok(firstMission.rules.every((rule) => typeof rule === 'string' && rule.length > 0));
assert.match(firstMission.rules.join(' '), /100/);
assert.match(firstMission.rules.join(' '), /shortest route is not required/);
assert.match(firstMission.objective, /fallback/);
assert.match(starter, /TODO/);
assert.match(starter, /return \[start, goal\]/);
assert.equal(firstMission.examples.length, 3);

for (const example of firstMission.examples) {
  for (const value of Object.values(example)) assert.equal(typeof value, 'string');
  const input = JSON.parse(example.input) as { graph: Graph; start: string; goal: string };
  const expected = JSON.parse(example.output) as string[];
  const result = await executeInQuickJS(solution, input.graph, input.start, input.goal);
  assert.ok(result.ok, example.title);
  assert.deepEqual(result.route, expected, example.title);
  if (expected.length) assert.ok(validateRoute(expected, input.graph, input.start, input.goal).ok, example.title);
  else assert.deepEqual(input.graph, navigationChecks.find((check) => check.id === 'unreachable')!.network);
  console.log(`PASS QuickJS example: ${example.title}`);
}
assert.deepEqual(JSON.parse(firstMission.examples[0].input).graph, graph);
assert.deepEqual(JSON.parse(firstMission.examples[2].output), ['greenhouse']);
for (const check of navigationChecks) {
  const result = await executeInQuickJS(solution, check.network, 'dock', 'greenhouse');
  assert.ok(result.ok);
  assert.ok(checkNavigation(check, result.route).ok, check.id);
}
const fallback = await executeInQuickJS(starter, graph, 'dock', 'greenhouse');
assert.ok(fallback.ok);
assert.equal(validateRoute(fallback.route).ok, false);
assert.equal(validateRoute(['dock', 'relay', 'greenhouse']).ok, false);
assert.ok(validateRoute(['dock', 'relay', 'junction', 'observatory', 'garden', 'greenhouse']).ok);
assert.ok(validateRoute(['dock', 'relay', 'dock', 'relay', 'junction', 'garden', 'greenhouse']).ok,
  'cycles are not forbidden in a finite valid returned route');

let representatives = 0;
function verify<Input>(id: string, reference: (input: Input) => unknown) {
  const exercise = nextExercises.find((entry) => entry.id === id);
  assert.ok(exercise, id);
  const input = JSON.parse(exercise.input) as Input;
  const before = JSON.stringify(input);
  assert.deepEqual(reference(input), JSON.parse(exercise.output), `${id} representative output`);
  assert.equal(JSON.stringify(input), before, `${id} leaves input unchanged`);
  representatives++;
  console.log(`PASS planned example: ${id}`);
}

verify('one-crate-one-receipt', acceptDeliveries);
verify('read-the-weather', parseTelemetry);
verify('balance-the-store', balanceStock);
verify('share-the-battery', allocatePower);
verify('open-the-workshop', scheduleRepairs);
verify('steady-the-sensors', smoothSensors);
verify('raise-the-seedlings', growBed);
verify('give-the-radio-a-rest', scheduleRetries);
verify('keep-the-airlock-clear', queueTimeline);
verify('agree-on-the-beacon', reconcileBeacons);
assert.equal(representatives, nextExercises.length);

assert.deepEqual(acceptDeliveries({ deliveries: [{ receiptId: 'x', item: 'seed', units: 1 }], seen: ['x'] }), { deliveries: [], seen: ['x'] });
assert.deepEqual(acceptDeliveries({ deliveries: [], seen: [] }), { deliveries: [], seen: [] });
assert.deepEqual(acceptDeliveries({ deliveries: [{ receiptId: 'x', item: 'seed', units: 1 }, { receiptId: 'y', item: 'seed', units: 1 }], seen: [] }).seen, ['x', 'y']);
assert.deepEqual(parseTelemetry({ lines: ['a|-50|C', 'b|80|C', 'c|1e2|C', 'd||C', 'e|+2|C', 'f|NaN|C', 'g|0|c'] }), {
  readings: [{ sensor: 'a', celsius: -50 }, { sensor: 'b', celsius: 80 }], rejected: [2, 3, 4, 5, 6],
});
assert.deepEqual(parseTelemetry({ lines: ['soil|20bad|C', 'soil|86|F'] }), {
  readings: [{ sensor: 'soil', celsius: 30 }], rejected: [0],
});
assert.deepEqual(balanceStock({ stock: {}, changes: [{ id: 'a', item: 'x', delta: -1 }, { id: 'b', item: 'y', delta: 0 }] }), {
  balances: [{ item: 'y', units: 0 }], rejected: ['a'],
});
assert.deepEqual(allocatePower({ energy: 2, requests: [{ id: 'a', demand: 3, priority: 1 }, { id: 'b', demand: 2, priority: 1 }] }), { powered: ['b'], remaining: 0 });
assert.deepEqual(allocatePower({ energy: 1, requests: [{ id: 'a', demand: 1, priority: 0 }, { id: 'b', demand: 1, priority: 0 }] }).powered, ['a']);
assert.deepEqual(scheduleRepairs({ jobs: [{ id: 'a', requires: ['b'] }, { id: 'b', requires: [] }], done: ['b'] }), { batches: [['a']], blocked: [] });
assert.deepEqual(scheduleRepairs({ jobs: [{ id: 'a', requires: ['a'] }], done: [] }), { batches: [], blocked: ['a'] });
assert.deepEqual(smoothSensors({ samples: [{ t: 0, sensor: 'a', value: 1 }, { t: 0, sensor: 'a', value: 3 }, { t: 2, sensor: 'a', value: 9 }], window: 1 }).map((sample) => sample.mean), [1, 2, 9]);
assert.deepEqual(growBed({ initial: { phase: 'sprout', streak: 2 }, days: [{ water: true, light: false }, { water: true, light: true }] }), {
  timeline: [{ phase: 'wilted', streak: 0 }, { phase: 'wilted', streak: 0 }], final: { phase: 'wilted', streak: 0 },
});
assert.deepEqual(growBed({ initial: { phase: 'seed', streak: 0 }, days: [] }), { timeline: [], final: { phase: 'seed', streak: 0 } });
assert.deepEqual(scheduleRetries({ failures: [{ id: 'x', attempt: 1, failedAt: 0 }], baseDelay: 1, maxDelay: 1, maxAttempts: 1 }), { retries: [], exhausted: ['x'] });
assert.deepEqual(queueTimeline({ capacity: 0, ticks: [{ arrivals: ['a'], slots: 10 }] }), { history: [{ started: [], waiting: [], rejected: ['a'] }], waiting: [] });
assert.deepEqual(queueTimeline({ capacity: 2, ticks: [] }), { history: [], waiting: [] });
assert.deepEqual(reconcileBeacons({ events: [{ id: 'x', version: 0, kind: 'delete' }, { id: 'x', version: 0, kind: 'set', value: 'old' }] }), {
  entities: [], tombstones: [{ id: 'x', version: 0 }], ignored: [1],
});

const firstDesign = readFileSync(new URL('../research/curriculum-v3.md', import.meta.url), 'utf8');
const firstFixtures = [...firstDesign.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
assert.equal(firstFixtures.length, 6, 'first mission design has three input/output pairs');
firstMission.examples.forEach((example, index) => {
  assert.deepEqual(firstFixtures[index * 2], JSON.parse(example.input), `${example.title} documented input`);
  assert.deepEqual(firstFixtures[index * 2 + 1], JSON.parse(example.output), `${example.title} documented output`);
});

const design = readFileSync(new URL('../research/next-ten-missions.md', import.meta.url), 'utf8');
for (const exercise of nextExercises) {
  const section = design.split(`## ${exercise.order}. ${exercise.title}\n`)[1]?.split('\n## ')[0];
  assert.ok(section, `design section for ${exercise.id}`);
  assert.ok(section.includes(exercise.signature), `${exercise.id} documented signature matches UI`);
  const fixtures = [...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
  assert.equal(fixtures.length, 2, `${exercise.id} has one input/output pair`);
  assert.deepEqual(fixtures[0], JSON.parse(exercise.input), `${exercise.id} documented input`);
  assert.deepEqual(fixtures[1], JSON.parse(exercise.output), `${exercise.id} documented output`);
}

console.log('Curriculum authoring checks passed. Three displayed route examples and all three graph snapshots ran in QuickJS; ten historical follow-up examples matched trusted references and design documents. Mission 2 execution and visual behavior are covered by separate runtime and browser checks.');
