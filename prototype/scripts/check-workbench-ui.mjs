import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.APP_URL;
assert(url, 'APP_URL must select an explicitly staged production build');
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-world-workbench/browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const errors = [];
const captures = [];
const sourceKey = 'aster-intake-ts-v1';
const ratioKey = 'aster-results-ratio-v1';
const wrongSource = 'type Delivery = { receiptId: string; item: string; units: number };\nfunction acceptDeliveries(deliveries: Delivery[], seen: string[]) { console.log({ deliveries, seen }); return { deliveries, seen }; }';
const handle = (page) => page.getByRole('separator', { name: /results/i });
const maximize = (page) => page.getByRole('button', { name: /^(Maximize|Restore)$/ });
const panel = (page) => page.locator('.run-panel');

async function open({ width = 1440, height = 1000, touch = false, preference, blocked = false, reducedMotion = 'reduce' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, reducedMotion });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  await context.addInitScript(({ sourceKey, ratioKey, wrongSource, preference, blocked }) => {
    if (!localStorage.getItem('__workbench-seeded')) {
      localStorage.setItem('aster-campaign-v1', JSON.stringify({ version: 1, introSeen: true, currentMission: 'one-crate-one-receipt', completed: ['first-light'] }));
      localStorage.setItem(sourceKey, wrongSource);
      if (preference !== undefined) localStorage.setItem(ratioKey, preference);
      localStorage.setItem('__workbench-seeded', 'true');
    }
    if (blocked) for (const method of ['getItem', 'setItem', 'removeItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (key, ...args) {
        if (key === ratioKey) throw new DOMException('Results layout storage blocked', 'SecurityError');
        return original.call(this, key, ...args);
      };
    }
    window.__runnerPosts = 0;
    window.__feedbackCalls = [];
    const nativeAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.closest('.run-panel')) window.__feedbackCalls.push({ target: this.id, kind: document.querySelector('#attempt-feedback')?.dataset.feedback, phase: document.body.dataset.phase, duration: args[1]?.duration });
      return nativeAnimate.apply(this, args);
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) { super(url, options); this.isRunner = /runner\.worker/.test(String(url)); }
      postMessage(...args) { if (this.isRunner) window.__runnerPosts++; return super.postMessage(...args); }
    };
  }, { sourceKey, ratioKey, wrongSource, preference, blocked });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  assert(await page.locator('script[src]').evaluateAll((items) => items.length && items.every((item) => !/@vite|src\/main/.test(item.src))), 'Production target only');
  await page.locator('#start-game').click();
  await page.locator('#view-brief').click();
  await page.locator('#start-coding:not([disabled])').waitFor();
  await page.locator('#start-coding').click();
  return { page, context };
}
async function snapshot(page) {
  return page.evaluate(({ sourceKey, ratioKey }) => ({
    panelHeight: document.querySelector('.run-panel').getBoundingClientRect().height,
    workspaceHeight: document.querySelector('.workspace').getBoundingClientRect().height,
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    source: localStorage.getItem(sourceKey),
    campaign: localStorage.getItem('aster-campaign-v1'),
    ratio: (() => { try { return localStorage.getItem(ratioKey); } catch { return null; } })(),
    posts: window.__runnerPosts,
    phase: document.body.dataset.phase,
  }), { sourceKey, ratioKey });
}
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  const state = await snapshot(page);
  assert(state.pageWidth <= state.viewportWidth, `${name} has no horizontal page overflow`);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: state.viewportWidth > 760 });
  captures.push({ name, ...state });
}
async function failExamples(page) {
  await page.locator('#run').click();
  await page.waitForFunction(() => document.body.dataset.phase === 'failed', null, { timeout: 45000 });
  assert.match(await page.locator('#case-feedback').innerText(), /replayed|history/);
}
async function drag(page, deltaY) {
  const box = await handle(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + deltaY, { steps: 8 });
  await page.mouse.up();
}
async function edit(page, source) {
  await page.locator('#view-code').click();
  await page.locator('#editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.evaluate((source) => navigator.clipboard.writeText(source), source);
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForFunction(({ sourceKey, source }) => localStorage.getItem(sourceKey) === source, { sourceKey, source });
}

try {
  const { page, context } = await open();
  assert((await snapshot(page)).panelHeight <= 64, 'Default action strip stays compact');
  await failExamples(page);
  assert.deepEqual(await page.evaluate(() => window.__feedbackCalls), [], 'Reduced-motion feedback remains static');
  assert.equal(await handle(page).getAttribute('aria-orientation'), 'horizontal');
  const fields = await page.locator('.case-values pre').evaluateAll((items) => items.map((item) => ({ height: item.getBoundingClientRect().height, scroll: item.scrollHeight, client: item.clientHeight, maxHeight: getComputedStyle(item).maxHeight, font: getComputedStyle(item).fontSize })));
  assert(fields.every((field) => field.maxHeight === 'none' && field.scroll <= field.client + 2), 'JSON has natural height, not separate vertical scroll traps');
  assert(fields.some((field) => field.height > 400), 'Actual manifest can expose much more than the old 160px cap');
  assert(fields.every((field) => parseFloat(field.font) >= 14), 'Reading space grows without shrinking text');
  await capture(page, '01-readable-failure');
  await page.locator('.results-scroll').evaluate((element) => element.scrollTop = 250);
  await page.locator('#case-list [data-case="receipt-not-item"]').click();
  assert.equal(await page.locator('.results-scroll').evaluate((element) => element.scrollTop), 0, 'A newly selected example starts at its diagnostic, not the previous case offset');
  await page.locator('#case-list [data-case="manifest"]').click();
  const before = await snapshot(page);
  await drag(page, -140);
  const enlarged = await snapshot(page);
  assert(enlarged.panelHeight > before.panelHeight + 60, 'Dragging divider upward grows results');
  assert.equal(enlarged.source, before.source);
  assert.equal(enlarged.campaign, before.campaign);
  assert.equal(enlarged.posts, before.posts, 'Resizing dispatches no guest code');
  assert.equal(enlarged.phase, before.phase);
  await capture(page, '02-enlarged-results');
  await handle(page).focus();
  await page.keyboard.press('Home');
  const minimum = await snapshot(page);
  await page.keyboard.press('End');
  const maximum = await snapshot(page);
  assert(maximum.panelHeight > minimum.panelHeight + 100);
  assert(maximum.workspaceHeight >= 180, 'Normal resize retains useful editor space');
  await page.keyboard.press('Shift+ArrowDown');
  const committed = await snapshot(page);
  const box = await handle(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 100, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const rolledBack = await snapshot(page);
  assert(Math.abs(rolledBack.panelHeight - committed.panelHeight) < 3, 'Escape rolls back resize');
  assert.equal(rolledBack.phase, committed.phase);
  await maximize(page).click();
  assert(await page.locator('.workspace').evaluate((element) => element.inert), 'Maximized desktop reader removes hidden workspace from keyboard focus');
  const maximized = await snapshot(page);
  assert(maximized.panelHeight > maximum.panelHeight + 100);
  await capture(page, '03-maximized-results');
  await maximize(page).click();
  assert.equal(await page.locator('.workspace').evaluate((element) => element.inert), false);
  assert(Math.abs((await snapshot(page)).panelHeight - committed.panelHeight) < 3, 'Restore retains preferred size');
  await handle(page).dblclick();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), ratioKey), null, 'Double-click resets independent preference');
  await page.locator('#editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.insertText('// results undo probe\n');
  await page.waitForFunction(({ sourceKey }) => localStorage.getItem(sourceKey).startsWith('// results undo probe'), { sourceKey });
  await page.locator('#output-toggle').click();
  if (!await handle(page).isVisible()) await page.locator('#output-toggle').click();
  await drag(page, -80);
  await page.locator('#editor .view-lines').click();
  for (let step = 0; step < 8 && await page.evaluate((key) => localStorage.getItem(key), sourceKey) !== wrongSource; step++) await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(({ sourceKey, wrongSource }) => localStorage.getItem(sourceKey) === wrongSource, { sourceKey, wrongSource });
  await page.locator('#settings > summary').click();
  await page.locator('#demo').click();
  await page.getByRole('button', { name: 'Insert demo solution', exact: true }).click();
  await page.locator('#submit').click();
  await page.waitForFunction(() => document.body.dataset.phase === 'complete', null, { timeout: 45000 });
  assert(await page.locator('#submit').isHidden(), 'Successful actual playback suppresses redundant Submit');
  await capture(page, '04-accepted-no-submit');
  const acceptedSource = await page.evaluate((key) => localStorage.getItem(key), sourceKey);
  await page.locator('#view-code').click();
  const accepted = await snapshot(page);
  await page.locator('#editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
  await page.locator('#output-toggle').focus();
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
  assert.deepEqual(await snapshot(page), accepted, 'Both Submit shortcuts are no-ops for accepted unchanged source');
  await edit(page, `// acceptance edit\n${acceptedSource}`);
  assert(await page.locator('#submit').isVisible(), 'Editing restores submission');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(({ sourceKey, acceptedSource }) => localStorage.getItem(sourceKey) === acceptedSource, { sourceKey, acceptedSource });
  assert(await page.locator('#submit').isHidden(), 'Undo to exact accepted source restores acceptance without rerunning cases');
  await page.locator('#run').click();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, { timeout: 45000 });
  assert(await page.locator('#submit').isHidden());
  assert.equal(await page.locator('.results-scroll').evaluate((element) => element.scrollTop), 0, 'New example runs begin at the result headings rather than a previous completion offset');
  assert(!/submit solution to continue/i.test(await panel(page).innerText()), 'Accepted examples do not instruct use of a hidden Submit control');
  assert(await page.locator('#next-mission').isVisible(), 'Earned continuation survives running examples');
  await capture(page, '05-accepted-after-examples');
  await page.reload();
  await page.locator('#start-game').click();
  await page.locator('#view-brief').click();
  await page.locator('#start-coding:not([disabled])').waitFor();
  await page.locator('#start-coding').click();
  assert(await page.locator('#submit').isVisible(), 'Reloaded completion does not certify current source');
  assert.match(await panel(page).innerText(), /unchecked/i);
  await context.close();

  const touch = await open({ width: 820, height: 1000, touch: true });
  await failExamples(touch.page);
  const touchBefore = await snapshot(touch.page);
  const touchBox = await handle(touch.page).boundingBox();
  const cdp = await touch.context.newCDPSession(touch.page);
  const point = { x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y - 120 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert((await snapshot(touch.page)).panelHeight > touchBefore.panelHeight + 40);
  await capture(touch.page, '06-tablet-touch-results');
  await touch.context.close();

  const phone = await open({ width: 390, height: 844, touch: true });
  await failExamples(phone.page);
  assert(await handle(phone.page).isHidden(), 'Phone uses readable natural page flow instead of a trapped desktop split');
  const phoneFields = await phone.page.locator('.case-values pre').evaluateAll((items) => items.map((item) => ({ height: item.getBoundingClientRect().height, scroll: item.scrollHeight, client: item.clientHeight })));
  assert(phoneFields.every((field) => field.scroll <= field.client + 2));
  await phone.page.locator('[data-case-field="actual"] pre').scrollIntoViewIfNeeded();
  await capture(phone.page, '07-phone-actual-readable');
  await maximize(phone.page).click();
  assert.equal(await phone.page.locator('.workspace').evaluate((element) => element.inert), false, 'Phone maximize leaves the offscreen workspace usable');
  await phone.page.locator('#editor .view-lines').click();
  await phone.page.setViewportSize({ width: 1440, height: 1000 });
  await phone.page.waitForFunction(() => document.querySelector('.workspace').inert);
  await phone.page.keyboard.press('Tab');
  assert.equal(await phone.page.evaluate(() => document.activeElement.closest('[inert]') !== null), false, 'Keyboard focus recovers outside the hidden workspace after a phone-to-desktop resize');
  await maximize(phone.page).click();
  await phone.page.setViewportSize({ width: 390, height: 360 });
  await maximize(phone.page).click();
  await maximize(phone.page).scrollIntoViewIfNeeded();
  const restoreBounds = await maximize(phone.page).evaluate((element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, height: innerHeight }));
  assert(restoreBounds.top >= 0 && restoreBounds.bottom <= restoreBounds.height + 2, 'Short phone viewport keeps Restore reachable');
  await maximize(phone.page).click();
  assert.equal(await phone.page.locator('body').getAttribute('data-results-mode'), 'expanded');
  await phone.context.close();

  for (const options of [{ preference: 'not-json' }, { preference: '2' }, { blocked: true }]) {
    const { page, context } = await open({ width: 1280, height: 800, ...options });
    await page.locator('#output-toggle').click();
    await handle(page).focus();
    await page.keyboard.press('End');
    assert((await snapshot(page)).workspaceHeight >= 180);
    assert.match(await page.locator('#save-status').innerText(), /saved on this device/);
    await context.close();
  }
  const motion = await open({ width: 1280, height: 800, reducedMotion: 'no-preference' });
  await failExamples(motion.page);
  const failureCues = await motion.page.evaluate(() => window.__feedbackCalls.filter((cue) => cue.kind === 'failure'));
  assert.equal(failureCues.length, 2, 'Failure triggers one finite native badge and case response');
  assert(failureCues.every((cue) => cue.phase === 'failed' && cue.duration <= 450));
  await motion.page.locator('#settings > summary').click();
  await motion.page.locator('#demo').click();
  await motion.page.getByRole('button', { name: 'Insert demo solution', exact: true }).click();
  await motion.page.locator('#submit').click();
  await motion.page.waitForFunction(() => document.body.dataset.phase === 'animating', null, { timeout: 45000 });
  assert.equal(await motion.page.evaluate(() => window.__feedbackCalls.filter((cue) => cue.kind === 'victory').length), 0, 'No victory before actual playback completes');
  await motion.page.keyboard.press('Escape');
  assert.equal(await motion.page.locator('body').getAttribute('data-phase'), 'ready');
  await motion.page.locator('#view-code').click();
  await motion.page.locator('#submit').click();
  await motion.page.waitForFunction(() => document.body.dataset.phase === 'complete', null, { timeout: 45000 });
  const victoryCues = await motion.page.evaluate(() => window.__feedbackCalls.filter((cue) => cue.kind === 'victory'));
  assert.equal(victoryCues.length, 2, 'Only earned completion triggers one native victory response');
  assert(victoryCues.every((cue) => cue.phase === 'complete' && cue.duration <= 450));
  await capture(motion.page, '08-native-victory');
  await motion.page.locator('#view-code').click();
  await motion.page.locator('#run').click();
  await motion.page.waitForFunction(() => document.body.dataset.phase === 'ready', null, { timeout: 45000 });
  assert.equal(await motion.page.evaluate(() => window.__feedbackCalls.filter((cue) => cue.kind === 'victory').length), 2, 'Examples do not replay victory');
  await motion.context.close();
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, url, captures, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: captures.length, output }, null, 2));
} catch (error) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const diagnostics = [];
  for (const [index, page] of pages.entries()) {
    diagnostics.push(await snapshot(page).catch(() => ({ url: page.url() })));
    await page.screenshot({ path: `${output}/failure-${index}.png`, fullPage: false }).catch(() => {});
  }
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), captures, errors, diagnostics }, null, 2));
  throw error;
} finally {
  await browser.close();
}
