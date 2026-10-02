/** Erro vindo da API (`{ error: { code, message } }`) ou do Better Auth (`{ code, message }`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const FALLBACK = 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.';

async function toError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // corpo vazio ou não-JSON
  }
  const obj = (body ?? {}) as Record<string, unknown>;
  const inner = (obj.error ?? obj) as Record<string, unknown>;
  const code = typeof inner.code === 'string' ? inner.code : `http_${res.status}`;
  const message = typeof inner.message === 'string' && inner.message ? inner.message : FALLBACK;
  return new ApiError(res.status, code, message);
}

/** Chamada JSON à API com o cookie de sessão. */
export async function api<T>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'network_error', FALLBACK);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Caminho de um recurso do espaço. */
export const spacePath = (spaceId: string, path: string) => `/api/spaces/${spaceId}${path}`;
