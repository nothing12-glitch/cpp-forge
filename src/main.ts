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
  type ViewUpdate,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

import { EXAMPLES, type Example, type Language } from './examples';
import { explainErrors } from './explain';
import { isRunnable, LANGUAGES, languageInfo, detectLanguage } from './languages';
import { markSolved, outputMatches, solvedIds, TASKS, type Task } from './tasks';
import { buzz, flash, motionAllowed, play, setSoundEnabled, soundEnabled, spark } from './fx';
import { initLenses, closeLens } from './lenses';
import { initPipeline, closePipeline } from './pipeline';
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
const LANG_KEY = 'cpp-forge.language';
const DETECT_KEY = 'cpp-forge.detect';
const FONT_KEY = 'cpp-forge.font';
const FONT_STEPS = [11.5, 12.5, 13.5, 15, 16.5, 18];
const DETECT_DELAY_MS = 800;

const forgeTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-content': { caretColor: 'var(--mint)' },
  '.cm-gutters': { minWidth: '44px' },
});

const forgeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword], color: '#3df37f' },
  { tag: [t.typeName, t.className, t.namespace], color: '#7dd3fc' },
  { tag: [t.function(t.variableName), t.macroName], color: '#c4b5fd' },
  { tag: [t.string, t.special(t.string)], color: '#7ce8c3' },
  { tag: [t.number, t.bool, t.null], color: '#ffb066' },
  { tag: t.comment, color: '#5b7268', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.separator], color: '#8fa096' },
  { tag: t.propertyName, color: '#9ae6b4' },
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
const soundButton = $<HTMLButtonElement>('sound');
const editorHost = $<HTMLElement>('editor');
const outputPane = document.querySelector<HTMLElement>('.pane-output') ?? consoleEl.parentElement ?? consoleEl;
const workspace = $<HTMLElement>('workspace');
const toolbar = document.querySelector<HTMLElement>('.toolbar') ?? runButton.parentElement!;
const viewTabs = $<HTMLElement>('view-tabs');
const viewActions = $<HTMLElement>('view-actions');
const langGate = $<HTMLElement>('lang-gate');
const langOptions = $<HTMLElement>('lang-options');
const langChip = $<HTMLButtonElement>('lang-chip');
const autoDetectBox = $<HTMLInputElement>('auto-detect');
const shortcutsSheet = $<HTMLElement>('shortcuts');
const shortcutList = $<HTMLElement>('shortcut-list');
const shortcutsClose = $<HTMLButtonElement>('shortcuts-close');
const helpButton = $<HTMLButtonElement>('help');
const toastEl = $<HTMLElement>('toast');
const docStats = $<HTMLElement>('doc-stats');
const copyOutputButton = $<HTMLButtonElement>('copy-output');
const inspectButton = $<HTMLButtonElement>('inspect');
const fontMinus = $<HTMLButtonElement>('font-minus');
const fontPlus = $<HTMLButtonElement>('font-plus');
const hintsEl = $<HTMLElement>('hints');
const tasksButton = $<HTMLButtonElement>('tasks');
const taskSheet = $<HTMLElement>('task-sheet');
const taskList = $<HTMLElement>('task-list');
const taskFlag = $<HTMLElement>('task-flag');
const narrow = window.matchMedia('(max-width:760px)');

let toastTimer: number | undefined;
let detectTimer: number | undefined;
let fontIndex = Number(localStorage.getItem(FONT_KEY)) || 2;
let activeTask: Task | null = null;
let lastStdout = '';
let restoring = true;

const editorView = new EditorView({
  state: makeEditorState(),
  parent: $('editor'),
});

/** Mint ripple plus a soft click for every character the user types. */
function sparkAtCaret(update: ViewUpdate) {
  if (!motionAllowed()) return;
  const pos = update.state.selection.main.head;
  const box = update.view.dom.getBoundingClientRect();
  const caret = update.view.coordsAtPos(pos);
  if (!caret) return;
  const before = update.state.sliceDoc(Math.max(0, pos - 1), pos);
  spark(editorHost, caret.left - box.left, caret.top - box.top, /\s/.test(before) ? 'space' : 'type');
  play('type');
}

function onEditorUpdate(update: ViewUpdate) {
  if (!update.docChanged) return;
  updateDocStats();
  if (update.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'))) {
    sparkAtCaret(update);
    scheduleDetection();
  }
}

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
      EditorView.updateListener.of(onEditorUpdate),
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
  if (stream === 'stdout') lastStdout += text;
  if (done) lastBlock.el.classList.add('done');
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearConsole() {
  consoleEl.textContent = '';
  lastBlock = null;
  lastStdout = '';
  hintsEl.hidden = true;
  hintsEl.textContent = '';
  metricsEl.textContent = '';
}

