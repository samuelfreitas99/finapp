import { z } from 'zod';
import { CATEGORY_KINDS, SYSTEM_CATEGORY_KEYS } from '../enums';
import { colorSchema, nameSchema, queryBooleanSchema } from './common';

/** Corpo de `POST /api/spaces/:spaceId/categories`. Subcategoria: um nível só. */
export const createCategoryBodySchema = z.object({
  name: nameSchema,
  kind: z.enum(CATEGORY_KINDS),
  parentId: z.uuid().nullish(),
  icon: z.string().trim().min(1).max(50).nullish(),
  color: colorSchema.nullish(),
});
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;

/** Corpo de `PATCH`. O tipo (`kind`) não muda depois de criada. */
export const updateCategoryBodySchema = z
  .object({
    name: nameSchema,
    parentId: z.uuid().nullable(),
    icon: z.string().trim().min(1).max(50).nullable(),
    color: colorSchema.nullable(),
    archived: z.boolean(),
  })
  .partial();
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;

export const listCategoriesQuerySchema = z.object({
  kind: z.enum(CATEGORY_KINDS).optional(),
  includeArchived: queryBooleanSchema,
  /** Inclui as técnicas (pagamento de fatura, ajuste, transferência, empréstimo). */
  includeSystem: queryBooleanSchema,
});

export const categorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(CATEGORY_KINDS),
  parentId: z.uuid().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isSystem: z.boolean(),
  systemKey: z.enum(SYSTEM_CATEGORY_KEYS).nullable(),
  archived: z.boolean(),
});
export type Category = z.infer<typeof categorySchema>;
