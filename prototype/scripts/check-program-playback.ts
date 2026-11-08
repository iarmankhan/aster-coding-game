import assert from 'node:assert/strict';
import { nextExercises } from '../src/curriculum';
import { missionCatalog, missionIds, type ProgramMissionId } from '../src/mission-catalog';
import { buildProgramPlayback, illustrationNotice } from '../src/program-playback';
import type { ProgramPlayback } from '../src/program-mission-types';

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};
const samples = nextExercises.filter((row) => missionIds.slice(2).includes(row.id as ProgramMissionId)).map((row) => {
  const missionId = row.id as ProgramMissionId;
  const input = JSON.parse(row.input);
  return deepFreeze({ missionId, caseId: `${missionId}-curriculum-public`, args: missionCatalog[missionId].args.map((name) => input[name]), output: JSON.parse(row.output) } as ProgramPlayback);
});
assert.equal(samples.length, 9);
const frames = new Map(samples.map((sample) => {
  const before = JSON.stringify(sample);
  const frames = buildProgramPlayback(sample);
  assert(frames.length > 0 && frames.length <= 128);
  assert.equal(new Set(frames.map((frame) => frame.id)).size, frames.length);
  assert.deepEqual(frames.at(-1)!.evidence[0].value, sample.output);
  assert.equal(JSON.stringify(sample), before);
  assert(Object.isFrozen(frames) && Object.isFrozen(frames[0].evidence));
  frames.forEach((frame) => {
    assert(frame.marks.length <= 4);
    frame.marks.forEach((mark) => {
      if (mark.form === 'bar') { assert(Number.isFinite(mark.value)); assert(mark.range && mark.range[0] < mark.range[1]); }
    });
  });
  return [sample.missionId, frames];
}));
const value = (id: ProgramMissionId, index: number, label: string) => frames.get(id)![index].evidence.find((item) => item.label === label)!.value;
assert.deepEqual(frames.get('read-the-weather')!.slice(0, 5).map((frame) => frame.sourceIndices), [[0], [1], [2], [3], [4]]);
assert.deepEqual(frames.get('read-the-weather')!.at(-1)!.marks.slice(0, 2).map((mark) => mark.value), [20, 21.5]);
assert.deepEqual(value('balance-the-store', 0, 'Illustrated balances'), [{ item: 'cell', units: 2 }, { item: 'seed', units: 1 }]);
assert.deepEqual(value('balance-the-store', 1, 'Illustrated balances'), value('balance-the-store', 0, 'Illustrated balances'));
assert.deepEqual(frames.get('balance-the-store')!.at(-1)!.marks.map((mark) => mark.value), [4, 1, 5]);
assert.deepEqual(frames.get('balance-the-store')!.slice(0, 5).map((frame) => frame.marks.find((mark) => mark.id === 'seed')!.range), Array.from({ length: 5 }, () => [0, 5]));
assert.deepEqual(value('balance-the-store', 0, 'Initial stock'), { cell: 2, seed: 4 });
const stockPeak = buildProgramPlayback({ missionId: 'balance-the-store', caseId: 'intermediate-peak', args: [{ ore: 2 }, [{ id: 'credit', item: 'ore', delta: 8 }, { id: 'debit', item: 'ore', delta: -9 }]], output: { balances: [{ item: 'ore', units: 1 }], rejected: [] } });
assert(stockPeak.every((frame) => frame.marks.find((mark) => mark.id === 'ore')!.range![1] === 10), 'Bin scale includes intermediate peaks, not only initial/final balances');
assert.deepEqual(frames.get('share-the-battery')!.slice(0, 3).map((frame) => frame.sourceIndices), [[1], [0], [2]]);
assert.deepEqual(frames.get('share-the-battery')!.at(-1)!.marks.map((mark) => mark.state), ['blocked', 'accepted', 'accepted', 'accepted']);
assert.equal(frames.get('share-the-battery')!.at(-1)!.marks[3].value, 1);
assert.deepEqual([0, 1, 2].map((i) => value('open-the-workshop', i, 'Returned batch')), [['frame'], ['panels'], ['heater']]);
assert.deepEqual(value('open-the-workshop', 3, 'Blocked IDs'), ['sign', 'a', 'b']);
assert.deepEqual(frames.get('steady-the-sensors')!.slice(0, 4).map((frame) => frame.sourceIndices), [[0], [1], [0, 2], [2, 3]]);
assert.deepEqual([0, 1, 2, 3].map((i) => value('steady-the-sensors', i, 'Returned mean')), [{ t: 0, sensor: 'soil', mean: 10 }, { t: 2, sensor: 'air', mean: 20 }, { t: 3, sensor: 'soil', mean: 13 }, { t: 6, sensor: 'soil', mean: 19 }]);
assert.deepEqual(frames.get('raise-the-seedlings')!.slice(0, 6).map((frame) => frame.marks[0].label), ['seed, streak 0', 'sprout, streak 0', 'sprout, streak 1', 'sprout, streak 2', 'ready, streak 0', 'ready, streak 0']);
assert.deepEqual(value('give-the-radio-a-rest', 0, 'Returned schedule'), { id: 'a', attempt: 2, dueAt: 110 });
assert.deepEqual(value('give-the-radio-a-rest', 1, 'Returned schedule'), { id: 'b', attempt: 4, dueAt: 125 });
assert.deepEqual(value('give-the-radio-a-rest', 2, 'Returned schedule'), { exhausted: ['c'] });
assert.deepEqual([1, 3, 5].map((i) => value('keep-the-airlock-clear', i, 'Returned history frame')), [{ started: [], waiting: ['a', 'b'], rejected: ['c'] }, { started: ['a'], waiting: ['b', 'd'], rejected: [] }, { started: ['b', 'd'], waiting: [], rejected: [] }]);
assert.deepEqual(value('agree-on-the-beacon', 2, 'Illustrated board with tombstones'), [{ id: 'sprout', version: 4 }]);
assert.deepEqual(value('agree-on-the-beacon', 7, 'Illustrated board with tombstones'), [{ id: 'gate', version: 2 }, { id: 'pump', version: 1, value: 'on' }, { id: 'sprout', version: 5, value: 'growing' }]);
for (const id of ['balance-the-store', 'share-the-battery', 'agree-on-the-beacon'] as const) assert(frames.get(id)!.every((frame) => frame.description.includes(illustrationNotice)));
const tolerant = structuredClone(samples[0]) as Extract<ProgramPlayback, { missionId: 'read-the-weather' }>;
tolerant.output.readings[0].celsius += 5e-10;
assert.equal(buildProgramPlayback(tolerant).at(-1)!.marks[0].value, 20 + 5e-10);
const equalTime: ProgramPlayback = { missionId: 'steady-the-sensors', caseId: 'equal-time', args: [[{ t: 4, sensor: 'renamed', value: 1 }, { t: 4, sensor: 'renamed', value: 3 }], 0], output: [{ t: 4, sensor: 'renamed', mean: 1 + 5e-10 }, { t: 4, sensor: 'renamed', mean: 2 }] };
assert.deepEqual(buildProgramPlayback(equalTime).slice(0, 2).map((frame) => frame.sourceIndices), [[0], [0, 1]]);
assert.equal(buildProgramPlayback(equalTime)[0].marks[1].value, 1 + 5e-10);
const empties: ProgramPlayback[] = [
  { missionId: 'read-the-weather', caseId: 'empty', args: [[]], output: { readings: [], rejected: [] } },
  { missionId: 'balance-the-store', caseId: 'empty', args: [{}, []], output: { balances: [], rejected: [] } },
  { missionId: 'share-the-battery', caseId: 'empty', args: [0, []], output: { powered: [], remaining: 0 } },
  { missionId: 'open-the-workshop', caseId: 'empty', args: [[], []], output: { batches: [], blocked: [] } },
  { missionId: 'steady-the-sensors', caseId: 'empty', args: [[], 1], output: [] },
  { missionId: 'raise-the-seedlings', caseId: 'empty', args: [{ phase: 'seed', streak: 0 }, []], output: { timeline: [], final: { phase: 'seed', streak: 0 } } },
  { missionId: 'give-the-radio-a-rest', caseId: 'empty', args: [[], 1, 1, 1], output: { retries: [], exhausted: [] } },
  { missionId: 'keep-the-airlock-clear', caseId: 'empty', args: [0, []], output: { history: [], waiting: [] } },
  { missionId: 'agree-on-the-beacon', caseId: 'empty', args: [[]], output: { entities: [], tombstones: [], ignored: [] } },
];
empties.forEach((sample) => assert.equal(buildProgramPlayback(sample).at(-1)!.title, 'Actual returned result'));
const mismatch = structuredClone(samples[1]) as Extract<ProgramPlayback, { missionId: 'balance-the-store' }>;
mismatch.output.balances[0].units++;
assert.throws(() => buildProgramPlayback(mismatch), /Illustrated stock differs/);
assert.throws(() => buildProgramPlayback({ missionId: 'steady-the-sensors', caseId: 'too-many-display-steps', args: [Array.from({ length: 128 }, (_, t) => ({ t, sensor: 's', value: 1 })), 0], output: Array.from({ length: 128 }, (_, t) => ({ t, sensor: 's', mean: 1 })) }), /128-step display limit/);
console.log('PASS nine frozen canonical programs, exact semantic payoffs, actual tolerant numbers, causal equal timestamps, nine empty histories, derived endpoint mismatch, explicit 128-step authoring limit.');
