import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { cpp } from '@codemirror/lang-cpp';
import {
  bracketMatching,
  foldGutter,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

import { EXAMPLES, type Example, type Language } from './examples';
import './style.css';

type Stream = 'stdout' | 'stderr' | 'system';

type RunMessage = {
  type: 'run';
  code: string;
  stdin: string;
  language: Language;
  standard?: string;
};

type WorkerMessage =
  | { type: 'status'; status: 'loading' | 'busy' | 'ready' }
  | { type: 'output'; stream: Stream; text: string }
  | { type: 'done'; exitCode: number };

const C_STANDARDS = ['c89', 'c99', 'c11', 'c17', 'c23'];
const RUN_LIMIT_MS = 15_000;
const STORAGE_KEY = 'cpp-forge.state';

const forgeTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-content': { caretColor: 'var(--ember)' },
  '.cm-gutters': { minWidth: '44px' },
});

const forgeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword], color: '#f5a524' },
  { tag: [t.typeName, t.className, t.namespace], color: '#79c0ff' },
  { tag: [t.function(t.variableName), t.macroName], color: '#d2a8ff' },
  { tag: [t.string, t.special(t.string)], color: '#a5d6ff' },
  { tag: [t.number, t.bool, t.null], color: '#ffab70' },
  { tag: t.comment, color: '#616e7c', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.separator], color: '#8b95a5' },
  { tag: t.propertyName, color: '#7ee787' },
]);

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const languageSelect = $<HTMLSelectElement>('language');
const standardSelect = $<HTMLSelectElement>('standard');
const examplesSelect = $<HTMLSelectElement>('examples');
const stdinBox = $<HTMLTextAreaElement>('stdin');
const stdinToggle = $<HTMLButtonElement>('stdin-toggle');
const runButton = $<HTMLButtonElement>('run');
const stopButton = $<HTMLButtonElement>('stop');
const clearButton = $<HTMLButtonElement>('clear');
const shareButton = $<HTMLButtonElement>('share');
const consoleEl = $<HTMLPreElement>('console');
const statusEl = $<HTMLSpanElement>('status');
const metricsEl = $<HTMLSpanElement>('metrics');

const editorView = new EditorView({
  state: makeEditorState(),
  parent: $('editor'),
});

function makeEditorState() {
  return EditorState.create({
    doc: '',
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      cpp(),
      syntaxHighlighting(forgeHighlight),
      EditorView.lineWrapping,
      forgeTheme,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
    ],
  });
}

// ---------- console ----------

let lastBlock: { stream: Stream; el: HTMLSpanElement } | null = null;

function writeLine(stream: Stream, text: string, done = false) {
  if (!text) return;
  if (!lastBlock || lastBlock.stream !== stream) {
    const el = document.createElement('span');
    el.className = `line-${stream}`;
    consoleEl.appendChild(el);
    lastBlock = { stream, el };
  }
  lastBlock.el.textContent += text;
  if (done) lastBlock.el.classList.add('done');
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearConsole() {
  consoleEl.textContent = '';
  lastBlock = null;
  metricsEl.textContent = '';
}

function setStatus(state: string, label: string) {
  statusEl.dataset.state = state;
  statusEl.textContent = label;
}

// ---------- worker ----------

let worker: Worker | null = null;
let busy = false;
let runDeadline: number | null = null;
let compileStartedAt = 0;
let runStartedAt = 0;
let programStarted = false;

function workerUrl(): string {
  return new URL('engine/clang-worker.mjs', document.baseURI).href;
}

function createWorker(): Worker {
  const w = new Worker(workerUrl(), { type: 'module', name: 'clang' });
  w.addEventListener('message', (event: MessageEvent<WorkerMessage>) => onWorkerMessage(event.data));
  w.addEventListener('error', (event) => {
    writeLine('stderr', `Could not start the compiler: ${event.message}\n`);
    endRun('fail', 'failed', true);
  });
  return w;
}

function onWorkerMessage(message: WorkerMessage) {
  switch (message.type) {
    case 'status':
      if (message.status === 'loading') setStatus('loading', 'downloading toolchain…');
      if (message.status === 'busy') setStatus('compiling', 'compiling…');
      if (message.status === 'ready') {
        programStarted = true;
        runStartedAt = performance.now();
        setStatus('running', 'running');
        armRunLimit();
      }
      break;
    case 'output':
      writeLine(message.stream, message.text);
      break;
    case 'done':
      reportExit(message.exitCode);
      break;
  }
}

function armRunLimit() {
  clearTimeout(runDeadline ?? undefined);
  runDeadline = window.setTimeout(() => {
    writeLine('system', `Stopped after ${RUN_LIMIT_MS / 1000}s — the program is still running.\n`);
    endRun('fail', 'timed out', true);
  }, RUN_LIMIT_MS);
}

function reportExit(exitCode: number) {
  const now = performance.now();
  // A failed compile never reaches 'ready', so all of the elapsed time belongs to the compiler.
  metricsEl.textContent = programStarted
    ? `compile ${formatMs(runStartedAt - compileStartedAt)} · run ${formatMs(now - runStartedAt)} · exit ${exitCode}`
    : `compile ${formatMs(now - compileStartedAt)} · exit ${exitCode}`;
  endRun(exitCode === 0 ? 'ok' : 'fail', exitCode === 0 ? 'done' : `exit ${exitCode}`, false);
}

/**
 * Ends a run. The worker survives a normal exit: it fetches the toolchain and the precompiled
 * header in the background, and only a later run can reuse them. Terminating is the only way to
 * stop a busy WebAssembly program, so that is reserved for Stop, timeouts and crashes.
 */
function endRun(state: string, label: string, killed: boolean) {
  clearTimeout(runDeadline ?? undefined);
  runDeadline = null;
  if (killed) {
    worker?.terminate();
    worker = null;
  }
  busy = false;
  setStatus(state, label);
  runButton.disabled = false;
  stopButton.disabled = true;
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function run() {
  if (busy) return;
  clearConsole();
  programStarted = false;
  compileStartedAt = performance.now();
  runStartedAt = compileStartedAt;
  runButton.disabled = true;
  stopButton.disabled = false;
  setStatus('loading', 'starting…');

  worker ??= createWorker();
  const message: RunMessage = {
    type: 'run',
    code: editorView.state.doc.toString(),
    stdin: stdinBox.value,
    language: currentLanguage(),
  };
  if (message.language === 'c') message.standard = standardSelect.value;
  worker.postMessage(message);
  persist();
}

function stop() {
  writeLine('system', 'Stopped.\n');
  endRun('idle', 'stopped', true);
}

// ---------- state in the URL and localStorage ----------

interface SavedState {
  language: Language;
  standard: string;
  code: string;
  stdin: string;
}

function currentLanguage(): Language {
  return languageSelect.value === 'c' ? 'c' : 'cpp';
}

function readState(): SavedState {
  return {
    language: currentLanguage(),
    standard: standardSelect.value,
    code: editorView.state.doc.toString(),
    stdin: stdinBox.value,
  };
}

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readState()));
}