function setStatus(state: string, label: string) {
  statusEl.dataset.state = state;
  statusEl.textContent = label;
  document.body.dataset.phase = state;
}

// ---------- language layer, gate, toast ----------

const SHORTCUTS: [string, string][] = [
  ['Ctrl+Enter', 'compile and run'],
  ['Esc', 'stop the program, close an overlay'],
  ['Ctrl+/', 'this list'],
  ['Ctrl+.', 'how it compiles'],
  ['Ctrl+M', 'memory lens'],
  ['Ctrl+O', 'the -O0…-O3 ladder'],
  ['Ctrl+J', 'challenges'],
  ['Ctrl+L', 'clear the output'],
];

function toast(text: string, ms = 2400) {
  toastEl.textContent = text;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('is-visible'), ms);
}

function openSheet(sheet: HTMLElement) {
  sheet.hidden = false;
}

function closeSheet(sheet: HTMLElement) {
  sheet.hidden = true;
}

function closeSheets() {
  closeSheet(langGate);
  closeSheet(shortcutsSheet);
  closeSheet(taskSheet);
}

function anySheetOpen() {
  return !langGate.hidden || !shortcutsSheet.hidden || !taskSheet.hidden;
}

/** The chip in the header always says which compiler the current buffer would get. */
function badgeText(): string {
  const info = languageInfo(currentLanguage());
  if (!info.runnable) return `${info.label} · runtime planned`;
  if (info.id === 'c') return `Clang 21 · ${standardSelect.value.toUpperCase()}`;
  return 'Clang 21 · C++20';
}

function buildLanguageSelect() {
  languageSelect.innerHTML = '';
  for (const info of LANGUAGES) {
    const option = document.createElement('option');
    option.value = info.id;
    option.textContent = info.runnable ? info.label : `${info.label} (soon)`;
    languageSelect.appendChild(option);
  }
}

/** The picker only ever offers snippets that compile in the language on screen. */
function buildExampleOptions() {
  const info = languageInfo(currentLanguage());
  examplesSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  const snippets = EXAMPLES.filter((item) => item.language === info.id);
  placeholder.value = '';
  placeholder.textContent = snippets.length ? 'load example…' : `no ${info.label} snippets yet`;
  examplesSelect.appendChild(placeholder);
  examplesSelect.disabled = snippets.length === 0;
  for (const example of snippets) {
    const option = document.createElement('option');
    option.value = example.id;
    option.textContent = example.label;
    examplesSelect.appendChild(option);
  }
}

function setLanguage(next: Language, notify = false) {
  languageSelect.value = next;
  syncStandardSelect();
  buildExampleOptions();
  const info = languageInfo(next);
  langChip.textContent = badgeText();
  langChip.classList.toggle('is-soon', !info.runnable);
  runButton.disabled = !info.runnable && !busy;
  inspectButton.disabled = !info.runnable;
  $<HTMLButtonElement>('memory').disabled = !info.runnable;
  $<HTMLButtonElement>('compare').disabled = !info.runnable;
  if (!info.runnable) closeLens();
  inspectButton.title = info.runnable
    ? 'Show how clang turns this file into wasm'
    : `${info.label} is not compiled by clang, so the pipeline has nothing to show`;
  runButton.title = info.runnable
    ? 'Compile and run (Ctrl+Enter)'
    : `${info.label} is recognised, but this build has no ${info.label} compiler yet`;
  localStorage.setItem(LANG_KEY, next);
  updateDocStats();
  if (notify) toast(`${info.label} — ${info.blurb}`);
  persist();
}

function scheduleDetection() {
  if (!autoDetectBox.checked) return;
  clearTimeout(detectTimer);
  detectTimer = window.setTimeout(detectFromBuffer, DETECT_DELAY_MS);
}

function detectFromBuffer() {
  if (!autoDetectBox.checked) return;
  const found = detectLanguage(editorView.state.doc.toString());
  if (!found || found === currentLanguage()) return;
  setLanguage(found, true);
  writeLine('system', `Language switched to ${languageInfo(found).label} — recognised from the code.\n`);
}

