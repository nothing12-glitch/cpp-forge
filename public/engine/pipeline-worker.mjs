/*
 * Inspection pass for cpp-forge: compiles the same source with the same Clang build as
 * clang-worker.mjs and reports what every stage of the pipeline actually produced — a real
 * `-ftime-trace` breakdown, the LLVM IR, the linked wasm module and its section sizes.
 *
 * Protocol: page → { type: 'inspect' | 'compare' | 'memscan', code, language: 'c' | 'cpp', standard?, stdin? }
 *           worker → { type: 'stage', id, status, … } | { type: 'artifact', id, text, note }
 *                    | { type: 'level', id, … } | { type: 'memory', … } | { type: 'done' }
 *
 * `inspect` and `compare` only compile. `memscan` really runs the program in this worker, because
 * the growth of the linear memory is only visible while the program is alive.
 *
 * Kept separate from the vendored engine so that one stays byte-for-byte upstream.
 */

import { createWasi } from './wasi-host.mjs';

const CLANG_BASE = 'https://cdn.jsdelivr.net/npm/@yowasp/clang@21.1.4-3/';
const ASSETS = new URL('../assets/', import.meta.url);
const PCH = 'cxx20-o2';
const ARTIFACT_LIMIT = 60000;
const MEMORY_POINTS = 240;
const MEMORY_BUFFER = 4800;
// Diagnostics that mean the header (or a version mismatch) is at fault, not the user's code.
const PCH_TROUBLE = /precompiled|cxx20-o2|redefinition|conflicting|ambiguous|different kind of symbol/i;

const SECTION_NAMES = [
  'custom', 'type', 'import', 'function', 'table', 'memory', 'global', 'export', 'start', 'element',
  'code', 'data', 'data count',
];

let toolchain = null;
let runtime = null;
let pchReady = null;

function stage(id, props) {
  self.postMessage({ type: 'stage', id, ...props });
}

async function fetchBytes(name) {
  const response = await fetch(new URL(name, ASSETS));
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function gunzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The precompiled header, downloaded once; without it every stage parses all of libc++ again. */
async function loadPch() {
  if (pchReady !== null) return pchReady;
  try {
    const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes('manifest.json')));
    if (!CLANG_BASE.includes(`@${manifest.clang}/`)) return (pchReady = false);
    const [header, pch] = await Promise.all([fetchBytes(`${PCH}.hpp`), fetchBytes(`${PCH}.pch.gz`).then(gunzip)]);
    pchReady = { [`${PCH}.hpp`]: header, [`${PCH}.pch`]: pch };
  } catch {
    pchReady = false;
  }
  return pchReady;
}

/** The exception stub and the <bits/stdc++.h> shim the normal run links against. */
async function cppRuntime() {
  if (runtime) return runtime;
  const eh = await fetchBytes('eh.o').catch(() => null);
  const header = await fetchBytes(`${PCH}.hpp`).catch(() => null);
  runtime = { ...(eh && { 'eh.o': eh }), ...(header && { include: { bits: { 'stdc++.h': header } } }) };
  return runtime;
}

let lastDiagnostics = '';

async function clang(driver, args, files) {
  const chunks = [];
  const collect = (bytes) => bytes && chunks.push(new TextDecoder().decode(bytes));
  collect.end = () => {};
  try {
    return await toolchain.commands[driver](args, files, { stdout: null, stderr: collect, decodeASCII: false, fetchProgress: () => {} });
  } catch {
    return null;
  } finally {
    lastDiagnostics = chunks.join('');
  }
}

/** Runs a stage with the precompiled header when it is available, retrying without it only when the
 *  header itself is what failed (a real diagnostic in the user's code must not cost a second pass). */
async function withPch(driver, args, files, extra = {}) {
  const pch = await loadPch();
  if (pch) {
    const out = await clang(driver, ['-include-pch', `${PCH}.pch`, ...args], { ...files, ...pch, ...extra });
    if (out || !PCH_TROUBLE.test(lastDiagnostics)) return out;
  }
  return clang(driver, args, { ...files, ...extra });
}

/** Chrome trace format: sum every event name and keep the four that cost the most. */
function tracePhases(json) {
  try {
    const events = JSON.parse(new TextDecoder().decode(json)).traceEvents || [];
    const totals = new Map();
    for (const event of events) {
      const name = event.name || '';
      // "Total ExecuteCompiler" repeats the parent event; the trace also nests passes we do not show.
      if (event.ph !== 'X' || typeof event.dur !== 'number' || name.startsWith('Total ')) continue;
      totals.set(name, (totals.get(name) || 0) + event.dur / 1000);
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, ms]) => ({ name, ms: Math.round(ms) }));
  } catch {
    return [];
  }
}

/** Walks the wasm section table so the binary can be shown as a stack of real sizes. */
function wasmSections(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  const readLEB = () => {
    let value = 0;
    let shift = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      value |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) break;
      shift += 7;
    }
    return value >>> 0;
  };
  const sections = [];
  while (offset < bytes.length) {
    const id = readLEB();
    const size = readLEB();
    sections.push({ id, name: SECTION_NAMES[id] || `section ${id}`, bytes: size });
    offset += size;
  }
  return sections.filter((s) => s.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 6);
}

