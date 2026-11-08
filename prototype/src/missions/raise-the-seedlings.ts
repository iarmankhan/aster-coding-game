import type { GrowthDay, GrowthState, ProgramDefinition, ProgramFixture } from '../program-mission-types';

type Dataset = Omit<ProgramFixture<'raise-the-seedlings'>, 'args' | 'input'> & {
  input: { initial: GrowthState; days: GrowthDay[] };
};

const datasets: Dataset[] = [
  {
    id: 'first-bed', title: 'Germinate, grow, then stay ready', visibility: 'public',
    detail: 'The first favorable day germinates with streak 0. Three further favorable days make the bed ready. The last dry day cannot undo readiness.',
    input: { initial: { phase: 'seed', streak: 0 }, days: [{ water: false, light: true }, { water: true, light: true }, { water: true, light: true }, { water: true, light: true }, { water: true, light: true }, { water: false, light: false }] },
    expected: { timeline: [{ phase: 'seed', streak: 0 }, { phase: 'sprout', streak: 0 }, { phase: 'sprout', streak: 1 }, { phase: 'sprout', streak: 2 }, { phase: 'ready', streak: 0 }, { phase: 'ready', streak: 0 }], final: { phase: 'ready', streak: 0 } },
  },
  {
    id: 'shade-day', title: 'Water without light wilts a sprout', visibility: 'public',
    detail: 'Even a sprout at streak 2 needs both conditions. Once wilted, later favorable days do not revive it.',
    input: { initial: { phase: 'sprout', streak: 2 }, days: [{ water: true, light: false }, { water: true, light: true }, { water: true, light: true }] },
    expected: { timeline: [{ phase: 'wilted', streak: 0 }, { phase: 'wilted', streak: 0 }, { phase: 'wilted', streak: 0 }], final: { phase: 'wilted', streak: 0 } },
  },
  {
    id: 'already-ready', title: 'An initially ready bed is terminal', visibility: 'public',
    detail: 'A ready initial state ignores dry, shaded, and favorable days alike. Every after-day snapshot and final remain ready with streak 0.',
    input: { initial: { phase: 'ready', streak: 0 }, days: [{ water: false, light: false }, { water: true, light: false }, { water: true, light: true }] },
    expected: { timeline: [{ phase: 'ready', streak: 0 }, { phase: 'ready', streak: 0 }, { phase: 'ready', streak: 0 }], final: { phase: 'ready', streak: 0 } },
  },
  {
    id: 'seed-conditions', title: 'Only a fully favorable day germinates', visibility: 'hidden',
    detail: 'Neither water alone nor light alone germinates. Germination itself is not the first streak increment.',
    input: { initial: { phase: 'seed', streak: 0 }, days: [{ water: true, light: false }, { water: false, light: true }, { water: false, light: false }, { water: true, light: true }, { water: true, light: true }] },
    expected: { timeline: [{ phase: 'seed', streak: 0 }, { phase: 'seed', streak: 0 }, { phase: 'seed', streak: 0 }, { phase: 'sprout', streak: 0 }, { phase: 'sprout', streak: 1 }], final: { phase: 'sprout', streak: 1 } },
  },
  {
    id: 'three-more-days', title: 'Initial sprout needs three favorable days', visibility: 'hidden',
    detail: 'Snapshots retain streaks 1 and 2 before readiness resets the streak to 0. Ready remains terminal through light-only and water-only days.',
    input: { initial: { phase: 'sprout', streak: 0 }, days: [{ water: true, light: true }, { water: true, light: true }, { water: true, light: true }, { water: false, light: true }, { water: true, light: false }] },
    expected: { timeline: [{ phase: 'sprout', streak: 1 }, { phase: 'sprout', streak: 2 }, { phase: 'ready', streak: 0 }, { phase: 'ready', streak: 0 }, { phase: 'ready', streak: 0 }], final: { phase: 'ready', streak: 0 } },
  },
  {
    id: 'dry-after-growth', title: 'A light-only day stops a growing sprout', visibility: 'hidden',
    detail: 'Start from streak 1, advance once, then wilt. A favorable day after wilting does not resume the old streak.',
    input: { initial: { phase: 'sprout', streak: 1 }, days: [{ water: true, light: true }, { water: false, light: true }, { water: true, light: true }] },
    expected: { timeline: [{ phase: 'sprout', streak: 2 }, { phase: 'wilted', streak: 0 }, { phase: 'wilted', streak: 0 }], final: { phase: 'wilted', streak: 0 } },
  },
  {
    id: 'already-wilted', title: 'An initially wilted bed stays wilted', visibility: 'hidden',
    detail: 'No combination of water and light can leave a terminal wilted state.',
    input: { initial: { phase: 'wilted', streak: 0 }, days: [{ water: true, light: true }, { water: true, light: true }, { water: false, light: false }, { water: true, light: false }] },
    expected: { timeline: [{ phase: 'wilted', streak: 0 }, { phase: 'wilted', streak: 0 }, { phase: 'wilted', streak: 0 }, { phase: 'wilted', streak: 0 }], final: { phase: 'wilted', streak: 0 } },
  },
  {
    id: 'pause-before-ready', title: 'An empty schedule does not advance a sprout', visibility: 'hidden',
    detail: 'With no days, preserve a nonzero initial streak exactly. Do not record the initial state as a timeline day.',
    input: { initial: { phase: 'sprout', streak: 2 }, days: [] },
    expected: { timeline: [], final: { phase: 'sprout', streak: 2 } },
  },
];

