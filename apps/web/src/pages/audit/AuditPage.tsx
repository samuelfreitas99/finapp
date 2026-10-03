import { PageHeader } from '../../components/PageHeader';
import { useAuditLog } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

const ENTITY: Record<string, string> = {
  accounts: 'Conta',
  categories: 'Categoria',
  transactions: 'Lançamento',
  transfers: 'Transferência',
  adjustments: 'Ajuste de saldo',
  cards: 'Cartão',
  installments: 'Parcelamento',
  recurrences: 'Despesa/receita fixa',
  debts: 'Dívida',
  budgets: 'Orçamento',
  goals: 'Meta',
  attachments: 'Comprovante',
  import: 'Importação',
  'category-rules': 'Regra de categoria',
  'index-values': 'Índice',
};

const ACTION: Record<string, string> = {
  create: 'criou',
  update: 'alterou',
  delete: 'apagou',
  settle: 'confirmou',
  pay: 'pagou',
  cancel: 'cancelou',
  commit: 'importou',
  deposit: 'registrou aporte em',
  anticipate: 'antecipou',
  payoff: 'quitou',
  amortize: 'amortizou',
};

const when = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/** O que foi alterado no espaço, por quem e quando. */
export function AuditPage() {
  const log = useAuditLog();
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title="Histórico de alterações" back="/mais" />
      <p className="muted">
        Tudo o que foi criado, alterado ou apagado neste espaço, do mais recente ao mais antigo.
      </p>
      {log.isPending && <div className="skeleton" style={{ height: 200 }} />}
      {log.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(log.error)}
        </p>
      )}
      {log.isSuccess && items.length === 0 && (
        <section className="card empty">
          <h2>Nada registrado ainda</h2>
        </section>
      )}
      {items.length > 0 && (
        <ul className="list card">
          {items.map((i) => {
            const detail =
              i.after && typeof i.after.description === 'string'
                ? i.after.description
                : typeof i.after?.name === 'string'
                  ? i.after.name
                  : null;
            return (
              <li key={i.id} className="row-link">
                <span className="row-link__main">
                  <strong>
                    {i.userName ?? 'Alguém'} {ACTION[i.action] ?? i.action}{' '}
                    {(ENTITY[i.entityType] ?? i.entityType).toLowerCase()}
                  </strong>
                  {detail && <span className="muted">{detail}</span>}
                </span>
                <span className="muted">{when(i.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {log.hasNextPage && (
        <button
          type="button"
          className="btn"
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {log.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </>
  );
}
