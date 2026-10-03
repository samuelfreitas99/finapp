import { suggestRulePattern } from '@finapp/core';
import type { ImportPreview, ImportRow } from '@finapp/shared';
import { FileUp, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import {
  useAccounts,
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

const DUP_TEXT = { exact: 'Já importado', possible: 'Parece repetido' } as const;

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
  const categories = useCategories();
  const { preview, commit } = useImport();
  const input = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState('');
  const [invert, setInvert] = useState(false);
  const [file, setFile] = useState<{ name: string; content: string; format: 'ofx' | 'csv' } | null>(
    null,
  );
  const [lines, setLines] = useState<Line[] | null>(null);
  const [counts, setCounts] = useState<ImportPreview['counts'] | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: number; rules: number } | null>(
    null,
  );

  const account = accountId || accounts.data?.[0]?.id || '';
  const cats = categories.data ?? [];
  const optionsFor = (type: 'income' | 'expense') =>
    cats.filter((c) => c.kind === type && !c.isSystem && !c.archived);
  const error = preview.error ?? commit.error;

  const load = (f: { name: string; content: string; format: 'ofx' | 'csv' }, inv: boolean) => {
    setDone(null);
    preview.mutate(
      { accountId: account, format: f.format, content: f.content, invert: inv },
      {
        onSuccess: (data) => {
          setCounts(data.counts);
          setLines(
            data.rows.map((r) => ({
              ...r,
              selected: !r.duplicate && !r.beforeInitialDate,
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
    if (!f || !account) return;
    const format = /\.(ofx|qfx)$/i.test(f.name) ? 'ofx' : 'csv';
    const next = { name: f.name, content: await readTextFile(f), format } as const;
    setFile(next);
    load(next, invert);
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
        accountId: account,
        items: chosen.map((l) => ({
          date: l.date,
          type: l.type,
          amount: l.amount,
          description: l.description.slice(0, 300),
          importKey: l.importKey,
          categoryId: l.chosenCategory || null,
          saveRule: l.saveRule && l.chosenCategory !== '',
        })),
      },
      {
        onSuccess: (r) => {
          setDone({ created: r.created, skipped: r.skipped, rules: r.rulesCreated });
          setLines(null);
          setFile(null);
          toast({ text: `${r.created} lançamentos importados.` });
        },
      },
    );
  };

  return (
    <>
      <PageHeader title="Importar extrato" back="/mais" />
      <section className="card card--pad form">
        <div className="field">
          <label htmlFor="imp-account">Conta do extrato</label>
          <select
            id="imp-account"
            className="input"
            value={account}
            onChange={(e) => {
              setAccountId(e.target.value);
              setLines(null);
              setFile(null);
            }}
          >
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
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
          disabled={!account || preview.isPending}
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
          <p>
            {done.created} lançamentos criados
            {done.skipped > 0 ? `, ${done.skipped} ignorados por já existirem` : ''}
            {done.rules > 0 ? `, ${done.rules} regras de categoria salvas` : ''}.
          </p>
        </section>
      )}

      {lines && counts && (
        <section className="card card--pad stack" aria-labelledby="imp-preview">
          <h2 id="imp-preview">{file?.name}</h2>
          <p className="muted">
            {counts.total} lançamentos no arquivo
            {counts.exact > 0 ? ` · ${counts.exact} já importados` : ''}
            {counts.possible > 0 ? ` · ${counts.possible} parecem repetidos (desmarcados)` : ''}.
            Receitas e despesas entram como efetivadas.
          </p>
          <ul className="import-lines">
            {lines.map((l, i) => (
              <li
                key={l.importKey}
                className={
                  l.duplicate || l.beforeInitialDate
                    ? 'import-line import-line--dim'
                    : 'import-line'
                }
              >
                <label className="toggle import-line__check">
                  <input
                    type="checkbox"
                    checked={l.selected}
                    disabled={l.beforeInitialDate || l.duplicate === 'exact'}
                    aria-label={`Importar ${l.description}`}
                    onChange={(e) => update(i, { selected: e.target.checked })}
                  />
                  <span>
                    <strong>{l.description}</strong>
                    <span className="muted">
                      {formatDate(l.date)}
                      {l.duplicate ? ` · ${DUP_TEXT[l.duplicate]}` : ''}
                      {l.beforeInitialDate ? ' · antes do saldo inicial da conta' : ''}
                    </span>
                  </span>
                </label>
                <span className={`num ${l.type === 'income' ? 'income' : 'expense'}`}>
                  {money(l.type === 'income' ? l.amount : -l.amount, hidden)}
                </span>
                {l.selected && (
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
