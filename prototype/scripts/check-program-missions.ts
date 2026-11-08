import assert from 'node:assert/strict';
import { missionCatalog, missionIds } from '../src/mission-catalog';
import { missions } from '../src/missions';
import { nextExercises } from '../src/curriculum';
import { caseReport, challengeCases, validateCase } from '../src/challenge';
import { copyJSON, LIMITS, makeBatch } from '../src/runner-protocol';
import { compileTestSource, executeTestSource } from './runner-node-adapter';

const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)])) : value;
const numericLeaves = (value: unknown, path: (string | number)[] = []): (string | number)[][] => {
  if (typeof value === 'number') return [path];
  if (Array.isArray(value)) return value.flatMap((child, i) => numericLeaves(child, [...path, i]));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => numericLeaves(child, [...path, key]));
  return [];
};
let executions = 0;
assert.deepEqual(Object.keys(missions), missionIds);
for (const id of missionIds) {
  const content = missions[id];
  assert.equal(content.id, id);
  assert.equal(content.brief.title, missionCatalog[id].title);
  assert(content.hints.length >= 3);
  assert(compileTestSource(content.starter).ok, `${id} starter compiles syntactically`);
  assert(compileTestSource(content.solution).ok, `${id} reference compiles syntactically`);
  if (id === 'first-light' || id === 'one-crate-one-receipt') continue;
  const cases = challengeCases(id, 'submit');
  const examples = challengeCases(id, 'examples');
  assert.equal(cases.length, 8);
  assert.equal(examples.length, 3);
  assert.equal(cases.filter((test) => test.visibility === 'hidden').length, 5);
  assert.equal(new Set(cases.map((test) => test.id)).size, 8);
  const legacy = nextExercises.find((exercise) => exercise.id === id)!;
  assert.deepEqual(examples[0].args, missionCatalog[id].args.map((name) => JSON.parse(legacy.input)[name]), 'first public fixture retains curriculum provenance');
  assert.deepEqual(examples[0].expected, JSON.parse(legacy.output));
  makeBatch('', missionCatalog[id].entry, cases.map(({id, args}) => ({id, args})), 1);
  let starterFails = false;
  for (const test of cases) {
    assert(test.kind === 'program');
    assert.equal(test.missionId, id);
    assert.equal(test.args.length, missionCatalog[id].args.length);
    assert.deepEqual(test.args, missionCatalog[id].args.map((name) => test.input[name]));
    copyJSON(test.expected);
    assert(JSON.stringify(test.expected).length <= LIMITS.envelopeChars);
    assert.equal(validateCase(test, test.expected), null);
    assert.equal(validateCase(test, reverseKeys(test.expected)), null, `${id}/${test.id} ignores object key order`);
    for (const malformed of [null, true, 'wrong output', 1, {unexpected: true}]) assert(validateCase(test, malformed), `${id}/${test.id} rejects wrong shape`);
    if (!Array.isArray(test.expected)) assert(validateCase(test, {...test.expected, extra: 1}), 'extra record keys are rejected');
    const before = structuredClone(test);
    const reference = await executeTestSource(content.solution, missionCatalog[id].entry, test.args);
    assert(reference.ok, `${id}/${test.id}: ${JSON.stringify(reference)}`);
    assert.equal(validateCase(test, reference.value), null, `${id}/${test.id} actual reference output`);
    assert.deepEqual(test, before);
    const starter = await executeTestSource(content.starter, missionCatalog[id].entry, test.args);
    if (!starter.ok || validateCase(test, starter.value)) starterFails = true;
    if (test.visibility === 'hidden') {
      const report = caseReport(test, 'failed', {actual: reference.value, diagnostic: 'PRIVATE', logs: ['PRIVATE'], category: 'contract'});
      assert.deepEqual(Object.keys(report).sort(), ['category', 'id', 'status', 'title', 'visibility']);
      assert(!JSON.stringify(report).includes('PRIVATE'));
      assert(!examples.some((example) => JSON.stringify(example.args) === JSON.stringify(test.args)), `${id} hidden input is not a public duplicate`);
    }
    for (const path of numericLeaves(test.expected)) {
      const output = structuredClone(test.expected) as unknown as Record<string | number, unknown>;
      let row = output;
      for (const key of path.slice(0, -1)) row = row[key] as Record<string | number, unknown>;
      const leaf = path.at(-1)!;
      const original = row[leaf] as number;
      row[leaf] = original + 5e-10;
      const tolerant = id === 'read-the-weather' && path.length === 3 && path[0] === 'readings' && path[2] === 'celsius' || id === 'steady-the-sensors' && path.length === 2 && path[1] === 'mean';
      assert.equal(validateCase(test, output) === null, tolerant, `${id}/${test.id}/${path.join('.')} exactness`);
      row[leaf] = original + 1e-7;
      assert(validateCase(test, output), `${id} tolerance is bounded`);
    }
    executions++;
  }
  assert(starterFails, `${id} starter cannot pass the contract`);
  const lookup = `function ${missionCatalog[id].entry}(...args) {
    const fixtures = ${JSON.stringify(examples.map((test) => ({args: test.args, expected: test.expected})))};
    const found = fixtures.find(test => JSON.stringify(test.args) === JSON.stringify(args));
    return found ? found.expected : null;
  }`;
  for (const test of examples) {
    const result = await executeTestSource(lookup, missionCatalog[id].entry, test.args);
    assert(result.ok && validateCase(test, result.value) === null);
  }
  let hiddenFails = 0;
  for (const test of cases.filter((test) => test.visibility === 'hidden')) {
    const result = await executeTestSource(lookup, missionCatalog[id].entry, test.args);
    if (!result.ok || validateCase(test, result.value)) hiddenFails++;
  }
  assert(hiddenFails > 0, `${id} public-only memorizer cannot pass hidden tests`);
}
console.log(`Program missions passed. ${executions} actual QuickJS references and starters, 3+5 per new mission, public provenance, exact inputs/outputs, numeric-leaf tolerance, redaction and nine public-only lookup rejections. Monaco semantics remain a browser gate.`);
