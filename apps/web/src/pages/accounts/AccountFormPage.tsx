import { todayIn } from '@finapp/core';
import { ACCOUNT_TYPES, type Account, type AccountType } from '@finapp/shared';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MoneyInput } from '../../components/MoneyInput';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { ACCOUNT_COLORS, ACCOUNT_TYPE_META } from '../../lib/accounts';
import { ApiError } from '../../lib/api';
import { formatDate, money } from '../../lib/format';
import {
  useAccount,
  useAccounts,
  useAdjustBalance,
  useCategories,
  useCreateAccount,
  useCreateTransaction,
  useDeleteAccount,
  useUpdateAccount,
} from '../../lib/queries';

interface FormState {
  name: string;
  type: AccountType;
  initialBalance: number;
  initialDate: string;
  color: string;
  includeInTotals: boolean;
}

function errorText(err: unknown) {
  return err instanceof ApiError ? err.message : 'Algo deu errado. Tente de novo.';
}

function AccountForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  initial: FormState;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (state: FormState) => void;
}) {
  const [form, setForm] = useState(initial);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ ...form, name: form.name.trim() });
  };

  return (
    <form className="form card card--pad" onSubmit={submit} noValidate>
      {Boolean(error) && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      <div className="field">
        <label htmlFor="name">Nome</label>
        <input
          id="name"
          className="input"
          placeholder="Ex.: Nubank, Carteira, VR"
          required
          maxLength={120}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>

      <fieldset className="field fieldset">
        <legend className="field-label">Tipo</legend>
        <div className="choice-grid">
          {ACCOUNT_TYPES.map((t) => {
            const meta = ACCOUNT_TYPE_META[t];
            const Icon = meta.icon;
            return (
              <button
                key={t}
                type="button"
                className="choice"
                aria-pressed={form.type === t}
                onClick={() => set('type', t)}
              >
                <Icon size={20} aria-hidden="true" />
                {meta.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="initialBalance">Saldo em {formatDate(form.initialDate)}</label>
        <MoneyInput
          id="initialBalance"
          value={form.initialBalance}
          onChange={(v) => set('initialBalance', v)}
          allowNegative
          aria-describedby="initialBalance-hint"
        />
        <span id="initialBalance-hint" className="muted field-hint">
          O saldo que a conta tinha nessa data. Lançamentos antes dela não entram.
        </span>
      </div>

      <div className="field">
        <label htmlFor="initialDate">Data do saldo</label>
        <input
          id="initialDate"
          className="input"
          type="date"
          required
          value={form.initialDate}
          onChange={(e) => e.target.value && set('initialDate', e.target.value)}
        />
      </div>

      <fieldset className="field fieldset">
        <legend className="field-label">Cor</legend>
        <div className="swatches">
          {ACCOUNT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ background: c }}
              aria-pressed={form.color === c}
              aria-label={`Cor ${c}`}
              onClick={() => set('color', c)}
            />
          ))}
        </div>
      </fieldset>

      <label className="toggle">
        <input
          type="checkbox"
          checked={form.includeInTotals}
          onChange={(e) => set('includeInTotals', e.target.checked)}
        />
        <span>
          <strong>Somar no saldo total</strong>
          <span className="muted">
            Desligue para reservas e investimentos que não são do dia a dia.
          </span>
        </span>
      </label>

      <button
        className="btn btn--primary btn--block"
        type="submit"
        disabled={pending || !form.name.trim()}
      >
        {pending ? 'Salvando…' : submitLabel}
      </button>
    </form>
  );
}

export function NewAccountPage() {
  const create = useCreateAccount();
  const existing = useAccounts({ includeArchived: true });
  const color =
    ACCOUNT_COLORS[(existing.data?.length ?? 0) % ACCOUNT_COLORS.length] ?? ACCOUNT_COLORS[0];
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <>
      <PageHeader title="Nova conta" back="/contas" />
      <AccountForm
        key={color}
        initial={{
          name: '',
          type: 'checking',
          initialBalance: 0,
          initialDate: todayIn(),
          color,
          includeInTotals: true,
        }}
        submitLabel="Criar conta"
        pending={create.isPending}
        error={create.error}
        onSubmit={(f) =>
          create.mutate(f, {
            onSuccess: (a) => {
              toast({ text: `Conta "${a.name}" criada.` });
              navigate('/contas');
            },
          })
        }
      />
    </>
  );
}

/** Tipos de conta em que o dinheiro costuma render. */
const YIELDING: AccountType[] = ['investment', 'savings', 'checking'];

