const UNLOCKED_KEY = 'finapp.unlocked';

/** Segundos em segundo plano até o app pedir o PIN de novo. */
export const AUTO_LOCK_SECONDS = 60;

export function isUnlockedThisSession(): boolean {
  try {
    return sessionStorage.getItem(UNLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markUnlocked(): void {
  try {
    sessionStorage.setItem(UNLOCKED_KEY, '1');
  } catch {
    // sem sessionStorage (aba privada): o app só pedirá o PIN de novo ao recarregar
  }
}

export function markLocked(): void {
  try {
    sessionStorage.removeItem(UNLOCKED_KEY);
  } catch {
    // ver acima
  }
}

/** Passou tempo suficiente em segundo plano para bloquear? */
export function shouldAutoLock(hiddenAt: number, now: number): boolean {
  return now - hiddenAt >= AUTO_LOCK_SECONDS * 1000;
}