const checks: ProgramFixture<'raise-the-seedlings'>[] = datasets.map(({ input, ...data }) => ({
  ...data, input, args: [input.initial, input.days],
}));
const aliases = `type GrowthState = { phase: "seed" | "sprout" | "ready" | "wilted"; streak: number };
type GrowthDay = { water: boolean; light: boolean };`;
const signature = 'function growBed(initial: GrowthState, days: GrowthDay[]): { timeline: GrowthState[]; final: GrowthState }';

export const mission: ProgramDefinition<'raise-the-seedlings'> = {
  id: 'raise-the-seedlings',
  brief: {
    title: 'Raise the seedlings',
    lead: 'Help Pip turn the repaired garden equipment into a daily growing-bed record.',
    story: 'The garden panel now separates recent probe readings. Pip has a tray of seeds and a short log of water and light for each day. The nursery needs one clear state after each day, so the crew can tell a growing sprout from a bed that is ready or has wilted.\n\nThis is a small state model. It does not predict real plant growth.',
    objective: 'Implement `growBed(initial, days)` with exactly one state transition per day and independent after-day snapshots.',
    goalSteps: [
      'Call a day favorable only when water and light are both true.',
      'Germinate a seed on its first favorable day with streak 0. Otherwise it stays a seed.',
      'Give a sprout one streak per further favorable day. At 3, become ready with streak 0. Any unfavorable sprout day becomes wilted with streak 0.',
      'Keep ready and wilted terminal. Return the after-day timeline and the final snapshot.',
    ],
    signature: `${aliases}\n${signature}`,
    parameters: [
      { name: 'initial', type: 'GrowthState', description: 'A valid initial snapshot. phase is seed, sprout, ready, or wilted. A sprout streak is integer 0, 1, or 2. Seed, ready, and wilted always have streak 0.' },
      { name: 'days', type: 'GrowthDay[]', description: '0 to 100 days in chronological order. Each day has exactly the boolean fields water and light. An empty list leaves final equal in value to initial and timeline empty.' },
    ],
    rules: [
      'Read the state at the start of a day, then apply only that phase rule. The germination day must not also increment the new sprout streak.',
      'Both conditions are required. Water without light and light without water leave seeds unchanged but wilt sprouts. Wilted beds cannot revive. Ready beds cannot wilt.',
      'Record a separate state snapshot after every day, never before it. Earlier entries must not change when later days are processed. Return final as the last state, or the initial state when there are no days.',
      'Inputs are read-only. Return ordinary finite JSON with exactly timeline and final, and exactly phase and streak in each state. Object key order is irrelevant; timeline order is fixed. All phases and integer streaks compare exactly.',
      'At most 100 days keep input and output below the unchanged 4096-node and 200-item-array sandbox limits. This model has no real clocks or garden hardware access.',
      'Run examples checks the 3 public cases. Submit solution checks all 8 cases, including 5 hidden cases with other initial phases and day sequences. Only all 8 passing plus completed playback of your actual first public result earns progress. Hidden cases run locally and are not a secure remote judge.',
      'Playback illustrates your returned states against the recorded day conditions. It is not a claim that these rules physically grow seedlings.',
    ],
    examples: checks.filter((check) => check.visibility === 'public').map((check) => ({ title: check.title, input: JSON.stringify(check.input, null, 2), output: JSON.stringify(check.expected, null, 2), explanation: check.detail })),
  },
  starter: `${aliases}\n\n${signature} {
  // TODO: apply one phase rule per day and save each resulting state.
  return { timeline: [], final: { ...initial } };
}
`,
  solution: `${aliases}\n\n${signature} {
  let state: GrowthState = { ...initial };
  const timeline: GrowthState[] = [];
  for (const day of days) {
    const favorable = day.water && day.light;
    if (state.phase === 'seed') {
      if (favorable) state = { phase: 'sprout', streak: 0 };
    } else if (state.phase === 'sprout') {
      if (!favorable) state = { phase: 'wilted', streak: 0 };
      else if (state.streak === 2) state = { phase: 'ready', streak: 0 };
      else state = { phase: 'sprout', streak: state.streak + 1 };
    }
    timeline.push({ ...state });
  }
  return { timeline, final: { ...state } };
}
`,
  hints: [
    'Think about the phase at the start of each day. Ready and wilted ignore all later conditions.',
    'Use mutually exclusive seed and sprout branches. Favorable germination creates streak 0; only a day that starts as a sprout can add to its streak.',
    'Copy initial into state. For each day compute water && light, choose one transition, and push { ...state }. A favorable sprout at streak 2 becomes ready at streak 0; a bad sprout day becomes wilted at streak 0.',
  ],
  checks,
};
