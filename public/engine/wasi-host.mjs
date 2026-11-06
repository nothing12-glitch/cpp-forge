/*
 * tiny-wasi-host: a minimal WASI preview1 host for running a wasm32-wasi command (a C, C++ or Rust
 * program) in a browser Web Worker. It provides argv, stdin, stdout, stderr, clocks, randomness and
 * exit. There is no file system and no network: fopen() and similar calls fail with an error code,
 * and any other import returns ENOSYS.
 *
 * Copied from https://github.com/devtoolry/tiny-wasi-host (MIT). Used by https://devtoolry.com/compilers/c
 */

const ESUCCESS = 0;
const EBADF = 8;
const EINVAL = 28;
const ENOSYS = 52;
const ESPIPE = 70;

export class WasiExit extends Error {
  constructor(code) {
    super(`exit(${code})`);
    this.code = code;
  }
}

/**
 * @param {{ args: string[], stdin: Uint8Array, write: (fd: number, text: string) => void }} options
 * @returns {{ imports: WebAssembly.Imports, start: (instance: WebAssembly.Instance) => number }}
 */
export function createWasi({ args, stdin, write }) {
  let memory = null;
  let stdinOffset = 0;
  const encoder = new TextEncoder();
  const decoders = { 1: new TextDecoder(), 2: new TextDecoder() };
  const argBytes = args.map((arg) => encoder.encode(`${arg}\0`));

  const view = () => new DataView(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);

  function iovecs(ptr, count) {
    const dv = view();
    const list = [];
    for (let i = 0; i < count; i += 1) list.push([dv.getUint32(ptr + i * 8, true), dv.getUint32(ptr + i * 8 + 4, true)]);
    return list;
  }

  function writeStrings(list, ptrs, buf) {
    const dv = view();
    let offset = buf;
    list.forEach((item, i) => {
      dv.setUint32(ptrs + i * 4, offset, true);
      bytes().set(item, offset);
      offset += item.length;
    });
    return ESUCCESS;
  }

  const wasi = {
    args_sizes_get(countPtr, sizePtr) {
      view().setUint32(countPtr, argBytes.length, true);
      view().setUint32(sizePtr, argBytes.reduce((sum, item) => sum + item.length, 0), true);
      return ESUCCESS;
    },
    args_get: (ptrs, buf) => writeStrings(argBytes, ptrs, buf),
    environ_sizes_get(countPtr, sizePtr) {
      view().setUint32(countPtr, 0, true);
      view().setUint32(sizePtr, 0, true);
      return ESUCCESS;
    },
    environ_get: () => ESUCCESS,
    fd_write(fd, iovs, count, writtenPtr) {
      if (fd !== 1 && fd !== 2) return EBADF;
      let written = 0;
      for (const [ptr, len] of iovecs(iovs, count)) {
        write(fd, decoders[fd].decode(bytes().subarray(ptr, ptr + len), { stream: true }));
        written += len;
      }
      view().setUint32(writtenPtr, written, true);
      return ESUCCESS;
    },
    fd_read(fd, iovs, count, readPtr) {
      if (fd !== 0) return EBADF;
      let read = 0;
      for (const [ptr, len] of iovecs(iovs, count)) {
        const chunk = stdin.subarray(stdinOffset, stdinOffset + len);
        bytes().set(chunk, ptr);
        stdinOffset += chunk.length;
        read += chunk.length;
        if (chunk.length < len) break;
      }
      view().setUint32(readPtr, read, true);
      return ESUCCESS;
    },
    fd_fdstat_get(fd, ptr) {
      if (fd > 2) return EBADF;
      const dv = view();
      dv.setUint8(ptr, 2); // character device
      dv.setUint16(ptr + 2, 0, true);
      dv.setBigUint64(ptr + 8, 0n, true);
      dv.setBigUint64(ptr + 16, 0n, true);
      return ESUCCESS;
    },
    fd_close: (fd) => (fd <= 2 ? ESUCCESS : EBADF),
    fd_seek: (fd) => (fd <= 2 ? ESPIPE : EBADF),
    fd_prestat_get: () => EBADF, // no preopened directories
    fd_prestat_dir_name: () => EBADF,
    clock_res_get(id, ptr) {
      view().setBigUint64(ptr, 1000n, true);
      return ESUCCESS;
    },
    clock_time_get(id, precision, ptr) {
      const ns = id === 0 ? BigInt(Date.now()) * 1_000_000n : BigInt(Math.round(performance.now() * 1e6));
      if (id > 3) return EINVAL;
      view().setBigUint64(ptr, ns, true);
      return ESUCCESS;
    },
    random_get(ptr, len) {
      for (let offset = 0; offset < len; offset += 65536) {
        crypto.getRandomValues(bytes().subarray(ptr + offset, ptr + Math.min(len, offset + 65536)));
      }
      return ESUCCESS;
    },
    sched_yield: () => ESUCCESS,
    proc_exit(code) {
      throw new WasiExit(code);
    },
  };

  const imports = {
    wasi_snapshot_preview1: new Proxy(wasi, { get: (target, name) => target[name] ?? (() => ENOSYS) }),
  };

  function start(instance) {
    memory = instance.exports.memory;
    try {
      instance.exports._start();
      return 0;
    } catch (error) {
      if (error instanceof WasiExit) return error.code;
      throw error;
    } finally {
      for (const fd of [1, 2]) {
        const rest = decoders[fd].decode();
        if (rest) write(fd, rest);
      }
    }
  }

  return { imports, start };
}
