import { z } from 'zod';

/** Tipos aceitos para comprovante (conferidos pelo conteúdo do arquivo, não só pelo nome). */
export const ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIME_TYPES)[number];

/** Tamanho máximo de um comprovante (8 MB) e quantidade por lançamento. */
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_TRANSACTION = 10;

export const uploadAttachmentQuerySchema = z.object({
  name: z.string().trim().max(200).optional(),
});

export const attachmentSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  mime: z.enum(ATTACHMENT_MIME_TYPES),
  size: z.int(),
  createdAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
