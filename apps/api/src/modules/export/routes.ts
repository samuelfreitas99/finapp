import { centsToDecimal, toCSV } from '@finapp/core';
import { exportQuerySchema } from '@finapp/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import {
  accounts,
  budgets,
  categories,
  creditCards,
  debts,
  goals,
  transactions,
} from '../../db/schema';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';

const TYPE_LABEL = {
  income: 'Receita',
  expense: 'Despesa',
  transfer_in: 'Transferência (entrada)',
  transfer_out: 'Transferência (saída)',
  adjustment: 'Ajuste',
} as const;
const STATUS_LABEL = { planned: 'Previsto', settled: 'Efetivado' } as const;

const HEADERS = [
  'Data',
  'Tipo',
  'Situação',
  'Descrição',
  'Valor',
  'Categoria',
  'Conta',
  'Cartão',
  'Observações',
] as const;

/** Exportação dos dados do espaço (CSV, XLSX e JSON). Só leitura. */
export function exportRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  app.get('/export', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const { format } = exportQuerySchema.parse(request.query);

    const [accountRows, categoryRows, cardRows, txRows] = await Promise.all([
      db
        .select()
        .from(accounts)
        .where(and(eq(accounts.spaceId, spaceId), isNull(accounts.deletedAt))),
      db
        .select()
        .from(categories)
        .where(and(eq(categories.spaceId, spaceId), isNull(categories.deletedAt))),
      db
        .select()
        .from(creditCards)
        .where(and(eq(creditCards.spaceId, spaceId), isNull(creditCards.deletedAt))),
      db
        .select()
        .from(transactions)
        .where(and(eq(transactions.spaceId, spaceId), isNull(transactions.deletedAt)))
        .orderBy(asc(transactions.date), asc(transactions.id)),
    ]);
    const accountName = new Map(accountRows.map((a) => [a.id, a.name]));
    const categoryName = new Map(categoryRows.map((c) => [c.id, c.name]));
    const cardName = new Map(cardRows.map((c) => [c.id, c.name]));
    const stamp = today();

    const lines = txRows.map((t) => ({
      date: t.date,
      type: TYPE_LABEL[t.type],
      status: STATUS_LABEL[t.status],
      description: t.description,
      cents: t.amount,
      signed:
        t.type === 'income' || t.type === 'transfer_in'
          ? t.amount
          : t.type === 'adjustment'
            ? t.amount
            : -t.amount,
      category: t.categoryId ? (categoryName.get(t.categoryId) ?? '') : '',
      account: t.accountId ? (accountName.get(t.accountId) ?? '') : '',
      card: t.cardId ? (cardName.get(t.cardId) ?? '') : '',
      notes: t.notes ?? '',
    }));

    const attachment = (ext: string, type: string) =>
      reply
        .header('content-type', type)
        .header('content-disposition', `attachment; filename="finapp-${stamp}.${ext}"`)
        .header('cache-control', 'no-store');

    if (format === 'csv') {
      const csv = toCSV(
        HEADERS,
        lines.map((l) => [
          l.date,
          l.type,
          l.status,
          l.description,
          centsToDecimal(l.signed),
          l.category,
          l.account,
          l.card,
          l.notes,
        ]),
      );
      return attachment('csv', 'text/csv; charset=utf-8').send(csv);
    }

    if (format === 'xlsx') {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet('Lançamentos');
      sheet.addRow([...HEADERS]);
      sheet.getRow(1).font = { bold: true };
      for (const l of lines) {
        sheet.addRow([
          l.date,
          l.type,
          l.status,
          l.description,
          l.signed / 100,
          l.category,
          l.account,
          l.card,
          l.notes,
        ]);
      }
      sheet.getColumn(5).numFmt = '#,##0.00';
      sheet.columns.forEach((c, i) => (c.width = [12, 22, 12, 40, 14, 20, 20, 16, 30][i] ?? 14));
      const accountsSheet = book.addWorksheet('Contas');
      accountsSheet.addRow(['Nome', 'Tipo', 'Saldo inicial', 'Data do saldo inicial']);
      accountsSheet.getRow(1).font = { bold: true };
      for (const a of accountRows) {
        accountsSheet.addRow([a.name, a.type, a.initialBalance / 100, a.initialDate]);
      }
      accountsSheet.getColumn(3).numFmt = '#,##0.00';
      const buffer = Buffer.from(await book.xlsx.writeBuffer());
      return attachment(
        'xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ).send(buffer);
    }

    // JSON completo (valores em centavos), para backup ou migração.
    const [debtRows, budgetRows, goalRows] = await Promise.all([
      db
        .select()
        .from(debts)
        .where(and(eq(debts.spaceId, spaceId), isNull(debts.deletedAt))),
      db
        .select()
        .from(budgets)
        .where(and(eq(budgets.spaceId, spaceId), isNull(budgets.deletedAt))),
      db
        .select()
        .from(goals)
        .where(and(eq(goals.spaceId, spaceId), isNull(goals.deletedAt))),
    ]);
    const json = {
      exportedAt: stamp,
      currency: 'BRL',
      note: 'Valores em centavos inteiros; datas no formato AAAA-MM-DD.',
      accounts: accountRows,
      categories: categoryRows,
      cards: cardRows,
      transactions: txRows,
      debts: debtRows,
      budgets: budgetRows,
      goals: goalRows,
    };
    return attachment('json', 'application/json; charset=utf-8').send(
      JSON.stringify(json, null, 2),
    );
  });
}
