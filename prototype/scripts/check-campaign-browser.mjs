import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const evidence = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-v4/campaign-evidence';
await mkdir(evidence, { recursive: true });
const required = {
  'editor.ts': ['compile()', 'setDocument('],
  'world.ts': ['playDeliveries', 'setSuppliesRestored'],
  'runner.ts': ['executeBatch', 'prepareRunner', 'disposeRunner'],
  'mission-runtime.ts': ['export async function executeMission'],
  'delivery-mission.ts': ['export const deliveryMission'],
};
for (const [file, exports] of Object.entries(required)) {
  const source = await readFile(path.join(root, 'src', file), 'utf8');
  for (const name of exports) assert(source.includes(name), `Real integration artifact missing: ${file} ${name}. This check does not install stubs.`);
}
const port = process.env.APP_URL ? 0 : await new Promise((resolve, reject) => {
  const listener = createServer();
  listener.on('error', reject);
  listener.listen(0, '127.0.0.1', () => { const { port } = listener.address(); listener.close(() => resolve(port)); });
});
const url = process.env.APP_URL || `http://127.0.0.1:${port}`;
const server = process.env.APP_URL ? undefined : spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const serverLogs = [];
server?.stdout.on('data', (data) => serverLogs.push(String(data)));
server?.stderr.on('data', (data) => serverLogs.push(String(data)));
let browser;
const results = [];
try {
   if (server) await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Vite startup timed out: ${serverLogs.join('')}`)), 30000);
    server.stdout.on('data', (data) => { if (String(data).includes('Local:')) { clearTimeout(timer); resolve(); } });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Vite exited ${code}`)); });
  });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  for (const [device, width, height] of [['desktop', 1440, 1000], ['laptop', 1280, 800], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: device === 'desktop' ? 'no-preference' : 'reduce' });
    page.setDefaultTimeout(30000);
    const errors = [];
    const captures = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    const capture = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth, viewport: innerWidth,
         bodyFont: getComputedStyle(document.body).fontSize,
         headerHeight: document.querySelector('.header').getBoundingClientRect().height,
         editorTop: document.querySelector('#editor').getBoundingClientRect().top,
         runHeight: document.querySelector('.run-panel').getBoundingClientRect().height,
         smallTargets: [...document.querySelectorAll('button, summary')].filter((element) => !element.closest('#editor') && element.checkVisibility() && element.getBoundingClientRect().height < (innerWidth <= 760 ? 43.9 : 31.9)).map((element) => element.id || element.textContent.trim()),
      }));
      assert(metrics.width <= width, `${device} ${name} horizontal overflow: ${metrics.width}`);
      assert.equal(metrics.bodyFont, '16px');
       assert.deepEqual(metrics.smallTargets, [], `${device} ${name} small targets`);
       if (width > 760 && name.endsWith('-code')) {
         assert(metrics.headerHeight <= 56, 'compact single desktop header');
         assert(metrics.editorTop <= 100, 'editor starts within top 100px');
         assert(metrics.runHeight <= 64, 'default output stays compact');
       }
      const file = `${device}-${name}.png`;
      await page.screenshot({ path: path.join(evidence, file), fullPage: true });
      captures.push({ name, file, ...metrics });
    };
    const waitPhase = async (phase) => {
      await page.waitForFunction((phase) => document.body.dataset.phase === phase || document.body.dataset.phase === 'failed', phase, { timeout: 45000 });
      assert.equal(await page.locator('body').getAttribute('data-phase'), phase, await page.locator('#output').innerText());
    };
    const missionRegion = async (mission) => {
      const regions = JSON.parse(await page.locator('#world').getAttribute('data-mission-regions'));
      const region = regions.find((region) => region.mission === mission);
      assert(region, `Mission geography missing ${mission}`);
      return region;
    };
    const edit = async (source) => {
      await page.locator('#view-code').click();
      await page.locator('#editor .view-lines').click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.evaluate((source) => navigator.clipboard.writeText(source), source);
      await page.keyboard.press('ControlOrMeta+v');
      await page.waitForFunction((source) => {
        const key = document.body.dataset.mission === 'first-light' ? 'aster-route-ts-v1' : 'aster-intake-ts-v1';
        return localStorage.getItem(key) === source;
      }, source);
    };
    const settings = async () => { if (!await page.locator('#settings').evaluate((element) => element.open)) await page.locator('#settings > summary').click(); };
    const insertDemo = async () => {
      await settings();
      await page.locator('#demo').click();
      assert(await page.locator('#modal').isVisible());
      await page.getByRole('button', { name: 'Insert demo solution', exact: true }).click();
      assert.equal(await page.locator('body').getAttribute('data-phase'), 'ready', 'demo never runs automatically');
    };
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    await page.addInitScript(() => {
      window.__runnerPosts = 0;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) { super(url, options); this.runner = /runner\.worker/.test(String(url)); }
        postMessage(...args) { if (this.runner) window.__runnerPosts++; return super.postMessage(...args); }
      };
    });
    await page.goto(url);
    if (process.env.APP_URL) {
      const scripts = await page.locator('script[src]').evaluateAll((items) => items.map((item) => item.src));
      assert(scripts.length && scripts.every((source) => !/@vite|src\/main/.test(source)), 'External acceptance target must be a production build');
    }
    await page.locator('#start-game').waitFor();
    assert.equal(await page.locator('body').getAttribute('data-screen'), 'title');
    assert.match(await page.locator('#landing-heading').innerText(), /Aster.*The next crossing/s);
    await capture('01-title');
    if (device === 'desktop') {
      await page.locator('#home-open').click();
      assert(await page.locator('[data-select-mission="one-crate-one-receipt"]').isDisabled(), 'fresh users cannot open mission 2');
      await page.locator('#title-open').click();
    }
    await page.locator('#start-game').focus();
    await page.keyboard.press('Enter');
    for (let beat = 0; beat < 3; beat++) {
      assert.equal(await page.locator('body').getAttribute('data-screen'), 'intro');
      assert.match(await page.locator('.story-transmission .eyebrow').innerText(), new RegExp(`0${beat + 1} of 03`, 'i'));
      await capture(`02-story-${beat + 1}`);
      await page.locator('#story-next').click();
    }
    assert.equal(await page.locator('body').getAttribute('data-screen'), 'mission');
    assert(await page.locator('#editor').isHidden());
    assert(await page.locator('#brief-acceptance').count());
    assert.equal(await page.locator('#checks-count').innerText(), '0/6 · 3 examples + 3 hidden');
    assert.equal(await page.locator('#world').getAttribute('data-active-mission'), 'first-light');
    assert.equal((await missionRegion('one-crate-one-receipt')).availability, 'locked', 'Supply mission starts locked without blocking the dock route node');
    await capture('03-first-light-brief');
    await page.locator('#start-coding:not([disabled])').waitFor();
    await page.locator('#start-coding').click();
    assert.equal(await page.locator('body').getAttribute('data-view'), 'code');
    if (device !== 'phone') assert(await page.locator('.brief-panel').isVisible());
    assert.equal(await page.locator('#editor .view-lines').evaluate((element) => getComputedStyle(element).fontSize), '15px');
    await capture('04-first-light-code');
    if (device === 'desktop') {
      const postsBefore = await page.evaluate(() => window.__runnerPosts);
      await edit('const power: number = "wrong";\nfunction route(): string[] { return []; }');
      await page.locator('#run').click();
      await waitPhase('failed');
      assert.match(await page.locator('.run-panel').innerText(), /not assignable/);
      assert.equal(await page.evaluate(() => window.__runnerPosts), postsBefore, 'semantic errors never dispatch guest code');
      await edit('function route( {');
      await page.locator('#run').click();
      await waitPhase('failed');
      assert.equal(await page.evaluate(() => window.__runnerPosts), postsBefore, 'syntax errors never dispatch guest code');
      await edit('function route(): string[] { while (true) {} }');
      await page.locator('#run').click();
      await waitPhase('failed');
      assert.match(await page.locator('.run-panel').innerText(), /limit|400 ms/);
      assert.notEqual(await page.locator('#world').getAttribute('data-restored'), 'true');
      await edit('function route(): string[] { return ["dock", "relay", "greenhouse"]; }');
      await page.locator('#run').click();
      await waitPhase('failed');
      assert.match(await page.locator('.run-panel').innerText(), /broken/);
      assert.deepEqual(JSON.parse(await page.locator('#world').getAttribute('data-route-trace')), ['dock'], 'example failure never plays a route or earns progress');
      await edit('function route(): string[] { return ["dock", "relay", "junction", "garden", "greenhouse"]; }');
      await page.locator('#run').click();
      await waitPhase('failed');
      assert.equal(await page.locator('#checks-count').innerText(), '1/3 · examples · Submit 6 cases', 'a memorized delivery path fails the other public examples');
      assert.equal(await page.locator('[data-status="running"]').count(), 0, 'finished failed attempt leaves no running checks');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')).completed), []);
    }
    await insertDemo();
    await page.locator('#run').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'ready' && document.querySelector('#output strong').textContent.includes('3/3 examples passed'), null, { timeout: 45000 });
    assert.equal(await page.locator('#checks-count').innerText(), '3/3 · examples · Submit 6 cases');
    assert.equal(await page.locator('#world').getAttribute('data-restored'), 'false');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')).completed), [], 'passing examples earns no mission completion');
    if (device === 'desktop') {
      await page.locator('#submit').click();
      await waitPhase('animating');
      await page.locator('#submit').click();
      assert.equal(await page.locator('body').getAttribute('data-phase'), 'ready');
      assert.equal(await page.locator('#world').getAttribute('data-restored'), 'false');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')).completed), [], 'stopped playback earns no completion');
    }
    await page.locator('#submit').click();
    await waitPhase('complete');
    assert.equal(await page.locator('#checks-count').innerText(), '6/6 · 3 examples + 3 hidden');
    assert.equal(await page.locator('#world').getAttribute('data-restored'), 'true');
    assert(await page.locator('#submit').isHidden(), 'Accepted unchanged route source needs no redundant submission');
    assert.equal((await missionRegion('one-crate-one-receipt')).availability, 'available', 'Only earned route playback unlocks the supply mission');
    assert.match(await page.locator('#debrief-speaker').innerText(), /Mara/i);
    assert.match(await page.locator('#next-mission').innerText(), /Continue to supply dock/);
    await capture('05-first-light-complete');
    await page.locator('#next-mission').click();
    assert.equal(await page.locator('body').getAttribute('data-mission'), 'one-crate-one-receipt');
    assert.equal(await page.locator('body').getAttribute('data-screen'), 'mission');
    assert.equal(await page.locator('#world').getAttribute('data-active-mission'), 'one-crate-one-receipt');
    assert.equal((await missionRegion('one-crate-one-receipt')).active, true);
    assert.match(await page.locator('#brief-contract').innerText(), /acceptDeliveries/);
    assert.equal(await page.locator('#checks-count').innerText(), '0/8 · 3 examples + 5 hidden');
    assert.equal(await page.locator('#brief-acceptance li').count(), 7);
    assert.equal(await page.locator('#brief-examples .example').count(), 3);
    await capture('06-intake-brief');
    await page.locator('#start-coding').click();
    await capture('07-intake-code');
    if (device === 'desktop') {
      await page.locator('#run').click();
      await waitPhase('failed');
      assert.match(await page.locator('.run-panel').innerText(), /replayed|seen|receipt/i);
      assert.equal(await page.locator('#world').getAttribute('data-supplies-restored'), 'false');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')).completed), ['first-light']);
    }
    await insertDemo();
    await page.locator('#submit').click();
    await waitPhase('complete');
    assert.equal(await page.locator('#checks-count').innerText(), '8/8 · 3 examples + 5 hidden');
    assert.equal(await page.locator('#world').getAttribute('data-delivered-units'), '4');
    assert.equal(await page.locator('#world').getAttribute('data-supplies-restored'), 'true');
    assert(await page.locator('#submit').isHidden(), 'Accepted unchanged delivery source needs no redundant submission');
    assert.equal((await missionRegion('one-crate-one-receipt')).availability, 'complete');
    assert.deepEqual(JSON.parse(await page.locator('#world').getAttribute('data-intake-trace')), [
      { receiptId: 'old', decision: 'duplicate', units: 2 },
      { receiptId: 'r1', decision: 'accepted', units: 3 },
      { receiptId: 'r1', decision: 'duplicate', units: 9 },
      { receiptId: 'r2', decision: 'accepted', units: 1 },
    ]);
    assert.match(await page.locator('#intake-ledger summary').innerText(), /2 accepted.*2 duplicate scans.*4 units stored/);
    assert.match(await page.locator('#debrief-speaker').innerText(), /Neri/i);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aster-campaign-v1')));
    assert.deepEqual(saved.completed, ['first-light', 'one-crate-one-receipt']);
    await capture('08-intake-complete');
    await page.locator('#next-mission').click();
    assert.equal(await page.locator('body').getAttribute('data-mission'), 'read-the-weather', 'Intake now continues into the real weather mission');
    assert.match(await page.locator('#brief-contract').innerText(), /parseTelemetry/);
    await page.locator('#home-open').click();
    assert.equal(await page.locator('[data-select-mission]').count(), 11);
    assert.equal(await page.locator('[data-select-mission="read-the-weather"]').isDisabled(), false);
    assert.equal(await page.locator('[data-select-mission="balance-the-store"]').isDisabled(), true);
    await page.locator('#home-log').click();
    assert.equal(await page.locator('.planned-exercise').count(), 0, 'Implemented chapters are not presented as planned placeholders');
    assert.equal(await page.locator('[data-log-mission="read-the-weather"]').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('body').getAttribute('data-screen'), 'home');
    await capture('09-home-unlocked');
    await page.reload();
    await page.locator('#start-game').waitFor();
    assert.match(await page.locator('#start-game').innerText(), /Resume Read the weather/);
    await page.locator('#start-game').click();
    await page.locator('#start-coding:not([disabled])').waitFor({ state: 'attached' });
    if (await page.locator('body').getAttribute('data-screen') === 'mission') await page.locator('#start-coding').click();
    assert.equal(await page.locator('body').getAttribute('data-mission'), 'read-the-weather');
    await page.locator('#view-world').click();
    assert(await page.locator('#submit').isVisible(), 'Reloaded earned history does not certify saved source');
    assert.equal(await page.locator('#world').getAttribute('data-restored'), 'true');
    assert.equal(await page.locator('#world').getAttribute('data-supplies-restored'), 'true');
    assert.deepEqual(errors, []);
     results.push({ device, viewport: { width, height }, captures, errors, checks: ['title before story', 'three manual story beats', 'problem before Monaco', 'persistent desktop brief', 'real compile and complete 6/8-case submissions', 'example failures do not play routes', 'real accepted submission playback earns M1', 'prominent continuation opens actual M2', 'actual accepted M2 object result playback', 'both debriefs', 'actual weather continuation and eleven-mission log', 'progress and current mission survive reload', 'no horizontal page overflow', '32px desktop and 44px phone targets', 'no page or console errors'] });
    await page.close();
  }
  await writeFile(path.join(evidence, 'shell-results.json'), JSON.stringify({ kind: 'real integrated campaign browser checks', results }, null, 2));
  console.log(JSON.stringify({ passed: true, viewports: results.length, screenshots: results.reduce((sum, result) => sum + result.captures.length, 0), evidence }, null, 2));
} catch (error) {
  await writeFile(path.join(evidence, 'shell-failure.json'), JSON.stringify({ error: String(error), results, serverLogs }, null, 2));
  throw error;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
