import assert from 'node:assert/strict';
import ts from 'typescript';
import { nextExercises } from '../src/curriculum';
import { deliveryMission, validateDeliveries } from '../src/delivery-mission';
import type { Delivery, DeliveryCheck, IntakeResult } from '../src/delivery-mission';

// Only these statically authored, trusted functions execute in Node. Guest source never does.
function reference(deliveries: Delivery[], seen: string[]): IntakeResult {
  const history = [...seen];
  const accepted: Delivery[] = [];
  for (const row of deliveries) {
    if (history.includes(row.receiptId)) continue;
    history.push(row.receiptId);
    accepted.push({ ...row });
  }
  return { deliveries: accepted, seen: history };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const clone = <T>(value: T): T => structuredClone(value);
const { checks, brief } = deliveryMission;
assert.equal(deliveryMission.id, 'one-crate-one-receipt');
assert.equal(checks.length, 5, 'exactly five disclosed datasets');
assert.equal(new Set(checks.map((check) => check.id)).size, checks.length);
assert.equal(brief.examples.length, 3);
assert.equal(brief.parameters.map((parameter) => parameter.name).join(','), 'deliveries,seen');
for (const text of [brief.lead, brief.story, brief.objective, ...brief.rules, ...deliveryMission.hints]) assert(text.trim());
assert.equal(deliveryMission.hints.length, 3);
assert.match(deliveryMission.starter, /TODO/);
assert.match(deliveryMission.starter, /deliberately wrong/);
assert.match(deliveryMission.starter, /return \{ deliveries, seen \};/);

const plan = nextExercises.find((exercise) => exercise.id === deliveryMission.id)!;
assert(plan, 'legacy curriculum contains the authored Mission 2 contract');
const compactSignature = (signature: string): string => signature.replace(/\s+/g, '');
assert.equal(compactSignature(brief.signature), compactSignature(plan.signature), 'display contract differs from canonical contract only in whitespace');
assert.deepEqual(JSON.parse(brief.examples[0].input), JSON.parse(plan.input));
assert.deepEqual(JSON.parse(brief.examples[0].output), JSON.parse(plan.output));
assert.deepEqual(checks[0].args, [JSON.parse(plan.input).deliveries, JSON.parse(plan.input).seen]);
assert.deepEqual(checks[0].expected, JSON.parse(plan.output));

for (const check of checks) {
  assert(check.title.trim() && check.detail.trim());
  const args = freeze(clone(check.args));
  const before = JSON.stringify(args);
  const actual = reference(...args);
  assert.deepEqual(actual, check.expected, `${check.id} independently authored reference`);
  assert.equal(JSON.stringify(args), before, `${check.id} preserves frozen input rows and arrays`);
  const result = validateDeliveries(freeze(actual), check);
  assert(result.ok, `${check.id} validates trusted output`);
  assert.deepEqual(result.value, check.expected);
  assert.notEqual(result.value, actual, 'validator returns clean data, not the supplied object');
}
for (const example of brief.examples) {
  const input = JSON.parse(example.input) as { deliveries: Delivery[]; seen: string[] };
  const actual = reference(...freeze<[Delivery[], string[]]>([input.deliveries, input.seen]));
  assert.deepEqual(actual, JSON.parse(example.output), example.title);
  assert(example.explanation.trim());
  assert(checks.some((check) => JSON.stringify(check.args) === JSON.stringify([input.deliveries, input.seen])), 'displayed example uses a disclosed fixture');
}
const replay = reference(checks[0].args[0], checks[0].expected.seen);
assert.deepEqual(replay, checks[3].expected, 'replay fixture uses returned history');

type TrustedImplementation = (deliveries: Delivery[], seen: string[]) => IntakeResult;
const flawed: { name: string; run: TrustedImplementation }[] = [
  {
    name: 'deduplicate by item',
    run(deliveries, seen) {
      const items = new Set<string>();
      const accepted = reference(deliveries, seen).deliveries.filter((row) => {
        if (items.has(row.item)) return false;
        items.add(row.item);
        return true;
      });
      return { deliveries: accepted, seen: [...seen, ...accepted.map((row) => row.receiptId)] };
    },
  },
  {
    name: 'last payload wins',
    run(deliveries, seen) {
      const accepted = new Map<string, Delivery>();
      for (const row of deliveries) if (!seen.includes(row.receiptId)) accepted.set(row.receiptId, row);
      return { deliveries: [...accepted.values()], seen: [...seen, ...accepted.keys()] };
    },
  },
  {
    name: 'only check initial seen',
    run(deliveries, seen) {
      const accepted = deliveries.filter((row) => !seen.includes(row.receiptId));
      return { deliveries: accepted, seen: [...seen, ...accepted.map((row) => row.receiptId)] };
    },
  },
  { name: 'unfiltered fallback', run: (deliveries, seen) => ({ deliveries, seen }) },
  {
    name: 'sort accepted receipts',
    run(deliveries, seen) {
      const result = reference(deliveries, seen);
      result.deliveries.sort((a, b) => a.receiptId < b.receiptId ? -1 : a.receiptId > b.receiptId ? 1 : 0);
      return result;
    },
  },
  {
    name: 'inherited dictionary keys count as receipts',
    run(deliveries, seen) {
      const known: Record<string, boolean> = {};
      for (const id of seen) known[id] = true;
      const accepted: Delivery[] = [];
      for (const row of deliveries) {
        if (known[row.receiptId]) continue;
        known[row.receiptId] = true;
        accepted.push(row);
      }
      return { deliveries: accepted, seen: [...seen, ...accepted.map((row) => row.receiptId)] };
    },
  },
  { name: 'memorized first manifest', run: () => clone(checks[0].expected) },
];
for (const implementation of flawed) {
  const rejected = checks.filter((check) => !validateDeliveries(implementation.run(...freeze(clone(check.args))), check).ok);
  assert(rejected.length > 0, `${implementation.name} must fail a disclosed check`);
  console.log(`Rejected trusted flawed implementation: ${implementation.name} (${rejected.map((check) => check.id).join(', ')})`);
}

function rejects(value: unknown, message: RegExp, check: DeliveryCheck = checks[0]): void {
  const result = validateDeliveries(value, check);
  assert(!result.ok, 'malformed or behaviorally incorrect result must fail');
  assert.match(result.error, message);
}

rejects({ deliveries: checks[0].args[0], seen: checks[0].args[1] }, /old.*replayed scan/);
rejects(flawed[0].run(...clone(checks[2].args)), /Missing new receipt "seed-2"/, checks[2]);
rejects(flawed[1].run(...clone(checks[1].args)), /z9.*payload changed/, checks[1]);
rejects({ deliveries: [...checks[0].expected.deliveries, checks[0].expected.deliveries[0]], seen: checks[0].expected.seen }, /r1.*accepted twice/);
rejects({ ...checks[1].expected, deliveries: [...checks[1].expected.deliveries].reverse() }, /Delivery order.*z9/, checks[1]);
rejects({ ...checks[1].expected, seen: [...checks[1].expected.seen].sort() }, /history.*seen\[0\].*prior seen order/, checks[1]);
rejects({ ...checks[0].expected, seen: ['old'] }, /history.*r1/);
rejects({ ...checks[0].expected, deliveries: [{ receiptId: 'invented', item: 'cell', units: 1 }] }, /Wrong receipt "invented"/);
rejects({ ...checks[0].expected, seen: [...checks[0].expected.seen, 'extra'] }, /no further ID/);
rejects({ ...checks[0].expected, seen: ['old', 'r1', 'r1'] }, /r1.*twice in seen/);

for (const value of [null, [], '[]', JSON.stringify(checks[0].expected), 1, true, {}, new Date(), new Map(),
  { ...checks[0].expected, extra: true }, Object.assign(Object.create(null), checks[0].expected),
  Object.create(checks[0].expected)]) rejects(value, /ordinary JSON object/);
for (const deliveries of ['r1', {}, new Uint8Array(), new Array(1), Array(101).fill(checks[0].expected.deliveries[0])]) {
  rejects({ ...checks[0].expected, deliveries }, /dense ordinary JSON array.*100/);
}
for (const seen of ['old', {}, new Array(1), Array(201).fill('old')]) {
  rejects({ ...checks[0].expected, seen }, /dense ordinary JSON array.*200/);
}
for (const row of [null, [], {}, { receiptId: 'r1', item: 'seed' },
  { ...checks[0].expected.deliveries[0], extra: 1 }, Object.create(checks[0].expected.deliveries[0])]) {
  rejects({ ...checks[0].expected, deliveries: [row] }, /row 1.*exactly/);
}
for (const receiptId of [undefined, null, 3, '', 'R1', 'a_b', 'é', 'a'.repeat(33)]) {
  rejects({ ...checks[0].expected, deliveries: [{ receiptId, item: 'seed', units: 3 }] }, /invalid receiptId/);
}
for (const item of [undefined, null, 3, '', 'Seed', 'a_b', 'é', 'a'.repeat(33)]) {
  rejects({ ...checks[0].expected, deliveries: [{ receiptId: 'r1', item, units: 3 }] }, /invalid item ID/);
}
for (const units of [-1, 0, 101, 1.5, NaN, Infinity, -Infinity, '3', null, undefined]) {
  rejects({ ...checks[0].expected, deliveries: [{ receiptId: 'r1', item: 'seed', units }] }, /units must be an integer/);
}
for (const id of [null, 1, {}, '', 'R1', 'a_b', 'é', 'a'.repeat(33)]) {
  rejects({ ...checks[0].expected, seen: [id] }, /seen entry 1.*receipt ID/);
}

let accessorCalls = 0;
const accessor = { enumerable: true, get() { accessorCalls++; throw new Error('Accessor must not execute'); } };
rejects(Object.defineProperty({ seen: [] }, 'deliveries', accessor), /ordinary JSON object/);
rejects({ ...checks[0].expected, deliveries: [Object.defineProperty({ item: 'seed', units: 3 }, 'receiptId', accessor)] }, /exactly/);
rejects({ ...checks[0].expected, deliveries: Object.defineProperty([null], '0', accessor) }, /dense ordinary JSON array/);
assert.equal(accessorCalls, 0, 'reject accessors without invoking them');
const decoratedArray = Object.assign(clone(checks[0].expected.deliveries), { extra: true });
rejects({ ...checks[0].expected, deliveries: decoratedArray }, /dense ordinary JSON array/);
rejects({ ...checks[0].expected, [Symbol('extra')]: 1 }, /ordinary JSON object/);
rejects({ ...checks[0].expected, deliveries: [Object.defineProperty({ ...checks[0].expected.deliveries[0] }, 'item', { enumerable: false })] }, /exactly/);

const reordered = {
  seen: [...checks[0].expected.seen],
  deliveries: checks[0].expected.deliveries.map(({ units, item, receiptId }) => ({ units, item, receiptId })),
};
assert(validateDeliveries(reordered, checks[0]).ok, 'object field order has no effect');

const boundaryArgs: [Delivery[], string[]] = [
  Array.from({ length: 100 }, (_, index) => ({ receiptId: `new-${index}`, item: index % 2 ? 'constructor' : 'seed', units: index % 2 ? 100 : 1 })),
  Array.from({ length: 100 }, (_, index) => `old-${index}`),
];
boundaryArgs[0][0].receiptId = `a${'z'.repeat(31)}`;
const boundary: DeliveryCheck = {
  id: 'boundary-only-test', title: 'Maximum disclosed size', detail: '100 prior IDs plus 100 new receipts.',
  args: boundaryArgs, expected: reference(...freeze(clone(boundaryArgs))),
};
assert.equal(boundary.expected.seen.length, 200);
assert(validateDeliveries(boundary.expected, boundary).ok, '100 input rows and 100 seen IDs can return 200 history IDs');
const boundaryReplay = reference(...freeze<[Delivery[], string[]]>([clone(boundaryArgs[0]), clone(boundary.expected.seen.slice(100))]));
assert.deepEqual(boundaryReplay.deliveries, [], '100 known receipts replay without adding cargo');
assert.deepEqual(boundaryReplay.seen, boundary.expected.seen.slice(100));

for (const source of [deliveryMission.starter, deliveryMission.solution]) {
  assert(compactSignature(source).includes(compactSignature(brief.signature.slice(brief.signature.indexOf('function ')))), 'editor source uses the authored function signature regardless of display whitespace');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics?.length ?? 0, 0, 'editor source transpiles without executing it');
  assert.match(compiled.outputText, /function acceptDeliveries\(/);
}
console.log('PASS: five fixtures, three displayed examples, legacy contract parity, seven flawed implementations, JSON bounds, diagnostic checks, and source transpilation.');
console.log('This authoring check covers data and validation only. Separate runtime, security and browser checks cover guest execution, playback and progression.');