function renderLanguageOptions() {
  langOptions.innerHTML = '';
  for (const info of LANGUAGES) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'lang-option';
    card.dataset.lang = info.id;
    card.innerHTML = `<strong>${info.label}</strong><span>${info.blurb}</span><code>${info.toolchain}</code>`;
    card.addEventListener('click', () => {
      setLanguage(info.id);
      closeSheet(langGate);
      const example = EXAMPLES.find((item) => item.language === info.id);
      if (example && !editorView.state.doc.toString().trim()) loadExample(example);
      editorView.focus();
    });
    langOptions.appendChild(card);
  }
}

// ---------- panes, font size, output helpers ----------

function setView(view: 'editor' | 'output') {
  workspace.dataset.view = view;
  for (const tab of viewTabs.querySelectorAll<HTMLElement>('.view-tab')) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
}

/** Run and Stop have exactly one DOM node each; on phones that node lives in the bottom bar. */
function relocateActions() {
  (narrow.matches ? viewActions : toolbar).append(runButton, stopButton);
}

function applyFontSize() {
  fontIndex = Math.min(FONT_STEPS.length - 1, Math.max(0, fontIndex));
  document.documentElement.style.setProperty('--editor-size', `${FONT_STEPS[fontIndex]}px`);
  localStorage.setItem(FONT_KEY, String(fontIndex));
  fontMinus.disabled = fontIndex === 0;
  fontPlus.disabled = fontIndex === FONT_STEPS.length - 1;
}

function updateDocStats() {
  const doc = editorView.state.doc;
  const text = doc.toString();
  const bytes = new TextEncoder().encode(text).length;
  docStats.textContent = `${doc.lines} lines · ${text.length} chars · ${bytes} bytes · ${languageInfo(currentLanguage()).file}`;
}

function renderShortcuts() {
  shortcutList.innerHTML = '';
  for (const [keys, label] of SHORTCUTS) {
    const item = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = label;
    const kbd = document.createElement('kbd');
    kbd.textContent = keys;
    item.append(text, kbd);
    shortcutList.appendChild(item);
  }
}

function copyOutput() {
  const text = consoleEl.innerText || consoleEl.textContent || '';
  if (!text.trim()) {
    toast('nothing to copy yet — press Run first');
    return;
  }
  if (!navigator.clipboard) {
    toast('the browser blocked the clipboard — select the text instead');
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => {
      toast('output copied');
      play('copy');
    })
    .catch(() => toast('the browser blocked the clipboard — select the text instead'));
}

function openShortcuts() {
  renderShortcuts();
  openSheet(shortcutsSheet);
}

// ---------- challenges ----------

function renderTaskList() {
  const solved = solvedIds();
  taskList.textContent = '';
  const progress = document.createElement('p');
  progress.className = 'task-progress';
  progress.textContent = `${solved.length} / ${TASKS.length} solved on this device`;
  taskList.appendChild(progress);
  for (const task of TASKS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'task-item';
    card.dataset.task = task.id;
    card.classList.toggle('is-solved', solved.includes(task.id));
    const title = document.createElement('strong');
    title.textContent = `${solved.includes(task.id) ? '✓ ' : ''}${task.title}`;
    const brief = document.createElement('span');
    brief.textContent = task.brief;
    const meta = document.createElement('code');
    meta.textContent = `${task.language.toUpperCase()}${task.stdin ? ' · with stdin' : ' · no input'}`;
    card.append(title, brief, meta);
    card.addEventListener('click', () => startTask(task));
    taskList.appendChild(card);
  }
}

function startTask(task: Task) {
  activeTask = task;
  closeSheet(taskSheet);
  setLanguage(task.language);
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: task.starter },
  });
  stdinBox.value = task.stdin ?? '';
  toggleStdin(Boolean(task.stdin));
  clearConsole();
  taskFlag.hidden = false;
  taskFlag.innerHTML = '';
  const label = document.createElement('b');
  label.textContent = task.title;
  taskFlag.append(label, document.createTextNode(` — ${task.brief}`));
  writeLine('system', `Challenge “${task.title}”. Expected output is checked when the program exits with 0.\n`);
  if (narrow.matches) setView('editor');
  editorView.focus();
  persist();
}

function showTasks() {
  renderTaskList();
  openSheet(taskSheet);
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
    flash(outputPane, 'is-shake', 600);
    play('err');
    endRun('fail', 'timed out', true);
  }, RUN_LIMIT_MS);
}

