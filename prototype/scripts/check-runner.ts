import assert from 'node:assert/strict';
import { executeInQuickJS, LIMITS } from './runner-node-adapter';
import type { RunnerResult } from './runner-node-adapter';

const graph = { A: ['B', 'C'], B: ['A', 'D'], C: ['A'], D: ['B'] };
const bfs = `type Graph = Record<string, string[]>;
function route(graph: Graph, start: string, goal: string): string[] {
  const queue: string[][] = [[start]];
  const visited = new Set([start]);
  while (queue.length) {
    const path = queue.shift()!;
    const node = path[path.length - 1];
    if (node === goal) return path;
    for (const next of graph[node] || []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return [];
}`;

let checks = 0;
async function check(name: string, source: string, expected: RunnerResult | ((result: RunnerResult) => void), input: unknown = graph) {
  const result = await executeInQuickJS(source, input, 'A', 'D');
  if (typeof expected === 'function') expected(result);
  else assert.deepEqual(result, expected);
  checks++;
  console.log(`PASS ${name}${result.ok ? '' : ` -> ${result.error}`}`);
  return result;
}

const fails = (pattern: RegExp) => (result: RunnerResult) => {
  assert.ok(!result.ok);
  assert.match(result.error, pattern);
  assert.ok(Array.isArray(result.logs));
};