function AdjustBalance({ account }: { account: Account }) {
  const adjust = useAdjustBalance();
  const createTx = useCreateTransaction();
  const categories = useCategories();
  const toast = useToast();
  const [real, setReal] = useState(account.balance);
  const gain = real - account.balance;
  // Saldo maior que o calculado numa conta que rende: em geral é o rendimento do mês.
  const [asYield, setAsYield] = useState(account.type !== 'checking');
  const yieldCategory = (categories.data ?? []).find(
    (c) => c.kind === 'income' && !c.isSystem && c.name.toLowerCase() === 'rendimentos',
  );
  const canYield = gain > 0 && YIELDING.includes(account.type);
  const useYield = canYield && asYield;
  const error = adjust.error ?? createTx.error;
  const pending = adjust.isPending || createTx.isPending;

  const submit = () => {
    if (useYield) {
      createTx.mutate(
        {
          type: 'income',
          amount: gain,
          date: todayIn(),
          description: 'Rendimento',
          accountId: account.id,
          categoryId: yieldCategory?.id ?? null,
        },
        { onSuccess: () => toast({ text: `Rendimento de ${money(gain)} lançado.` }) },
      );
      return;
    }
    adjust.mutate(
      { accountId: account.id, realBalance: real },
      {
        onSuccess: (r) =>
          toast({
            text: r.adjustment
              ? `Ajuste de ${money(r.adjustment.amount, false, true)} lançado.`
              : 'O saldo já estava certo.',
          }),
      },
    );
  };

  return (
    <section className="card card--pad form" aria-labelledby="adjust-title">
      <div>
        <h2 id="adjust-title">Ajustar saldo</h2>
        <p className="muted">
          Saldo calculado hoje: <span className="num">{money(account.balance)}</span>. Se o banco
          mostra outro valor, informe o real e o FinApp lança a diferença.
        </p>
      </div>
      {Boolean(error) && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      <div className="field">
        <label htmlFor="realBalance">Saldo real hoje</label>
        <MoneyInput id="realBalance" value={real} onChange={setReal} allowNegative replaceOnType />
      </div>
      {canYield && (
        <label className="toggle">
          <input type="checkbox" checked={asYield} onChange={(e) => setAsYield(e.target.checked)} />
          <span>
            <strong>Os {money(gain)} a mais são rendimento</strong>
            <span className="muted">
              {' '}
              Entram como receita em Rendimentos (aparecem nos relatórios). Desmarcado, vira só um
              ajuste, fora das receitas.
            </span>
          </span>
        </label>
      )}
      <button
        type="button"
        className="btn"
        disabled={pending || real === account.balance}
        onClick={submit}
      >
        {useYield ? `Lançar rendimento de ${money(gain)}` : `Ajustar para ${money(real)}`}
      </button>
    </section>
  );
}

export function EditAccountPage() {
  const { id = '' } = useParams();
  const account = useAccount(id);
  const update = useUpdateAccount(id);
  const remove = useDeleteAccount(id);
  const navigate = useNavigate();
  const toast = useToast();

  if (account.isPending) return <div className="skeleton" style={{ height: 420 }} />;
  if (account.isError || !account.data) {
    return (
      <>
        <PageHeader title="Conta" back="/contas" />
        <p className="alert alert--error" role="alert">
          {errorText(account.error)}
        </p>
      </>
    );
  }
  const a = account.data;

  const setArchived = (archived: boolean) =>
    update.mutate(
      { archived },
      {
        onSuccess: () =>
          toast({
            text: archived ? `"${a.name}" arquivada.` : `"${a.name}" de volta às contas.`,
            action: { label: 'Desfazer', run: () => update.mutate({ archived: !archived }) },
          }),
      },
    );

  return (
    <>
      <PageHeader title={a.name} back="/contas" />
      <AccountForm
        key={a.id}
        initial={{
          name: a.name,
          type: a.type,
          initialBalance: a.initialBalance,
          initialDate: a.initialDate,
          color: a.color ?? ACCOUNT_COLORS[0],
          includeInTotals: a.includeInTotals,
        }}
        submitLabel="Salvar"
        pending={update.isPending}
        error={update.error}
        onSubmit={(f) => update.mutate(f, { onSuccess: () => toast({ text: 'Conta salva.' }) })}
      />

      {!a.archived && <AdjustBalance key={a.balance} account={a} />}

      <section className="card card--pad form" aria-label="Arquivar ou excluir">
        {remove.isError && (
          <p className="alert" role="alert">
            {errorText(remove.error)}
          </p>
        )}
        <button
          type="button"
          className="btn"
          disabled={update.isPending}
          onClick={() => setArchived(!a.archived)}
        >
          {a.archived ? (
            <ArchiveRestore size={18} aria-hidden="true" />
          ) : (
            <Archive size={18} aria-hidden="true" />
          )}
          {a.archived ? 'Desarquivar conta' : 'Arquivar conta'}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          disabled={remove.isPending}
          onClick={() => {
            if (
              !window.confirm(
                `Excluir a conta "${a.name}"? Só é possível se não tiver lançamentos.`,
              )
            )
              return;
            remove.mutate(undefined, {
              onSuccess: () => {
                toast({ text: `Conta "${a.name}" excluída.` });
                navigate('/contas');
              },
            });
          }}
        >
          <Trash2 size={18} aria-hidden="true" />
          Excluir conta
        </button>
      </section>
    </>
  );
}
