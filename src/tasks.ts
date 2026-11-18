import type { Language } from './languages';

/*
 * The trainer: small tasks with an exact expected output, so a run can decide for itself whether the
 * program is right. Every `expect` is compared after trimming every line and dropping empty ones.
 */

/** One input and the answer it must produce. `stdin` is left out when the task takes no input. */
export interface Case {
  stdin?: string;
  expect: string;
}

export interface Task {
  id: string;
  title: string;
  brief: string;
  language: Language;
  starter: string;
  hint: string;
  /**
   * Two or three of these turn a program that memorised the example into a program that is wrong: the
   * first case is the one shown in the brief, the rest run only after it passes.
   */
  cases: Case[];
}

export const TASKS: Task[] = [
  {
    id: 'greet',
    title: 'Say the name back',
    brief: 'Read one word and print `Hello, <word>!`',
    language: 'cpp',
    hint: 'std::cin >> name stops at whitespace, which is exactly what a single word needs.',
    starter: '#include <iostream>\n#include <string>\n\nint main() {\n  std::string name;\n  // read a word, then print the greeting\n}\n',
    cases: [
      { stdin: 'Arsenij\n', expect: 'Hello, Arsenij!' },
      { stdin: 'z\n', expect: 'Hello, z!' },
      { stdin: 'Oksana\n', expect: 'Hello, Oksana!' },
    ],
  },
  {
    id: 'sum-n',
    title: 'Sum of n numbers',
    brief: 'First line is `n`, second line has `n` integers. Print their sum.',
    language: 'cpp',
    hint: 'A running total in a loop is enough; keep it `long long` if the numbers can grow.',
    starter: '#include <iostream>\n\nint main() {\n  int n;\n  std::cin >> n;\n  // read n numbers and add them up\n}\n',
    cases: [
      { stdin: '5\n3 6 9 12 15\n', expect: '45' },
      { stdin: '1\n7\n', expect: '7' },
      { stdin: '4\n-2 -3 -4 -5\n', expect: '-14' },
    ],
  },
  {
    id: 'fizzbuzz',
    title: 'FizzBuzz, one line each',
    brief: 'Print 1 to 15, one value per line: multiples of 3 are `Fizz`, of 5 `Buzz`, of both `FizzBuzz`.',
    language: 'cpp',
    hint: 'Test `i % 15 == 0` before the single ones, or the answer for 15 never appears.',
    starter: '#include <iostream>\n\nint main() {\n  for (int i = 1; i <= 15; ++i) {\n    // one line per i\n  }\n}\n',
    cases: [
      {
        expect: ['1', '2', 'Fizz', '4', 'Buzz', 'Fizz', '7', '8', 'Fizz', 'Buzz', '11', 'Fizz', '13', '14', 'FizzBuzz'].join('\n'),
      },
    ],
  },
  {
    id: 'reverse',
    title: 'Reverse a line',
    brief: 'Read a whole line and print it backwards.',
    language: 'cpp',
    hint: 'std::getline reads spaces; then iterate the string from `size() - 1` down to 0.',
    starter: '#include <iostream>\n#include <string>\n\nint main() {\n  std::string line;\n  // read the whole line and print it reversed\n}\n',
    cases: [
      { stdin: 'clang wasm\n', expect: 'msaw gnalc' },
      { stdin: 'a\n', expect: 'a' },
      { stdin: '12 34 56\n', expect: '65 43 21' },
    ],
  },
  {
    id: 'primes-100',
    title: 'How many primes?',
    brief: 'Print how many primes are not greater than 100.',
    language: 'cpp',
    hint: 'A sieve of Eratosthenes over an array of 101 bools is the shortest safe way.',
    starter: '#include <iostream>\n\nint main() {\n  // count the primes up to 100 and print the count\n}\n',
    cases: [{ expect: '25' }],
  },
  {
    id: 'max-min',
    title: 'Max and min',
    brief: 'Read integers until a `0` arrives. Print `max=… min=…` of everything before it.',
    language: 'cpp',
    hint: 'Seed both with the first value read, not with 0 — otherwise a list of negatives breaks.',
    starter: '#include <iostream>\n\nint main() {\n  int x;\n  // read until 0, remember the extremes\n}\n',
    cases: [
      { stdin: '7 -3 12 4 0\n', expect: 'max=12 min=-3' },
      { stdin: '-5 -1 -9 0\n', expect: 'max=-1 min=-9' },
      { stdin: '3 3 3 0\n', expect: 'max=3 min=3' },
    ],
  },
  {
    id: 'sort-desc',
    title: 'Sort descending',
    brief: 'Read 4 integers and print them from the largest down, separated by single spaces.',
    language: 'cpp',
    hint: 'std::sort with `std::greater<int>()`, or sort ascending and walk the vector backwards.',
    starter:
      '#include <algorithm>\n#include <iostream>\n#include <vector>\n\nint main() {\n  std::vector<int> v(4);\n  for (int& x : v) std::cin >> x;\n  // sort and print\n}\n',
    cases: [
      { stdin: '5 2 9 1\n', expect: '9 5 2 1' },
      { stdin: '1 1 2 2\n', expect: '2 2 1 1' },
      { stdin: '9 8 7 6\n', expect: '9 8 7 6' },
    ],
  },
  {
    id: 'c-sieve',
    title: 'Sieve in plain C',
    brief: 'Same as the prime count, but in C: print the count of primes up to 50.',
    language: 'c',
    hint: 'Use a `char` array as flags and memset it, or initialise it with `{0}`.',
    starter: '#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n  /* count the primes up to 50 */\n  return 0;\n}\n',
    cases: [{ expect: '15' }],
  },
  {
    id: 'c-struct',
    title: 'Distance between points',
    brief: 'In C: read `x1 y1 x2 y2` and print the distance rounded to two decimals.',
    language: 'c',
    hint: 'hypot from <math.h> does the square root and the squaring in one honest call.',
    starter: '#include <stdio.h>\n#include <math.h>\n\nint main(void) {\n  double x1, y1, x2, y2;\n  scanf("%lf %lf %lf %lf", &x1, &y1, &x2, &y2);\n  /* print the distance with two decimals */\n  return 0;\n}\n',
    cases: [
      { stdin: '0 0 3 4\n', expect: '5.00' },
      { stdin: '2.5 2.5 2.5 2.5\n', expect: '0.00' },
      { stdin: '0 0 -5 12\n', expect: '13.00' },
    ],
  },
  {
    id: 'transpose',
    title: 'Transpose a matrix',
    brief: 'Read a 2x3 matrix and print its 3x2 transpose, rows on separate lines.',
    language: 'cpp',
    hint: 'Print column by column: the outer loop is the column index of the input.',
    starter: '#include <iostream>\n\nint main() {\n  int a[2][3];\n  for (int i = 0; i < 2; ++i)\n    for (int j = 0; j < 3; ++j) std::cin >> a[i][j];\n  // print the transpose\n}\n',
    cases: [
      { stdin: '1 2 3\n4 5 6\n', expect: '1 4\n2 5\n3 6' },
      { stdin: '7 8 9\n1 2 3\n', expect: '7 1\n8 2\n9 3' },
    ],
  },
];

