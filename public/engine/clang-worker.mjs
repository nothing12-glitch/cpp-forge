/*
 * clang-in-browser: compile and run C and C++ in a browser Web Worker with Clang/LLD 21 compiled to
 * WebAssembly (YoWASP). The program is compiled to wasm32-wasi in memory and run with a minimal WASI
 * host (stdin, stdout, stderr, clocks, randomness; no file system, no network). The toolchain
 * (~23 MB compressed) is downloaded from jsDelivr on the first run and kept for later runs. The page
 * should terminate the worker on a timeout or when the user presses Stop.
 *
 * Protocol: page → { type: 'run', code, stdin, language: 'c' | 'cpp', standard?: 'c89' | … | 'c23' (C only) }
 *           worker → { type: 'status', status: 'loading' | 'busy' | 'ready' } | { type: 'output', stream, text } | { type: 'done', exitCode }
 *
 * https://github.com/devtoolry/clang-in-browser (MIT). Live: https://devtoolry.com/compilers/cpp
 */

import { createWasi } from './wasi-host.mjs';

// The YoWASP build of Clang/LLD. scripts/build-assets.mjs builds the precompiled header for this exact version.
const CLANG_BASE = 'https://cdn.jsdelivr.net/npm/@yowasp/clang@21.1.4-3/';
const MAX_OUTPUT_CHARS = 200000;

const LANGUAGES = {
  c: { driver: 'clang', file: 'main.c', flags: ['-std=c17', '-O2', '-Wall'], libs: ['-lm'] },
  cpp: { driver: 'clang++', file: 'main.cpp', flags: ['-std=c++20', '-O2', '-Wall'], libs: ['eh.o'] },
};
const C_STANDARDS = new Set(['c89', 'c99', 'c11', 'c17', 'c23']);

/** Compiler flags for a run; C may pick its language standard, anything unknown falls back to C17. */
function flagsFor(language, standard) {
  const { flags } = LANGUAGES[language];
  if (language !== 'c' || !C_STANDARDS.has(standard)) return flags;
  return [`-std=${standard}`, ...flags.slice(1)];
}

// Prebuilt by scripts/build-assets.mjs with this exact Clang build (see manifest.json): the C++
// exception stub (eh.cpp → eh.o) and a precompiled header of the common standard headers, which
// cuts a typical C++ compile from 5–9 s to 1–3 s. The header's include list doubles as GCC's
// <bits/stdc++.h>. All are optional: without them the worker compiles eh.cpp itself, parses
// headers normally and has no <bits/stdc++.h>.
const ASSETS = new URL('../assets/', import.meta.url);
const PCH = 'cxx20-o2';
// Diagnostics that can come from the extra headers or a mismatched header; retried without it.
const PCH_TROUBLE = /precompiled|cxx20-o2|redefinition|conflicting|ambiguous|different kind of symbol/i;

let toolchain = null;
let runtime = null; // { 'eh.o': bytes, include: { bits: { 'stdc++.h': text } } }
let pchFiles = null; // Promise of { [name]: bytes } | null once the download is started
let pchReady = null; // the files once downloaded, so a compile never waits for them
let written = 0;
let reported = 0;

function emit(stream, text) {
  if (!text || written > MAX_OUTPUT_CHARS) return;
  written += text.length;
  if (written > MAX_OUTPUT_CHARS) text = `\n[Output truncated after ${MAX_OUTPUT_CHARS} characters]\n`;
  self.postMessage({ type: 'output', stream, text });
}

// The first run downloads the toolchain (~23 MB compressed); report it in quarters.
function progress({ totalLength, doneLength }) {
  const quarter = Math.floor((4 * doneLength) / totalLength);
  if (quarter > reported && quarter < 4) emit('system', `Downloaded ${quarter * 25}%…\n`);
  reported = Math.max(reported, quarter);
}

/**
 * Compiler output arrives a few bytes at a time, each followed by a flush (null); forward it a line
 * at a time instead of posting a message per fragment (or collect it in `buffer`). `end()` sends what is left.
 */
function lineBuffered(stream, buffer) {
  const decoder = new TextDecoder();
  const send = (text) => (buffer ? text && buffer.push([stream, text]) : emit(stream, text));
  let pending = '';
  const write = (bytes) => {
    if (!bytes) return;
    pending += decoder.decode(bytes, { stream: true });
    const end = pending.lastIndexOf('\n') + 1;
    if (end > 0) {
      send(pending.slice(0, end));
      pending = pending.slice(end);
    }
  };
  write.end = () => send(pending + decoder.decode());
  return write;
}

/** Runs a Clang driver; with `buffer`, diagnostics are collected and returned instead of shown. */
async function clang(driver, args, files, buffer) {
  const stdout = lineBuffered('system', buffer);
  const stderr = lineBuffered('stderr', buffer);
  try {
    return await toolchain.commands[driver](args, files, { stdout, stderr, decodeASCII: false, fetchProgress: progress });
  } catch (error) {
    if (error instanceof toolchain.Exit) return null;
    throw error;
  } finally {
    stdout.end();
    stderr.end();
  }
}

