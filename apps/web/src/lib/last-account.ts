const KEY = 'finapp.lastAccount';

/** Última conta usada no "+" (padrão do próximo lançamento neste aparelho). */
export function readLastAccount(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveLastAccount(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // ignora
  }
}
