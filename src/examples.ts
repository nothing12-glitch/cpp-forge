import type { Language } from './languages';

export type { Language };

export interface Example {
  id: string;
  label: string;
  language: Language;
  code: string;
  stdin?: string;
}

/** One line per snippet so the whole catalogue stays readable. */
export const EXAMPLES: Example[] = [
  {
    id: 'hello',
    label: 'hello world',
    language: 'cpp',
    code: '#include <iostream>\n\nint main() {\n  std::cout << "hello from cpp-forge\\n";\n}\n',
  },
  {
    id: 'vectors',
    label: 'vector + algorithms',
    language: 'cpp',
    code:
      '#include <algorithm>\n#include <iostream>\n#include <numeric>\n#include <vector>\n\nint main() {\n  std::vector<int> v{5, 3, 9, 1, 7};\n  std::sort(v.begin(), v.end());\n\n  for (int x : v) std::cout << x << \' \';\n  std::cout << "\\nsum = " << std::accumulate(v.begin(), v.end(), 0) << \'\\n\';\n}\n',
  },
  {
    id: 'stdin',
    label: 'read stdin',
    language: 'cpp',
    stdin: '4\n10 20 30 40\n',
    code:
      '#include <iostream>\n\nint main() {\n  int n;\n  std::cin >> n;\n\n  long long sum = 0;\n  for (int i = 0; i < n; ++i) {\n    int x;\n    std::cin >> x;\n    sum += x;\n  }\n\n  std::cout << "sum = " << sum << \'\\n\';\n}\n',
  },
  {
    id: 'templates',
    label: 'templates + struct',
    language: 'cpp',
    code:
      '#include <iostream>\n#include <string>\n#include <vector>\n\ntemplate <typename T>\nT reduce(const std::vector<T>& items, T (*combine)(T, T)) {\n  T acc = items.front();\n  for (size_t i = 1; i < items.size(); ++i) acc = combine(acc, items[i]);\n  return acc;\n}\n\nint multiply(int a, int b) { return a * b; }\n\nint main() {\n  std::vector<int> nums{2, 3, 5, 7};\n  std::cout << "product = " << reduce(nums, multiply) << \'\\n\';\n}\n',
  },
  {
    id: 'diagnostics',
    label: 'see compiler errors',
    language: 'cpp',
    code: '#include <iostream>\n\nint main() {\n  int xs = {1, 2, 3};\n  std::cout << xs.lenght << \'\\n\';\n}\n',
  },
  {
    id: 'bits',
    label: 'bits/stdc++.h',
    language: 'cpp',
    code: '#include <bits/stdc++.h>\n\nusing namespace std;\n\nint main() {\n  vector<string> names{"ada", "linus", "ken"};\n  sort(names.begin(), names.end(), [](const string& a, const string& b) { return a.size() < b.size(); });\n\n  for (const auto& name : names) cout << name << " (" << name.size() << ")\\n";\n}\n',
  },
  {
    id: 'classes',
    label: 'virtual classes',
    language: 'cpp',
    code: '#include <iostream>\n#include <memory>\n#include <vector>\n\nclass Shape {\n public:\n  virtual ~Shape() = default;\n  virtual double area() const = 0;\n  virtual const char* name() const = 0;\n};\n\nclass Circle : public Shape {\n  double r_;\n\n public:\n  explicit Circle(double r) : r_(r) {}\n  double area() const override { return 3.14159265358979 * r_ * r_; }\n  const char* name() const override { return "circle"; }\n};\n\nclass Square : public Shape {\n  double a_;\n\n public:\n  explicit Square(double a) : a_(a) {}\n  double area() const override { return a_ * a_; }\n  const char* name() const override { return "square"; }\n};\n\nint main() {\n  std::vector<std::unique_ptr<Shape>> shapes;\n  shapes.push_back(std::make_unique<Circle>(2.0));\n  shapes.push_back(std::make_unique<Square>(3.0));\n\n  double total = 0;\n  for (const auto& shape : shapes) {\n    total += shape->area();\n    std::cout << shape->name() << " = " << shape->area() << \'\\n\';\n  }\n  std::cout << "total = " << total << \'\\n\';\n}\n',
  },
  {
    id: 'maps',
    label: 'map, set, counting',
    language: 'cpp',
    code: '#include <iostream>\n#include <map>\n#include <set>\n#include <sstream>\n#include <string>\n\nint main() {\n  std::istringstream input("the quick brown fox jumps over the lazy dog the end");\n\n  std::map<std::string, int> counts;\n  std::set<std::string> seen;\n  std::string word;\n  while (input >> word) {\n    ++counts[word];\n    seen.insert(word);\n  }\n\n  std::cout << "distinct = " << seen.size() << \'\\n\';\n  for (const auto& [text, count] : counts)\n    if (count > 1) std::cout << text << " x" << count << \'\\n\';\n}\n',
  },
  {
    id: 'lambdas',
    label: 'lambdas + sort by',
    language: 'cpp',
    code: '#include <algorithm>\n#include <iostream>\n#include <string>\n#include <vector>\n\nstruct Person {\n  std::string name;\n  int age;\n};\n\nint main() {\n  std::vector<Person> people{{"Ada", 36}, {"Linus", 54}, {"Ken", 92}, {"Grace", 85}};\n\n  std::sort(people.begin(), people.end(), [](const Person& a, const Person& b) { return a.age < b.age; });\n\n  int total = 0;\n  for (const auto& person : people) {\n    total += person.age;\n    std::cout << person.age << "  " << person.name << \'\\n\';\n  }\n  std::cout << "average = " << total / people.size() << \'\\n\';\n}\n',
  },
  {
    id: 'recursion',
    label: 'recursion + memo',
    language: 'cpp',
    code: '#include <array>\n#include <chrono>\n#include <iostream>\n\nstd::array<long long, 60> cache{};\n\nlong long fib(int n) {\n  if (n < 2) return n;\n  long long& slot = cache[n];\n  if (slot) return slot;\n  return slot = fib(n - 1) + fib(n - 2);\n}\n\nint main() {\n  auto start = std::chrono::steady_clock::now();\n  std::cout << "fib(50) = " << fib(50) << \'\\n\';\n  auto stop = std::chrono::steady_clock::now();\n  std::cout << "took " << std::chrono::duration_cast<std::chrono::microseconds>(stop - start).count() << " us\\n";\n}\n',
  },
  {
    id: 'matrix',
    label: 'matrix multiply',
    language: 'cpp',
    code: '#include <iostream>\n#include <vector>\n\nusing Matrix = std::vector<std::vector<int>>;\n\nMatrix multiply(const Matrix& a, const Matrix& b) {\n  size_t n = a.size(), m = b[0].size(), k = b.size();\n  Matrix out(n, std::vector<int>(m, 0));\n  for (size_t i = 0; i < n; ++i)\n    for (size_t j = 0; j < m; ++j)\n      for (size_t t = 0; t < k; ++t) out[i][j] += a[i][t] * b[t][j];\n  return out;\n}\n\nint main() {\n  Matrix a{{1, 2}, {3, 4}}, b{{5, 6}, {7, 8}};\n  for (const auto& row : multiply(a, b)) {\n    for (int value : row) std::cout << value << \' \';\n    std::cout << \'\\n\';\n  }\n}\n',
  },
  {
    id: 'streams',
    label: 'strings + parsing',
    language: 'cpp',
    code: '#include <iostream>\n#include <sstream>\n#include <string>\n#include <vector>\n\nstd::vector<std::string> split(const std::string& line, char separator) {\n  std::vector<std::string> parts;\n  std::istringstream stream(line);\n  std::string part;\n  while (std::getline(stream, part, separator)) parts.push_back(part);\n  return parts;\n}\n\nint main() {\n  for (const auto& field : split("ada,lovelace,1815", \',\')) std::cout << field << " | ";\n\n  std::ostringstream out;\n  out << \'#\' << std::hex << 4096;\n  std::cout << "\\nhex = " << out.str() << \'\\n\';\n}\n',
  },
  {
    id: 'c-strings',
    label: 'plain C',
    language: 'c',
    code: '#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n  char buf[64];\n  snprintf(buf, sizeof buf, "%s %d", "forge", 21);\n  printf("%s (%zu chars)\\n", buf, strlen(buf));\n}\n',
  },
  {
    id: 'c-sieve',
    label: 'C: sieve of Eratosthenes',
    language: 'c',
    code: '#include <stdbool.h>\n#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n  const int limit = 60;\n  bool* composite = calloc(limit + 1, sizeof *composite);\n\n  for (int p = 2; p * p <= limit; ++p) {\n    if (composite[p]) continue;\n    for (int multiple = p * p; multiple <= limit; multiple += p) composite[multiple] = true;\n  }\n\n  int count = 0;\n  for (int n = 2; n <= limit; ++n) {\n    if (composite[n]) continue;\n    printf("%d ", n);\n    ++count;\n  }\n  printf("\\n%d primes\\n", count);\n  free(composite);\n}\n',
  },
  {
    id: 'c-qsort',
    label: 'C: struct + qsort',
    language: 'c',
    stdin: '3\npear 4\nfig 9\nplum 2\n',
    code: '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n\ntypedef struct {\n  char name[16];\n  int weight;\n} Fruit;\n\nstatic int by_weight(const void* a, const void* b) {\n  return ((const Fruit*)a)->weight - ((const Fruit*)b)->weight;\n}\n\nint main(void) {\n  Fruit fruits[8];\n  int n = 0;\n\n  while (n < 8 && scanf("%15s %d", fruits[n].name, &fruits[n].weight) == 2) ++n;\n  qsort(fruits, n, sizeof *fruits, by_weight);\n\n  for (int i = 0; i < n; ++i) printf("%s %d\\n", fruits[i].name, fruits[i].weight);\n}\n',
  },
  {
    id: 'c-enum',
    label: 'C: enum + switch',
    language: 'c',
    code: '#include <stdio.h>\n\ntypedef enum { DIR_NORTH, DIR_EAST, DIR_SOUTH, DIR_WEST } Direction;\n\nstatic const char* name_of(Direction direction) {\n  switch (direction) {\n    case DIR_NORTH: return "north";\n    case DIR_EAST: return "east";\n    case DIR_SOUTH: return "south";\n    case DIR_WEST: return "west";\n  }\n  return "?";\n}\n\nstatic Direction turn_right(Direction direction) {\n  return (Direction)((direction + 1) % 4);\n}\n\nint main(void) {\n  Direction d = DIR_NORTH;\n  for (int i = 0; i < 5; ++i) {\n    printf("%s -> ", name_of(d));\n    d = turn_right(d);\n  }\n  printf("%s\\n", name_of(d));\n}\n',
  },
  {
    id: 'c-stdin',
    label: 'C: stdin loop',
    language: 'c',
    stdin: '7\n11\n42\n',
    code: '#include <stdio.h>\n\nint main(void) {\n  char line[32];\n  long sum = 0;\n  int count = 0;\n\n  while (fgets(line, sizeof line, stdin)) {\n    int value;\n    if (sscanf(line, "%d", &value) == 1) {\n      sum += value;\n      ++count;\n    }\n  }\n\n  printf("read %d numbers, sum %ld\\n", count, sum);\n}\n',
  },
];
