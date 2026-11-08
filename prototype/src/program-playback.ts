import type { ProgramPlayback, GrowthState } from './program-mission-types';

export type PlaybackMark = Readonly<{
  id: string; label: string;
  form: 'bar' | 'lamp' | 'token' | 'sprout';
  state: 'idle' | 'active' | 'accepted' | 'rejected' | 'blocked' | 'deleted' | 'complete';
  value: number | null; range: readonly [number, number] | null;
}>;
export type PlaybackEvidence = Readonly<{ label: string; origin: 'input' | 'output' | 'derived'; value: unknown }>;
export type ProgramFrame = Readonly<{
  id: string; title: string; description: string; sourceIndices: readonly number[];
  evidence: readonly PlaybackEvidence[]; marks: readonly PlaybackMark[];
}>;

export const illustrationNotice = 'Illustrated steps derived from input and your validated result. Not an execution trace of your function.';
const evidence = (label: string, origin: PlaybackEvidence['origin'], value: unknown): PlaybackEvidence => ({ label, origin, value });
const token = (id: string, label: string, state: PlaybackMark['state'] = 'accepted', form: PlaybackMark['form'] = 'token'): PlaybackMark => ({ id, label, state, form, value: null, range: null });
const bar = (id: string, label: string, value: number, low: number, high: number): PlaybackMark => ({ id, label, value, range: [low, high], form: 'bar', state: 'accepted' });
const growth = (state: GrowthState): PlaybackMark => ({ ...token('nursery-bed', `${state.phase}, streak ${state.streak}`, state.phase === 'wilted' ? 'rejected' : state.phase === 'ready' ? 'complete' : state.phase === 'seed' ? 'idle' : 'active', 'sprout'), value: state.streak });

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Result playback unavailable. ${message}`);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function buildProgramPlayback(sample: ProgramPlayback): readonly ProgramFrame[] {
  const frames: ProgramFrame[] = [];
  const add = (title: string, description: string, sourceIndices: number[], evidence: PlaybackEvidence[], marks: PlaybackMark[]) => {
    invariant(frames.length < 128, 'This public sample exceeds the 128-step display limit. No evidence was omitted.');
    frames.push({ id: `${sample.missionId}-${frames.length + 1}`, title, description, sourceIndices, evidence, marks: marks.slice(0, 4) });
  };
  let finalMarks: PlaybackMark[] = [];
  let derived = false;
  switch (sample.missionId) {
    case 'read-the-weather': {
      const { output, args: [lines] } = sample;
      let readingIndex = 0;
      const seen: PlaybackMark[] = [];
      lines.forEach((line, index) => {
        const rejected = output.rejected.includes(index);
        const reading = rejected ? null : output.readings[readingIndex++];
        invariant(rejected || Boolean(reading), 'Weather readings do not map to source lines.');
        if (reading) seen.push(bar(`${index}`, `${reading.sensor} ${reading.celsius} °C`, reading.celsius, -50, 80));
        add(`Packet ${index}`, rejected ? 'Rejected source line. No reading was created.' : `${reading!.sensor} decoded. Thermometer scale -50 to 80 °C.`, [index], [evidence('Source line', 'input', line), evidence('Decision', 'output', rejected ? { rejectedIndex: index } : reading)], rejected ? [...seen.slice(-3), token(`rejected-${index}`, `Packet ${index} rejected`, 'rejected')] : seen.slice(-4));
      });
      invariant(readingIndex === output.readings.length, 'Weather reading count differs from accepted source lines.');
      finalMarks = [...seen.slice(0, 3), token('rejects', `${output.rejected.length} rejected packets`, 'rejected', 'lamp')];
      break;
    }
    case 'balance-the-store': {
      derived = true;
      const { output, args: [stock, changes] } = sample;
      const balances = new Map(Object.entries(stock));
      const rows = () => [...balances].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([item, units]) => ({ item, units }));
      let scaleMax = Math.max(1, ...balances.values());
      const snapshots = changes.map((change, index) => {
        const rejected = output.rejected.includes(change.id);
        if (!rejected) balances.set(change.item, (balances.get(change.item) ?? 0) + change.delta);
        const values = rows();
        for (const row of values) scaleMax = Math.max(scaleMax, row.units);
        return { change, index, rejected, values };
      });
      const marks = (values = rows()) => values.map(({ item, units }) => bar(item, `${item} ${units} units`, units, 0, scaleMax));
      snapshots.forEach(({ change, index, rejected, values }) => {
        add(`Ledger row ${change.id}`, `${illustrationNotice} Fixed bin scale 0 to ${scaleMax} units. ${rejected ? 'Rejected. Bins unchanged.' : 'Delta applied to bin.'}`, [index], [evidence('Initial stock', 'input', stock), evidence('Change', 'input', change), evidence('Rejected IDs', 'output', output.rejected), evidence('Illustrated balances', 'derived', values)], [...marks(values).slice(0, 3), token(change.id, `${change.id} ${rejected ? 'rejected' : 'applied'}`, rejected ? 'rejected' : 'accepted')]);
      });
      invariant(JSON.stringify(rows()) === JSON.stringify(output.balances.map(({ item, units }) => ({ item, units }))), 'Illustrated stock differs from your returned balances.');
      finalMarks = marks();
      break;
    }
    case 'share-the-battery': {
      derived = true;
      const { output, args: [energy, requests] } = sample;
      let remaining = energy;
      const powered: string[] = [];
      const states = new Map<string, PlaybackMark['state']>();
      const marks = () => requests.map((request) => token(request.id, `${request.id} ${states.get(request.id) === 'accepted' ? 'on' : 'waiting'}`, states.get(request.id) ?? 'idle', 'lamp'));
      [...requests.keys()].sort((a, b) => requests[b].priority - requests[a].priority || a - b).forEach((index) => {
        const request = requests[index];
        const granted = output.powered.includes(request.id);
        if (granted) { remaining -= request.demand; powered.push(request.id); }
        states.set(request.id, granted ? 'accepted' : 'blocked');
        add(`Appliance ${request.id}`, `${illustrationNotice} ${granted ? 'Full grant.' : 'Waiting. Later requests still considered.'}`, [index], [evidence('Request', 'input', request), evidence('Powered IDs', 'output', output.powered), evidence('Illustrated remaining energy', 'derived', remaining)], marks());
      });
      invariant(remaining === output.remaining && JSON.stringify(powered) === JSON.stringify(output.powered), 'Illustrated allocation differs from your returned power result.');
      finalMarks = [...marks().slice(0, 3), bar('energy', `${output.remaining} / ${energy} energy remains`, output.remaining, 0, Math.max(1, energy))];
      break;
    }
    case 'open-the-workshop': {
      const { output, args: [jobs, done] } = sample;
      output.batches.forEach((batch, index) => add(`Repair batch ${index + 1}`, 'Jobs in this returned batch become ready together. No fabricated Pip route.', jobs.flatMap((job, i) => batch.includes(job.id) ? [i] : []), [evidence('Returned batch', 'output', batch), evidence('Job dependencies', 'input', jobs), evidence('Already done', 'input', done)], batch.map((id) => token(id, `${id} ready`, 'complete'))));
      add('Blocked work', `${output.blocked.length} unresolved jobs remain labeled.`, jobs.flatMap((job, i) => output.blocked.includes(job.id) ? [i] : []), [evidence('Blocked IDs', 'output', output.blocked), evidence('Dependencies', 'input', jobs)], output.blocked.map((id) => token(id, `${id} blocked`, 'blocked')));
      finalMarks = [...output.batches.flat().slice(0, 3).map((id) => token(id, `${id} ready`, 'complete')), token('blocked', `${output.blocked.length} blocked`, 'blocked', 'lamp')];
      break;
    }
    case 'steady-the-sensors': {
      const { output, args: [samples, window] } = sample;
      invariant(output.length === samples.length, 'Sensor results differ from source arrival count.');
      output.forEach((row, index) => {
        const sourceIndices = samples.flatMap((source, i) => i <= index && source.sensor === row.sensor && source.t >= row.t - window ? [i] : []);
        const values = sourceIndices.map((i) => samples[i].value);
        const range: [number, number] = [Math.min(0, row.mean, ...values), Math.max(1, row.mean, ...values)];
        add(`Arrival ${index}, ${row.sensor} at ${row.t}`, 'Returned mean uses only earlier processed arrivals of this sensor, including this row. Source indices identify the causal window.', sourceIndices, [evidence('Raw arrival', 'input', samples[index]), evidence('Window width', 'input', window), evidence('Contributing source indices', 'derived', sourceIndices), evidence('Contributing values', 'derived', values), evidence('Returned mean', 'output', row)], [bar('raw', `Raw ${samples[index].value}`, samples[index].value, ...range), bar('mean', `${row.sensor} mean ${row.mean}`, row.mean, ...range)]);
      });
      const low = Math.min(0, ...output.map((row) => row.mean));
      const high = Math.max(1, ...output.map((row) => row.mean));
      finalMarks = output.slice(-4).map((row, i) => bar(`${i}`, `${row.sensor} @${row.t} mean ${row.mean}`, row.mean, low, high));
      break;
    }
    case 'raise-the-seedlings': {
      const { output, args: [initial, days] } = sample;
      invariant(output.timeline.length === days.length, 'Growth history differs from source day count.');
      output.timeline.forEach((state, index) => add(`Nursery day ${index + 1}`, `Owned nursery display. ${state.phase}, streak ${state.streak}. Greenhouse crops are separate.`, [index], [evidence('Previous state', index ? 'output' : 'input', index ? output.timeline[index - 1] : initial), evidence('Day conditions', 'input', days[index]), evidence('Returned state', 'output', state)], [growth(state)]));
      const endpoint = output.timeline.at(-1) ?? initial;
      invariant(endpoint.phase === output.final.phase && endpoint.streak === output.final.streak, 'Growth final differs from your returned timeline.');
      finalMarks = [growth(output.final)];
      break;
    }
    case 'give-the-radio-a-rest': {
      const { output, args: [failures, baseDelay, maxDelay, maxAttempts] } = sample;
      const maxTick = Math.max(1, ...output.retries.map((retry) => retry.dueAt));
      failures.forEach((failure, index) => {
        const retry = output.retries.find((row) => row.id === failure.id);
        add(`Failed send ${failure.id}`, retry ? `Attempt ${retry.attempt} scheduled for tick ${retry.dueAt}. Schedule only, not a delivery.` : 'Attempt budget exhausted. No transmission claimed.', [index], [evidence('Failed send', 'input', failure), evidence('Delay policy', 'input', { baseDelay, maxDelay, maxAttempts }), evidence('Returned schedule', 'output', retry ?? { exhausted: output.exhausted.filter((id) => id === failure.id) })], [retry ? bar(failure.id, `${retry.id} attempt ${retry.attempt} due ${retry.dueAt}`, retry.dueAt, 0, maxTick) : token(failure.id, `${failure.id} exhausted`, 'blocked')]);
      });
      finalMarks = [...output.retries.slice(0, 3).map((row) => bar(row.id, `${row.id} attempt ${row.attempt} due ${row.dueAt}`, row.dueAt, 0, maxTick)), token('exhausted', `Exhausted ${output.exhausted.join(', ') || 'none'}`, 'blocked')];
      break;
    }
    case 'keep-the-airlock-clear': {
      const { output, args: [capacity, ticks] } = sample;
      invariant(output.history.length === ticks.length, 'Queue history differs from source tick count.');
      output.history.forEach((row, index) => {
        add(`Tick ${index + 1}, departures`, 'Old waiting carts depart before new arrivals. Started IDs come from your returned frame.', [index], [evidence('Old waiting', 'output', index ? output.history[index - 1].waiting : []), evidence('Started', 'output', row.started), evidence('Tick', 'input', ticks[index])], row.started.map((id) => token(id, `${id} started`, 'complete')));
        add(`Tick ${index + 1}, admissions`, 'Returned waiting and rejected trays after admissions. Rejected carts do not return.', [index], [evidence('Capacity', 'input', capacity), evidence('Arrivals', 'input', ticks[index].arrivals), evidence('Returned history frame', 'output', row)], [...row.waiting.slice(0, 3).map((id) => token(id, `${id} waiting`, 'active')), ...row.rejected.slice(0, 1).map((id) => token(id, `${id} rejected`, 'rejected'))]);
      });
      invariant(JSON.stringify(output.history.at(-1)?.waiting ?? []) === JSON.stringify(output.waiting), 'Queue final differs from your returned history.');
      finalMarks = output.waiting.length ? output.waiting.map((id) => token(id, `${id} waiting`, 'active')) : [token('clear', 'Queue empty', 'complete', 'lamp')];
      break;
    }
    case 'agree-on-the-beacon': {
      derived = true;
      const { output, args: [events] } = sample;
      const board = new Map<string, { id: string; version: number; value?: string }>();
      const entries = () => [...board.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const marks = () => entries().map((row) => token(row.id, 'value' in row ? `${row.id}=${row.value}@${row.version}` : `${row.id} tombstone@${row.version}`, 'value' in row ? 'accepted' : 'deleted'));
      events.forEach((event, index) => {
        const ignored = output.ignored.includes(index);
        if (!ignored) board.set(event.id, event.kind === 'set' ? { id: event.id, version: event.version, value: event.value } : { id: event.id, version: event.version });
        add(`Beacon arrival ${index}`, `${illustrationNotice} ${ignored ? 'Ignored arrival. Board unchanged.' : event.kind === 'delete' ? 'Tombstone retained.' : 'Live revision accepted.'}`, [index], [evidence('Arrival', 'input', event), evidence('Ignored indices', 'output', output.ignored), evidence('Illustrated board with tombstones', 'derived', entries())], marks());
      });
      const live = entries().filter((row) => 'value' in row).map(({ id, value, version }) => ({ id, value, version }));
      const tombstones = entries().filter((row) => !('value' in row)).map(({ id, version }) => ({ id, version }));
      invariant(JSON.stringify(live) === JSON.stringify(output.entities.map(({ id, value, version }) => ({ id, value, version }))) && JSON.stringify(tombstones) === JSON.stringify(output.tombstones.map(({ id, version }) => ({ id, version }))), 'Illustrated beacon board differs from your returned result.');
      finalMarks = marks();
      break;
    }
  }
  add('Actual returned result', derived ? illustrationNotice : 'Final snapshot of your validated public result. No hidden case values enter this display.', [], [evidence('Actual output', 'output', sample.output)], finalMarks.length ? finalMarks : [token('empty', 'Empty result', 'complete', 'lamp')]);
  // Own the evidence snapshots. Later caller mutations cannot rewrite an inspected result.
  return freeze(JSON.parse(JSON.stringify(frames)) as ProgramFrame[]);
}