function formatBytes(count) {
  return count < 1024 ? `${count} B` : `${(count / 1024).toFixed(1)} kB`;
}

/** Everything the three passes share: which driver, which file, which libraries. */
async function prepare(data) {
  const language = data.language === 'c' ? 'c' : 'cpp';
  const driver = language === 'c' ? 'clang' : 'clang++';
  const file = language === 'c' ? 'main.c' : 'main.cpp';
  const std = language === 'c' ? `-std=${data.standard || 'c17'}` : '-std=c++20';
  const files = { [file]: String(data.code) };
  const runtime = language === 'c' ? {} : await cppRuntime();
  return {
    language,
    driver,
    file,
    std,
    files,
    runtime,
    linkLibs: language === 'c' ? ['-lm'] : runtime['eh.o'] ? ['eh.o'] : [],
    include: runtime.include ? ['-isystem', '/include'] : [],
  };
}

const LEVELS = ['-O0', '-O1', '-O2', '-O3'];

/** The same source linked four times, once per optimisation level, with the honest cost of each. */
async function runCompare(data) {
  const { driver, file, std, files, runtime, linkLibs, include } = await prepare(data);
  if (!toolchain) toolchain = await import(`${CLANG_BASE}gen/bundle.js`);
  const base = [std, '-Wall', '-fno-color-diagnostics'];
  for (const level of LEVELS) {
    self.postMessage({ type: 'level', id: level, status: 'running' });
    const started = performance.now();
    const linked = await withPch(driver, [...base, level, ...include, file, ...linkLibs, '-o', 'main.wasm'], files, runtime);
    const module = linked?.['main.wasm'];
    self.postMessage({
      type: 'level',
      id: level,
      status: module ? 'done' : 'failed',
      ms: Math.round(performance.now() - started),
      bytes: module?.length ?? 0,
      sections: module ? wasmSections(module) : [],
      note: module ? '' : lastDiagnostics.slice(0, 300),
    });
  }
  self.postMessage({ type: 'done' });
}

/**
 * Evenly subsample a measured series down to `limit` points. The first and last point always survive,
 * so the chart keeps the true start and end of the run.
 */
function thin(points, limit) {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  const kept = [];
  for (let index = 0; index < limit; index += 1) kept.push(points[Math.round(index * step)]);
  return kept;
}

/**
 * The linear memory as the machine sees it: what the module declares, where the heap starts, and how
 * far it grew while the program ran. Growth is sampled at every output write, so `peak` is the high
 * water mark between prints — a real measurement, not an estimate, but only as dense as the output.
 *
 * This link is asked to export __heap_base/__data_end/__stack_pointer; without them the linker keeps
 * those globals internal and the lens can only report what the memory itself says.
 */
async function runMemscan(data) {
  const { driver, file, std, files, runtime, linkLibs, include } = await prepare(data);
  if (!toolchain) toolchain = await import(`${CLANG_BASE}gen/bundle.js`);
  const base = [std, '-O2', '-Wall', '-fno-color-diagnostics'];
  const symbols = ['-Wl,--export=__heap_base', '-Wl,--export=__data_end', '-Wl,--export=__stack_pointer'];
  const linked = await withPch(driver, [...base, ...symbols, ...include, file, ...linkLibs, '-o', 'main.wasm'], files, runtime);
  const module = linked?.['main.wasm'];
  if (!module) {
    self.postMessage({ type: 'memory', status: 'failed', note: lastDiagnostics.slice(0, 400) });
    self.postMessage({ type: 'done' });
    return;
  }

  const compiled = new WebAssembly.Module(module);
  const needsImportedMemory = WebAssembly.Module.imports(compiled).some((item) => item.kind === 'memory');
  let memory = null;
  let peak = 0;
  let writes = 0;
  let series = [];
  const startedAt = performance.now();
  const remember = () => {
    if (!memory) return;
    const bytes = memory.buffer.byteLength;
    writes += 1;
    peak = Math.max(peak, bytes);
    series.push({ t: Math.round(performance.now() - startedAt), bytes });
    // A program that prints continuously must not grow this array without bound; dropping every
    // second point keeps the shape and peak (measured above) while halving the memory used.
    if (series.length > MEMORY_BUFFER) series = series.filter((_, index) => index % 2 === 0);
  };
  const wasi = createWasi({
    args: ['main'],
    stdin: new TextEncoder().encode(String(data.stdin || '')),
    write: remember,
  });
  const imports = { ...wasi.imports };
  if (needsImportedMemory) {
    memory = new WebAssembly.Memory({ initial: 256, maximum: 4096 });
    imports.env = { ...(imports.env || {}), memory };
  }

  const instance = await WebAssembly.instantiate(compiled, imports);
  if (!memory) memory = instance.exports.memory;
  const declared = memory.buffer.byteLength;
  const global = (name) => {
    const value = instance.exports[name];
    return value && typeof value.value === 'number' ? value.value : null;
  };
  const before = memory.buffer.byteLength;
  series.unshift({ t: 0, bytes: before });
  let exitCode = null;
  let crashed = '';
  try {
    exitCode = wasi.start(instance);
  } catch (error) {
    crashed = (error && error.message) || String(error);
  }
  const after = memory.buffer.byteLength;
  series.push({ t: Math.round(performance.now() - startedAt), bytes: after });

  self.postMessage({
    type: 'memory',
    status: 'done',
    moduleBytes: module.length,
    sections: wasmSections(module),
    pages: declared / 65536,
    declared,
    before,
    peak: Math.max(peak, after),
    after,
    samples: thin(series, MEMORY_POINTS),
    writeCount: writes,
    grew: Math.max(0, Math.max(peak, after) - before),
    heapBase: global('__heap_base'),
    dataEnd: global('__data_end'),
    stackPointer: global('__stack_pointer'),
    shared: needsImportedMemory,
    exitCode,
    crashed,
  });
  self.postMessage({ type: 'done' });
}

