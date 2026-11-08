import assert from 'node:assert/strict';
import { getQuickJS } from 'quickjs-emscripten';
import { executeJavaScript } from '../src/runner-core';
import { LIMITS } from '../src/runner-protocol';
import type { FixtureResult } from '../src/runner-protocol';

const engine = await getQuickJS();
let checks = 0;
const run = (body: string) => executeJavaScript(engine, `function route(graph) { ${body} }`, 'route', '[{"A":["D"]},"A","D"]');
function check(name: string, body: string, expected: string[] | ((result: FixtureResult & { ok: true }) => void)) {
  const result = run(body);
  assert.ok(result.ok, `${name}: ${JSON.stringify(result)}`);
  for (const line of result.logs) {
    assert.ok(line.length <= LIMITS.logChars, name);
    assert.ok(JSON.stringify(line).length <= 4000, name);
  }
  assert.ok(result.logs.length <= LIMITS.logLines, name);
  if (typeof expected === 'function') expected(result);
  else assert.deepEqual(result.logs, expected, name);
  checks++;
  console.log(`PASS ${name}`);
}

const args = [[{ receiptId: 'r1', item: 'seed', units: 2 }], ['prior']];
const delivery = executeJavaScript(engine, `function acceptDeliveries(deliveries, seen) {
  console.log(deliveries, { seen }); return { deliveries, seen };
}`, 'acceptDeliveries', JSON.stringify(args));
assert.deepEqual(delivery, {
  ok: true, value: { deliveries: args[0], seen: args[1] },
  logs: ['[{"receiptId":"r1","item":"seed","units":2}] {"seen":["prior"]}'],
});
assert.deepEqual(args, [[{ receiptId: 'r1', item: 'seed', units: 2 }], ['prior']]);
console.log(`PASS actual delivery array and seen object -> ${delivery.logs[0]}`);
checks++;

const boundaryArgs = [
  Array.from({ length: 100 }, (_, i) => ({ receiptId: `r-${i}`, item: 'seed', units: 1 })),
  Array.from({ length: 200 }, (_, i) => `seen-${i}`),
];
const boundaryBefore = JSON.stringify(boundaryArgs);
const boundary = executeJavaScript(engine, `function acceptDeliveries(deliveries, seen) {
  console.log(deliveries, { seen }); return { deliveries, seen };
}`, 'acceptDeliveries', boundaryBefore);
assert.ok(boundary.ok);
assert.deepEqual(boundary.value, { deliveries: boundaryArgs[0], seen: boundaryArgs[1] });
assert.equal(JSON.stringify(boundaryArgs), boundaryBefore);
assert.match(boundary.logs[0], /\[Truncated\]/);
assert.ok(boundary.logs[0].length <= LIMITS.logChars);
assert.ok(JSON.stringify(boundary.logs[0]).length <= 4000);
checks++;
console.log('PASS truncated logs preserve all 100 delivery rows and 200 seen IDs');

check('nested JSON and readable top-level strings', `
  console.log('checking A', { list: [1, { done: true }], nothing: null }); return [];
`, ['checking A {"list":[1,{"done":true}],"nothing":null}']);

check('ancestor cycles differ from repeated non-cyclic references', `
  const shared = { n: 3 }, cycle = { shared }; cycle.self = cycle;
  console.log(cycle, [shared, shared]); return [];
`, ['{"shared":{"n":3},"self":"[Circular]"} [{"n":3},{"n":3}]']);

check('holes, undefined, functions, bigint, symbols, and non-finite numbers', `
  console.log([, undefined, function f() {}, 42n, NaN, Infinity, -Infinity, Symbol('x')]); return [];
`, ['["[Empty]","[Undefined]","[Function]","42n","[NaN]","[Infinity]","[-Infinity]","Symbol(x)"]']);

check('standard errors use captured prototype names and own data', `
  const error = new TypeError('wrong edge');
  error.toString = () => { throw 'coercion ran'; };
  console.log(error, new Error(), Object.create({ x: 1 })); return [];
`, ['{"name":"TypeError","message":"wrong edge"} {"name":"Error","message":""} [Object]']);

check('error own name and message accessors are not invoked', `
  const error = new Error();
  Object.defineProperty(error, 'message', { get() { while (true) {} } });
  Object.defineProperty(error, 'name', { get() { throw 'name ran'; } });
  console.log(error); return [];
`, ['{"name":"[Accessor]","message":"[Accessor]"}']);

