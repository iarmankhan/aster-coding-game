import assert from 'node:assert/strict';
import { graph, validateRoute, navigationChecks, checkNavigation } from '../src/mission.ts';

assert.equal(validateRoute(['dock', 'relay', 'junction', 'garden', 'greenhouse']).ok, true);
assert.equal(validateRoute(['dock', 'relay', 'junction', 'observatory', 'garden', 'greenhouse']).ok, true);
assert.equal(validateRoute(['dock', 'greenhouse']).ok, false);
assert.deepEqual(validateRoute(['dock', 'relay', 'greenhouse']).prefix, ['dock', 'relay']);
assert.match(validateRoute(['dock', 'relay', 'greenhouse']).error, /broken/);
assert.equal(validateRoute([]).ok, false);
assert.equal(validateRoute(['greenhouse']).ok, false);
assert.equal(validateRoute(['dock', 'constructor']).ok, false);
assert.equal(validateRoute(['dock', {}]).ok, false);
assert.equal(validateRoute(Array(101).fill('dock')).ok, false);
for (const [id, neighbors] of Object.entries(graph)) {
  for (const neighbor of neighbors) assert(graph[neighbor].includes(id));
}
console.log('PASS mission routes, alternate route, blocked corridor, invalid IDs, limits, and symmetric graph.');
assert.equal(checkNavigation(navigationChecks[1], ['dock', 'relay', 'junction', 'garden', 'greenhouse']).ok, false);
assert.equal(checkNavigation(navigationChecks[1], ['dock', 'relay', 'junction', 'observatory', 'garden', 'greenhouse']).ok, true);
assert.equal(checkNavigation(navigationChecks[2], []).ok, true);
assert.equal(checkNavigation(navigationChecks[2], ['dock', 'greenhouse']).ok, false);
console.log('PASS disclosed detour and unreachable navigation checks.');
