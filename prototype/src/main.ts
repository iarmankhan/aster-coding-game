import { createWorld } from './world';
import { createAudio } from './audio';
import { nodes, edges, blockedEdge } from './mission';
import { missions as missionContent } from './missions';
import { missionCatalog, nextMission, previousMission } from './mission-catalog';
import { storyTitle, storyOpening, storyIntroActions, storyDebriefs, campaignStory } from './story';
import { campaignStorageKey, sourceStorageKeys, readCampaign, isUnlocked, completeMission, playableMissions, type MissionId } from './campaign';
import { executeMission } from './mission-runtime';
import { initialReports, type AttemptMode, type CaseReport, type CheckStatus } from './challenge';
import type { CodeEditor } from './editor';
import { escapeHTML, formatInline, formatParagraphs, formatCode as pre } from './brief-format';
import { createBriefResize } from './brief-resize';
import { createResultsResize } from './results-resize';
import './style.css';

type Screen = { kind: 'title' | 'home' | 'mission' } | { kind: 'intro'; beat: number } | { kind: 'workbench'; view: 'code' | 'world' };
type Phase = 'ready' | 'compiling' | 'executing' | 'animating' | 'failed' | 'complete';
type Attempt = { generation: number; mission: MissionId; source: string; mode: AttemptMode; controller: AbortController };
const missions = Object.fromEntries(playableMissions.map((id) => [id, {
  ...missionContent[id], ...missionCatalog[id], checks: initialReports(id),
}])) as Record<MissionId, typeof missionContent[MissionId] & typeof missionCatalog[MissionId] & { checks: CaseReport[] }>;
const ordinal = (id: MissionId, width = 2) => String(playableMissions.indexOf(id) + 1).padStart(width, '0');
const availability = (id: MissionId) => progress.completed.includes(id) ? 'Complete' : isUnlocked(progress, id) ? 'Available' : `Locked. Complete ${missionCatalog[previousMission(id)!].title}`;
let storageAvailable = true;
const storage = {
  read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { storageAvailable = false; return null; }
  },
  write(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { storageAvailable = false; }
    updateSaveStatus();
  },
};
let progress = readCampaign(storage.read(campaignStorageKey));
const sources = Object.fromEntries(playableMissions.map((id) => [id,
  storage.read(sourceStorageKeys[id]) ?? (id === 'first-light' ? storage.read('aster-route-v1') : null) ?? missions[id].starter,
])) as Record<MissionId, string>;
const state = {
  screen: { kind: 'title' } as Screen, mission: progress.currentMission, phase: 'ready' as Phase,
  generation: 0, attempt: null as Attempt | null, attempts: 0,
  hints: Object.fromEntries(playableMissions.map((id) => [id, 0])) as Record<MissionId, number>,
  theme: 'dusk' as 'day' | 'dusk', paused: false, mapVisible: false,
};
let editor: CodeEditor | undefined;
let switchingDocument = false;
let disposed = false;
let replayingStory = false;
let checkReports: CaseReport[] = [];
let reportOwner: Pick<Attempt, 'mission' | 'source' | 'mode'> | null = null;
const acceptedSources: Partial<Record<MissionId, string>> = {};
const feedbackAnimations = new Set<Animation>();
const feedbackMotion = matchMedia('(prefers-reduced-motion: reduce)');
let selectedCase = '';
const audio = createAudio();
const json = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const arrow = '<span aria-hidden="true">↗</span>';
function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
}

