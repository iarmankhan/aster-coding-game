import type { MissionId } from './campaign';
import { graph, navigationChecks, validateRoute, type Graph } from './mission';
import { deliveryMission, validateDeliveries, type Delivery, type IntakeResult } from './delivery-mission';
import { missions } from './missions';
import { missionCatalog, type ProgramMissionId } from './mission-catalog';
import type { ProgramFixture } from './program-mission-types';
import { validateProgram } from './program-validation';

export type AttemptMode = 'examples' | 'submit';
export type CheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'not-run';
export type FailureCategory = 'contract' | 'runtime';
type CaseInfo = { id: string; title: string; detail: string; visibility: 'public' | 'hidden' };
export type ProgramChallengeCase = {
  [M in ProgramMissionId]: ProgramFixture<M> & { kind: 'program'; missionId: M }
}[ProgramMissionId];
export type ChallengeCase = CaseInfo & (
  | { kind: 'route'; args: [Graph, string, string]; expected: string | string[] }
  | { kind: 'intake'; args: [Delivery[], string[]]; expected: IntakeResult }
  | ProgramChallengeCase
);
type ReportInfo = { id: string; title: string; status: CheckStatus; category: FailureCategory | null };
export type CaseReport = ReportInfo & (
  | { visibility: 'public'; detail: string; input: unknown; expected: unknown; actual: unknown; diagnostic: string | null; logs: string[] }
  | { visibility: 'hidden' }
);

const routeExpected = 'Any valid route from the supplied start to goal. Every consecutive pair must be a working connection. Shortest is not required.';
const routeCase = (id: string, title: string, args: [Graph, string, string], expected: string | string[], visibility: 'public' | 'hidden' = 'hidden', detail = ''): ChallengeCase =>
  ({ kind: 'route', id, title, args, expected, visibility, detail });
const intakeCase = (id: string, title: string, args: [Delivery[], string[]], expected: IntakeResult, visibility: 'public' | 'hidden' = 'hidden', detail = ''): ChallengeCase =>
  ({ kind: 'intake', id, title, args, expected, visibility, detail });
const publicIntake = (id: string): ChallengeCase => {
  const check = deliveryMission.checks.find((check) => check.id === id)!;
  return intakeCase(check.id, check.title, check.args, check.expected, 'public', check.detail);
};
const longNode = 'a'.repeat(32);
const boundaryRows = Array.from({ length: 100 }, (_, index): Delivery => ({ receiptId: `new-${index}`, item: 'supply', units: index % 2 ? 100 : 1 }));
const boundarySeen = Array.from({ length: 100 }, (_, index) => `prior-${99 - index}`);

