import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-v4/cold-start';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const requests: { url: string; event: string; time: number }[] = [];
const errors: string[] = [];
const started = Date.now();
page.on('pageerror', (error: Error) => errors.push(error.message));
context.on('request', (request: { url(): string }) => {
  if (/runner\.worker|\.wasm/.test(request.url())) requests.push({ url: request.url(), event: 'request', time: Date.now() - started });
});
context.on('requestfinished', (request: { url(): string }) => {
  if (/runner\.worker|\.wasm/.test(request.url())) requests.push({ url: request.url(), event: 'finished', time: Date.now() - started });
});
const delayMs = Number(process.env.STARTUP_DELAY_MS ?? 7500);
let delayed = false;
await context.route(process.env.DELAY_ASSET === 'wasm' ? '**/assets/*.wasm' : '**/assets/runner.worker-*.js', async (route: { continue(): Promise<void> }) => {
  if (!delayed) {
    delayed = true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  await route.continue();
});
let output = '';
let phase: string | null = null;
let checks: string | null = null;
let restored: string | null = null;
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5248');
  await page.locator('#start-game').click();
  await page.locator('#story-skip').click();
  await page.locator('#start-coding:not([disabled])').waitFor({ timeout: 60000 });
  assert(await page.locator('#editor').isHidden());
  assert(await page.locator('#brief-goal').isVisible());
  await page.locator('#start-coding').click();
  await page.locator('#settings > summary').click();
  await page.locator('#demo').click();
  await page.getByRole('button', { name: 'Insert demo solution', exact: true }).click();
  await page.locator('#submit').click();
  await page.waitForFunction(() => ['complete', 'failed'].includes(document.body.dataset.phase ?? ''), undefined, { timeout: 60000 });
  output = await page.locator('#output').innerText();
  phase = await page.locator('body').getAttribute('data-phase');
  checks = await page.locator('#checks-count').innerText();
  restored = await page.locator('#world').getAttribute('data-restored');
  await page.screenshot({ path: join(directory, 'result.png'), fullPage: true });
  console.log(JSON.stringify({ delayed, delayMs, phase, checks, restored, output, requests, errors }, null, 2));
  assert(delayed, 'cold-start probe intercepted the actual sandbox worker');
  assert.equal(phase, 'complete', output);
  assert.equal(checks, '6/6 · 3 examples + 3 hidden');
  assert.equal(restored, 'true');
  assert.deepEqual(errors, []);
  console.log('PASS cold submission completes all six checks despite delayed sandbox download');
} finally {
  await writeFile(join(directory, 'result.json'), JSON.stringify({ delayed, delayMs, phase, checks, restored, output, requests, errors }, null, 2));
  await browser.close();
}
