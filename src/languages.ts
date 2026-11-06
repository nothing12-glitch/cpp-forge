/*
 * The language layer: what the playground can compile, how a language is recognised from the text
 * alone, and what the entry screen offers. Detection is deliberately conservative — it only ever
 * answers when one language has clear evidence and the runner-up has none.
 */

export type Language = 'c' | 'cpp' | 'csharp';

export interface LanguageInfo {
  id: Language;
  label: string;
  file: string;
  blurb: string;
  toolchain: string;
  /** False means the editor knows the language, but this build cannot compile it yet. */
  runnable: boolean;
  /** Strong, near-unique signals; each hit counts once. */
  signals: RegExp[];
}

export const LANGUAGES: LanguageInfo[] = [
  {
    id: 'cpp',
    label: 'C++',
    file: 'main.cpp',
    blurb: 'Clang 21, C++20, the whole standard library',
    toolchain: 'clang++ · c++20 · -O2',
    runnable: true,
    signals: [
      /#include\s*<(iostream|vector|string|algorithm|memory|unordered_map|map|set|optional|variant|span|format|numeric|utility|tuple|functional|sstream|queue|stack|deque|array|bit|chrono)\b/,
      /\bstd::/,
      /\bcout\s*<</,
      /\btemplate\s*<\s*(typename|class|[A-Z])/,
      /\bclass\s+\w+\s*[:{]/,
      /\bnullptr\b/,
      /\busing\s+namespace\s+std\b/,
      /\bauto\s*&?\s*\w+\s*=\s*/,
      /\bunique_ptr|shared_ptr|make_(unique|shared)\b/,
      /\bstring_view\b/,
    ],
  },
  {
    id: 'c',
    label: 'C',
    file: 'main.c',
    blurb: 'Clang 21, from C89 to C23, libc and math',
    toolchain: 'clang · c17 · -O2',
    runnable: true,
    signals: [
      /#include\s*<(stdio|stdlib|string|math|time|ctype|assert|errno|limits|float|stddef|inttypes|stdbool)\.h>/,
      /\b(printf|scanf|fputs|fgets|malloc|calloc|realloc|free|memcpy|strlen|strcmp)\s*\(/,
      /\btypedef\s+(struct|union|enum)\b/,
      /\bstruct\s+\w+\s*\{/,
      /\b(size_t|FILE|va_list)\b/,
      /\b(int|void|char|float|double)\s*\*\s*\w+/,
    ],
  },
  {
    id: 'csharp',
    label: 'C#',
    file: 'main.cs',
    blurb: 'The editor recognises it; the .NET runtime is not in this build yet',
    toolchain: '.NET on wasm · planned',
    runnable: false,
    signals: [
      /\busing\s+System\b/,
      /\bConsole\.(Write|Read|WriteLine|ReadLine)/,
      /\bstatic\s+(void|int|string|Task|object|[\w<>,\[\]\.]+)\s+Main\s*\(/,
      /\bnamespace\s+[\w.]+\s*\{/,
      /\bnew\s+(List|Dictionary|HashSet|Queue|Stack)<[^>]*>\s*\(/,
      /\bvar\s+\w+\s*=\s*/,
      /\b(string|int|double|bool)\[\]\s+\w+/,
      /\b(Console\.WriteLine|Math\.Pow|Enumerable|\.Select\(|\.Where\(|\.OrderBy\()/,
      /\bpublic\s+(sealed|static|readonly|partial)?\s*(class|record|struct|enum)\b/,
      /\bprops\s*\{\s*get\b/,
      /\b\w+\s*=>\s*\w+.*;\s*$/m,
    ],
  },
];

export const languageInfo = (id: Language): LanguageInfo =>
  LANGUAGES.find((item) => item.id === id) ?? LANGUAGES[0];

export const isRunnable = (id: Language): boolean => languageInfo(id).runnable;

/**
 * Counts the signals of every language and returns the winner only when it is clearly ahead.
 * A C file and a C++ file share `int main()`, so nothing here is ever a single match.
 */
export function detectLanguage(code: string): Language | null {
  if (!code.trim()) return null;
  const scores = LANGUAGES.map((info) => ({
    id: info.id,
    hits: info.signals.reduce((total, pattern) => total + (pattern.test(code) ? 1 : 0), 0),
  })).sort((a, b) => b.hits - a.hits);
  const [best, second] = scores;
  if (best.hits < 2) return null;
  if (best.hits === second.hits) return null;
  return best.id;
}
