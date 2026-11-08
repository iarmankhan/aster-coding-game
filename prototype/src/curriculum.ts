import { graph, navigationChecks } from './mission';

export interface MissionBrief {
  title: string;
  lead: string;
  story: string;
  objective: string;
  goalSteps: string[];
  signature: string;
  parameters: { name: string; type: string; description: string }[];
  rules: string[];
  examples: { title: string; input: string; output: string; explanation: string }[];
}

export interface PlannedExercise {
  id: string;
  order: number;
  title: string;
  concept: string;
  minutes: number;
  premise: string;
  signature: string;
  input: string;
  output: string;
  explanation: string;
  worldEffect: string;
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);
const unreachable = navigationChecks.find((check) => check.id === 'unreachable')!;

export const firstMission: MissionBrief = {
  title: 'First light',
  lead: 'Get Pip and the replacement power cell from the landing dock to the greenhouse.',
  story: 'Aster is a small outpost built on hex-shaped ground tiles. The greenhouse has lost power.\n\nPip waits at the dock with a replacement cell, but the `relay`-to-`greenhouse` shortcut is closed. The working paths still connect the six stations by a longer route.',
  objective: 'Repair `route(graph, start, goal)` by replacing the starter fallback.',
  goalSteps: [
    'Return station IDs in travel order, from `start` to `goal`.',
    'Follow working connections in `graph`. Any valid route is accepted.',
    'Return `[]` if unreachable, or `[start]` if already there.',
    'Leave the network unchanged. Finish even when paths form cycles.',
  ],
  signature: `function route(
  graph: Record<string, string[]>,
  start: string,
  goal: string
): string[]`,
  parameters: [
    { name: 'graph', type: 'Record<string, string[]>', description: 'An adjacency list. Each key is a station ID. Its array lists stations reachable in one working step.\n\n`graph["dock"]` is `["relay"]`. `graph["relay"]` includes `"dock"` and `"junction"`, not `"greenhouse"`. Tile proximity does not create a path.' },
    { name: 'start', type: 'string', description: 'The departure station ID. This delivery starts at `"dock"`.' },
    { name: 'goal', type: 'string', description: 'The destination station ID. The power cell belongs at `"greenhouse"`.' },
  ],
  rules: [
    'Use the supplied adjacency list, not a memorized route. Every station has a key. Both endpoints are existing station IDs.\n\nThe current network has `dock`, `relay`, `junction`, `observatory`, `garden`, and `greenhouse`.',
    'For a reachable destination, return an array with `start` first and `goal` last. Every consecutive pair must be a working connection in `graph`.\n\nAny valid route is accepted. The shortest route is not required.',
    'Return `[]` when no route exists. If `start` equals `goal`, return `[start]`.',
    'Paths can form cycles. Your function must finish. Return at most 100 station IDs, including both endpoints. The current snapshots each contain six stations.',
    'Run examples calls the three displayed examples, including an unreachable goal and equal endpoints. Submit solution runs those 3 examples plus 3 additional hidden contract cases.\n\nEach graph has six stations, working connections in both directions, and existing start and goal keys. Other station names, endpoints, connections and ID lengths may vary. Do not memorize the displayed names.',
    'The broken `relay`-to-`greenhouse` shortcut is absent from the settlement network. Do not add it.\n\nOnly a fully passing submission plays the first example in the world and earns progress. A failed connection is explained in test results, without a partial flight.',
  ],
  examples: [
    {
      title: 'Deliver the cell around the closed shortcut',
      input: json({ graph, start: 'dock', goal: 'greenhouse' }),
      output: json(['dock', 'relay', 'junction', 'garden', 'greenhouse']),
      explanation: 'Every pair is present in the actual delivery network. Pip carries the cell through `relay`, `junction`, and `garden` to restore greenhouse power.\n\nA valid route through `observatory` is also accepted.',
    },
    {
      title: 'The greenhouse is isolated',
      input: json({ graph: unreachable.network, start: 'dock', goal: 'greenhouse' }),
      output: json([]),
      explanation: 'This is the supplied unreachable snapshot. The `garden`-to-`greenhouse` connection is closed, so no working path reaches the greenhouse.\n\n`[]` reports that fact rather than inventing a connection.',
    },
    {
      title: 'Already at the destination',
      input: json({ graph, start: 'greenhouse', goal: 'greenhouse' }),
      output: json(['greenhouse']),
      explanation: 'No travel is needed. The one-element array contains both endpoints because they are the same station.\n\nThis is the third runnable example. It checks the equal-endpoint part of the function contract.',
    },
  ],
};

