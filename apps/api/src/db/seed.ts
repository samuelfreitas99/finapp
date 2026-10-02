import { nationalHolidays } from '@finapp/core';
import type { CategoryKind, SystemCategoryKey } from '@finapp/shared';
import { and, eq, isNull, notExists, sql } from 'drizzle-orm';
import type { Db } from './client';
import { categories, holidays, spaces } from './schema';

/** Banco ou transação: as funções de seed funcionam nos dois. */
export type DbExecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DefaultCategory {
  name: string;
  kind: CategoryKind;
  /** Nome do ícone lucide. */
  icon: string;
  color: string;
  systemKey?: SystemCategoryKey;
}

/** Categorias padrão de um espaço novo (o usuário pode editar, arquivar e criar outras). */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { name: 'Alimentação', kind: 'expense', icon: 'utensils', color: '#ef4444' },
  { name: 'Mercado', kind: 'expense', icon: 'shopping-cart', color: '#f97316' },
  { name: 'Moradia', kind: 'expense', icon: 'house', color: '#a16207' },
  { name: 'Contas da casa', kind: 'expense', icon: 'zap', color: '#eab308' },
  { name: 'Transporte', kind: 'expense', icon: 'car', color: '#3b82f6' },
  { name: 'Saúde', kind: 'expense', icon: 'heart-pulse', color: '#ec4899' },
  { name: 'Educação', kind: 'expense', icon: 'graduation-cap', color: '#6366f1' },
  { name: 'Lazer', kind: 'expense', icon: 'party-popper', color: '#a855f7' },
  { name: 'Compras', kind: 'expense', icon: 'shopping-bag', color: '#d946ef' },
  { name: 'Vestuário', kind: 'expense', icon: 'shirt', color: '#f43f5e' },
  { name: 'Assinaturas', kind: 'expense', icon: 'repeat', color: '#0ea5e9' },
  { name: 'Cuidados pessoais', kind: 'expense', icon: 'sparkles', color: '#14b8a6' },
  { name: 'Pets', kind: 'expense', icon: 'paw-print', color: '#84cc16' },
  { name: 'Viagem', kind: 'expense', icon: 'plane', color: '#06b6d4' },
  { name: 'Presentes e doações', kind: 'expense', icon: 'gift', color: '#e11d48' },
  { name: 'Impostos e taxas', kind: 'expense', icon: 'landmark', color: '#64748b' },
  { name: 'Outras despesas', kind: 'expense', icon: 'ellipsis', color: '#78716c' },
  { name: 'Salário', kind: 'income', icon: 'briefcase', color: '#16a34a' },
  { name: 'Freelance', kind: 'income', icon: 'laptop', color: '#22c55e' },
  { name: 'Rendimentos', kind: 'income', icon: 'trending-up', color: '#059669' },
  { name: 'Reembolsos', kind: 'income', icon: 'undo-2', color: '#10b981' },
  { name: 'Vendas', kind: 'income', icon: 'tag', color: '#65a30d' },
  { name: 'Outras receitas', kind: 'income', icon: 'ellipsis', color: '#4d7c0f' },
];

/**
 * Categorias técnicas (uma por `system_key` em cada espaço), fora dos relatórios de
 * gasto/renda. O `kind` delas não tem significado no cálculo: o tipo do lançamento manda.
 */
export const SYSTEM_CATEGORIES: readonly (DefaultCategory & { systemKey: SystemCategoryKey })[] = [
  {
    name: 'Pagamento de fatura',
    kind: 'expense',
    icon: 'credit-card',
    color: '#475569',
    systemKey: 'invoice_payment',
  },
  { name: 'Ajuste', kind: 'expense', icon: 'scale', color: '#475569', systemKey: 'adjustment' },
  {
    name: 'Transferência',
    kind: 'expense',
    icon: 'arrow-left-right',
    color: '#475569',
    systemKey: 'transfer',
  },
  {
    name: 'Empréstimo',
    kind: 'expense',
    icon: 'hand-coins',
    color: '#475569',
    systemKey: 'loan',
  },
];

/**
 * Cria as categorias de um espaço. Idempotente: as técnicas que faltarem são sempre
 * criadas; as padrão só se o espaço ainda não tiver nenhuma categoria comum (para não
 * recriar o que o usuário apagou).
 */
export async function seedSpaceCategories(
  db: DbExecutor,
  spaceId: string,
  createdBy: string | null = null,
): Promise<void> {
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.spaceId, spaceId), eq(categories.isSystem, false)))
    .limit(1);
  const rows = [
    ...SYSTEM_CATEGORIES.map((c) => ({ ...c, isSystem: true })),
    ...(existing ? [] : DEFAULT_CATEGORIES.map((c) => ({ ...c, isSystem: false }))),
  ].map((c) => ({ ...c, spaceId, createdBy }));
  await db.insert(categories).values(rows).onConflictDoNothing();
}

/**
 * Feriados nacionais (`space_id` nulo) de `fromYear` a `toYear`, calculados pelo core,
 * incluindo Carnaval e Corpus Christi (padrão conservador, ver roadmap). Idempotente.
 * @see RN 2
 */
export async function seedNationalHolidays(
  db: DbExecutor,
  fromYear: number,
  toYear: number,
): Promise<void> {
  const rows = [];
  for (let year = fromYear; year <= toYear; year++) {
    for (const h of nationalHolidays(year))
      rows.push({ spaceId: null, date: h.date, name: h.name });
  }
  if (rows.length) await db.insert(holidays).values(rows).onConflictDoNothing();
}

/**
 * Seed completo e idempotente (roda na subida da API e em `pnpm db:seed`): feriados
 * nacionais do ano anterior até 30 anos à frente e categorias de espaços que não têm.
 */
export async function runSeed(db: Db, now = new Date()): Promise<void> {
  const year = now.getUTCFullYear();
  await seedNationalHolidays(db, year - 1, year + 30);
  const missing = await db
    .select({ id: spaces.id, createdBy: spaces.createdBy })
    .from(spaces)
    .where(
      and(
        isNull(spaces.deletedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(categories)
            .where(and(eq(categories.spaceId, spaces.id), eq(categories.isSystem, true))),
        ),
      ),
    );
  for (const s of missing) await seedSpaceCategories(db, s.id, s.createdBy);
}
