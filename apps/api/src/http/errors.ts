/** Erro de regra/validação com status HTTP e código estável para o front. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what: string) =>
  new ApiError(404, 'not_found', `${what} não encontrado(a).`);

export const badRequest = (code: string, message: string) => new ApiError(400, code, message);

export const conflict = (code: string, message: string) => new ApiError(409, code, message);
