import assert from 'node:assert/strict';
import { parseResultsFraction, resultsBounds, clampResultsHeight } from '../src/results-resize';

for (const input of [null, '', 'null', '"0.5"', '{}', '[]', 'true', '0', '-1', '1.01', 'NaN', 'Infinity', '1e999']) assert.equal(parseResultsFraction(input), null, `reject ${input}`);
for (const fraction of [.01, .45, 1]) assert.equal(parseResultsFraction(String(fraction)), fraction);
assert.deepEqual(resultsBounds(924, 120), { min: 280, max: 724 });
assert.deepEqual(resultsBounds(300, 120), { min: 280, max: 280 });
assert.deepEqual(resultsBounds(100, 120), { min: 100, max: 100 });
assert.deepEqual(resultsBounds(0, 120), { min: 0, max: 0 });
assert.deepEqual(resultsBounds(-100, 120), { min: 0, max: 0 });
assert.equal(clampResultsHeight(415.8, 924, 120), 415.8);
assert.equal(clampResultsHeight(-5, 924, 120), 280);
assert.equal(clampResultsHeight(2000, 924, 120), 724);
for (const available of [0, 160, 300, 724, 924, 2000]) {
  for (const chrome of [0, 80, 160, 300]) {
    const bounds = resultsBounds(available, chrome);
    assert.ok(bounds.min >= 0 && bounds.min <= bounds.max && bounds.max <= available);
    assert.ok(bounds.max >= available - 200);
    for (const requested of [-100, 0, 320, 10000]) {
      const height = clampResultsHeight(requested, available, chrome);
      assert.ok(Number.isFinite(height) && height >= bounds.min && height <= bounds.max);
      assert.equal(clampResultsHeight(height, available, chrome), height);
    }
  }
}
console.log('Results preferences, reader minimum, workspace budget and clamping passed.');
