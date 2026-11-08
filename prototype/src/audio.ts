export type CueName = 'run' | 'error' | 'success' | 'select';

export interface AudioController {
  setEnabled(value: boolean): Promise<boolean>;
  cue(name: CueName): void;
  dispose(): void;
}

type CueNote = readonly [frequency: number, delay: number, duration: number, volume: number];

const CUES: Record<CueName, readonly CueNote[]> = {
  select: [[392, 0, 0.13, 0.045]],
  run: [[196, 0, 0.23, 0.065], [293.66, 0.13, 0.3, 0.045]],
  error: [[130.81, 0, 0.38, 0.075], [98, 0.12, 0.35, 0.035]],
  success: [[261.63, 0, 0.7, 0.065], [329.63, 0.2, 0.8, 0.06],
    [392, 0.4, 1, 0.055], [523.25, 0.65, 1.5, 0.035]],
};
const PAD_NOTES: readonly number[] = [130.81, 196, 164.81, 220, 196, 261.63, 146.83, 196];

/** Original synthesized audio. Call setEnabled only from a user gesture. */
export function createAudio(): AudioController {
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let filter: BiquadFilterNode | undefined;
  let enabled = false;
  let disposed = false;
  let revision = 0;
  let pendingTransition: Promise<void> | undefined;
  let padTimer: ReturnType<typeof setTimeout> | undefined;
  let noteIndex = 0;
  let lastCue = -Infinity;
  const nodes = new Set<AudioNode>();
  const sources = new Set<AudioScheduledSourceNode>();
  const voices = new Map<OscillatorNode, () => void>();

  function own<T extends AudioNode>(node: T): T {
    nodes.add(node);
    if ('stop' in node && typeof node.stop === 'function') {
      sources.add(node as T & AudioScheduledSourceNode);
    }
    return node;
  }

  function release(node: AudioNode): void {
    node.disconnect();
    nodes.delete(node);
    if ('stop' in node && typeof node.stop === 'function') {
      sources.delete(node as AudioScheduledSourceNode);
    }
  }

  function tone(
    frequency: number,
    start: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'sine',
    detune: number = 0,
  ): void {
    if (!context || !filter || voices.size >= 16) return;
    const oscillator = own(context.createOscillator());
    const envelope = own(context.createGain());
    const attack = Math.min(duration * 0.25, 0.7);
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.detune.value = detune;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    envelope.gain.linearRampToValueAtTime(0, start + duration + 0.05);
    oscillator.connect(envelope);
    envelope.connect(filter);
    const releaseVoice = (): void => {
      release(oscillator);
      release(envelope);
      voices.delete(oscillator);
    };
    voices.set(oscillator, releaseVoice);
    oscillator.onended = releaseVoice;
    oscillator.start(start);
    oscillator.stop(start + duration + 0.06);
  }

  function buildGraph(context: AudioContext): void {
    master = own(context.createGain());
    master.gain.value = 0;
    filter = own(context.createBiquadFilter());
    filter.type = 'lowpass';
    filter.frequency.value = 1700;
    filter.Q.value = 0.45;
    const compressor = own(context.createDynamicsCompressor());
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    filter.connect(compressor);
    compressor.connect(master);
    master.connect(context.destination);

    const drone = own(context.createGain());
    drone.gain.value = 0.022;
    drone.connect(filter);
    for (const frequency of [65.406, 130.813]) {
      const oscillator = own(context.createOscillator());
      oscillator.frequency.value = frequency;
      oscillator.detune.value = frequency < 100 ? -3 : 3;
      oscillator.connect(drone);
      oscillator.start();
    }
    const breath = own(context.createOscillator());
    const depth = own(context.createGain());
    breath.frequency.value = 0.065;
    depth.gain.value = 0.006;
    breath.connect(depth);
    depth.connect(drone.gain);
    breath.start();

    const room = own(context.createBufferSource());
    const roomFilter = own(context.createBiquadFilter());
    const roomLevel = own(context.createGain());
    const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
    room.buffer = buffer;
    room.loop = true;
    roomFilter.type = 'lowpass';
    roomFilter.frequency.value = 320;
    roomLevel.gain.value = 0.012;
    room.connect(roomFilter);
    roomFilter.connect(roomLevel);
    roomLevel.connect(filter);
    room.start();
  }

  function schedulePad(): void {
    clearTimeout(padTimer);
    padTimer = undefined;
    if (!enabled || disposed || !context || context.state !== 'running') return;
    const frequency = PAD_NOTES[noteIndex % PAD_NOTES.length]!;
    noteIndex += 1;
    const start = context.currentTime + 0.05;
    tone(frequency, start, 5.2, 0.026, 'triangle', -4);
    tone(frequency * 1.002, start + 0.2, 5.5, 0.02, 'sine', 4);
    // Sparse musical events need no animation-frame loop or short polling timer.
    padTimer = setTimeout(schedulePad, noteIndex % 3 === 0 ? 8200 : 6500);
  }

  function transition(action: () => Promise<void>): Promise<void> {
    // Overlapping native suspend/resume requests can leave a browser promise pending.
    const task = pendingTransition ? pendingTransition.then(action, action) : action();
    pendingTransition = task;
    const settled = (): void => {
      if (pendingTransition === task) pendingTransition = undefined;
    };
    void task.then(settled, settled);
    return task;
  }

  async function setEnabled(value: boolean): Promise<boolean> {
    if (disposed) return false;
    const request = ++revision;
    const wanted = Boolean(value);
    if (!wanted) {
      enabled = false;
      clearTimeout(padTimer);
      padTimer = undefined;
      if (!context || !master) return false;
      const activeContext = context;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(0, context.currentTime);
      // Muting must not freeze a command cue for playback on the next enable.
      for (const [voice, releaseVoice] of voices) {
        voice.stop();
        releaseVoice();
        voice.onended = null;
      }
      try {
        await transition(async () => {
          if (!disposed && request === revision) await activeContext.suspend();
        });
      } catch {
        // Muted output remains off even if a browser refuses suspension.
      }
      return enabled && context.state === 'running';
    }
    try {
      if (!context) {
        const audioGlobal = globalThis as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        };
        const AudioContextConstructor = audioGlobal.AudioContext || audioGlobal.webkitAudioContext;
        if (!AudioContextConstructor) return false;
        context = new AudioContextConstructor();
        buildGraph(context);
      }
      if (!master) return false;
      const activeContext = context;
      await transition(async () => {
        if (!disposed && request === revision) await activeContext.resume();
      });
      if (disposed || request !== revision) return enabled && context.state === 'running';
      if (context.state !== 'running') return false;
      const wasEnabled = enabled;
      enabled = true;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(0.32, context.currentTime, 0.3);
      if (!wasEnabled || !padTimer) schedulePad();
      return true;
    } catch {
      if (request === revision) {
        enabled = false;
        clearTimeout(padTimer);
        if (master) master.gain.value = 0;
      }
      return false;
    }
  }

  function cue(name: CueName): void {
    const notes = CUES[name];
    if (!Array.isArray(notes) || !enabled || disposed || !context || context.state !== 'running') return;
    const now = context.currentTime;
    if (now - lastCue < 0.09) return;
    lastCue = now;
    for (const [frequency, delay, duration, volume] of notes) {
      tone(frequency, now + delay, duration, volume);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    enabled = false;
    revision += 1;
    clearTimeout(padTimer);
    for (const source of sources) {
      source.onended = null;
      try { source.stop(); } catch { /* A scheduled voice may already have ended. */ }
    }
    for (const node of nodes) node.disconnect();
    sources.clear();
    voices.clear();
    nodes.clear();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  return { setEnabled, cue, dispose };
}
