import type { MissionBrief } from './curriculum';

export type Delivery = { receiptId: string; item: string; units: number };
export type IntakeResult = { deliveries: Delivery[]; seen: string[] };
export type DeliveryCheck = {
  id: string;
  title: string;
  detail: string;
  args: [Delivery[], string[]];
  expected: IntakeResult;
};

const checks: DeliveryCheck[] = [
  {
    id: 'manifest',
    title: 'The arriving manifest',
    detail: 'Ignore old, accept the first r1 with three seed units, then r2 with one cell. The nine-unit r1 is a repeated scan.',
    args: [[
      { receiptId: 'old', item: 'seed', units: 2 },
      { receiptId: 'r1', item: 'seed', units: 3 },
      { receiptId: 'r1', item: 'seed', units: 9 },
      { receiptId: 'r2', item: 'cell', units: 1 },
    ], ['old']],
    expected: {
      deliveries: [{ receiptId: 'r1', item: 'seed', units: 3 }, { receiptId: 'r2', item: 'cell', units: 1 }],
      seen: ['old', 'r1', 'r2'],
    },
  },
  {
    id: 'first-copy-and-order',
    title: 'First copy, not last copy',
    detail: 'Keep z9 before a2, keep z9\'s original payload, and retain the prior z-old, a-old history order. Do not sort either output.',
    args: [[
      { receiptId: 'z9', item: 'water', units: 4 },
      { receiptId: 'a2', item: 'seed', units: 1 },
      { receiptId: 'z9', item: 'cell', units: 100 },
      { receiptId: 'z-old', item: 'water', units: 8 },
    ], ['z-old', 'a-old']],
    expected: {
      deliveries: [{ receiptId: 'z9', item: 'water', units: 4 }, { receiptId: 'a2', item: 'seed', units: 1 }],
      seen: ['z-old', 'a-old', 'z9', 'a2'],
    },
  },
  {
    id: 'receipt-not-item',
    title: 'Two seed receipts are two deliveries',
    detail: 'constructor is a legal receipt ID, not a reserved dictionary key. Both new seed receipts enter storage; to-string was already accepted.',
    args: [[
      { receiptId: 'constructor', item: 'seed', units: 1 },
      { receiptId: 'seed-2', item: 'seed', units: 100 },
      { receiptId: 'constructor', item: 'water', units: 6 },
      { receiptId: 'to-string', item: 'cell', units: 2 },
    ], ['to-string']],
    expected: {
      deliveries: [{ receiptId: 'constructor', item: 'seed', units: 1 }, { receiptId: 'seed-2', item: 'seed', units: 100 }],
      seen: ['to-string', 'constructor', 'seed-2'],
    },
  },
  {
    id: 'replay',
    title: 'Replay the arriving manifest',
    detail: 'Use the history returned by the arriving manifest. Every receipt is known, so no delivery enters storage and history stays unchanged.',
    args: [[
      { receiptId: 'old', item: 'seed', units: 2 },
      { receiptId: 'r1', item: 'seed', units: 3 },
      { receiptId: 'r1', item: 'seed', units: 9 },
      { receiptId: 'r2', item: 'cell', units: 1 },
    ], ['old', 'r1', 'r2']],
    expected: { deliveries: [], seen: ['old', 'r1', 'r2'] },
  },
  {
    id: 'empty-batch',
    title: 'No arrivals this shift',
    detail: 'An empty scanner batch accepts nothing. Preserve the non-alphabetical receipt history, including constructor.',
    args: [[], ['z-old', 'constructor', 'a-old']],
    expected: { deliveries: [], seen: ['z-old', 'constructor', 'a-old'] },
  },
];

const signature = 'function acceptDeliveries(deliveries: Delivery[], seen: string[]): { deliveries: Delivery[]; seen: string[] }';
const json = (value: unknown): string => JSON.stringify(value, null, 2);

