# cpp·forge

Compile and run **C and C++ entirely in the browser**. No server, no container, no upload — Clang 21
itself is compiled to WebAssembly and runs inside a Web Worker, produces a `wasm32-wasi` binary in
memory, and executes it on the page.

**Live demo:** <https://nothing12-glitch.github.io/cpp-forge/>

## Why it is interesting

Most online C++ playgrounds POST your source to a remote compiler. This one cannot: there is no
backend at all. The toolchain is `@yowasp/clang` (Clang + LLD built to WASI), downloaded once from
jsDelivr and kept in the HTTP cache, and the compiled program runs against a ~150-line WASI host
that provides argv, stdin, stdout, stderr, clocks, randomness and `proc_exit`.

```text
editor → worker → clang++ (wasm) → main.wasm → WASI host → stdout/stderr
```

## Features

- C and C++ with the language-standard picker for C (`c89`…`c23`)
- CodeMirror 6 editor: syntax highlighting, folding, bracket matching, autocomplete, undo history
- stdin panel, per-stream coloured output, compile/run timings and the exit code
- six built-in examples, including one that deliberately fails to compile
- **share link** puts the whole session in the URL hash, so a snippet is a link, not a screenshot
- feedback layer: sparks at the caret while typing, a heat pulse on Run while Clang works, a mint
  bloom on a clean exit, a shake on failure, plus optional sound and haptics — every effect is
  dropped when the system asks for reduced motion
- the last session is restored from `localStorage`
- a run-time limit: an infinite loop is stopped by terminating the worker

## Limits worth knowing

These come from running a real compiler in a sandbox, not from a missing feature:

- **No file system, no network.** `fopen()` fails; only stdin/stdout/stderr exist.
- **Exceptions cannot be caught.** The WASI libc++abi has no exception runtime, so `throw` prints
  `terminate called after throwing an instance of '…'` and aborts, like Emscripten's default.
  `try`/`catch` still compiles.
- **C++ is fixed at `-std=c++20 -O2 -Wall`**; the standard picker applies to C only.
- **The first run downloads ~23 MB** of toolchain; after that compiles take 1–3 s.
- A program is stopped by killing the worker, so output after the kill point is lost.

## Development

```sh
npm install
npm run assets   # optional, see below
npm run dev      # http://localhost:5178
```

`npm run assets` prebuilds a 22 MB precompiled header of the usual standard includes plus the
exception stub, which cuts a typical C++ compile from 5–9 s to 1–3 s. It is a build artifact, not
source, so it is git-ignored and regenerated in CI; without it everything still works, just slower
for C++ and without `<bits/stdc++.h>`.

```sh
npm run build    # typecheck + production bundle in dist/
npm run preview
```

## Deploy

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages. The site needs no
special HTTP headers: the compiler is single-threaded, so there is no `SharedArrayBuffer` and
therefore no COOP/COEP requirement. `vite.config.ts` uses a relative base so the project also works
under the `/<repo>/` project path.

## Credits

The compile-and-run engine is vendored from
[devtoolry/clang-in-browser](https://github.com/devtoolry/clang-in-browser) (MIT) together with
[devtoolry/tiny-wasi-host](https://github.com/devtoolry/tiny-wasi-host) (MIT); the toolchain is
[YoWASP/clang](https://github.com/YoWASP/clang) (ISC) built from [LLVM](https://llvm.org). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
