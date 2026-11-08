import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.APP_URL;
assert(url, 'APP_URL must point to a staged production build');
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-world-workbench/map-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const errors = [];
const captures = [];
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const legend = rect(document.querySelector('.world-context-legend'));
    const caption = rect(document.querySelector('.world-caption'));
    const tools = rect(document.querySelector('.world-tools'));
    const active = document.querySelector('.world-region-label[data-region-kind="active"]');
    const activeRect = rect(active);
    return {
      legend, caption, active: activeRect,
      legendCaptionOverlap: overlaps(legend, caption),
      activeToolsOverlap: overlaps(activeRect, tools),
      activeVisible: active.checkVisibility(),
      activeMission: document.querySelector('#world').dataset.activeMission,
      regions: JSON.parse(document.querySelector('#world').dataset.missionRegions),
      unusedWorldSpace: document.querySelector('.workspace').getBoundingClientRect().height - document.querySelector('#mission-world').getBoundingClientRect().height,
      width: document.documentElement.scrollWidth, viewport: innerWidth,
    };
  });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false });
  captures.push({ name, ...metrics });
  assert(metrics.width <= metrics.viewport, 'No horizontal map page overflow');
  assert(metrics.activeVisible, 'Active problem remains visibly labeled');
}
try {
  for (const [device, width, height] of [['desktop', 1440, 1000], ['laptop', 1280, 800], ['phone', 390, 844]]) {
    for (const mission of ['first-light', 'one-crate-one-receipt']) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
      await context.addInitScript((mission) => localStorage.setItem('aster-campaign-v1', JSON.stringify({ version: 1, introSeen: true, currentMission: mission, completed: mission === 'first-light' ? [] : ['first-light'] })), mission);
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(url);
      assert(await page.locator('script[src]').evaluateAll((items) => items.length && items.every((item) => !/@vite|src\/main/.test(item.src))), 'Production target only');
      await page.locator('#start-game').click();
      await page.locator('#view-world').click();
      const worldFill = await page.evaluate(() => ({
        workspace: document.querySelector('.workspace').getBoundingClientRect().height,
        slot: document.querySelector('#mission-world').getBoundingClientRect().height,
        panel: document.querySelector('#world-panel').getBoundingClientRect().height,
        world: document.querySelector('#world').getBoundingClientRect().height,
      }));
      assert(worldFill.world >= 300, `${device} actual world canvas must not collapse`);
      assert(Math.abs(worldFill.slot - worldFill.panel) < 2 && Math.abs(worldFill.panel - worldFill.world) < 2, `${device} inner world fills its actual slot`);
      await page.locator('#map-toggle').click();
      await page.waitForFunction(() => document.querySelector('#world').dataset.cameraMoving === 'false');
      assert.deepEqual((await page.locator('.world-label[data-node-id]').allTextContents()).sort(), ['dock', 'garden', 'greenhouse', 'junction', 'observatory', 'relay']);
      const description = await page.locator('#world').getAttribute('aria-label');
      assert.match(description, /unbuilt|no missions here/i, 'Decorative offshore land is not one of the eleven implemented missions');
      assert.match(description, /All six stations/);
      assert.equal(await page.locator('[data-region-kind="planned"] button').count(), 0, 'Planned scenery has no fake mission action');
      const regions = JSON.parse(await page.locator('#world').getAttribute('data-mission-regions'));
      assert.equal(regions.length, 11, 'Map availability covers every authored mission');
      assert.equal(regions.find((region) => region.mission === mission).active, true);
      assert.equal(regions.find((region) => region.mission === 'one-crate-one-receipt').availability, mission === 'first-light' ? 'locked' : 'available');
      await capture(page, `${device}-${mission}-map`);
      await page.locator('#focus-landmark').click();
      await page.locator('#inspection-close').click();
      assert.equal(await page.locator('#world').getAttribute('data-active-mission'), mission, 'Inspection cannot replace current mission geography');
      if (mission === 'first-light') {
        await page.locator('#output-toggle').click();
        await capture(page, `${device}-expanded-results-map`);
      }
      await context.close();
    }
  }
  assert(captures.every((capture) => !capture.legendCaptionOverlap), 'Mission legend must not cover the station caption');
  assert(captures.every((capture) => !capture.activeToolsOverlap), 'Active problem label must not cover map controls');
  assert(captures.filter((capture) => capture.viewport <= 760).every((capture) => capture.unusedWorldSpace < 2), 'Phone world fills its workspace without an unused black strip');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, url, scope: 'Seeded map rendering and context. Earned mission unlock is covered by the real campaign.', captures, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: captures.length, output }, null, 2));
} catch (error) {
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), captures, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
