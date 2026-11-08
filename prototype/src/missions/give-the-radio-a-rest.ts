import type { FailedSend, ProgramDefinition, ProgramFixture } from '../program-mission-types';

type Dataset = Omit<ProgramFixture<'give-the-radio-a-rest'>, 'args' | 'input'> & {
  input: { failures: FailedSend[]; baseDelay: number; maxDelay: number; maxAttempts: number };
};

const datasets: Dataset[] = [
  {
    id: 'relay-backlog', title: 'Delay retries and exhaust the last attempt', visibility: 'public',
    detail: 'a waits 10 ticks. b would wait 40 ticks, capped to 25. c has already failed attempt 4, so it is exhausted.',
    input: { failures: [{ id: 'a', attempt: 1, failedAt: 100 }, { id: 'b', attempt: 3, failedAt: 100 }, { id: 'c', attempt: 4, failedAt: 90 }], baseDelay: 10, maxDelay: 25, maxAttempts: 4 },
    expected: { retries: [{ id: 'a', attempt: 2, dueAt: 110 }, { id: 'b', attempt: 4, dueAt: 125 }], exhausted: ['c'] },
  },
  {
    id: 'single-attempt-budget', title: 'A one-attempt budget permits no retries', visibility: 'public',
    detail: 'The budget includes the send that just failed. Both attempt 1 and an attempt beyond the budget are exhausted.',
    input: { failures: [{ id: 'weather', attempt: 1, failedAt: 0 }, { id: 'garden', attempt: 2, failedAt: 50 }], baseDelay: 5, maxDelay: 20, maxAttempts: 1 },
    expected: { retries: [], exhausted: ['weather', 'garden'] },
  },
  {
    id: 'arrival-order', title: 'Preserve arrival order, not due-time order', visibility: 'public',
    detail: 'The capped late message remains first even though the following messages are due sooner. This function calculates a schedule without sorting or waiting.',
    input: { failures: [{ id: 'late', attempt: 3, failedAt: 90 }, { id: 'early', attempt: 1, failedAt: 0 }, { id: 'middle', attempt: 2, failedAt: 1 }], baseDelay: 10, maxDelay: 25, maxAttempts: 4 },
    expected: { retries: [{ id: 'late', attempt: 4, dueAt: 115 }, { id: 'early', attempt: 2, dueAt: 10 }, { id: 'middle', attempt: 3, dueAt: 21 }], exhausted: [] },
  },
  {
    id: 'quiet-radio', title: 'No failed sends', visibility: 'hidden',
    detail: 'No retries or exhausted IDs are invented for an empty backlog.',
    input: { failures: [], baseDelay: 1, maxDelay: 1000, maxAttempts: 30 },
    expected: { retries: [], exhausted: [] },
  },
  {
    id: 'exponent-origin', title: 'Attempt 1 uses exponent zero', visibility: 'hidden',
    detail: 'With no cap reached, the delays are 3, 6, and 12. dueAt uses failedAt rather than an accumulated global clock.',
    input: { failures: [{ id: 'one', attempt: 1, failedAt: 7 }, { id: 'two', attempt: 2, failedAt: 7 }, { id: 'three', attempt: 3, failedAt: 7 }], baseDelay: 3, maxDelay: 100, maxAttempts: 5 },
    expected: { retries: [{ id: 'one', attempt: 2, dueAt: 10 }, { id: 'two', attempt: 3, dueAt: 13 }, { id: 'three', attempt: 4, dueAt: 19 }], exhausted: [] },
  },
  {
    id: 'cap-below-base', title: 'The cap may be smaller than the base', visibility: 'hidden',
    detail: 'Apply the cap even on the first retry. A later attempt with the same cap can have an earlier dueAt.',
    input: { failures: [{ id: 'constructor', attempt: 1, failedAt: 10 }, { id: 'mast-2', attempt: 4, failedAt: 0 }], baseDelay: 100, maxDelay: 7, maxAttempts: 5 },
    expected: { retries: [{ id: 'constructor', attempt: 2, dueAt: 17 }, { id: 'mast-2', attempt: 5, dueAt: 7 }], exhausted: [] },
  },
  {
    id: 'mixed-budget', title: 'Split retries and exhausted sends stably', visibility: 'hidden',
    detail: 'An attempt equal to or greater than the budget is exhausted. Each returned list independently preserves its original arrival order.',
    input: { failures: [{ id: 'z', attempt: 4, failedAt: 1000000 }, { id: 'b', attempt: 2, failedAt: 4 }, { id: 'a', attempt: 30, failedAt: 0 }, { id: 'y', attempt: 1, failedAt: 99 }, { id: 'm', attempt: 3, failedAt: 3 }], baseDelay: 2, maxDelay: 1000, maxAttempts: 4 },
    expected: { retries: [{ id: 'b', attempt: 3, dueAt: 8 }, { id: 'y', attempt: 2, dueAt: 101 }, { id: 'm', attempt: 4, dueAt: 11 }], exhausted: ['z', 'a'] },
  },
  {
    id: 'cap-boundary', title: 'Exact cap, over cap, and below cap', visibility: 'hidden',
    detail: 'Attempt 4 reaches a delay of 32 exactly. Attempt 5 is capped to 32, while attempt 3 still waits 16 ticks.',
    input: { failures: [{ id: 'edge', attempt: 4, failedAt: 0 }, { id: 'over', attempt: 5, failedAt: 0 }, { id: 'under', attempt: 3, failedAt: 0 }], baseDelay: 4, maxDelay: 32, maxAttempts: 6 },
    expected: { retries: [{ id: 'edge', attempt: 5, dueAt: 32 }, { id: 'over', attempt: 6, dueAt: 32 }, { id: 'under', attempt: 4, dueAt: 16 }], exhausted: [] },
  },
];

