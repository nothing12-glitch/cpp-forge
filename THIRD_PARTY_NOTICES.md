# Third-party notices

cpp-forge is MIT-licensed, but the compiler it runs is not written here. Everything below is
downloaded or vendored as-is, with the licenses recorded for completeness.

## Vendored in this repository

| Path | Origin | License |
| --- | --- | --- |
| `public/engine/clang-worker.mjs` | [devtoolry/clang-in-browser](https://github.com/devtoolry/clang-in-browser) | MIT |
| `public/engine/wasi-host.mjs` | [devtoolry/tiny-wasi-host](https://github.com/devtoolry/tiny-wasi-host) | MIT |
| `public/assets/eh.cpp` | [devtoolry/clang-in-browser](https://github.com/devtoolry/clang-in-browser) | MIT |
| `scripts/build-assets.mjs` | [devtoolry/clang-in-browser](https://github.com/devtoolry/clang-in-browser), adapted for this layout and for spawning npm on Windows | MIT |

These files are kept byte-for-byte where possible so that updating them to a newer upstream
revision stays a copy-paste, not a merge. The engine files are loaded as plain static assets, so
their own relative paths (`../assets/`, `./wasi-host.mjs`) resolve without a bundler.

## Downloaded at runtime

| Component | Where it comes from | License |
| --- | --- | --- |
| Clang/LLD 21.1.4-3 compiled to WebAssembly | `https://cdn.jsdelivr.net/npm/@yowasp/clang@21.1.4-3/` ([YoWASP/clang](https://github.com/YoWASP/clang), author Catherine) | ISC |
| The Clang/LLVM sources that YoWASP builds | [LLVM project](https://llvm.org) | Apache-2.0 WITH LLVM-exception |
| libc++ / WASI sysroot headers used by that build | LLVM + [WASI SDK](https://github.com/WebAssembly/wasi-sdk) | Apache-2.0 WITH LLVM-exception / various |

The browser fetches roughly 23 MB (compressed) on the first Run and the HTTP cache keeps it after
that. Nothing else is downloaded, and no source code leaves the page.

## Build-time dependencies

CodeMirror 6 editor packages (`@codemirror/*`, `@lezer/*`) — MIT. Vite and TypeScript — MIT.