async function fetchBytes(name) {
  const response = await fetch(new URL(name, ASSETS));
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The .gz is served as a plain file; unpack it here unless the server already decoded it. */
async function gunzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Starts the precompiled-header download in the background (its version must match the compiler). */
function loadPch() {
  pchFiles ??= (async () => {
    const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes('manifest.json')));
    if (!CLANG_BASE.includes(`@${manifest.clang}/`)) return null;
    const [header, pch] = await Promise.all([fetchBytes(`${PCH}.hpp`), fetchBytes(`${PCH}.pch.gz`).then(gunzip)]);
    pchReady = { [`${PCH}.hpp`]: header, [`${PCH}.pch`]: pch };
    return pchReady;
  })().catch(() => null);
  return pchFiles;
}

/** Files every C++ compile needs: the exception stub and, when available, <bits/stdc++.h>. */
async function cppRuntime() {
  if (runtime) return runtime;
  const [eh, header] = await Promise.all([
    fetchBytes('eh.o').catch(async () => {
      const source = new TextDecoder().decode(await fetchBytes('eh.cpp'));
      return (await clang('clang++', ['-std=c++20', '-O2', '-c', 'eh.cpp', '-o', 'eh.o'], { 'eh.cpp': source }))?.['eh.o'];
    }),
    fetchBytes(`${PCH}.hpp`).catch(() => null),
  ]);
  if (!eh) throw new Error('Could not prepare the C++ runtime.');
  runtime = { 'eh.o': eh, ...(header && { include: { bits: { 'stdc++.h': header } } }) };
  return runtime;
}

/** Returns the wasm32-wasi binary, or null when compilation failed (diagnostics are already shown). */
async function compile(language, code, flags) {
  if (language === 'cpp') loadPch();
  const { driver, file, libs } = LANGUAGES[language];
  const files = { [file]: code };
  if (language === 'cpp') Object.assign(files, await cppRuntime());
  // commands[driver] adds the driver name itself.
  const include = files.include ? ['-isystem', '/include'] : [];
  const args = [...flags, ...include, '-fno-color-diagnostics', file, ...libs, '-o', 'main.wasm'];

  // Use the precompiled header only once it has arrived; the first run never waits for it.
  if (language === 'cpp' && pchReady) {
    const diagnostics = [];
    const output = await clang(driver, ['-include-pch', `${PCH}.pch`, ...args], { ...files, ...pchReady }, diagnostics);
    const text = diagnostics.map(([, chunk]) => chunk).join('');
    if (output?.['main.wasm'] || !PCH_TROUBLE.test(text)) {
      for (const [stream, chunk] of diagnostics) emit(stream, chunk);
      return output?.['main.wasm'] ?? null;
    }
  }
  const output = await clang(driver, args, files);
  return output?.['main.wasm'] ?? null;
}

self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type !== 'run') return;
  written = 0;
  let exitCode = 0;
  try {
    const language = data.language === 'c' ? 'c' : 'cpp';
    const flags = flagsFor(language, data.standard);
    // Compilation is not part of the program's time limit.
    self.postMessage({ type: 'status', status: 'busy' });
    if (!toolchain) {
      self.postMessage({ type: 'status', status: 'loading' });
      toolchain = await import(`${CLANG_BASE}gen/bundle.js`);
    }
    emit('system', `Compiling ${LANGUAGES[language].file} with Clang 21 (${flags.join(' ')})…\n`);
    const binary = await compile(language, String(data.code), flags);
    if (!binary) {
      emit('system', 'Compilation failed.\n');
      self.postMessage({ type: 'done', exitCode: 1 });
      return;
    }
    const program = await WebAssembly.compile(binary);
    const wasi = createWasi({
      args: ['main'],
      stdin: new TextEncoder().encode(String(data.stdin || '')),
      write: (fd, text) => emit(fd === 2 ? 'stderr' : 'stdout', text),
    });
    const instance = await WebAssembly.instantiate(program, wasi.imports);
    self.postMessage({ type: 'status', status: 'ready' });
    exitCode = wasi.start(instance);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (error instanceof WebAssembly.RuntimeError) {
      // abort() (failed assert, uncaught exception) compiles to an `unreachable` trap; other traps
      // are crashes such as out-of-bounds memory access or stack overflow.
      exitCode = message.includes('unreachable') ? 134 : 139;
      emit('stderr', exitCode === 134 ? 'Program aborted.\n' : `Runtime error: ${message}\n`);
    } else {
      exitCode = 1;
      emit('stderr', `${message}\n`);
    }
  }
  self.postMessage({ type: 'done', exitCode });
};
