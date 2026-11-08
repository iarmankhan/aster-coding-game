import type { ProgramDefinition, ProgramFixture, QueueTick } from '../program-mission-types';

type Dataset = Omit<ProgramFixture<'keep-the-airlock-clear'>, 'args' | 'input'> & {
  input: { capacity: number; ticks: QueueTick[] };
};

const datasets: Dataset[] = [
  {
    id: 'nursery-carts', title: 'Depart before admitting new carts', visibility: 'public',
    detail: 'The first service slot is unused because the old queue is empty. c is rejected. Later ticks start a, then b and d in FIFO order.',
    input: { capacity: 2, ticks: [{ arrivals: ['a', 'b', 'c'], slots: 1 }, { arrivals: ['d'], slots: 1 }, { arrivals: [], slots: 3 }] },
    expected: { history: [{ started: [], waiting: ['a', 'b'], rejected: ['c'] }, { started: ['a'], waiting: ['b', 'd'], rejected: [] }, { started: ['b', 'd'], waiting: [], rejected: [] }], waiting: [] },
  },
  {
    id: 'no-waiting-lane', title: 'Zero capacity rejects every arrival', visibility: 'public',
    detail: 'Service slots cannot bypass admission. With no waiting spaces, all arrivals are rejected and no cart ever starts.',
    input: { capacity: 0, ticks: [{ arrivals: ['seed', 'water'], slots: 20 }, { arrivals: [], slots: 0 }, { arrivals: ['tools'], slots: 2 }] },
    expected: { history: [{ started: [], waiting: [], rejected: ['seed', 'water'] }, { started: [], waiting: [], rejected: [] }, { started: [], waiting: [], rejected: ['tools'] }], waiting: [] },
  },
  {
    id: 'spaces-after-departure', title: 'Old departures free space for a burst', visibility: 'public',
    detail: 'm and n leave before p, q, and r arrive. Only p and q fit. Starting p on the next tick frees one place for s.',
    input: { capacity: 2, ticks: [{ arrivals: ['m', 'n'], slots: 0 }, { arrivals: ['p', 'q', 'r'], slots: 2 }, { arrivals: ['s'], slots: 1 }] },
    expected: { history: [{ started: [], waiting: ['m', 'n'], rejected: [] }, { started: ['m', 'n'], waiting: ['p', 'q'], rejected: ['r'] }, { started: ['p'], waiting: ['q', 's'], rejected: [] }], waiting: ['q', 's'] },
  },
  {
    id: 'no-ticks', title: 'Empty recording', visibility: 'hidden',
    detail: 'No ticks mean no history and an empty final waiting queue.',
    input: { capacity: 20, ticks: [] }, expected: { history: [], waiting: [] },
  },
  {
    id: 'closed-then-drain', title: 'Zero slots retain FIFO until reopening', visibility: 'hidden',
    detail: 'The lane fills while service is closed. A rejected cart is not retained. Every waiting frame must remain its own snapshot after the drain.',
    input: { capacity: 3, ticks: [{ arrivals: ['a', 'b'], slots: 0 }, { arrivals: ['c', 'd'], slots: 0 }, { arrivals: ['e'], slots: 2 }, { arrivals: [], slots: 20 }] },
    expected: { history: [{ started: [], waiting: ['a', 'b'], rejected: [] }, { started: [], waiting: ['a', 'b', 'c'], rejected: ['d'] }, { started: ['a', 'b'], waiting: ['c', 'e'], rejected: [] }, { started: ['c', 'e'], waiting: [], rejected: [] }], waiting: [] },
  },
  {
    id: 'unused-service', title: 'Unused slots never serve a new arrival', visibility: 'hidden',
    detail: 'A large slot count still starts only old carts. An empty zero-slot tick records another frame without draining the lane.',
    input: { capacity: 2, ticks: [{ arrivals: ['constructor'], slots: 20 }, { arrivals: ['cart-2'], slots: 20 }, { arrivals: [], slots: 0 }] },
    expected: { history: [{ started: [], waiting: ['constructor'], rejected: [] }, { started: ['constructor'], waiting: ['cart-2'], rejected: [] }, { started: [], waiting: ['cart-2'], rejected: [] }], waiting: ['cart-2'] },
  },
  {
    id: 'permanent-rejection', title: 'Rejected carts do not reenter on a later tick', visibility: 'hidden',
    detail: 'After the accepted cart leaves, the rejected IDs remain absent. The final empty tick still has a history entry.',
    input: { capacity: 1, ticks: [{ arrivals: ['keep', 'drop-z', 'drop-a'], slots: 0 }, { arrivals: [], slots: 1 }, { arrivals: [], slots: 1 }] },
    expected: { history: [{ started: [], waiting: ['keep'], rejected: ['drop-z', 'drop-a'] }, { started: ['keep'], waiting: [], rejected: [] }, { started: [], waiting: [], rejected: [] }], waiting: [] },
  },
  {
    id: 'full-sized-lane', title: 'A full lane preserves arrival order', visibility: 'hidden',
    detail: 'Capacity 20 accepts the whole burst without sorting IDs. A quiet frame preserves that full snapshot; the later drain starts all 20 in FIFO order.',
    input: { capacity: 20, ticks: [{ arrivals: ['t', 's', 'r', 'q', 'p', 'o', 'n', 'm', 'l', 'k', 'j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'], slots: 0 }, { arrivals: [], slots: 0 }, { arrivals: [], slots: 20 }] },
    expected: { history: [{ started: [], waiting: ['t', 's', 'r', 'q', 'p', 'o', 'n', 'm', 'l', 'k', 'j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'], rejected: [] }, { started: [], waiting: ['t', 's', 'r', 'q', 'p', 'o', 'n', 'm', 'l', 'k', 'j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'], rejected: [] }, { started: ['t', 's', 'r', 'q', 'p', 'o', 'n', 'm', 'l', 'k', 'j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'], waiting: [], rejected: [] }], waiting: [] },
  },
];