$('#app').innerHTML = `
  <header class="header">
    <button class="brand" id="title-open" aria-label="Aster title"><svg viewBox="0 0 30 32" aria-hidden="true"><path d="M15 2 27 9v14L15 30 3 23V9Z M3 9l12 7 12-7M15 16v14M15 2v14"/></svg>aster<span>.</span></button>
    <span class="header-crumb" id="header-crumb">Field terminal / Aster</span>
    <div id="header-views" hidden></div>
    <nav class="header-actions" aria-label="Primary"><button id="home-open">Field map</button><button id="chapters-open">Chapter log</button>
      <details class="settings" id="settings"><summary aria-label="Settings"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 7h8m5 0h5M3 17h3m5 0h10"/><circle cx="13.5" cy="7" r="2.5"/><circle cx="8.5" cy="17" r="2.5"/></svg><span>Settings</span></summary>
        <div class="settings-menu"><button id="guide">Read current mission brief</button><button id="story-replay">Replay opening story</button><button id="sound-toggle" aria-pressed="false">Sound off</button><fieldset><legend>Lighting</legend><div class="lighting-options"><button id="theme-day" aria-pressed="false">Day</button><button id="theme-dusk" aria-pressed="true">Dusk</button></div></fieldset><button id="pause-world" aria-pressed="false">Pause ambient motion</button><hr><button id="demo" disabled>Insert demo solution…</button><button id="reset-code" disabled>Reset current code…</button></div>
      </details>
    </nav>
  </header>
  <main id="main">
    <section class="landing-layout" id="landing">
      <div class="landing-copy" id="landing-copy"></div><div id="landing-world" class="world-slot"></div>
    </section>
    <section class="game-shell" id="game" hidden>
      <div class="workspace-toolbar"><div><span class="eyebrow" id="mission-system"></span><h1 id="mission-heading" tabindex="-1"></h1></div><div class="view-switch" role="group" aria-label="Workspace view"><button id="view-brief">Brief</button><button id="view-code">Code</button><button id="view-world">World</button></div></div>
      <div class="workspace">
        <aside class="brief-panel" id="brief-panel" aria-label="Complete mission brief"><div class="brief-content" id="brief-content"></div></aside>
        <div class="brief-resizer" id="brief-resizer" role="separator" tabindex="0" aria-label="Resize mission brief" aria-orientation="vertical" aria-controls="brief-panel" aria-valuemin="0" aria-valuemax="50" aria-valuenow="28" aria-valuetext="28% of workspace" title="Drag to resize brief. Left/Right 1%, Shift 5%. Home minimum, End 50%. Double-click to reset."></div>
        <section class="editor-panel" aria-label="Programming workbench" hidden><div class="editor-heading"><span class="file-tab"><b>TS</b> <span id="editor-file">route.ts</span></span><button id="editor-brief">mission.md</button><span class="language">TypeScript</span></div><div class="editor-breadcrumb" id="editor-breadcrumb"></div><div id="editor"><p id="editor-loading">Loading the TypeScript editor. You can read the full brief while it loads.</p></div><div class="editor-footer"><span id="editor-status">Preparing Monaco</span><span>UTF-8 · TypeScript</span></div></section>
        <div id="mission-world" class="world-slot"></div>
      </div>
      <section class="run-panel" aria-label="Simulation controls and results">
        <div id="results-resizer" role="separator" tabindex="0" aria-label="Resize results" aria-orientation="horizontal" aria-controls="test-results" title="Drag upward to grow results. Up/Down 1%, Shift 5%. Home minimum, End maximum. Double-click to reset."></div>
        <div class="run-top">
          <div class="output-panel" aria-live="polite"><span class="eyebrow" id="attempt-label">Terminal / local checks</span><div id="output" class="output-content ready"><strong>Read the brief. Make a plan.</strong></div></div>
          <div class="run-actions"><button id="output-toggle" aria-expanded="false" aria-controls="test-results">Results</button><button id="checks-open" class="secondary-button"><span id="checks-count">0/6 · 3 examples + 3 hidden</span></button><button id="hint">Hint</button><button class="secondary-button run-button" id="run" disabled><span>Run examples</span><kbd>Ctrl ↵</kbd></button><button class="primary-button run-button" id="submit" disabled><span>Submit solution</span><kbd>Ctrl ⇧ ↵</kbd></button></div>
        </div>
        <section id="test-results" aria-label="Test results"><div class="results-toolbar"><div id="case-list" role="group" aria-label="Choose a test case"></div><div class="results-size-actions"><button id="results-maximize" aria-pressed="false" aria-controls="test-results">Maximize</button><button id="results-reset">Reset size</button></div></div><div class="results-scroll" role="region" aria-label="Selected case and attempt details"><div id="attempt-feedback" hidden><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13"/><path class="feedback-check" d="m9 16 5 5 9-10"/><path class="feedback-repair" d="M16 8v10m0 5v1"/></svg><strong></strong></div><p id="attempt-message">Nothing runs until you ask.</p><pre id="result-output" hidden></pre><div id="case-feedback"></div><details id="console-output" hidden><summary>Selected example logs</summary><pre></pre></details>
        <div id="hint-panel" class="hint-panel" hidden><div><strong id="hint-number"></strong><button id="hint-close" aria-label="Close hint">×</button></div><p id="hint-text"></p></div>
        <article class="completion-card" id="completion" hidden tabindex="-1"><span class="eyebrow" id="debrief-speaker"></span><h2 id="debrief-title"></h2><p id="debrief-text"></p><button class="primary-button" id="next-mission"></button><button id="back-to-code" class="inline-button">Back to code ${arrow}</button></article>
        </div></section>
      </section>
    </section>
    <section class="world-panel" id="world-panel" aria-label="Aster settlement"><div id="world" role="img" aria-label="Interactive island. Drag to orbit and scroll to zoom. Named stations can also be inspected from the brief."></div><div class="world-caption"><span>Aster / coastal field station</span><span id="world-caption-state">First shift</span></div><div class="world-tools"><button id="map-toggle" aria-pressed="false">Map</button><button id="focus-landmark">Find greenhouse</button></div><div class="inspection" id="inspection" hidden><button id="inspection-close" class="close-button" aria-label="Close location details">×</button><strong id="inspection-name"></strong><p id="inspection-text"></p></div></section>
  </main>
  <footer class="terminal-footer"><span id="footer-location">aster / field-terminal</span><span id="save-status" role="status"></span></footer>
  <dialog id="checks-modal" aria-labelledby="checks-title"><div class="modal-top"><span class="eyebrow">Execution / examples and hidden cases</span><button id="checks-close" class="close-button" aria-label="Close checks">×</button></div><h2 id="checks-title"></h2><p id="checks-description"></p><div id="mission-checks"></div></dialog>
  <dialog id="modal" aria-labelledby="modal-title"><div class="modal-top"><span class="eyebrow" id="modal-eyebrow"></span><button id="modal-close" class="close-button" aria-label="Close dialog">×</button></div><h2 id="modal-title"></h2><div id="modal-body"></div><div id="modal-actions" class="actions"></div></dialog>
`;

$('#landing-world').append($('#world-panel'));
$('#header-views').append($('.view-switch'));
const briefResize = createBriefResize($('.workspace'), $('#brief-panel'), $('#brief-resizer'));
const resultsResize = createResultsResize($('#game'), $('.run-panel'), $('#results-resizer'));
const world = createWorld($('#world'), { nodes, edges, blockedEdge, onSelect: inspectLocation });
world.setTheme(state.theme);
document.body.dataset.lighting = state.theme;
const intakeLedger = document.createElement('details');
intakeLedger.id = 'intake-ledger';
intakeLedger.hidden = true;
intakeLedger.innerHTML = '<summary></summary><ol></ol>';
$('.results-scroll').append(intakeLedger);
$('.results-scroll').append(world.programReader);
const intakeObserver = new MutationObserver(() => {
  const trace = JSON.parse($('#world').dataset.intakeTrace || '[]') as { receiptId: string; decision: 'accepted' | 'duplicate'; units: number }[];
  intakeLedger.hidden = state.mission !== 'one-crate-one-receipt' || trace.length === 0;
  const accepted = trace.filter((row) => row.decision === 'accepted').length;
  $('summary', intakeLedger).textContent = `Receipt trace · ${accepted} accepted · ${trace.length - accepted} duplicate scans · ${$('#world').dataset.deliveredUnits || '0'} units stored`;
  const rows = trace.map((row) => {
    const item = document.createElement('li');
    item.textContent = `${row.receiptId} · ${row.units} ${row.units === 1 ? 'unit' : 'units'} · ${row.decision === 'accepted' ? 'accepted into storage' : 'duplicate scan ignored'}`;
    return item;
  });
  $('ol', intakeLedger).replaceChildren(...rows);
});
intakeObserver.observe($('#world'), { attributes: true, attributeFilter: ['data-intake-trace', 'data-delivered-units'] });

