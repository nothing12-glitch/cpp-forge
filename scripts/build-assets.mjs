#!/usr/bin/env node
/*
 * Prebuilds the C++ precompiled header and exception stub for src/clang-worker.mjs, with the exact
 * Clang build the browser downloads (the version in CLANG_BASE).
 *
 * Parsing <iostream> and friends is most of a C++ compile (5–9 s in the browser); with the
 * precompiled header a typical program compiles in 1–3 s. Building it takes ~30 s and ~20 MB, which
 * is why the browser downloads it instead of building it. Everything here is optional: without
 * these files the worker still works, just slower for C++.
 *
 * Needs Node 20+ and npm (Clang is installed into a temporary folder, not into this project):
 *   node scripts/build-assets.mjs
 * Output: assets/{manifest.json, cxx20-o2.hpp, cxx20-o2.pch.gz, eh.o}
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

// Spawning the `npm` shim is blocked on Windows without a shell (Node CVE-2024-27980), so run npm's
// own CLI script with this same node binary instead.
function npmCli() {
  const nodeDir = dirname(process.execPath);
  for (const candidate of [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Could not locate npm-cli.js next to the node binary.');
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public/assets');
const worker = readFileSync(join(root, 'public/engine/clang-worker.mjs'), 'utf8');
const version = worker.match(/@yowasp\/clang@([^/'"]+)\//)?.[1];
if (!version) throw new Error('CLANG_BASE not found in public/engine/clang-worker.mjs');

// The headers almost every exercise or contest program uses. The worker also serves this list as
// GCC's <bits/stdc++.h>, which libc++ lacks. Keep the flags in sync with LANGUAGES.cpp.
const HEADERS = [
  'algorithm', 'array', 'bit', 'bitset', 'cassert', 'cctype', 'cfloat', 'chrono', 'climits', 'cmath', 'complex',
  'cstdint', 'cstdio', 'cstdlib', 'cstring', 'ctime', 'deque', 'functional', 'iomanip', 'iostream', 'iterator',
  'limits', 'list', 'map', 'memory', 'numbers', 'numeric', 'optional', 'queue', 'random', 'set', 'sstream',
  'stack', 'string', 'string_view', 'tuple', 'unordered_map', 'unordered_set', 'utility', 'vector',
];
const FLAGS = ['-std=c++20', '-O2'];

const work = mkdtempSync(join(tmpdir(), 'clang-pch-'));
try {
  console.log(`Installing @yowasp/clang@${version}…`);
  execFileSync(
    process.execPath,
    [npmCli(), 'install', '--prefix', work, '--no-save', '--silent', `@yowasp/clang@${version}`],
    { stdio: 'inherit' },
  );
  const { commands, Exit } = await import(pathToFileURL(join(work, 'node_modules/@yowasp/clang/gen/bundle.js')).href);

  const clang = async (args, files) => {
    try {
      return await commands['clang++'](args, files, { stdout: null, stderr: (bytes) => bytes && process.stderr.write(bytes), decodeASCII: false });
    } catch (error) {
      if (error instanceof Exit) throw new Error(`clang++ ${args.join(' ')} failed`);
      throw error;
    }
  };

  const header = HEADERS.map((name) => `#include <${name}>`).join('\n') + '\n';
  console.log('Building the precompiled header (about 30 s)…');
  const pch = (await clang([...FLAGS, '-x', 'c++-header', 'cxx20-o2.hpp', '-o', 'cxx20-o2.pch'], { 'cxx20-o2.hpp': header }))['cxx20-o2.pch'];
  const eh = (await clang([...FLAGS, '-c', 'eh.cpp', '-o', 'eh.o'], { 'eh.cpp': readFileSync(join(outDir, 'eh.cpp'), 'utf8') }))['eh.o'];

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'cxx20-o2.hpp'), header);
  writeFileSync(join(outDir, 'cxx20-o2.pch.gz'), gzipSync(pch, { level: 9 }));
  writeFileSync(join(outDir, 'eh.o'), eh);
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ clang: version, flags: FLAGS, headers: HEADERS }, null, 2) + '\n');
  console.log(`Done: ${(pch.length / 1e6).toFixed(1)} MB precompiled header, eh.o ${eh.length} bytes (clang ${version}).`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