export const deliveryMission: {
  id: 'one-crate-one-receipt';
  brief: MissionBrief;
  starter: string;
  solution: string;
  hints: string[];
  checks: DeliveryCheck[];
} = {
  id: 'one-crate-one-receipt',
  brief: {
    title: 'One crate, one receipt',
    lead: 'Give Neri an honest manifest. Accept each new receipt once, even when the dock scanner repeats itself.',
    story: 'Pip has delivered the greenhouse cell. At the supply dock, ferry pilot Neri has found repeated receipt scans in the unloading record. Counting every scan promises supplies the station has not received.\n\nThe first copy of a receipt is authoritative, even if a later scan claims different contents. Neri needs accepted deliveries and an updated receipt history before she can sign the manifest.',
    objective: 'Repair `acceptDeliveries(deliveries, seen)` by replacing the unfiltered starter fallback.',
    goalSteps: [
      'Accept only the first unseen copy of each `receiptId`.',
      'Keep accepted rows unchanged, in arrival order.',
      'Return `{ deliveries, seen }`, with new IDs after the prior history.',
      'Leave inputs unchanged. Replaying with returned history adds no deliveries.',
    ],
    signature: `type Delivery = {
  receiptId: string;
  item: string;
  units: number
};

function acceptDeliveries(
  deliveries: Delivery[],
  seen: string[]
): {
  deliveries: Delivery[];
  seen: string[]
}`,
    parameters: [
      { name: 'deliveries', type: 'Delivery[]', description: 'An ordered batch of JSON delivery records, not a graph or route. Each row has `receiptId`, `item`, and integer `units` from 1 through 100. The array has 0 through 100 rows.\n\nThe actual first batch contains `old`, `r1`, another `r1` with nine units, then `r2`.' },
      { name: 'seen', type: 'string[]', description: 'Unique receipt IDs already accepted, in prior-acceptance order. This array has 0 through 100 IDs.\n\nThe actual first batch starts with `["old"]`. Use returned history as `seen` when replaying a batch.' },
    ],
    rules: [
      'Inputs satisfy the stated types and bounds. Receipt and item IDs are case-sensitive ASCII strings matching `^[a-z][a-z0-9-]{0,31}$`.\n\nUse lowercase letters, digits after the first letter, and hyphens. `constructor` is legal. Uppercase IDs are outside this grammar. Do not normalize, reserve, or memorize IDs.',
      'Read `deliveries` in input order. Ignore receipts already in `seen`.\n\nFor each other receipt, accept its first occurrence. Remember its ID immediately so later copies in this batch cannot be accepted.',
      'Return accepted rows unchanged, including `receiptId`, `item`, and `units`. A conflicting later payload never replaces the first accepted copy.\n\nDifferent receipt IDs for the same item are both valid deliveries.',
      'Return `{ deliveries, seen }` with exactly those fields. `deliveries` contains accepted rows in input order, at most 100.\n\n`seen` contains the original history in its original order, followed by new IDs in acceptance order, at most 200 unique IDs.\n\nObject field order does not matter. Array order does. Do not sort.',
      'Do not mutate either input array or any input row. Do not depend on state from an earlier call.\n\nNo new deliveries returns `[]` for `deliveries`. Replaying with returned history also returns `[]` for `deliveries` and preserves that history.',
      'Run examples calls the 3 displayed examples. Submit solution runs those examples plus 5 additional hidden contract cases. They check first-copy payloads and order, shared items, prior history, empty arrivals or history, and the 100-row input and 200-ID output bounds.\n\nOther values and lengths may vary only within these rules. A passing submission plays only the first arriving manifest in the world and earns progress.',
      'An invalid shape, missing field, invalid ID, non-integer `units`, repeated accepted receipt, changed payload, missing receipt, or changed order fails acceptance.\n\nCrates enter storage only for validated returned rows. A repeated scan must never add another crate.',
    ],
    examples: [
      {
        title: 'The actual arriving manifest',
        input: json({ seen: checks[0].args[1], deliveries: checks[0].args[0] }),
        output: json(checks[0].expected),
        explanation: '`old` was accepted earlier. Keep the first `r1` with three seed units. Ignore its later nine-unit scan, then accept `r2` with one cell.\n\nTwo accepted delivery rows cross into storage. Their `units` remain three and one. Units are not the number of accepted rows.',
      },
      {
        title: 'Same item, different receipts',
        input: json({ seen: checks[2].args[1], deliveries: checks[2].args[0] }),
        output: json(checks[2].expected),
        explanation: '`constructor` and `seed-2` are separate seed receipts, so both are accepted.\n\nThe later `constructor` scan cannot replace the first payload with water. `to-string` is already in the history and stays out.',
      },
      {
        title: 'Replay with the returned history',
        input: json({ seen: checks[3].args[1], deliveries: checks[3].args[0] }),
        output: json(checks[3].expected),
        explanation: 'The first example returned `["old", "r1", "r2"]`. Pass that as `seen` for the same batch.\n\nEvery receipt is known, so storage receives zero new deliveries. This repeat-safe behavior is idempotency.',
      },
    ],
  },
  starter: `type Delivery = { receiptId: string; item: string; units: number };

${signature} {
  // TODO: Keep only the first unseen receipt and return its updated history.
  // This fallback returns every scan. It is deliberately wrong.
  return { deliveries, seen };
}`,
  solution: `type Delivery = { receiptId: string; item: string; units: number };

${signature} {
  const known = new Set(seen);
  const accepted: Delivery[] = [];
  const history = [...seen];
  for (const delivery of deliveries) {
    if (known.has(delivery.receiptId)) continue;
    known.add(delivery.receiptId);
    accepted.push(delivery);
    history.push(delivery.receiptId);
  }
  return { deliveries: accepted, seen: history };
}`,
  hints: [
    'Compare the two r1 scans in the actual manifest. Which receipt has already reached storage? Does a changed unit count make it a new receipt?',
    'Receipt identity is receiptId, not item. Two seed rows with different receipt IDs are both legitimate. A replay starts with every previously accepted receipt already in seen.',
    'Start a Set with seen and a separate copy of the history. Scan in order. When an ID is new, remember it immediately, keep that row, and append its ID to the copied history.',
  ],
  checks,
};

