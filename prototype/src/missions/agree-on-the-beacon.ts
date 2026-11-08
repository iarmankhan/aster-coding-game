import type { BeaconEvent, ProgramDefinition, ProgramFixture } from '../program-mission-types';

type Dataset = Omit<ProgramFixture<'agree-on-the-beacon'>, 'args' | 'input'> & {
  input: { events: BeaconEvent[] };
};

const datasets: Dataset[] = [
  {
    id: 'service-board', title: 'Keep newer records and remember deletions', visibility: 'public',
    detail: 'sprout revives only at version 5. pump keeps its first version-1 value. gate remains deleted despite an older set packet.',
    input: { events: [{ id: 'sprout', version: 2, kind: 'set', value: 'lit' }, { id: 'sprout', version: 4, kind: 'delete' }, { id: 'sprout', version: 3, kind: 'set', value: 'dry' }, { id: 'pump', version: 1, kind: 'set', value: 'on' }, { id: 'pump', version: 1, kind: 'set', value: 'off' }, { id: 'sprout', version: 5, kind: 'set', value: 'growing' }, { id: 'gate', version: 2, kind: 'delete' }, { id: 'gate', version: 1, kind: 'set', value: 'open' }] },
    expected: { entities: [{ id: 'pump', value: 'on', version: 1 }, { id: 'sprout', value: 'growing', version: 5 }], tombstones: [{ id: 'gate', version: 2 }], ignored: [2, 4, 7] },
  },
  {
    id: 'first-zero', title: 'First version zero is a real event', visibility: 'public',
    detail: 'The first gate deletion at version 0 is accepted and retained. An empty value is a valid lamp set at version 0. Equal versions cannot replace either first event.',
    input: { events: [{ id: 'gate', version: 0, kind: 'delete' }, { id: 'gate', version: 0, kind: 'set', value: 'open' }, { id: 'gate', version: 0, kind: 'delete' }, { id: 'lamp', version: 0, kind: 'set', value: '' }, { id: 'lamp', version: 0, kind: 'set', value: 'on' }] },
    expected: { entities: [{ id: 'lamp', value: '', version: 0 }], tombstones: [{ id: 'gate', version: 0 }], ignored: [1, 2, 4] },
  },
  {
    id: 'equal-conflicts', title: 'First arrival wins equal-version conflicts', visibility: 'public',
    detail: 'Equal-version delete cannot erase a set, and equal-version set cannot revive a deletion. A strictly higher version can replace the first set.',
    input: { events: [{ id: 'a', version: 2, kind: 'set', value: 'first' }, { id: 'a', version: 2, kind: 'delete' }, { id: 'b', version: 2, kind: 'delete' }, { id: 'b', version: 2, kind: 'set', value: 'late' }, { id: 'a', version: 3, kind: 'set', value: 'new' }, { id: 'a', version: 3, kind: 'set', value: 'equal' }] },
    expected: { entities: [{ id: 'a', value: 'new', version: 3 }], tombstones: [{ id: 'b', version: 2 }], ignored: [1, 3, 5] },
  },
  {
    id: 'no-packets', title: 'Empty event stream', visibility: 'hidden',
    detail: 'An empty stream yields three empty arrays.',
    input: { events: [] }, expected: { entities: [], tombstones: [], ignored: [] },
  },
  {
    id: 'delete-revive-delete', title: 'Tombstones survive stale packets but allow newer revival', visibility: 'hidden',
    detail: 'Lower and equal versions cannot replace a tombstone or live record. Later strictly newer updates can delete and revive the same ID repeatedly.',
    input: { events: [{ id: 'reef', version: 2, kind: 'set', value: 'on' }, { id: 'reef', version: 5, kind: 'delete' }, { id: 'reef', version: 4, kind: 'set', value: 'stale' }, { id: 'reef', version: 3, kind: 'delete' }, { id: 'reef', version: 6, kind: 'set', value: 'back' }, { id: 'reef', version: 6, kind: 'delete' }, { id: 'reef', version: 7, kind: 'delete' }, { id: 'reef', version: 8, kind: 'set', value: '' }] },
    expected: { entities: [{ id: 'reef', value: '', version: 8 }], tombstones: [], ignored: [2, 3, 5] },
  },
  {
    id: 'ascii-and-map-keys', title: 'ASCII ordering and prototype-like IDs', visibility: 'hidden',
    detail: 'Sort uppercase before lowercase using ASCII order, not locale rules. constructor is an ordinary ID. Sort live records and tombstones separately.',
    input: { events: [{ id: 'z', version: 1, kind: 'set', value: 'last' }, { id: 'constructor', version: 0, kind: 'set', value: '' }, { id: 'a-1', version: 3, kind: 'set', value: 'suffix' }, { id: 'a', version: 4, kind: 'set', value: 'lower' }, { id: 'A', version: 2, kind: 'set', value: 'upper' }, { id: 'b', version: 9, kind: 'delete' }, { id: 'B', version: 0, kind: 'delete' }] },
    expected: { entities: [{ id: 'A', value: 'upper', version: 2 }, { id: 'a', value: 'lower', version: 4 }, { id: 'a-1', value: 'suffix', version: 3 }, { id: 'constructor', value: '', version: 0 }, { id: 'z', value: 'last', version: 1 }], tombstones: [{ id: 'B', version: 0 }, { id: 'b', version: 9 }], ignored: [] },
  },
  {
    id: 'ignored-arrival-order', title: 'Ignored indices follow arrivals across IDs', visibility: 'hidden',
    detail: 'Collect ignored zero-based input indices as packets arrive, not grouped by ID, kind, or version. Higher packets still update both IDs afterward.',
    input: { events: [{ id: 'z', version: 8, kind: 'set', value: 'z8' }, { id: 'a', version: 3, kind: 'delete' }, { id: 'z', version: 1, kind: 'set', value: 'old' }, { id: 'a', version: 3, kind: 'set', value: 'equal' }, { id: 'z', version: 8, kind: 'delete' }, { id: 'a', version: 2, kind: 'delete' }, { id: 'z', version: 9, kind: 'set', value: 'z9' }, { id: 'a', version: 4, kind: 'set', value: 'a4' }] },
    expected: { entities: [{ id: 'a', value: 'a4', version: 4 }, { id: 'z', value: 'z9', version: 9 }], tombstones: [], ignored: [2, 3, 4, 5] },
  },
  {
    id: 'deletion-version-bound', title: 'Newer deletions advance the remembered version', visibility: 'hidden',
    detail: 'A repeated deletion with a higher version must update the tombstone, so an intervening set remains stale. The maximum supported version compares exactly.',
    input: { events: [{ id: 'mast', version: 0, kind: 'set', value: 'on' }, { id: 'mast', version: 1, kind: 'delete' }, { id: 'mast', version: 1, kind: 'delete' }, { id: 'mast', version: 1000000, kind: 'delete' }, { id: 'mast', version: 999999, kind: 'set', value: 'stale' }, { id: 'mast', version: 1000000, kind: 'set', value: 'equal' }] },
    expected: { entities: [], tombstones: [{ id: 'mast', version: 1000000 }], ignored: [2, 4, 5] },
  },
];

