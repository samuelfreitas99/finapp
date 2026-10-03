import { api, ApiError, spacePath } from './api';

/**
 * Fila de lançamentos feitos sem conexão (neste aparelho). Ficam no `localStorage` e são
 * enviados quando a conexão volta, na ordem em que foram feitos.
 */
const KEY = 'finapp.offlineQueue';

export interface QueuedEntry {
  id: string;
  spaceId: string;
  body: unknown;
  createdAt: string;
}

type Listener = (items: QueuedEntry[]) => void;
const listeners = new Set<Listener>();

export function queued(): QueuedEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedEntry[];
  } catch {
    return [];
  }
}

function save(items: QueuedEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // armazenamento indisponível: o lançamento fica só na memória da tela
  }
  for (const l of listeners) l(items);
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function enqueueEntry(spaceId: string, body: unknown) {
  save([
    ...queued(),
    { id: crypto.randomUUID(), spaceId, body, createdAt: new Date().toISOString() },
  ]);
}

/** É falha de rede (vale a pena guardar e tentar depois)? */
export const isOffline = (err: unknown) =>
  (err instanceof ApiError && err.code === 'network_error') ||
  (typeof navigator !== 'undefined' && !navigator.onLine);

/**
 * Envia a fila. Para no primeiro erro de rede (tenta de novo depois); lançamentos que o
 * servidor recusar (dados inválidos) saem da fila e são devolvidos para avisar.
 */
export async function flushQueue(): Promise<{ sent: number; rejected: QueuedEntry[] }> {
  let sent = 0;
  const rejected: QueuedEntry[] = [];
  for (const item of queued()) {
    try {
      await api(spacePath(item.spaceId, '/transactions'), { method: 'POST', body: item.body });
      sent++;
    } catch (err) {
      if (isOffline(err)) break;
      rejected.push(item);
    }
    save(queued().filter((q) => q.id !== item.id));
  }
  return { sent, rejected };
}
