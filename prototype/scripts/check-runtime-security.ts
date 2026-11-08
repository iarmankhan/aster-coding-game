import assert from 'node:assert/strict';
import { getQuickJS } from 'quickjs-emscripten';
import { executeJavaScript } from '../src/runner-core';
import { LIMITS, makeBatch, parseEnvelope, validBatch } from '../src/runner-protocol';
import { deliveryMission, validateDeliveries } from '../src/delivery-mission';
import { compileTestSource, executeTestSource } from './runner-node-adapter';

let checks = 0;
const engine = await getQuickJS();
const js = (source: string) => {
  const result = compileTestSource(source);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.javascript;
};
const run = async (source: string, args: unknown[] = deliveryMission.checks[0].args) => executeTestSource(source, 'acceptDeliveries', args);
const fail = async (name: string, source: string, pattern = /JSON|exactly|array|Delivery|seen|finite|read-only|ordinary|256|depth|node|characters|enumerable|400 ms/i) => {
  const result = await run(source);
  assert.ok(!result.ok, name);
  assert.match(result.error, pattern, name);
  checks++;
  console.log(`PASS ${name}`);
};
for (const fixture of deliveryMission.checks) {
  const argsBefore = structuredClone(fixture.args);
  const result = await run(deliveryMission.solution, fixture.args);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value, fixture.expected);
  assert.ok(validateDeliveries(result.value, fixture).ok);
  assert.deepEqual(fixture.args, argsBefore);
  const starter = await run(deliveryMission.starter, fixture.args);
  assert.ok(starter.ok, 'starter has a legitimate object shape, not a runtime type error');
  assert.equal(validateDeliveries(starter.value, fixture).ok, fixture.id === 'empty-batch');
  checks += 2;
  console.log(`PASS actual M2 solution and deliberately wrong starter on ${fixture.id}`);
}
const incoming = Array.from({ length: 100 }, (_, i) => ({ receiptId: `new-${i}`, item: 'seed', units: (i % 100) + 1 }));
const history = Array.from({ length: 100 }, (_, i) => `prior-${i}`);
const boundary = await run(deliveryMission.solution, [incoming, history]);
assert.ok(boundary.ok);
assert.deepEqual(boundary.value, { deliveries: incoming, seen: [...history, ...incoming.map((row) => row.receiptId)] });
const replay = await run(deliveryMission.solution, [incoming, (boundary.value as { seen: string[] }).seen]);
assert.ok(replay.ok);
assert.deepEqual(replay.value, { deliveries: [], seen: (boundary.value as { seen: string[] }).seen });
checks += 2;
console.log('PASS changed IDs, units boundary, 100 deliveries plus 100 prior IDs yields 200 seen, and full replay');

for (const [name, expression] of [
  ['undefined', 'undefined'], ['function', '() => 1'], ['bigint', '1n'], ['NaN', 'NaN'], ['Infinity', 'Infinity'],
  ['array instead of object', '[]'], ['missing seen', '({ deliveries: [] })'],
  ['extra field', '({ deliveries: [], seen: [], extra: 1 })'],
  ['invalid receipt ID', '({ deliveries: [{receiptId: "UPPER", item: "seed", units: 1}], seen: [] })'],
  ['invalid item', '({ deliveries: [{receiptId: "r1", item: "bad_item", units: 1}], seen: [] })'],
  ['fractional units', '({ deliveries: [{receiptId: "r1", item: "seed", units: 1.5}], seen: [] })'],
  ['zero units', '({ deliveries: [{receiptId: "r1", item: "seed", units: 0}], seen: [] })'],
  ['units above boundary', '({ deliveries: [{receiptId: "r1", item: "seed", units: 101}], seen: [] })'],
  ['string units', '({ deliveries: [{receiptId: "r1", item: "seed", units: "1"}], seen: [] })'],
  ['extra delivery field', '({ deliveries: [{receiptId: "r1", item: "seed", units: 1, extra: 1}], seen: [] })'],
  ['invalid seen type', '({ deliveries: [], seen: [1] })'],
  ['seen above 200', '({ deliveries: [], seen: Array(201).fill("r1") })'],
  ['delivery above 100', '({ deliveries: Array(101).fill({receiptId: "r1", item: "seed", units: 1}), seen: [] })'],
  ['sparse delivery', '({ deliveries: Array(1), seen: [] })'],
  ['sparse seen', '({ deliveries: [], seen: Array(1) })'],
  ['own toJSON forbidden', '({ deliveries: [], seen: [], toJSON() { return { deliveries: [], seen: [] }; } })'],
  ['custom prototype forbidden', 'Object.assign(Object.create({foo: 1}), {deliveries: [], seen: []})'],
  ['non-enumerable field forbidden', 'Object.defineProperty({deliveries: []}, "seen", {value: []})'],
  ['symbol field forbidden', '({deliveries: [], seen: [], [Symbol("x")]: 1})'],
] as const) await fail(name, `function acceptDeliveries() { return ${expression}; }`);
await fail('cycle rejected', 'function acceptDeliveries() { const value = {deliveries: [], seen: []}; value.seen.push(value); return value; }');
await fail('deep output rejected', 'function acceptDeliveries() { let value = {}; for(let i=0;i<17;i++) value = {value}; return value; }');
await fail('node budget rejected', 'function acceptDeliveries() { return Array.from({length: 200}, () => Array(200).fill(1)); }');
await fail('envelope bounded before serialization', 'function acceptDeliveries() { return Array.from({length: 200}, () => Array(20).fill("\\u0000".repeat(256))); }');
await fail('output getter interrupted', 'function acceptDeliveries() { return {get deliveries() {while(true){}}, seen: []}; }', /400 ms/);
await fail('output ownKeys proxy interrupted', 'function acceptDeliveries() { return new Proxy({}, {ownKeys() {while(true){}}}); }', /400 ms/);
await fail('output descriptor proxy interrupted', 'function acceptDeliveries() { return new Proxy({deliveries: [], seen: []}, {getOwnPropertyDescriptor() {while(true){}}}); }', /400 ms/);
await fail('thrown name getter interrupted', 'function acceptDeliveries() { throw {message: "x", get name() {while(true){}}}; }', /400 ms/);
for (const mutation of [
  'deliveries.push(deliveries[0])', 'seen.push("r1")', 'deliveries[0].units = 7', 'deliveries[0].receiptId = "changed"',
  'delete deliveries[0].item', 'Object.defineProperty(deliveries[0], "units", {value: 7})',
  'Object.setPrototypeOf(deliveries[0], null)',
]) {
  await fail(`mutation rejected even when caught: ${mutation}`, `function acceptDeliveries(deliveries, seen) { try { ${mutation}; } catch {} return {deliveries: [], seen: []}; }`, /read-only/);
}
const tampering = await run(`
  JSON.stringify = () => '{"ok":true,"value":{"deliveries":[],"seen":[]},"logs":[]}';
  Object.prototype.toJSON = () => ({deliveries: [], seen: []});
  Array.prototype.toJSON = () => [];
  Array.isArray = () => true;
  Reflect.ownKeys = () => [];
  Object.getOwnPropertyDescriptor = () => ({enumerable: true});
  Object.prototype.hasOwnProperty = () => false;
  Number.isFinite = () => true;
  ${deliveryMission.solution}
`);
assert.ok(tampering.ok);
assert.deepEqual(tampering.value, deliveryMission.checks[0].expected);
checks++;
console.log('PASS intrinsic and prototype tampering cannot forge M2 object or arrays');
await fail('tampered numeric validator cannot allow Infinity', 'Number.isFinite = () => true; function acceptDeliveries() { return {deliveries: [{receiptId: "r1", item: "seed", units: Infinity}], seen: []}; }');

