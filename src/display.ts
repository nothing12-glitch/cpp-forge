/*
 * Which colours the page wears is about comfort rather than about the code, so the choice is kept on the
 * device. Every panel mixes its palette from the same accent variables, which makes a theme one attribute
 * on the root element instead of a second stylesheet that has to be kept in step by hand.
 */

const THEME_KEY = 'cpp-forge.theme';

export const THEMES = ['mint', 'amber', 'ice'] as const;
export type Theme = (typeof THEMES)[number];

const NAMES: Record<Theme, string> = { mint: 'mint', amber: 'amber', ice: 'ice' };

export const currentTheme = (): Theme => {
  const stored = localStorage.getItem(THEME_KEY);
  return THEMES.includes(stored as Theme) ? (stored as Theme) : 'mint';
};

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

export function cycleTheme(skinButton: HTMLButtonElement): Theme {
  const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
  applyTheme(next);
  skinButton.textContent = NAMES[next];
  skinButton.setAttribute('aria-label', `colors: ${NAMES[next]}`);
  return next;
}

export function initTheme(skinButton: HTMLButtonElement): void {
  applyTheme(currentTheme());
  skinButton.textContent = NAMES[currentTheme()];
}
