import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.APP_URL;
assert(url, 'APP_URL must select a staged production candidate');
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-full-campaign/browser';
await mkdir(output, { recursive: true });
const ids = ['first-light', 'one-crate-one-receipt', 'read-the-weather', 'balance-the-store', 'share-the-battery', 'open-the-workshop', 'steady-the-sensors', 'raise-the-seedlings', 'give-the-radio-a-rest', 'keep-the-airlock-clear', 'agree-on-the-beacon'];
const limit = Number(process.env.MISSION_LIMIT || ids.length);
assert(Number.isInteger(limit) && limit >= 1 && limit <= ids.length);
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const errors = [];
const results = [];
const captures = [];
const keyFor = (id) => id === 'first-light' ? 'aster-route-ts-v1' : id === 'one-crate-one-receipt' ? 'aster-intake-ts-v1' : `aster-${id}-ts-v1`;
const completed = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')).completed);
const phase = (page, target) => page.waitForFunction((target) => document.body.dataset.phase === target, target, { timeout: 60000 });
async function capture(page, name) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} has no horizontal page overflow`);
  const targets = await page.evaluate(() => [...document.querySelectorAll('button, summary')]
    .filter((element) => !element.closest('#editor') && element.checkVisibility() && element.getBoundingClientRect().height < (innerWidth <= 760 ? 43.9 : 31.9))
    .map((element) => element.id || element.textContent.trim()));
  assert.deepEqual(targets, [], `${name} preserves desktop and phone touch targets`);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false });
  captures.push(name);
}
async function demo(page) {
  await page.locator('#settings > summary').click();
  await page.locator('#demo').click();
  await page.getByRole('button', { name: 'Insert demo solution', exact: true }).click();
}
async function openMission(page, id) {
  await page.locator('#home-open').click();
  await page.locator(`[data-select-mission="${id}"]`).click();
  await page.locator('#home-resume').click();
  await page.locator('#view-code').click();
}
async function replace(page, id, source) {
  await page.locator('#editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.evaluate((source) => navigator.clipboard.writeText(source), source);
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForFunction(({ key, source }) => localStorage.getItem(key) === source, { key: keyFor(id), source });
}
try {
  for (const [device, width, height] of [['desktop', 1440, 1000], ['laptop', 1280, 800], ['phone', 390, 844]].filter(([name]) => !process.env.DEVICE || name === process.env.DEVICE)) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    await context.addInitScript(() => {
      if (!localStorage.getItem('__all-missions-seeded')) {
        localStorage.setItem('aster-campaign-v1', JSON.stringify({ version: 1, introSeen: true, currentMission: 'first-light', completed: [] }));
        localStorage.setItem('__all-missions-seeded', 'true');
      }
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    assert(await page.locator('script[src]').evaluateAll((items) => items.length && items.every((item) => !/@vite|src\/main/.test(item.src))), 'Production target only');
    await page.locator('#home-open').click();
    const actualIds = await page.locator('[data-select-mission]').evaluateAll((items) => items.map((item) => item.dataset.selectMission));
    await capture(page, `${device}-00-mission-network`);
    assert.deepEqual(actualIds, ids, 'All eleven authored missions exist in the real mission network');
    for (const [index, id] of ids.entries()) assert.equal(await page.locator(`[data-select-mission="${id}"]`).isDisabled(), index > 0, `${id} has its real prerequisite lock`);
    await page.locator('#home-resume').click();
    for (const [index, id] of ids.slice(0, limit).entries()) {
      assert.equal(await page.locator('body').getAttribute('data-mission'), id);
      await page.locator('#view-brief').click();
      await page.locator('#start-coding:not([disabled])').waitFor({ timeout: 60000 });
      assert.equal(await page.locator('#brief-examples .example').count(), 3);
      assert(!/planned|not playable/i.test(await page.locator('#brief-goal').innerText()), `${id} has a playable goal`);
      await capture(page, `${device}-${String(index + 1).padStart(2, '0')}-brief`);
      await page.locator('#start-coding').click();
      await page.locator('#run').click();
      await phase(page, 'failed');
      assert.deepEqual(await completed(page), ids.slice(0, index), `${id} starter examples award no progress`);
      await demo(page);
      await page.locator('#run').click();
      await phase(page, 'ready');
      assert.match(await page.locator('#output strong').innerText(), /3\/3 examples passed/);
      assert.deepEqual(await completed(page), ids.slice(0, index), `${id} correct examples still award no progress`);
      await page.locator('#submit').click();
      await phase(page, 'complete');
      assert.deepEqual(await completed(page), ids.slice(0, index + 1), `${id} only earned completion unlocks the next mission`);
      assert(await page.locator('#submit').isHidden(), `${id} accepted source suppresses redundant submission`);
      const world = await page.locator('#world').evaluate((element) => ({ ...element.dataset }));
      assert.equal(world.activeMission, id);
      const region = JSON.parse(world.missionRegions).find((region) => region.mission === id);
      assert.equal(region?.availability, 'complete');
      const stored = await page.evaluate(() => ({ ...localStorage }));
      results.push({ device, id, completed: await completed(page), checks: await page.locator('#checks-count').innerText(), world, sourceKeys: Object.keys(stored).filter((key) => /^aster-.*-ts-v1$/.test(key)) });
      await capture(page, `${device}-${String(index + 1).padStart(2, '0')}-complete`);
      if (index < limit - 1) await page.locator('#next-mission').click();
    }
    if (limit < ids.length) {
      assert.deepEqual(await completed(page), ids.slice(0, limit));
      await context.close();
      continue;
    }
    const sources = await page.evaluate(() => ({ ...localStorage }));
    for (const id of ids) assert.equal(typeof sources[keyFor(id)], 'string', `${id} has independent saved source`);
    assert.equal(Object.keys(sources).filter((key) => /^aster-.*-ts-v1$/.test(key)).length, 11);
    if (device === 'desktop') {
      for (const [id, literal] of [['read-the-weather', 'weather'], ['balance-the-store', 'stock']]) {
        await openMission(page, id);
        await replace(page, id, `type MissionIsolationProbe = "${literal}";\n${sources[keyFor(id)]}`);
        await page.locator('#run').click();
        await phase(page, 'ready');
        assert.match(await page.locator('#output strong').innerText(), /3\/3 examples passed/);
        assert(await page.locator('#submit').isVisible(), 'Edited accepted source can submit again');
      }
      for (const id of ['read-the-weather', 'balance-the-store']) {
        await openMission(page, id);
        await page.locator('#run').click();
        await phase(page, 'ready');
        assert.match(await page.locator('#output strong').innerText(), /3\/3 examples passed/, 'Inactive standalone TypeScript models cannot leak duplicate aliases');
        await page.locator('#editor .view-lines').click();
        for (let step = 0; step < 8 && await page.evaluate((key) => localStorage.getItem(key), keyFor(id)) !== sources[keyFor(id)]; step++) await page.keyboard.press('ControlOrMeta+z');
        await page.waitForFunction(({ key, source }) => localStorage.getItem(key) === source, { key: keyFor(id), source: sources[keyFor(id)] });
        assert(await page.locator('#submit').isHidden(), `${id} model Undo recovers its own exact accepted source`);
        assert.deepEqual(await completed(page), ids);
      }
      await openMission(page, ids.at(-1));
    }
    await page.locator('#home-open').click();
    assert.equal(await page.locator('[data-select-mission]:disabled').count(), 0);
    assert.equal(await page.locator('.mission-status').filter({ hasText: /^Complete$/ }).count(), 11);
    await capture(page, `${device}-12-campaign-complete`);
    await page.reload();
    await page.locator('#start-game').click();
    await page.locator('#view-brief').click();
    await page.locator('#start-coding:not([disabled])').waitFor({ timeout: 60000 });
    await page.locator('#start-coding').click();
    assert.equal(await page.locator('body').getAttribute('data-mission'), ids.at(-1));
    assert.deepEqual(await completed(page), ids);
    assert(await page.locator('#submit').isVisible(), 'Reloaded history does not certify saved source');
    assert.match(await page.locator('.run-panel').innerText(), /unchecked/i);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, url, missionLimit: limit, results, captures, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, missions: results.length, screenshots: captures.length, output }, null, 2));
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap((context) => context.pages()).entries()) await page.screenshot({ path: `${output}/failure-${index}.png`, fullPage: false }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), results, captures, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
