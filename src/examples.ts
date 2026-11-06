export type Language = 'cpp' | 'c';

export interface Example {
  id: string;
  label: string;
  language: Language;
  code: string;
  stdin?: string;
}

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
    id: 'c-strings',
    label: 'plain C',
    language: 'c',
    code: '#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n  char buf[64];\n  snprintf(buf, sizeof buf, "%s %d", "forge", 21);\n  printf("%s (%zu chars)\\n", buf, strlen(buf));\n}\n',
  },
];
