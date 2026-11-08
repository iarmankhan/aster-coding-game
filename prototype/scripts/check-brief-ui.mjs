import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const output = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-brief-resize/browser';
await mkdir(output, { recursive: true });
const server = process.env.APP_URL ? null : await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server?.listen();
const url = process.env.APP_URL || server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const layoutKey = 'aster-brief-ratio-v1';
const results = [];
const errors = [];

async function open({ width = 1440, height = 1000, mission = 'one-crate-one-receipt', preference, blocked = false, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', hasTouch: touch });
  await context.addInitScript(({ mission, preference, blocked, layoutKey }) => {
    if (!localStorage.getItem('__brief-ui-seeded')) {
      localStorage.setItem('aster-campaign-v1', JSON.stringify({ version: 1, introSeen: true, currentMission: mission, completed: mission === 'first-light' ? [] : ['first-light'] }));
      if (preference !== undefined) localStorage.setItem(layoutKey, preference);
      localStorage.setItem('__brief-ui-seeded', 'true');
    }
    if (blocked) {
      for (const method of ['getItem', 'setItem']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...args) {
          if (key === layoutKey) throw new DOMException('Layout storage blocked for this test', 'SecurityError');
          return original.call(this, key, ...args);
        };
      }
    }
  }, { mission, preference, blocked, layoutKey });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.locator('#start-game').click();
  await page.locator('#view-brief').click();
  await page.locator('#start-coding:not([disabled])').waitFor();
  return { page, context };
}

const separator = (page) => page.locator('.workspace [role="separator"]');
async function dimensions(page) {
  return page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const workspace = rect('.workspace');
    const brief = rect('.brief-panel');
    return { workspace: workspace.width, brief: brief.width, ratio: brief.width / workspace.width, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, editorTop: rect('#editor').top, header: rect('.header').height };
  });
}
async function checkBounds(page, expected) {
  await page.waitForFunction((expected) => {
    const width = document.querySelector('.workspace').getBoundingClientRect().width;
    const brief = document.querySelector('.brief-panel').getBoundingClientRect().width;
    return brief >= 309 && brief <= width / 2 + 1 && (expected === undefined || Math.abs(brief / width - expected) < .003);
  }, expected);
  const size = await dimensions(page);
  assert(size.pageWidth <= size.viewport, 'No horizontal page overflow');
  if (expected !== undefined) assert(Math.abs(size.ratio - expected) < .003, `Expected ${expected}, got ${size.ratio}`);
  assert.equal(await separator(page).getAttribute('aria-orientation'), 'vertical');
  assert.equal(Number(await separator(page).getAttribute('aria-valuemax')), 50);
  const now = Number(await separator(page).getAttribute('aria-valuenow'));
  assert(Math.abs(now - size.ratio * 100) < 1, 'ARIA value describes actual pane width');
  return size;
}
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  results.push({ name, ...await dimensions(page) });
}
async function drag(page, x) {
  const box = await separator(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(140, box.height / 2));
  await page.mouse.down();
  await page.mouse.move(x, box.y + Math.min(140, box.height / 2), { steps: 8 });
  await page.mouse.up();
}

