import type { SpaceSummary } from '@finapp/shared';
import { Copy, Crown, Link as LinkIcon, Trash2, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../auth/session';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { copyText } from '../../lib/clipboard';
import { useSpaceMembers, useSpaceMutations, useSwitchSpace } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

function SpaceCard({ space, myId }: { space: SpaceSummary; myId: string }) {
  const toast = useToast();
  const members = useSpaceMembers(space.id);
  const { rename, invite, removeMember, transfer, remove } = useSpaceMutations();
  const switchSpace = useSwitchSpace();
  const { data: me } = useMe();
  const isOwner = space.role === 'owner';
  const active = me?.activeSpaceId === space.id;
  const [name, setName] = useState(space.name);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const error =
    rename.error ?? invite.error ?? removeMember.error ?? transfer.error ?? remove.error;
  const others = (members.data ?? []).filter((m) => m.userId !== myId);

  const copy = async (text: string, done = 'Código copiado.') => {
    toast({
      text: (await copyText(text)) ? done : 'Não consegui copiar. Selecione e copie à mão.',
    });
  };

  return (
    <section className="card card--pad stack" aria-labelledby={`sp-${space.id}`}>
      <div className="goal-row__head">
        <h2 id={`sp-${space.id}`}>{space.name}</h2>
        {active ? (
          <span className="budget-tag budget-tag--ok">Em uso</span>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={switchSpace.isPending}
            onClick={() => switchSpace.mutate(space.id)}
          >
            Usar este espaço
          </button>
        )}
      </div>
      <p className="muted">
        {space.type === 'personal'
          ? 'Só você vê. Nada daqui aparece nos espaços compartilhados.'
          : isOwner
            ? 'Você é o dono. Os membros veem e editam tudo deste espaço.'
            : 'Você é membro. Vê e edita tudo deste espaço.'}
      </p>
      {error && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}

      {space.type === 'shared' && (
        <>
          <h3>Membros</h3>
          <ul className="list">
            {(members.data ?? []).map((m) => (
              <li key={m.userId} className="row-link">
                <span className="row-link__main">
                  <strong>
                    {m.name}
                    {m.userId === myId ? ' (você)' : ''}
                  </strong>
                  <span className="muted">
                    {m.email} · {m.role === 'owner' ? 'dono' : 'membro'}
                  </span>
                </span>
                {isOwner && m.userId !== myId && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Passar a posse para ${m.name}`}
                    title="Passar a posse"
                    disabled={transfer.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Passar a posse de "${space.name}" para ${m.name}? Você continua como membro e poderá sair do espaço.`,
                        )
                      ) {
                        transfer.mutate(
                          { spaceId: space.id, userId: m.userId },
                          { onSuccess: () => toast({ text: `${m.name} agora é dono do espaço.` }) },
                        );
                      }
                    }}
                  >
                    <Crown size={18} aria-hidden="true" />
                  </button>
                )}
                {m.role !== 'owner' && (isOwner || m.userId === myId) && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={m.userId === myId ? 'Sair do espaço' : `Remover ${m.name}`}
                    onClick={() => {
                      const text =
                        m.userId === myId ? 'Sair deste espaço?' : `Remover ${m.name} do espaço?`;
                      if (window.confirm(text)) {
                        removeMember.mutate({ spaceId: space.id, userId: m.userId });
                      }
                    }}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isOwner && others.length > 0 && (
            <p className="muted field-hint">
              Para sair, passe a posse para outro membro (ícone da coroa). Você continua como membro
              e depois pode sair.
            </p>
          )}

          {isOwner && (
            <>
              <form
                className="form"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  rename.mutate(
                    { id: space.id, name: name.trim() },
                    { onSuccess: () => toast({ text: 'Nome salvo.' }) },
                  );
                }}
              >
                <div className="field">
                  <label htmlFor={`nm-${space.id}`}>Nome do espaço</label>
                  <input
                    id={`nm-${space.id}`}
                    className="input"
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="btn"
                  disabled={!name.trim() || name.trim() === space.name || rename.isPending}
                >
                  Salvar nome
                </button>
              </form>

              <form
                className="form"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  invite.mutate(
                    { spaceId: space.id, ...(email.trim() ? { email: email.trim() } : {}) },
                    {
                      onSuccess: (inv) => {
                        setCode(inv.code);
                        setEmail('');
                      },
                    },
                  );
                }}
              >
                <div className="field">
                  <label htmlFor={`iv-${space.id}`}>Convidar (e-mail opcional)</label>
                  <input
                    id={`iv-${space.id}`}
                    className="input"
                    type="email"
                    placeholder="amigo@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <p className="muted">
                    A pessoa passa a ver e editar tudo de {space.name}. Quem ainda não tem conta usa
                    o mesmo código para criar a conta e já entra no espaço; quem já tem usa
                    &quot;Entrar com um código&quot; aqui embaixo. Vale por 7 dias, uma vez.
                  </p>
                </div>
                <button type="submit" className="btn btn--primary" disabled={invite.isPending}>
                  <UserPlus size={18} aria-hidden="true" />
                  Gerar convite
                </button>
                {code && (
                  <div className="alert" role="status">
                    <strong className="num">{code}</strong>{' '}
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Copiar código"
                      onClick={() => void copy(code)}
                    >
                      <Copy size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Copiar link do convite"
                      onClick={() =>
                        void copy(
                          `${window.location.origin}/criar-conta?convite=${code}`,
                          'Link copiado.',
                        )
                      }
                    >
                      <LinkIcon size={18} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </form>

              <details className="entry__more">
                <summary>Excluir este espaço</summary>
                <form
                  className="form"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    // O cartão some ao recarregar os espaços: o aviso não pode depender dele.
                    remove
                      .mutateAsync({ spaceId: space.id, confirmName })
                      .then(() => toast({ text: `Espaço "${space.name}" excluído.` }))
                      .catch(() => undefined);
                  }}
                >
                  <p className="muted">
                    O espaço some para todos os membros, com as contas, lançamentos e dívidas dele.
                    Quem estava usando volta para o espaço pessoal. Se quiser guardar uma cópia, use{' '}
                    <Link to="/exportar">Exportar dados</Link> com este espaço em uso antes.
                  </p>
                  <div className="field">
                    <label htmlFor={`del-${space.id}`}>
                      Para confirmar, digite o nome: {space.name}
                    </label>
                    <input
                      id={`del-${space.id}`}
                      className="input"
                      autoComplete="off"
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn--danger"
                    disabled={
                      remove.isPending ||
                      confirmName.trim().toLowerCase() !== space.name.trim().toLowerCase()
                    }
                  >
                    <Trash2 size={18} aria-hidden="true" />
                    Excluir espaço
                  </button>
                </form>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Espaços: pessoal e compartilhados, membros e convites. */
export function SpacesPage() {
  const toast = useToast();
  const { data: me } = useMe();
  const { create, accept } = useSpaceMutations();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const error = create.error ?? accept.error;

  return (
    <>
      <PageHeader title="Espaços e membros" back="/mais" />
      <p className="muted">
        Use um espaço compartilhado para as finanças do casal ou da família. O seu espaço pessoal
        continua só seu.
      </p>
      {error && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      {me?.spaces.map((s) => (
        <SpaceCard key={s.id} space={s} myId={me.user.id} />
      ))}

      <form
        className="card card--pad form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(name.trim(), {
            onSuccess: () => {
              setName('');
              toast({ text: 'Espaço criado.' });
            },
          });
        }}
      >
        <h2>
          <Users size={20} aria-hidden="true" /> Novo espaço compartilhado
        </h2>
        <div className="field">
          <label htmlFor="new-space">Nome</label>
          <input
            id="new-space"
            className="input"
            maxLength={120}
            placeholder="Ex.: Casa, Família"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!name.trim() || create.isPending}
        >
          Criar
        </button>
      </form>

      <form
        className="card card--pad form"
        onSubmit={(e) => {
          e.preventDefault();
          accept.mutate(code.trim(), {
            onSuccess: (s) => {
              setCode('');
              toast({ text: `Você entrou em ${s.name}.` });
            },
          });
        }}
      >
        <h2>Entrar com um código</h2>
        <div className="field">
          <label htmlFor="join-code">Código do convite</label>
          <input
            id="join-code"
            className="input"
            autoCapitalize="characters"
            placeholder="ABCD-EFGH"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <button type="submit" className="btn" disabled={code.trim().length < 4 || accept.isPending}>
          Entrar no espaço
        </button>
      </form>
    </>
  );
}