function updateSaveStatus(): void {
  const status = document.querySelector('#save-status');
  if (status) status.textContent = storageAvailable ? 'Code + progress saved on this device' : 'Session only · device storage unavailable';
}
function saveProgress(): void { storage.write(campaignStorageKey, JSON.stringify(progress)); }
function restoreWorld(reset = false): void {
  if (reset) world.reset();
  world.setMissionContext({ activeMission: state.mission, completed: progress.completed });
  world.setRestored(progress.completed.includes('first-light'));
  world.setSuppliesRestored(progress.completed.includes('one-crate-one-receipt'));
}
function busy(): boolean { return ['compiling', 'executing', 'animating'].includes(state.phase); }
function currentSourceAccepted(): boolean { return !!editor && acceptedSources[state.mission] === editor.getSource(); }
function reportsMatchSource(): boolean { return !!editor && reportOwner?.mission === state.mission && reportOwner.source === editor.getSource(); }
function stopFeedbackAnimations(): void {
  for (const animation of feedbackAnimations) animation.cancel();
  feedbackAnimations.clear();
}
feedbackMotion.addEventListener('change', stopFeedbackAnimations);
function clearFeedback(): void {
  stopFeedbackAnimations();
  $('#attempt-feedback').hidden = true;
}
function cueFeedback(kind: 'failure' | 'victory'): void {
  clearFeedback();
  const badge = $('#attempt-feedback');
  $(kind === 'victory' ? '#completion' : '.results-scroll').prepend(badge);
  badge.hidden = false;
  badge.dataset.feedback = kind;
  $('strong', badge).textContent = kind === 'victory' ? 'Mission restored' : 'Repair needed';
  if (feedbackMotion.matches) return;
  const target = kind === 'failure' ? $('#case-feedback') : $('#completion');
  for (const [element, frames] of [
    [badge, [{ opacity: .35, transform: 'scale(.96)' }, { opacity: 1, transform: 'scale(1)' }]],
    [target, [{ boxShadow: `inset 3px 0 ${kind === 'failure' ? '#ffaaa7' : '#e8bb7d'}`, backgroundColor: kind === 'failure' ? '#ffaaa714' : '#e8bb7d14' }, { boxShadow: 'inset 0 0 transparent', backgroundColor: 'transparent' }]],
  ] as [HTMLElement, Keyframe[]][]) {
    const animation = element.animate(frames, { duration: kind === 'victory' ? 420 : 300, easing: 'ease-out' });
    feedbackAnimations.add(animation);
    animation.onfinish = () => { feedbackAnimations.delete(animation); animation.cancel(); };
  }
}
function setPhase(phase: Phase): void {
  state.phase = phase;
  document.body.dataset.phase = phase;
  const running = busy();
  const workbench = state.screen.kind === 'workbench';
  for (const [id, mode, label, shortcut] of [['run', 'examples', 'Run examples', '↵'], ['submit', 'submit', 'Submit solution', '⇧ ↵']]) {
    const active = running && state.attempt?.mode === mode;
    $<HTMLButtonElement>(`#${id}`).disabled = !editor || !workbench || (running && !active);
    $(`#${id}`).setAttribute('aria-busy', String(active));
    $(`#${id}`).classList.toggle('is-running', active);
    $(`#${id} span`).textContent = active ? 'Stop' : label;
    $(`#${id} kbd`).textContent = active ? 'Esc' : `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} ${shortcut}`;
    const hidden = id === 'submit' && currentSourceAccepted() && !active;
    if (hidden && document.activeElement === $(`#${id}`)) $('#run').focus({ preventScroll: true });
    $(`#${id}`).hidden = hidden;
  }
  for (const id of ['demo', 'reset-code']) $<HTMLButtonElement>(`#${id}`).disabled = running || !editor || !workbench;
  $<HTMLButtonElement>('#pause-world').disabled = running;
  for (const id of ['start-coding', 'start-coding-bottom']) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`);
    if (button) { button.disabled = !editor; button.textContent = editor ? 'Start coding ↗' : 'Preparing editor…'; }
  }
}
function showOutput(kind: 'ready' | 'busy' | 'error' | 'success', title: string, message: string, result?: unknown): void {
  $('#output').className = `output-content ${kind}`;
  $('#output strong').textContent = title;
  $('#attempt-message').textContent = message;
  $('#result-output').hidden = result === undefined;
  $('#result-output').textContent = result === undefined ? '' : json(result);
  if (kind === 'error') setOutputExpanded(true);
}
function setOutputExpanded(expanded: boolean): void {
  resultsResize.setExpanded(expanded);
}
const statusLabel: Record<CheckStatus, string> = { pending: 'Not run', running: 'Running', passed: 'Passed', failed: 'Failed', 'not-run': 'Not run' };
function renderSelectedCase(): void {
  const report = checkReports.find((report) => report.id === selectedCase);
  if (!report) return;
  for (const button of document.querySelectorAll<HTMLElement>('[data-case]')) button.setAttribute('aria-pressed', String(button.dataset.case === selectedCase));
  $('#case-feedback').dataset.caseDetail = report.id;
  $('#case-feedback').dataset.status = report.status;
  $('#case-feedback').dataset.visibility = report.visibility;
  $('#case-feedback').innerHTML = report.visibility === 'hidden'
    ? `<p>${escapeHTML(report.title)} · ${statusLabel[report.status]}${report.category ? ` · ${report.category === 'runtime' ? 'Runtime failure' : 'Contract mismatch'}` : ''}. Input, expected output, actual output and logs are withheld.</p>`
    : `${report.diagnostic ? `<p class="case-diagnostic">${escapeHTML(report.diagnostic)}</p>` : `<p>${escapeHTML(report.detail)}</p>`}<dl class="case-values"><div data-case-field="input"><dt>Input</dt><dd>${pre(json(report.input))}</dd></div><div data-case-field="expected"><dt>Expected</dt><dd>${pre(json(report.expected))}</dd></div><div data-case-field="actual"><dt>Actual</dt><dd>${pre(report.status === 'failed' && report.category === 'runtime' ? 'Unavailable. The function did not produce a valid return value.' : report.status === 'passed' || report.status === 'failed' ? json(report.actual) : statusLabel[report.status])}</dd></div></dl>`;
  $('#console-output').hidden = report.visibility === 'hidden' || report.logs.length === 0;
  $('#console-output pre').textContent = report.visibility === 'public' ? report.logs.join('\n') : '';
}
function updateCheckSummary(): void {
  const passed = checkReports.filter((report) => report.status === 'passed').length;
  const notRun = checkReports.filter((report) => report.status === 'not-run').length;
  const counts = reportOwner?.mode === 'examples' ? `examples · ${currentSourceAccepted() ? 'source accepted' : `Submit ${missions[state.mission].checks.length} cases`}` : `3 examples + ${checkReports.length - 3} hidden`;
  $('#checks-count').textContent = `${passed}/${checkReports.length} · ${counts}${notRun ? ` · ${notRun} not run` : ''}`;
  $('#checks-open').setAttribute('aria-label', `Open test cases. ${$('#checks-count').textContent}`);
}
function setCheckStatus(report: CaseReport): void {
  const index = checkReports.findIndex((check) => check.id === report.id);
  if (index < 0) return;
  checkReports[index] = report;
  for (const element of document.querySelectorAll<HTMLElement>(`[data-check="${report.id}"], [data-case="${report.id}"]`)) {
    element.dataset.status = report.status;
    $('.check-status', element).textContent = statusLabel[report.status];
  }
  updateCheckSummary();
  if (selectedCase === report.id) renderSelectedCase();
}
function clearChecks(mode: AttemptMode = 'submit', owner: Attempt | null = null): void {
  reportOwner = owner ? { mission: owner.mission, source: owner.source, mode: owner.mode } : null;
  checkReports = initialReports(state.mission, mode);
  selectedCase = checkReports[0].id;
  $('#case-list').innerHTML = checkReports.map((report, index) => `<button data-case="${report.id}" data-status="pending" aria-pressed="${index === 0}" aria-controls="case-feedback">${report.visibility === 'public' ? `Example ${index + 1}` : escapeHTML(report.title)} <span class="check-status">Not run</span></button>`).join('');
  $('#mission-checks').innerHTML = checkReports.map((report) => `<article class="navigation-check" data-check="${report.id}" data-status="pending"><div><h3>${escapeHTML(report.title)}</h3><span class="check-status">Not run</span></div>${report.visibility === 'public' ? `<details><summary>Inspect example input and expected result</summary>${fixtureHTML(report)}</details>` : '<p>Additional contract case. Details withheld from the normal interface.</p>'}</article>`).join('');
  $('#checks-title').textContent = `${missions[state.mission].brief.title} / ${checkReports.length} ${mode === 'examples' ? 'examples' : 'submission cases'}`;
  updateCheckSummary();
  renderSelectedCase();
  $('.results-scroll').scrollTop = 0;
}
function cancelAttempt(message = 'Simulation stopped. Your code is unchanged.'): void {
  clearFeedback();
  const active = state.attempt !== null;
  state.generation++;
  state.attempt?.controller.abort();
  state.attempt = null;
  restoreWorld(true);
  if (active) {
    for (const report of checkReports) if (report.status === 'running' || report.status === 'pending') setCheckStatus({ ...report, status: 'not-run' });
    $('#console-output').hidden = true;
    $('#completion').hidden = true;
    setPhase('ready');
    showOutput('ready', 'Ready when you are.', message);
  }
}
function focusHeading(selector: string): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }));
}
function navigate(screen: Screen, focus = true): void {
  clearFeedback();
  const workspaceViewSwitch = state.screen.kind === 'workbench' && screen.kind === 'workbench';
  if (!workspaceViewSwitch) cancelAttempt();
  state.screen = screen;
  $<HTMLDetailsElement>('#settings').open = false;
  $('#inspection').hidden = true;
  const inMission = screen.kind === 'mission' || screen.kind === 'workbench';
  $('#header-views').hidden = !inMission;
  const code = screen.kind === 'workbench' && screen.view === 'code';
  const worldView = screen.kind === 'workbench' && screen.view === 'world';
  document.body.dataset.screen = screen.kind;
  document.body.dataset.view = code ? 'code' : worldView ? 'world' : 'brief';
  document.body.dataset.mission = state.mission;
  $('#landing').hidden = inMission;
  $('#game').hidden = !inMission;
  $('.brief-panel').hidden = worldView;
  $('.editor-panel').hidden = !code;
  $('#mission-world').hidden = code;
  $('#world-panel').hidden = code;
  briefResize.refresh();
  resultsResize.refresh();
  $(inMission ? '#mission-world' : '#landing-world').append($('#world-panel'));
  for (const view of ['brief', 'code', 'world']) $(`#view-${view}`).setAttribute('aria-pressed', String(view === document.body.dataset.view));
  $('#header-crumb').textContent = inMission ? `${ordinal(state.mission)} / ${missions[state.mission].brief.title}` : 'Field station';
  $('#footer-location').textContent = inMission ? `aster / ${missions[state.mission].system} / ${document.body.dataset.view}` : `aster / ${screen.kind}`;
  $('#world-caption-state').textContent = `${progress.completed.length} / ${playableMissions.length} services restored`;
  $('#completion').hidden = !progress.completed.includes(state.mission) || busy() || !inMission;
  world.setPresentation(screen.kind === 'title' ? 'title' : screen.kind === 'intro' ? 'tour' : 'work');
  restoreWorld();
  if (!inMission) renderLanding();
  setPhase(state.phase);
  requestAnimationFrame(() => editor?.layout());
  if (focus) { window.scrollTo(0, 0); focusHeading(inMission ? '#mission-heading' : '#landing-heading'); }
}

