import { CARD_BRANDS, type Card, type CardBrand } from '@finapp/shared';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MoneyInput } from '../../components/MoneyInput';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { ACCOUNT_COLORS } from '../../lib/accounts';
import { useAccounts, useCard, useCards, useDeleteCard, useSaveCard } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

const BRAND_LABEL: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  elo: 'Elo',
  amex: 'American Express',
  hipercard: 'Hipercard',
  other: 'Outra',
};

interface FormState {
  name: string;
  brand: CardBrand | '';
  limitAmount: number;
  closingDay: number;
  dueDay: number;
  closingDayGoesToNext: boolean;
  paymentAccountId: string;
  color: string;
}

const days = Array.from({ length: 31 }, (_, i) => i + 1);

function CardForm({
  initial,
  submitLabel,
  onSubmit,
  pending,
  error,
}: {
  initial: FormState;
  submitLabel: string;
  onSubmit: (s: FormState) => void;
  pending: boolean;
  error: unknown;
}) {
  const accounts = useAccounts();
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
          placeholder="Ex.: Nubank, Inter"
          maxLength={120}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="limit">Limite</label>
        <MoneyInput
          id="limit"
          value={form.limitAmount}
          onChange={(v) => set('limitAmount', Math.max(0, v))}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="closingDay">Dia do fechamento</label>
          <select
            id="closingDay"
            className="input"
            value={form.closingDay}
            onChange={(e) => set('closingDay', Number(e.target.value))}
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dueDay">Dia do vencimento</label>
          <select
            id="dueDay"
            className="input"
            value={form.dueDay}
            onChange={(e) => set('dueDay', Number(e.target.value))}
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.closingDayGoesToNext}
          onChange={(e) => set('closingDayGoesToNext', e.target.checked)}
        />
        <span>
          <strong>Compra no dia do fechamento vai para a próxima fatura</strong>
          <span className="muted">É o padrão da maioria dos bancos.</span>
        </span>
      </label>
      <div className="field">
        <label htmlFor="paymentAccount">Conta que paga a fatura</label>
        <select
          id="paymentAccount"
          className="input"
          value={form.paymentAccountId}
          onChange={(e) => set('paymentAccountId', e.target.value)}
        >
          <option value="">Escolher na hora</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="brand">Bandeira</label>
        <select
          id="brand"
          className="input"
          value={form.brand}
          onChange={(e) => set('brand', e.target.value as CardBrand | '')}
        >
          <option value="">Não informar</option>
          {CARD_BRANDS.map((b) => (
            <option key={b} value={b}>
              {BRAND_LABEL[b]}
            </option>
          ))}
        </select>
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
      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={pending || !form.name.trim()}
      >
        {pending ? 'Salvando…' : submitLabel}
      </button>
    </form>
  );
}

const toBody = (f: FormState) => ({
  name: f.name,
  brand: f.brand || null,
  limitAmount: f.limitAmount,
  closingDay: f.closingDay,
  dueDay: f.dueDay,
  closingDayGoesToNext: f.closingDayGoesToNext,
  paymentAccountId: f.paymentAccountId || null,
  color: f.color,
});

export function NewCardPage() {
  const save = useSaveCard();
  const existing = useCards({ includeArchived: true });
  const navigate = useNavigate();
  const toast = useToast();
  const accounts = useAccounts();
  if (existing.isPending || accounts.isPending)
    return <div className="skeleton" style={{ height: 420 }} />;
  const color =
    ACCOUNT_COLORS[(existing.data?.length ?? 0) % ACCOUNT_COLORS.length] ?? ACCOUNT_COLORS[0];
  return (
    <>
      <PageHeader title="Novo cartão" back="/cartoes" />
      <CardForm
        initial={{
          name: '',
          brand: '',
          limitAmount: 0,
          closingDay: 1,
          dueDay: 8,
          closingDayGoesToNext: true,
          paymentAccountId: accounts.data?.[0]?.id ?? '',
          color,
        }}
        submitLabel="Criar cartão"
        pending={save.isPending}
        error={save.error}
        onSubmit={(f) =>
          save.mutate(toBody(f), {
            onSuccess: (c: Card) => {
              toast({ text: `Cartão "${c.name}" criado.` });
              navigate(`/cartoes?cartao=${c.id}`);
            },
          })
        }
      />
    </>
  );
}

export function EditCardPage() {
  const { id = '' } = useParams();
  const card = useCard(id);
  const save = useSaveCard(id);
  const remove = useDeleteCard(id);
  const navigate = useNavigate();
  const toast = useToast();
  if (card.isPending) return <div className="skeleton" style={{ height: 420 }} />;
  if (card.isError || !card.data) {
    return (
      <>
        <PageHeader title="Cartão" back="/cartoes" />
        <p className="alert alert--error" role="alert">
          {errorText(card.error)}
        </p>
      </>
    );
  }
  const c = card.data;
  return (
    <>
      <PageHeader title={c.name} back={`/cartoes?cartao=${c.id}`} />
      <CardForm
        key={c.id}
        initial={{
          name: c.name,
          brand: c.brand ?? '',
          limitAmount: c.limitAmount,
          closingDay: c.closingDay,
          dueDay: c.dueDay,
          closingDayGoesToNext: c.closingDayGoesToNext,
          paymentAccountId: c.paymentAccountId ?? '',
          color: c.color ?? ACCOUNT_COLORS[0],
        }}
        submitLabel="Salvar"
        pending={save.isPending}
        error={save.error}
        onSubmit={(f) =>
          save.mutate(toBody(f), {
            onSuccess: () => {
              toast({ text: 'Cartão salvo.' });
              navigate(`/cartoes?cartao=${c.id}`);
            },
          })
        }
      />
      <section className="card card--pad form" aria-label="Arquivar ou excluir">
        {remove.isError && (
          <p className="alert" role="alert">
            {errorText(remove.error)}
          </p>
        )}
        <button
          type="button"
          className="btn"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              { archived: !c.archived },
              {
                onSuccess: () =>
                  toast({
                    text: c.archived ? 'Cartão de volta.' : 'Cartão arquivado.',
                    action: { label: 'Desfazer', run: () => save.mutate({ archived: c.archived }) },
                  }),
              },
            )
          }
        >
          {c.archived ? (
            <ArchiveRestore size={18} aria-hidden="true" />
          ) : (
            <Archive size={18} aria-hidden="true" />
          )}
          {c.archived ? 'Desarquivar cartão' : 'Arquivar cartão'}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          disabled={remove.isPending}
          onClick={() => {
            if (
              !window.confirm(
                `Excluir o cartão "${c.name}"? Só é possível se não tiver lançamentos.`,
              )
            )
              return;
            remove.mutate(undefined, {
              onSuccess: () => {
                toast({ text: 'Cartão excluído.' });
                navigate('/cartoes');
              },
            });
          }}
        >
          <Trash2 size={18} aria-hidden="true" />
          Excluir cartão
        </button>
      </section>
    </>
  );
}
