import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_TRANSACTION,
  ATTACHMENT_MIME_TYPES,
  spaceItemParamsSchema,
  uploadAttachmentQuerySchema,
  type Attachment,
  type AttachmentMime,
} from '@finapp/shared';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { attachments, transactions } from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import type { SpaceContext } from '../spaces/scope';

/** Tipo do arquivo pelos primeiros bytes (o cabeçalho do cliente não é confiável). */
export function sniffMime(buf: Buffer): AttachmentMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

/** Nome seguro para exibir/baixar: sem caminho nem caracteres de controle. */
export function cleanFileName(name: string | undefined, mime: AttachmentMime): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = [...base]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch !== '"')
    .join('')
    .trim()
    .slice(0, 120);
  if (cleaned) return cleaned;
  return mime === 'application/pdf' ? 'comprovante.pdf' : 'comprovante';
}

type Row = Pick<typeof attachments.$inferSelect, 'id' | 'fileName' | 'mime' | 'size' | 'createdAt'>;

const toDto = (r: Row): Attachment => ({
  id: r.id,
  fileName: r.fileName,
  mime: r.mime as AttachmentMime,
  size: r.size,
  createdAt: r.createdAt.toISOString(),
});

const columns = {
  id: attachments.id,
  fileName: attachments.fileName,
  mime: attachments.mime,
  size: attachments.size,
  createdAt: attachments.createdAt,
};

/** Comprovantes dos lançamentos (foto ou PDF, até 8 MB, no Postgres). */
export function attachmentRoutes(app: FastifyInstance, { db }: SpaceContext) {
  // Corpo cru: o app envia o arquivo como está, com o nome em `?name=`.
  app.addContentTypeParser(
    [...ATTACHMENT_MIME_TYPES, 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: ATTACHMENT_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  const ensureTransaction = async (spaceId: string, id: string) => {
    const [row] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.spaceId, spaceId),
          isNull(transactions.deletedAt),
        ),
      );
    if (!row) throw notFound('Lançamento');
  };

  app.get('/transactions/:id/attachments', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    await ensureTransaction(spaceId, id);
    const rows = await db
      .select(columns)
      .from(attachments)
      .where(
        and(
          eq(attachments.transactionId, id),
          eq(attachments.spaceId, spaceId),
          isNull(attachments.deletedAt),
        ),
      )
      .orderBy(asc(attachments.createdAt));
    return { items: rows.map(toDto) };
  });

  app.post('/transactions/:id/attachments', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const query = uploadAttachmentQuerySchema.parse(request.query);
    await ensureTransaction(spaceId, id);
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw badRequest('invalid_file', 'Envie uma foto (JPG, PNG, WebP) ou um PDF.');
    }
    const mime = sniffMime(body);
    if (!mime) throw badRequest('invalid_file', 'Formato não aceito. Use JPG, PNG, WebP ou PDF.');
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(attachments)
      .where(and(eq(attachments.transactionId, id), isNull(attachments.deletedAt)));
    if (n >= ATTACHMENT_MAX_PER_TRANSACTION) {
      throw badRequest(
        'too_many_attachments',
        `No máximo ${ATTACHMENT_MAX_PER_TRANSACTION} comprovantes por lançamento.`,
      );
    }
    const [row] = await db
      .insert(attachments)
      .values({
        spaceId,
        transactionId: id,
        fileName: cleanFileName(query.name, mime),
        mime,
        size: body.length,
        data: body,
        createdBy: currentUser(request).id,
      })
      .returning(columns);
    if (!row) throw new Error('falha ao salvar comprovante');
    return reply.code(201).send(toDto(row));
  });

  /** O arquivo em si (aberto no navegador). */
  app.get('/attachments/:id/file', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const [row] = await db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.id, id),
          eq(attachments.spaceId, spaceId),
          isNull(attachments.deletedAt),
        ),
      );
    if (!row) throw notFound('Comprovante');
    return reply
      .header('content-type', row.mime)
      .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; img-src 'self'; sandbox")
      .header('cache-control', 'private, max-age=3600')
      .send(row.data);
  });

  app.delete('/attachments/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const [row] = await db
      .update(attachments)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(attachments.id, id),
          eq(attachments.spaceId, spaceId),
          isNull(attachments.deletedAt),
        ),
      )
      .returning({ id: attachments.id });
    if (!row) throw notFound('Comprovante');
    return reply.code(204).send();
  });
}