function reportExit(exitCode: number) {
  const now = performance.now();
  // A failed compile never reaches 'ready', so all of the elapsed time belongs to the compiler.
  metricsEl.textContent = programStarted
    ? `compile ${formatMs(runStartedAt - compileStartedAt)} · run ${formatMs(now - runStartedAt)} · exit ${exitCode}`
    : `compile ${formatMs(now - compileStartedAt)} · exit ${exitCode}`;
  flash(metricsEl, 'is-flash');
  if (exitCode === 0) {
    flash(outputPane, 'is-bloom', 900);
    play('ok');
    buzz(35);
    checkTask();
  } else {
    flash(outputPane, 'is-shake', 600);
    play('err');
    buzz([25, 45, 25]);
    showHints(consoleEl.textContent ?? '');
  }
  endRun(exitCode === 0 ? 'ok' : 'fail', exitCode === 0 ? 'done' : `exit ${exitCode}`, false);
}

/** Plain words under the diagnostics, but only when there is something to translate. */
function showHints(text: string) {
  const hints = explainErrors(text);
  hintsEl.textContent = '';
  if (!hints.length) {
    hintsEl.hidden = true;
    return;
  }
  for (const hint of hints) {
    const card = document.createElement('div');
    card.className = 'hint';
    const line = document.createElement('b');
    line.textContent = hint.line;
    line.title = hint.line;
    card.append(line, document.createTextNode(hint.hint));
    hintsEl.appendChild(card);
  }
  hintsEl.hidden = false;
}

function checkTask() {
  if (!activeTask) return;
  if (outputMatches(activeTask, lastStdout)) {
    const firstTime = markSolved(activeTask.id);
    renderTaskList();
    toast(firstTime ? `solved — ${activeTask.title}` : `still correct — ${activeTask.title}`);
    flash(taskFlag, 'is-flash');
  } else {
    toast('output does not match yet — the hint is in the challenge list');
  }
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
  runButton.disabled = !isRunnable(currentLanguage());
  stopButton.disabled = true;
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function run() {
  if (busy) return;
  if (!isRunnable(currentLanguage())) {
    toast(`${languageInfo(currentLanguage()).label} is not runnable in this build yet`);
    openSheet(langGate);
    return;
  }
  if (narrow.matches) setView('output');
  closePipeline();
  closeLens();
  clearConsole();
  programStarted = false;
  compileStartedAt = performance.now();
  runStartedAt = compileStartedAt;
  runButton.disabled = true;
  stopButton.disabled = false;
  setStatus('loading', 'starting…');
  play('run');

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
  task?: string;
}

function currentLanguage(): Language {
  const value = languageSelect.value;
  return value === 'c' || value === 'csharp' ? value : 'cpp';
}

/** Clang is the only compiler in this build, so the inspector never sees the C# buffer. */
function clangLanguage(): 'c' | 'cpp' {
  return currentLanguage() === 'c' ? 'c' : 'cpp';
}

function readState(): SavedState {
  return {
    language: currentLanguage(),
    standard: standardSelect.value,
    code: editorView.state.doc.toString(),
    stdin: stdinBox.value,
    task: activeTask?.id,
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
  // Startup sets the language before the saved session is read; writing then would erase it.
  if (restoring) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readState()));
}

function applyState(state: Partial<SavedState>) {
  if (state.language) setLanguage(state.language);
  else syncStandardSelect();
  if (state.standard) standardSelect.value = state.standard;
  if (state.code !== undefined) editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: state.code } });
  if (state.stdin !== undefined) {
    stdinBox.value = state.stdin;
    if (state.stdin) toggleStdin(true);
  }
  if (state.task) {
    const task = TASKS.find((item) => item.id === state.task);
    if (task) {
      activeTask = task;
      taskFlag.hidden = false;
      taskFlag.innerHTML = '';
      const label = document.createElement('b');
      label.textContent = task.title;
      taskFlag.append(label, document.createTextNode(` — ${task.brief}`));
    }
  }
  langChip.textContent = badgeText();
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
    .then(() => {
      setStatus('ok', 'link copied');
      play('copy');
    })
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
  activeTask = null;
  taskFlag.hidden = true;
  setLanguage(example.language);
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: example.code },
  });
  stdinBox.value = example.stdin ?? '';
  toggleStdin(Boolean(example.stdin));
  clearConsole();
  writeLine('system', `Loaded “${example.label}”. Press Run.\n`);
  updateDocStats();
  persist();
}

function syncSoundButton() {
  soundButton.setAttribute('aria-pressed', String(soundEnabled()));
  soundButton.textContent = soundEnabled() ? 'sound on' : 'sound off';
}

