/*
 * Two lenses over the same compile: the optimisation ladder (-O0…-O3, four real links) and the
 * memory lens (what the linear memory declares, where the heap starts, how far it grew while the
 * program ran). Both talk to the inspection worker, so the vendored engine stays untouched.
 */

import { closePipeline } from './pipeline';
import { flash, play } from './fx';

export type LensSource = () => {
  code: string;
  language: 'c' | 'cpp';
  standard: string;
  stdin: string;
};

type LevelMessage = {
  type: 'level';
  id: string;
  status: 'running' | 'done' | 'failed';
  ms?: number;
  bytes?: number;
  sections?: { name: string; bytes: number }[];
  note?: string;
};

type MemoryMessage = {
  type: 'memory';
  status: 'done' | 'failed';
  note?: string;
  moduleBytes?: number;
  sections?: { name: string; bytes: number }[];
  pages?: number;
  declared?: number;
  before?: number;
  peak?: number;
  after?: number;
  grew?: number;
  samples?: { t: number; bytes: number }[];
  writeCount?: number;
  heapBase?: number | null;
  dataEnd?: number | null;
  stackPointer?: number | null;
  shared?: boolean;
  exitCode?: number | null;
  crashed?: string;
};

type LensMessage = LevelMessage | MemoryMessage | { type: 'done' };

const LEVELS = ['-O0', '-O1', '-O2', '-O3'];
const LENS_LIMIT_MS = 20_000;
const CHART_W = 720;
const CHART_H = 150;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SETTLED_NOTES: Record<'compare' | 'memory', string> = {
  compare: 'every level is a separate full link of this file in this tab — the time is Clang working, not your program running',
  memory: 'the program really ran here to make these numbers; nothing left the page',
};

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const panel = $<HTMLElement>('lens');
const body = $<HTMLElement>('lens-body');
const titleEl = $<HTMLElement>('lens-title');
const totalEl = $<HTMLElement>('lens-total');
const noteEl = $<HTMLElement>('lens-note');
const consoleEl = $<HTMLPreElement>('console');
const compareButton = $<HTMLButtonElement>('compare');
const memoryButton = $<HTMLButtonElement>('memory');
const closeButton = $<HTMLButtonElement>('lens-close');

let worker: Worker | null = null;
let deadline: number | undefined;
let mode: 'compare' | 'memory' = 'compare';
let problem = '';
let source: LensSource = () => ({ code: '', language: 'cpp', standard: 'c17', stdin: '' });
let revealOutput: () => void = () => {};