function renderLanding(): void {
  const screen = state.screen;
  if (screen.kind === 'title') {
    $('#landing-copy').innerHTML = `<span class="eyebrow cyan">Aster field station / Act 01</span><h1 class="title-heading" id="landing-heading" tabindex="-1">${escapeHTML(storyTitle.title)}<span>${escapeHTML(storyTitle.subtitle)}</span></h1><p class="landing-lead">${escapeHTML(storyTitle.description)}</p><p>Neri is waiting at the landing dock. Mara has kept your bench by the greenhouse window.</p><div class="actions"><button id="start-game" class="primary-button">${progress.introSeen ? `Resume ${escapeHTML(missions[progress.currentMission].brief.title)}` : escapeHTML(storyTitle.startLabel)} ${arrow}</button>${progress.introSeen ? '<button id="title-replay" class="inline-button">Replay opening story</button>' : ''}</div><div class="field-note"><span class="eyebrow">Your place on the station</span><p>${escapeHTML(campaignStory.playerRole)}</p></div>`;
    $('#start-game').addEventListener('click', () => progress.introSeen ? openMission(progress.currentMission, true) : beginStory(false));
    document.querySelector('#title-replay')?.addEventListener('click', () => beginStory(true));
    world.showOverview();
  } else if (screen.kind === 'intro') {
    const beat = storyOpening[screen.beat];
    $('#landing-copy').innerHTML = `<article class="transmission story-transmission"><span class="eyebrow amber">Incoming / ${String(screen.beat + 1).padStart(2, '0')} of ${String(storyOpening.length).padStart(2, '0')}</span><h1 id="landing-heading" tabindex="-1">${escapeHTML(beat.title)}</h1><p class="story-text">${escapeHTML(beat.text)}</p><div class="speaker"><span class="speaker-mark" aria-hidden="true">${escapeHTML(beat.speaker.slice(0, 1))}</span><div><strong>${escapeHTML(beat.speaker)}</strong><span>${escapeHTML(beat.role)}</span></div></div><div class="actions"><button id="story-next" class="primary-button">${escapeHTML(screen.beat === storyOpening.length - 1 ? storyIntroActions.finalLabel : storyIntroActions.nextLabel)} ${arrow}</button><button id="story-skip" class="inline-button">${escapeHTML(storyIntroActions.skipLabel)}</button></div></article>`;
    $('#story-next').addEventListener('click', () => screen.beat < storyOpening.length - 1 ? navigate({ kind: 'intro', beat: screen.beat + 1 }) : finishStory());
    $('#story-skip').addEventListener('click', finishStory);
    if (beat.focus === 'overview') world.showOverview(); else world.focusNode(beat.focus);
  } else if (screen.kind === 'home') {
    world.setMissionContext({ activeMission: state.mission, completed: progress.completed });
    const selected = state.mission;
    $('#landing-copy').innerHTML = `<span class="eyebrow cyan">Field terminal / mission network</span><h1 id="landing-heading" tabindex="-1">${progress.completed.length === playableMissions.length ? 'Ready for the next crossing.' : 'The next crossing'}</h1><p>${escapeHTML(campaignStory.premise)}</p><div class="actions"><button class="primary-button" id="home-resume">${selected === progress.currentMission ? 'Resume mission' : 'Read mission brief'} ${arrow}</button><button class="inline-button" id="home-log">All 11 chapters ${arrow}</button></div><div class="mission-network">${playableMissions.map((id, index) => `<button class="mission-row ${selected === id ? 'selected' : ''}" data-select-mission="${id}" ${!isUnlocked(progress, id) ? 'disabled' : ''} aria-pressed="${selected === id}"><span class="mission-number">${String(index + 1).padStart(2, '0')}</span><span><strong>${escapeHTML(missions[id].brief.title)}</strong><span class="mission-concept">${escapeHTML(missionCatalog[id].concept)}</span></span><span class="mission-status">${escapeHTML(availability(id))}</span></button>`).join('')}</div><div class="field-note"><span class="eyebrow amber">Selected / ${ordinal(selected)}</span><p>${escapeHTML(campaignStory.chapters.find((chapter) => chapter.id === selected)!.logline)}</p></div><p class="availability-note">${progress.completed.length} / 11 complete. Each service opens after the preceding mission is earned.</p>`;
    for (const button of document.querySelectorAll<HTMLElement>('[data-select-mission]')) button.addEventListener('click', () => {
      const id = button.dataset.selectMission as MissionId;
      if (!isUnlocked(progress, id)) return;
      state.mission = id;
      renderLanding();
      focusHeading('#home-resume');
    });
    $('#home-resume').addEventListener('click', () => openMission(selected, selected === progress.currentMission));
    $('#home-log').addEventListener('click', openChapterLog);
    world.showOverview();
  }
}
function beginStory(replay: boolean): void { replayingStory = replay; navigate({ kind: 'intro', beat: 0 }); }
function finishStory(): void {
  progress = { ...progress, introSeen: true };
  saveProgress();
  openMission(replayingStory ? progress.currentMission : 'first-light');
}
function fixtureHTML(check: Extract<CaseReport, { visibility: 'public' }>): string {
  return `${formatParagraphs(check.detail)}<span class="data-label">Input</span>${pre(json(check.input))}<span class="data-label">Expected result</span>${pre(json(check.expected))}`;
}
function renderBrief(): void {
  const mission = missions[state.mission];
  const brief = mission.brief;
  const examples = mission.checks.filter((check) => check.visibility === 'public');
  $('#mission-system').textContent = `Mission ${ordinal(state.mission)} / ${mission.system}`;
  $('#mission-heading').textContent = brief.title;
  $('#editor-file').textContent = mission.file;
  $('#editor-breadcrumb').textContent = `aster / systems / ${mission.system} / ${mission.file}`;
  $('#focus-landmark').textContent = `Find ${nodes.find((node) => node.id === mission.focus)!.label.toLowerCase()}`;
  $('#brief-content').innerHTML = `
    <span class="eyebrow cyan">Field order / ${ordinal(state.mission, 3)}</span>
    <h2 tabindex="-1" id="brief-title">${escapeHTML(brief.title)}</h2>
    <p class="mission-lead">${formatInline(brief.lead)}</p>
    <button class="primary-button brief-start" id="start-coding" disabled>Preparing editor…</button>
    <section id="brief-goal"><h2>Your goal</h2>${formatParagraphs(brief.objective)}<ul class="goal-steps">${brief.goalSteps.map((step) => `<li>${formatInline(step)}</li>`).join('')}</ul></section>
    <details class="brief-story"><summary>Why it matters</summary>${formatParagraphs(brief.story)}</details>
    <section id="brief-contract"><h2>Function contract</h2>${pre(brief.signature)}<dl class="parameters">${brief.parameters.map((parameter) => `<div><dt><code>${escapeHTML(parameter.name)}</code> <span>${escapeHTML(parameter.type)}</span></dt><dd>${formatParagraphs(parameter.description)}</dd></div>`).join('')}</dl></section>
    <section id="brief-input"><h2>The actual input</h2>${formatParagraphs(examples[0].detail)}${pre(json(examples[0].input))}<details class="locations-details"><summary>Inspect settlement landmarks</summary><div class="network-locations">${nodes.map((node) => `<button data-location="${node.id}" class="location-button"><span>${escapeHTML(node.label)}</span><code>${escapeHTML(node.id)}</code>${arrow}</button>`).join('')}</div></details></section>
    <section id="brief-examples"><h2>Examples</h2>${brief.examples.map((example) => `<article class="example"><h3>${formatInline(example.title)}</h3><span class="data-label">Input</span>${pre(example.input)}<span class="data-label">Output</span>${pre(example.output)}${formatParagraphs(example.explanation)}</article>`).join('')}</section>
    <section id="brief-acceptance"><h2>Acceptance criteria</h2><ul>${brief.rules.map((rule) => `<li>${formatParagraphs(rule)}</li>`).join('')}</ul><p>Run the 3 examples to debug. Submit all ${mission.checks.length} cases, including ${mission.checks.length - 3} additional hidden cases, to earn progress. Only the first public example's actual validated result plays in the world after a passing submission.</p><button class="inline-button" id="brief-checks">Open live check results ${arrow}</button></section>
    <section id="brief-fixtures"><h2>Runnable example datasets</h2>${examples.map((check) => `<details class="fixture"><summary>${formatInline(check.title)}</summary>${fixtureHTML(check)}</details>`).join('')}<p>Additional hidden cases use only the stated contract. Hidden means withheld from the normal interface, not secret from DevTools in this local browser prototype. There is no competitive server judge or leaderboard.</p></section>
    <button class="primary-button brief-start" id="start-coding-bottom" disabled>Preparing editor…</button>`;
  $('#checks-description').textContent = 'Each case calls your compiled function in a fresh isolated runtime. Run examples checks the 3 displayed examples. Submit solution also checks additional hidden contract cases. Results reflect actual execution; not-run cases did not finish.';
  clearChecks();
  for (const id of ['start-coding', 'start-coding-bottom']) $(`#${id}`).addEventListener('click', startCoding);
  $('#brief-checks').addEventListener('click', openChecks);
  $('.network-locations').addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-location]') : null;
    if (!target?.dataset.location) return;
    navigate({ kind: 'workbench', view: 'world' });
    world.focusNode(target.dataset.location);
    inspectLocation(target.dataset.location);
  });
  $('#hint-panel').hidden = true;
}
function openMission(id: MissionId, resume = false): void {
  if (!isUnlocked(progress, id)) return;
  if (!progress.introSeen) { beginStory(false); return; }
  cancelAttempt();
  state.mission = id;
  progress = { ...progress, currentMission: id };
  saveProgress();
  switchingDocument = true;
  try { editor?.setDocument(id, sources[id]); } finally { switchingDocument = false; }
  state.attempts = 0;
  $('#attempt-label').textContent = 'Terminal / local checks';
  setPhase('ready');
  renderBrief();
  $('#console-output').hidden = true;
  setOutputExpanded(false);
  showOutput('ready', '3 examples to explore. Submit to earn progress.', `Read the full brief, then edit ${missions[id].file}. Submission runs 3 examples + ${missions[id].checks.length - 3} hidden contract cases.`);
  if (progress.completed.includes(id)) { setPhase('complete'); renderDebrief(id, true); }
  navigate(resume && editor ? { kind: 'workbench', view: 'code' } : { kind: 'mission' });
}
function startCoding(): void {
  if (!editor) return;
  navigate({ kind: 'workbench', view: 'code' }, false);
  requestAnimationFrame(() => editor?.focusTodo());
  if (window.matchMedia('(max-width: 760px)').matches) $('.editor-panel').scrollIntoView({ block: 'start' });
}
function inspectLocation(id: string): void {
  const node = nodes.find((node) => node.id === id);
  if (!node) return;
  $('#inspection-name').textContent = node.label;
  const services = playableMissions.filter((mission) => missionCatalog[mission].focus === id);
  $('#inspection-text').textContent = services.map((mission) => `${missionCatalog[mission].problem}. ${availability(mission)}${mission === state.mission ? '. Current mission' : ''}.`).join(' ');
  $('#inspection').hidden = false;
  audio.cue('select');
}
function isCurrent(attempt: Attempt): boolean {
  return !disposed && state.attempt === attempt && state.generation === attempt.generation && state.mission === attempt.mission && !attempt.controller.signal.aborted && editor?.getSource() === attempt.source;
}
async function run(mode: AttemptMode = 'examples'): Promise<void> {
  if (state.screen.kind !== 'workbench' || !editor) return;
  if (busy()) { if (state.attempt?.mode === mode) cancelAttempt(); return; }
  if (mode === 'submit' && currentSourceAccepted()) return;
  cancelAttempt();
  const attempt: Attempt = { generation: ++state.generation, mission: state.mission, source: editor.getSource(), mode, controller: new AbortController() };
  state.attempt = attempt;
  clearChecks(mode, attempt);
  $('#console-output').hidden = true;
  $('#console-output pre').textContent = '';
  $('#completion').hidden = true;
  setOutputExpanded(mode === 'examples');
  $('#inspection').hidden = true;
  $('#attempt-label').textContent = `Terminal / attempt ${++state.attempts}`;
  if (state.paused) {
    state.paused = false;
    world.setPaused(false);
    $('#pause-world').setAttribute('aria-pressed', 'false');
    $('#pause-world').textContent = 'Pause ambient motion';
  }
  world.showOverview();
  setPhase('compiling');
  audio.cue('run');
  showOutput('busy', 'Checking and compiling TypeScript.', 'Stop remains available. Editing cancels this attempt immediately.');
  try {
    const compiled = await editor.compile();
    if (!isCurrent(attempt)) return;
    if (compiled.source !== attempt.source) { cancelAttempt('Code changed during compilation. Run your current version when ready.'); return; }
    if (!compiled.ok) {
      state.attempt = null;
      setPhase('failed');
      navigate({ kind: 'workbench', view: 'code' }, false);
      const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      showOutput('error', 'TypeScript needs a repair.', errors.length ? errors.map((diagnostic) => `Line ${diagnostic.line}:${diagnostic.column} · ${diagnostic.message}`).join('\n') : 'Compilation produced no executable program. Review the editor diagnostics, then run again.');
      audio.cue('error');
      cueFeedback('failure');
      return;
    }
    setPhase('executing');
    showOutput('busy', mode === 'examples' ? 'Running 3 examples.' : `Submitting ${checkReports.length} cases.`, 'Each case uses a fresh isolated runtime. Results arrive as each case finishes.');
    const result = await executeMission(attempt.mission, compiled.javascript, {
      mode,
      signal: attempt.controller.signal,
      onCheck(report) { if (isCurrent(attempt)) setCheckStatus(report); },
    });
    if (!isCurrent(attempt)) return;
    if (!result.ok) {
      selectedCase = result.checkId ?? checkReports.find((report) => report.status === 'not-run')?.id ?? selectedCase;
      renderSelectedCase();
      state.attempt = null;
      restoreWorld(true);
      setPhase('failed');
      navigate({ kind: 'workbench', view: 'code' }, false);
      const passed = checkReports.filter((report) => report.status === 'passed').length;
      showOutput('error', `${passed}/${checkReports.length} ${mode === 'examples' ? 'examples' : 'submission cases'} passed.`, `${result.checkId ? 'Select a case to inspect its result. Repair your function, then try again.' : result.error}${result.attemptError && result.attemptError !== result.error ? `\nAttempt stopped. ${result.attemptError}` : ''}`);
      audio.cue('error');
      cueFeedback('failure');
      return;
    }
    if (result.missionId !== attempt.mission || checkReports.length !== initialReports(attempt.mission, mode).length || checkReports.some((report) => report.status !== 'passed')) {
      throw new Error('The runtime did not confirm every fixture for this mission. No progression was granted.');
    }
    if (result.mode === 'examples') {
      state.attempt = null;
      setPhase('ready');
      setOutputExpanded(true);
      showOutput('success', currentSourceAccepted() ? '3/3 examples passed. Source already accepted.' : '3/3 examples passed. Submit solution to continue.', currentSourceAccepted()
        ? 'This exact source was accepted this session. These are example results, not a new submission. Continue when ready.'
        : 'Examples do not earn progress or animate the world. Submit solution checks the additional hidden cases too.');
      $('#completion').hidden = !progress.completed.includes(state.mission);
      return;
    }
    if ($('#world').dataset.renderer === 'unavailable') {
      throw new Error('All submission cases passed, but world playback is unavailable. Enable WebGL, reload, then submit again to earn progress. Your code is kept.');
    }
    setPhase('animating');
    navigate({ kind: 'workbench', view: 'world' }, false);
    showOutput('busy', `${missionCatalog[result.missionId].playbackLabel}.`, 'All checks passed. Progress is earned after this playback finishes.', result.missionId === 'first-light' ? result.route : result.missionId === 'one-crate-one-receipt' ? { accepted: result.accepted } : result.canonical.output);
    const finish = (): void => {
      if (!isCurrent(attempt)) return;
      progress = completeMission(progress, attempt.mission);
      acceptedSources[attempt.mission] = attempt.source;
      saveProgress();
      state.attempt = null;
      restoreWorld();
      setPhase('complete');
      renderDebrief(attempt.mission);
      $('#completion').hidden = false;
      setOutputExpanded(true);
      $('#world-caption-state').textContent = `${progress.completed.length} / ${playableMissions.length} services restored`;
      world.focusNode(missions[attempt.mission].focus);
      audio.cue('success');
      cueFeedback('victory');
      focusHeading('#completion');
      requestAnimationFrame(() => {
        if (state.phase === 'complete' && state.mission === attempt.mission) $('#completion').scrollIntoView({ block: 'nearest' });
      });
    };
    if (result.missionId === 'first-light') world.playRoute(result.route, { success: true, onComplete: finish });
    else if (result.missionId === 'one-crate-one-receipt') world.playDeliveries(result.deliveries, result.accepted, { onComplete: finish });
    else world.playProgram(result.canonical, { onComplete: finish, signal: attempt.controller.signal });
  } catch (error) {
    if (!isCurrent(attempt)) return;
    for (const report of checkReports) if (report.status === 'running' || report.status === 'pending') setCheckStatus({ ...report, status: 'not-run' });
    state.attempt = null;
    restoreWorld(true);
    setPhase('failed');
    navigate({ kind: 'workbench', view: 'code' }, false);
    showOutput('error', 'This attempt could not finish.', error instanceof Error ? error.message : String(error));
    audio.cue('error');
    cueFeedback('failure');
  }
}
function renderDebrief(mission: MissionId, fromSave = false): void {
  const debrief = storyDebriefs[mission];
  $('#debrief-speaker').textContent = `${debrief.speaker} / field transmission`;
  $('#debrief-title').textContent = debrief.title;
  $('#debrief-text').textContent = debrief.text;
  $('#next-mission').textContent = `${debrief.nextLabel} ↗`;
  showOutput(fromSave && !currentSourceAccepted() ? 'ready' : 'success', fromSave ? currentSourceAccepted() ? 'Source accepted earlier this session. Cases not rerun.' : 'Previously completed. Current code unchecked.' : debrief.title, fromSave
    ? currentSourceAccepted() ? `This exact source already earned completion. Cases have not been rerun. ${debrief.nextLabel}.`
      : `Completion earned in a previous run. Current code is unchecked. ${debrief.nextLabel}, or run examples and submit again.`
    : reportsMatchSource() && reportOwner?.mode === 'submit' && checkReports.length > 0 && checkReports.every((report) => report.status === 'passed')
      ? `${checkReports.length}/${checkReports.length} submission cases passed. ${debrief.nextLabel}.`
      : `Source accepted this session. Cases have not been rerun. ${debrief.nextLabel}.`);
}
function continueCampaign(): void {
  if (busy() || !progress.completed.includes(state.mission)) return;
  const next = nextMission(state.mission);
  if (next) openMission(next);
  else { navigate({ kind: 'home' }); openChapterLog(); }
}