runButton.addEventListener('click', run);
stopButton.addEventListener('click', stop);
syncSoundButton();
soundButton.addEventListener('click', () => {
  setSoundEnabled(!soundEnabled());
  syncSoundButton();
  if (soundEnabled()) play('copy');
});
clearButton.addEventListener('click', clearConsole);
shareButton.addEventListener('click', shareLink);
copyOutputButton.addEventListener('click', copyOutput);
stdinToggle.addEventListener('click', () => toggleStdin());
initPipeline(() => ({
  code: editorView.state.doc.toString(),
  language: clangLanguage(),
  standard: standardSelect.value,
}));
initLenses(
  () => ({
    code: editorView.state.doc.toString(),
    language: clangLanguage(),
    standard: standardSelect.value,
    stdin: stdinBox.value,
  }),
  () => {
    if (narrow.matches) setView('output');
  },
);
inspectButton.addEventListener('click', closeLens);
languageSelect.addEventListener('change', () => {
  setLanguage(currentLanguage());
  editorView.focus();
});
standardSelect.addEventListener('change', () => {
  langChip.textContent = badgeText();
  persist();
});
examplesSelect.addEventListener('change', () => {
  const example = EXAMPLES.find((item) => item.id === examplesSelect.value);
  if (example) loadExample(example);
  examplesSelect.value = '';
});

langChip.addEventListener('click', () => openSheet(langGate));
langGate.addEventListener('click', (event) => {
  if (event.target === langGate) closeSheet(langGate);
});
shortcutsClose.addEventListener('click', () => closeSheet(shortcutsSheet));
shortcutsSheet.addEventListener('click', (event) => {
  if (event.target === shortcutsSheet) closeSheet(shortcutsSheet);
});
helpButton.addEventListener('click', openShortcuts);
tasksButton.addEventListener('click', showTasks);
taskSheet.addEventListener('click', (event) => {
  if (event.target === taskSheet) closeSheet(taskSheet);
});
autoDetectBox.addEventListener('change', () => {
  localStorage.setItem(DETECT_KEY, autoDetectBox.checked ? 'on' : 'off');
  toast(autoDetectBox.checked ? 'language detection is on' : 'language detection is off');
  if (autoDetectBox.checked) scheduleDetection();
});
fontMinus.addEventListener('click', () => {
  fontIndex -= 1;
  applyFontSize();
  toast(`editor text ${FONT_STEPS[Math.max(0, fontIndex)]}px`, 1400);
});
fontPlus.addEventListener('click', () => {
  fontIndex += 1;
  applyFontSize();
  toast(`editor text ${FONT_STEPS[Math.min(FONT_STEPS.length - 1, fontIndex)]}px`, 1400);
});
viewTabs.addEventListener('click', (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLElement>('.view-tab');
  if (tab?.dataset.view) setView(tab.dataset.view as 'editor' | 'output');
});
narrow.addEventListener('change', () => {
  relocateActions();
  setView('editor');
});

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    run();
  } else if ((event.ctrlKey || event.metaKey) && event.key === '/') {
    event.preventDefault();
    if (shortcutsSheet.hidden) openShortcuts();
    else closeSheet(shortcutsSheet);
  } else if ((event.ctrlKey || event.metaKey) && event.key === '.') {
    event.preventDefault();
    if (isRunnable(currentLanguage())) $('inspect').click();
    else toast('the compile pipeline only covers C and C++');
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
    event.preventDefault();
    if (isRunnable(currentLanguage())) $('memory').click();
    else toast('the memory lens needs a compiler this build has');
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    if (isRunnable(currentLanguage())) $('compare').click();
    else toast('the optimisation ladder needs a compiler this build has');
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
    event.preventDefault();
    if (taskSheet.hidden) showTasks();
    else closeSheet(taskSheet);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    clearConsole();
  } else if (event.key === 'Escape') {
    if (anySheetOpen()) closeSheets();
    else if (busy) stop();
  }
});

// ---------- start ----------

buildLanguageSelect();
renderLanguageOptions();
autoDetectBox.checked = localStorage.getItem(DETECT_KEY) !== 'off';
applyFontSize();
relocateActions();
setView('editor');
const storedLanguage = localStorage.getItem(LANG_KEY);
const arrivedWithLink = /code=/.test(location.hash);
setLanguage((storedLanguage as Language | null) ?? 'cpp');
if (!restoreFromLocation()) {
  loadExample(EXAMPLES.find((item) => item.language === currentLanguage()) ?? EXAMPLES[0]);
}
updateDocStats();
restoring = false;
persist();
if (!storedLanguage && !arrivedWithLink) openSheet(langGate);
editorView.focus();