function formatBytes(count: number): string {
  if (count < 1024) return `${count} B`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} kB`;
  return `${(count / 1048576).toFixed(2)} MB`;
}

function createWorker(): Worker {
  const url = new URL('engine/pipeline-worker.mjs', document.baseURI).href;
  const next = new Worker(url, { type: 'module', name: 'lens' });
  next.addEventListener('message', (event: MessageEvent<LensMessage>) => onMessage(event.data));
  next.addEventListener('error', (event) => finish(`Worker stopped: ${event.message}`));
  return next;
}

function armLimit() {
  clearTimeout(deadline);
  deadline = window.setTimeout(() => {
    worker?.terminate();
    worker = null;
    finish(`the program did not finish in ${LENS_LIMIT_MS / 1000} s — the lens gave up waiting`);
  }, LENS_LIMIT_MS);
}

function setRow(id: string, mutate: (row: HTMLElement) => void) {
  const row = body.querySelector<HTMLElement>(`[data-row="${id}"]`);
  if (row) mutate(row);
}

function open(next: 'compare' | 'memory') {
  closePipeline();
  mode = next;
  problem = '';
  revealOutput();
  panel.hidden = false;
  consoleEl.hidden = true;
  compareButton.setAttribute('aria-expanded', String(next === 'compare'));
  memoryButton.setAttribute('aria-expanded', String(next === 'memory'));
  titleEl.textContent = next === 'compare' ? 'optimisation ladder · four real links of the same file' : 'memory lens · the linear memory of the module that Run executes';
  noteEl.textContent = 'working…';
  totalEl.textContent = '';
  body.textContent = '';
  if (next === 'compare') {
    for (const level of LEVELS) {
      const row = document.createElement('div');
      row.className = 'level';
      row.dataset.row = level;
      row.dataset.state = 'waiting';
      row.innerHTML = `<span class="level-name">${level}</span><div class="level-bars"><i class="bytes"></i><i class="time"></i></div><p class="level-value">waiting</p>`;
      body.appendChild(row);
    }
  } else {
    const row = document.createElement('div');
    row.className = 'lens-wait';
    row.dataset.row = 'wait';
    row.dataset.state = 'running';
    row.textContent = 'compiling at -O2, then running the program to watch its memory grow…';
    body.appendChild(row);
  }
  armLimit();
  worker ??= createWorker();
  worker.postMessage({ type: next === 'memory' ? 'memscan' : 'compare', ...source() });
}

function finish(note?: string) {
  clearTimeout(deadline);
  noteEl.textContent = note || problem || SETTLED_NOTES[mode];
  for (const row of body.querySelectorAll<HTMLElement>('[data-state="running"],[data-state="waiting"]')) {
    row.dataset.state = 'failed';
  }
  if (mode === 'compare') rescale();
  panel.classList.add('is-settled');
  play(problem || note ? 'err' : 'ok');
}

/** Each row is drawn while it lands, so its bar is measured against the levels seen so far. Once
 *  all four are in, every bar is redrawn against the true maximum. */
function rescale() {
  const rows = LEVELS.map((level) => body.querySelector<HTMLElement>(`[data-row="${level}"]`)).filter(
    (row): row is HTMLElement => row !== null && row.dataset.state === 'done',
  );
  if (!rows.length) return;
  const maxBytes = Math.max(...rows.map((row) => Number(row.dataset.bytes ?? 0)));
  const maxMs = Math.max(...rows.map((row) => Number(row.dataset.ms ?? 0)));
  for (const row of rows) {
    row.querySelector<HTMLElement>('.bytes')!.style.width = `${Math.max(2, ((Number(row.dataset.bytes) / maxBytes) * 100))}%`;
    row.querySelector<HTMLElement>('.time')!.style.width = `${Math.max(2, ((Number(row.dataset.ms) / maxMs) * 100))}%`;
  }
}

function onMessage(message: LensMessage) {
  if (message.type === 'level') return onLevel(message);
  if (message.type === 'memory') return onMemory(message);
  if (message.type === 'done') return finish();
}

function onLevel(message: LevelMessage) {
  setRow(message.id, (row) => {
    row.dataset.state = message.status;
    const bytes = row.querySelector<HTMLElement>('.bytes')!;
    const time = row.querySelector<HTMLElement>('.time')!;
    const value = row.querySelector<HTMLElement>('.level-value')!;
    if (message.status === 'running') {
      value.textContent = 'linking…';
      return;
    }
    if (message.status === 'failed') {
      value.textContent = 'did not compile';
      row.title = message.note ?? '';
      problem = message.note?.split('\n').find((line) => line.includes('error:')) || 'this file does not compile';
      return;
    }
    const peakBytes = Math.max(...LEVELS.map((id) => Number(body.querySelector<HTMLElement>(`[data-row="${id}"]`)?.dataset.bytes ?? 0)));
    const peakTime = Math.max(...LEVELS.map((id) => Number(body.querySelector<HTMLElement>(`[data-row="${id}"]`)?.dataset.ms ?? 0)));
    row.dataset.bytes = String(message.bytes ?? 0);
    row.dataset.ms = String(message.ms ?? 0);
    bytes.style.width = `${Math.max(2, ((message.bytes ?? 0) / Math.max(peakBytes, message.bytes ?? 1)) * 100)}%`;
    time.style.width = `${Math.max(2, ((message.ms ?? 0) / Math.max(peakTime, message.ms ?? 1)) * 100)}%`;
    const code = (message.sections ?? []).find((section) => section.name === 'code');
    value.textContent = `${formatBytes(message.bytes ?? 0)} · ${((message.ms ?? 0) / 1000).toFixed(1)} s`;
    row.title = `code section ${formatBytes(code?.bytes ?? 0)}`;
    const total = Number(body.querySelector<HTMLElement>('[data-row="-O0"]')?.dataset.bytes ?? 0);
    if (total && message.id === '-O3') {
      const saved = Math.round((1 - Number(message.bytes ?? 0) / total) * 100);
      totalEl.textContent = `${saved > 0 ? saved + ' % smaller than -O0' : 'no size win over -O0'}`;
    }
  });
}

function svgNode<K extends SVGElement>(name: string, attrs: Record<string, string>): K {
  const el = document.createElementNS(SVG_NS, name) as K;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** The heap as it was measured: one point per output write, the first and last write always kept. */
function memoryChart(samples: Array<{ t: number; bytes: number }>): SVGSVGElement | null {
  if (samples.length < 2) return null;
  const lastT = Math.max(1, samples[samples.length - 1].t);
  const high = Math.max(...samples.map((point) => point.bytes));
  const low = Math.min(...samples.map((point) => point.bytes));
  const x = (t: number) => (t / lastT) * CHART_W;
  const y = (bytes: number) => CHART_H - 16 - ((bytes - low) / Math.max(1, high - low)) * (CHART_H - 34);
  const line = samples.map((point) => `${x(point.t).toFixed(1)},${y(point.bytes).toFixed(1)}`).join(' ');

  const chart = svgNode<SVGSVGElement>('svg', {
    class: 'mem-chart',
    viewBox: `0 0 ${CHART_W} ${CHART_H}`,
    role: 'img',
    'aria-label': `linear memory grew from ${formatBytes(low)} to ${formatBytes(high)} over ${lastT} ms`,
  });
  chart.appendChild(svgNode<SVGPolygonElement>('polygon', { class: 'mem-area', points: `0,${CHART_H} ${line} ${CHART_W},${CHART_H}` }));
  chart.appendChild(svgNode<SVGPolylineElement>('polyline', { class: 'mem-line', points: line }));
  for (const [text, px, py, anchor] of [
    [`peak ${formatBytes(high)}`, 8, 16, 'start'],
    [`start ${formatBytes(low)}`, 8, CHART_H - 6, 'start'],
    [`${lastT} ms`, CHART_W - 8, CHART_H - 6, 'end'],
  ] as Array<[string, number, number, string]>) {
    const label = svgNode<SVGTextElement>('text', { x: String(px), y: String(py), class: 'mem-tick', 'text-anchor': anchor });
    label.textContent = text;
    chart.appendChild(label);
  }
  return chart;
}

function onMemory(message: MemoryMessage) {
  body.textContent = '';
  if (message.status === 'failed') {
    problem = message.note?.split('\n').find((line) => line.includes('error:')) || 'the program did not compile';
    return;
  }
  const chart = memoryChart(message.samples ?? []);
  if (chart) body.appendChild(chart);
  const rows: [string, string, number][] = [
    ['module', formatBytes(message.moduleBytes ?? 0), message.moduleBytes ?? 0],
    ['declared memory', `${message.pages ?? 0} pages · ${formatBytes(message.declared ?? 0)}`, message.declared ?? 0],
    ['heap starts at', message.heapBase != null ? `${message.heapBase} B` : 'not exported', message.heapBase ?? 0],
    ['static data ends at', message.dataEnd != null ? `${message.dataEnd} B` : 'not exported', message.dataEnd ?? 0],
    ['peak while running', formatBytes(message.peak ?? 0), message.peak ?? 0],
    ['grown by', formatBytes(message.grew ?? 0), message.grew ?? 0],
  ];
  for (const [label, value, raw] of rows) {
    const row = document.createElement('div');
    row.className = 'mem-row';
    const share = Math.max(2, Math.min(100, ((raw / Math.max(1, message.peak ?? 1)) * 100)));
    row.innerHTML = `<span class="mem-name">${label}</span><div class="mem-bar"><i style="width:${share}%"></i></div><p class="mem-value">${value}</p>`;
    body.appendChild(row);
  }
  const facts = document.createElement('p');
  facts.className = 'mem-facts';
  const exit = message.exitCode == null ? `crashed: ${message.crashed || 'unknown'}` : `exit ${message.exitCode}`;
  const writes = message.writeCount ?? 0;
  facts.textContent =
    `${exit} · stack pointer starts at ${message.stackPointer ?? '—'} · ` +
    `memory read at ${writes} output write${writes === 1 ? '' : 's'} · ` +
    (message.shared ? 'memory is imported by the module' : 'memory is exported by the module') +
    ' · a program that allocates while staying silent shows a floor, not a ceiling';
  body.appendChild(facts);
  const list = document.createElement('ul');
  list.className = 'mem-sections';
  for (const section of message.sections ?? []) {
    const item = document.createElement('li');
    item.innerHTML = `<i style="width:${Math.max(2, ((section.bytes / Math.max(1, message.moduleBytes ?? 1)) * 100))}%"></i>${section.name} <b>${formatBytes(section.bytes)}</b>`;
    list.appendChild(item);
  }
  body.appendChild(list);
  totalEl.textContent = `+${formatBytes(message.grew ?? 0)} heap`;
  flash(panel, 'is-flash');
}

compareButton.addEventListener('click', () => open('compare'));
memoryButton.addEventListener('click', () => open('memory'));
closeButton.addEventListener('click', closeLens);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !panel.hidden) closeLens();
});

export function closeLens(): void {
  panel.hidden = true;
  consoleEl.hidden = false;
  compareButton.setAttribute('aria-expanded', 'false');
  memoryButton.setAttribute('aria-expanded', 'false');
}

export function initLenses(read: LensSource, reveal: () => void): void {
  source = read;
  revealOutput = reveal;
}
