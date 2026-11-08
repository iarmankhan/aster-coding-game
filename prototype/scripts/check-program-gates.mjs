import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.APP_URL;
assert(url, 'APP_URL must select a staged production build');
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-full-campaign/program-gates';
await mkdir(output, { recursive: true });
const ids = ['first-light', 'one-crate-one-receipt', 'read-the-weather', 'balance-the-store', 'share-the-battery', 'open-the-workshop', 'steady-the-sensors', 'raise-the-seedlings', 'give-the-radio-a-rest', 'keep-the-airlock-clear', 'agree-on-the-beacon'];
const programs = [
  ['read-the-weather', 'parseTelemetry', ['lines']],
  ['balance-the-store', 'balanceStock', ['stock', 'changes']],
  ['share-the-battery', 'allocatePower', ['energy', 'requests']],
  ['open-the-workshop', 'scheduleRepairs', ['jobs', 'done']],
  ['steady-the-sensors', 'smoothSensors', ['samples', 'window']],
  ['raise-the-seedlings', 'growBed', ['initial', 'days']],
  ['give-the-radio-a-rest', 'scheduleRetries', ['failures', 'baseDelay', 'maxDelay', 'maxAttempts']],
  ['keep-the-airlock-clear', 'queueTimeline', ['capacity', 'ticks']],
  ['agree-on-the-beacon', 'reconcileBeacons', ['events']],
];
const unavailable = process.env.NO_WEBGL === '1';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', unavailable ? '--disable-webgl' : '--enable-unsafe-swiftshader'] });
const results = [];
const errors = [];
const phase = (page, target) => page.waitForFunction((target) => document.body.dataset.phase === target, target, { timeout: 60000 });
const progress = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')).completed);
async function demo(page) {
  await page.locator('#settings > summary').click();
  await page.locator('#demo').click();
  await page.getByRole('button', { name: 'Insert demo solution', exact: true }).click();
}
async function edit(page, source) {
  await page.locator('#view-code').click();
  await page.locator('#editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.evaluate((source) => navigator.clipboard.writeText(source), source);
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForFunction((source) => localStorage.getItem(`aster-${document.body.dataset.mission}-ts-v1`) === source, source);
}
try {
  for (const [id, entry, fields] of programs) {
    const index = ids.indexOf(id);
    const prior = ids.slice(0, index);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    await context.addInitScript(({ id, prior }) => localStorage.setItem('aster-campaign-v1', JSON.stringify({ version: 2, introSeen: true, currentMission: id, completed: prior })), { id, prior });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    assert(await page.locator('script[src]').evaluateAll((items) => items.length && items.every((item) => !/@vite|src\/main/.test(item.src))), 'Production target only');
    await page.locator('#start-game').click();
    await page.locator('#view-brief').click();
    await page.locator('#start-coding:not([disabled])').waitFor({ timeout: 60000 });
    assert.equal(await page.locator('body').getAttribute('data-mission'), id);
    const fixtures = await page.locator('#brief-fixtures .fixture').evaluateAll((items) => items.map((item) => {
      const blocks = item.querySelectorAll('pre');
      return { input: JSON.parse(blocks[0].textContent), expected: JSON.parse(blocks[1].textContent) };
    }));
    assert.equal(fixtures.length, 3);
    await page.locator('#start-coding').click();
    if (unavailable) {
      assert.equal(await page.locator('#world').getAttribute('data-renderer'), 'unavailable');
      await demo(page);
      const source = await page.evaluate((id) => localStorage.getItem(`aster-${id}-ts-v1`), id);
      await page.locator('#run').click();
      await phase(page, 'ready');
      assert.match(await page.locator('#output strong').innerText(), /3\/3 examples passed/);
      assert.deepEqual(await progress(page), prior);
      await page.locator('#submit').click();
      await phase(page, 'failed');
      assert.deepEqual(await progress(page), prior, `${id} cannot earn progress without actual WebGL playback`);
      assert.match(await page.locator('#attempt-message').innerText(), /passed.*playback.*unavailable/is);
      assert.match(await page.locator('#checks-count').innerText(), /^8\/8/);
      assert(await page.locator('#submit').isVisible());
      assert.equal(await page.evaluate((id) => localStorage.getItem(`aster-${id}-ts-v1`), id), source);
      results.push({ id, renderer: 'unavailable', prior, checks: await page.locator('#checks-count').innerText() });
    } else {
      const lookup = fixtures.map((fixture) => ({ args: fields.map((field) => fixture.input[field]), value: fixture.expected }));
      const source = `function ${entry}(...args: any[]): any {\n  const examples = ${JSON.stringify(lookup)};\n  for (const example of examples) if (JSON.stringify(args) === JSON.stringify(example.args)) return example.value;\n  console.log("hidden-only-sentinel");\n  return null;\n}`;
      await edit(page, source);
      await page.locator('#run').click();
      await phase(page, 'ready');
      assert.match(await page.locator('#output strong').innerText(), /3\/3 examples passed/);
      assert.deepEqual(await progress(page), prior);
      await page.locator('#submit').click();
      await phase(page, 'failed');
      assert.deepEqual(await progress(page), prior, `${id} public-only memorization fails hidden submission`);
      assert.equal(await page.locator('#case-feedback').getAttribute('data-visibility'), 'hidden');
      assert.match(await page.locator('#case-feedback').innerText(), /withheld/i);
      assert(!/hidden-only-sentinel/.test(await page.locator('#case-feedback').innerText()));
      assert(await page.locator('#console-output').isHidden());
      assert(!await page.locator('#world').getAttribute('data-program-mission'), 'Failed hidden cases do not begin program playback');
      await demo(page);
      if (id === 'read-the-weather' || id === 'agree-on-the-beacon') {
        await page.locator('#submit').click();
        await phase(page, 'animating');
        await page.locator('#submit').click();
        await phase(page, 'ready');
        assert.deepEqual(await progress(page), prior, `${id} stopped playback cannot award progress`);
        assert(!await page.locator('#world').getAttribute('data-program-mission'));
      }
      await page.locator('#submit').click();
      await phase(page, 'complete');
      assert.deepEqual(await progress(page), ids.slice(0, index + 1));
      const world = await page.locator('#world').evaluate((element) => ({ ...element.dataset }));
      assert.equal(world.programMission, id);
      assert.deepEqual(JSON.parse(world.programResult), fixtures[0].expected, `${id} replays the actual canonical public result`);
      assert(JSON.parse(world.programTrace).length > 0, `${id} has real visited playback frames`);
      assert(await page.locator('#submit').isHidden());
      if (id === 'read-the-weather' || id === 'keep-the-airlock-clear') {
        const reader = page.getByRole('region', { name: 'Public result playback', exact: true });
        assert.equal(await reader.evaluate((element) => element.closest('[role="img"]') !== null), false, 'Interactive playback reader is outside the image semantics');
        const total = Number(world.programProgress);
        await reader.getByRole('button', { name: 'Previous', exact: true }).click();
        assert.equal(Number(await page.locator('#world').getAttribute('data-program-progress')), total - 1);
        await reader.getByRole('button', { name: 'Replay', exact: true }).click();
        await reader.getByRole('button', { name: 'Pause', exact: true }).click();
        for (let step = Number(await page.locator('#world').getAttribute('data-program-progress')); step < total; step++) await reader.getByRole('button', { name: 'Next', exact: true }).click();
        assert.equal(Number(await page.locator('#world').getAttribute('data-program-progress')), total);
        assert.equal(JSON.parse(await page.locator('#world').getAttribute('data-program-trace')).length, total, 'Replay inspects unique public frames, not an unbounded duplicate log');
        assert.deepEqual(await progress(page), ids.slice(0, index + 1), 'Inspecting Previous/Replay/Next cannot award another mission');
        assert.equal(await page.locator('body').getAttribute('data-phase'), 'complete');
        assert(await page.locator('#submit').isHidden());
      }
      results.push({ id, hiddenMemorizerRejected: true, world });
    }
    await page.screenshot({ path: `${output}/${id}.png`, fullPage: false });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, url, unavailable, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, missions: results.length, unavailable, output }, null, 2));
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap((context) => context.pages()).entries()) await page.screenshot({ path: `${output}/failure-${index}.png`, fullPage: false }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), unavailable, results, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
