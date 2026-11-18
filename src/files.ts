/*
 * Code that lives on this computer, brought into the editor without a server in between: a picker, a
 * drop target, and nothing else. The bytes go from the disk into this script and never further.
 */

import { play } from './fx';
import { detectLanguage, isRunnable, languageInfo, type Language } from './languages';

export interface Picked {
  name: string;
  language: Language;
  code: string;
  lines: number;
}

/** A file this large is not a lesson, and the whole thing has to live in the tab. */
const MAX_BYTES = 512 * 1024;

const CPP_EXTENSIONS = ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.inl', '.ipp', '.tpp'];
/** The MIME type is in the list too: a phone picker filters by it, not by the bare extensions. */
const ACCEPT = '.c,.h,.cpp,.cc,.cxx,.hpp,.hh,.hxx,.inl,.ipp,.tpp,.cs,.txt,text/plain';

const extensionOf = (name: string): string => (name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();

/**
 * An extension is the author's own words about the file, so it outranks the detector; only a `.h` or a
 * nameless file leaves the question to the text, where `std::` and `#include <stdio.h>` do settle it.
 */
function languageFor(name: string, code: string): Language {
  const ext = extensionOf(name);
  if (ext === '.cs') return 'csharp';
  if (ext === '.c') return 'c';
  if (CPP_EXTENSIONS.includes(ext)) return 'cpp';
  return detectLanguage(code) ?? 'cpp';
}

const looksBinary = (code: string): boolean =>
  code.includes('\u0000') || (code.length > 0 && (code.match(/\uFFFD/g)?.length ?? 0) / code.length > 0.02);

function readFile(file: File, onPick: (picked: Picked) => void, say: (text: string) => void): void {
  if (extensionOf(file.name) === '.json') {
    say('that is a sketches file — import it from “my code” instead');
    return;
  }
  if (file.size > MAX_BYTES) {
    say(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — this page keeps the whole file in the tab`);
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    const code = String(reader.result ?? '');
    if (looksBinary(code)) {
      say(`${file.name} does not look like a text file`);
      return;
    }
    onPick({
      name: file.name,
      language: languageFor(file.name, code),
      code,
      lines: code.replace(/\r?\n$/, '').split('\n').length,
    });
  });
  reader.addEventListener('error', () => say(`the browser would not hand over ${file.name}`));
  reader.readAsText(file);
}

export function initFiles(onPick: (picked: Picked) => void, say: (text: string) => void): void {
  const button = document.getElementById('open-file');
  const input = document.getElementById('open-file-input') as HTMLInputElement | null;
  const pane = document.getElementById('editor-pane');
  if (!button || !input || !pane) return;

  input.accept = ACCEPT;

  const take = (file: File) => {
    readFile(file, (picked) => {
      onPick(picked);
      play('copy');
      const info = languageInfo(picked.language);
      say(
        isRunnable(picked.language)
          ? `opened ${picked.name} · ${picked.lines} ${picked.lines === 1 ? 'line' : 'lines'} · ${info.label} — Ctrl+Z brings back what was here`
          : `opened ${picked.name} · ${info.label} is recognised, but this build cannot compile it yet`,
      );
    }, say);
  };

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) take(file);
    input.value = '';
  });

  // A drop that the page did not claim makes the browser throw away the tab and load the file instead.
  let inside = 0;
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
  pane.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    inside += 1;
    pane.classList.add('is-drop');
  });
  pane.addEventListener('dragover', (event) => event.preventDefault());
  pane.addEventListener('dragleave', () => {
    inside -= 1;
    if (inside <= 0) {
      inside = 0;
      pane.classList.remove('is-drop');
    }
  });
  pane.addEventListener('drop', (event) => {
    inside = 0;
    pane.classList.remove('is-drop');
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    event.preventDefault();
    take(file);
  });
}
