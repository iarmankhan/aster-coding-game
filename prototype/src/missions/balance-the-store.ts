import type { ProgramDefinition, ProgramFixture, StockChange } from '../program-mission-types';

type StockCase = Omit<ProgramFixture<'balance-the-store'>, 'args' | 'input'> & { input: { stock: Record<string, number>; changes: StockChange[] } };
const cases: StockCase[] = [
  {
    id: 'dock-ledger', title: 'The dock store ledger', visibility: 'public',
    detail: 'Apply each row in order. The rejected cell withdrawal does not cancel the later delivery. Keep rejected IDs b, then e.',
    input: { stock: { cell: 2, seed: 4 }, changes: [{ id: 'a', item: 'seed', delta: -3 }, { id: 'b', item: 'cell', delta: -3 }, { id: 'c', item: 'cell', delta: 2 }, { id: 'd', item: 'water', delta: 5 }, { id: 'e', item: 'seed', delta: -2 }] },
    expected: { balances: [{ item: 'cell', units: 4 }, { item: 'seed', units: 1 }, { item: 'water', units: 5 }], rejected: ['b', 'e'] },
  },
  {
    id: 'missing-debit-and-zero', title: 'An empty bin is not a missing bin', visibility: 'public',
    detail: 'Reject a debit against missing seed without creating it. An accepted zero change creates the water bin at zero.',
    input: { stock: {}, changes: [{ id: 'debit', item: 'seed', delta: -1 }, { id: 'label', item: 'water', delta: 0 }] },
    expected: { balances: [{ item: 'water', units: 0 }], rejected: ['debit'] },
  },
  {
    id: 'depleted-legal-names', title: 'Keep the labels after depletion', visibility: 'public',
    detail: 'Depletion keeps zero bins. constructor and length are ordinary item IDs; the constructor bin can receive a later delivery.',
    input: { stock: { seed: 2, constructor: 1, length: 3 }, changes: [{ id: 'sow', item: 'seed', delta: -2 }, { id: 'build', item: 'constructor', delta: -1 }, { id: 'measure', item: 'length', delta: -3 }, { id: 'deliver', item: 'constructor', delta: 2 }] },
    expected: { balances: [{ item: 'constructor', units: 2 }, { item: 'length', units: 0 }, { item: 'seed', units: 0 }], rejected: [] },
  },
  {
    id: 'empty-store', title: 'No bins and no rows', visibility: 'hidden', detail: 'Empty inputs return two empty arrays.',
    input: { stock: {}, changes: [] }, expected: { balances: [], rejected: [] },
  },
  {
    id: 'reject-then-credit', title: 'A rejected row has no effect', visibility: 'hidden',
    detail: 'Neither final-sum netting nor carrying rejected debt forward implements ordered transactions. Rejection order is not sorted.',
    input: { stock: { grain: 1 }, changes: [{ id: 'z-withdraw', item: 'grain', delta: -2 }, { id: 'refill', item: 'grain', delta: 2 }, { id: 'use', item: 'grain', delta: -3 }, { id: 'a-withdraw', item: 'grain', delta: -1 }, { id: 'last-delivery', item: 'grain', delta: 1 }] },
    expected: { balances: [{ item: 'grain', units: 1 }], rejected: ['z-withdraw', 'a-withdraw'] },
  },
  {
    id: 'ascii-label-order', title: 'Labels sort independently of arrival order', visibility: 'hidden',
    detail: 'Keep untouched bins, accepted new zero bins, and depleted bins. ASCII places a before a-b before aa.',
    input: { stock: { z: 0, 'a-b': 2, a: 3 }, changes: [{ id: 'new', item: 'aa', delta: 0 }, { id: 'cut', item: 'a-b', delta: -2 }, { id: 'credit', item: 'a', delta: 1 }] },
    expected: { balances: [{ item: 'a', units: 4 }, { item: 'a-b', units: 0 }, { item: 'aa', units: 0 }, { item: 'z', units: 0 }], rejected: [] },
  },
  {
    id: 'new-dictionary-like-labels', title: 'New bins use their own counts', visibility: 'hidden',
    detail: 'Missing constructor, length, and to-string start at zero. No inherited dictionary value is stock.',
    input: { stock: {}, changes: [{ id: 'make', item: 'constructor', delta: 4 }, { id: 'zero', item: 'length', delta: 0 }, { id: 'add', item: 'to-string', delta: 2 }, { id: 'too-much', item: 'constructor', delta: -5 }] },
    expected: { balances: [{ item: 'constructor', units: 4 }, { item: 'length', units: 0 }, { item: 'to-string', units: 2 }], rejected: ['too-much'] },
  },
  {
    id: 'integer-boundaries', title: 'Whole units at both change limits', visibility: 'hidden',
    detail: 'Accept exact depletion and 100-unit credits. Reject only the overdraft, then continue from zero. Accumulated stock can exceed the initial-count limit.',
    input: { stock: { water: 100, seed: 0 }, changes: [{ id: 'drain', item: 'water', delta: -100 }, { id: 'overdraft', item: 'water', delta: -1 }, { id: 'fill', item: 'water', delta: 100 }, { id: 'reserve', item: 'water', delta: 100 }, { id: 'label', item: 'oxygen', delta: 0 }, { id: 'seed-fill', item: 'seed', delta: 100 }, { id: 'seed-drain', item: 'seed', delta: -100 }] },
    expected: { balances: [{ item: 'oxygen', units: 0 }, { item: 'seed', units: 0 }, { item: 'water', units: 200 }], rejected: ['overdraft'] },
  },
];
const checks = cases.map((check): ProgramFixture<'balance-the-store'> => ({ ...check, args: [check.input.stock, check.input.changes] }));
const alias = 'type StockChange = { id: string; item: string; delta: number };';
const signature = 'function balanceStock(stock: Record<string, number>, changes: StockChange[]): { balances: { item: string; units: number }[]; rejected: string[] }';

