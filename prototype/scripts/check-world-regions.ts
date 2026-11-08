import assert from 'node:assert/strict';
import { missionIds, missionCatalog, previousMission, type MissionId } from '../src/mission-catalog';
import { worldMissionView } from '../src/world-regions';

for (let count = 0; count <= missionIds.length; count++) {
  const completed = Object.freeze(missionIds.slice(0, count));
  for (const activeMission of missionIds) {
    const context = Object.freeze({ activeMission, completed });
    const view = worldMissionView(context);
    assert.equal(worldMissionView(context), view);
    assert.equal(view.regions.length, 11);
    assert.equal(view.completedCount, count);
    assert.equal(view.regions.filter((region) => region.active).length, 1);
    assert.equal(view.target, missionCatalog[activeMission].focus);
    view.regions.forEach((region, index) => {
      assert.equal(region.availability, index < count ? 'complete' : index === count ? 'available' : 'locked');
      assert(Object.isFrozen(region));
    });
    const nextLocked = missionIds[count + 1];
    assert.equal(view.nextLocked?.mission, nextLocked);
    if (nextLocked) assert(view.lockLabel.includes(missionCatalog[previousMission(nextLocked)!].title));
    assert.equal(view.clusters.length, 6);
    assert.equal(view.clusters.flatMap((cluster) => cluster.missions).length, 11);
    assert(Object.isFrozen(view.clusters[0].missions));
    assert.doesNotMatch(view.description, /planned|not playable/i);
    assert.match(view.description, /All six stations/);
  }
}
const mutable: MissionId[] = [];
const owned = worldMissionView({ activeMission: 'first-light', completed: mutable });
mutable.push('first-light');
assert.equal(owned.regions[1].availability, 'locked');
assert.equal(worldMissionView({ activeMission: 'agree-on-the-beacon', completed: ['first-light', 'agree-on-the-beacon'] }).completedCount, 1);
assert.match(worldMissionView({ activeMission: 'agree-on-the-beacon', completed: missionIds }).lockLabel, /All missions complete/);
console.log('PASS 132 immutable world contexts. Eleven regions, six clusters, contiguous earned prefixes, exact predecessor locks, stable bounded cache.');