check('ordinary throwing and infinite getters do not run', `
  const value = { get throwing() { throw 'getter ran'; }, get infinite() { while (true) {} },
    get toJSON() { while (true) {} } };
  console.log(value); return [];
`, ['{"throwing":"[Accessor]","infinite":"[Accessor]","toJSON":"[Accessor]"}']);

check('own coercion and toJSON hooks do not run', `
  const value = { toJSON() { while (true) {} }, toString() { throw 'coercion ran'; },
    valueOf() { while (true) {} }, [Symbol.toPrimitive]() { while (true) {} } };
  console.log(value); return [];
`, ['{"toJSON":"[Function]","toString":"[Function]","valueOf":"[Function]","Symbol(Symbol.toPrimitive)":"[Function]"}']);

check('inherited pollution and changed intrinsics cannot run inside logging', `
  const fail = () => { throw 'mutable intrinsic ran'; };
  Object.prototype.toJSON = Array.prototype.toJSON = fail;
  Object.prototype.toString = Array.prototype.toString = String.prototype.toString = fail;
  String.prototype.slice = Array.prototype.push = Array.prototype.map = fail;
  Object.prototype.hasOwnProperty = fail;
  Object.getOwnPropertyDescriptor = Reflect.ownKeys = Object.getPrototypeOf = fail;
  Object.defineProperty = Object.create = Object.setPrototypeOf = Object.freeze = fail;
  Array.isArray = JSON.stringify = Number.isFinite = fail;
  Number.prototype.toJSON = Boolean.prototype.toJSON = String.prototype.toJSON = BigInt.prototype.toJSON = fail;
  Symbol.prototype.toString = Function.prototype.call = Function.prototype.bind = fail;
  globalThis.String = fail;
  globalThis.Object = globalThis.Array = globalThis.JSON = globalThis.Reflect = globalThis.Number = fail;
  console.log({ safe: [1, undefined, 2n], toJSON: fail }, 'readable');
  return [];
`, ['{"safe":[1,"[Undefined]","2n"],"toJSON":"[Function]"} readable']);

check('numeric array prototype hooks disable structured stringify without invoking hooks', `
  const poison = { get() { while (true) {} }, configurable: true };
  Object.defineProperty(Object.prototype, 'inherited', poison);
  Object.defineProperty(Array.prototype, '0', poison);
  console.log({ own: 1 }, Array(1));
  delete Array.prototype[0]; delete Object.prototype.inherited; return [];
`, ['[Uninspectable] [Uninspectable]']);

check('ordinary inherited accessors are ignored', `
  Object.defineProperty(Object.prototype, 'inherited', { get() { while (true) {} }, configurable: true });
  console.log({ own: 1 }, [2]); return [];
`, ['{"own":1} [2]']);

check('inherited toJSON accessors never run for detached records or arrays', `
  const poison = { get() { while (true) {} }, configurable: true };
  Object.defineProperty(Object.prototype, 'toJSON', poison);
  Object.defineProperty(Array.prototype, 'toJSON', poison);
  Object.defineProperty(String.prototype, 'toJSON', poison);
  console.log({ own: [1] }, 'readable'); return [];
`, ['{"own":[1]} readable']);

check('numeric object prototype setters never execute in QuickJS stringify', `
  Object.defineProperty(Object.prototype, '0', { set() { while (true) {} }, configurable: true });
  console.log({ own: 1 }, ['safe'], 'readable');
  delete Object.prototype[0]; return [];
`, ['[Uninspectable] [Uninspectable] readable']);

check('changed array prototype chain does not invoke inherited numeric setters', `
  const parent = Object.create(Object.prototype);
  Object.defineProperty(parent, '0', { set() { while (true) {} } });
  Object.setPrototypeOf(Array.prototype, parent);
  console.log({ own: 1 });
  Object.setPrototypeOf(Array.prototype, Object.prototype); return [];
`, ['[Uninspectable]']);

check('proxy traps cannot install inherited hooks between snapshot and stringify', `
  const value = new Proxy({ x: 1 }, { ownKeys(target) {
    Object.defineProperty(Array.prototype, '0', { set() { while (true) {} }, configurable: true });
    return Reflect.ownKeys(target);
  }});
  console.log(value);
  delete Array.prototype[0]; return [];
`, ['[Uninspectable]']);