function applyState(state: Partial<SavedState>) {
  if (state.language) languageSelect.value = state.language;
  syncStandardSelect();
  if (state.standard) standardSelect.value = state.standard;
  if (state.code !== undefined) editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: state.code } });
  if (state.stdin !== undefined) {
    stdinBox.value = state.stdin;
    if (state.stdin) toggleStdin(true);
  }
}

function shareLink() {
  const payload = encodeBase64Url(JSON.stringify(readState()));
  const url = new URL(location.href);
  url.hash = `code=${payload}`;
  window.history.replaceState(null, '', url);

  if (!navigator.clipboard) {
    setStatus('idle', 'link ready — copy it from the address bar');
    return;
  }
  navigator.clipboard
    .writeText(url.href)
    .then(() => setStatus('ok', 'link copied'))
    .catch(() => setStatus('fail', 'copy blocked — use the address bar'));
}

function restoreFromLocation(): boolean {
  const match = /code=([^&]+)/.exec(location.hash);
  if (match) {
    try {
      applyState(JSON.parse(decodeBase64Url(match[1])));
      return true;
    } catch {
      writeLine('stderr', 'The link is malformed; starting from the saved session instead.\n');
    }
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      applyState(JSON.parse(saved));
      return true;
    } catch {
      /* fall through to the default example */
    }
  }
  return false;
}

// ---------- controls ----------

function syncStandardSelect() {
  const isC = currentLanguage() === 'c';
  standardSelect.hidden = !isC;
  if (!isC) return;
  standardSelect.innerHTML = '';
  for (const standard of C_STANDARDS) {
    const option = document.createElement('option');
    option.value = standard;
    option.textContent = standard;
    standardSelect.appendChild(option);
  }
  standardSelect.value = 'c17';
}

function toggleStdin(open?: boolean) {
  const expanded = open ?? stdinBox.hidden;
  stdinBox.hidden = !expanded;
  stdinToggle.setAttribute('aria-expanded', String(expanded));
}

function loadExample(example: Example) {
  languageSelect.value = example.language;
  syncStandardSelect();
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: example.code },
  });
  stdinBox.value = example.stdin ?? '';
  toggleStdin(Boolean(example.stdin));
  clearConsole();
  writeLine('system', `Loaded “${example.label}”. Press Run.\n`);
  persist();
}

for (const example of EXAMPLES) {
  const option = document.createElement('option');
  option.value = example.id;
  option.textContent = example.label;
  examplesSelect.appendChild(option);
}

runButton.addEventListener('click', run);
stopButton.addEventListener('click', stop);
clearButton.addEventListener('click', clearConsole);
shareButton.addEventListener('click', shareLink);
stdinToggle.addEventListener('click', () => toggleStdin());
languageSelect.addEventListener('change', () => {
  syncStandardSelect();
  persist();
});
standardSelect.addEventListener('change', persist);
examplesSelect.addEventListener('change', () => {
  const example = EXAMPLES.find((item) => item.id === examplesSelect.value);
  if (example) loadExample(example);
  examplesSelect.value = '';
});

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    run();
  } else if (event.key === 'Escape' && busy) {
    stop();
  }
});

syncStandardSelect();
if (!restoreFromLocation()) loadExample(EXAMPLES[0]);
editorView.focus();
