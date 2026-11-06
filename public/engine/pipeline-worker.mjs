/*
 * Inspection pass for cpp-forge: compiles the same source with the same Clang build as
 * clang-worker.mjs and reports what every stage of the pipeline actually produced — a real
 * `-ftime-trace` breakdown, the LLVM IR, the linked wasm module and its section sizes. Nothing is
 * executed here, the program is only compiled.
 *
 * Protocol: page → { type: 'inspect', code, language: 'c' | 'cpp', standard? }
 *           worker → { type: 'stage', id, status, … } | { type: 'artifact', id, text, note } | { type: 'done' }
 *
 * Kept separate from the vendored engine so that one stays byte-for-byte upstream.
 */

const CLANG_BASE = 'https://cdn.jsdelivr.net/npm/@yowasp/clang@21.1.4-3/';
const ASSETS = new URL('../assets/', import.meta.url);
const PCH = 'cxx20-o2';
const ARTIFACT_LIMIT = 60000;
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

self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type !== 'inspect') return;
  const language = data.language === 'c' ? 'c' : 'cpp';
  const driver = language === 'c' ? 'clang' : 'clang++';
  const file = language === 'c' ? 'main.c' : 'main.cpp';
  const std = language === 'c' ? `-std=${data.standard || 'c17'}` : '-std=c++20';
  const base = [std, '-O2', '-Wall', '-fno-color-diagnostics'];
  const code = String(data.code);
  const files = { [file]: code };
  const runtime = language === 'c' ? {} : await cppRuntime();
  const linkLibs = language === 'c' ? ['-lm'] : runtime['eh.o'] ? ['eh.o'] : [];
  const include = runtime.include ? ['-isystem', '/include'] : [];

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
