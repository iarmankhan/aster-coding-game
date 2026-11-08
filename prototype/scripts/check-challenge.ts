import assert from 'node:assert/strict';
import { caseReport, challengeCases, initialReports, validateCase } from '../src/challenge';
import { deliveryMission } from '../src/delivery-mission';
import { missions } from '../src/missions';
import { missionIds, missionCatalog } from '../src/mission-catalog';
import { makeBatch, LIMITS } from '../src/runner-protocol';
import { executeTestSource } from './runner-node-adapter';

let executions = 0;
for (const mission of missionIds) {
  const examples = challengeCases(mission, 'examples');
  const all = challengeCases(mission, 'submit');
  const brief = missions[mission].brief;
  const reference = missions[mission].solution;
  const entry = missionCatalog[mission].entry;
  assert.equal(examples.length, 3);
  assert.equal(all.length, mission === 'first-light' ? 6 : 8);
  assert(all.length <= LIMITS.fixtures);
  assert.equal(new Set(all.map((test) => test.id)).size, all.length);
  assert.equal(initialReports(mission).length, all.length);
  makeBatch('', entry, all.map((test) => ({ id: test.id, args: test.args })), 1);
  for (const [index, test] of examples.entries()) {
    const input = JSON.parse(brief.examples[index].input);
    assert.deepEqual(caseReport(test), initialReports(mission, 'examples')[index]);
    assert.deepEqual(test.args, missionCatalog[mission].args.map((name) => input[name]), 'runnable examples are exactly the displayed inputs, in order');
    assert.equal(validateCase(test, JSON.parse(brief.examples[index].output)), null);
  }
  for (const test of all) {
    if (test.kind === 'route') {
      const [graph, start, goal] = test.args;
      assert.equal(Object.keys(graph).length, 6);
      assert(Object.hasOwn(graph, start) && Object.hasOwn(graph, goal));
      for (const [node, neighbors] of Object.entries(graph)) {
        assert(node.length > 0 && node.length <= LIMITS.idChars);
        for (const next of neighbors) assert(graph[next]?.includes(node), 'every corridor exists in both directions');
      }
      if (test.visibility === 'hidden') assert(!Object.hasOwn(graph, 'dock'), 'holdouts are fresh renamed networks');
    } else if (test.kind === 'intake') {
      const [rows, seen] = test.args;
      assert(rows.length <= 100 && seen.length <= 100);
      assert.equal(new Set(seen).size, seen.length);
      for (const row of rows) {
        assert(/^[a-z][a-z0-9-]{0,31}$/.test(row.receiptId));
        assert(/^[a-z][a-z0-9-]{0,31}$/.test(row.item));
        assert(Number.isInteger(row.units) && row.units >= 1 && row.units <= 100);
      }
      for (const id of seen) assert(/^[a-z][a-z0-9-]{0,31}$/.test(id));
      assert(test.expected.seen.length <= 200);
      if (test.visibility === 'hidden') assert(deliveryMission.checks.every((original) => JSON.stringify(original.args) !== JSON.stringify(test.args)), 'hidden data is not a repackaged disclosed fixture');
    } else {
      assert.equal(test.missionId, mission);
      assert.deepEqual(test.args, missionCatalog[mission].args.map((name) => test.input[name]));
      assert.equal(validateCase(test, test.expected), null);
    }
    const before = JSON.stringify(test);
    const result = await executeTestSource(reference, entry, test.args);
    assert(result.ok, JSON.stringify(result));
    assert.equal(validateCase(test, result.value), null, `${mission}/${test.id}`);
    assert.equal(JSON.stringify(test), before, 'guest never mutates authored fixtures');
    executions++;
    if (test.visibility === 'hidden') {
      for (const status of ['pending', 'running', 'passed', 'failed', 'not-run'] as const) {
        const projected = caseReport(test, status, { actual: { private: test.args }, diagnostic: 'private guest error', logs: ['private guest log'], category: 'runtime' });
        assert.deepEqual(Object.keys(projected).sort(), ['category', 'id', 'status', 'title', 'visibility']);
        assert(!JSON.stringify(projected).includes('private'));
      }
    }
  }
}
const routes = challengeCases('first-light', 'submit');
assert.equal(validateCase(routes[0], ['dock', 'relay', 'junction', 'observatory', 'garden', 'greenhouse']), null, 'a longer valid path is accepted');
assert.equal(validateCase(routes[0], ['dock', 'relay', 'dock', 'relay', 'junction', 'garden', 'greenhouse']), null, 'a finite valid route may revisit stations');
assert.match(validateCase(routes[0], ['dock', 'relay', 'greenhouse'])!, /broken/);
assert.match(validateCase(routes[2], ['greenhouse', 'garden', 'greenhouse'])!, /\[start\]/);
const renamed = routes[3];
assert(renamed.kind === 'route');
assert(Object.hasOwn(renamed.args[0], 'length'));
assert(Object.keys(renamed.args[0]).some((id) => id.length === 32));
const boundary = challengeCases('one-crate-one-receipt', 'submit').at(-1)!;
assert(boundary.kind === 'intake');
assert.equal(boundary.args[0].length, 100);
assert.equal(boundary.args[1].length, 100);
assert.equal(boundary.expected.seen.length, 200);
assert.deepEqual([...new Set(boundary.args[0].map((row) => row.units))].sort((a, b) => a - b), [1, 100]);
console.log(`Challenge checks passed. ${executions} actual QuickJS fixtures, exact displayed examples, fresh contract-valid holdouts, alternate route predicates, hidden projection, unchanged batch bounds.`);
