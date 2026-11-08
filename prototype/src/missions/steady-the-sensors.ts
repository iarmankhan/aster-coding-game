import type { ProgramDefinition, ProgramFixture, SensorSample } from '../program-mission-types';

type Dataset = Omit<ProgramFixture<'steady-the-sensors'>, 'args' | 'input'> & {
  input: { samples: SensorSample[]; window: number };
};

const datasets: Dataset[] = [
  {
    id: 'garden-probes', title: 'Separate soil and air readings', visibility: 'public',
    detail: 'At t=3 the soil reading at t=0 is still on the inclusive boundary. At t=6 only soil readings at 3 and 6 remain.',
    input: { window: 3, samples: [{ t: 0, sensor: 'soil', value: 10 }, { t: 2, sensor: 'air', value: 20 }, { t: 3, sensor: 'soil', value: 16 }, { t: 6, sensor: 'soil', value: 22 }] },
    expected: [{ t: 0, sensor: 'soil', mean: 10 }, { t: 2, sensor: 'air', mean: 20 }, { t: 3, sensor: 'soil', mean: 13 }, { t: 6, sensor: 'soil', mean: 19 }],
  },
  {
    id: 'same-tick', title: 'Equal times still arrive one by one', visibility: 'public',
    detail: 'A zero-width window includes earlier arrivals at the same time, never later arrivals. The air probe has its own stream.',
    input: { window: 0, samples: [{ t: 5, sensor: 'soil', value: 2 }, { t: 5, sensor: 'soil', value: 8 }, { t: 5, sensor: 'air', value: 100 }, { t: 5, sensor: 'soil', value: -4 }] },
    expected: [{ t: 5, sensor: 'soil', mean: 2 }, { t: 5, sensor: 'soil', mean: 5 }, { t: 5, sensor: 'air', mean: 100 }, { t: 5, sensor: 'soil', mean: 2 }],
  },
  {
    id: 'edge-and-gap', title: 'Keep the boundary, then expire it', visibility: 'public',
    detail: 'The t=1 reading contributes at t=4, but not at t=5. A long gap leaves only the current reading.',
    input: { window: 3, samples: [{ t: 1, sensor: 'roof', value: -2 }, { t: 4, sensor: 'roof', value: 5 }, { t: 5, sensor: 'roof', value: 8 }, { t: 12, sensor: 'roof', value: 3 }] },
    expected: [{ t: 1, sensor: 'roof', mean: -2 }, { t: 4, sensor: 'roof', mean: 1.5 }, { t: 5, sensor: 'roof', mean: 6.5 }, { t: 12, sensor: 'roof', mean: 3 }],
  },
  {
    id: 'no-arrivals', title: 'Empty sensor feed', visibility: 'hidden',
    detail: 'No arrivals produce no rows, even with the largest supported window.',
    input: { samples: [], window: 1000 }, expected: [],
  },
  {
    id: 'renamed-streams', title: 'Interleaved probe identities', visibility: 'hidden',
    detail: 'Probe names are data, including constructor. Expiration is independent for each stream.',
    input: { window: 2, samples: [{ t: 0, sensor: 'constructor', value: -6 }, { t: 1, sensor: 'east-2', value: 8 }, { t: 2, sensor: 'constructor', value: 0 }, { t: 3, sensor: 'east-2', value: 2 }, { t: 4, sensor: 'constructor', value: 12 }] },
    expected: [{ t: 0, sensor: 'constructor', mean: -6 }, { t: 1, sensor: 'east-2', mean: 8 }, { t: 2, sensor: 'constructor', mean: -3 }, { t: 3, sensor: 'east-2', mean: 5 }, { t: 4, sensor: 'constructor', mean: 6 }],
  },
  {
    id: 'fractional-prefix', title: 'Fractional means and later equal-time arrivals', visibility: 'hidden',
    detail: 'The third mean is 2/3. Both t=0 readings expire at t=3, and the second t=3 arrival cannot affect the first.',
    input: { window: 2, samples: [{ t: 0, sensor: 'mist', value: 0 }, { t: 0, sensor: 'mist', value: 1 }, { t: 1, sensor: 'mist', value: 1 }, { t: 3, sensor: 'mist', value: 4 }, { t: 3, sensor: 'mist', value: -2 }] },
    expected: [{ t: 0, sensor: 'mist', mean: 0 }, { t: 0, sensor: 'mist', mean: 0.5 }, { t: 1, sensor: 'mist', mean: 0.6666666666666666 }, { t: 3, sensor: 'mist', mean: 2.5 }, { t: 3, sensor: 'mist', mean: 1 }],
  },
  {
    id: 'zero-window-expiry', title: 'Zero window forgets older timestamps', visibility: 'hidden',
    detail: 'Equal-time samples accumulate, but advancing one tick resets this stream.',
    input: { window: 0, samples: [{ t: 999, sensor: 'reed', value: 1000 }, { t: 999, sensor: 'reed', value: -1000 }, { t: 1000, sensor: 'reed', value: -3 }, { t: 1000, sensor: 'reed', value: 9 }] },
    expected: [{ t: 999, sensor: 'reed', mean: 1000 }, { t: 999, sensor: 'reed', mean: 0 }, { t: 1000, sensor: 'reed', mean: -3 }, { t: 1000, sensor: 'reed', mean: 3 }],
  },
  {
    id: 'fractional-values', title: 'Do not round raw readings or means', visibility: 'hidden',
    detail: 'Fractional and negative readings remain numeric. Output order follows arrivals, not probe name.',
    input: { window: 1000, samples: [{ t: 0, sensor: 'z', value: 0.25 }, { t: 500, sensor: 'a', value: -0.5 }, { t: 1000, sensor: 'z', value: -0.75 }, { t: 1000, sensor: 'a', value: 1.25 }] },
    expected: [{ t: 0, sensor: 'z', mean: 0.25 }, { t: 500, sensor: 'a', mean: -0.5 }, { t: 1000, sensor: 'z', mean: -0.25 }, { t: 1000, sensor: 'a', mean: 0.375 }],
  },
];

