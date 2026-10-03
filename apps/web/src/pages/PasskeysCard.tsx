import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { authErrorMessage } from '../auth/messages';
import { useToast } from '../components/Toast';
import { deletePasskey, listPasskeys, passkeysSupported, registerPasskey } from '../lib/passkeys';

const KEY = ['passkeys'];

/** Chaves de acesso: entrar com digital, rosto ou PIN do aparelho, sem digitar a senha. */
export function PasskeysCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const supported = passkeysSupported();
  const [name, setName] = useState('');
  const list = useQuery({ queryKey: KEY, queryFn: listPasskeys, enabled: supported });
  const add = useMutation({
    mutationFn: () => registerPasskey(name.trim() || 'Este aparelho'),
    onSuccess: async (done) => {
      if (!done) return;
      setName('');
      await qc.invalidateQueries({ queryKey: KEY });
      toast({ text: 'Chave de acesso cadastrada.' });
    },
  });
  const remove = useMutation({
    mutationFn: deletePasskey,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      toast({ text: 'Chave de acesso removida.' });
    },
  });
  const error = add.error ?? remove.error ?? list.error;
  const items = list.data ?? [];

  return (
    <section className="card card--pad form" aria-labelledby="passkeys-title">
      <h2 id="passkeys-title">Chaves de acesso</h2>
      <p className="muted">
        Entre com a digital, o rosto ou o PIN do aparelho, sem digitar a senha. Cada aparelho tem a
        sua chave. A senha continua valendo.
      </p>
      {!supported && <p className="muted">Este navegador não oferece chaves de acesso.</p>}
      {error && (
        <p className="alert alert--error" role="alert">
          {authErrorMessage(error)}
        </p>
      )}
      {items.length > 0 && (
        <ul className="list">
          {items.map((p) => (
            <li key={p.id} className="row-link">
              <KeyRound size={20} aria-hidden="true" />
              <span className="row-link__main">
                <strong>{p.name ?? 'Chave de acesso'}</strong>
                <span className="muted">
                  {p.createdAt
                    ? `Criada em ${new Intl.DateTimeFormat('pt-BR').format(new Date(p.createdAt))}`
                    : ''}
                  {p.backedUp ? ' · sincronizada na conta do aparelho' : ''}
                </span>
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remover ${p.name ?? 'chave de acesso'}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(p.id)}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="pk-name">Nome do aparelho</label>
            <input
              id="pk-name"
              className="input"
              maxLength={60}
              placeholder="Ex.: Celular do Samuel"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn--primary" disabled={add.isPending}>
            {add.isPending ? 'Aguardando o aparelho…' : 'Adicionar chave neste aparelho'}
          </button>
        </form>
      )}
    </section>
  );
}
