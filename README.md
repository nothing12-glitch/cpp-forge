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
- **three languages on entry**: a picker asks C++ / C / C#, the answer is remembered on the device, and
  while you type the editor re-reads the buffer and switches on its own when the code clearly belongs
  to another language (turn that off in the same sheet)
- CodeMirror 6 editor: syntax highlighting, folding, bracket matching, autocomplete, undo history,
  plus an `A−`/`A+` text size that is remembered too
- stdin panel, per-stream coloured output, compile/run timings, exit code and a live
  lines/chars/bytes counter for the buffer
- seventeen built-in examples, filtered to the language on screen, including one that deliberately
  fails to compile
- **challenges**: ten tasks with starter code, input and an expected output; when the program exits 0
  the console is compared line by line and the task is ticked on the device (`Ctrl+J`). When the exit
  code is clean but the answer is wrong, a **diff** panel puts expected and printed side by side,
  marks the first line apart and repeats the task's hint
- **error hints**: when clang stops, the diagnostics are translated into plain words next to the panel —
  matched per message, with a fallback that explains why later errors usually cascade
- **how it compiles** opens the real pipeline: the same source goes through four extra compiler passes
  (`-fsyntax-only`, `-S -emit-llvm`, `-c -ftime-trace`, link) and the panel reports the measured time of
  each one, the top `-ftime-trace` breakdown of codegen, the LLVM IR text and the linked `wasm32-wasi`
  module with its section sizes, exports and imports. Nothing is executed — it is the compiler talking,
  not a simulation (`Ctrl+.`)
- **-O0…-O3** links the same file four times and puts the four modules side by side: real byte counts,
  the code section inside each, and the wall-clock cost of every link, with the size difference of
  `-O3` over `-O0` as the headline (`Ctrl+O`)
- **memory** runs the program once more inside the inspection worker and reads its linear memory while
  it runs: what the module declares, where `__heap_base` and the static data end, how far memory grew,
  the exit code and the section stack of the module it executed. Above the numbers the lens draws the
  measured series itself — heap bytes against the moment of every output write (`Ctrl+M`)
- **share link** puts the whole session in the URL hash, so a snippet is a link, not a screenshot
- **phone layout**: one pane at a time with a `code` / `output` bar in the thumb zone, Run and Stop moved
  into it, 44 px targets, 16 px inputs so iOS does not zoom, and safe-area padding for the notch
- feedback layer: sparks at the caret while typing, a heat pulse on Run while Clang works, a mint
  bloom on a clean exit, a shake on failure, plus optional sound and haptics — every effect is
  dropped when the system asks for reduced motion
- the last session, including the active challenge, is restored from `localStorage`
- a run-time limit: an infinite loop is stopped by terminating the worker

## Limits worth knowing

These come from running a real compiler in a sandbox, not from a missing feature:

- **No file system, no network.** `fopen()` fails; only stdin/stdout/stderr exist.
- **Exceptions cannot be caught.** The WASI libc++abi has no exception runtime, so `throw` prints
  `terminate called after throwing an instance of '…'` and aborts, like Emscripten's default.
  `try`/`catch` still compiles.
- **C++ is fixed at `-std=c++20 -O2 -Wall`**; the standard picker applies to C only.
- **C# is detected and remembered, but not compiled.** This build ships only Clang, so Run and
  *how it compiles* stay disabled while C# is selected — the language layer has a slot for a .NET
  worker, the worker is what is missing. Sending the code to a remote compiler would break the
  no-upload promise above, so it is not done silently.
- **The first run downloads ~23 MB** of toolchain; after that compiles take 1–3 s.
- **The inspection pass is not free**: it really runs four extra compiler passes, so *how it compiles*
  takes roughly 5–12 s depending on the source. The timings it shows are wall-clock time inside the
  sandbox, which is why codegen looks slow — the `-ftime-trace` numbers inside it are the compiler's own.
- **The ladder is four links, so it is slower than one**: expect 8–25 s on a file that pulls in the
  standard library. It re-links your source with `-O0`, `-O1`, `-O2` and `-O3`; only the size and the
  compiler time change, your program never runs there.
- **The memory lens executes the program a second time**, in the inspection worker, and samples the
  memory at every write to stdout/stderr. A program that allocates while staying silent therefore shows
  a floor, not a ceiling; a program that never returns is given up on after 20 s. The lens link adds
  `--export=__heap_base --export=__data_end --export=__stack_pointer`, so its module is a few bytes
  larger than the one Run uses. The chart plots at most 240 points: a program that prints continuously
  has its series halved from inside the worker, so the peak stays exact while the middle thins out.
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
