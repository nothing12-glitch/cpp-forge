/*
 * Two switches over the same palette: which colors the page wears, and whether the page is allowed to
 * explain itself. Both are remembered per device, because both are about comfort rather than the code.
 */

const THEME_KEY = 'cpp-forge.theme';
const FOCUS_KEY = 'cpp-forge.focus';

export const THEMES = ['mint', 'amber', 'ice'] as const;
export type Theme = (typeof THEMES)[number];

const NAMES: Record<Theme, string> = { mint: 'mint', amber: 'amber', ice: 'ice' };

export const currentTheme = (): Theme => {
  const stored = localStorage.getItem(THEME_KEY);
  return THEMES.includes(stored as Theme) ? (stored as Theme) : 'mint';
};

export const isFocus = (): boolean => localStorage.getItem(FOCUS_KEY) === 'on';

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

/**
 * Focus mode hides the teaching layer — hints, the diff panel, the lenses, share and the footnote —
 * and leaves the buffer with its output. Nothing is removed from the run itself, so a result a moment
 * later can still be explained once the mode is off.
 */
export function applyFocus(on: boolean): void {
  document.body.classList.toggle('is-focus', on);
  localStorage.setItem(FOCUS_KEY, on ? 'on' : 'off');
}

export function cycleTheme(skinButton: HTMLButtonElement): Theme {
  const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
  applyTheme(next);
  skinButton.textContent = NAMES[next];
  skinButton.setAttribute('aria-label', `colors: ${NAMES[next]}`);
  return next;
}

export function toggleFocus(focusButton: HTMLButtonElement): boolean {
  const next = !isFocus();
  applyFocus(next);
  syncFocusButton(focusButton, next);
  return next;
}

export function syncFocusButton(focusButton: HTMLButtonElement, on: boolean): void {
  focusButton.setAttribute('aria-pressed', String(on));
  focusButton.textContent = on ? 'explain off' : 'explain on';
}

export function initDisplay(skinButton: HTMLButtonElement, focusButton: HTMLButtonElement): void {
  applyTheme(currentTheme());
  skinButton.textContent = NAMES[currentTheme()];
  syncFocusButton(focusButton, isFocus());
  applyFocus(isFocus());
}