const checks: ProgramFixture<'give-the-radio-a-rest'>[] = datasets.map(({ input, ...data }) => ({
  ...data, input, args: [input.failures, input.baseDelay, input.maxDelay, input.maxAttempts],
}));
const aliases = 'type FailedSend = { id: string; attempt: number; failedAt: number };';
const signature = 'function scheduleRetries(failures: FailedSend[], baseDelay: number, maxDelay: number, maxAttempts: number): { retries: { id: string; attempt: number; dueAt: number }[]; exhausted: string[] }';

export const mission: ProgramDefinition<'give-the-radio-a-rest'> = {
  id: 'give-the-radio-a-rest',
  brief: {
    title: 'Give the radio a rest',
    lead: 'Let Pip schedule the relay backlog without flooding the channel.',
    story: 'The nursery has a daily record, but its reports still need to cross the coast to the relay. Several sends have failed. Pip needs the next permitted attempt and its due tick for each message, with exhausted messages kept out of the retry loop.\n\nYou receive a recorded failure list. Calculate times only. Do not send messages, sleep, or read a real clock.',
    objective: 'Implement `scheduleRetries(failures, baseDelay, maxDelay, maxAttempts)` with capped exponential delays and an inclusive total-attempt budget.',
    goalSteps: [
      'Treat attempt as the send that just failed, starting at 1.',
      'If attempt >= maxAttempts, append the ID to exhausted and schedule nothing for it.',
      'Otherwise return attempt + 1 due at failedAt + min(maxDelay, baseDelay * 2 ** (attempt - 1)).',
      'Preserve input order separately in retries and exhausted, without changing inputs.',
    ],
    signature: `${aliases}\n${signature}`,
    parameters: [
      { name: 'failures', type: 'FailedSend[]', description: '0 to 100 failures in arrival order, not necessarily chronological order. IDs are unique and match ^[a-z][a-z0-9-]{0,31}$. attempt is an integer from 1 through 30 and may exceed maxAttempts. failedAt is an integer simulation tick from 0 through 1000000.' },
      { name: 'baseDelay', type: 'number', description: 'Positive integer from 1 through 1000. This is the uncapped delay after failed attempt 1. Zero is outside this mission contract.' },
      { name: 'maxDelay', type: 'number', description: 'Positive integer from 1 through 1000. Cap every delay, even if maxDelay is less than baseDelay.' },
      { name: 'maxAttempts', type: 'number', description: 'Integer total-send budget from 1 through 30, including the send that just failed. A budget of 1 allows no retries.' },
    ],
    rules: [
      'Use exponent attempt - 1, not attempt. The first failed send waits min(maxDelay, baseDelay). The next scheduled attempt number is attempt + 1.',
      'Exhaust failures at or beyond the budget. Keep only their IDs in exhausted. Do not return an exhausted message in retries.',
      'Calculate each dueAt from that row\'s failedAt. Do not sort by dueAt, ID, or failedAt. Delays use simulation ticks, not milliseconds on a wall clock.',
      'Inputs are read-only. Return ordinary finite JSON with exactly retries and exhausted. Each retry has exactly id, attempt, and dueAt. Object key order is irrelevant; all arrays retain the specified order. All integer values compare exactly, with no tolerance.',
      'At most 100 rows, delays at most 1000, and attempts at most 30 keep arithmetic exact and JSON below the unchanged 4096-node and 200-item-array sandbox limits. Returned dueAt is at most 1001000.',
      'Run examples checks the 3 public cases. Submit solution checks all 8 cases, including 5 hidden cases. Only all 8 passing plus completed playback of your actual first public result earns progress. Hidden checks run locally, not on a secure remote judge.',
      'Playback illustrates the returned schedule without waiting for its ticks. It does not perform a real radio transmission or prove network delivery.',
    ],
    examples: checks.filter((check) => check.visibility === 'public').map((check) => ({ title: check.title, input: JSON.stringify(check.input, null, 2), output: JSON.stringify(check.expected, null, 2), explanation: check.detail })),
  },
  starter: `${aliases}\n\n${signature} {
  // TODO: separate exhausted sends from their next permitted attempts.
  return { retries: [], exhausted: [] };
}
`,
  solution: `${aliases}\n\n${signature} {
  const retries: { id: string; attempt: number; dueAt: number }[] = [];
  const exhausted: string[] = [];
  for (const failure of failures) {
    if (failure.attempt >= maxAttempts) {
      exhausted.push(failure.id);
    } else {
      const delay = Math.min(maxDelay, baseDelay * 2 ** (failure.attempt - 1));
      retries.push({ id: failure.id, attempt: failure.attempt + 1, dueAt: failure.failedAt + delay });
    }
  }
  return { retries, exhausted };
}
`,
  hints: [
    'The attempt budget includes the failed send. Check that budget before calculating another attempt.',
    'For retries, the uncapped delays after attempts 1, 2, and 3 are baseDelay, 2 * baseDelay, and 4 * baseDelay. Cap the delay before adding failedAt.',
    'Walk failures once with two output arrays. Push the ID when attempt >= maxAttempts; otherwise push { id, attempt: attempt + 1, dueAt: failedAt + Math.min(maxDelay, baseDelay * 2 ** (attempt - 1)) }. Never sort.',
  ],
  checks,
};
