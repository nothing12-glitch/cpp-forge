/*
 * Compiler output is honest but dense. This maps the diagnostics that students hit most often to a
 * second line in plain words. Only the message text is matched, never line numbers, so a hint is
 * shown next to the error it belongs to rather than instead of it.
 */

interface Rule {
  test: RegExp;
  hint: string;
}

const RULES: Rule[] = [
  {
    test: /expected ';'/,
    hint: 'A statement is missing its semicolon. Look at the line above the one clang points at — the mistake is usually one line earlier.',
  },
  {
    test: /expected '}'/,
    hint: 'A closing brace is missing. Count your `{` and `}` — the compiler stopped looking for the pair of the brace it opened first.',
  },
  {
    test: /no matching function for call to|too (few|many) arguments/,
    hint: 'The function exists, but the arguments do not fit: wrong count or wrong types. Check the declaration above the call.',
  },
  {
    test: /use of undeclared identifier/,
    hint: 'That name was never declared, or it is declared later than this line, or it belongs to a namespace you did not open (`std::`).',
  },
  {
    test: /no member named/,
    hint: 'The object has no such member — a typo, or the wrong type. `xs.lenght` is the classic one: it is `length`.',
  },
  {
    test: /cannot (be converted|initialize)/,
    hint: 'The types do not fit. A `char` is not a string, and an array cannot be assigned after it is declared.',
  },
  {
    test: /undefined reference to|undefined symbol/,
    hint: 'The function is declared but has no body: a missing definition, or a signature that differs from the declaration by one type.',
  },
  {
    test: /declaration does not declare anything|expected unqualified-id/,
    hint: 'A keyword is in the wrong place, or a stray symbol ended the previous line. Read the line before the error too.',
  },
  {
    test: /subscripts filtered|invalid operands to binary|invalid type/,
    hint: 'You are indexing something that is not an array — often a pointer that was never given a size.',
  },
  {
    test: /control reaches end of non-void function/,
    hint: 'A path through the function returns nothing. Every branch needs a `return`, including the fall-through at the end.',
  },
  {
    test: /incompatible pointer types/,
    hint: 'Two pointers of different types met. `&x` where `x` is already an array adds one level of indirection too many.',
  },
  {
    test: /excess elements in scalar initializer/,
    hint: 'Several values went into one plain variable. `int xs = {1, 2, 3}` needs an array: `int xs[3] = {1, 2, 3}`.',
  },
  {
    test: /member reference base type .* is not a structure or union/,
    hint: 'The dot is used on something that is not a struct or a class, so it cannot have members. Check what the variable actually holds.',
  },
  {
    test: /expected expression|expected unqualified-id/,
    hint: 'A statement is cut in half — usually a missing operand, a stray symbol, or the line before it never ended.',
  },
  {
    test: /implicit instantiation of undefined template/,
    hint: 'The template is named but never defined here — a missing `#include`, or the angle brackets do not match the declaration.',
  },
  {
    test: /redefinition of|already declared/,
    hint: 'The same name is declared twice — often the same variable in one loop, or a function body pasted twice.',
  },
];

const GENERIC =
  'clang reports the first error it can prove, and the rest usually cascade from it. Fix this line and run again — the count of errors falling is the signal you are looking for.';

/** Hints for the diagnostics in this console text, deduplicated and capped so the panel stays readable. */
export function explainErrors(text: string): { line: string; hint: string }[] {
  const errors = text
    .split('\n')
    .map((raw) => raw.trim())
    .filter((line) => line.includes('error:'));
  const found: { line: string; hint: string }[] = [];
  const seen = new Set<string>();
  for (const line of errors) {
    for (const rule of RULES) {
      if (!rule.test.test(line) || seen.has(rule.hint)) continue;
      seen.add(rule.hint);
      found.push({ line, hint: rule.hint });
      break;
    }
  }
  if (!found.length && errors.length) found.push({ line: errors[0], hint: GENERIC });
  return found.slice(0, 4);
}
