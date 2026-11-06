/*
 * "How it compiles": runs public/engine/pipeline-worker.mjs and draws what each stage of the real
 * Clang pipeline reported — timings, the -ftime-trace breakdown, the LLVM IR and the wasm module with
 * its section sizes. Nothing here is a simulation; every number comes from a compiler pass.
 */

import { motionAllowed, play } from './fx';
import './pipeline.css';

type StageId = 'toolchain' | 'parse' | 'ir' | 'codegen' | 'wasm' | 'error';

type StageMessage = {
  type: 'stage';
  id: StageId;
  status: 'running' | 'done' | 'failed';
  ms?: number;
  bytes?: number;
  phases?: { name: string; ms: number }[];
  sections?: { name: string; bytes: number }[];
  note?: string;
};

type ArtifactMessage = { type: 'artifact'; id: 'ir' | 'wasm'; text: string; note: string };
type WorkerMessage = StageMessage | ArtifactMessage | { type: 'done' };

export type InspectSource = () => { code: string; language: 'c' | 'cpp'; standard?: string };

const STAGES: Array<{ id: StageId; label: string; detail: string }> = [
  { id: 'toolchain', label: 'toolchain', detail: 'Clang 21 on WebAssembly' },
  { id: 'parse', label: 'parse', detail: '-fsyntax-only' },
  { id: 'ir', label: 'llvm ir', detail: '-S -emit-llvm' },
  { id: 'codegen', label: 'codegen', detail: '-c -ftime-trace' },
  { id: 'wasm', label: 'link wasm', detail: 'wasm32-wasi' },
];

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

let worker: Worker | null = null;
let busy = false;
let failed = false;
let peakMs = 1;
let startedAt = 0;
const artifacts = new Map<string, { text: string; note: string }>();
const cards = new Map<StageId, HTMLElement>();

let panel: HTMLElement;
let stagesHost: HTMLElement;
let artifactTabs: HTMLElement;
let artifactBody: HTMLElement;
let totalEl: HTMLElement;
let noteEl: HTMLElement;
let consoleEl: HTMLElement;
let inspectButton: HTMLButtonElement;
let closeButton: HTMLButtonElement;

function formatBytes(count: number): string {
  return count < 1024 ? `${count} B` : count < 1024 * 1024 ? `${(count / 1024).toFixed(1)} kB` : `${(count / 1048576).toFixed(2)} MB`;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function buildCards() {
  stagesHost.textContent = '';
  cards.clear();
  peakMs = 1;
  for (const stage of STAGES) {
    const card = document.createElement('article');
    card.className = 'stage';
    card.dataset.state = 'waiting';
    card.innerHTML = `
      <div class="stage-main">
        <h3>${stage.label}<span class="stage-flag">${stage.detail}</span></h3>
        <div class="stage-bar"><i></i></div>
        <p class="stage-value">—</p>
      </div>
      <ul class="stage-extra"></ul>`;
    stagesHost.appendChild(card);
    cards.set(stage.id, card);
  }
}

/** The bar grows to the share of the slowest stage, so the pipeline bottleneck is obvious at a glance. */
function paintBar(card: HTMLElement, ms: number) {
  peakMs = Math.max(peakMs, ms);
  for (const other of cards.values()) {
    const value = Number(other.dataset.ms || 0);
    const bar = other.querySelector<HTMLElement>('.stage-bar > i');
    if (bar && value) bar.style.width = `${Math.max(3, Math.round((value / peakMs) * 100))}%`;
  }
  const bar = card.querySelector<HTMLElement>('.stage-bar > i');
  if (bar) bar.style.width = `${Math.max(3, Math.round((ms / peakMs) * 100))}%`;
}

function list(host: HTMLElement, items: Array<{ name: string; display: string; value: number }>) {
  host.textContent = '';
  const peak = Math.max(1, ...items.map((item) => item.value));
  for (const item of items) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${item.name}</span><b>${item.display}</b><i style="--share:${Math.max(
      4,
      Math.round((item.value / peak) * 100),
    )}%"></i>`;
    host.appendChild(li);
  }
}

