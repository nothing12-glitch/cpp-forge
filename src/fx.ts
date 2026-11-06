const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const SOUND_KEY = 'cpp-forge.sound';

type Voice = 'run' | 'ok' | 'err' | 'copy' | 'type';

const NOTES: Record<Voice, Array<[number, number, number, number]>> = {
  // frequency, delay in seconds, duration, gain
  run: [[420, 0, 0.05, 0.05], [640, 0.05, 0.06, 0.05]],
  ok: [[660, 0, 0.08, 0.06], [990, 0.08, 0.14, 0.05]],
  err: [[240, 0, 0.14, 0.07], [170, 0.1, 0.22, 0.06]],
  copy: [[880, 0, 0.05, 0.04]],
  type: [[1500, 0, 0.02, 0.012]],
};

let audio: AudioContext | null = null;
let soundOn = localStorage.getItem(SOUND_KEY) !== 'off';
let lastSpark = 0;

export function motionAllowed(): boolean {
  return !window.matchMedia(REDUCED_MOTION).matches;
}

export function soundEnabled(): boolean {
  return soundOn;
}

export function setSoundEnabled(value: boolean) {
  soundOn = value;
  localStorage.setItem(SOUND_KEY, value ? 'on' : 'off');
}

export function play(voice: Voice) {
  if (!soundOn) return;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  audio ??= new Ctor();
  if (audio.state === 'suspended') void audio.resume();
  const start = audio.currentTime;
  for (const [frequency, delay, duration, gain] of NOTES[voice]) {
    const osc = audio.createOscillator();
    const level = audio.createGain();
    osc.type = voice === 'err' ? 'triangle' : 'sine';
    osc.frequency.value = frequency;
    level.gain.setValueAtTime(0.0001, start + delay);
    level.gain.exponentialRampToValueAtTime(gain, start + delay + 0.01);
    level.gain.exponentialRampToValueAtTime(0.0001, start + delay + duration);
    osc.connect(level).connect(audio.destination);
    osc.start(start + delay);
    osc.stop(start + delay + duration + 0.02);
  }
}

export function buzz(pattern: number | number[]) {
  if (soundOn) navigator.vibrate?.(pattern);
}

/** A short-lived class that drives a one-shot CSS animation. */
export function flash(el: HTMLElement, className: string, ms = 800) {
  if (!motionAllowed()) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => el.classList.remove(className), ms);
}

/** Mint ripple at the caret, used for the typing feedback. */
export function spark(host: HTMLElement, x: number, y: number, kind: 'type' | 'space') {
  if (!motionAllowed()) return;
  const now = performance.now();
  if (now - lastSpark < 45) return;
  lastSpark = now;
  const dot = document.createElement('i');
  dot.className = `spark spark-${kind}`;
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  dot.addEventListener('animationend', () => dot.remove(), { once: true });
  host.appendChild(dot);
  window.setTimeout(() => dot.remove(), 700);
}