export const nextExercises: PlannedExercise[] = [
  {
    id: 'one-crate-one-receipt', order: 2, title: 'One crate, one receipt',
    concept: 'Stable deduplication and idempotent replay', minutes: 30,
    premise: 'Planned. The dock scanner repeats receipts. Decide which crates enter storage without counting a replay twice.',
    signature: 'type Delivery = { receiptId: string; item: string; units: number };\nfunction acceptDeliveries(deliveries: Delivery[], seen: string[]): { deliveries: Delivery[]; seen: string[] }',
    input: json({ seen: ['old'], deliveries: [{ receiptId: 'old', item: 'seed', units: 2 }, { receiptId: 'r1', item: 'seed', units: 3 }, { receiptId: 'r1', item: 'seed', units: 9 }, { receiptId: 'r2', item: 'cell', units: 1 }] }),
    output: json({ deliveries: [{ receiptId: 'r1', item: 'seed', units: 3 }, { receiptId: 'r2', item: 'cell', units: 1 }], seen: ['old', 'r1', 'r2'] }),
    explanation: 'Keep the first unseen receipt in input order, even if a later copy has a different payload. Preserve prior seen IDs in order, then append newly accepted IDs. Different receipt IDs for the same item remain separate deliveries.',
    worldEffect: 'Planned simulation. Accepted crates roll into the store; duplicate scans leave their crate outside. Replay with the returned seen list must not add stock again.',
  },
  {
    id: 'read-the-weather', order: 3, title: 'Read the weather',
    concept: 'Parsing, validation, and unit normalization', minutes: 35,
    premise: 'Planned. Weather probes send mixed temperature formats. Decode useful readings without turning damaged packets into greenhouse commands.',
    signature: 'function parseTelemetry(lines: string[]): { readings: { sensor: string; celsius: number }[]; rejected: number[] }',
    input: json({ lines: [' soil | 68 | F ', 'roof|21.5|C', 'roof|warm|C', 'soil|90|C', 'soil|0|C|extra'] }),
    output: json({ readings: [{ sensor: 'soil', celsius: 20 }, { sensor: 'roof', celsius: 21.5 }], rejected: [2, 3, 4] }),
    explanation: 'Split into exactly three fields and trim each. Sensor IDs match ^[a-z][a-z0-9-]{0,15}$. Numbers match ^-?\\d+(?:\\.\\d+)?$ and must be finite. Units are C or F. Convert F with (value - 32) * 5 / 9. Accept Celsius values from -50 through 80 inclusive. Preserve valid-reading and rejected-index order. No rounding is required; numeric tolerance is 1e-9.',
    worldEffect: 'Planned simulation. Valid packets position thermometers; rejected packets stay visible with their source line. A malformed packet cannot snap the greenhouse dial to a false zero.',
  },
  {
    id: 'balance-the-store', order: 4, title: 'Balance the store',
    concept: 'Keyed aggregation and transactional invariants', minutes: 35,
    premise: 'Planned. Seed withdrawals and supply arrivals share one ledger. Keep an accurate stock count without letting a rejected withdrawal erase later deliveries.',
    signature: 'type StockChange = { id: string; item: string; delta: number };\nfunction balanceStock(stock: Record<string, number>, changes: StockChange[]): { balances: { item: string; units: number }[]; rejected: string[] }',
    input: json({ stock: { cell: 2, seed: 4 }, changes: [{ id: 'a', item: 'seed', delta: -3 }, { id: 'b', item: 'cell', delta: -3 }, { id: 'c', item: 'cell', delta: 2 }, { id: 'd', item: 'water', delta: 5 }, { id: 'e', item: 'seed', delta: -2 }] }),
    output: json({ balances: [{ item: 'cell', units: 4 }, { item: 'seed', units: 1 }, { item: 'water', units: 5 }], rejected: ['b', 'e'] }),
    explanation: 'Apply changes in order. Missing items start at zero. Reject a whole change if it would make stock negative, then continue. Keep zero balances. Create missing items only for accepted changes. Sort balances by item ID in ASCII order and keep rejected IDs in input order.',
    worldEffect: 'Planned simulation. Bins fill or empty after each accepted ledger row. A rejected withdrawal leaves its bin unchanged and its unfilled request beside the shelf.',
  },
  {
    id: 'share-the-battery', order: 5, title: 'Share the battery',
    concept: 'Deterministic priority policy under a resource budget', minutes: 35,
    premise: 'Planned. The charged battery cannot power every appliance. Choose full requests under an explicit policy while keeping remaining energy honest.',
    signature: 'type PowerRequest = { id: string; demand: number; priority: number };\nfunction allocatePower(energy: number, requests: PowerRequest[]): { powered: string[]; remaining: number }',
    input: json({ energy: 7, requests: [{ id: 'heater', demand: 5, priority: 2 }, { id: 'pump', demand: 4, priority: 3 }, { id: 'beacon', demand: 2, priority: 2 }] }),
    output: json({ powered: ['pump', 'beacon'], remaining: 1 }),
    explanation: 'Visit requests by descending priority, breaking ties by original input order. Grant a request only if its entire demand fits. Skip an oversized request and continue; never grant partial power. powered follows allocation order. This policy does not maximize the number of powered appliances.',
    worldEffect: 'Planned simulation. Granted appliances run together while the battery gauge loses their exact cost. A high-priority pump can run while an oversized heater waits and a smaller beacon still lights.',
  },
  {
    id: 'open-the-workshop', order: 6, title: 'Open the workshop',
    concept: 'Dependency scheduling and blocked-work diagnosis', minutes: 40,
    premise: 'Planned. Workshop repairs depend on parts made by other jobs. Schedule safe work in waves and leave impossible jobs inspectable.',
    signature: 'type RepairJob = { id: string; requires: string[] };\nfunction scheduleRepairs(jobs: RepairJob[], done: string[]): { batches: string[][]; blocked: string[] }',
    input: json({ jobs: [{ id: 'panels', requires: ['frame'] }, { id: 'frame', requires: [] }, { id: 'heater', requires: ['panels'] }, { id: 'sign', requires: ['paint'] }, { id: 'a', requires: ['b'] }, { id: 'b', requires: ['a'] }], done: [] }),
    output: json({ batches: [['frame'], ['panels'], ['heater']], blocked: ['sign', 'a', 'b'] }),
    explanation: 'Each batch contains every unfinished job whose requirements were complete before that batch. Preserve original job order within a batch. Complete a batch together, then discover the next one. Exclude jobs already in done. Stop without an empty batch when no more work is ready. Return remaining job IDs in input order, including missing-dependency and cycle cases.',
    worldEffect: 'Planned simulation. Ready benches run together; panels cannot appear before the frame. Blocked benches keep their missing-part or cyclic dependency links visible rather than freezing the whole workshop.',
  },
  {
    id: 'steady-the-sensors', order: 7, title: 'Steady the sensors',
    concept: 'Time-window aggregation with independent streams', minutes: 40,
    premise: 'Planned. Noisy moisture probes make the irrigation valves flicker. Smooth recent readings without mixing probes or retaining expired samples.',
    signature: 'type SensorSample = { t: number; sensor: string; value: number };\nfunction smoothSensors(samples: SensorSample[], window: number): { t: number; sensor: string; mean: number }[]',
    input: json({ window: 3, samples: [{ t: 0, sensor: 'soil', value: 10 }, { t: 2, sensor: 'air', value: 20 }, { t: 3, sensor: 'soil', value: 16 }, { t: 6, sensor: 'soil', value: 22 }] }),
    output: json([{ t: 0, sensor: 'soil', mean: 10 }, { t: 2, sensor: 'air', mean: 20 }, { t: 3, sensor: 'soil', mean: 13 }, { t: 6, sensor: 'soil', mean: 19 }]),
    explanation: 'Samples arrive in nondecreasing t order. After each arrival, average processed samples for that sensor with timestamps in [t - window, t], including both boundaries and the current sample. Later samples at the same timestamp are not visible yet. Return one result per arrival in input order. Numeric tolerance is 1e-9.',
    worldEffect: 'Planned simulation. Each probe has raw and smoothed traces. Pausing a valve movement highlights exactly the samples still inside the window for that probe.',
  },
  {
    id: 'raise-the-seedlings', order: 8, title: 'Raise the seedlings',
    concept: 'Finite-state transitions and terminal states', minutes: 35,
    premise: 'Planned. Restore a growing bed by deciding how each day changes a seedling. A wet day alone must not count as both germination and another day of growth.',
    signature: 'type GrowthState = { phase: "seed" | "sprout" | "ready" | "wilted"; streak: number };\ntype GrowthDay = { water: boolean; light: boolean };\nfunction growBed(initial: GrowthState, days: GrowthDay[]): { timeline: GrowthState[]; final: GrowthState }',
    input: json({ initial: { phase: 'seed', streak: 0 }, days: [{ water: false, light: true }, { water: true, light: true }, { water: true, light: true }, { water: true, light: true }, { water: true, light: true }, { water: false, light: false }] }),
    output: json({ timeline: [{ phase: 'seed', streak: 0 }, { phase: 'sprout', streak: 0 }, { phase: 'sprout', streak: 1 }, { phase: 'sprout', streak: 2 }, { phase: 'ready', streak: 0 }, { phase: 'ready', streak: 0 }], final: { phase: 'ready', streak: 0 } }),
    explanation: 'A favorable day has both water and light. A seed stays a seed on other days; its first favorable day creates a sprout with streak 0. A sprout gains one streak per favorable day and becomes ready on streak 3, resetting streak to 0. An unfavorable day wilts a sprout. Ready and wilted are terminal with streak 0. Record state after every day, not before it.',
    worldEffect: 'Planned simulation. A day slider replays germination, growth, harvest readiness, or wilting from the returned states. Terminal beds remain visibly unchanged on later days.',
  },
  {
    id: 'give-the-radio-a-rest', order: 9, title: 'Give the radio a rest',
    concept: 'Capped exponential retry scheduling and attempt limits', minutes: 35,
    premise: 'Planned. A failed radio transmission should wait before trying again. Calculate the next attempt without retrying exhausted messages forever.',
    signature: 'type FailedSend = { id: string; attempt: number; failedAt: number };\nfunction scheduleRetries(failures: FailedSend[], baseDelay: number, maxDelay: number, maxAttempts: number): { retries: { id: string; attempt: number; dueAt: number }[]; exhausted: string[] }',
    input: json({ failures: [{ id: 'a', attempt: 1, failedAt: 100 }, { id: 'b', attempt: 3, failedAt: 100 }, { id: 'c', attempt: 4, failedAt: 90 }], baseDelay: 10, maxDelay: 25, maxAttempts: 4 }),
    output: json({ retries: [{ id: 'a', attempt: 2, dueAt: 110 }, { id: 'b', attempt: 4, dueAt: 125 }], exhausted: ['c'] }),
    explanation: 'attempt counts the send that just failed, starting at 1. If attempt >= maxAttempts, exhaust the message. Otherwise schedule attempt + 1 at failedAt + min(maxDelay, baseDelay * 2 ** (attempt - 1)). Preserve input order separately in retries and exhausted. Delays use simulation ticks, not wall-clock time.',
    worldEffect: 'Planned simulation. Failed sends place markers on a radio timeline. Capped gaps remain visible, and exhausted messages move to a tray instead of producing endless pulses.',
  },
  {
    id: 'keep-the-airlock-clear', order: 10, title: 'Keep the airlock clear',
    concept: 'Bounded FIFO admission and explicit tick phases', minutes: 40,
    premise: 'Planned. Too many carts reach the airlock at once. Bound the waiting lane and explain which carts were served, admitted, or turned away on each tick.',
    signature: 'type QueueTick = { arrivals: string[]; slots: number };\ntype QueueFrame = { started: string[]; waiting: string[]; rejected: string[] };\nfunction queueTimeline(capacity: number, ticks: QueueTick[]): { history: QueueFrame[]; waiting: string[] }',
    input: json({ capacity: 2, ticks: [{ arrivals: ['a', 'b', 'c'], slots: 1 }, { arrivals: ['d'], slots: 1 }, { arrivals: [], slots: 3 }] }),
    output: json({ history: [{ started: [], waiting: ['a', 'b'], rejected: ['c'] }, { started: ['a'], waiting: ['b', 'd'], rejected: [] }, { started: ['b', 'd'], waiting: [], rejected: [] }], waiting: [] }),
    explanation: 'Start with an empty queue. On each tick, serve up to slots carts from the old queue in FIFO order. Then consider arrivals in order, admitting each if the waiting queue has fewer than capacity carts; reject it otherwise. New arrivals cannot start until a later tick. Save a separate waiting snapshot for every frame. Return the final waiting queue too.',
    worldEffect: 'Planned simulation. Carts occupy a finite painted lane. Playback separates departure from admission, so a rejected cart and an unused service slot have an inspectable explanation.',
  },
  {
    id: 'agree-on-the-beacon', order: 11, title: 'Agree on the beacon',
    concept: 'Versioned event reconciliation and deletion tombstones', minutes: 45,
    premise: 'Planned. Delayed beacon updates arrive out of order. Rebuild the newest state without letting an old packet bring back a deleted beacon.',
    signature: 'type BeaconEvent = { id: string; version: number } & ({ kind: "set"; value: string } | { kind: "delete" });\nfunction reconcileBeacons(events: BeaconEvent[]): { entities: { id: string; value: string; version: number }[]; tombstones: { id: string; version: number }[]; ignored: number[] }',
    input: json({ events: [{ id: 'sprout', version: 2, kind: 'set', value: 'lit' }, { id: 'sprout', version: 4, kind: 'delete' }, { id: 'sprout', version: 3, kind: 'set', value: 'dry' }, { id: 'pump', version: 1, kind: 'set', value: 'on' }, { id: 'pump', version: 1, kind: 'set', value: 'off' }, { id: 'sprout', version: 5, kind: 'set', value: 'growing' }, { id: 'gate', version: 2, kind: 'delete' }, { id: 'gate', version: 1, kind: 'set', value: 'open' }] }),
    output: json({ entities: [{ id: 'pump', value: 'on', version: 1 }, { id: 'sprout', value: 'growing', version: 5 }], tombstones: [{ id: 'gate', version: 2 }], ignored: [2, 4, 7] }),
    explanation: 'Process arrivals in order. Accept an event only if its version is strictly greater than the stored version for that ID; accept any first event, including version 0 or a deletion. First arrival wins equal versions. Retain the version of a deletion as a tombstone. A newer set can recreate an entity. Sort entities and tombstones separately by ID in ASCII order; ignored contains zero-based input indices in arrival order.',
    worldEffect: 'Planned simulation. Scrub packet arrival order beside beacon state. Old packets stay in the event log while tombstones prevent a deleted beacon from flashing back on.',
  },
];
