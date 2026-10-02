import type { Transaction } from '@finapp/shared';
import { Landmark, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { today } from '../../lib/dates';
import { countCategoryUse } from '../../lib/category-usage';
import { money } from '../../lib/format';
import { readLastAccount, saveLastAccount } from '../../lib/last-account';
import {
  useAccounts,
  useCategories,
  useCreateTransaction,
  useCreateTransfer,
  useDeleteTransaction,
  useTransaction,
  useUpdateTransaction,
} from '../../lib/queries';
import { EntryForm, errorText, type EntryKind, type EntryState } from './EntryForm';

const SAVED: Record<EntryKind, string> = {
  expense: 'Despesa salva.',
  income: 'Receita salva.',
  transfer: 'Transferência salva.',
};

function describe(state: EntryState, categoryName: string | undefined) {
  const text = state.description.trim();
  if (text) return text;
  if (state.kind === 'transfer') return 'Transferência';
  if (state.pix && state.pixCounterparty.trim()) return `Pix ${state.pixCounterparty.trim()}`;
  return categoryName ?? (state.kind === 'income' ? 'Receita' : 'Despesa');
}

function NoAccounts() {
  return (
    <section className="card empty">
      <Landmark size={40} strokeWidth={1.5} aria-hidden="true" />
      <h2>Antes, cadastre uma conta</h2>
      <p className="muted">Todo lançamento sai de (ou entra em) uma conta.</p>
      <Link to="/contas/nova" className="btn btn--primary">
        Nova conta
      </Link>
    </section>
  );
}

export function NewEntryPage() {
  const accounts = useAccounts();
  const categories = useCategories();
  const createTx = useCreateTransaction();
  const createTransfer = useCreateTransfer();
  const remove = useDeleteTransaction();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  if (accounts.isPending || categories.isPending) {
    return <div className="skeleton" style={{ height: 520 }} />;
  }
  const list = accounts.data ?? [];
  const cats = categories.data ?? [];
  if (list.length === 0) {
    return (
      <>
        <PageHeader title="Novo lançamento" back="/" />
        <NoAccounts />
      </>
    );
  }
  const last = readLastAccount();
  const defaultAccount = list.find((a) => a.id === last)?.id ?? list[0]?.id ?? '';

  // Abriu o "+" direto (link, atalho do PWA): não há tela anterior no app.
  const back = () => (location.key === 'default' ? navigate('/lancamentos') : navigate(-1));

  const undo = (ids: string[]) => ({
    label: 'Desfazer',
    run: () => ids.slice(0, 1).forEach((id) => remove.mutate(id)),
  });

  const submit = (s: EntryState) => {
    saveLastAccount(s.accountId);
    if (s.categoryId) countCategoryUse(s.categoryId);
    const common = {
      amount: s.amount,
      date: s.date,
      status: s.done ? ('settled' as const) : ('planned' as const),
      notes: s.notes.trim() || null,
    };
    if (s.kind === 'transfer') {
      createTransfer.mutate(
        {
          ...common,
          fromAccountId: s.accountId,
          toAccountId: s.toAccountId,
          description: describe(s, undefined),
        },
        {
          onSuccess: (r) => {
            toast({ text: SAVED.transfer, action: undo(r.items.map((t) => t.id)) });
            back();
          },
        },
      );
      return;
    }
    const category = cats.find((c) => c.id === s.categoryId);
    createTx.mutate(
      {
        ...common,
        type: s.kind,
        accountId: s.accountId,
        categoryId: s.categoryId,
        description: describe(s, category?.name),
        paymentMethod: s.pix ? 'pix' : null,
        pixCounterparty: s.pix ? s.pixCounterparty.trim() || null : null,
      },
      {
        onSuccess: (t) => {
          toast({ text: SAVED[s.kind], action: undo([t.id]) });
          back();
        },
      },
    );
  };

  return (
    <>
      <PageHeader title="Novo lançamento" back="/" />
      <EntryForm
        initial={{
          kind: 'expense',
          amount: 0,
          categoryId: null,
          description: '',
          accountId: defaultAccount,
          toAccountId: '',
          date: today(),
          done: true,
          pix: false,
          pixCounterparty: '',
          notes: '',
        }}
        accounts={list}
        categories={cats}
        pending={createTx.isPending || createTransfer.isPending}
        error={createTx.error ?? createTransfer.error}
        onSubmit={submit}
      />
    </>
  );
}

function kindOf(t: Transaction): EntryKind {
  if (t.type === 'income') return 'income';
  if (t.type === 'expense') return 'expense';
  return 'transfer';
}

export function EditEntryPage() {
  const { id = '' } = useParams();
  const tx = useTransaction(id);
  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories();
  const update = useUpdateTransaction(id);
  const remove = useDeleteTransaction();
  const navigate = useNavigate();
  const toast = useToast();

  if (tx.isPending || accounts.isPending || categories.isPending) {
    return <div className="skeleton" style={{ height: 520 }} />;
  }
  if (tx.isError || !tx.data) {
    return (
      <>
        <PageHeader title="Lançamento" back="/lancamentos" />
        <p className="alert alert--error" role="alert">
          {errorText(tx.error)}
        </p>
      </>
    );
  }
  const t = tx.data;
  const kind = kindOf(t);

  const deleteButton = (
    <button
      type="button"
      className="btn btn--danger"
      disabled={remove.isPending}
      onClick={() => {
        const what = t.transferId ? 'esta transferência (as duas contas)' : `"${t.description}"`;
        if (!window.confirm(`Excluir ${what}?`)) return;
        remove.mutate(t.id, {
          onSuccess: () => {
            toast({ text: 'Lançamento excluído.' });
            navigate('/lancamentos');
          },
        });
      }}
    >
      <Trash2 size={18} aria-hidden="true" />
      Excluir
    </button>
  );

  if (t.type === 'adjustment') {
    return (
      <>
        <PageHeader title="Ajuste de saldo" back="/lancamentos" />
        <section className="card card--pad form">
          <p>
            Ajuste de <strong className="num">{money(t.amount, false, true)}</strong> em{' '}
            {accounts.data?.find((a) => a.id === t.accountId)?.name ?? 'conta'}.
          </p>
          <p className="muted">
            Ajustes não são editados: exclua e ajuste o saldo de novo na tela da conta.
          </p>
          {deleteButton}
        </section>
      </>
    );
  }

  const isTransfer = Boolean(t.transferId);
  return (
    <>
      <PageHeader title={isTransfer ? 'Transferência' : t.description} back="/lancamentos" />
      {isTransfer && (
        <p className="muted">
          {t.type === 'transfer_out' ? 'Saída' : 'Entrada'} desta transferência. Valor, data e
          descrição mudam nas duas contas.
        </p>
      )}
      <EntryForm
        key={t.id}
        lockKind
        transferAccountsLocked={isTransfer}
        initial={{
          kind,
          amount: t.amount,
          categoryId: t.categoryId,
          description: t.description,
          accountId: t.accountId ?? '',
          toAccountId: '',
          date: t.date,
          done: t.status === 'settled',
          pix: t.paymentMethod === 'pix',
          pixCounterparty: t.pixCounterparty ?? '',
          notes: t.notes ?? '',
        }}
        accounts={accounts.data ?? []}
        categories={categories.data ?? []}
        pending={update.isPending}
        error={update.error}
        submitLabel="Salvar alterações"
        onSubmit={(s) => {
          const common = {
            amount: s.amount,
            date: s.date,
            status: s.done ? ('settled' as const) : ('planned' as const),
            description: s.description.trim() || t.description,
            notes: s.notes.trim() || null,
          };
          update.mutate(
            isTransfer
              ? common
              : {
                  ...common,
                  accountId: s.accountId,
                  categoryId: s.categoryId,
                  paymentMethod: s.pix ? 'pix' : t.paymentMethod === 'pix' ? null : t.paymentMethod,
                  pixCounterparty: s.pix ? s.pixCounterparty.trim() || null : null,
                },
            {
              onSuccess: () => {
                toast({ text: 'Lançamento salvo.' });
                navigate('/lancamentos');
              },
            },
          );
        }}
      />
      {deleteButton}
    </>
  );
}
