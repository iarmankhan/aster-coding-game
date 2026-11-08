import type { ProgramDefinition, ProgramFixture, RepairJob } from '../program-mission-types';

type WorkshopCase = Omit<ProgramFixture<'open-the-workshop'>, 'args' | 'input'> & { input: { jobs: RepairJob[]; done: string[] } };
const cases: WorkshopCase[] = [
  {
    id: 'workshop-board', title: 'The workshop repair board', visibility: 'public',
    detail: 'Build frame, then panels, then heater in separate waves. The sign lacks paint; a and b form a cycle.',
    input: { jobs: [{ id: 'panels', requires: ['frame'] }, { id: 'frame', requires: [] }, { id: 'heater', requires: ['panels'] }, { id: 'sign', requires: ['paint'] }, { id: 'a', requires: ['b'] }, { id: 'b', requires: ['a'] }], done: [] },
    expected: { batches: [['frame'], ['panels'], ['heater']], blocked: ['sign', 'a', 'b'] },
  },
  {
    id: 'parallel-roots', title: 'Run every ready bench together', visibility: 'public',
    detail: 'The two roots and the independent sign share the first wave in input order. Base waits for both roots; top waits for base.',
    input: { jobs: [{ id: 'top', requires: ['base'] }, { id: 'z-root', requires: [] }, { id: 'a-root', requires: [] }, { id: 'base', requires: ['z-root', 'a-root'] }, { id: 'sign', requires: [] }], done: [] },
    expected: { batches: [['z-root', 'a-root', 'sign'], ['base'], ['top']], blocked: [] },
  },
  {
    id: 'completed-and-external-parts', title: 'Parts can already be complete', visibility: 'public',
    detail: 'Skip seal because it is already done, even though its listed requirement is missing. The external part is complete. Requiring it twice does not require two completions.',
    input: { jobs: [{ id: 'seal', requires: ['missing'] }, { id: 'bench', requires: ['seal', 'external', 'external'] }], done: ['external', 'seal'] },
    expected: { batches: [['bench']], blocked: [] },
  },
  {
    id: 'no-jobs', title: 'An empty repair board', visibility: 'hidden', detail: 'External completed parts do not become scheduled jobs.',
    input: { jobs: [], done: ['external'] }, expected: { batches: [], blocked: [] },
  },
  {
    id: 'reverse-chain', title: 'Dependencies are not input positions', visibility: 'hidden',
    detail: 'A reverse-ordered chain still runs from its prerequisite to its final job, with one job per wave.',
    input: { jobs: [{ id: 'finish', requires: ['middle'] }, { id: 'middle', requires: ['start'] }, { id: 'start', requires: [] }], done: [] },
    expected: { batches: [['start'], ['middle'], ['finish']], blocked: [] },
  },
  {
    id: 'blocked-components', title: 'Blocked work does not freeze independent work', visibility: 'hidden',
    detail: 'Leave self, missing-part, cyclic, and downstream-of-cycle jobs blocked in input order. Independent work still completes.',
    input: { jobs: [{ id: 'tail', requires: ['cycle-a'] }, { id: 'self', requires: ['self'] }, { id: 'cycle-a', requires: ['cycle-b'] }, { id: 'free', requires: [] }, { id: 'missing', requires: ['absent'] }, { id: 'cycle-b', requires: ['cycle-a'] }, { id: 'after-free', requires: ['free'] }], done: [] },
    expected: { batches: [['free'], ['after-free']], blocked: ['tail', 'self', 'cycle-a', 'missing', 'cycle-b'] },
  },
  {
    id: 'commit-whole-wave', title: 'New completions unlock only the next wave', visibility: 'hidden',
    detail: 'A forward scan must not make child ready in root\'s batch. Every readiness decision uses the same pre-wave completed set.',
    input: { jobs: [{ id: 'root', requires: [] }, { id: 'child', requires: ['root', 'root'] }, { id: 'sibling', requires: [] }, { id: 'child-two', requires: ['sibling'] }, { id: 'join', requires: ['child', 'child-two'] }], done: [] },
    expected: { batches: [['root', 'sibling'], ['child', 'child-two'], ['join']], blocked: [] },
  },
  {
    id: 'all-already-done', title: 'No work remains after prior completion', visibility: 'hidden',
    detail: 'Completed jobs never enter batches or blocked, regardless of old dependencies or history order. Do not mutate that history.',
    input: { jobs: [{ id: 'x', requires: ['x'] }, { id: 'y', requires: ['missing'] }, { id: 'z', requires: [] }], done: ['z', 'x', 'y', 'external'] },
    expected: { batches: [], blocked: [] },
  },
];
const checks = cases.map((check): ProgramFixture<'open-the-workshop'> => ({ ...check, args: [check.input.jobs, check.input.done] }));
const alias = 'type RepairJob = { id: string; requires: string[] };';
const signature = 'function scheduleRepairs(jobs: RepairJob[], done: string[]): { batches: string[][]; blocked: string[] }';

