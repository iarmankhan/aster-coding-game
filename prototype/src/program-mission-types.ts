import type { MissionBrief } from './curriculum';
import type { ProgramMissionId } from './mission-catalog';

export type StockChange = { id: string; item: string; delta: number };
export type PowerRequest = { id: string; demand: number; priority: number };
export type RepairJob = { id: string; requires: string[] };
export type SensorSample = { t: number; sensor: string; value: number };
export type GrowthState = { phase: 'seed' | 'sprout' | 'ready' | 'wilted'; streak: number };
export type GrowthDay = { water: boolean; light: boolean };
export type FailedSend = { id: string; attempt: number; failedAt: number };
export type QueueTick = { arrivals: string[]; slots: number };
export type QueueFrame = { started: string[]; waiting: string[]; rejected: string[] };
export type BeaconEvent = { id: string; version: number } & ({ kind: 'set'; value: string } | { kind: 'delete' });

export type ProgramIO = {
  'read-the-weather': { args: [lines: string[]]; output: { readings: { sensor: string; celsius: number }[]; rejected: number[] } };
  'balance-the-store': { args: [stock: Record<string, number>, changes: StockChange[]]; output: { balances: { item: string; units: number }[]; rejected: string[] } };
  'share-the-battery': { args: [energy: number, requests: PowerRequest[]]; output: { powered: string[]; remaining: number } };
  'open-the-workshop': { args: [jobs: RepairJob[], done: string[]]; output: { batches: string[][]; blocked: string[] } };
  'steady-the-sensors': { args: [samples: SensorSample[], window: number]; output: { t: number; sensor: string; mean: number }[] };
  'raise-the-seedlings': { args: [initial: GrowthState, days: GrowthDay[]]; output: { timeline: GrowthState[]; final: GrowthState } };
  'give-the-radio-a-rest': { args: [failures: FailedSend[], baseDelay: number, maxDelay: number, maxAttempts: number]; output: { retries: { id: string; attempt: number; dueAt: number }[]; exhausted: string[] } };
  'keep-the-airlock-clear': { args: [capacity: number, ticks: QueueTick[]]; output: { history: QueueFrame[]; waiting: string[] } };
  'agree-on-the-beacon': { args: [events: BeaconEvent[]]; output: { entities: { id: string; value: string; version: number }[]; tombstones: { id: string; version: number }[]; ignored: number[] } };
};

export type ProgramArgs = { [M in ProgramMissionId]: ProgramIO[M]['args'] };
export type ProgramOutput = { [M in ProgramMissionId]: ProgramIO[M]['output'] };
export type ProgramFixture<M extends ProgramMissionId> = {
  id: string; title: string; detail: string; visibility: 'public' | 'hidden';
  args: ProgramArgs[M]; input: Record<string, unknown>; expected: ProgramOutput[M];
};
export type ProgramDefinition<M extends ProgramMissionId> = {
  id: M; brief: MissionBrief; starter: string; solution: string; hints: string[];
  checks: ProgramFixture<M>[];
};
export type ProgramPlayback = {
  [M in ProgramMissionId]: { readonly missionId: M; readonly caseId: string; readonly args: ProgramArgs[M]; readonly output: ProgramOutput[M] }
}[ProgramMissionId];