try {
  for (const mission of ['first-light', 'one-crate-one-receipt']) {
    const { page, context } = await open({ mission });
    assert(await separator(page).isVisible());
    assert(await page.locator('#brief-goal li').count() >= 3, 'Task is a scannable list');
    const code = await page.locator('#brief-goal code').allTextContents();
    assert(code.some((text) => text.includes(mission === 'first-light' ? 'route(' : 'acceptDeliveries(')), 'Function call is inline code');
    assert(await page.locator('#brief-contract pre > code').count(), 'Contract uses semantic code block');
    assert(await page.locator('#brief-input pre > code').count(), 'Dataset uses semantic code block');
    const input = JSON.parse(await page.locator('#brief-input pre').first().textContent());
    assert(mission === 'first-light' ? input.graph.dock.includes('relay') : input.deliveries[2].units === 9);
    assert.equal(await page.locator('#brief-acceptance li').count(), mission === 'first-light' ? 6 : 7, 'Acceptance rules preserved');
    const story = page.locator('.brief-story');
    assert.equal(await story.getAttribute('open'), null, 'Story is available without obscuring task');
    await story.locator('summary').click();
    assert(await story.locator('p').count() >= 2, 'Story uses short paragraphs');
    await story.locator('summary').click();
    await capture(page, `${mission}-default-brief`);
    await separator(page).focus();
    await page.keyboard.press('End');
    await checkBounds(page, .5);
    await capture(page, `${mission}-half-brief`);
    await page.locator('#start-coding').click();
    await checkBounds(page, .5);
    const geometry = await dimensions(page);
    assert.equal(geometry.header, 52);
    assert.equal(geometry.editorTop, 86);
    if (mission === 'one-crate-one-receipt') {
      await page.locator('#editor .view-lines').click();
      await page.keyboard.press('ControlOrMeta+Home');
      await page.keyboard.insertText('// sidebar undo probe\n');
      await page.waitForFunction(() => localStorage.getItem('aster-intake-ts-v1')?.includes('sidebar undo probe'));
      const saved = await page.evaluate(() => ({ source: localStorage.getItem('aster-intake-ts-v1'), campaign: localStorage.getItem('aster-campaign-v1'), phase: document.body.dataset.phase }));
      await drag(page, 10);
      const minimum = await checkBounds(page);
      assert(Math.abs(minimum.brief - 310) < 2);
      await drag(page, 1400);
      await checkBounds(page, .5);
      await separator(page).focus();
      await page.keyboard.press('ArrowLeft');
      await checkBounds(page, .49);
      await page.keyboard.press('Shift+ArrowLeft');
      await checkBounds(page, .44);
      await page.keyboard.press('ArrowRight');
      await checkBounds(page, .45);
      await page.keyboard.press('Home');
      assert(Math.abs((await checkBounds(page)).brief - 310) < 2, 'Home reaches minimum');
      await page.keyboard.press('End');
      await page.keyboard.press('Shift+ArrowLeft');
      await checkBounds(page, .45);
      const box = await separator(page).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 120);
      await page.mouse.down();
      await page.mouse.move(1300, box.y + 120);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await checkBounds(page, .45);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).userSelect), 'auto', 'Drag selection suppression cleaned');
      assert.deepEqual(await page.evaluate(() => ({ source: localStorage.getItem('aster-intake-ts-v1'), campaign: localStorage.getItem('aster-campaign-v1'), phase: document.body.dataset.phase })), saved, 'Resize leaves code/progress/phase unchanged');
      await page.locator('#editor .view-lines').click();
      assert(saved.source.startsWith('// sidebar undo probe\n'));
      const originalSource = saved.source.slice('// sidebar undo probe\n'.length);
      let undone = saved.source;
      for (let step = 0; step < 8 && undone !== originalSource; step++) {
        await page.keyboard.press('ControlOrMeta+z');
        undone = await page.evaluate(() => localStorage.getItem('aster-intake-ts-v1'));
      }
      assert.equal(undone, originalSource, 'Native editor undo history survives resizing');
      await capture(page, 'intake-resized-code');
      await page.locator('#view-world').click();
      assert(await separator(page).isHidden());
      assert.equal(await page.locator('.brief-panel').isHidden(), true);
      await page.locator('#view-code').click();
      await checkBounds(page, .45);
      await page.reload();
      await page.locator('#start-game').click();
      await page.locator('#view-code').click();
      await checkBounds(page, .45);
      await page.locator('#home-open').click();
      await page.locator('[data-select-mission="first-light"]').click();
      await page.locator('#home-resume').click();
      await page.locator('#view-code').click();
      await checkBounds(page, .45);
      await page.locator('#home-open').click();
      await page.locator('[data-select-mission="one-crate-one-receipt"]').click();
      await page.locator('#home-resume').click();
      await page.locator('#view-code').click();
      await checkBounds(page, .45);
      await page.setViewportSize({ width: 761, height: 800 });
      await checkBounds(page, .45);
      await page.setViewportSize({ width: 760, height: 800 });
      assert(await separator(page).isHidden());
      await page.setViewportSize({ width: 1440, height: 1000 });
      await checkBounds(page, .45);
      await separator(page).dblclick();
      const reset = await checkBounds(page);
      assert(Math.abs(reset.brief - 390) < 2, 'Double click restores default clamped width');
    }
    await context.close();
  }
  for (const preference of ['not-a-number', 'NaN', 'Infinity', '-3', '2', '0.01', 'null', '']) {
    const { page, context } = await open({ preference });
    await page.locator('#start-coding').click();
    await checkBounds(page);
    await context.close();
  }
  for (const blocked of [false, true]) {
    const { page, context } = await open({ width: 1280, height: 800, blocked });
    await page.locator('#start-coding').click();
    await separator(page).focus();
    await page.keyboard.press('End');
    await checkBounds(page, .5);
    assert.match(await page.locator('#save-status').textContent(), /saved on this device/);
    await capture(page, blocked ? 'blocked-layout-storage' : 'laptop-half-code');
    await context.close();
  }
  const touch = await open({ width: 820, height: 1000, touch: true });
  await touch.page.locator('#start-coding').click();
  const touchBox = await separator(touch.page).boundingBox();
  const cdp = await touch.context.newCDPSession(touch.page);
  const point = { x: touchBox.x + touchBox.width / 2, y: touchBox.y + 120 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: 700 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await checkBounds(touch.page, .5);
  const cancelBox = await separator(touch.page).boundingBox();
  const cancelPoint = { x: cancelBox.x + cancelBox.width / 2, y: cancelBox.y + 120 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [cancelPoint] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...cancelPoint, x: 330 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await checkBounds(touch.page, .5);
  await touch.context.close();
  for (const mission of ['first-light', 'one-crate-one-receipt']) {
    const { page, context } = await open({ width: 390, height: 844, mission, touch: true, preference: '0.5' });
    assert(await separator(page).isHidden());
    await capture(page, `${mission}-phone-brief`);
    assert((await dimensions(page)).pageWidth <= 390);
    await page.locator('#start-coding').click();
    assert(await page.locator('.brief-panel').isHidden());
    assert(await separator(page).isHidden());
    await capture(page, `${mission}-phone-code`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, url, scope: 'Seeded layout/content tests, not earned progression. Real campaign is separate.', results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: results.length, output }, null, 2));
} catch (error) {
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), results, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
  await server?.close();
}