const checks: ProgramFixture<'steady-the-sensors'>[] = datasets.map(({ input, ...data }) => ({
  ...data, input, args: [input.samples, input.window],
}));
const aliases = 'type SensorSample = { t: number; sensor: string; value: number };';
const signature = 'function smoothSensors(samples: SensorSample[], window: number): { t: number; sensor: string; mean: number }[]';

export const mission: ProgramDefinition<'steady-the-sensors'> = {
  id: 'steady-the-sensors',
  brief: {
    title: 'Steady the sensors',
    lead: 'Give Pip a stable view of the garden probes without hiding new arrivals.',
    story: 'The workshop can repair the irrigation valves now, but their control panel still jumps with every probe packet. Pip asks you to show a recent average beside each raw reading. Soil and air probes must never share an average.\n\nThe panel replays a small recorded feed. Negative values are valid calibrated readings in this model, not damaged packets.',
    objective: 'Implement `smoothSensors(samples, window)` to return one causal, per-sensor window mean after each arrival.',
    goalSteps: [
      'Visit samples in their given arrival order and include the current sample.',
      'Average only already processed samples with the same sensor and t in [current.t - window, current.t].',
      'Return exactly one { t, sensor, mean } row per input row, in the same order.',
      'Keep inputs unchanged and preserve fractional means without rounding.',
    ],
    signature: `${aliases}\n${signature}`,
    parameters: [
      { name: 'samples', type: 'SensorSample[]', description: '0 to 100 samples in nondecreasing integer t order, with t from 0 through 1000. Each sensor matches ^[a-z][a-z0-9-]{0,31}$. Values are finite numbers from -1000 through 1000, including fractions. Sensor names can repeat.' },
      { name: 'window', type: 'number', description: 'Integer simulation ticks from 0 through 1000. The lower boundary is inclusive. With window 0, only already processed arrivals at the current timestamp contribute.' },
    ],
    rules: [
      'For arrival i, inspect only samples 0 through i. A later sample at the same timestamp is still in the future and cannot change an earlier output.',
      'Select only the current sensor and the closed interval [t - window, t]. The current sample guarantees a nonempty mean. Do not average sensors together or keep expired readings.',
      'Return ordinary finite JSON with exactly the fields shown. Object key order is irrelevant; array order is fixed. Compare t and IDs exactly. Only mean allows absolute numeric error up to 1e-9. Do not round.',
      'All inputs are read-only. At most 100 input and output rows keep this feed within the existing 4096-node and 200-item-array sandbox limits; those limits do not change.',
      'Run examples checks the 3 public cases. Submit solution checks all 8 cases, including 5 hidden cases with other inputs. Only all 8 passing plus completed playback of your actual first public result earns progress. Hidden cases are local UI checks, not a secure remote judge.',
      'Playback illustrates these recorded values and your returned means. It does not measure real moisture or prove that a physical irrigation system is safe.',
    ],
    examples: checks.filter((check) => check.visibility === 'public').map((check) => ({ title: check.title, input: JSON.stringify(check.input, null, 2), output: JSON.stringify(check.expected, null, 2), explanation: check.detail })),
  },
  starter: `${aliases}\n\n${signature} {
  // TODO: compute one same-sensor mean for each processed prefix.
  return [];
}
`,
  solution: `${aliases}\n\n${signature} {
  return samples.map((sample, index) => {
    const active = samples.slice(0, index + 1).filter((previous) =>
      previous.sensor === sample.sensor &&
      previous.t >= sample.t - window && previous.t <= sample.t);
    const total = active.reduce((sum, previous) => sum + previous.value, 0);
    return { t: sample.t, sensor: sample.sensor, mean: total / active.length };
  });
}
`,
  hints: [
    'Each output describes the feed at that arrival, not after the entire feed has arrived. Start by isolating the processed prefix.',
    'Within that prefix, keep the same sensor and timestamps greater than or equal to current.t - window. Include the current reading, including with window 0.',
    'Map samples with their index. Filter samples.slice(0, index + 1), sum the selected values, divide by their count, and return the original t and sensor beside the mean.',
  ],
  checks,
};
