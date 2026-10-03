import type { FastifyRequest } from 'fastify';

export interface AuditEntry {
  entityType: string;
  entityId: string | null;
  action: string;
  after: Record<string, unknown> | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENSITIVE = /pass|pin|secret|token|content|data/i;
const MAX_STRING = 200;
const MAX_JSON = 4000;
const SKIP_SUFFIX = ['/preview'];

/** Corpo sem campos sensíveis (senha, PIN, conteúdo de arquivo) e com textos curtos. */
export function sanitizeBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE.test(key)) continue;
    out[key] =
      typeof value === 'string' && value.length > MAX_STRING
        ? `${value.slice(0, MAX_STRING)}…`
        : value;
  }
  return JSON.stringify(out).length > MAX_JSON ? { truncated: true } : out;
}

const VERB: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/**
 * Transforma uma requisição de escrita em `/api/spaces/:id/<entidade>[/:id][/<verbo>]` numa
 * linha de auditoria. Leituras e prévias (que não gravam) retornam `null`.
 */
export function auditEntryFor(request: FastifyRequest, statusCode: number): AuditEntry | null {
  const verb = VERB[request.method];
  if (!verb || statusCode >= 400) return null;
  const path = request.url.split('?')[0] ?? '';
  if (SKIP_SUFFIX.some((s) => path.endsWith(s))) return null;
  const parts = path.split('/').filter(Boolean); // api, spaces, :id, entidade, ...
  const [, , , entityType, second, third] = parts;
  if (!entityType) return null;
  const hasId = second !== undefined && UUID.test(second);
  const entityId = hasId ? second : null;
  const extra = hasId ? third : second;
  const action = extra && !UUID.test(extra) ? extra : verb;
  return { entityType, entityId, action, after: sanitizeBody(request.body) };
}
