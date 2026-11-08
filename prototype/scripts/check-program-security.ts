import assert from 'node:assert/strict';
import { getQuickJS } from 'quickjs-emscripten';
import { missionCatalog, missionIds } from '../src/mission-catalog';
import { executeJavaScript } from '../src/runner-core';
import { LIMITS, copyJSON, entryArities, isEntry, makeBatch, parseArgs, parseEnvelope, validBatch, type RunnerEntry } from '../src/runner-protocol';
import { validateProgram } from '../src/program-validation';

const engine = await getQuickJS();
assert.deepEqual(Object.values(entryArities), [3, 2, 1, 2, 2, 2, 2, 2, 4, 2, 1]);
assert.deepEqual(Object.keys(entryArities), missionIds.map((id) => missionCatalog[id].entry));
assert.deepEqual([LIMITS.fixtures, LIMITS.runtimeMs, LIMITS.memoryBytes, LIMITS.stackBytes, LIMITS.nodes, LIMITS.depth, LIMITS.arrayItems], [8, 400, 24 * 1024 * 1024, 128 * 1024, 4096, 16, 200]);
for (const entry of ['eval', 'constructor', '__proto__', 'toString', 'route;globalThis', '', null]) {
  assert(!isEntry(entry));
  const result = executeJavaScript(engine, 'throw Error("MUST NOT LOAD")', entry as RunnerEntry, '[]');
  assert(!result.ok && result.error === 'Unsupported sandbox entrypoint.');
  assert.throws(() => parseEnvelope('{"ok":true,"value":{},"logs":[]}', entry as RunnerEntry), /Unsupported/);
  assert.throws(() => parseArgs('[]', entry as RunnerEntry), /Unsupported/);
}
let checks = 0;
for (const id of missionIds.slice(2)) {
  const { entry, args: names } = missionCatalog[id];
  const args = names.map((_name, index) => ({ marker: index, values: [1, 2] }));
  const text = JSON.stringify(args);
  const run = (body: string) => executeJavaScript(engine, `function ${entry}(...args) { ${body} }`, entry, text);
  const request = makeBatch('', entry, [{ id: 'security', args }], 1);
  assert(validBatch(request));
  assert.deepEqual(parseArgs(text, entry), args);
  assert.throws(() => parseArgs(JSON.stringify([...args, null]), entry), /arguments/);
  assert.throws(() => parseArgs(JSON.stringify(args.slice(1)), entry), /arguments/);
  assert.deepEqual(run('console.log("public"); return { count: args.length, first: args[0].marker, last: args[args.length - 1].marker };'), {
    ok: true, value: { count: args.length, first: 0, last: args.length - 1 }, logs: ['public'],
  });
  for (const mutation of ['args[0].marker = 9', 'args[0].values.push(3)', 'delete args[0].marker', 'Object.setPrototypeOf(args[0], null)', `args[${args.length - 1}].marker = 9`]) {
    const result = run(`try { ${mutation}; } catch {} return {};`);
    assert(!result.ok && /read-only/.test(result.error), `${id} rejects caught mutation ${mutation}`);
    checks++;
  }
  const lateMutation = run('return { get value() { try { args[0].marker = 9; } catch {} return 1; } };');
  assert(!lateMutation.ok && /read-only/.test(lateMutation.error), `${id} checks mutation after copying`);
  for (const expression of ['NaN', 'Infinity', 'undefined', '1n', 'new Date()', 'new Map()', 'Object.create({polluted: true})', 'Object.assign([1], {extra: 1})', 'Array(2)', 'new Uint8Array(2)']) {
    assert(!run(`return ${expression};`).ok, `${id} rejects ${expression}`);
    checks++;
  }
  const captured = run('JSON.stringify = () => "forged"; Number.isFinite = () => true; return Infinity;');
  assert(!captured.ok, `${id} uses captured intrinsics`);
  const isolated = run('if (globalThis.seen) throw Error("shared"); globalThis.seen = true; return {ok: true};');
  assert(isolated.ok);
  assert(run('if (globalThis.seen) throw Error("shared"); return {ok: true};').ok, 'each fixture owns a fresh VM');
  assert(!run('return Array.from({length: 200}, () => Array(200).fill(1));').ok, 'node budget is unchanged');
  assert(!run('return Array.from({length: 200}, () => Array(20).fill("\\u0000".repeat(256)));').ok, 'envelope budget is unchanged');
}
for (const id of ['read-the-weather', 'balance-the-store', 'give-the-radio-a-rest'] as const) {
  const { entry, args } = missionCatalog[id];
  const result = executeJavaScript(engine, `function ${entry}() { while (true) {} }`, entry, JSON.stringify(args.map(() => null)));
  assert(!result.ok && /400 ms/.test(result.error), `${args.length}-argument timeout is bounded`);
}
for (const invalid of [NaN, Infinity, new Date(), new Map(), Object.create({x: 1}), Array(2), Object.assign([1], {extra: 1}), Object.defineProperty({}, 'x', {get() { throw Error('getter invoked'); }, enumerable: true})]) {
  assert.throws(() => copyJSON(invalid));
  assert(validateProgram('read-the-weather', invalid, {}));
}
const cycle: unknown[] = []; cycle.push(cycle);
assert.throws(() => copyJSON(cycle));
assert(validateProgram('read-the-weather', cycle, []));
assert.throws(() => parseEnvelope('{"ok":true,"value":1e999,"logs":[]}', 'parseTelemetry'));
assert.throws(() => parseEnvelope('{"ok":true,"value":{},"logs":[],"extra":true}', 'parseTelemetry'));
assert.throws(() => parseEnvelope('{"ok":true,"value":{},"logs":[7]}', 'parseTelemetry'));
assert.throws(() => parseEnvelope('{"ok":true,"value":{},"logs":[]}', 'acceptDeliveries'), /shape/);
assert.throws(() => parseEnvelope('{"ok":true,"value":{},"logs":[]}', 'route'), /shape/);
const weather = {readings: [{sensor: 'soil', celsius: 20}], rejected: [2]};
assert.equal(validateProgram('read-the-weather', {rejected: [2], readings: [{celsius: 20 + 5e-10, sensor: 'soil'}]}, weather), null);
assert.match(validateProgram('read-the-weather', {...weather, rejected: [2 + 5e-10]}, weather)!, /result\.rejected\[0\]/);
assert.match(validateProgram('read-the-weather', {readings: [{sensor: 'soil', celsius: 20 + 2e-9}], rejected: [2]}, weather)!, /result\.readings\[0\]\.celsius/);
assert(validateProgram('read-the-weather', {...weather, extra: true}, weather));
assert(validateProgram('read-the-weather', {readings: [{...weather.readings[0], extra: true}], rejected: [2]}, weather));
assert(validateProgram('read-the-weather', {readings: [{sensor: 'soil', celsius: '20'}], rejected: [2]}, weather));
const sensors = [{t: 3, sensor: 'soil', mean: 1 / 3}];
assert.equal(validateProgram('steady-the-sensors', [{mean: 1 / 3 + 5e-10, sensor: 'soil', t: 3}], sensors), null);
assert(validateProgram('steady-the-sensors', [{...sensors[0], t: 3 + 5e-10}], sensors));
const sensorsWithExtra = Object.assign([...sensors], {extra: true});
assert(validateProgram('steady-the-sensors', sensorsWithExtra, sensors));
const sparseSensors = Array(1);
assert(validateProgram('steady-the-sensors', sparseSensors, sensors));
for (const [id, output] of [
  ['balance-the-store', {balances: [{item: 'seed', units: 1}], rejected: ['a', 'b']}],
  ['share-the-battery', {powered: ['pump', 'beacon'], remaining: 1}],
  ['open-the-workshop', {batches: [['a'], ['b']], blocked: ['c']}],
  ['raise-the-seedlings', {timeline: [{phase: 'seed', streak: 1}], final: {phase: 'seed', streak: 1}}],
  ['give-the-radio-a-rest', {retries: [{id: 'a', attempt: 2, dueAt: 110}], exhausted: []}],
  ['keep-the-airlock-clear', {history: [{started: ['a'], waiting: ['b'], rejected: ['c']}], waiting: ['b']}],
  ['agree-on-the-beacon', {entities: [{id: 'pump', value: 'on', version: 1}], tombstones: [{id: 'gate', version: 2}], ignored: [3]}],
] as const) {
  assert.equal(validateProgram(id, output, output), null);
  const changed = JSON.parse(JSON.stringify(output), (_key, value) => typeof value === 'number' ? value + 5e-10 : value);
  if (JSON.stringify(changed) !== JSON.stringify(output)) assert(validateProgram(id, changed, output), `${id} has no floating tolerance`);
}
assert(validateProgram('share-the-battery', {powered: ['beacon', 'pump'], remaining: 1}, {powered: ['pump', 'beacon'], remaining: 1}));
assert(validateProgram('open-the-workshop', {batches: [['a', 'b']], blocked: []}, {batches: [['a'], ['b']], blocked: []}));
console.log(`Program security passed. ${checks} guest rejection checks across nine entries, 1/2/4-argument deadlines, captured intrinsics, fresh VMs, mutation pre/post checks, exact allowlist and unchanged limits.`);
