import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { missionCatalog, missionIds, type ProgramMissionId } from '../src/mission-catalog';
import { missions } from '../src/missions';
import { nextExercises } from '../src/curriculum';
import { copyJSON, makeBatch } from '../src/runner-protocol';

const names = ['parseTelemetry', 'balanceStock', 'allocatePower', 'scheduleRepairs', 'smoothSensors', 'growBed', 'scheduleRetries', 'queueTimeline', 'reconcileBeacons'];
const source = ts.createSourceFile('historical-content.ts', readFileSync(new URL('./check-curriculum.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const selected = source.statements.filter((node) => ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node) && !!node.name && names.includes(node.name.text));
const javascript = ts.transpileModule(selected.map((node) => node.getFullText(source)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const oracles = vm.runInNewContext(`${javascript}\n({${names.join(',')}})`) as Record<string, (input: unknown) => unknown>;

function equivalent(actual: unknown, expected: unknown, path = 'result', field = ''): void {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path);
    assert(Number.isFinite(actual), path);
    if (field === 'celsius' || field === 'mean') assert(Math.abs((actual as number) - expected) <= 1e-9, path);
    else assert.equal(actual, expected, path);
  } else if (Array.isArray(expected)) {
    assert(Array.isArray(actual), path);
    assert.equal(actual.length, expected.length, path);
    expected.forEach((value, index) => equivalent(actual[index], value, `${path}[${index}]`, ''));
  } else if (expected && typeof expected === 'object') {
    assert(actual && typeof actual === 'object' && !Array.isArray(actual), path);
    const record = actual as Record<string, unknown>;
    assert.deepEqual(Object.keys(record).sort(), Object.keys(expected).sort(), path);
    for (const [key, value] of Object.entries(expected)) equivalent(record[key], value, `${path}.${key}`, key);
  } else assert.equal(actual, expected, path);
}

let fixtures = 0;
for (const id of missionIds.slice(2) as ProgramMissionId[]) {
  const content = missions[id];
  const metadata = missionCatalog[id];
  assert.equal(content.id, id);
  assert.equal(content.checks.length, 8, `${id} has three public plus five hidden fixtures`);
  const publicChecks = content.checks.filter((check) => check.visibility === 'public');
  assert.equal(publicChecks.length, 3);
  assert.equal(new Set(content.checks.map((check) => check.id)).size, 8);
  const historical = nextExercises.find((exercise) => exercise.id === id)!;
  assert.deepEqual(publicChecks[0].input, JSON.parse(historical.input), `${id} canonical input preserves original contract`);
  equivalent(publicChecks[0].expected, JSON.parse(historical.output), `${id} canonical output`);
  assert.equal(content.brief.examples.length, 3);
  assert.equal(content.brief.title, metadata.title);
  assert(!/^Planned\./.test(content.brief.story));
  makeBatch('function unused() {}', metadata.entry, content.checks.map(({ id, args }) => ({ id, args })), 1);
  for (const [index, check] of content.checks.entries()) {
    const original = structuredClone(check.input);
    assert.deepEqual(metadata.args.map((field) => check.input[field]), check.args, `${id}/${check.id} positional arguments match displayed input`);
    const actual = JSON.parse(JSON.stringify(oracles[metadata.entry](structuredClone(check.input)))) as unknown;
    equivalent(actual, check.expected, `${id}/${check.id} independently implemented historical oracle`);
    assert.deepEqual(check.input, original, `${id}/${check.id} fixture remains unchanged`);
    copyJSON(check.expected);
    if (check.visibility === 'public') {
      const position = publicChecks.findIndex((item) => item.id === check.id);
      assert.deepEqual(JSON.parse(content.brief.examples[position].input), check.input);
      equivalent(JSON.parse(content.brief.examples[position].output), check.expected, `${id} brief example ${position + 1}`);
    }
    assert(index < 8);
    fixtures++;
  }
}
assert.equal(fixtures, 72);
console.log('PASS 72 authored fixtures against independent historical host oracles, unchanged transport limits, exact public examples and canonical contracts. Player-code execution is verified separately in QuickJS.');
