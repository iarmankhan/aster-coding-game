import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-v4/startup-comparison';
await mkdir(output, { recursive: true });
const text = await readFile(new URL('../src/mission.ts', import.meta.url), 'utf8');
const solution = text.match(/export const solution = `([\s\S]*?)`;/)?.[1];
assert(solution && !solution.includes('${'), 'Use the exact bundled static BFS source');
const urls = [
  { label: process.env.BEFORE_LABEL || 'v3', url: process.env.BEFORE_URL || 'http://127.0.0.1:5250' },
  { label: process.env.AFTER_LABEL || 'v4', url: process.env.AFTER_URL || 'http://127.0.0.1:5248' },
];
const count = Number(process.env.COUNT || 5);
assert(Number.isInteger(count) && count > 0 && count <= 25);
assert.notEqual(urls[0].label, urls[1].label);
const maxAfterPlaybackMs = Number(process.env.MAX_AFTER_PLAYBACK_MS || 20000);
assert(Number.isFinite(maxAfterPlaybackMs) && maxAfterPlaybackMs > 0);
const host = () => ({ at: new Date().toISOString(), uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(), cores: Number(execFileSync('nproc', { encoding: 'utf8' })) });
const report = {
  claim: 'Compare production click-to-playback scheduling for the same correct BFS, with real 3/3 checks and greenhouse restoration.',
  limits: 'Same server Chromium/SwiftShader. Cold means isolated context, not OS cache. Campaign prewarms while title and brief are traversed without artificial waits. URLs identify transport differences. Startup measures scheduling, not a rasterized moving frame. Navigation-to-click and full playback are reported separately.',
  hostBefore: host(), urls, maxAfterPlaybackMs, runs: [], errors: [],
};