type ModalAction = { label: string; primary?: boolean; run?: () => void };
function openModal(eyebrow: string, title: string, body: string, actions: ModalAction[]): void {
  $<HTMLDetailsElement>('#settings').open = false;
  $('#modal-eyebrow').textContent = eyebrow;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  $('#modal-actions').replaceChildren();
  for (const action of actions) {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.className = action.primary ? 'primary-button' : 'secondary-button';
    button.addEventListener('click', () => { $<HTMLDialogElement>('#modal').close(); action.run?.(); });
    $('#modal-actions').append(button);
  }
  $<HTMLDialogElement>('#modal').showModal();
}
function openChapterLog(): void {
  cancelAttempt('Simulation cancelled while opening the chapter log. Your code is saved.');
  openModal('Station archive / first act', campaignStory.title,
    `<p>${escapeHTML(campaignStory.tagline)}</p><p>Eleven playable missions. Each next service requires actual completion of its predecessor.</p><div class="log-playable">${playableMissions.map((id) => `<article><span class="eyebrow cyan">${ordinal(id)} / ${escapeHTML(availability(id))}</span><h3>${escapeHTML(missions[id].brief.title)}</h3><p>${escapeHTML(campaignStory.chapters.find((chapter) => chapter.id === id)!.logline)}</p>${isUnlocked(progress, id) ? `<button class="secondary-button" data-log-mission="${id}">Read mission brief ${arrow}</button>` : ''}</article>`).join('')}</div>`, [{ label: 'Return to field terminal', primary: true }]);
  for (const button of document.querySelectorAll<HTMLElement>('[data-log-mission]')) button.addEventListener('click', () => {
    $<HTMLDialogElement>('#modal').close();
    openMission(button.dataset.logMission as MissionId);
  });
}
function openChecks(): void { $<HTMLDialogElement>('#checks-modal').showModal(); }
function confirmReplace(demo: boolean): void {
  if (!editor || busy()) return;
  const mission = state.mission;
  const content = missions[mission];
  openModal(demo ? 'Optional working example' : 'Fresh source', `${demo ? 'Insert demo for' : 'Reset'} ${content.brief.title}?`,
    `<p>This replaces only <code>${content.file}</code> for ${escapeHTML(content.brief.title)}. Monaco Undo can recover the previous source. Earned progress is retained.</p><p>${demo ? 'The example does not run automatically. Run examples to explore, then Submit solution to earn progress. A hint is available if you would rather keep solving.' : 'The original starter deliberately does not pass the mission. Your other mission source remains untouched.'}</p>`,
    [{ label: 'Keep my code' }, { label: demo ? 'Insert demo solution' : 'Reset this mission code', primary: true, run() {
      if (!editor || state.mission !== mission || busy()) return;
      cancelAttempt();
      navigate({ kind: 'workbench', view: 'code' }, false);
      editor.replaceSource(demo ? content.solution : content.starter);
      editor.focus();
    } }]);
}

