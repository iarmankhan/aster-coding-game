import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { solution, starter, graph } from '../src/mission.ts';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = process.env.EVIDENCE_DIR || '/tmp/opencode/aster-ui-v3-evidence';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
const results: { name: string; detail: string }[] = [];
page.on('pageerror', (error: Error) => pageErrors.push(error.message));
page.on('console', (message: { type(): string; text(): string }) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
const url = process.env.APP_URL || 'http://127.0.0.1:5198';
const record = (name: string, detail = '') => { results.push({ name, detail }); console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`); };
const screenshot = async (name: string) => {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.waitForFunction(() => document.querySelector<HTMLElement>('#world')?.dataset.cameraMoving === 'false');
  return page.screenshot({ path: join(directory, name), fullPage: !name.includes('phone') });
};
const readSource = () => page.evaluate(() => localStorage.getItem('aster-route-ts-v1'));
const showCode = async () => { if (await page.locator('#editor').isHidden()) await page.locator('#view-code').click(); };
const focusEditor = () => page.locator('#editor .view-lines').click();
const edit = async (source: string) => {
  await showCode();
  await focusEditor();
  await page.keyboard.press('ControlOrMeta+a');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text: string) => navigator.clipboard.writeText(text), source);
  await page.keyboard.press('ControlOrMeta+v');
  assert.equal(await readSource(), source);
};
const run = async (phase: string) => {
  await page.locator('#run').click();
  await page.waitForFunction((phase: string) => document.body.dataset.phase === phase, phase, { timeout: 45000 });
};
const settings = async () => { if (!await page.locator('#settings').getAttribute('open').then((value: string | null) => value !== null)) await page.locator('#settings > summary').click(); };
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');

try {
  await page.goto(url);
  await page.locator('#start-coding:not([disabled])').waitFor();
  await page.locator('#world canvas').waitFor();
  const originalWorldCanvas = await page.locator('#world canvas').elementHandle();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('body').getAttribute('data-screen'), 'mission');
  assert(await page.locator('#editor').isHidden());
  assert(await page.locator('#run').isDisabled());
  assert(await page.locator('#brief-goal').isVisible());
  assert(await page.locator('#brief-contract').isVisible());
  assert(await page.locator('#brief-examples').isVisible());
  assert.match(await page.locator('#brief-contract').innerText(), /graph|Graph/);
  assert.match(await page.locator('#brief-examples').innerText(), /unreachable|no route|isolated/i);
  assert.deepEqual(JSON.parse(await page.locator('#graph-input').innerText()), graph);
  assert.deepEqual(JSON.parse(await page.locator('#world').getAttribute('data-route-trace')), ['dock']);
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('body').evaluate((element: Element) => getComputedStyle(element).fontSize), '16px');
  assert.match(await page.locator('body').evaluate((element: Element) => getComputedStyle(element).fontFamily), /Manrope/);
  const readingColors: { selector: string; foreground: string; background: string }[] = await page.evaluate(() =>
    ['.brief-content .story', '.brief-content .eyebrow', '.parameters dt > span', '.data-label'].map((selector) => ({
      selector,
      foreground: getComputedStyle(document.querySelector(selector)!).color,
      background: getComputedStyle(document.querySelector('.brief-panel')!).backgroundColor,
    })));
  const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const readingContrast = readingColors.map(({ selector, foreground, background }) => {
    const values = [luminance(foreground), luminance(background)];
    return { selector, ratio: (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05) };
  });
  assert(readingContrast.every(({ ratio }) => ratio >= 4.5), JSON.stringify(readingContrast));
  await screenshot('01-desktop-mission.png');
  await page.locator('.brief-panel').evaluate((element: HTMLElement) => {
    const examples = element.querySelector('#brief-examples')!;
    element.scrollTop += examples.getBoundingClientRect().top - element.getBoundingClientRect().top - 24;
  });
  await screenshot('02-desktop-examples-before-code.png');
  await page.locator('.locations-details > summary').click();
  await page.locator('[data-location="relay"]').click();
  assert.equal(await page.locator('body').getAttribute('data-screen'), 'mission');
  assert(await page.locator('#run').isDisabled());
  await page.locator('#inspection-close').click();
  await page.locator('.locations-details > summary').click();
  await page.locator('.brief-panel').evaluate((element: HTMLElement) => { element.scrollTop = 0; });
  record('mission goal, graph contract, actual input and examples precede editable code; no automatic flight');

  await page.locator('#start-coding-bottom').scrollIntoViewIfNeeded();
  await page.locator('#start-coding-bottom').click();
  assert.equal(await page.locator('body').getAttribute('data-view'), 'code');
  assert(await page.locator('.brief-panel').isVisible());
  assert(await page.locator('#editor').isVisible());
  assert(await page.locator('.world-panel').isHidden());
  assert(await page.evaluate(() => Boolean(document.activeElement?.closest('#editor'))));
  assert.match(await page.locator('#editor .view-lines').innerText(), /TODO/);
  assert.equal((await readSource()) ?? starter, starter);
  await page.locator('.brief-panel').evaluate((element: HTMLElement) => { element.scrollTop = 0; });
  await screenshot('03-desktop-code-and-brief.png');
  record('Start coding after the complete brief focuses TODO with persistent adjacent brief');

  await settings();
  await page.locator('#demo').click();
  assert.match(await page.locator('#modal').innerText(), /breadth-first search/);
  await page.getByRole('button', { name: 'Keep working', exact: true }).click();
  assert.equal((await readSource()) ?? starter, starter);
  await settings();
  await page.locator('#demo').click();
  await page.getByRole('button', { name: 'Insert demo solution', exact: true }).click();
  assert.equal(await readSource(), solution);
  await page.keyboard.press('ControlOrMeta+z');
  assert.equal(await readSource(), starter);
  await edit(solution);
  await settings();
  await page.locator('#reset-code').click();
  await page.getByRole('button', { name: 'Keep my code', exact: true }).click();
  assert.equal(await readSource(), solution);
  await settings();
  await page.locator('#reset-code').click();
  await page.getByRole('button', { name: 'Reset code', exact: true }).click();
  assert.equal(await readSource(), starter);
  await page.keyboard.press('ControlOrMeta+z');
  assert.equal(await readSource(), solution);
  record('demo and reset require confirmation; cancel preserves code; both replacements are undoable');

  const keyboardSource = 'function route(): string[] {\nreturn [];\n}';
  await edit(keyboardSource);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  assert.equal(await readSource(), keyboardSource.replace('\nreturn', '\n  return'));
  assert(await page.evaluate(() => Boolean(document.activeElement?.closest('#editor'))));
  await page.keyboard.press('Shift+Tab');
  assert.equal(await readSource(), keyboardSource);
  await page.keyboard.press('ControlOrMeta+z');
  assert.equal(await readSource(), keyboardSource.replace('\nreturn', '\n  return'));
  await page.keyboard.press('ControlOrMeta+f');
  await page.locator('#editor .find-widget.visible').waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+m');
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => !document.activeElement?.closest('#editor')));
  await focusEditor();
  await page.keyboard.press('Control+m');
  assert.equal(await page.locator('#editor .view-lines').evaluate((element: Element) => getComputedStyle(element).fontSize), '15px');
  assert.match(await page.locator('#editor .view-lines').evaluate((element: Element) => getComputedStyle(element).fontFamily), /JetBrains Mono/);
  record('real Tab, Shift+Tab, Undo, Find, focus escape, and 15px JetBrains Mono');

  const preserved = await readSource();
  await settings();
  await page.locator('#guide').click();
  assert(await page.locator('#editor').isHidden());
  assert(await page.locator('#run').isDisabled());
  await page.locator('#start-coding').click();
  await page.locator('#view-world').click();
  assert(await page.locator('#run').isVisible());
  assert(await page.locator('#output').isVisible());
  await page.locator('#view-code').click();
  assert.equal(await readSource(), preserved);
  assert(await originalWorldCanvas?.evaluate((canvas: Element) => canvas.isConnected && canvas === document.querySelector('#world canvas')));
  record('brief reopening and Code/World switches preserve source and keep run results available');

  await edit('const power: number = "not a number";\nfunction route(): string[] { return []; }');
  await run('failed');
  assert.match(await page.locator('#output').innerText(), /TypeScript error/);
  assert.match(await page.locator('#output').innerText(), /not assignable/);
  assert.equal(await page.locator('body').getAttribute('data-view'), 'code');
  assert.notEqual(await page.locator('#world').getAttribute('data-restored'), 'true');
  await screenshot('04-type-diagnostic.png');
  record('semantic TypeScript diagnostics prevent guest execution and keep code visible');

  await edit('function route( {');
  await run('failed');
  assert.match(await page.locator('#output').innerText(), /TypeScript/);
  await edit(starter);
  await run('failed');
  assert.match(await page.locator('#output').innerText(), /No working corridor/);
  record('syntax errors and original invalid fallback remain retryable');

  await edit('function route(): string[] { while (true) {} }');
  await run('failed');
  assert.match(await page.locator('#output').innerText(), /limit/);
  assert.equal(await page.locator('body').getAttribute('data-view'), 'code');
  await edit('function route(): string[] { return ["dock", "relay", "greenhouse"]; }');
  await run('failed');
  assert.match(await page.locator('#output').innerText(), /broken/);
  assert.deepEqual(JSON.parse(await page.locator('#world').getAttribute('data-route-trace')), ['dock', 'relay']);
  record('guest runtime limit and actual blocked-corridor prefix remain intact');

  await edit('function route(): string[] { return ["dock", "relay", "junction", "garden", "greenhouse"]; }');
  await run('failed');
  assert.match(await page.locator('#output').innerText(), /closed corridor/);
  assert.equal(await page.locator('body').getAttribute('data-view'), 'code');
  assert.notEqual(await page.locator('#world').getAttribute('data-restored'), 'true');
  await page.locator('#checks-open').click();
  assert.equal(await page.locator('.navigation-check').count(), 3);
  assert.equal(await page.locator('[data-check="detour"]').getAttribute('data-status'), 'failed');
  await page.locator('[data-check="detour"] summary').click();
  assert.match(await page.locator('[data-check="detour"] pre').innerText(), /observatory/);
  await screenshot('05-check-input-snapshot.png');
  await page.locator('#checks-close').click();
  record('three inspectable real check statuses reject memorized paths on changed inputs');

  await edit(solution);
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForFunction(() => document.body.dataset.phase === 'animating', undefined, { timeout: 45000 });
  assert.equal(await page.locator('body').getAttribute('data-view'), 'world');
  await page.locator('#run').click();
  assert.equal(await page.locator('body').getAttribute('data-phase'), 'ready');
  assert.equal(await readSource(), solution);
  record('Ctrl/Cmd+Enter starts actual world playback; Stop preserves source');

  await run('complete');
  const expected = ['dock', 'relay', 'junction', 'garden', 'greenhouse'];
  assert.deepEqual(JSON.parse(await page.locator('#world').getAttribute('data-route-trace')), expected);
  assert.equal(await page.locator('#world').getAttribute('data-restored'), 'true');
  assert.equal(await page.locator('#checks-count').innerText(), '3/3');
  await screenshot('06-world-restored.png');
  record('general BFS passes all three real checks and restores greenhouse');

  const depthFirst = `type Graph = Record<string, string[]>;
function route(graph: Graph, start: string, goal: string): string[] {
  const seen = new Set<string>();
  function visit(current: string, path: string[]): string[] {
    if (current === goal) return path;
    seen.add(current);
    for (const next of graph[current] ?? []) {
      if (!seen.has(next)) {
        const found = visit(next, [...path, next]);
        if (found.length) return found;
      }
    }
    return [];
  }
  console.log("navigation: depth-first search");
  return visit(start, [start]);
}`;
  await edit(depthFirst);
  await run('complete');
  assert.deepEqual(JSON.parse(await page.locator('#world').getAttribute('data-route-trace')), ['dock', 'relay', 'junction', 'observatory', 'garden', 'greenhouse']);
  await page.locator('#console-output summary').click();
  assert.match(await page.locator('#console-output').innerText(), /depth-first search/);
  record('different valid algorithm produces its own path and console logs');

  const visibleLabels = () => page.locator('.world-label[data-node-id]').evaluateAll((elements: Element[]) => elements.filter((element) => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.5;
  }).length);
  const contextualCount = await visibleLabels();
  await page.locator('#map-toggle').click();
  assert.equal(await visibleLabels(), 6);
  assert(contextualCount < 6);
  await page.locator('#map-toggle').click();
  await settings();
  await page.locator('#theme-dusk').click();
  assert.equal(await page.locator('body').getAttribute('data-lighting'), 'dusk');
  await page.locator('#theme-day').click();
  await page.locator('#settings > summary').click();
  await page.locator('#view-code').click();
  await page.locator('.locations-details > summary').click();
  await page.locator('[data-location="relay"]').click();
  assert.match(await page.locator('#inspection-name').innerText(), /Relay/);
  await page.locator('#inspection-close').click();
  await page.locator('#hint').click();
  assert(await page.locator('#hint-panel').isVisible());
  await page.locator('#hint-close').click();
  record('map labels, lighting, live graph location inspection, and optional hints work');

  await settings();
  await page.locator('#sound-toggle').click();
  await page.waitForFunction(() => document.querySelector('#sound-toggle')?.getAttribute('aria-pressed') === 'true');
  await page.locator('#sound-toggle').click();
  await page.waitForFunction(() => document.querySelector('#sound-toggle')?.getAttribute('aria-pressed') === 'false');
  await page.locator('#chapters-open').click();
  assert.equal(await page.locator('.planned-exercise').count(), 10);
  assert.equal(await page.locator('.planned-label').filter({ hasText: /^Planned$/ }).count(), 10);
  assert.match(await page.locator('#modal-body').innerText(), /not playable levels/);
  await page.locator('.planned-exercise > summary').first().click();
  assert.match(await page.locator('.planned-exercise').first().innerText(), /Function contract|Expected output/);
  assert.equal(await page.locator('.planned-exercise').first().locator('pre').count(), 3);
  await screenshot('07-ten-planned-missions.png');
  await page.locator('#modal-close').click();
  record('sound stays opt-in; ten planned exercise designs expose contracts and examples progressively');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.locator('#start-coding:not([disabled])').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert(await page.locator('#editor').isHidden());
  assert.equal(await readSource(), depthFirst);
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
  await noOverflow();
  await screenshot('08-phone-mission.png');
  await page.locator('#start-coding').click();
  assert(await page.locator('.brief-panel').isVisible());
  assert(await page.locator('#editor').isVisible());
  assert(await page.evaluate(() => document.querySelector('#editor')!.getBoundingClientRect().bottom <= document.querySelector('.run-panel')!.getBoundingClientRect().top + 1), 'phone editor stays above persistent controls');
  await noOverflow();
  await screenshot('09-phone-code-and-brief.png');
  await page.locator('#view-world').click();
  await noOverflow();
  await screenshot('10-phone-world.png');
  assert.equal(await readSource(), depthFirst);
  record('phone mission, persistent brief with editor, full world, and saved source survive reload');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  record('no uncaught page or console errors');
} finally {
  await writeFile(join(directory, 'browser-results.json'), JSON.stringify({ url, results, pageErrors, consoleErrors }, null, 2));
  await browser.close();
}
