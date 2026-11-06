// The WASI sysroot's libc++abi has no exception runtime, so `throw` would not link. Like
// Emscripten's default, a throw reports the exception type and aborts; try/catch still compiles.
// Prebuilt into eh.o by scripts/build-assets.mjs; the worker compiles this file if eh.o is missing.
#include <cstdio>
#include <cstdlib>
#include <typeinfo>
extern "C" {
char *__cxa_demangle(const char *, char *, std::size_t *, int *);
void *__cxa_allocate_exception(std::size_t size) noexcept { return std::calloc(1, size); }
void __cxa_free_exception(void *object) noexcept { std::free(object); }
void __cxa_throw(void *, std::type_info *type, void (*)(void *)) {
  int status = 0;
  const char *raw = type ? type->name() : "unknown";
  char *name = __cxa_demangle(raw, nullptr, nullptr, &status);
  std::fflush(stdout);
  std::fprintf(stderr, "terminate called after throwing an instance of '%s'\n", name ? name : raw);
  std::abort();
}
}