check('detached records preserve __proto__ and own non-enumerable data', `
  const value = JSON.parse('{"__proto__":{"safe":1}}');
  Object.defineProperty(value, 'hidden', { value: 2 });
  console.log(value); return [];
`, ['{"__proto__":{"safe":1},"hidden":2}']);

check('throwing and revoked proxies become uninspectable markers', `
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  console.log(revoked.proxy,
    new Proxy({}, { ownKeys() { throw 'no keys'; } }),
    new Proxy({x: 1}, { getOwnPropertyDescriptor() { throw 'no descriptor'; } }),
    new Proxy({}, { getPrototypeOf() { throw 'no prototype'; } }));
  return [];
`, ['[Uninspectable] [Uninspectable] [Uninspectable] [Uninspectable]']);

check('proxy get traps are not used to inspect properties or array length', `
  const traps = { get() { while (true) {} } };
  console.log(new Proxy({ x: 1 }, traps), new Proxy([2], traps)); return [];
`, ['{"x":1} [2]']);

check('proxy-reported array length never triggers coercion', `
  const length = { valueOf() { while (true) {} }, toString() { throw 'length coerced'; } };
  console.log(new Proxy([], { getOwnPropertyDescriptor(target, key) {
    return key === 'length' ? { value: length, writable: true, enumerable: false, configurable: false } :
      Object.getOwnPropertyDescriptor(target, key);
  }})); return [];
`, ['[Uninspectable]']);

check('depth bound marks containers without inspecting them', `
  const hostile = new Proxy({}, { getPrototypeOf() { while (true) {} } });
  console.log({ a: { b: { c: { d: hostile } } } }); return [];
`, ['{"a":{"b":{"c":{"d":"[Truncated]"}}}}']);

check('width bound skips later array descriptors and record values', `
  const array = Array(21).fill(1), record = {};
  Object.defineProperty(array, '20', { get() { while (true) {} } });
  for (let i = 0; i < 21; i++) record['key' + i] = i;
  const guarded = new Proxy(record, { getOwnPropertyDescriptor(target, key) {
    if (key === 'key20') while (true) {};
    return Object.getOwnPropertyDescriptor(target, key);
  }});
  console.log(array); console.log(guarded); return [];
`, (result) => {
  const array = JSON.parse(result.logs[0]), record = JSON.parse(result.logs[1]);
  assert.equal(array.length, 21);
  assert.equal(array[20], '[Truncated]');
  assert.equal(Object.keys(record).length, 21);
  assert.equal(record['[Truncated]'], '[Truncated]');
  assert.ok(!Object.hasOwn(record, 'key20'));
});

check('node budget is shared across arguments and skips hostile tail', `
  const values = Array(100).fill(1);
  values.push(new Proxy({}, { getPrototypeOf() { while (true) {} } }));
  console.log(...values); return [];
`, (result) => {
  assert.equal(result.logs[0], Array(100).fill('1').join(' ') + '[Truncated]');
});

check('node budget includes holes and accessors', `
  const values = Array(5).fill(Array(20));
  values.push(new Proxy({}, { getPrototypeOf() { while (true) {} } }));
  console.log(...values); return [];
`, (result) => {
  assert.match(result.logs[0], /\[Truncated\]/);
  assert.ok(!result.logs[0].includes('[Uninspectable]'));
});

check('raw line cap skips hostile later arguments', `
  console.log('x'.repeat(10000), new Proxy({}, { ownKeys() { while (true) {} } })); return [];
`, (result) => {
  assert.equal(result.logs[0].length, LIMITS.logChars);
  assert.ok(result.logs[0].endsWith('[Truncated]'));
});

check('encoded line cap bounds control characters and skips hostile tail', `
  console.log('\\u0000'.repeat(10000), new Proxy({}, { ownKeys() { while (true) {} } })); return [];
`, (result) => {
  assert.ok(JSON.stringify(result.logs[0]).length <= 4000);
  assert.ok(result.logs[0].length < LIMITS.logChars);
  assert.ok(result.logs[0].endsWith('[Truncated]'));
});

check('encoded structured logs remain bounded after double escaping', `
  console.log({ control: '\\u0000'.repeat(10000), quotes: '\\"\\\\'.repeat(10000),
    other: '\\ud800'.repeat(10000) }); return [];
`, (result) => {
  assert.ok(result.logs[0].endsWith('[Truncated]'));
});