$('#title-open').addEventListener('click', () => navigate({ kind: 'title' }));
$('#home-open').addEventListener('click', () => navigate({ kind: 'home' }));
$('#chapters-open').addEventListener('click', openChapterLog);
$('#story-replay').addEventListener('click', () => beginStory(true));
$('#guide').addEventListener('click', () => openMission(progress.currentMission));
$('#view-brief').addEventListener('click', () => navigate({ kind: 'mission' }));
$('#editor-brief').addEventListener('click', () => navigate({ kind: 'mission' }));
$('#view-code').addEventListener('click', () => { if (editor) { navigate({ kind: 'workbench', view: 'code' }, false); requestAnimationFrame(() => editor?.focus()); } });
$('#view-world').addEventListener('click', () => navigate({ kind: 'workbench', view: 'world' }));
$('#run').addEventListener('click', () => { void run(); });
$('#submit').addEventListener('click', () => { void run('submit'); });
$('#case-list').addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-case]') : null;
  if (!button?.dataset.case) return;
  selectedCase = button.dataset.case;
  renderSelectedCase();
  $('.results-scroll').scrollTop = 0;
});
$('#checks-open').addEventListener('click', openChecks);
$('#demo').addEventListener('click', () => confirmReplace(true));
$('#reset-code').addEventListener('click', () => confirmReplace(false));
$('#next-mission').addEventListener('click', continueCampaign);
$('#output-toggle').addEventListener('click', () => resultsResize.toggle());
$('#back-to-code').addEventListener('click', () => { navigate({ kind: 'workbench', view: 'code' }, false); editor?.focus(); });
$('#hint').addEventListener('click', () => {
  setOutputExpanded(true);
  const available = missions[state.mission].hints;
  const index = Math.min(state.hints[state.mission]++, available.length - 1);
  $('#hint-panel').hidden = false;
  $('#hint-number').textContent = `Hint ${index + 1} of ${available.length} / ${missions[state.mission].brief.title}`;
  $('#hint-text').innerHTML = formatInline(available[index]);
});
$('#hint-close').addEventListener('click', () => { $('#hint-panel').hidden = true; });
$('#inspection-close').addEventListener('click', () => { $('#inspection').hidden = true; });
$('#map-toggle').addEventListener('click', () => {
  state.mapVisible = !state.mapVisible;
  world.setMapVisible(state.mapVisible);
  $('#map-toggle').setAttribute('aria-pressed', String(state.mapVisible));
});
$('#focus-landmark').addEventListener('click', () => { const id = missions[state.mission].focus; world.focusNode(id); inspectLocation(id); });
$('#sound-toggle').addEventListener('click', async () => {
  const actual = await audio.setEnabled($('#sound-toggle').getAttribute('aria-pressed') !== 'true');
  $('#sound-toggle').setAttribute('aria-pressed', String(actual));
  $('#sound-toggle').textContent = `Sound ${actual ? 'on' : 'off'}`;
});
for (const theme of ['day', 'dusk'] as const) $(`#theme-${theme}`).addEventListener('click', () => {
  state.theme = theme;
  world.setTheme(theme);
  document.body.dataset.lighting = theme;
  for (const name of ['day', 'dusk']) $(`#theme-${name}`).setAttribute('aria-pressed', String(name === theme));
});
$('#pause-world').addEventListener('click', () => {
  state.paused = !state.paused;
  world.setPaused(state.paused);
  $('#pause-world').setAttribute('aria-pressed', String(state.paused));
  $('#pause-world').textContent = state.paused ? 'Resume ambient motion' : 'Pause ambient motion';
});
for (const [dialogId, closeId] of [['modal', 'modal-close'], ['checks-modal', 'checks-close']]) {
  const dialog = $<HTMLDialogElement>(`#${dialogId}`);
  $(`#${closeId}`).addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}
