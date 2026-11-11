import type { Language } from './languages';

/*
 * The trainer: small tasks with an exact expected output, so a run can decide for itself whether the
 * program is right. `expect` is compared after trimming every line and dropping empty ones.
 */

export interface Task {
  id: string;
  title: string;
  brief: string;
  language: Language;
  starter: string;
  stdin?: string;
  expect: string;
  hint: string;
}

export const TASKS: Task[] = [
  {
    id: 'greet',
    title: 'Say the name back',
    brief: 'Read one word and print `Hello, <word>!`',
    language: 'cpp',
    stdin: 'Arsenij\n',
    expect: 'Hello, Arsenij!',
    hint: 'std::cin >> name stops at whitespace, which is exactly what a single word needs.',
    starter: '#include <iostream>\n#include <string>\n\nint main() {\n  std::string name;\n  // read a word, then print the greeting\n}\n',
  },
  {
    id: 'sum-n',
    title: 'Sum of n numbers',
    brief: 'First line is `n`, second line has `n` integers. Print their sum.',
    language: 'cpp',
    stdin: '5\n3 6 9 12 15\n',
    expect: '45',
    hint: 'A running total in a loop is enough; keep it `long long` if the numbers can grow.',
    starter: '#include <iostream>\n\nint main() {\n  int n;\n  std::cin >> n;\n  // read n numbers and add them up\n}\n',
  },
  {
    id: 'fizzbuzz',
    title: 'FizzBuzz, one line each',
    brief: 'Print 1 to 15, one value per line: multiples of 3 are `Fizz`, of 5 `Buzz`, of both `FizzBuzz`.',
    language: 'cpp',
    expect: ['1', '2', 'Fizz', '4', 'Buzz', 'Fizz', '7', '8', 'Fizz', 'Buzz', '11', 'Fizz', '13', '14', 'FizzBuzz'].join('\n'),
    hint: 'Test `i % 15 == 0` before the single ones, or the answer for 15 never appears.',
    starter: '#include <iostream>\n\nint main() {\n  for (int i = 1; i <= 15; ++i) {\n    // one line per i\n  }\n}\n',
  },
  {
    id: 'reverse',
    title: 'Reverse a line',
    brief: 'Read a whole line and print it backwards.',
    language: 'cpp',
    stdin: 'clang wasm\n',
    expect: 'msaw gnalc',
    hint: 'std::getline reads spaces; then iterate the string from `size() - 1` down to 0.',
    starter: '#include <iostream>\n#include <string>\n\nint main() {\n  std::string line;\n  // read the whole line and print it reversed\n}\n',
  },
  {
    id: 'primes-100',
    title: 'How many primes?',
    brief: 'Print how many primes are not greater than 100.',
    language: 'cpp',
    expect: '25',
    hint: 'A sieve of Eratosthenes over an array of 101 bools is the shortest safe way.',
    starter: '#include <iostream>\n\nint main() {\n  // count the primes up to 100 and print the count\n}\n',
  },
  {
    id: 'max-min',
    title: 'Max and min',
    brief: 'Read integers until a `0` arrives. Print `max=… min=…` of everything before it.',
    language: 'cpp',
    stdin: '7 -3 12 4 0\n',
    expect: 'max=12 min=-3',
    hint: 'Seed both with the first value read, not with 0 — otherwise a list of negatives breaks.',
    starter: '#include <iostream>\n\nint main() {\n  int x;\n  // read until 0, remember the extremes\n}\n',
  },
  {
    id: 'sort-desc',
    title: 'Sort descending',
    brief: 'Read 4 integers and print them from the largest down, separated by single spaces.',
    language: 'cpp',
    stdin: '5 2 9 1\n',
    expect: '9 5 2 1',
    hint: 'std::sort with `std::greater<int>()`, or sort ascending and walk the vector backwards.',
    starter:
      '#include <algorithm>\n#include <iostream>\n#include <vector>\n\nint main() {\n  std::vector<int> v(4);\n  for (int& x : v) std::cin >> x;\n  // sort and print\n}\n',
  },
  {
    id: 'c-sieve',
    title: 'Sieve in plain C',
    brief: 'Same as the prime count, but in C: print the count of primes up to 50.',
    language: 'c',
    expect: '15',
    hint: 'Use a `char` array as flags and memset it, or initialise it with `{0}`.',
    starter: '#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n  /* count the primes up to 50 */\n  return 0;\n}\n',
  },
  {
    id: 'c-struct',
    title: 'Distance between points',
    brief: 'In C: read `x1 y1 x2 y2` and print the distance rounded to two decimals.',
    language: 'c',
    stdin: '0 0 3 4\n',
    expect: '5.00',
    hint: 'hypot from <math.h> does the square root and the squaring in one honest call.',
    starter: '#include <stdio.h>\n#include <math.h>\n\nint main(void) {\n  double x1, y1, x2, y2;\n  scanf("%lf %lf %lf %lf", &x1, &y1, &x2, &y2);\n  /* print the distance with two decimals */\n  return 0;\n}\n',
  },
  {
    id: 'transpose',
    title: 'Transpose a matrix',
    brief: 'Read a 2x3 matrix and print its 3x2 transpose, rows on separate lines.',
    language: 'cpp',
    stdin: '1 2 3\n4 5 6\n',
    expect: '1 4\n2 5\n3 6',
    hint: 'Print column by column: the outer loop is the column index of the input.',
    starter: '#include <iostream>\n\nint main() {\n  int a[2][3];\n  for (int i = 0; i < 2; ++i)\n    for (int j = 0; j < 3; ++j) std::cin >> a[i][j];\n  // print the transpose\n}\n',
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

/** Line-by-line, whitespace-tolerant comparison — trailing spaces should never fail a task. */
export function outputMatches(task: Task, stdout: string): boolean {
  const want = cleanLines(task.expect);
  const got = cleanLines(stdout);
  return want.length === got.length && want.every((line, index) => line === got[index]);
}
