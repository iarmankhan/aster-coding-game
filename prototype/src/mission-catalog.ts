export const missionIds = [
  'first-light', 'one-crate-one-receipt', 'read-the-weather',
  'balance-the-store', 'share-the-battery', 'open-the-workshop',
  'steady-the-sensors', 'raise-the-seedlings', 'give-the-radio-a-rest',
  'keep-the-airlock-clear', 'agree-on-the-beacon',
] as const;

export type MissionId = typeof missionIds[number];
export type ProgramMissionId = Exclude<MissionId, 'first-light' | 'one-crate-one-receipt'>;
export type StationId = 'dock' | 'relay' | 'junction' | 'observatory' | 'garden' | 'greenhouse';

export const missionCatalog = {
  'first-light': { title: 'First light', entry: 'route', args: ['graph', 'start', 'goal'], file: 'route.ts', system: 'navigation', concept: 'Navigation / graph traversal', focus: 'greenhouse', problem: 'Greenhouse power', playbackLabel: 'Following your route' },
  'one-crate-one-receipt': { title: 'One crate, one receipt', entry: 'acceptDeliveries', args: ['deliveries', 'seen'], file: 'acceptDeliveries.ts', system: 'supply-dock', concept: 'Stable deduplication / idempotent replay', focus: 'dock', problem: 'Dock scanner & storage', playbackLabel: 'Unloading accepted receipts' },
  'read-the-weather': { title: 'Read the weather', entry: 'parseTelemetry', args: ['lines'], file: 'parseTelemetry.ts', system: 'weather', concept: 'Parsing / validation / unit normalization', focus: 'observatory', problem: 'Weather packet decoder', playbackLabel: 'Decoding your weather readings' },
  'balance-the-store': { title: 'Balance the store', entry: 'balanceStock', args: ['stock', 'changes'], file: 'balanceStock.ts', system: 'store-ledger', concept: 'Keyed aggregation / transactional invariants', focus: 'dock', problem: 'Store ledger', playbackLabel: 'Reconciling your stock ledger' },
  'share-the-battery': { title: 'Share the battery', entry: 'allocatePower', args: ['energy', 'requests'], file: 'allocatePower.ts', system: 'battery', concept: 'Deterministic priority / resource budgets', focus: 'greenhouse', problem: 'Battery priorities', playbackLabel: 'Applying your power allocation' },
  'open-the-workshop': { title: 'Open the workshop', entry: 'scheduleRepairs', args: ['jobs', 'done'], file: 'scheduleRepairs.ts', system: 'workshop', concept: 'Dependency scheduling / blocked work', focus: 'junction', problem: 'Workshop repair batches', playbackLabel: 'Running your repair batches' },
  'steady-the-sensors': { title: 'Steady the sensors', entry: 'smoothSensors', args: ['samples', 'window'], file: 'smoothSensors.ts', system: 'sensors', concept: 'Time windows / independent streams', focus: 'garden', problem: 'Moisture sensor windows', playbackLabel: 'Reading your sensor windows' },
  'raise-the-seedlings': { title: 'Raise the seedlings', entry: 'growBed', args: ['initial', 'days'], file: 'growBed.ts', system: 'nursery', concept: 'Finite-state transitions / terminal states', focus: 'garden', problem: 'Nursery daily state', playbackLabel: 'Replaying your growing days' },
  'give-the-radio-a-rest': { title: 'Give the radio a rest', entry: 'scheduleRetries', args: ['failures', 'baseDelay', 'maxDelay', 'maxAttempts'], file: 'scheduleRetries.ts', system: 'radio', concept: 'Capped exponential retries / attempt limits', focus: 'relay', problem: 'Radio retry schedule', playbackLabel: 'Placing your retry schedule' },
  'keep-the-airlock-clear': { title: 'Keep the airlock clear', entry: 'queueTimeline', args: ['capacity', 'ticks'], file: 'queueTimeline.ts', system: 'airlock', concept: 'Bounded FIFO / explicit tick phases', focus: 'greenhouse', problem: 'Nursery cart lane', playbackLabel: 'Replaying your airlock queue' },
  'agree-on-the-beacon': { title: 'Agree on the beacon', entry: 'reconcileBeacons', args: ['events'], file: 'reconcileBeacons.ts', system: 'beacon', concept: 'Versioned reconciliation / deletion tombstones', focus: 'relay', problem: 'Service beacon record', playbackLabel: 'Rebuilding your service board' },
} as const satisfies Record<MissionId, {
  title: string; entry: string; args: readonly string[]; file: string;
  system: string; concept: string; focus: StationId; problem: string; playbackLabel: string;
}>;

export function previousMission(id: MissionId): MissionId | null {
  return missionIds[missionIds.indexOf(id) - 1] ?? null;
}

export function nextMission(id: MissionId): MissionId | null {
  return missionIds[missionIds.indexOf(id) + 1] ?? null;
}