document.addEventListener('click', (event) => { if (event.target instanceof Node && !$('#settings').contains(event.target)) $<HTMLDetailsElement>('#settings').open = false; });
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter' && event.target instanceof Element && event.target.closest('#editor') && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    event.stopPropagation();
    void run('submit');
  }
}, { capture: true });
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') { $<HTMLDetailsElement>('#settings').open = false; if (busy()) cancelAttempt(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !(event.target instanceof Element && event.target.closest('#editor'))) { event.preventDefault(); void run(event.shiftKey ? 'submit' : 'examples'); }
});

renderBrief();
navigate({ kind: 'title' }, false);
updateSaveStatus();
void (async () => {
  try {
    const { createCodeEditor } = await import('./editor');
    if (disposed) return;
    const created = await createCodeEditor($('#editor'), {
      source: sources['first-light'], onRun: () => { void run(); },
      onChange(source) {
        if (switchingDocument || disposed) return;
        clearFeedback();
        sources[state.mission] = source;
        storage.write(sourceStorageKeys[state.mission], source);
        if (state.attempt) cancelAttempt('Code changed. Previous attempt cancelled; run the current version when ready.');
        else {
          setPhase('ready');
          $('#completion').hidden = true;
          $('#console-output').hidden = true;
          showOutput('ready', 'Source updated.', 'Run the current version when you are ready. Earned station repairs are retained.');
        }
        clearChecks();
        if (currentSourceAccepted()) {
          showOutput('ready', 'Source accepted earlier this session. Cases not rerun.', 'Undo restored your accepted source. Latest case results were cleared; run examples to inspect it again, or continue.');
          $('#completion').hidden = false;
        }
        setOutputExpanded(false);
      },
    });
    if (disposed) { created.dispose(); return; }
    editor = created;
    switchingDocument = true;
    try { editor.setDocument(state.mission, sources[state.mission]); } finally { switchingDocument = false; }
    $('#editor-loading').remove();
    $('#editor-status').textContent = 'Monaco / local module';
    setPhase(state.phase);
    editor.layout();
  } catch (error) {
    if (disposed) return;
    $('#editor-loading').textContent = `Editor unavailable. ${error instanceof Error ? error.message : String(error)} Your saved code has not been replaced. Refresh to retry.`;
    $('#editor-status').textContent = 'Editor unavailable';
  }
})();
window.addEventListener('pagehide', () => {
  disposed = true;
  state.generation++;
  state.attempt?.controller.abort();
  state.attempt = null;
  intakeObserver.disconnect();
  briefResize.dispose();
  resultsResize.dispose();
  clearFeedback();
  feedbackMotion.removeEventListener('change', stopFeedbackAnimations);
  world.dispose();
  editor?.dispose();
  audio.dispose();
}, { once: true });
