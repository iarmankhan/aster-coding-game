import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.APP_URL;
assert(url, 'APP_URL must point to an explicitly staged production build');
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-puzzle-runner/browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const errors = [];
const captures = [];
const types = 'type Delivery = { receiptId: string; item: string; units: number };';
const correctBody = `const known = new Set(seen);
  const accepted: Delivery[] = [];
  const history = [...seen];
  for (const row of deliveries) {
    if (known.has(row.receiptId)) continue;
    known.add(row.receiptId);
    accepted.push(row);
    history.push(row.receiptId);
  }
  return { deliveries: accepted, seen: history };`;
const source = (body) => `${types}\nfunction acceptDeliveries(deliveries: Delivery[], seen: string[]) {\n  ${body}\n}`;
const loggedSolution = source(`console.log('<img id="aster-log-injection" src=x onerror="window.__logInjection=1">', { deliveries, seen });\n${correctBody}`);
const samplesOnly = source(`const sampleIds = new Set(['old', 'r1', 'r2', 'constructor', 'seed-2', 'to-string']);
  if (!deliveries.every(row => sampleIds.has(row.receiptId)) || !seen.every(id => sampleIds.has(id))) {
    console.log('HIDDEN_LOG_SENTINEL', deliveries, seen);
    throw new Error('HIDDEN_ERROR_SENTINEL ' + JSON.stringify(deliveries));
  }
  console.log({ deliveries, seen });
  ${correctBody}`);

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  await context.addInitScript(() => {
    localStorage.setItem('aster-campaign-v1', JSON.stringify({ version: 1, introSeen: true, currentMission: 'one-crate-one-receipt', completed: ['first-light'] }));
    window.__runnerPosts = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) { super(url, options); this.runner = /runner\.worker/.test(String(url)); }
      postMessage(...args) { if (this.runner) window.__runnerPosts++; return super.postMessage(...args); }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  const scripts = await page.locator('script[src]').evaluateAll((items) => items.map((item) => item.src));
  assert(scripts.length && scripts.every((item) => !/@vite|src\/main/.test(item)), 'Production target only');
  await page.locator('#start-game').click();
  await page.locator('#view-brief').click();
  await page.locator('#start-coding:not([disabled])').waitFor();
  await page.locator('#start-coding').click();
  return { page, context };
}

async function edit(page, code) {
  await page.locator('#view-code').click();
  await page.locator('#editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.evaluate((code) => navigator.clipboard.writeText(code), code);
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForFunction((code) => localStorage.getItem('aster-intake-ts-v1') === code, code);
}
async function idle(page) {
  await page.waitForFunction(() => ['ready', 'failed'].includes(document.body.dataset.phase), null, { timeout: 45000 });
}
const panel = (page) => page.locator('.run-panel');
const caseButton = (page, id) => panel(page).locator(`button[data-case="${id}"]`);
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewport: innerWidth,
    header: document.querySelector('.header').getBoundingClientRect().height,
    editorTop: document.querySelector('#editor').getBoundingClientRect().top,
    view: document.body.dataset.view,
    runningCases: document.querySelectorAll('[data-status="running"]').length,
  }));
  assert(geometry.pageWidth <= geometry.viewport, `${name} has no horizontal page overflow`);
  if (geometry.viewport > 760 && geometry.view !== 'world') {
    assert(geometry.header <= 56);
    assert(geometry.editorTop <= 100);
  }
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  captures.push({ name, ...geometry });
}
async function noNewProgress(page) {
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')).completed), ['first-light']);
  assert.equal(await page.locator('#world').getAttribute('data-supplies-restored'), 'false');
  assert.equal(await page.locator('#world').getAttribute('data-delivered-units'), '0');
}