function onStage(message: StageMessage) {
  const card = cards.get(message.id);
  if (!card) {
    if (message.note) noteEl.textContent = message.note;
    return;
  }
  card.dataset.state = message.status;
  const value = card.querySelector<HTMLElement>('.stage-value');
  const extra = card.querySelector<HTMLElement>('.stage-extra');

  if (message.status === 'running') {
    if (value) value.textContent = 'working…';
    return;
  }
  if (message.note) noteEl.textContent = message.note;
  const ms = message.ms ?? 0;
  card.dataset.ms = String(ms);
  if (value) {
    value.textContent = message.status === 'failed' ? 'failed' : formatMs(ms);
    if (message.bytes) value.textContent += ` · ${formatBytes(message.bytes)}`;
  }
  paintBar(card, ms);
  const items = message.phases?.map((p) => ({ name: p.name, display: `${p.ms} ms`, value: p.ms }))
    ?? message.sections?.map((s) => ({ name: s.name, display: formatBytes(s.bytes), value: s.bytes }));
  if (extra && items?.length) list(extra, items);
  if (message.status === 'failed') failed = true;
}

function onArtifact(message: ArtifactMessage) {
  artifacts.set(message.id, { text: message.text, note: message.note });
  if (!artifactTabs.querySelector(`[data-artifact="${message.id}"]`)) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'artifact-tab';
    tab.dataset.artifact = message.id;
    tab.textContent = message.id === 'ir' ? 'llvm ir' : 'wasm binary';
    tab.addEventListener('click', () => showArtifact(message.id));
    artifactTabs.appendChild(tab);
  }
  if (!artifactTabs.querySelector('.artifact-tab.is-active')) showArtifact(message.id);
}

function showArtifact(id: string) {
  const found = artifacts.get(id);
  artifactBody.textContent = found ? found.text : '';
  noteEl.textContent = found ? found.note : '';
  for (const tab of artifactTabs.querySelectorAll<HTMLElement>('.artifact-tab')) {
    tab.classList.toggle('is-active', tab.dataset.artifact === id);
  }
}

function createWorker(): Worker {
  const url = new URL('engine/pipeline-worker.mjs', document.baseURI).href;
  const w = new Worker(url, { type: 'module', name: 'pipeline' });
  w.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === 'stage') onStage(message);
    else if (message.type === 'artifact') onArtifact(message);
    else finish();
  });
  w.addEventListener('error', (event) => {
    noteEl.textContent = `Could not start the inspection pass: ${event.message}`;
    finish();
  });
  return w;
}

function finish() {
  busy = false;
  inspectButton.disabled = false;
  inspectButton.textContent = 'how it compiles';
  totalEl.textContent = `total ${formatMs(performance.now() - startedAt)}`;
  if (motionAllowed()) {
    for (const card of cards.values()) card.classList.add('is-settled');
  }
  play(failed ? 'err' : 'ok');
}

function open() {
  panel.hidden = false;
  consoleEl.hidden = true;
  inspectButton.setAttribute('aria-expanded', 'true');
}

/** Hands the pane back to the console, which is where a run writes its output. */
export function closePipeline() {
  panel.hidden = true;
  consoleEl.hidden = false;
  inspectButton.setAttribute('aria-expanded', 'false');
}

export function initPipeline(read: InspectSource): void {
  panel = $('pipeline');
  stagesHost = $('pipeline-stages');
  artifactTabs = $('artifact-tabs');
  artifactBody = $('artifact-body');
  totalEl = $('pipeline-total');
  noteEl = $('pipeline-note');
  consoleEl = $('console');
  inspectButton = $('inspect');
  closeButton = $('pipeline-close');

  inspectButton.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    startedAt = performance.now();
    peakMs = 1;
    failed = false;
    artifacts.clear();
    buildCards();
    artifactTabs.textContent = '';
    artifactBody.textContent = '';
    totalEl.textContent = '';
    noteEl.textContent = 'waiting for the first pass…';
    open();
    inspectButton.disabled = true;
    inspectButton.textContent = 'inspecting…';
    play('run');

    const source = read();
    worker ??= createWorker();
    worker.postMessage({ type: 'inspect', ...source });
  });

  closeButton.addEventListener('click', closePipeline);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closePipeline();
  });
}
