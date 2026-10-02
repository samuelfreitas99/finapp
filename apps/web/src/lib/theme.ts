import type { Theme } from '@finapp/shared';

const KEY = 'finapp.theme';

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // armazenamento indisponível: segue o sistema
  }
  return 'system';
}

/** Aplica o tema no <html> (`system` remove o atributo e segue o sistema). */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // ignora
  }
}
