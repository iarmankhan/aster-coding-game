import type { MissionId } from './campaign';
import type { Delivery } from './delivery-mission';
import { caseReport, challengeCases, validateCase, type AttemptMode, type CaseReport } from './challenge';
import { disposeRunner, executeBatch, prepareRunner } from './runner';
import { missionCatalog } from './mission-catalog';
import type { ProgramPlayback } from './program-mission-types';
export type { CheckStatus } from './challenge';

type RunInfo = { missionId: MissionId; reports: CaseReport[] };
type ProgramSubmitSuccess = {
  [M in ProgramPlayback['missionId']]: { ok: true; mode: 'submit'; missionId: M; reports: CaseReport[]; canonical: Extract<ProgramPlayback, { missionId: M }> }
}[ProgramPlayback['missionId']];
export type MissionRunResult =
  | (RunInfo & { ok: false; mode: AttemptMode; error: string; checkId: string | null; attemptError: string | null })
  | (RunInfo & { ok: true; mode: 'examples' })
  | { ok: true; mode: 'submit'; missionId: 'first-light'; reports: CaseReport[]; route: string[] }
  | { ok: true; mode: 'submit'; missionId: 'one-crate-one-receipt'; reports: CaseReport[]; deliveries: Delivery[]; accepted: Delivery[] }
  | ProgramSubmitSuccess;

if (typeof Worker !== 'undefined') prepareRunner();
if (typeof window !== 'undefined') window.addEventListener('pagehide', disposeRunner, { once: true });

export async function executeMission(
  missionId: MissionId,
  javascript: string,
  options: { mode: AttemptMode; signal: AbortSignal; onCheck: (report: CaseReport) => void },
): Promise<MissionRunResult> {
  const tests = challengeCases(missionId, options.mode);
  const reports = tests.map((test) => caseReport(test));
  const publish = (index: number, report: CaseReport) => {
    reports[index] = report;
    if (!options.signal.aborted) options.onCheck(report);
  };
  if (options.signal.aborted) return { ok: false, missionId, mode: options.mode, reports: tests.map((test) => caseReport(test, 'not-run')), error: 'Simulation stopped.', checkId: null, attemptError: 'Simulation stopped.' };
  const batch = await executeBatch(javascript, missionCatalog[missionId].entry, tests.map((test) => ({ id: test.id, args: test.args })), {
    signal: options.signal,
    onFixture(index, status, result) {
      if (options.signal.aborted) return;
      if (status === 'running') { publish(index, caseReport(tests[index], 'running')); return; }
      if (!result) throw new Error('Missing validated fixture result.');
      const diagnostic = result.ok ? validateCase(tests[index], result.value) : result.error;
      publish(index, caseReport(tests[index], diagnostic ? 'failed' : 'passed', {
        actual: result.ok ? result.value : null, diagnostic, logs: result.logs,
        category: diagnostic ? result.ok ? 'contract' : 'runtime' : null,
      }));
    },
  });
  for (let index = 0; index < reports.length; index++) {
    if (reports[index].status === 'running' || reports[index].status === 'pending') publish(index, caseReport(tests[index], 'not-run'));
  }
  const failed = reports.find((report) => report.status === 'failed');
  const last = batch.results.at(-1);
  const guestFailure = !batch.ok && last?.ok === false && batch.error === last.error && batch.fixtureIndex === batch.results.length - 1;
  const attemptError = options.signal.aborted ? 'Simulation stopped.' : !batch.ok && !guestFailure ? batch.error : null;
  if (!batch.ok || options.signal.aborted || failed || reports.some((report) => report.status !== 'passed')) {
    const error = failed ? failed.visibility === 'public' ? failed.diagnostic! : `Hidden case failed (${failed.category}). Review the function contract.` : attemptError ?? 'The sandbox did not finish every case.';
    return { ok: false, missionId, mode: options.mode, reports, error, checkId: failed?.id ?? null, attemptError };
  }
  if (options.mode === 'examples') return { ok: true, missionId, mode: 'examples', reports };
  const publicCase = challengeCases(missionId, 'examples')[0];
  const index = tests.findIndex((test) => test.id === publicCase.id && test.visibility === 'public');
  const first = batch.results[index];
  if (!first?.ok) throw new Error('Missing canonical result after a passing submission.');
  if (missionId === 'first-light') return { ok: true, mode: 'submit', missionId, reports, route: first.value as string[] };
  if (missionId === 'one-crate-one-receipt') return { ok: true, mode: 'submit', missionId, reports, deliveries: structuredClone(publicCase.args[0]) as Delivery[], accepted: (first.value as { deliveries: Delivery[] }).deliveries };
  return {
    ok: true, mode: 'submit', missionId, reports,
    canonical: { missionId, caseId: publicCase.id, args: structuredClone(publicCase.args), output: first.value },
  } as ProgramSubmitSuccess;
}
