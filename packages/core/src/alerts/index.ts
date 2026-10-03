import { formatBRL, type Cents } from '../money';
import { addDays, diffDays, type ISODate } from '../dates';

/**
 * Alertas (RN 9): a partir de um retrato dos dados do espaço, decide quais avisos gerar.
 * Cada alerta tem uma chave única (tipo + entidade + data) para sair uma vez só.
 * @see RN 9
 */

export type AlertType =
  | 'due_soon'
  | 'overdue'
  | 'invoice_closing'
  | 'invoice_closed'
  | 'invoice_due'
  | 'income_unconfirmed'
  | 'negative_forecast'
  | 'card_limit'
  | 'budget';

export interface AlertSettings {
  enabled: boolean;
  /** Dias de antecedência (due_soon, invoice_due). */
  daysBefore: number;
}

export interface PlannedItem {
  id: string;
  type: 'income' | 'expense';
  description: string;
  amount: Cents;
  date: ISODate;
}

export interface InvoiceSnapshot {
  id: string;
  cardId: string;
  cardName: string;
  referenceMonth: string;
  closingDate: ISODate;
  dueDate: ISODate;
  total: Cents;
  remaining: Cents;
}

export interface CardLimitSnapshot {
  cardId: string;
  cardName: string;
  limit: Cents;
  available: Cents;
  /** Fatura atual (o aviso de limite sai uma vez por fatura). */
  currentMonth: string;
}

export interface AlertInput {
  today: ISODate;
  settings: Partial<Record<AlertType, AlertSettings>>;
  planned: readonly PlannedItem[];
  invoices: readonly InvoiceSnapshot[];
  cards: readonly CardLimitSnapshot[];
  /** Saldo previsto no fim do mês (contas que somam nos totais). */
  forecastEndOfMonth: Cents | null;
}

export interface Alert {
  type: AlertType;
  dedupeKey: string;
  title: string;
  body: string;
  url: string;
  entityType: 'transaction' | 'invoice' | 'card' | 'space' | 'category';
  entityId: string | null;
}

const DEFAULT: AlertSettings = { enabled: true, daysBefore: 3 };
const CARD_LIMIT_THRESHOLD = 0.8;

function whenText(days: number): string {
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  return `em ${days} dias`;
}

function dateBR(date: ISODate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Decide os alertas do dia. Pura: quem chama grava e envia. */
export function buildAlerts(input: AlertInput): Alert[] {
  const { today } = input;
  const cfg = (t: AlertType) => ({ ...DEFAULT, ...input.settings[t] });
  const alerts: Alert[] = [];

  for (const p of input.planned) {
    const days = diffDays(today, p.date);
    if (p.type === 'expense') {
      if (days < 0 && cfg('overdue').enabled) {
        alerts.push({
          type: 'overdue',
          dedupeKey: `overdue:${p.id}:${p.date}`,
          title: `Venceu: ${p.description}`,
          body: `${formatBRL(p.amount)} venceu em ${dateBR(p.date)} e não foi confirmado.`,
          url: `/lancamentos/${p.id}`,
          entityType: 'transaction',
          entityId: p.id,
        });
      } else if (days >= 0 && cfg('due_soon').enabled) {
        const window = cfg('due_soon').daysBefore;
        const stage = days === 0 ? 'today' : days <= window ? 'advance' : null;
        if (stage) {
          alerts.push({
            type: 'due_soon',
            dedupeKey: `due_soon:${p.id}:${p.date}:${stage}`,
            title: `Vence ${whenText(days)}: ${p.description}`,
            body: `${formatBRL(p.amount)} em ${dateBR(p.date)}.`,
            url: `/lancamentos/${p.id}`,
            entityType: 'transaction',
            entityId: p.id,
          });
        }
      }
    } else if (days === -1 && cfg('income_unconfirmed').enabled) {
      alerts.push({
        type: 'income_unconfirmed',
        dedupeKey: `income_unconfirmed:${p.id}:${p.date}`,
        title: `Recebeu? ${p.description}`,
        body: `${formatBRL(p.amount)} estava previsto para ontem. Confirme quando cair na conta.`,
        url: `/lancamentos/${p.id}`,
        entityType: 'transaction',
        entityId: p.id,
      });
    }
  }

  for (const inv of input.invoices) {
    const url = `/cartoes?cartao=${inv.cardId}&mes=${inv.referenceMonth}`;
    if (inv.closingDate === addDays(today, 1) && cfg('invoice_closing').enabled) {
      alerts.push({
        type: 'invoice_closing',
        dedupeKey: `invoice_closing:${inv.id}:${inv.closingDate}`,
        title: `Fatura ${inv.cardName} fecha amanhã`,
        body: `Até agora: ${formatBRL(inv.total)}. Compras a partir de amanhã vão para a próxima.`,
        url,
        entityType: 'invoice',
        entityId: inv.id,
      });
    }
    if (inv.closingDate === today && cfg('invoice_closed').enabled) {
      alerts.push({
        type: 'invoice_closed',
        dedupeKey: `invoice_closed:${inv.id}:${inv.closingDate}`,
        title: `Fatura ${inv.cardName} fechou`,
        body: `Total ${formatBRL(inv.total)}, vence em ${dateBR(inv.dueDate)}.`,
        url,
        entityType: 'invoice',
        entityId: inv.id,
      });
    }
    const days = diffDays(today, inv.dueDate);
    if (inv.remaining > 0 && days >= 0 && cfg('invoice_due').enabled) {
      const stage = days === 0 ? 'today' : days <= cfg('invoice_due').daysBefore ? 'advance' : null;
      if (stage) {
        alerts.push({
          type: 'invoice_due',
          dedupeKey: `invoice_due:${inv.id}:${inv.dueDate}:${stage}`,
          title: `Fatura ${inv.cardName} vence ${whenText(days)}`,
          body: `Falta pagar ${formatBRL(inv.remaining)}.`,
          url,
          entityType: 'invoice',
          entityId: inv.id,
        });
      }
    }
  }

  for (const c of input.cards) {
    if (c.limit <= 0 || !cfg('card_limit').enabled) continue;
    const used = (c.limit - c.available) / c.limit;
    if (used >= CARD_LIMIT_THRESHOLD) {
      alerts.push({
        type: 'card_limit',
        dedupeKey: `card_limit:${c.cardId}:${c.currentMonth}`,
        title: `${c.cardName}: ${Math.floor(used * 100)}% do limite usado`,
        body: `Disponível: ${formatBRL(c.available)}.`,
        url: `/cartoes?cartao=${c.cardId}`,
        entityType: 'card',
        entityId: c.cardId,
      });
    }
  }

  if (
    input.forecastEndOfMonth !== null &&
    input.forecastEndOfMonth < 0 &&
    cfg('negative_forecast').enabled
  ) {
    alerts.push({
      type: 'negative_forecast',
      dedupeKey: `negative_forecast:${today.slice(0, 7)}`,
      title: 'Saldo previsto negativo no fim do mês',
      body: `Previsão: ${formatBRL(input.forecastEndOfMonth)}. Veja no Planejamento o que dá para ajustar.`,
      url: '/planejamento',
      entityType: 'space',
      entityId: null,
    });
  }
  return alerts;
}

/** `HH:MM` dentro do horário de silêncio (que pode atravessar a meia-noite). */
export function inQuietHours(now: string, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
