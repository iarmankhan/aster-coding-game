const preferenceKey = 'aster-results-ratio-v1';
const defaultFraction = .45;
type ResultsMode = 'collapsed' | 'expanded' | 'maximized';
type Geometry = { height: number; width: number; chrome: number };

export function parseResultsFraction(value: string | null): number | null {
  try {
    const fraction: unknown = JSON.parse(value ?? 'null');
    return typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0 && fraction <= 1 ? fraction : null;
  } catch { return null; }
}

export function resultsBounds(available: number, chrome: number): { min: number; max: number } {
  const height = Math.max(0, available);
  const min = Math.min(height, Math.max(0, chrome) + 160);
  return { min, max: Math.max(min, height - 200) };
}

export function clampResultsHeight(height: number, available: number, chrome: number): number {
  const bounds = resultsBounds(available, chrome);
  return Math.min(bounds.max, Math.max(bounds.min, height));
}

export function createResultsResize(shell: HTMLElement, panel: HTMLElement, separator: HTMLElement): {
  setExpanded: (expanded: boolean) => void; toggle: () => void; refresh: () => void; dispose: () => void;
} {
  const workspace = shell.querySelector<HTMLElement>('.workspace')!;
  const top = panel.querySelector<HTMLElement>('.run-top')!;
  const toolbar = panel.querySelector<HTMLElement>('.results-toolbar')!;
  const results = panel.querySelector<HTMLElement>('#test-results')!;
  const toggle = panel.querySelector<HTMLButtonElement>('#output-toggle')!;
  const maximize = panel.querySelector<HTMLButtonElement>('#results-maximize')!;
  const reset = panel.querySelector<HTMLButtonElement>('#results-reset')!;
  const reader = panel.querySelector<HTMLElement>('.results-scroll')!;
  const phone = matchMedia('(max-width: 760px)');
  const listeners = new AbortController();
  let mode: ResultsMode = 'collapsed';
  let preferredFraction: number | null = null;
  let drag: { pointerId: number; y: number; height: number; geometry: Geometry; previous: number | null } | null = null;
  let frame = 0;
  let disposed = false;
  try { preferredFraction = parseResultsFraction(localStorage.getItem(preferenceKey)); } catch {}

  function geometry(): Geometry {
    const rect = shell.getBoundingClientRect();
    const verticalSpace = (element: HTMLElement, properties: string[]): number => {
      const style = getComputedStyle(element);
      return properties.reduce((sum, property) => sum + (parseFloat(style.getPropertyValue(property)) || 0), 0);
    };
    return { height: phone.matches ? window.visualViewport?.height ?? window.innerHeight : rect.height, width: rect.width,
      chrome: top.getBoundingClientRect().height + toolbar.getBoundingClientRect().height + separator.getBoundingClientRect().height
        + verticalSpace(panel, ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'])
        + verticalSpace(results, ['margin-top', 'border-top-width']) };
  }
  function available(): boolean { return !phone.matches && mode === 'expanded' && shell.getClientRects().length > 0; }
  function sameGeometry(previous: Geometry): boolean {
    const current = geometry();
    return current.height === previous.height && current.width === previous.width && current.chrome === previous.chrome;
  }
  function draw(): void {
    if (disposed) return;
    document.body.dataset.outputExpanded = String(mode !== 'collapsed');
    document.body.dataset.resultsMode = mode;
    toggle.setAttribute('aria-expanded', String(mode !== 'collapsed'));
    maximize.textContent = mode === 'maximized' ? 'Restore' : 'Maximize';
    maximize.setAttribute('aria-pressed', String(mode === 'maximized'));
    workspace.inert = mode === 'maximized' && !phone.matches;
    const geo = geometry();
    const height = mode === 'maximized' ? geo.height : clampResultsHeight((preferredFraction ?? defaultFraction) * geo.height, geo.height, geo.chrome);
    const value = `${height}px`;
    if (panel.style.getPropertyValue('--results-height') !== value) panel.style.setProperty('--results-height', value);
    const offset = `${top.getBoundingClientRect().height}px`;
    if (panel.style.getPropertyValue('--results-top-height') !== offset) panel.style.setProperty('--results-top-height', offset);
    const bounds = resultsBounds(geo.height, geo.chrome);
    const percent = (value: number): string => String(Number((geo.height > 0 ? value / geo.height * 100 : 0).toFixed(1)));
    separator.setAttribute('aria-valuemin', percent(bounds.min));
    separator.setAttribute('aria-valuemax', percent(bounds.max));
    separator.setAttribute('aria-valuenow', percent(height));
    separator.setAttribute('aria-valuetext', `${Math.round(height)} pixels, ${percent(height)}% of workspace`);
  }
  function save(): void {
    try {
      if (preferredFraction === null) localStorage.removeItem(preferenceKey);
      else localStorage.setItem(preferenceKey, String(preferredFraction));
    } catch {}
  }
  function finish(commit: boolean): void {
    const active = drag;
    if (!active) return;
    drag = null;
    document.body.classList.remove('results-resizing');
    if (!commit) preferredFraction = active.previous;
    if (separator.hasPointerCapture(active.pointerId)) separator.releasePointerCapture(active.pointerId);
    draw();
    if (commit) save();
  }
  function changeMode(next: ResultsMode): void {
    finish(false);
    if (next === 'collapsed' && (results.contains(document.activeElement) || separator === document.activeElement)) toggle.focus({ preventScroll: true });
    if (next === 'maximized' && !phone.matches && workspace.contains(document.activeElement)) maximize.focus({ preventScroll: true });
    mode = next;
    draw();
    if (phone.matches && next === 'maximized') panel.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function resetSize(): void { finish(false); preferredFraction = null; changeMode('expanded'); save(); }
  function refresh(): void { finish(false); if (mode === 'maximized') mode = 'expanded'; draw(); }
  const on = <K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void): void => {
    separator.addEventListener(type, listener, { signal: listeners.signal });
  };
  on('pointerdown', (event) => {
    if (!available() || event.button !== 0 || !event.isPrimary || drag) return;
    event.preventDefault();
    separator.focus({ preventScroll: true });
    separator.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, y: event.clientY, height: panel.getBoundingClientRect().height, geometry: geometry(), previous: preferredFraction };
    document.body.classList.add('results-resizing');
  });
  on('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!available() || !sameGeometry(drag.geometry)) { finish(false); return; }
    preferredFraction = clampResultsHeight(drag.height + drag.y - event.clientY, drag.geometry.height, drag.geometry.chrome) / drag.geometry.height;
    draw();
  });
  on('pointerup', (event) => { if (drag?.pointerId === event.pointerId) finish(available() && sameGeometry(drag.geometry)); });
  on('pointercancel', (event) => { if (drag?.pointerId === event.pointerId) finish(false); });
  on('lostpointercapture', (event) => { if (drag?.pointerId === event.pointerId) finish(false); });
  on('dblclick', (event) => { if (available()) { event.preventDefault(); resetSize(); } });
  on('keydown', (event) => {
    if (!available() || event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    finish(false);
    const geo = geometry();
    const bounds = resultsBounds(geo.height, geo.chrome);
    const step = geo.height * (event.shiftKey ? .05 : .01);
    const height = event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : panel.getBoundingClientRect().height + (event.key === 'ArrowUp' ? step : -step);
    preferredFraction = clampResultsHeight(height, geo.height, geo.chrome) / geo.height;
    draw();
    save();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopImmediatePropagation(); finish(false); }
  }, { capture: true, signal: listeners.signal });
  maximize.addEventListener('click', () => changeMode(mode === 'maximized' ? 'expanded' : 'maximized'), { signal: listeners.signal });
  reset.addEventListener('click', resetSize, { signal: listeners.signal });
  const resize = (): void => {
    if (drag && (!available() || !sameGeometry(drag.geometry))) finish(false);
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
  };
  phone.addEventListener('change', () => { finish(false); if (phone.matches && document.activeElement === separator) toggle.focus({ preventScroll: true }); draw(); }, { signal: listeners.signal });
  window.addEventListener('resize', resize, { signal: listeners.signal });
  window.visualViewport?.addEventListener('resize', resize, { signal: listeners.signal });
  const observer = new ResizeObserver(resize);
  for (const element of [shell, top, toolbar]) observer.observe(element);
  reader.tabIndex = 0;
  draw();
  return { setExpanded(expanded) { if (expanded && mode !== 'collapsed') { draw(); return; } changeMode(expanded ? 'expanded' : 'collapsed'); },
    toggle() { changeMode(mode === 'collapsed' ? 'expanded' : 'collapsed'); }, refresh,
    dispose() { finish(false); disposed = true; cancelAnimationFrame(frame); listeners.abort(); observer.disconnect(); workspace.inert = false; } };
}
