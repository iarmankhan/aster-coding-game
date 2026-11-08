import * as monaco from 'monaco-editor/editor/editor.api';
import { createCodeEditor } from '../src/editor';
import { executeBatch, prepareRunner, disposeRunner } from '../src/runner';
import type { RunnerEntry, RunnerFixture } from '../src/runner';
import { solution, navigationChecks, checkNavigation } from '../src/mission';
import { deliveryMission, validateDeliveries } from '../src/delivery-mission';

const output = document.querySelector<HTMLPreElement>('#output')!;
const changes: string[] = [];
let controller = new AbortController();
const editor = await createCodeEditor(document.querySelector<HTMLElement>('#editor')!, {
  source: solution, onChange(source) { changes.push(source); controller.abort(); }, onRun() { void run(); },
});
prepareRunner();
async function run(entry: RunnerEntry = 'route', fixtures: RunnerFixture[] = navigationChecks.map((check) => ({id: check.id, args: [check.network, 'dock', 'greenhouse']}))) {
  controller.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const compilation = await editor.compile();
  if (!compilation.ok) return compilation;
  const result = await executeBatch(compilation.javascript, entry, fixtures, {signal});
  output.textContent = JSON.stringify(result, null, 2);
  return result;
}
const api = {
  editor, monaco, changes, solution, navigationChecks, checkNavigation, deliveryMission, validateDeliveries,
  run, executeBatch, prepareRunner, disposeRunner,
  stop: () => controller.abort(),
  view: () => monaco.editor.getEditors()[0],
};
Object.assign(window, {runtime: api});
document.querySelector('#run')!.addEventListener('click', () => {void run();});
document.querySelector('#stop')!.addEventListener('click', () => controller.abort());
window.addEventListener('pagehide', () => {controller.abort(); disposeRunner(); editor.dispose();}, {once: true});
document.body.dataset.ready = 'true';
