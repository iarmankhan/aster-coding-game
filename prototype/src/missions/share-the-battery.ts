import type { PowerRequest, ProgramDefinition, ProgramFixture } from '../program-mission-types';

type PowerCase = Omit<ProgramFixture<'share-the-battery'>, 'args' | 'input'> & { input: { energy: number; requests: PowerRequest[] } };
const cases: PowerCase[] = [
  {
    id: 'greenhouse-budget', title: 'The greenhouse battery', visibility: 'public',
    detail: 'Visit pump first. The heater no longer fits, but the beacon does. Keep one unit of energy.',
    input: { energy: 7, requests: [{ id: 'heater', demand: 5, priority: 2 }, { id: 'pump', demand: 4, priority: 3 }, { id: 'beacon', demand: 2, priority: 2 }] },
    expected: { powered: ['pump', 'beacon'], remaining: 1 },
  },
  {
    id: 'stable-priority-tie', title: 'A tie keeps the request order', visibility: 'public',
    detail: 'Equal priorities preserve input order, not alphabetical order. z-lamp uses two units before a-lamp gets the last one.',
    input: { energy: 3, requests: [{ id: 'z-lamp', demand: 2, priority: 1 }, { id: 'a-lamp', demand: 1, priority: 1 }, { id: 'm-lamp', demand: 1, priority: 1 }] },
    expected: { powered: ['z-lamp', 'a-lamp'], remaining: 0 },
  },
  {
    id: 'skip-then-exact-fit', title: 'An oversized request does not end the scan', visibility: 'public',
    detail: 'Skip the five-unit boiler. The fan and gate each fit in full and consume the four-unit budget exactly.',
    input: { energy: 4, requests: [{ id: 'boiler', demand: 5, priority: 3 }, { id: 'fan', demand: 2, priority: 2 }, { id: 'gate', demand: 2, priority: 1 }] },
    expected: { powered: ['fan', 'gate'], remaining: 0 },
  },
  {
    id: 'no-requests', title: 'An idle switchboard', visibility: 'hidden', detail: 'An empty request list leaves all energy unused.',
    input: { energy: 9, requests: [] }, expected: { powered: [], remaining: 9 },
  },
  {
    id: 'empty-battery', title: 'No energy is available', visibility: 'hidden',
    detail: 'Positive demands cannot receive partial or free grants, even at the highest priority.',
    input: { energy: 0, requests: [{ id: 'small', demand: 1, priority: 0 }, { id: 'urgent', demand: 100, priority: 100 }] },
    expected: { powered: [], remaining: 0 },
  },
  {
    id: 'renamed-mixed-priorities', title: 'Mixed priorities without input mutation', visibility: 'hidden',
    detail: 'Visit high-priority roof then east in their original tie order. The marker fits before the lowest-priority west request is skipped.',
    input: { energy: 9, requests: [{ id: 'west', demand: 3, priority: 0 }, { id: 'roof', demand: 4, priority: 100 }, { id: 'east', demand: 2, priority: 100 }, { id: 'marker', demand: 1, priority: 50 }] },
    expected: { powered: ['roof', 'east', 'marker'], remaining: 2 },
  },
  {
    id: 'policy-not-knapsack', title: 'Priority is not a maximum-count search', visibility: 'hidden',
    detail: 'Grant the six-unit priority-five request, even though three lower-priority appliances could have fit instead.',
    input: { energy: 6, requests: [{ id: 'heavy', demand: 6, priority: 5 }, { id: 'one', demand: 1, priority: 4 }, { id: 'two', demand: 1, priority: 4 }, { id: 'three', demand: 1, priority: 3 }] },
    expected: { powered: ['heavy'], remaining: 0 },
  },
  {
    id: 'maximum-demand-boundary', title: 'Exact integer limits after a small grant', visibility: 'hidden',
    detail: 'The urgent one-unit request leaves 99. Skip a demand of 100, then grant exactly 99. Preserve the priority-zero input tie order.',
    input: { energy: 100, requests: [{ id: 'large', demand: 100, priority: 0 }, { id: 'high', demand: 1, priority: 100 }, { id: 'rest', demand: 99, priority: 0 }, { id: 'small', demand: 1, priority: 0 }] },
    expected: { powered: ['high', 'rest'], remaining: 0 },
  },
];
const checks = cases.map((check): ProgramFixture<'share-the-battery'> => ({ ...check, args: [check.input.energy, check.input.requests] }));
const alias = 'type PowerRequest = { id: string; demand: number; priority: number };';
const signature = 'function allocatePower(energy: number, requests: PowerRequest[]): { powered: string[]; remaining: number }';