check('key and nested string limits have explicit truncation markers', `
  console.log({ ['k'.repeat(1000)]: 'v'.repeat(10000) }); return [];
`, (result) => {
  const value = JSON.parse(result.logs[0]);
  const key = Object.keys(value)[0];
  assert.equal(key.length, 80);
  assert.equal(value[key].length, 200);
  assert.ok(key.endsWith('[Truncated]'));
  assert.ok(value[key].endsWith('[Truncated]'));
});

check('huge bigint primitive is captured and bounded', `
  console.log(10n ** 1000n); return [];
`, (result) => {
  assert.equal(result.logs[0].length, 200);
  assert.ok(result.logs[0].endsWith('[Truncated]n'));
});

check('twenty lines stop subsequent inspection across all console aliases', `
  const saved = console.log;
  try { console.log = () => { while (true) {} }; } catch {}
  if (!Object.isFrozen(console) || console.log !== saved) throw 'console not frozen';
  for (let i = 0; i < 20; i++) console.log({ i });
  const hostile = new Proxy({}, { ownKeys() { while (true) {} } });
  console.log(hostile); console.info(hostile); console.warn(hostile); console.error(hostile); console.debug(hostile);
  return [];
`, (result) => {
  assert.equal(result.logs.length, LIMITS.logLines);
  assert.equal(result.logs[19], '{"i":19}');
});

check('reentrant proxy logging cannot exceed the shared line cap', `
  console.log(new Proxy({ x: 1 }, { ownKeys(target) {
    for (let i = 0; i < 20; i++) console.log(i);
    return Reflect.ownKeys(target);
  }})); return [];
`, (result) => {
  assert.deepEqual(result.logs, Array.from({ length: LIMITS.logLines }, (_, i) => String(i)));
});

check('reentrant quota exhaustion skips later arguments', `
  console.log(new Proxy({ x: 1 }, { ownKeys(target) {
    for (let i = 0; i < 20; i++) console.log(i);
    return Reflect.ownKeys(target);
  }}), new Proxy({}, { ownKeys() { while (true) {} } })); return [];
`, (result) => {
  assert.deepEqual(result.logs, Array.from({ length: LIMITS.logLines }, (_, i) => String(i)));
});

check('reentrant quota exhaustion skips remaining property inspection', `
  console.log(new Proxy({ x: 1 }, {
    ownKeys(target) {
      for (let i = 0; i < 20; i++) console.log(i);
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor() { while (true) {} }
  })); return [];
`, (result) => {
  assert.deepEqual(result.logs, Array.from({ length: LIMITS.logLines }, (_, i) => String(i)));
});

check('console aliases reuse safe snapshots', `
  console.info({ n: 1 }); console.warn({ n: 2 }); console.error({ n: 3 }); console.debug({ n: 4 }); return [];
`, ['{"n":1}', '{"n":2}', '{"n":3}', '{"n":4}']);

check('twenty maximally escaped lines leave room for mission result', `
  for (let i = 0; i < 25; i++) console.log('\\u0000'.repeat(10000)); return ['A', 'D'];
`, (result) => {
  assert.equal(result.logs.length, LIMITS.logLines);
  assert.deepEqual(result.value, ['A', 'D']);
  assert.ok(JSON.stringify(result).length < LIMITS.envelopeChars);
});

const normalError = run(`console.log({ before: ['A'] }); throw new Error('blocked');`);
assert.deepEqual(normalError, { ok: false, error: 'Error: blocked', logs: ['{"before":["A"]}'] });
checks++;
console.log('PASS structured logs survive normal thrown errors');

const mutation = run(`try { graph.A[0] = 'changed'; } catch {} console.log(graph); return [];`);
assert.ok(!mutation.ok);
assert.match(mutation.error, /read-only/);
assert.deepEqual(mutation.logs, ['{"A":["D"]}']);
checks++;
console.log('PASS logging never clears caught input mutation flag');

for (const trap of ['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf']) {
  const result = run(`console.log(new Proxy({ x: 1 }, { ${trap}() { while (true) {} } })); return [];`);
  assert.ok(!result.ok, trap);
  assert.match(result.error, /400 ms/, trap);
  assert.deepEqual(run(`console.log({ fresh: true }); return ['A', 'D'];`), {
    ok: true, value: ['A', 'D'], logs: ['{"fresh":true}'],
  });
  checks += 2;
  console.log(`PASS infinite ${trap} trap fails within VM limit; fresh fixture works`);
}

console.log(`Console logging checks passed (${checks}). Actual QuickJS VM; no browser verification.`);