const checks: ProgramFixture<'keep-the-airlock-clear'>[] = datasets.map(({ input, ...data }) => ({
  ...data, input, args: [input.capacity, input.ticks],
}));
const aliases = `type QueueTick = { arrivals: string[]; slots: number };
type QueueFrame = { started: string[]; waiting: string[]; rejected: string[] };`;
const signature = 'function queueTimeline(capacity: number, ticks: QueueTick[]): { history: QueueFrame[]; waiting: string[] }';

export const mission: ProgramDefinition<'keep-the-airlock-clear'> = {
  id: 'keep-the-airlock-clear',
  brief: {
    title: 'Keep the airlock clear',
    lead: 'Give Pip an honest record of the nursery cart lane, including carts turned away.',
    story: 'The relay backlog has a schedule. At the greenhouse, seed and water carts now reach the airlock in bursts. The painted waiting lane has a fixed number of spaces, and the crew can start only a limited number of old carts on each tick.\n\nPip needs a replayable record. A free service slot does not let a newly arriving cart skip the lane.',
    objective: 'Implement `queueTimeline(capacity, ticks)` as an initially empty bounded FIFO with departure before admission on every tick.',
    goalSteps: [
      'Start each tick by removing up to slots carts from the old waiting queue in FIFO order.',
      'Then visit arrivals in order. Admit while waiting.length < capacity; reject every other arrival.',
      'Do not serve newly admitted carts on the same tick or retain rejected carts for later.',
      'Record independent { started, waiting, rejected } snapshots and return the final waiting queue.',
    ],
    signature: `${aliases}\n${signature}`,
    parameters: [
      { name: 'capacity', type: 'number', description: 'Integer waiting-lane capacity from 0 through 20. Capacity limits waiting carts, not the number of starts on a tick. Zero rejects all arrivals.' },
      { name: 'ticks', type: 'QueueTick[]', description: '0 to 20 ticks in order. slots is an integer from 0 through 20. Each arrivals list has 0 to 20 IDs and there are at most 100 arrivals across the entire recording. IDs are unique across all ticks and match ^[a-z][a-z0-9-]{0,31}$.' },
    ],
    rules: [
      'Each tick has two ordered phases. First serve only the old queue, up to slots. Then admit new arrivals one at a time. Unused service slots are lost, not carried forward or used on new arrivals.',
      'Admit an arrival only when the current waiting length is strictly less than capacity. A departure can free a space for admission later that tick. Rejected carts never enter a later queue unless they were supplied again, which the unique-ID input contract excludes.',
      'started lists removed old carts in FIFO order. rejected lists that tick\'s rejected arrivals in arrival order. waiting is the queue after admission. Never sort cart IDs.',
      'Record one separate frame for every tick, including empty ticks. Later queue changes must not overwrite an earlier waiting snapshot. With no ticks, return empty history and waiting.',
      'Inputs are read-only. Return ordinary finite JSON with exactly history and waiting. Every frame has exactly started, waiting, rejected. Object key order is irrelevant; every array order and length compares exactly.',
      'The composite bounds are deliberate. At most 20 ticks times 20 waiting IDs gives at most 400 saved waiting entries; at most 100 arrivals bounds all starts and rejections together to 100. With records and final waiting, output remains below 1000 JSON nodes, inside the unchanged 4096-node and 200-item-array limits.',
      'Run examples checks the 3 public cases. Submit solution checks all 8 cases, including 5 hidden cases. Only all 8 passing plus completed playback of your actual first public result earns progress. Hidden checks are local UI checks, not a secure remote judge.',
      'Playback illustrates your returned queue frames. It does not operate a physical airlock or establish a real safety policy.',
    ],
    examples: checks.filter((check) => check.visibility === 'public').map((check) => ({ title: check.title, input: JSON.stringify(check.input, null, 2), output: JSON.stringify(check.expected, null, 2), explanation: check.detail })),
  },
  starter: `${aliases}\n\n${signature} {
  // TODO: serve the old FIFO, admit arrivals, and save each frame.
  return { history: [], waiting: [] };
}
`,
  solution: `${aliases}\n\n${signature} {
  const waiting: string[] = [];
  const history: QueueFrame[] = [];
  for (const tick of ticks) {
    const started = waiting.splice(0, tick.slots);
    const rejected: string[] = [];
    for (const id of tick.arrivals) {
      if (waiting.length < capacity) waiting.push(id);
      else rejected.push(id);
    }
    history.push({ started, waiting: [...waiting], rejected });
  }
  return { history, waiting: [...waiting] };
}
`,
  hints: [
    'Separate departures from admissions. A cart that appears in arrivals cannot also start on that tick.',
    'Keep one private waiting array. Remove its first slots entries, then consider each arrival against capacity. Copy waiting when recording a frame.',
    'For every tick, use waiting.splice(0, tick.slots) for started. Push each arrival if waiting.length < capacity, otherwise push it into rejected. Save { started, waiting: [...waiting], rejected }, then return history and another waiting copy.',
  ],
  checks,
};
