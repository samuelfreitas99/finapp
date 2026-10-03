import { addYearMonths, suggestRulePattern } from '@finapp/core';
import type { ImportPreview, ImportRow } from '@finapp/shared';
import { FileUp, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { monthLabel } from '../../lib/dates';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import {
  useAccounts,
  useCards,
  useCategories,
  useCategoryRules,
  useDeleteCategoryRule,
  useImport,
} from '../../lib/queries';
import { readTextFile } from '../../lib/read-text';
import { errorText } from '../transactions/EntryForm';

interface Line extends ImportRow {
  selected: boolean;
  chosenCategory: string;
  saveRule: boolean;
}

const DUP_TEXT = {
  exact: 'Já importado antes',
  possible: 'Parece repetido de outra importação',
} as const;

/** O que acontece com um item que casou com um lançamento da conta. */
function matchText(l: Line, hidden: boolean): string {
  if (!l.match) return '';
  const what = `“${l.match.description}” de ${formatDate(l.match.date)}`;
  if (l.match.kind === 'settled') return `Você já lançou ${what}: não vai duplicar.`;
  const diff = l.match.amount !== l.amount ? ` (previsto ${money(l.match.amount, hidden)})` : '';
  return `Confirma o previsto ${what}${diff}.`;
}

function HowItWorks() {
  return (
    <details className="card card--pad">
      <summary>Como funciona (primeira vez e todo mês)</summary>
      <div className="stack legal__body">
        <p>
          <strong>Primeira vez:</strong> o app só importa o que é do dia do saldo inicial da conta
          em diante. Para trazer os últimos meses, abra a conta e ponha como saldo inicial o saldo
          do primeiro dia que você quer importar; depois importe o extrato desde esse dia.
        </p>
        <p>
          <strong>Todo mês:</strong> baixe o extrato do mês no app do banco e importe. Pode pegar um
          período maior sem medo: o que já foi importado é reconhecido e fica de fora.
        </p>
        <p>
          <strong>Sem duplicar:</strong> se você já lançou à mão, o app liga o seu lançamento ao
          extrato em vez de criar outro. Se era um previsto (salário, conta fixa, parcela de
          dívida), ele é confirmado com o valor e a data do banco.
        </p>
        <p>
          <strong>Formato:</strong> prefira OFX (o mais confiável). CSV também funciona; se as
          saídas vierem positivas, marque &quot;Inverter os sinais&quot;.
        </p>
        <p>
          <strong>Cartão de crédito:</strong> em &quot;Importar para&quot;, escolha o cartão e o mês
          da fatura, e use o arquivo daquela fatura (no Nubank: Fatura › Exportar). Compras que você
          já lançou e parcelas de parcelamentos do app são reconhecidas.
        </p>
      </div>
    </details>
  );
}

function Rules() {
  const rules = useCategoryRules();
  const remove = useDeleteCategoryRule();
  const items = rules.data ?? [];
  if (items.length === 0) return null;
  return (
    <details className="card card--pad">
      <summary>Regras de categoria ({items.length})</summary>
      <p className="muted">
        Quando a descrição contém o trecho, a categoria é preenchida na importação.
      </p>
      <ul className="list">
        {items.map((r) => (
          <li key={r.id} className="row-link">
            <span className="row-link__main">
              <strong>“{r.pattern}”</strong>
              <span className="muted">{r.categoryName}</span>
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Apagar regra ${r.pattern}`}
              onClick={() => remove.mutate(r.id)}
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Importação de extrato OFX/CSV: prévia, duplicados e categorias por regra. */
export function ImportPage() {
  const toast = useToast();
  const { hidden } = useHiddenValues();
  const accounts = useAccounts();
  const cards = useCards();
  const categories = useCategories();
  const { preview, commit } = useImport();
  const input = useRef<HTMLInputElement>(null);
  // `acc:<id>` (extrato de conta) ou `card:<id>` (fatura de cartão).
  const [targetValue, setTargetValue] = useState('');
  const [invoiceMonth, setInvoiceMonth] = useState('');
  const [invert, setInvert] = useState(false);
  const [file, setFile] = useState<{ name: string; content: string; format: 'ofx' | 'csv' } | null>(
    null,
  );
  const [lines, setLines] = useState<Line[] | null>(null);
  const [counts, setCounts] = useState<ImportPreview['counts'] | null>(null);
  const [done, setDone] = useState<{
    created: number;
    confirmed: number;
    linked: number;
    skipped: number;
    rules: number;
  } | null>(null);

  const target = targetValue || (accounts.data?.[0] ? `acc:${accounts.data[0].id}` : '');
  const isCard = target.startsWith('card:');
  const targetId = target.slice(target.indexOf(':') + 1);
  const card = isCard ? cards.data?.find((c) => c.id === targetId) : undefined;
  // Meses de fatura oferecidos: a aberta e as três anteriores; padrão a última fechada.
  const months = card
    ? [0, -1, -2, -3].map((k) => addYearMonths(card.currentInvoice.referenceMonth, k))
    : [];
  const month = invoiceMonth || months[1] || '';
  const targetBody = isCard ? { cardId: targetId, invoiceMonth: month } : { accountId: targetId };
  const reset = () => {
    setLines(null);
    setFile(null);
  };
  const cats = categories.data ?? [];
  const optionsFor = (type: 'income' | 'expense') =>
    cats.filter((c) => c.kind === type && !c.isSystem && !c.archived);
  const error = preview.error ?? commit.error;

  const load = (f: { name: string; content: string; format: 'ofx' | 'csv' }, inv: boolean) => {
    setDone(null);
    preview.mutate(
      { ...targetBody, format: f.format, content: f.content, invert: inv },
      {
        onSuccess: (data) => {
          setCounts(data.counts);
          setLines(
            data.rows.map((r) => ({
              ...r,
              // Item que casou com um lançamento já vem marcado: confirma ou liga, não duplica.
              selected: !r.duplicate && !r.beforeInitialDate && !r.invoicePayment,
              chosenCategory: r.categoryId ?? '',
              saveRule: false,
            })),
          );
        },
        onError: () => setLines(null),
      },
    );
  };

  const pick = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !target) return;
    const format = /\.(ofx|qfx)$/i.test(f.name) ? 'ofx' : 'csv';
    const next = { name: f.name, content: await readTextFile(f), format } as const;
    // Fatura em CSV costuma trazer a compra como valor positivo.
    const inv = format === 'csv' && isCard ? true : invert;
    setInvert(inv);
    setFile(next);
    load(next, inv);
    if (input.current) input.current.value = '';
  };

  const chosen = useMemo(() => (lines ?? []).filter((l) => l.selected), [lines]);
  const totals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const l of chosen) {
      if (l.type === 'income') inc += l.amount;
      else exp += l.amount;
    }
    return { inc, exp };
  }, [chosen]);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((cur) => (cur ?? []).map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = () => {
    if (chosen.length === 0) return;
    commit.mutate(
      {
        ...targetBody,
        items: chosen.map((l) => ({
          date: l.date,
          type: l.type,
          amount: l.amount,
          description: l.description.slice(0, 300),
          importKey: l.importKey,
          categoryId: l.chosenCategory || null,
          saveRule: l.saveRule && l.chosenCategory !== '',
          matchId: l.match?.id ?? null,
        })),
      },
      {
        onSuccess: (r) => {
          setDone({
            created: r.created,
            confirmed: r.confirmed,
            linked: r.linked,
            skipped: r.skipped,
            rules: r.rulesCreated,
          });
          setLines(null);
          setFile(null);
          toast({ text: 'Extrato importado.' });
        },
      },
    );
  };

  return (
    <>
      <PageHeader title="Importar extrato" back="/mais" />
      <HowItWorks />
      <section className="card card--pad form">
        <div className="field">
          <label htmlFor="imp-account">Importar para</label>
          <select
            id="imp-account"
            className="input"
            value={target}
            onChange={(e) => {
              setTargetValue(e.target.value);
              setInvoiceMonth('');
              reset();
            }}
          >
            <optgroup label="Extrato de conta">
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={`acc:${a.id}`}>
                  {a.name}
                </option>
              ))}
            </optgroup>
            {(cards.data ?? []).length > 0 && (
              <optgroup label="Fatura de cartão">
                {(cards.data ?? []).map((c) => (
                  <option key={c.id} value={`card:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        {isCard && (
          <div className="field">
            <label htmlFor="imp-month">Fatura de</label>
            <select
              id="imp-month"
              className="input"
              value={month}
              onChange={(e) => {
                setInvoiceMonth(e.target.value);
                reset();
              }}
            >
              {months.map((m, k) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                  {k === 0 ? ' (aberta)' : ''}
                </option>
              ))}
            </select>
            <span className="muted field-hint">
              Use o arquivo dessa fatura: tudo entra nela, mesmo parcelas de compras antigas. O
              pagamento da fatura fica de fora (ele sai da conta).
            </span>
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept=".ofx,.qfx,.csv,text/csv,application/x-ofx"
          hidden
          onChange={(e) => void pick(e.target.files)}
        />
        <button
          type="button"
          className="btn btn--primary"
          disabled={!target || preview.isPending}
          onClick={() => input.current?.click()}
        >
          <FileUp size={18} aria-hidden="true" />
          {preview.isPending ? 'Lendo…' : 'Escolher arquivo OFX ou CSV'}
        </button>
        <p className="muted">
          Baixe o extrato no app ou site do banco (OFX é o mais confiável). Nada é gravado antes de
          você confirmar.
        </p>
        {file?.format === 'csv' && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={invert}
              onChange={(e) => {
                setInvert(e.target.checked);
                load(file, e.target.checked);
              }}
            />
            <span>
              <strong>Inverter os sinais</strong>
              <span className="muted">Marque se as saídas aparecem como valores positivos.</span>
            </span>
          </label>
        )}
      </section>

      {error && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      {done && (
        <section className="card card--pad stack" role="status">
          <h2>Importação concluída</h2>
          <ul className="legal__body">
            <li>{done.created} lançamentos novos</li>
            {done.confirmed > 0 && <li>{done.confirmed} previstos confirmados</li>}
            {done.linked > 0 && <li>{done.linked} que você já tinha lançado (não duplicados)</li>}
            {done.skipped > 0 && <li>{done.skipped} ignorados por já existirem</li>}
            {done.rules > 0 && <li>{done.rules} regras de categoria salvas</li>}
          </ul>
        </section>
      )}

      {lines && counts && (
        <section className="card card--pad stack" aria-labelledby="imp-preview">
          <h2 id="imp-preview">{file?.name}</h2>
          <p className="muted">
            {counts.total} itens no arquivo: {counts.ready - counts.matched}{' '}
            {counts.ready - counts.matched === 1 ? 'novo' : 'novos'}
            {counts.matched > 0 ? `, ${counts.matched} já existem no app (confirmar ou ligar)` : ''}
            {counts.exact > 0 ? `, ${counts.exact} já importados` : ''}
            {counts.possible > 0 ? `, ${counts.possible} parecem repetidos (desmarcados)` : ''}.
            Tudo entra como efetivado.
          </p>
          <ul className="import-lines">
            {lines.map((l, i) => (
              <li
                key={l.importKey}
                className={
                  l.duplicate || l.beforeInitialDate || l.invoicePayment
                    ? 'import-line import-line--dim'
                    : 'import-line'
                }
              >
                <label className="toggle import-line__check">
                  <input
                    type="checkbox"
                    checked={l.selected}
                    disabled={l.beforeInitialDate || l.invoicePayment || l.duplicate === 'exact'}
                    aria-label={`Importar ${l.description}`}
                    onChange={(e) => update(i, { selected: e.target.checked })}
                  />
                  <span>
                    <strong>{l.description}</strong>
                    <span className="muted">
                      {formatDate(l.date)}
                      {l.duplicate ? ` · ${DUP_TEXT[l.duplicate]}` : ''}
                      {l.beforeInitialDate ? ' · antes do saldo inicial da conta' : ''}
                      {l.invoicePayment ? ' · pagamento da fatura (já sai da conta)' : ''}
                    </span>
                    {l.match && !l.beforeInitialDate && (
                      <span className="import-line__match">{matchText(l, hidden)}</span>
                    )}
                  </span>
                </label>
                <span className={`num ${l.type === 'income' ? 'income' : 'expense'}`}>
                  {money(l.type === 'income' ? l.amount : -l.amount, hidden)}
                </span>
                {l.selected && l.match && (
                  <div className="import-line__cat">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => update(i, { match: null })}
                    >
                      Não é o mesmo: lançar como novo
                    </button>
                  </div>
                )}
                {l.selected && !l.match && (
                  <div className="import-line__cat">
                    <select
                      className="input"
                      aria-label={`Categoria de ${l.description}`}
                      value={l.chosenCategory}
                      onChange={(e) =>
                        update(i, { chosenCategory: e.target.value, saveRule: false })
                      }
                    >
                      <option value="">Sem categoria</option>
                      {optionsFor(l.type).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {l.chosenCategory !== '' && l.chosenCategory !== (l.categoryId ?? '') && (
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={l.saveRule}
                          onChange={(e) => update(i, { saveRule: e.target.checked })}
                        />
                        <span className="muted">
                          Lembrar para “{suggestRulePattern(l.description)}”
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="form__actions">
            <span className="muted">
              {chosen.length} selecionados · entradas {money(totals.inc, hidden)} · saídas{' '}
              {money(totals.exp, hidden)}
            </span>
            <button
              type="button"
              className="btn btn--primary"
              disabled={chosen.length === 0 || commit.isPending}
              onClick={submit}
            >
              {commit.isPending ? 'Importando…' : `Importar ${chosen.length}`}
            </button>
          </div>
        </section>
      )}
      <Rules />
    </>
  );
}