await check('BFS follows supplied graph', bfs, { ok: true, route: ['A', 'B', 'D'], logs: [] });
await check('BFS responds to changed graph', bfs, { ok: true, route: ['A', 'D'], logs: [] }, { A: ['D'], D: [] });
await check('BFS unreachable result', bfs, { ok: true, route: [], logs: [] }, { A: [] });
await check('TypeScript syntax error with code and position', 'function route( {', fails(/TypeScript TS\d+ \(\d+:\d+\):/));
await check('TypeScript annotation syntax error', 'const broken: = 3; function route() { return []; }', fails(/TypeScript TS1110.*Type expected/));
await check('annotated runtime error', 'function route(): string[] { throw new Error("Try another edge"); }', fails(/Try another edge/));
await check('interfaces and generics', `
  interface Mission { start: string; goal: string }
  function pair<T>(first: T, last: T): T[] { return [first, last]; }
  const route = (_graph: Record<string, string[]>, start: string, goal: string): string[] => {
    const mission: Mission = { start, goal };
    return pair<string>(mission.start, mission.goal);
  };
`, { ok: true, route: ['A', 'D'], logs: [] });
await check('Node-only trusted adapter skips semantic checking; browser compile does not', `
  const notAString: string = 7;
  function route(): string[] { return [String(notAString)]; }
`, { ok: true, route: ['7'], logs: [] });
await check('compiler diagnostics bounded', 'const broken: = 3;\n'.repeat(1000), (result) => {
  fails(/TypeScript TS/)(result);
  assert.ok(!result.ok);
  assert.ok(result.error.length <= LIMITS.errorChars);
  assert.ok(result.error.split('\n').length <= 3);
});
await check('emitted code bounded', Array.from({ length: 1500 }, (_, i) => `enum E${i} { A, B, C, D }`).join('\n'), fails(/Compiled code exceeds 262,144/));
await check('missing route', 'const answer = 42;', fails(/Define function route/));
await check('lexical route binding', 'const route = (g, s, t) => [s, t];', { ok: true, route: ['A', 'D'], logs: [] });
await check('reject non-array', 'function route() { return "A,D"; }', fails(/array/));
await check('reject async route', 'async function route() { return ["A"]; }', fails(/array/));
await check('reject numeric IDs', 'function route() { return [1]; }', fails(/string/));
await check('reject sparse route', 'function route() { return Array(2); }', fails(/dense/));
await check('reject >100 nodes', 'function route() { return Array(101).fill("A"); }', fails(/at most 100/));
await check('accept 100 nodes', 'function route() { return Array(100).fill("A"); }', (result) => {
  assert.ok(result.ok);
  assert.equal(result.route.length, 100);
});
await check('bound ID size', 'function route() { return ["x".repeat(257)]; }', fails(/256/));
await check('infinite loop interrupted', 'function route() { while (true) {} }', fails(/400 ms/));
await check('top-level loop interrupted', 'while (true) {}', fails(/400 ms/));
await check('hostile output getter interrupted', 'function route() { return new Proxy([], { get() { while (true) {} } }); }', fails(/400 ms/));
await check('hostile thrown getter interrupted', 'function route() { throw { get message() { while (true) {} } }; }', fails(/400 ms/));
await check('24 MiB heap rejects 64 MiB buffer', 'function route() { return [new ArrayBuffer(64 * 1024 * 1024)]; }', fails(/memory|allocation|limit/i));
await check('recursive stack bounded', 'function route() { return route(); }', fails(/stack/i));
await check('logs bounded', 'function route() { for(let i=0;i<100;i++) console.log("x".repeat(10000)); return []; }', (result) => {
  assert.ok(result.ok);
  assert.equal(result.logs.length, LIMITS.logLines);
  assert.ok(result.logs.every((line) => line.length === LIMITS.logChars));
});
await check('logs survive normal errors', 'function route() { console.log("checking", "A"); throw "blocked"; }', {
  ok: false, error: 'blocked', logs: ['checking A'],
});
await check('host APIs absent including constructor lookup', `function route() {
  return ['fetch', 'document', 'window', 'self', 'process', 'require', 'XMLHttpRequest',
    'WebSocket', 'Worker', 'postMessage', 'importScripts', 'navigator', 'localStorage',
    'setTimeout', 'Deno', 'Bun'].map(name => name + '=' + typeof globalThis[name])
    .concat(Function('return typeof fetch')());
}`, (result) => {
  assert.ok(result.ok);
  assert.ok(result.route.every((entry) => entry === 'undefined' || entry.endsWith('=undefined')));
});
await check('network call denied', 'function route() { fetch("https://example.invalid"); return []; }', fails(/fetch.*not defined/));
await check('module imports denied', 'import fs from "node:fs"; function route() { return []; }', fails(/SyntaxError/));
await check('live module imports denied', 'import { readFileSync } from "node:fs"; function route() { return [readFileSync("/etc/passwd", "utf8")]; }', fails(/SyntaxError/));
await check('user intrinsic changes cannot replace validator', `
  JSON.stringify = () => '{"ok":true,"route":["forged"],"logs":[]}';
  Array.isArray = () => true;
  Array.prototype.toJSON = () => ['forged'];
  Object.prototype.toJSON = () => ({ forged: true });
  function route() { console.log('still captured'); return ['A', 'D']; }
`, { ok: true, route: ['A', 'D'], logs: ['still captured'] });
await check('JSON graph escaping and clone', `function route(g) {
  if (g['__proto__'].marker !== 'data') throw 'Lost JSON data';
  return [g.quote];
}`, { ok: true, route: ['"; throw new Error("injected"); //'], logs: [] }, JSON.parse(
  '{"A":[],"__proto__":{"marker":"data"},"quote":"\\\"; throw new Error(\\\"injected\\\"); //"}',
));
await check('caller graph unchanged and guest mutation rejected', 'function route(g) { g.A.push("changed"); return []; }', fails(/read-only/));
assert.deepEqual(graph.A, ['B', 'C']);
await check('fresh context after resource errors', bfs, { ok: true, route: ['A', 'B', 'D'], logs: [] });
await check('bound source size', ' '.repeat(LIMITS.sourceChars + 1), fails(/65,536/));
await check('bound graph data', bfs, fails(/256|262,144/), { huge: 'x'.repeat(LIMITS.argsChars) });
const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
await check('reject cyclic graph', bfs, fails(/JSON-serializable/), cyclic);

await check('enum emit', 'enum Stop { Start = "A", End = "D" } function route() { return [Stop.Start, Stop.End]; }', { ok: true, route: ['A', 'D'], logs: [] });
await check('caught input mutation still rejects', 'function route(g) { try { g.A[0] = "D"; } catch {} return ["A", "D"]; }', fails(/read-only/));
await check('normal console never invokes object coercion', 'function route() { console.log({ toString() { while (true) {} } }, () => 1, Symbol("x"), 7); return []; }', { ok: true, route: [], logs: ['{"toString":"[Function]"} [Function] Symbol(x) 7'] });
await check('guest thrown messages bounded', 'function route() { throw new Error("x".repeat(10000)); }', (result) => {
  assert.ok(!result.ok);
  assert.equal(result.error.length, LIMITS.errorChars);
});

console.log(`Guest runner checks passed (${checks}). Protocol and real-browser checks run separately.`);
