/*
 * The sketch library: named drafts kept in this browser, so half-finished code survives longer than
 * one session, and a folder of them travels as a JSON file — still with no server involved.
 */

import { play } from './fx';
import type { Language } from './languages';

export interface Draft {
  language: Language;
  standard: string;
  code: string;
  stdin: string;
}

interface Sketch extends Draft {
  id: string;
  name: string;
  savedAt: number;
}

const SKETCH_KEY = 'cpp-forge.sketches';
const MAX_SKETCHES = 40;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const sheet = $<HTMLElement>('sketch-sheet');
const list = $<HTMLElement>('sketch-list');
const nameBox = $<HTMLInputElement>('sketch-name');
const saveButton = $<HTMLButtonElement>('sketch-save');
const closeButton = $<HTMLButtonElement>('sketch-close');
const exportButton = $<HTMLButtonElement>('sketch-export');
const importButton = $<HTMLButtonElement>('sketch-import');
const fileInput = $<HTMLInputElement>('sketch-file');
const libraryButton = $<HTMLButtonElement>('sketches');

let read: () => Draft = () => ({ language: 'cpp', standard: 'c17', code: '', stdin: '' });
let apply: (draft: Draft) => void = () => {};
let notify: (text: string) => void = () => {};

export const isLibraryOpen = (): boolean => !sheet.hidden;

export const closeLibrary = (): void => {
  sheet.hidden = true;
  libraryButton.setAttribute('aria-expanded', 'false');
};

export const openLibrary = (): void => {
  render();
  sheet.hidden = false;
  libraryButton.setAttribute('aria-expanded', 'true');
  nameBox.focus();
};

export function sketches(): Sketch[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SKETCH_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return (parsed as Sketch[]).filter((item) => typeof item?.code === 'string' && typeof item?.name === 'string');
  } catch {
    return [];
  }
}

function store(items: Sketch[]): boolean {
  try {
    localStorage.setItem(SKETCH_KEY, JSON.stringify(items));
    return true;
  } catch {
    notify('the browser refused to store more — delete a sketch and try again');
    return false;
  }
}

const newId = (): string => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

/** The first real line of code names a sketch better than "sketch 7" ever could. */
function suggestName(draft: Draft): string {
  const line = (draft.code.split('\n').map((text) => text.trim()).find((text) => text.length) ?? '').slice(0, 28);
  return line || `${draft.language} sketch`;
}

const when = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function render() {
  const items = sketches();
  list.textContent = '';

  const count = document.createElement('p');
  count.className = 'sketch-count';
  count.textContent = items.length ? `${items.length} of ${MAX_SKETCHES} sketches on this device` : 'nothing saved on this device yet';
  list.appendChild(count);

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'sketch-item';

    const name = document.createElement('strong');
    name.textContent = item.name;

    const meta = document.createElement('span');
    meta.textContent = `${item.language.toUpperCase()} · ${item.code.split('\n').length} lines · ${when(item.savedAt)}`;

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-ghost';
    open.textContent = 'open';
    open.addEventListener('click', () => {
      apply({ language: item.language, standard: item.standard, code: item.code, stdin: item.stdin });
      notify(`opened “${item.name}”`);
      play('copy');
      closeLibrary();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-ghost';
    remove.textContent = 'delete';
    remove.addEventListener('click', () => {
      store(sketches().filter((entry) => entry.id !== item.id));
      render();
      notify(`deleted “${item.name}”`);
    });

    card.append(name, meta, open, remove);
    list.appendChild(card);
  }

  exportButton.disabled = items.length === 0;
}

function save() {
  const draft = read();
  if (!draft.code.trim()) {
    notify('the editor is empty — nothing to save');
    return;
  }
  const named = nameBox.value.trim() || suggestName(draft);
  const kept = sketches().filter((item) => item.name !== named);
  kept.unshift({ ...draft, id: newId(), name: named, savedAt: Date.now() });
  if (!store(kept.slice(0, MAX_SKETCHES))) return;
  nameBox.value = '';
  render();
  notify(`saved “${named}”`);
  play('copy');
}

function exportJson() {
  const items = sketches();
  if (!items.length) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cpp-forge-sketches.json';
  link.click();
  URL.revokeObjectURL(url);
  notify(`${items.length} sketches written to a file`);
}

/** Import merges by name, so the same file can be carried over an existing library safely. */
function merge(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    notify('that file is not JSON');
    return;
  }
  if (!Array.isArray(parsed)) {
    notify('expected a list of sketches');
    return;
  }
  const incoming = (parsed as Sketch[]).filter((item) => typeof item?.code === 'string' && typeof item?.name === 'string');
  if (!incoming.length) {
    notify('no readable sketches in that file');
    return;
  }
  const byName = new Map(sketches().map((item) => [item.name, item]));
  let added = 0;
  for (const item of incoming) {
    if (!byName.has(item.name)) added += 1;
    byName.set(item.name, { ...item, id: item.id || newId(), savedAt: item.savedAt || Date.now() });
  }
  const merged = [...byName.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SKETCHES);
  if (!store(merged)) return;
  render();
  notify(`${added} new, ${incoming.length - added} replaced`);
}

nameBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    save();
  }
});
saveButton.addEventListener('click', save);
closeButton.addEventListener('click', closeLibrary);
exportButton.addEventListener('click', exportJson);
importButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => merge(String(reader.result ?? '')));
  reader.readAsText(file);
  fileInput.value = '';
});
libraryButton.addEventListener('click', openLibrary);

export function initLibrary(readDraft: () => Draft, applyDraft: (draft: Draft) => void, say: (text: string) => void): void {
  read = readDraft;
  apply = applyDraft;
  notify = say;
}