const SOLVED_KEY = 'cpp-forge.solved';

export const solvedIds = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SOLVED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

export function markSolved(id: string): boolean {
  const solved = solvedIds();
  if (solved.includes(id)) return false;
  solved.push(id);
  localStorage.setItem(SOLVED_KEY, JSON.stringify(solved));
  return true;
}

/**
 * The ladder is the order of this file, so what comes next is the first task after this one that is
 * still open — and once the end is reached, the earlier ones that were skipped, rather than nothing.
 */
export function nextUnsolvedTask(currentId: string): Task | null {
  const at = TASKS.findIndex((task) => task.id === currentId);
  if (at < 0) return null;
  const solved = solvedIds();
  return [...TASKS.slice(at + 1), ...TASKS.slice(0, at)].find((task) => !solved.includes(task.id)) ?? null;
}

const cleanLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export interface DiffRow {
  line: number;
  expected: string;
  actual: string;
  state: 'same' | 'differ' | 'missing' | 'extra';
}

/**
 * Line-by-line view of a challenge attempt, normalised exactly the way the checker normalises, so the
 * panel never points at a difference the comparison itself ignores.
 */
export function diffOutput(expected: string, actual: string): DiffRow[] {
  const want = cleanLines(expected);
  const got = cleanLines(actual);
  const rows: DiffRow[] = [];
  for (let index = 0; index < Math.max(want.length, got.length); index += 1) {
    const left = want[index];
    const right = got[index];
    rows.push({
      line: index + 1,
      expected: left ?? '',
      actual: right ?? '',
      state: left === right ? 'same' : left === undefined ? 'extra' : right === undefined ? 'missing' : 'differ',
    });
  }
  return rows;
}

export const firstDifference = (rows: DiffRow[]): DiffRow | undefined => rows.find((row) => row.state !== 'same');

/** Line-by-line, whitespace-tolerant comparison — trailing spaces should never fail a check. */
export function caseMatches(item: Case, stdout: string): boolean {
  const want = cleanLines(item.expect);
  const got = cleanLines(stdout);
  return want.length === got.length && want.every((line, index) => line === got[index]);
}

/** What one check decided, kept so the board can show every check of the run at the same time. */
export interface CaseResult {
  index: number;
  stdin: string;
  expect: string;
  got: string;
  ok: boolean;
  why: 'wrong' | 'exit' | 'timeout';
}

export const checkWord = (count: number): string => `${count} ${count === 1 ? 'check' : 'checks'}`;

/** What a failed check actually did, in the fewest words that fit a status chip. */
export const reasonWord = (why: CaseResult['why']): string =>
  why === 'timeout' ? 'never stopped' : why === 'exit' ? 'crashed' : 'differs';

/** A line of console text folded short enough to sit in one row of the board. */
export const shortLine = (text: string): string => {
  const flat = text.trim().replace(/\s+/g, ' ');
  if (!flat) return 'nothing';
  return flat.length > 46 ? `${flat.slice(0, 45)}…` : flat;
};
