import { Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useGroups, useRachaMutations } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

/** Racha entre amigos: seus grupos, criar grupo e entrar com um código. */
export function RachaPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { hidden } = useHiddenValues();
  const groups = useGroups();
  const { create, join } = useRachaMutations();
  const [name, setName] = useState('');
  const [friends, setFriends] = useState('');
  const [code, setCode] = useState('');
  const [claim, setClaim] = useState<{
    name: string;
    unclaimed: { id: string; name: string }[];
  } | null>(null);
  const [claimId, setClaimId] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const error = groups.error ?? create.error ?? join.error;
  const items = groups.data ?? [];

  const lookup = async () => {
    setLookupError(null);
    try {
      const info = await api<{ name: string; unclaimed: { id: string; name: string }[] }>(
        `/api/split-groups/join/${encodeURIComponent(code.trim())}`,
      );
      setClaim(info);
      setClaimId('');
    } catch (err) {
      setClaim(null);
      setLookupError(errorText(err));
    }
  };

  return (
    <>
      <PageHeader title="Racha entre amigos" back="/mais" />
      <p className="muted">
        Divida viagens e contas com amigos, mesmo quem não tem o app. Veja quem deve a quem e acerte
        com Pix.
      </p>
      {error && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      {groups.isPending && <div className="skeleton" style={{ height: 120 }} />}
      {groups.isSuccess && items.length === 0 && (
        <section className="card empty">
          <Users size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Nenhum grupo ainda</h2>
          <p className="muted">Crie um grupo abaixo ou entre com o código de um amigo.</p>
        </section>
      )}
      {items.length > 0 && (
        <ul className="list card">
          {items.map((g) => (
            <li key={g.id}>
              <Link className="menu-row" to={`/racha/${g.id}`}>
                <span className="menu-row__label">
                  <strong>{g.name}</strong>
                  <span className="muted">
                    {g.participantCount} pessoas{g.archived ? ' · arquivado' : ''}
                  </span>
                </span>
                <span
                  className={`num ${g.myBalance < 0 ? 'expense' : g.myBalance > 0 ? 'income' : 'muted'}`}
                >
                  {g.myBalance === 0
                    ? 'Em dia'
                    : g.myBalance > 0
                      ? `A receber ${money(g.myBalance, hidden)}`
                      : `Você deve ${money(-g.myBalance, hidden)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form
        className="card card--pad form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            {
              name: name.trim(),
              friends: friends
                .split(/[,\n]/)
                .map((f) => f.trim())
                .filter(Boolean),
            },
            {
              onSuccess: (g) => {
                setName('');
                setFriends('');
                navigate(`/racha/${g.id}`);
              },
            },
          );
        }}
      >
        <h2>Novo grupo</h2>
        <div className="field">
          <label htmlFor="g-name">Nome</label>
          <input
            id="g-name"
            className="input"
            maxLength={120}
            placeholder="Ex.: Viagem Floripa"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="g-friends">Amigos (nomes separados por vírgula)</label>
          <input
            id="g-friends"
            className="input"
            placeholder="Ex.: Caio, Dani"
            value={friends}
            onChange={(e) => setFriends(e.target.value)}
          />
          <p className="muted">
            Não precisam ter conta. Quem tiver pode entrar depois com o código.
          </p>
        </div>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!name.trim() || create.isPending}
        >
          Criar grupo
        </button>
      </form>

      <section className="card card--pad form" aria-labelledby="join-title">
        <h2 id="join-title">Entrar com um código</h2>
        <div className="field">
          <label htmlFor="g-code">Código do grupo</label>
          <input
            id="g-code"
            className="input"
            autoCapitalize="characters"
            placeholder="ABCD-EFGH"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setClaim(null);
            }}
          />
        </div>
        {lookupError && (
          <p className="alert alert--error" role="alert">
            {lookupError}
          </p>
        )}
        {!claim ? (
          <button
            type="button"
            className="btn"
            disabled={code.trim().length < 4}
            onClick={() => void lookup()}
          >
            Continuar
          </button>
        ) : (
          <>
            <p>
              Grupo <strong>{claim.name}</strong>.
            </p>
            {claim.unclaimed.length > 0 && (
              <div className="field">
                <label htmlFor="g-claim">Você já está na lista?</label>
                <select
                  id="g-claim"
                  className="input"
                  value={claimId}
                  onChange={(e) => setClaimId(e.target.value)}
                >
                  <option value="">Não, entrar como eu mesmo</option>
                  {claim.unclaimed.map((p) => (
                    <option key={p.id} value={p.id}>
                      Sou {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              className="btn btn--primary"
              disabled={join.isPending}
              onClick={() =>
                join.mutate(
                  { code: code.trim(), ...(claimId ? { participantId: claimId } : {}) },
                  {
                    onSuccess: (g) => {
                      toast({ text: 'Você entrou no grupo.' });
                      navigate(`/racha/${g.id}`);
                    },
                  },
                )
              }
            >
              Entrar no grupo
            </button>
          </>
        )}
      </section>
    </>
  );
}