const cases: Record<'first-light' | 'one-crate-one-receipt', ChallengeCase[]> = {
  'first-light': [
    routeCase('delivery', 'Deliver the power cell', [graph, 'dock', 'greenhouse'], routeExpected, 'public', 'Find a working route through the actual delivery network.'),
    routeCase('unreachable', 'The greenhouse is isolated', [navigationChecks.find((check) => check.id === 'unreachable')!.network, 'dock', 'greenhouse'], [], 'public', 'Return [] because the destination cannot be reached.'),
    routeCase('already-there', 'Already at the destination', [graph, 'greenhouse', 'greenhouse'], ['greenhouse'], 'public', 'Return [start] when both endpoints are the same.'),
    routeCase('route-hidden-1', 'Hidden case 1', [{ length: [longNode], [longNode]: ['length', 'cove'], cove: [longNode, 'delta'], delta: ['cove', 'elm'], elm: ['delta', 'fern'], fern: ['elm'] }, 'length', 'fern'], routeExpected),
    routeCase('route-hidden-2', 'Hidden case 2', [{ inlet: ['jetty', 'knoll'], jetty: ['inlet', 'knoll'], knoll: ['inlet', 'jetty', 'lookout'], lookout: ['knoll', 'meadow'], meadow: ['lookout', 'nursery'], nursery: ['meadow'] }, 'jetty', 'nursery'], routeExpected),
    routeCase('route-hidden-3', 'Hidden case 3', [{ orchard: ['pier'], pier: ['orchard', 'quay'], quay: ['pier'], ridge: ['shore'], shore: ['ridge', 'tower'], tower: ['shore'] }, 'orchard', 'tower'], []),
  ],
  'one-crate-one-receipt': [
    publicIntake('manifest'), publicIntake('receipt-not-item'), publicIntake('replay'),
    intakeCase('intake-hidden-1', 'Hidden case 1', [[
      { receiptId: 'zeta', item: 'grain', units: 1 }, { receiptId: 'alpha', item: 'grain', units: 100 },
      { receiptId: 'zeta', item: 'oil', units: 100 }, { receiptId: 'middle', item: 'oil', units: 1 },
    ], []], { deliveries: [{ receiptId: 'zeta', item: 'grain', units: 1 }, { receiptId: 'alpha', item: 'grain', units: 100 }, { receiptId: 'middle', item: 'oil', units: 1 }], seen: ['zeta', 'alpha', 'middle'] }),
    intakeCase('intake-hidden-2', 'Hidden case 2', [[
      { receiptId: 'known-b', item: 'rope', units: 100 }, { receiptId: 'fresh-c', item: 'rope', units: 1 },
      { receiptId: 'known-a', item: 'salt', units: 1 }, { receiptId: 'fresh-c', item: 'salt', units: 100 },
    ], ['known-b', 'known-a']], { deliveries: [{ receiptId: 'fresh-c', item: 'rope', units: 1 }], seen: ['known-b', 'known-a', 'fresh-c'] }),
    intakeCase('intake-hidden-3', 'Hidden case 3', [[], ['previous-z', 'previous-a']], { deliveries: [], seen: ['previous-z', 'previous-a'] }),
    intakeCase('intake-hidden-4', 'Hidden case 4', [[], []], { deliveries: [], seen: [] }),
    intakeCase('intake-hidden-5', 'Hidden case 5', [boundaryRows, boundarySeen], { deliveries: boundaryRows, seen: [...boundarySeen, ...boundaryRows.map((row) => row.receiptId)] }),
  ],
};

export function challengeCases(mission: MissionId, mode: AttemptMode): ChallengeCase[] {
  const tests: ChallengeCase[] = mission === 'first-light' || mission === 'one-crate-one-receipt'
    ? cases[mission]
    : missions[mission].checks.map((check) => ({ ...check, kind: 'program', missionId: mission }) as ProgramChallengeCase);
  return tests.filter((test) => mode === 'submit' || test.visibility === 'public');
}

export function caseReport(test: ChallengeCase, status: CheckStatus = 'pending', outcome?: { actual: unknown; diagnostic: string | null; logs: string[]; category: FailureCategory | null }): CaseReport {
  const info = { id: test.id, title: test.title, status, category: outcome?.category ?? null };
  if (test.visibility === 'hidden') return { ...info, visibility: 'hidden' };
  return {
    ...info, visibility: 'public', detail: test.detail,
    input: test.kind === 'program' ? Object.fromEntries(missionCatalog[test.missionId].args.map((name, index) => [name, test.args[index]])) : test.kind === 'route' ? { graph: test.args[0], start: test.args[1], goal: test.args[2] } : { deliveries: test.args[0], seen: test.args[1] },
    expected: test.expected, actual: outcome?.actual ?? null, diagnostic: outcome?.diagnostic ?? null, logs: outcome?.logs ?? [],
  };
}

export function initialReports(mission: MissionId, mode: AttemptMode = 'submit'): CaseReport[] {
  return challengeCases(mission, mode).map((test) => caseReport(test));
}

export function validateCase(test: ChallengeCase, value: unknown): string | null {
  if (test.kind === 'program') return validateProgram(test.missionId, value, test.expected);
  if (test.kind === 'intake') {
    const result = validateDeliveries(value, { ...test, args: test.args, expected: test.expected });
    return result.ok ? null : result.error;
  }
  if (!Array.isArray(value) || value.length > 100 || value.some((id) => typeof id !== 'string' || id.length > 256)) return 'Return an array of at most 100 station IDs.';
  const [network, start, goal] = test.args;
  const visited = new Set([start]);
  const queue = [start];
  for (const node of queue) for (const next of network[node]) if (!visited.has(next)) { visited.add(next); queue.push(next); }
  if (!visited.has(goal)) return value.length === 0 ? null : 'Return [] when the supplied goal is unreachable.';
  if (start === goal) return value.length === 1 && value[0] === start ? null : 'Return [start] when start equals goal.';
  return validateRoute(value, network, start, goal).error;
}