try {
  const { page, context } = await open(1440, 1000);
  assert.equal(await page.locator('#checks-count').innerText(), '0/8 · 3 examples + 5 hidden', 'Advertise full submission count before execution');
  assert.match(await panel(page).innerText(), /3.*example/i);
  assert.match(await panel(page).innerText(), /5.*hidden/i);
  await capture(page, '01-ready');

  const before = await page.evaluate(() => window.__runnerPosts);
  await edit(page, 'const invalid: number = "wrong";\nfunction acceptDeliveries() { return { deliveries: [], seen: [] }; }');
  await page.locator('#run').click();
  await idle(page);
  assert.match(await panel(page).innerText(), /not assignable/);
  assert.equal(await page.evaluate(() => window.__runnerPosts), before, 'Compiler errors dispatch no guest fixtures');
  assert.equal(await page.locator('[data-status="running"]').count(), 0);
  assert.equal(await page.locator('[data-status="failed"]').count(), 0, 'Compilation does not fabricate failed test cases');
  await noNewProgress(page);

  await edit(page, source('console.log({ deliveries, seen }); return { deliveries, seen };'));
  await page.locator('#run').click();
  await idle(page);
  assert.equal(await page.locator('body').getAttribute('data-phase'), 'failed');
  await caseButton(page, 'manifest').click();
  if (!await page.locator('#console-output').evaluate((element) => element.open)) await page.locator('#console-output > summary').click();
  const failure = await panel(page).innerText();
  assert.match(failure, /expected/i);
  assert.match(failure, /actual/i);
  assert.match(failure, /receiptId/);
  assert.match(failure, /replayed|history|accepted/i);
  assert(!failure.includes('[object]'), 'Object logs contain data rather than placeholder text');
  assert.match(await page.locator('#console-output pre').textContent(), /receiptId.*r1.*seen/s);
  await noNewProgress(page);
  await capture(page, '02-public-failure-and-logs');

  await edit(page, source('console.log({ beforeError: true }); throw new Error("public runtime probe");'));
  await page.locator('#run').click();
  await idle(page);
  assert.match(await page.locator('#case-feedback .case-diagnostic').innerText(), /public runtime probe/);
  assert.match(await page.locator('[data-case-field="actual"] pre').innerText(), /Unavailable/);
  assert.match(await page.locator('#checks-count').innerText(), /2 not run/);
  assert.equal(await page.locator('[data-status="running"]').count(), 0);
  await noNewProgress(page);
  await capture(page, '02-runtime-failure-not-run');

  await edit(page, loggedSolution);
  await page.locator('#editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await idle(page);
  assert.equal(await page.locator('body').getAttribute('data-phase'), 'ready');
  assert.equal(await page.locator('#checks-count').innerText(), '3/3 · examples · Submit 8 cases');
  await caseButton(page, 'manifest').click();
  assert.match(await panel(page).innerText(), /receiptId.*old/s);
  assert.equal(await page.locator('#aster-log-injection').count(), 0, 'Printed HTML is literal text');
  assert.equal(await page.evaluate(() => window.__logInjection), undefined);
  await noNewProgress(page);
  await capture(page, '03-examples-pass-without-progression');

  await caseButton(page, 'receipt-not-item').click();
  assert.match(await page.locator('#console-output pre').textContent(), /constructor/);
  assert(!((await page.locator('#console-output pre').textContent()).includes('"r1"')), 'Selected logs come from that example, not an aggregate');
  await capture(page, '04-selected-example');

  await edit(page, samplesOnly);
  await page.locator('#run').click();
  await idle(page);
  assert.equal(await page.locator('#checks-count').innerText(), '3/3 · examples · Submit 8 cases');
  await noNewProgress(page);
  await page.locator('#submit').click();
  await idle(page);
  assert.equal(await page.locator('body').getAttribute('data-phase'), 'failed');
  const hiddenFailure = await panel(page).innerText();
  assert.match(hiddenFailure, /hidden/i);
  assert(!hiddenFailure.includes('HIDDEN_LOG_SENTINEL'));
  assert(!hiddenFailure.includes('HIDDEN_ERROR_SENTINEL'));
  assert.equal(await page.locator('#case-feedback').getAttribute('data-visibility'), 'hidden');
  assert.equal(await page.locator('#case-feedback [data-case-field]').count(), 0);
  assert.equal(await page.locator('#console-output pre').textContent(), '', 'Hidden selection clears even non-visible log text');
  assert.equal(await page.locator('[data-status="running"]').count(), 0);
  await noNewProgress(page);
  await capture(page, '05-hidden-failure-withheld');

  await edit(page, source(correctBody));
  assert(!((await panel(page).innerText()).includes('HIDDEN_ERROR_SENTINEL')));
  assert.equal(await page.locator('#checks-count').innerText(), '0/8 · 3 examples + 5 hidden', 'Source edits invalidate prior feedback even after an example-only pass');
  await page.locator('#editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
  await page.waitForFunction(() => ['animating', 'failed', 'complete'].includes(document.body.dataset.phase), null, { timeout: 45000 });
  assert.equal(await page.locator('body').getAttribute('data-phase'), 'animating', 'Submit shortcut works from inside Monaco');
  await page.keyboard.press('Escape');
  await noNewProgress(page);
  assert.equal(await page.locator('[data-status="running"]').count(), 0);
  await capture(page, '06-playback-stopped');

  await page.locator('#view-code').click();
  await page.locator('#submit').click();
  await page.waitForFunction(() => ['complete', 'failed'].includes(document.body.dataset.phase), null, { timeout: 45000 });
  assert.equal(await page.locator('body').getAttribute('data-phase'), 'complete');
  assert.equal(await page.locator('#checks-count').innerText(), '8/8 · 3 examples + 5 hidden');
  assert.equal(await page.locator('#world').getAttribute('data-delivered-units'), '4');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')).completed), ['first-light', 'one-crate-one-receipt']);
  await capture(page, '07-accepted-submission');
  await context.close();

  for (const [name, width, height] of [['laptop', 1280, 800], ['phone', 390, 844]]) {
    const { page, context } = await open(width, height);
    await edit(page, source('console.log({ deliveries, seen }); return { deliveries, seen };'));
    await page.locator('#run').click();
    await idle(page);
    await caseButton(page, 'manifest').click();
    assert.match(await panel(page).innerText(), /expected/i);
    assert.match(await panel(page).innerText(), /actual/i);
    await noNewProgress(page);
    await capture(page, `${name}-failure`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, url, scope: 'Seeded M2 runner behavior. Earned two-mission campaign is verified separately.', captures, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: captures.length, output }, null, 2));
} catch (error) {
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), captures, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