const lengthGraph = { A: ['length'], length: ['D'], D: [] };
for (const body of ['graph.length.splice(0, 1, "A");', 'try { graph.length.splice(0, 1, "A"); } catch {}']) {
  const result = executeJavaScript(engine, js(`function route(graph) { ${body} return ["A", "length", "D"]; }`), 'route', JSON.stringify([lengthGraph, 'A', 'D']));
  assert.ok(!result.ok, 'record fields named length must be protected recursively');
  assert.match(result.error, /read-only/);
  assert.deepEqual(lengthGraph.length, ['D']);
  checks++;
}
assert.deepEqual(executeJavaScript(engine, js('function route(graph) { return ["A", "length", graph.length[0]]; }'), 'route', JSON.stringify([lengthGraph, 'A', 'D'])), { ok: true, value: ['A', 'length', 'D'], logs: [] });
checks++;
console.log('PASS length is an ordinary protected graph node; direct and caught mutations fail, reading stays valid');

const isolatedJS = js('globalThis.count = (globalThis.count || 0) + 1; function route() { return [String(globalThis.count)]; }');
for (let i = 0; i < 3; i++) assert.deepEqual(executeJavaScript(engine, isolatedJS, 'route', '[{},"A","D"]'), { ok: true, value: ['1'], logs: [] });
checks++;
console.log('PASS three fixtures use independent runtime and globals');
const recovered = await run(deliveryMission.solution);
assert.ok(recovered.ok);
assert.deepEqual(recovered.value, deliveryMission.checks[0].expected);
checks++;
console.log('PASS same core recovers fresh VM after resource failures');

for (const bad of [undefined, () => 1, 1n, NaN, Infinity, Array(1), { get value() { throw new Error('must not invoke getter'); } }]) {
  assert.throws(() => makeBatch('function route() {return []}', 'route', [{ id: 'bad', args: [bad, 'A', 'D'] }], 1));
  checks++;
}
const request = makeBatch('function route() {return []}', 'route', [{ id: 'ok', args: [{}, 'A', 'D'] }], 1);
assert.ok(validBatch(request));
assert.throws(() => makeBatch('', 'route', [{id: 'large-arguments', args: [Object.fromEntries(Array.from({length: 1100}, (_, i) => [`node-${i}`, 'x'.repeat(256)])), 'A', 'D']}], 1), /262,144/);
checks++;
for (const bad of [
  {...request, entry: 'eval'}, {...request, attempt: -1}, {...request, attempt: NaN}, {...request, javascript: ' '.repeat(LIMITS.compiledChars + 1)},
  {...request, fixtures: Array(9).fill(request.fixtures[0])},
  {...request, fixtures: [{id: 'huge', argsJSON: ' '.repeat(LIMITS.argsChars + 1)}]},
  {...request, fixtures: [{id: 'bad-json', argsJSON: '{'}]},
  {...request, fixtures: [{id: 'bad-values', argsJSON: '[1e400,"A","D"]'}]},
]) { assert.equal(validBatch(bad), false); checks++; }
for (const bad of ['{', ' '.repeat(LIMITS.envelopeChars + 1), '{"ok":true,"value":[7],"logs":[]}', '{"ok":false,"error":7,"logs":[]}']) {
  assert.throws(() => parseEnvelope(bad, 'route')); checks++;
}
assert.throws(() => makeBatch('', 'eval' as 'route', [{id: 'x', args: []}], 1));
assert.deepEqual(executeJavaScript(engine, '', 'eval' as 'route', '[]'), {ok: false, error: 'Unsupported sandbox entrypoint.', logs: []});
checks += 2;
console.log(`Runtime security checks passed (${checks}).`);