const checks: ProgramFixture<'agree-on-the-beacon'>[] = datasets.map(({ input, ...data }) => ({
  ...data, input, args: [input.events],
}));
const aliases = 'type BeaconEvent = { id: string; version: number } & ({ kind: "set"; value: string } | { kind: "delete" });';
const signature = 'function reconcileBeacons(events: BeaconEvent[]): { entities: { id: string; value: string; version: number }[]; tombstones: { id: string; version: number }[]; ignored: number[] }';

export const mission: ProgramDefinition<'agree-on-the-beacon'> = {
  id: 'agree-on-the-beacon',
  brief: {
    title: 'Agree on the beacon',
    lead: 'Help Pip rebuild one service board from delayed beacon packets.',
    story: 'Carts now have an inspectable path through the greenhouse lane. At the relay, the last problem is an old packet that keeps bringing a deleted service beacon back onto the board. Pip has all packet arrivals, including conflicting versions.\n\nKeep one newest accepted record for each ID. A deletion must leave its version behind so stale packets cannot revive it.',
    objective: 'Implement `reconcileBeacons(events)` with strictly newer version acceptance, retained deletion tombstones, and deterministic output order.',
    goalSteps: [
      'Process events in arrival order. Accept any first event for an ID, including version 0 and delete.',
      'After that, accept only a strictly greater version. Record every other arrival index in ignored.',
      'Retain accepted deletes as tombstones; a strictly newer set recreates the live entity.',
      'Return live entities and tombstones separately sorted by ASCII ID, with ignored indices in arrival order.',
    ],
    signature: `${aliases}\n${signature}`,
    parameters: [
      { name: 'events', type: 'BeaconEvent[]', description: '0 to 100 packets in arrival order, not sorted by version. IDs match ^[A-Za-z][A-Za-z0-9-]{0,31}$ and may repeat, including constructor. version is an integer from 0 through 1000000. A set has a string value of 0 to 64 characters, including the empty string. A delete has no value field.' },
    ],
    rules: [
      'Absence is different from version 0. The first event always wins its empty slot. For an existing record, equal or lower version is ignored even when its kind or value differs. First arrival wins equal versions.',
      'An accepted delete replaces live state but retains id and version. An accepted newer delete also advances an existing tombstone. Do not remove the remembered version or let an old set bring it back.',
      'A strictly newer set replaces a tombstone with a live entity. Empty set values are valid. Treat every ID as data rather than an object prototype property.',
      'entities contains exactly { id, value, version } for currently live IDs. tombstones contains exactly { id, version } for currently deleted IDs. Each ID appears in only one list. Sort each list by ASCII ID with ordinary string ordering, not localeCompare. ignored contains zero-based input indices in arrival order.',
      'Inputs are read-only. Return ordinary finite JSON with exactly entities, tombstones, ignored. Object key order is irrelevant; array order is fixed. Versions and indices compare as exact integers, with no tolerance.',
      'At most 100 packets keep each output list at most 100 rows and the complete data within the unchanged 4096-node and 200-item-array sandbox limits. Do not invent packets or consult a clock or network.',
      'Run examples checks the 3 public cases. Submit solution checks all 8 cases, including 5 hidden cases. Only all 8 passing plus completed playback of your actual first public result earns progress. Hidden checks run locally and are not a secure remote judge.',
      'Playback illustrates reconciliation of these packets and your returned board. It does not synchronize physical beacons or promise distributed-system safety beyond this stated model.',
    ],
    examples: checks.filter((check) => check.visibility === 'public').map((check) => ({ title: check.title, input: JSON.stringify(check.input, null, 2), output: JSON.stringify(check.expected, null, 2), explanation: check.detail })),
  },
  starter: `${aliases}\n\n${signature} {
  // TODO: retain newest accepted records, including deletion versions.
  return { entities: [], tombstones: [], ignored: [] };
}
`,
  solution: `${aliases}\n\n${signature} {
  const latest = new Map<string, BeaconEvent>();
  const ignored: number[] = [];
  events.forEach((event, index) => {
    const previous = latest.get(event.id);
    if (previous !== undefined && event.version <= previous.version) ignored.push(index);
    else latest.set(event.id, event);
  });
  const entities: { id: string; value: string; version: number }[] = [];
  const tombstones: { id: string; version: number }[] = [];
  for (const id of [...latest.keys()].sort()) {
    const event = latest.get(id)!;
    if (event.kind === 'set') entities.push({ id, value: event.value, version: event.version });
    else tombstones.push({ id, version: event.version });
  }
  return { entities, tombstones, ignored };
}
`,
  hints: [
    'Store the latest accepted event for each ID, including deletes. No event is different from a version-0 event.',
    'A Map treats constructor like any other key. While scanning, ignore an arrival only when a prior record exists and its version is greater than or equal to the incoming version.',
    'Collect ignored indices during the scan. Then sort the Map keys with .sort(). For each retained set emit { id, value, version }; for each retained delete emit { id, version } into the other list.',
  ],
  checks,
};
