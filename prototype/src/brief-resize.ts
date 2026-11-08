const preferenceKey = 'aster-brief-ratio-v1';

export function parseBriefFraction(value: string | null): number | null {
  try {
    const fraction: unknown = JSON.parse(value ?? 'null');
    return typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0 && fraction <= 1 ? fraction : null;
  } catch { return null; }
}

export function clampBriefWidth(width: number, workspaceWidth: number): number {
  return Math.min(workspaceWidth * .5, Math.max(310, width));
}

export function createBriefResize(workspace: HTMLElement, sidebar: HTMLElement, separator: HTMLElement): { refresh: () => void; dispose: () => void } {
  let preferredFraction: number | null = null;
  let activeDrag: { pointerId: number; startX: number; startWidth: number; workspaceWidth: number; previousFraction: number | null } | null = null;
  try { preferredFraction = parseBriefFraction(localStorage.getItem(preferenceKey)); } catch { /* Layout storage is independent of saved code. */ }
  const desktop = matchMedia('(min-width: 761px)');
  const listeners = new AbortController();
  const available = (): boolean => desktop.matches && separator.getClientRects().length > 0 && sidebar.getClientRects().length > 0 && workspace.getBoundingClientRect().width > 0;

  function draw(): void {
    if (!available()) return;
    const width = workspace.getBoundingClientRect().width;
    if (preferredFraction === null) workspace.style.removeProperty('--brief-width');
    else workspace.style.setProperty('--brief-width', `${clampBriefWidth(preferredFraction * width, width)}px`);
    const percent = sidebar.getBoundingClientRect().width / width * 100;
    separator.setAttribute('aria-valuemin', String(Number(Math.min(310 / width * 100, 50).toFixed(1))));
    separator.setAttribute('aria-valuemax', '50');
    separator.setAttribute('aria-valuenow', String(Number(percent.toFixed(1))));
    separator.setAttribute('aria-valuetext', `${Math.round(percent)}% of workspace`);
  }
  function save(): void {
    try {
      if (preferredFraction === null) localStorage.removeItem(preferenceKey);
      else localStorage.setItem(preferenceKey, String(preferredFraction));
    } catch { /* A blocked layout preference must not change code-save status. */ }
  }
  function finish(commit: boolean): void {
    const drag = activeDrag;
    if (!drag) return;
    activeDrag = null;
    document.body.classList.remove('brief-resizing');
    if (!commit) preferredFraction = drag.previousFraction;
    if (separator.hasPointerCapture(drag.pointerId)) separator.releasePointerCapture(drag.pointerId);
    draw();
    if (commit) save();
  }
  function refresh(): void { finish(false); draw(); }
  const on = <K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void): void => {
    separator.addEventListener(type, listener, { signal: listeners.signal });
  };
  on('pointerdown', (event) => {
    if (!available() || event.button !== 0 || !event.isPrimary || activeDrag) return;
    event.preventDefault();
    separator.focus({ preventScroll: true });
    separator.setPointerCapture(event.pointerId);
    activeDrag = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebar.getBoundingClientRect().width, workspaceWidth: workspace.getBoundingClientRect().width, previousFraction: preferredFraction };
    document.body.classList.add('brief-resizing');
  });
  on('pointermove', (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    if (!available() || workspace.getBoundingClientRect().width !== activeDrag.workspaceWidth) { finish(false); return; }
    const width = clampBriefWidth(activeDrag.startWidth + event.clientX - activeDrag.startX, activeDrag.workspaceWidth);
    preferredFraction = width / activeDrag.workspaceWidth;
    draw();
  });
  on('pointerup', (event) => {
    if (activeDrag?.pointerId === event.pointerId) finish(available() && workspace.getBoundingClientRect().width === activeDrag.workspaceWidth);
  });
  on('pointercancel', (event) => { if (activeDrag?.pointerId === event.pointerId) finish(false); });
  on('lostpointercapture', (event) => { if (activeDrag?.pointerId === event.pointerId) finish(false); });
  on('dblclick', (event) => {
    if (!available()) return;
    event.preventDefault();
    finish(false);
    preferredFraction = null;
    draw();
    save();
  });
  on('keydown', (event) => {
    if (!available() || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    finish(false);
    const width = workspace.getBoundingClientRect().width;
    const step = width * (event.shiftKey ? .05 : .01);
    const next = event.key === 'Home' ? 310 : event.key === 'End' ? width * .5 : sidebar.getBoundingClientRect().width + (event.key === 'ArrowRight' ? step : -step);
    preferredFraction = clampBriefWidth(next, width) / width;
    draw();
    save();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeDrag) { event.preventDefault(); finish(false); }
  }, { capture: true, signal: listeners.signal });
  desktop.addEventListener('change', refresh, { signal: listeners.signal });
  const observer = new ResizeObserver(() => {
    if (activeDrag && (!available() || workspace.getBoundingClientRect().width !== activeDrag.workspaceWidth)) finish(false);
    draw();
  });
  observer.observe(workspace);
  draw();
  return { refresh, dispose() { finish(false); listeners.abort(); observer.disconnect(); } };
}
