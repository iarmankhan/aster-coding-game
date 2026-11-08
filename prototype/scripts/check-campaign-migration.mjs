import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.APP_URL;
assert(url, 'APP_URL must select a staged production candidate');
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-full-campaign/migration-browser';
await mkdir(output, { recursive: true });
const ids = ['first-light', 'one-crate-one-receipt', 'read-the-weather', 'balance-the-store', 'share-the-battery', 'open-the-workshop', 'steady-the-sensors', 'raise-the-seedlings', 'give-the-radio-a-rest', 'keep-the-airlock-clear', 'agree-on-the-beacon'];
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const errors = [];
const results = [];
const cases = [
  { name: 'legacy-two-completions', save: { version: 1, introSeen: true, currentMission: 'one-crate-one-receipt', completed: ids.slice(0, 3) }, earned: ids.slice(0, 2) },
  { name: 'new-save-gap', save: { version: 2, introSeen: true, currentMission: 'balance-the-store', completed: [ids[0], ids[1], ids[3]] }, earned: ids.slice(0, 2) },
  { name: 'full-history-unchecked', save: { version: 2, introSeen: true, currentMission: ids.at(-1), completed: ids }, earned: ids },
];
try {
  for (const test of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await context.addInitScript((save) => {
      if (localStorage.getItem('__migration-seeded')) return;
      localStorage.setItem('aster-campaign-v1', JSON.stringify(save));
      localStorage.setItem('aster-route-ts-v1', '// retained route source\nfunction route(): string[] { return []; }');
      localStorage.setItem('aster-intake-ts-v1', '// retained receipt source\nfunction acceptDeliveries() { return { deliveries: [], seen: [] }; }');
      localStorage.setItem('aster-read-the-weather-ts-v1', '// retained weather source\nfunction parseTelemetry() { return { readings: [], rejected: [] }; }');
      localStorage.setItem('__migration-seeded', 'true');
    }, test.save);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('#start-game').click();
    const normalized = await page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')));
    assert.equal(normalized.version, 2);
    assert.deepEqual(normalized.completed, test.earned, `${test.name} never invents missing completion`);
    assert(!test.earned.includes('read-the-weather') || test.name === 'full-history-unchecked');
    await page.locator('#view-brief').click();
    await page.locator('#start-coding:not([disabled])').waitFor({ timeout: 60000 });
    await page.locator('#start-coding').click();
    assert(await page.locator('#submit').isVisible(), 'No migrated save certifies source');
    assert.match(await page.locator('#checks-count').innerText(), /^0\//);
    assert(!await page.locator('#world').getAttribute('data-program-mission'), 'Reload never invents canonical result playback');
    if (test.name === 'full-history-unchecked') {
      assert.equal(await page.locator('body').getAttribute('data-mission'), ids.at(-1));
      assert.match(await page.locator('.run-panel').innerText(), /unchecked/i);
    }
    await page.locator('#home-open').click();
    assert.equal(await page.locator('.mission-status').filter({ hasText: /^Complete$/ }).count(), test.earned.length);
    if (test.earned.length === 2) {
      assert.equal(await page.locator('[data-select-mission="read-the-weather"]').isDisabled(), false);
      assert.equal(await page.locator('[data-select-mission="balance-the-store"]').isDisabled(), true);
      await page.locator('[data-select-mission="read-the-weather"]').click();
      await page.locator('#home-resume').click();
      await page.locator('#view-code').click();
      assert.match(await page.locator('#editor .view-lines').innerText(), /retained\s+weather\s+source/);
      await page.reload();
      await page.locator('#start-game').click();
      assert.equal(await page.locator('body').getAttribute('data-mission'), 'read-the-weather');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')).completed), ids.slice(0, 2));
    }
    const sources = await page.evaluate(() => ({ route: localStorage.getItem('aster-route-ts-v1'), intake: localStorage.getItem('aster-intake-ts-v1'), weather: localStorage.getItem('aster-read-the-weather-ts-v1') }));
    assert(sources.route.startsWith('// retained route source'));
    assert(sources.intake.startsWith('// retained receipt source'));
    assert(sources.weather.startsWith('// retained weather source'));
    await page.screenshot({ path: `${output}/${test.name}.png`, fullPage: false });
    results.push({ name: test.name, normalized, sourcesRetained: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, url, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, output }, null, 2));
} catch (error) {
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), results, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