function observeRuntime() {
  const events = [];
  window.__startupEvidence = events;
  const record = (type, detail = {}) => events.push({ type, t: performance.now(), ...detail });
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('#run')) record('run');
  }, true);
  let previous = '';
  new MutationObserver(() => {
    const phase = document.body?.dataset.phase;
    if (phase && phase !== previous) { previous = phase; record('phase', { phase }); }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-phase'] });
  const NativeWorker = window.Worker;
  let workerId = 0;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      const id = ++workerId;
      if (/runner\.worker/.test(String(url))) {
        record('construct', { id, url: String(url) });
        this.addEventListener('message', ({ data }) => record('worker', { id, message: data?.type }));
      }
    }
  };
}

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
report.browser = browser.version();
try {
  for (let pair = 1; pair <= count; pair++) {
    for (const side of pair % 2 ? urls : [...urls].reverse()) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
      const page = await context.newPage();
      const row = { pair, side: side.label, host: host(), attempts: [], errors: [] };
      report.runs.push(row);
      page.on('pageerror', (error) => row.errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') row.errors.push(message.text()); });
      await page.addInitScript(({ source }) => localStorage.setItem('aster-route-ts-v1', source), { source: solution });
      await page.addInitScript(observeRuntime);
      try {
        await page.goto(side.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(document.body.dataset.screen));
        row.entryScreen = await page.locator('body').getAttribute('data-screen');
        if (row.entryScreen === 'title') {
          await page.locator('#start-game').click();
          await page.locator('#story-skip').click();
        }
        await page.locator('#start-coding:not([disabled])').waitFor({ timeout: 60000 });
        await page.locator('#start-coding').click();
        const scripts = await page.locator('script[src]').evaluateAll((elements) => elements.map((item) => item.src));
        assert(scripts.length && scripts.every((url) => !/@vite|src\/main/.test(url)), 'Compare production builds only');
        row.scripts = scripts;
        for (const temperature of ['cold-context', 'warm-repeat']) {
          await page.locator('#run').click();
          await page.waitForFunction(() => ['animating', 'failed'].includes(document.body.dataset.phase), undefined, { timeout: 45000 });
          assert.equal(await page.locator('body').getAttribute('data-phase'), 'animating', await page.locator('#output').innerText());
          assert.equal(await page.locator('#checks-count').innerText(), '3/3');
          await page.waitForFunction(() => ['complete', 'failed'].includes(document.body.dataset.phase), undefined, { timeout: 45000 });
          const evidence = await page.evaluate(() => ({
            events: window.__startupEvidence,
            phase: document.body.dataset.phase,
            checks: document.querySelector('#checks-count').textContent,
            restored: document.querySelector('#world').dataset.restored,
            route: JSON.parse(document.querySelector('#world').dataset.routeTrace),
            statuses: [...document.querySelectorAll('[data-check]')].map((element) => element.dataset.status),
          }));
          assert.equal(evidence.phase, 'complete');
          assert.equal(evidence.checks, '3/3');
          assert.equal(evidence.restored, 'true');
          assert.deepEqual(evidence.route, ['dock', 'relay', 'junction', 'garden', 'greenhouse']);
          assert(evidence.statuses.length === 3 && evidence.statuses.every((status) => status === 'passed'));
          const start = evidence.events.findLastIndex((event) => event.type === 'run');
          const events = evidence.events.slice(start);
          const scheduled = events.find((event) => event.type === 'phase' && event.phase === 'animating');
          const complete = events.find((event) => event.type === 'phase' && event.phase === 'complete');
          assert(scheduled && complete);
          if (side === urls[1]) assert(complete.t - scheduled.t <= maxAfterPlaybackMs, 'Known BFS playback exceeded its wall-time budget; faster startup must not hide slower simulation');
          const compiling = events.find((event) => event.type === 'phase' && event.phase === 'compiling');
          const executing = events.find((event) => event.type === 'phase' && event.phase === 'executing');
          row.attempts.push({
            temperature, startupMs: scheduled.t - events[0].t, completionMs: complete.t - events[0].t,
            playbackMs: complete.t - scheduled.t,
            compileStageMs: compiling && executing ? executing.t - compiling.t : null,
            firstRunFromNavigationMs: temperature === 'cold-context' ? events[0].t : null,
            firstPlaybackFromNavigationMs: temperature === 'cold-context' ? scheduled.t : null,
            evidence,
          });
        }
        row.resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.toJSON()));
        assert.deepEqual(row.errors, []);
        console.log(`${side.label} pair ${pair}: ${row.attempts.map((attempt) => `${attempt.temperature} ${attempt.startupMs.toFixed(1)}ms`).join(', ')}`);
      } catch (error) {
        row.failure = String(error);
        report.errors.push({ side: side.label, pair, error: String(error) });
        await page.screenshot({ path: `${output}/failure-${side.label}-${pair}.png` }).catch(() => {});
      } finally {
        await writeFile(`${output}/${side.label}-${pair}.json`, JSON.stringify(row, null, 2));
        await context.close();
      }
    }
  }
} finally {
  report.hostAfter = host();
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
assert.deepEqual(report.errors, []);
const summary = {};
for (const side of urls) for (const temperature of ['cold-context', 'warm-repeat']) {
  const attempts = report.runs.filter((run) => run.side === side.label).flatMap((run) => run.attempts.filter((attempt) => attempt.temperature === temperature));
  summary[`${side.label}/${temperature}`] = {};
  for (const metric of ['startupMs', 'completionMs', 'playbackMs', 'compileStageMs', 'firstRunFromNavigationMs', 'firstPlaybackFromNavigationMs']) {
    const values = attempts.map((attempt) => attempt[metric]).filter((value) => value !== null).sort((a, b) => a - b);
    if (!values.length) continue;
    const middle = Math.floor(values.length / 2);
    summary[`${side.label}/${temperature}`][metric] = { count: values.length, medianMs: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, rangeMs: [values[0], values.at(-1)] };
  }
}
const completedAttempts = report.runs.reduce((total, run) => total + run.attempts.length, 0);
await writeFile(`${output}/summary.json`, JSON.stringify({ summary, completedAttempts, verifiedFixtureCount: completedAttempts * 3, errors: report.errors.length, hostBefore: report.hostBefore, hostAfter: report.hostAfter }, null, 2));
console.log(JSON.stringify(summary, null, 2));
