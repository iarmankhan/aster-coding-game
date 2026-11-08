import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.RUNTIME_URL || 'http://127.0.0.1:5279/research/runtime-fixture.html';
const evidence = 'research/evidence/browser';
await mkdir(evidence, {recursive: true});
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const records = [], errors = [], contexts = [];
async function context() {
  const ctx = await browser.newContext({viewport: {width: 1440, height: 1000}});
  contexts.push(ctx);
  await ctx.route('**/favicon.ico', (route) => route.fulfill({status: 204, body: ''}));
  await ctx.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.workerEvidence = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        const record = {url: String(url), messages: [], received: [], terminated: 0};
        window.workerEvidence.push(record);
        this.record = record;
        this.requests = new Map();
        this.addEventListener('message', ({data}) => {
          record.received.push({type: data?.type, attempt: data?.attempt, fixtureIndex: data?.fixtureIndex});
          if (data?.seq && this.requests.get(data.seq) === 'getEmitOutput' && window.onEmitReplyOnce) {
            const callback = window.onEmitReplyOnce; window.onEmitReplyOnce = null; callback();
          }
        });
      }
      postMessage(data, ...rest) {
        if (data?.type === 'batch') this.record.messages.push({type: data.type, attempt: data.attempt, entry: data.entry, fixtures: data.fixtures.length});
        const method = data?.method === '$fmr' ? data.args?.[0] : data?.method;
        if (method && data.req) this.requests.set(data.req, method);
        const delay = window.rpcDelays?.[method];
        if (delay) {
          delete window.rpcDelays[method];
          setTimeout(() => super.postMessage(data, ...rest), delay);
          return;
        }
        return super.postMessage(data, ...rest);
      }
      terminate() { this.record.terminated++; return super.terminate(); }
    };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {if (message.type() === 'error') errors.push(message.text());});
  return {ctx, page};
}
const evaluate = (page, action, value) => page.evaluate(action, value);
async function test(name, action) {
  const details = await action();
  records.push({name, ok: true, details});
  console.log(`PASS ${name}`);
}
try {
  const {page} = await context();
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.screenshot({path: `${evidence}/editor.png`, fullPage: true});
  await test('Monaco emits checked JavaScript and three actual route fixtures execute in one worker', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime, compilation = await r.editor.compile();
      const result = await r.run();
      return {compilation, result, valid: result.results.map((item, i) => item.ok && r.checkNavigation(r.navigationChecks[i], item.value).ok), workers: window.workerEvidence};
    });
    assert.equal(value.compilation.ok, true);
    assert.equal(value.compilation.source.includes('type Graph'), true);
    assert.equal(value.compilation.javascript.includes('type Graph'), false);
    assert.equal(value.result.ok, true);
    assert.deepEqual(value.valid, [true, true, true]);
    assert.deepEqual(value.result.results[0].value, ['dock', 'relay', 'junction', 'garden', 'greenhouse']);
    const used = value.workers.filter((worker) => worker.messages.length);
    assert.equal(used.length, 1); assert.equal(used[0].messages[0].fixtures, 3);
    assert.equal(used[0].terminated, 1);
    return {route: value.result.results[0].value, checked: 3, executionWorkers: used.length};
  });
  await test('both mission models keep independent undo, selections, filenames, and silent switches', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime;
      const first = r.editor.getSource();
      r.editor.replaceSource(first + '\n// first edit');
      r.view().setSelection(new r.monaco.Range(2, 2, 3, 4));
      let count = r.changes.length;
      r.editor.setDocument('one-crate-one-receipt', r.deliveryMission.solution);
      const silent1 = r.changes.length === count;
      const filename2 = r.view().getModel().uri.path;
      const aria2 = r.view().getOption(r.monaco.editor.EditorOption.ariaLabel);
      r.editor.replaceSource(r.deliveryMission.solution + '\n// second edit');
      r.view().trigger('test', 'undo', null);
      const secondUndo = r.editor.getSource() === r.deliveryMission.solution;
      count = r.changes.length;
      r.editor.setDocument('first-light', 'ignored seed for existing document');
      const silent2 = r.changes.length === count;
      const selection = r.view().getSelection();
      const firstStillEdited = r.editor.getSource() === first + '\n// first edit';
      const aria1 = r.view().getOption(r.monaco.editor.EditorOption.ariaLabel);
      r.view().trigger('test', 'undo', null);
      return {silent1, silent2, firstStillEdited, secondUndo, firstUndo: r.editor.getSource() === first, filename2, aria1, aria2, selection};
    });
    for (const key of ['silent1','silent2','firstStillEdited','secondUndo','firstUndo']) assert.equal(value[key], true, key);
    assert.match(value.filename2, /acceptDeliveries\.ts$/);
    assert.match(value.aria2, /acceptDeliveries\.ts/); assert.match(value.aria1, /route\.ts/);
    assert.equal(value.selection.startLineNumber, 2); assert.equal(value.selection.startColumn, 2);
    return value;
  });
  await test('real Monaco blocks semantic, syntax, ambient host APIs, and module imports without sandbox execution', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime, results = [];
      const before = window.workerEvidence.reduce((n, w) => n + w.messages.length, 0);
      for (const source of [
        'const wrong: string = 7; function route(): string[] { return [wrong]; }',
        'const broken: = 3; function route() { return []; }',
        'function route() { return [document.title]; }',
        'function route() { fetch("https://example.invalid"); return []; }',
        'function route() { return [process.version]; }',
        'import {readFileSync} from "node:fs"; function route() { return [readFileSync("x", "utf8")]; }',
      ]) {
        r.editor.replaceSource(source);
        const compiled = await r.run();
        results.push({ok: compiled.ok, javascript: Object.hasOwn(compiled, 'javascript'), diagnostics: compiled.diagnostics});
      }
      return {results, before, after: window.workerEvidence.reduce((n, w) => n + w.messages.length, 0)};
    });
    assert.equal(value.before, value.after);
    for (const item of value.results) {assert.equal(item.ok, false); assert.equal(item.javascript, false); assert.ok(item.diagnostics.some((diagnostic) => diagnostic.severity === 'error'));}
    return {blocked: value.results.length, sandboxBatches: value.after - value.before};
  });
  await test('edit-and-undo and document switch-back invalidate captured compilation', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime;
      r.editor.replaceSource(r.solution);
      const pending = r.editor.compile().then(() => 'WRONGLY ACCEPTED', (error) => error.message);
      r.editor.replaceSource(r.solution + '\n');
      r.view().trigger('test', 'undo', null);
      const undoError = await pending;
      const switching = r.editor.compile().then(() => 'WRONGLY ACCEPTED', (error) => error.message);
      r.editor.setDocument('one-crate-one-receipt', r.deliveryMission.solution);
      r.editor.setDocument('first-light', r.solution);
      return {undoError, switchError: await switching, sourceSame: r.editor.getSource() === r.solution};
    });
    assert.match(value.undoError, /Source changed.*Run again/); assert.match(value.switchError, /Source changed.*Run again/); assert.equal(value.sourceSame, true);
    return value;
  });
  await test('edit-and-undo at actual Monaco emit reply rejects stale executable output', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime;
      r.editor.replaceSource(r.solution);
      let replySeen = false;
      window.onEmitReplyOnce = () => {
        replySeen = true;
        r.editor.replaceSource(r.solution + '\n// changed at emit reply');
        r.view().trigger('test', 'undo', null);
      };
      const error = await r.editor.compile().then(() => 'WRONGLY ACCEPTED', (error) => error.message);
      window.onEmitReplyOnce = null;
      return {replySeen, error, sourceSame: r.editor.getSource() === r.solution};
    });
    assert.equal(value.replySeen, true); assert.equal(value.sourceSame, true); assert.match(value.error, /Source changed.*Run again/);
    return value;
  });
  await test('diagnostics plus emission share one 15-second service deadline and never send code after timeout', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime;
      r.editor.replaceSource(r.solution);
      const before = window.workerEvidence.reduce((n,w) => n+w.messages.length, 0);
      window.rpcDelays = {getSemanticDiagnostics: 9000, getEmitOutput: 6500};
      const error = await r.run().then(() => 'WRONGLY ACCEPTED', (error) => error.message);
      const allDelaysUsed = Object.keys(window.rpcDelays).length === 0;
      window.rpcDelays = null;
      await new Promise((resolve) => setTimeout(resolve, 800));
      return {error, allDelaysUsed, before, after: window.workerEvidence.reduce((n,w) => n+w.messages.length, 0)};
    });
    assert.equal(value.allDelaysUsed, true); assert.match(value.error, /language service timed out/); assert.equal(value.before, value.after);
    return {combinedDeadlineMs: 15000, stagesDelayedMs: [9000,6500], noExecution: true};
  });
  await test('inactive mission globals and conflicting type names cannot contaminate checks', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime;
      r.editor.replaceSource('type Delivery = number; const secretFromRoute = 7; ' + r.solution);
      r.editor.setDocument('one-crate-one-receipt', r.deliveryMission.solution);
      r.editor.replaceSource(r.deliveryMission.solution);
      const valid = await r.editor.compile();
      r.editor.replaceSource(r.deliveryMission.solution + '\nconsole.log(secretFromRoute);');
      const leaked = await r.editor.compile();
      r.editor.replaceSource(r.deliveryMission.solution);
      return {valid, leaked};
    });
    assert.equal(value.valid.ok, true, JSON.stringify(value.valid));
    assert.equal(value.leaked.ok, false); assert.ok(value.leaked.diagnostics.some((item) => /secretFromRoute/.test(item.message)));
    return {independentTypes: value.valid.ok, foreignGlobalRejected: !value.leaked.ok};
  });
  await test('actual M2 solution and starter compile and execute all five disclosed fixtures through same worker core', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime, fixtures = r.deliveryMission.checks.map((check) => ({id: check.id, args: check.args}));
      r.editor.replaceSource(r.deliveryMission.solution);
      const solution = await r.run('acceptDeliveries', fixtures);
      const valid = solution.results.map((item, index) => item.ok && r.validateDeliveries(item.value, r.deliveryMission.checks[index]).ok);
      r.editor.replaceSource(r.deliveryMission.starter);
      const starter = await r.run('acceptDeliveries', fixtures);
      const starterValid = starter.results.map((item, index) => item.ok && r.validateDeliveries(item.value, r.deliveryMission.checks[index]).ok);
      return {solution, valid, starter, starterValid};
    });
    assert.equal(value.solution.ok, true); assert.equal(value.starter.ok, true);
    assert.deepEqual(value.valid, [true,true,true,true,true]);
    assert.deepEqual(value.starterValid, [false,false,false,false,true]);
    return {accepted: value.solution.results[0].value, validated: value.valid, starterValidated: value.starterValid};
  });
  await test('real-browser generics, lexical functions, and enum output remain executable', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime;
      r.editor.setDocument('first-light', r.solution);
      r.editor.replaceSource('interface Pair<T> {left: T; right: T} enum NodeId {Start="dock", End="greenhouse"} const route = (): string[] => { const p: Pair<string> = {left: NodeId.Start, right: NodeId.End}; return [p.left,p.right]; };');
      return r.run('route', [{id: 'emit', args: [{}, 'dock', 'greenhouse']}]);
    });
    assert.equal(value.ok, true); assert.deepEqual(value.results[0].value, ['dock','greenhouse']);
    return value;
  });
  await test('real-browser source and compiled output limits prevent execution', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime;
      r.editor.replaceSource(' '.repeat(65537));
      const source = await r.editor.compile();
      r.editor.replaceSource(Array.from({length:1500}, (_, i) => `enum E${i} { A, B, C, D }`).join('\n'));
      const expanded = await r.editor.compile().then((result) => result, (error) => error.message);
      return {source, expanded};
    });
    assert.equal(value.source.ok, false); assert.match(value.source.diagnostics[0].message, /65,536/); assert.match(value.expanded, /262,144/);
    return {sourceBlocked: true, expandedBlocked: true};
  });
  await test('real-browser object tampering, mutation, hostile getters, and fresh fixture globals', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime;
      r.editor.setDocument('one-crate-one-receipt', r.deliveryMission.solution);
      const fixture = [{id:'manifest', args:r.deliveryMission.checks[0].args}];
      const cases = [
        'function acceptDeliveries(deliveries: {receiptId:string;item:string;units:number}[], seen:string[]) { try {deliveries[0].units = 7;} catch {} return {deliveries: [], seen: []}; }',
        'function acceptDeliveries() { return {get deliveries(): never[] {while(true){}}, seen: []}; }',
        'function acceptDeliveries() { throw {get message(): string {while(true){}}}; }',
      ];
      const results = [];
      for (const source of cases) {r.editor.replaceSource(source); results.push(await r.run('acceptDeliveries', fixture));}
      r.editor.replaceSource('Object.prototype.toJSON = function() {return {deliveries: [], seen: []}}; ' + r.deliveryMission.solution);
      const prototypeDiagnostic = await r.editor.compile();
      const compiledSolution = (() => {r.editor.replaceSource(r.deliveryMission.solution); return r.editor.compile();})();
      const good = await compiledSolution;
      const tampered = await r.executeBatch('Object.prototype.toJSON = () => ({deliveries: [], seen: []}); Array.prototype.toJSON = () => []; JSON.stringify = () => "forged";\n' + good.javascript, 'acceptDeliveries', fixture, {signal: new AbortController().signal});
      const isolated = await r.executeBatch('globalThis.count = (globalThis.count || 0) + 1; function route() {return [String(globalThis.count)]}', 'route', Array.from({length:3}, (_,i) => ({id:String(i), args:[{},'A','D']})), {signal: new AbortController().signal});
      return {results, prototypeDiagnostic: prototypeDiagnostic.ok, tampered, isolated};
    });
    assert.equal(value.results[0].ok, false); assert.match(value.results[0].error, /read-only/);
    for (const item of value.results.slice(1)) {assert.equal(item.ok, false); assert.match(item.error, /400 ms/);}
    assert.equal(value.prototypeDiagnostic, false, 'normal browser semantic checks reject invalid prototype typing');
    assert.equal(value.tampered.ok, true);
    assert.deepEqual(value.tampered.results[0].value.seen, ['old','r1','r2']);
    assert.equal(value.isolated.ok, true); assert.deepEqual(value.isolated.results.map((item) => item.value), [['1'],['1'],['1']]);
    return {mutation: value.results[0].error, getters: value.results.slice(1).map((item) => item.error), isolated: value.isolated.results};
  });
  await test('real-browser stop before compilation completes sends no user code', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime;
      r.editor.setDocument('first-light', r.solution); r.editor.replaceSource(r.solution);
      const before = window.workerEvidence.reduce((n,w) => n+w.messages.length,0);
      const pending = r.run(); r.stop();
      const result = await pending;
      return {result, before, after: window.workerEvidence.reduce((n,w) => n+w.messages.length,0)};
    });
    assert.equal(value.result.ok, false); assert.match(value.result.error, /cancelled/); assert.equal(value.before, value.after);
    return {cancelled: true, sent: value.after - value.before};
  });
  await test('real-browser abort during execution and between fixtures terminates active worker', async () => {
    const value = await evaluate(page, async () => {
      const r = window.runtime;
      const fixtures = Array.from({length:3}, (_,i) => ({id:String(i),args:[{},'A','D']}));
      const controller = new AbortController();
      const running = r.executeBatch('function route(){while(true){}}', 'route', fixtures, {signal: controller.signal, onFixture: (_i,status) => {if(status === 'running') controller.abort();}});
      const result1 = await running;
      const c2 = new AbortController();
      const result2 = await r.executeBatch('function route(){return []}', 'route', fixtures, {signal:c2.signal,onFixture:(_i,status)=>{if(status==='complete') c2.abort();}});
      return {result1, result2, workers:window.workerEvidence.filter((w)=>w.messages.length).slice(-2)};
    });
    for(const item of [value.result1,value.result2]) {assert.equal(item.ok,false);assert.match(item.error,/cancelled/);}
    assert.equal(value.result2.results.length,1);
    assert.ok(value.workers.every((w)=>w.terminated===1));
    return {duringExecution:value.result1.error,betweenFixtures:value.result2.error,prefix:value.result2.results.length};
  });
  await test('Monaco retains Tab, Shift+Tab, Ctrl+M escape, undo, and run keybinding', async () => {
    await evaluate(page, () => {
      const r=window.runtime; r.editor.replaceSource('function route(): string[] {\nreturn [];\n}');
      r.view().setPosition({lineNumber:2,column:1});r.editor.focus();
    });
    await page.keyboard.press('Tab');
    assert.equal(await evaluate(page,()=>window.runtime.editor.getSource().split('\n')[1]),'  return [];');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await evaluate(page,()=>window.runtime.editor.getSource().split('\n')[1]),'return [];');
    await page.keyboard.press('Control+m');
    await page.keyboard.press('Tab');
    assert.equal(await evaluate(page,()=>!!document.activeElement?.closest('.monaco-editor')),false);
    await evaluate(page,()=>{window.runtime.editor.focus();window.runtime.view().trigger('test','editor.action.toggleTabFocusMode',null);});
    const before=await evaluate(page,()=>window.workerEvidence.reduce((n,w)=>n+w.messages.length,0));
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction((n)=>window.workerEvidence.reduce((sum,w)=>sum+w.messages.length,0)>n,before);
    await page.waitForFunction(()=>window.workerEvidence.filter((w)=>w.messages.length).at(-1).terminated===1);
    return {tabIndents:true,shiftTabOutdents:true,ctrlMReleasesFocus:true,ctrlEnterRuns:true};
  });
  await test('page disposal terminates all idle and active workers', async () => {
    const value=await evaluate(page,()=>{const r=window.runtime;r.disposeRunner();r.editor.dispose();return window.workerEvidence;});
    assert.ok(value.filter((w)=>/runner\.worker/.test(w.url)).every((w)=>w.terminated===1));
    return {executionWorkers:value.filter((w)=>/runner\.worker/.test(w.url)).length,allTerminated:true};
  });

  const slow = await context();
  let intercepted = false;
  await slow.ctx.route('**/assets/runner.worker-*.js', async (route) => {
    if (!intercepted) {intercepted=true; await new Promise((resolve)=>setTimeout(resolve,7500));}
    await route.continue().catch(()=>{});
  });
  await test('real production worker readiness delayed beyond six seconds still runs within 30-second boot budget', async () => {
    await slow.page.goto(url);await slow.page.waitForFunction(()=>document.body.dataset.ready==='true');
    const result=await evaluate(slow.page,()=>window.runtime.run());
    assert.equal(intercepted,true);assert.equal(result.ok,true);assert.equal(result.results.length,3);
    return {delayMs:7500,fixtures:3,ok:true};
  });
  await evaluate(slow.page,()=>window.runtime.disposeRunner());
  const aborted=await context();
  let release;
  const gate=new Promise((resolve)=>{release=resolve;});
  await aborted.ctx.route('**/assets/runner.worker-*.js',async(route)=>{await gate;await route.continue().catch(()=>{});});
  await test('real browser abort during worker download sends no code and terminates boot immediately',async()=>{
    await aborted.page.goto(url);await aborted.page.waitForFunction(()=>document.body.dataset.ready==='true');
    const value=await evaluate(aborted.page,async()=>{
      const r=window.runtime,c=new AbortController();
      const pending=r.executeBatch('function route(){return []}','route',[{id:'x',args:[{},'A','D']}],{signal:c.signal});
      c.abort();const result=await pending;r.disposeRunner();
      return {result,workers:window.workerEvidence.filter((w)=>/runner\.worker/.test(w.url))};
    });
    release();
    assert.equal(value.result.ok,false);assert.match(value.result.error,/cancelled/);
    assert.ok(value.workers.every((w)=>w.messages.length===0&&w.terminated===1));
    return {cancelled:true,codeSent:false,allBootsTerminated:true};
  });
  const graph=JSON.parse(await readFile('research/evidence/runtime-production/runtime-worker-import-graph.json','utf8'));
  assert.ok(graph.modules.every((id)=>!/(?:typescript|monaco-editor|runner-node-adapter)/.test(id)));
  assert.deepEqual(errors,[]);
  await writeFile(`${evidence}/result.json`,JSON.stringify({ok:true,records,errors,executionWorkerImportGraph:graph},null,2));
  console.log(`Real-browser runtime checks passed (${records.length}). Zero page/console errors. No full-shell latency claim.`);
} catch(error) {
  await writeFile(`${evidence}/result.json`,JSON.stringify({ok:false,records,errors,error:String(error)},null,2));
  throw error;
} finally {for(const ctx of contexts) await ctx.close();await browser.close();}
