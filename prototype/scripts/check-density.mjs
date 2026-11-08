import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const output = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-v4/dense-ui';
await mkdir(output, { recursive: true });
const server = process.env.APP_URL ? null : await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server?.listen();
const url = process.env.APP_URL || server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['laptop', 1280, 800], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    const capture = async (screen) => {
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => ({
        headerHeight: document.querySelector('.header').getBoundingClientRect().height,
        editorTop: document.querySelector('#editor').getBoundingClientRect().top,
        runHeight: document.querySelector('.run-panel').getBoundingClientRect().height,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        bodyFont: getComputedStyle(document.body).fontSize,
        smallTargets: [...document.querySelectorAll('button, summary')].filter((element) => element.checkVisibility() && !element.closest('#editor') && element.getBoundingClientRect().height < (innerWidth <= 760 ? 43.9 : 31.9)).map((element) => element.id || element.textContent.trim()),
      }));
      assert(metrics.scrollWidth <= width, `${name}/${screen} horizontal overflow`);
      assert.deepEqual(metrics.smallTargets, [], `${name}/${screen} controls too small`);
      assert.equal(metrics.bodyFont, '16px');
      if (screen === 'code' && width > 760) {
        assert(metrics.headerHeight <= 56, 'one compact desktop header');
        assert(metrics.editorTop <= 100, 'code starts within first 100px, not below stacked banners');
        assert(metrics.runHeight <= 64, 'default terminal is a compact status/action strip');
      }
      await page.screenshot({ path: `${output}/${name}-${screen}.png`, fullPage: true });
      results.push({ device: name, screen, ...metrics });
    };
    await page.goto(url);
    await page.locator('#start-game').waitFor();
    await capture('title');
    await page.locator('#start-game').click();
    await capture('story');
    await page.locator('#story-skip').click();
    await capture('brief');
    await page.locator('#start-coding:not([disabled])').waitFor();
    await page.locator('#start-coding').click();
    await capture('code');
    await page.locator('#output-toggle').click();
    assert.equal(await page.locator('#output-toggle').getAttribute('aria-expanded'), 'true');
    assert(await page.locator('#attempt-message').isVisible());
    await page.locator('#output-toggle').click();
    assert(await page.locator('#attempt-message').isHidden());
    await page.locator('#view-world').click();
    await capture('world');
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ scope: 'Actual renderer/editor and density checks. Not mission-execution acceptance.', url, results }, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: results.length, results: results.filter((item) => item.screen === 'code') }, null, 2));
} finally {
  await browser.close();
  await server?.close();
}