self.onmessage = async (event) => {
  const data = event.data || {};
  try {
    if (data.type === 'compare') return await runCompare(data);
    if (data.type === 'memscan') return await runMemscan(data);
  } catch (error) {
    self.postMessage({ type: 'memory', status: 'failed', note: (error && error.message) || String(error) });
    self.postMessage({ type: 'done' });
    return;
  }
  if (data.type !== 'inspect') return;
  const { language, driver, file, std, files, runtime, linkLibs, include } = await prepare(data);
  const base = [std, '-O2', '-Wall', '-fno-color-diagnostics'];

  const started = performance.now();
  const since = (t) => Math.round(performance.now() - t);
  try {
    stage('toolchain', { status: 'running', note: 'loading Clang…' });
    if (!toolchain) toolchain = await import(`${CLANG_BASE}gen/bundle.js`);
    stage('toolchain', { status: 'done', ms: since(started) });

    stage('parse', { status: 'running' });
    const t0 = performance.now();
    const parsed = await withPch(driver, [...base, ...include, '-fsyntax-only', file], files);
    stage('parse', { status: parsed ? 'done' : 'failed', ms: since(t0), note: parsed ? '' : lastDiagnostics.slice(0, 500) });
    if (!parsed) {
      self.postMessage({ type: 'done' });
      return;
    }

    stage('ir', { status: 'running' });
    const t1 = performance.now();
    const ir = await withPch(driver, [...base, ...include, '-S', '-emit-llvm', file, '-o', 'main.ll'], files);
    const irText = ir?.['main.ll'] ? new TextDecoder().decode(ir['main.ll']) : '';
    stage('ir', { status: ir ? 'done' : 'failed', ms: since(t1), bytes: irText.length });
    if (irText) {
      const lines = irText.split('\n').length;
      self.postMessage({
        type: 'artifact',
        id: 'ir',
        text: irText.slice(0, ARTIFACT_LIMIT),
        note: `${formatBytes(irText.length)} · ${lines} lines${irText.length > ARTIFACT_LIMIT ? ' · shown up to 60 kB' : ''}`,
      });
    }

    stage('codegen', { status: 'running' });
    const t2 = performance.now();
    const obj = await withPch(driver, [...base, ...include, '-c', file, '-o', 'main.o', '-ftime-trace'], files);
    stage('codegen', {
      status: obj ? 'done' : 'failed',
      ms: since(t2),
      bytes: obj?.['main.o']?.length ?? 0,
      phases: obj?.['main.json'] ? tracePhases(obj['main.json']) : [],
      note: obj ? '' : lastDiagnostics.slice(0, 500),
    });

    stage('wasm', { status: 'running' });
    const t3 = performance.now();
    const linked = await withPch(driver, [...base, ...include, file, ...linkLibs, '-o', 'main.wasm'], files, runtime);
    const module = linked?.['main.wasm'];
    const sections = module ? wasmSections(module) : [];
    stage('wasm', { status: module ? 'done' : 'failed', ms: since(t3), bytes: module?.length ?? 0, sections });
    if (module) {
      const summary = sections.map((s) => `${s.name.padEnd(11)} ${formatBytes(s.bytes)}`).join('\n');
      // The bytes only become a module once validated, which is also what Run does before instantiating.
      const compiled = new WebAssembly.Module(module);
      const names = WebAssembly.Module.exports(compiled).map((e) => e.name).join(', ') || '(none)';
      const needs = [...new Set(WebAssembly.Module.imports(compiled).map((i) => i.module))].join(', ');
      self.postMessage({
        type: 'artifact',
        id: 'wasm',
        text: `wasm32-wasi module · ${formatBytes(module.length)} · this is exactly what Run executes\n\n${summary}\n\nexports: ${names}\nimports: ${needs || '(none)'}`,
        note: 'built in memory, never leaves the page',
      });
    }
  } catch (error) {
    stage('error', { status: 'failed', note: (error && error.message) || String(error) });
  }
  self.postMessage({ type: 'done' });
};