export const mission: ProgramDefinition<'open-the-workshop'> = {
  id: 'open-the-workshop',
  brief: {
    title: 'Open the workshop',
    lead: 'Help Pip schedule safe repair waves without hiding blocked benches.',
    story: 'Mara has marked the workshop jobs that need parts from other benches. Neri has brought a list of parts already finished elsewhere. Pip can start every ready bench together, but a part made in this wave is available only in the next one.\n\nReturn the repair batches and the jobs that cannot start. Workshop playback illustrates those returned batches; it does not model real fabrication time or physical repairs.',
    objective: 'Replace the empty fallback in `scheduleRepairs(jobs, done)` with complete readiness waves and a blocked list.',
    goalSteps: [
      'Start with the IDs in done and exclude already completed jobs.',
      'Collect every currently ready job in original input order.',
      'Complete that entire wave together before discovering the next wave.',
      'Stop when no jobs are ready and return remaining job IDs in input order.',
    ],
    signature: `${alias}\n${signature}`,
    parameters: [
      { name: 'jobs', type: 'RepairJob[]', description: 'A dense array of 0 through 100 records with exactly id and requires. Job IDs are unique. Each requires array has 0 through 20 IDs. Duplicate requirement IDs are allowed and mean the same requirement repeated, not multiple completions. Requirements can name jobs, external completed parts, missing IDs, or the job itself.' },
      { name: 'done', type: 'string[]', description: 'A dense array of 0 through 100 unique IDs already complete before scheduling. It can include IDs absent from jobs. Its order does not determine batch order. A job whose ID is here is excluded even if its old requirements are not complete.' },
    ],
    rules: [
      'Inputs satisfy these types and bounds. All job, requirement, and completed-part IDs are case-sensitive ASCII strings matching `^[a-z][a-z0-9-]{0,31}$`. Do not sort or rename them. A requirement is satisfied exactly when its ID belongs to the completed set.',
      'At each wave start, collect every unfinished job whose entire requires array is already satisfied. Empty requirements are ready immediately. Preserve original jobs order within that wave, even for disconnected components.',
      'Decide all readiness before adding any job from this wave to the completed set. Then complete the whole wave together. A job unlocked by this wave belongs in a later batch, never the current batch. Every scheduled job appears once.',
      'If no unfinished job is ready, stop without appending an empty batch. Missing dependencies, self-dependencies, cycles, and jobs downstream of blocked jobs remain blocked unless their requirements were already in done. Independent ready work must still run.',
      'Return exactly `{ batches, blocked }`. batches is an array of nonempty arrays of job IDs. blocked contains all remaining unfinished IDs in original input order. Jobs already in done appear in neither field. Empty or all-done jobs return two empty arrays. Object key order is irrelevant; every array order and length is exact.',
      'Treat jobs, requires arrays, and done as readonly. Use separate working collections. Do not retain state across calls. At most 100 jobs are scheduled or blocked in total, across at most 100 batches. Inputs and outputs are dense finite JSON, with at most 4096 nodes, depth 16, 200 entries per array, and 256 characters per string in each argument tuple and returned value. The 20-requirement limit keeps even a 100-job board bounded.',
      'Run examples runs these 3 public cases. Submit solution runs all 8 cases, including 5 hidden cases. Progress requires all 8 to pass, unchanged submitted source, and completed playback of the actual first public result. Examples alone, stopped playback, or edits do not earn progress. Hidden details are redacted from normal results, not cryptographically secret from a local browser owner.',
    ],
    examples: checks.filter((check) => check.visibility === 'public').map((check) => ({ title: check.title, input: JSON.stringify(check.input, null, 2), output: JSON.stringify(check.expected, null, 2), explanation: check.detail })),
  },
  starter: `${alias}

${signature} {
  // TODO: Schedule complete readiness waves and preserve blocked job order.
  return { batches: [], blocked: [] };
}`,
  solution: `${alias}

${signature} {
  const completed = new Set(done);
  const batches: string[][] = [];
  let pending = jobs.filter((job) => !completed.has(job.id));
  while (pending.length > 0) {
    const ready = pending.filter((job) => job.requires.every((id) => completed.has(id)));
    if (ready.length === 0) break;
    batches.push(ready.map((job) => job.id));
    for (const job of ready) completed.add(job.id);
    pending = pending.filter((job) => !completed.has(job.id));
  }
  return { batches, blocked: pending.map((job) => job.id) };
}`,
  hints: [
    'The frame is built before the panels, even though panels is listed first. Input order decides ties, not dependency readiness.',
    'Keep a Set of completed IDs and a separate pending list. Find the entire ready list before updating completed. An empty ready list means stop, not loop forever.',
    'Filter out jobs already in done. Repeatedly filter pending with requires.every(id => completed.has(id)). Append the ready IDs as one batch, add them all to completed, then remove completed jobs from pending. Return remaining pending IDs as blocked.',
  ],
  checks,
};
