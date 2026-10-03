import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { meKey } from '../auth/session';
import { api } from '../lib/api';
import { errorText } from './transactions/EntryForm';

/** Excluir a própria conta e os dados pessoais (pede a senha e a palavra EXCLUIR). */
export function DeleteAccountCard() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const remove = useMutation({
    mutationFn: () => api('/api/me/delete', { method: 'POST', body: { password, confirm } }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(meKey, null);
    },
  });
  const ready = password !== '' && confirm === 'EXCLUIR';

  return (
    <section className="card card--pad form danger-zone" aria-labelledby="del-title">
      <h2 id="del-title">Excluir minha conta</h2>
      <p className="muted">
        Apaga a sua conta e todos os dados do seu espaço pessoal (contas, lançamentos, dívidas,
        metas...). Não dá para desfazer. Faça uma exportação antes, se quiser guardar uma cópia.
      </p>
      {!open ? (
        <div className="form__actions">
          <button type="button" className="btn btn--danger" onClick={() => setOpen(true)}>
            <Trash2 size={18} aria-hidden="true" />
            Excluir minha conta
          </button>
        </div>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) remove.mutate();
          }}
        >
          <ul className="muted">
            <li>Espaços compartilhados em que você é só membro continuam com os outros.</li>
            <li>Se você é dono de um espaço compartilhado com outras pessoas, remova-as antes.</li>
            <li>Nos grupos de racha, seu nome continua nas despesas já lançadas.</li>
          </ul>
          {remove.isError && (
            <p className="alert alert--error" role="alert">
              {errorText(remove.error)}
            </p>
          )}
          <div className="field">
            <label htmlFor="del-password">Sua senha</label>
            <input
              id="del-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="del-confirm">Digite EXCLUIR para confirmar</label>
            <input
              id="del-confirm"
              className="input"
              autoComplete="off"
              autoCapitalize="characters"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <div className="form__actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setOpen(false);
                setPassword('');
                setConfirm('');
                remove.reset();
              }}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn--danger" disabled={!ready || remove.isPending}>
              {remove.isPending ? 'Excluindo…' : 'Excluir para sempre'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