export const mission: ProgramDefinition<'balance-the-store'> = {
  id: 'balance-the-store',
  brief: {
    title: 'Balance the store',
    lead: 'Give Neri a ledger that never promises supplies the dock does not have.',
    story: 'Neri has checked the ferry receipts. Now she needs to combine arrivals with withdrawals from the store. A failed withdrawal must leave the shelf unchanged so the next delivery is still counted correctly.\n\nPip will read the returned bin counts at the dock. The bin playback illustrates the canonical ledger result; it does not model physical cargo or inventory outside this function.',
    objective: 'Replace the empty fallback in `balanceStock(stock, changes)` with an ordered, whole-row stock ledger.',
    goalSteps: [
      'Copy the initial item counts into working storage.',
      'Apply changes in input order, rejecting only rows that would go negative.',
      'Keep zero bins and return balances in ASCII item order.',
      'Return rejected change IDs in input order without changing either input.',
    ],
    signature: `${alias}\n${signature}`,
    parameters: [
      { name: 'stock', type: 'Record<string, number>', description: 'Own item keys and initial whole-unit counts. There are 0 through 100 keys; each count is an integer from 0 through 100. A missing item starts at zero, but it does not become a bin until a change for it is accepted.' },
      { name: 'changes', type: 'StockChange[]', description: 'A dense array of 0 through 100 rows with exactly id, item, and delta. Change IDs are unique. delta is an integer from -100 through 100, inclusive. A zero delta is a real accepted change.' },
    ],
    rules: [
      'Inputs satisfy these types and bounds. Item and change IDs are case-sensitive ASCII strings matching `^[a-z][a-z-]{0,31}$`. Lowercase letters and hyphens are allowed, with a letter first. `constructor`, `length`, and `to-string` are legal. Do not reserve names, change case, or use inherited dictionary properties as counts.',
      'Process each change once, in input order. Compute the current count plus delta. If it would be negative, reject the whole row and append its id to rejected. Leave that item unchanged and continue. A rejected missing-item debit must not create a bin. Do not net all changes before deciding which rows fail.',
      'Accept any nonnegative result, including zero. Accepted changes create missing bins even when delta is zero. Keep initial bins and depleted bins at zero. Rejection does not cancel a later credit or prevent another change for the same item.',
      'Return exactly `{ balances, rejected }`. Each balance has exactly `{ item, units }`. Include each existing or accepted-created item once. Sort balances by ASCII item ID, not locale order or arrival order. Preserve rejected IDs in input order. Object key order does not matter; array order does. All counts are exact nonnegative integers with no numeric tolerance.',
      'Treat inputs and input rows as readonly. Copy before sorting or updating; do not rely on prior calls. At most 200 distinct bins can be returned. A count can grow beyond 100, up to 10100 under these bounds. Inputs and outputs are dense finite JSON, with at most 4096 nodes, depth 16, 200 entries per array, and 256 characters per string in each argument tuple and returned value.',
      'Run examples runs these 3 public cases. Submit solution runs all 8 cases, including 5 hidden cases. Progress requires all 8 to pass, unchanged submitted source, and completed playback of the actual first public result. Examples alone, stopped playback, or edits do not earn progress. Hidden details are redacted from normal results, not cryptographically secret from a local browser owner.',
    ],
    examples: checks.filter((check) => check.visibility === 'public').map((check) => ({ title: check.title, input: JSON.stringify(check.input, null, 2), output: JSON.stringify(check.expected, null, 2), explanation: check.detail })),
  },
  starter: `${alias}

${signature} {
  // TODO: Apply whole changes in order and keep an honest bin ledger.
  return { balances: [], rejected: [] };
}`,
  solution: `${alias}

${signature} {
  const counts = new Map<string, number>(Object.entries(stock));
  const rejected: string[] = [];
  for (const change of changes) {
    const next = (counts.get(change.item) ?? 0) + change.delta;
    if (next < 0) rejected.push(change.id);
    else counts.set(change.item, next);
  }
  const balances = [...counts.keys()].sort().map((item) => ({ item, units: counts.get(item)! }));
  return { balances, rejected };
}`,
  hints: [
    'A rejected withdrawal changes nothing. What should a later delivery see as the current count?',
    'A missing item and a zero-count bin are different. Only accepted changes create new bins. A Map avoids inherited-property surprises for names such as constructor.',
    'Copy Object.entries(stock) into a Map. For each row, compute (get(item) ?? 0) + delta. Reject negative results without set; otherwise set even zero. Finally sort a copied key list and map each key to { item, units }.',
  ],
  checks,
};
