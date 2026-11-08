import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.APP_URL;
assert(url, 'APP_URL must point to a staged production build');
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-puzzle-runner/playback-gate-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-webgl'] });
const results = [];
try {
  for (const mission of ['first-light', 'one-crate-one-receipt']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const completed = mission === 'first-light' ? [] : ['first-light'];
    await context.addInitScript(({ mission, completed }) => {
      localStorage.setItem('aster-campaign-v1', JSON.stringify({ version: 1, introSeen: true, currentMission: mission, completed }));
    }, { mission, completed });
    const page = await context.newPage();
    const errors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(url);
    assert(await page.locator('script[src]').evaluateAll((items) => items.length && items.every((item) => !/@vite|src\/main/.test(item.src))), 'Production target only');
    await page.locator('#start-game').click();
    await page.locator('#view-brief').click();
    await page.locator('#start-coding:not([disabled])').waitFor();
    await page.locator('#start-coding').click();
    assert.equal(await page.locator('#world').getAttribute('data-renderer'), 'unavailable');
    await page.locator('#settings > summary').click();
    await page.locator('#demo').click();
    await page.getByRole('button', { name: 'Insert demo solution', exact: true }).click();
    const sourceKey = mission === 'first-light' ? 'aster-route-ts-v1' : 'aster-intake-ts-v1';
    const source = await page.evaluate((key) => localStorage.getItem(key), sourceKey);
    await page.locator('#run').click();
    await page.waitForFunction(() => ['ready', 'failed', 'complete'].includes(document.body.dataset.phase), null, { timeout: 45000 });
    assert.match(await page.locator('#output strong').innerText(), /3\/3 examples passed/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')).completed), completed, 'Examples work without WebGL and earn no progress');
    await page.locator('#submit').click();
    await page.waitForFunction(() => ['failed', 'complete'].includes(document.body.dataset.phase), null, { timeout: 45000 });
    const result = await page.evaluate((sourceKey) => ({
      phase: document.body.dataset.phase,
      view: document.body.dataset.view,
      renderer: document.querySelector('#world').dataset.renderer,
      route: document.querySelector('#world').dataset.routeTrace,
      intake: document.querySelector('#world').dataset.intakeTrace,
      checks: document.querySelector('#checks-count').textContent,
      message: document.querySelector('#attempt-message').textContent,
      completed: JSON.parse(localStorage.getItem('aster-campaign-v1')).completed,
      source: localStorage.getItem(sourceKey),
    }), sourceKey);
    await page.screenshot({ path: `${output}/${mission}.png`, fullPage: true });
    results.push({ mission, ...result, errors, consoleErrors });
    await writeFile(`${output}/results.json`, JSON.stringify({ url, results }, null, 2));
    assert.equal(result.phase, 'failed', 'Accepted tests cannot award progress without actual playback');
    assert.deepEqual(result.completed, completed);
    assert.equal(result.view, 'code');
    assert.equal(result.source, source, 'Code remains saved after unavailable playback');
    assert.match(result.message, /passed.*playback.*unavailable/is);
    assert.match(result.message, /WebGL/i);
    assert.match(result.checks, mission === 'first-light' ? /^6\/6/ : /^8\/8/, 'Accepted test results remain visible');
    assert.equal(result.route, '["dock"]');
    assert.equal(result.intake, '[]');
    assert.equal(await page.locator('[data-status="running"]').count(), 0);
    assert.deepEqual(errors, []);
    assert(consoleErrors.every((message) => message.includes('THREE.WebGLRenderer')), 'Only expected disabled-WebGL errors');
    await context.close();
  }
  console.log(JSON.stringify({ passed: true, missions: results.length, output }, null, 2));
} finally {
  await browser.close();
}