const idPattern = /^[a-z][a-z0-9-]{0,31}$/;

function ordinaryObject(value: unknown, fields: string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
  });
}

function ordinaryArray(value: unknown, limit: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) return false;
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
  }
  return true;
}

export function validateDeliveries(value: unknown, check: DeliveryCheck):
  { ok: true; value: IntakeResult } | { ok: false; error: string } {
  const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
  if (!ordinaryObject(value, ['deliveries', 'seen'])) {
    return fail('Return an ordinary JSON object with exactly deliveries and seen, not a route array or a JSON string.');
  }
  if (!ordinaryArray(value.deliveries, 100)) return fail('deliveries must be a dense ordinary JSON array with at most 100 accepted rows.');
  if (!ordinaryArray(value.seen, 200)) return fail('seen must be a dense ordinary JSON array with at most 200 receipt IDs.');

  const deliveries: Delivery[] = [];
  for (let index = 0; index < value.deliveries.length; index++) {
    const row = value.deliveries[index];
    if (!ordinaryObject(row, ['receiptId', 'item', 'units'])) return fail(`Delivery row ${index + 1} must have exactly receiptId, item, and units as JSON fields.`);
    if (typeof row.receiptId !== 'string' || !idPattern.test(row.receiptId)) return fail(`Delivery row ${index + 1} has an invalid receiptId. Use ^[a-z][a-z0-9-]{0,31}$.`);
    if (typeof row.item !== 'string' || !idPattern.test(row.item)) return fail(`Receipt "${row.receiptId}" has an invalid item ID. Use ^[a-z][a-z0-9-]{0,31}$.`);
    if (typeof row.units !== 'number' || !Number.isInteger(row.units) || row.units < 1 || row.units > 100) return fail(`Receipt "${row.receiptId}" units must be an integer from 1 through 100.`);
    deliveries.push({ receiptId: row.receiptId, item: row.item, units: row.units });
  }
  const seen: string[] = [];
  const historyIds = new Set<string>();
  for (let index = 0; index < value.seen.length; index++) {
    const id = value.seen[index];
    if (typeof id !== 'string' || !idPattern.test(id)) return fail(`seen entry ${index + 1} must be a receipt ID matching ^[a-z][a-z0-9-]{0,31}$.`);
    if (historyIds.has(id)) return fail(`Receipt "${id}" appears twice in seen. Remember an accepted receipt once, including repeated scans within a batch.`);
    historyIds.add(id);
    seen.push(id);
  }

  const prior = new Set(check.args[1]);
  const returned = new Set<string>();
  const expectedRows = new Map(check.expected.deliveries.map((row) => [row.receiptId, row]));
  for (const row of deliveries) {
    if (prior.has(row.receiptId)) return fail(`Receipt "${row.receiptId}" is a replayed scan already in the incoming seen history. It must not add cargo.`);
    if (returned.has(row.receiptId)) return fail(`Receipt "${row.receiptId}" was accepted twice. Ignore repeated scans after the first unseen copy.`);
    returned.add(row.receiptId);
    const expected = expectedRows.get(row.receiptId);
    if (!expected) return fail(`Wrong receipt "${row.receiptId}". Accept only receipt IDs supplied by this scanner batch.`);
    if (row.item !== expected.item || row.units !== expected.units) return fail(`Receipt "${row.receiptId}" payload changed. Keep its first unseen copy unchanged: item "${expected.item}", units ${expected.units}. Later conflicting scans cannot replace it.`);
  }
  for (const row of check.expected.deliveries) {
    if (!returned.has(row.receiptId)) return fail(`Missing new receipt "${row.receiptId}" for item "${row.item}". Different receipt IDs for one item are separate deliveries.`);
  }
  for (let index = 0; index < deliveries.length; index++) {
    const expected = check.expected.deliveries[index];
    if (deliveries[index].receiptId !== expected.receiptId) return fail(`Delivery order changed at row ${index + 1}. Expected receipt "${expected.receiptId}" before "${deliveries[index].receiptId}". Preserve first-acceptance order, not sorted order.`);
  }
  for (let index = 0; index < Math.max(seen.length, check.expected.seen.length); index++) {
    const expected = check.expected.seen[index];
    if (seen[index] !== expected) return fail(`Receipt history differs at seen[${index}]. Expected ${expected === undefined ? 'no further ID' : `"${expected}"`}, received ${seen[index] === undefined ? 'no ID' : `"${seen[index]}"`}. Preserve prior seen order, then append new receipt IDs in acceptance order.`);
  }
  return { ok: true, value: { deliveries, seen } };
}
