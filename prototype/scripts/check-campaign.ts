import assert from 'node:assert/strict';
import { campaignStorageKey, completeMission, freshCampaign, isUnlocked, readCampaign, sourceStorageKeys } from '../src/campaign';
import { missionIds, missionCatalog, previousMission, nextMission } from '../src/mission-catalog';

const initial = freshCampaign();
assert.equal(isUnlocked(initial, 'first-light'), true);
assert.equal(isUnlocked(initial, 'one-crate-one-receipt'), false);
assert.throws(() => completeMission(initial, 'one-crate-one-receipt'), /Complete First light/);
for (const value of [null, '', 'null', '[]', 'false', '{', '"demo solution"', JSON.stringify({ version: 3, completed: ['first-light'] }), ' '.repeat(4097)]) {
  assert.deepEqual(readCampaign(value), initial, `Invalid persisted state stays fresh: ${value?.slice(0, 40)}`);
}
assert.deepEqual(readCampaign(JSON.stringify({ version: 1, introSeen: true, completed: [], currentMission: 'one-crate-one-receipt' })), { ...initial, introSeen: true });
assert.deepEqual(readCampaign(JSON.stringify({ version: 1, completed: ['one-crate-one-receipt'] })), initial);
assert.deepEqual(readCampaign(JSON.stringify({ version: 1, completed: ['constructor', 'read-the-weather'], currentMission: 'constructor' })), initial);
const first = completeMission(initial, 'first-light');
assert.deepEqual(initial.completed, [], 'Completion never mutates prior state');
assert.equal(isUnlocked(first, 'one-crate-one-receipt'), true);
assert.deepEqual(completeMission(first, 'first-light'), first, 'Replay is idempotent');
const second = completeMission({ ...first, introSeen: true }, 'one-crate-one-receipt');
assert.deepEqual(second.completed, ['first-light', 'one-crate-one-receipt']);
assert.deepEqual(readCampaign(JSON.stringify(second)), second, 'Earned progression survives serialization');
assert.deepEqual(readCampaign(JSON.stringify({ ...second, version: 1, completed: ['one-crate-one-receipt', 'first-light', 'first-light', 'read-the-weather'] })), second, 'Legacy unknown new mission strings cannot become awards');
assert.deepEqual(readCampaign(JSON.stringify({ ...second, introSeen: 'yes' })).introSeen, false);
assert.equal(sourceStorageKeys['first-light'], 'aster-route-ts-v1', 'Legacy route source key remains intact');
assert.notEqual(sourceStorageKeys['first-light'], sourceStorageKeys['one-crate-one-receipt']);
assert.notEqual(campaignStorageKey, sourceStorageKeys['first-light']);
assert.notEqual(freshCampaign().completed, freshCampaign().completed, 'Fresh sessions share no mutable arrays');
assert.equal(initial.version, 2);
assert.equal(campaignStorageKey, 'aster-campaign-v1');
assert.equal(sourceStorageKeys['one-crate-one-receipt'], 'aster-intake-ts-v1');
assert.equal(new Set(Object.values(sourceStorageKeys)).size, 11);
assert.equal(new Set(missionIds).size, 11);
assert.equal(new Set(missionIds.map((id) => missionCatalog[id].file)).size, 11);
let earned = freshCampaign();
for (let count = 0; count <= missionIds.length; count++) {
  assert.deepEqual(earned.completed, missionIds.slice(0, count));
  assert.deepEqual(readCampaign(JSON.stringify(earned)), earned, `prefix ${count} survives reload`);
  assert.deepEqual(readCampaign(JSON.stringify({ ...earned, completed: [...earned.completed].reverse().flatMap((id) => [id, id]) })).completed, earned.completed);
  for (const [index, id] of missionIds.entries()) {
    assert.equal(isUnlocked(earned, id), index <= count, `frontier ${count}, ${id}`);
    if (index > count) assert.throws(() => completeMission(earned, id), /Complete/);
  }
  if (count < missionIds.length) {
    const before = structuredClone(earned);
    earned = completeMission(earned, missionIds[count]);
    assert.deepEqual(before.completed, missionIds.slice(0, count));
    assert.equal(completeMission(earned, missionIds[count]), earned, 'already-earned completion is immutable and idempotent');
  }
}
for (const [index, id] of missionIds.entries()) {
  assert.equal(previousMission(id), missionIds[index - 1] ?? null);
  assert.equal(nextMission(id), missionIds[index + 1] ?? null);
  const afterGap = missionIds.filter((candidate) => candidate !== id);
  const normalized = readCampaign(JSON.stringify({ version: 2, completed: afterGap, currentMission: missionIds.at(-1) }));
  assert.deepEqual(normalized.completed, missionIds.slice(0, index), `gap ${id} is never repaired`);
  assert.equal(normalized.currentMission, index >= missionIds.length - 1 ? missionIds.at(-1) : 'first-light');
  if (index >= 2) assert.equal(sourceStorageKeys[id], `aster-${id}-ts-v1`);
}
assert.deepEqual(readCampaign(JSON.stringify({ version: 1, completed: missionIds, currentMission: 'read-the-weather' })), { ...initial, completed: missionIds.slice(0, 2) }, 'v1 accepts only original IDs even with all eleven forged');
assert.throws(() => completeMission({ ...initial, completed: ['one-crate-one-receipt'] }, 'read-the-weather'), /contiguous/, 'completion cannot repair injected gaps');
console.log('Campaign checks passed. Eleven sequential unlocks, all prefixes and gaps, v1 unknown-ID migration, v2 normalization, immutable replay, canonical source keys.');