export const mission: ProgramDefinition<'share-the-battery'> = {
  id: 'share-the-battery',
  brief: {
    title: 'Share the battery',
    lead: 'Help Mara decide which greenhouse requests fit the charged battery.',
    story: 'The battery Pip delivered is ready, but its charge will not cover every request. Mara has written a priority beside each appliance. Neri asks for one consistent rule so a renamed appliance cannot jump the queue.\n\nYour function returns full grants and unused energy. The lamps and battery gauge illustrate the first allocation; they are not an electrical or physical battery simulation.',
    objective: 'Replace the no-grants fallback in `allocatePower(energy, requests)` with the stated priority policy.',
    goalSteps: [
      'Visit requests in descending priority and preserve input order for ties.',
      'Grant a request only when its entire demand fits the remaining energy.',
      'Skip oversized requests and continue considering later ones.',
      'Return granted IDs in allocation order and exact unused energy without mutating requests.',
    ],
    signature: `${alias}\n${signature}`,
    parameters: [
      { name: 'energy', type: 'number', description: 'An integer budget from 0 through 100, inclusive. Start the remaining count at this value. It is a simulation-unit count, not a measured voltage or clock.' },
      { name: 'requests', type: 'PowerRequest[]', description: 'A dense array of 0 through 100 records with exactly id, demand, and priority. IDs are unique. demand is a positive integer from 1 through 100; zero demand is outside this contract. priority is an integer from 0 through 100. Larger priority numbers come first.' },
    ],
    rules: [
      'Inputs already satisfy these types and bounds. Request IDs are case-sensitive ASCII strings matching `^[a-z][a-z0-9-]{0,31}$`. Names carry no priority. Do not rename, alphabetize, or memorize them.',
      'Order requests by descending priority. Break ties by original input index, never ID or demand. Do not sort the supplied array in place. Sorting a separate array of requests or indexed copies is allowed.',
      'Start remaining at energy. Visit every request once in policy order. If demand <= remaining, append its ID to powered and subtract the entire demand. Otherwise leave remaining unchanged and continue. Never grant partial power or stop at the first oversized request.',
      'This is a fixed priority policy, not a search for maximum appliance count, maximum energy use, or any other optimum. A higher-priority full grant can prevent several smaller, lower-priority grants. Requests with equal priority keep input order even when another tie ordering would power more devices.',
      'Return exactly `{ powered, remaining }`. powered contains each granted ID once, in allocation order, with at most 100 entries. remaining is the exact nonnegative integer budget left after those grants. Object key order is irrelevant; array order is fixed. No numeric tolerance applies.',
      'Treat inputs and input rows as readonly. Do not retain state between calls. Inputs and outputs are dense finite JSON with at most 4096 nodes, depth 16, 200 entries per array, and 256 characters per string in each argument tuple and returned value.',
      'Run examples runs these 3 public cases. Submit solution runs all 8 cases, including 5 hidden cases. Progress requires all 8 to pass, unchanged submitted source, and completed playback of the actual first public result. Examples alone, stopped playback, or edits do not earn progress. Hidden details are redacted from normal results, not cryptographically secret from a local browser owner.',
    ],
    examples: checks.filter((check) => check.visibility === 'public').map((check) => ({ title: check.title, input: JSON.stringify(check.input, null, 2), output: JSON.stringify(check.expected, null, 2), explanation: check.detail })),
  },
  starter: `${alias}

${signature} {
  // TODO: Grant full requests in stable priority order.
  return { powered: [], remaining: energy };
}`,
  solution: `${alias}

${signature} {
  let remaining = energy;
  const powered: string[] = [];
  const ordered = requests.map((request, index) => ({ ...request, index }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index);
  for (const request of ordered) {
    if (request.demand <= remaining) {
      powered.push(request.id);
      remaining -= request.demand;
    }
  }
  return { powered, remaining };
}`,
  hints: [
    'The heater in the first example cannot fit after the pump. Why can the smaller beacon still receive power?',
    'Separate ordering from allocation. Remember each original index so priority ties do not accidentally become alphabetical ties. Sort a new array, not requests.',
    'Map requests to indexed copies, then sort by b.priority - a.priority || a.index - b.index. Scan that array with a remaining counter. Append and subtract only when demand <= remaining; otherwise continue.',
  ],
  checks,
};
