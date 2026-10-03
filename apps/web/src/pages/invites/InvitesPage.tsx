import type { Invite } from '@finapp/shared';
import { Copy, Link as LinkIcon, Share2, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { copyText } from '../../lib/clipboard';
import { useInviteMutations, useInvites } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

type Status = 'pending' | 'used' | 'expired';

const statusOf = (i: Invite): Status =>
  i.usedAt ? 'used' : i.expiresAt && new Date(i.expiresAt) < new Date() ? 'expired' : 'pending';

const STATUS_TEXT: Record<Status, string> = {
  pending: 'Aguardando',
  used: 'Já usado',
  expired: 'Expirado',
};

const dateBR = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

const linkFor = (code: string) => `${window.location.origin}/criar-conta?convite=${code}`;
const messageFor = (code: string) =>
  `Convite para o FinApp, meu app de finanças. Crie sua conta por este link: ${linkFor(code)}\nSe preferir, use o código: ${code}`;

/** Convites para novas pessoas criarem conta (o cadastro só funciona com um código). */
export function InvitesPage() {
  const toast = useToast();
  const list = useInvites();
  const { create, revoke } = useInviteMutations();
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(7);
  const [fresh, setFresh] = useState<Invite | null>(null);
  const error = list.error ?? create.error ?? revoke.error;
  // Convites de espaço compartilhado são geridos em "Espaços e membros".
  const items = (list.data ?? []).filter((i) => !i.spaceId);

  const copy = async (text: string, done: string) =>
    toast({
      text: (await copyText(text)) ? done : 'Não consegui copiar. Selecione e copie à mão.',
    });

  const share = async (code: string) => {
    const text = messageFor(code);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Convite para o FinApp', text });
        return;
      } catch {
        // cancelou: não faz nada
        return;
      }
    }
    await copy(text, 'Mensagem copiada.');
  };

  return (
    <>
      <PageHeader title="Convidar pessoas" back="/mais" />
      <p className="muted">
        Este convite só cria a conta no FinApp: a pessoa começa com o espaço pessoal dela e não vê
        nada seu. Para dividir as finanças da casa com alguém, gere o convite do espaço em{' '}
        <Link to="/espacos">Espaços e membros</Link> (serve também para quem ainda não tem conta).
      </p>
      {error && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}

      <form
        className="card card--pad form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { ...(email.trim() ? { email: email.trim() } : {}), expiresInDays: days },
            {
              onSuccess: (inv) => {
                setFresh(inv);
                setEmail('');
              },
            },
          );
        }}
      >
        <h2>Novo convite</h2>
        <div className="field">
          <label htmlFor="inv-email">E-mail da pessoa (opcional)</label>
          <input
            id="inv-email"
            className="input"
            type="email"
            autoComplete="off"
            placeholder="amigo@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="muted">
            Com e-mail, só quem usar esse endereço consegue entrar com o código.
          </p>
        </div>
        <div className="field">
          <label htmlFor="inv-days">Vale por</label>
          <select
            id="inv-days"
            className="input"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[1, 7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {d === 1 ? '1 dia' : `${d} dias`}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn--primary" disabled={create.isPending}>
          <UserPlus size={18} aria-hidden="true" />
          Gerar convite
        </button>
      </form>

      {fresh && (
        <section className="card card--pad stack" role="status" aria-labelledby="inv-fresh">
          <h2 id="inv-fresh">Convite pronto</h2>
          <p className="invite-code num">{fresh.code}</p>
          <div className="form__actions">
            <button
              type="button"
              className="btn"
              onClick={() => void copy(fresh.code, 'Código copiado.')}
            >
              <Copy size={18} aria-hidden="true" />
              Copiar código
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void share(fresh.code)}
            >
              <Share2 size={18} aria-hidden="true" />
              Enviar convite
            </button>
          </div>
          <p className="muted">O link abre a criação de conta com o código já preenchido.</p>
        </section>
      )}

      <section className="card card--pad stack" aria-labelledby="inv-list">
        <h2 id="inv-list">Seus convites</h2>
        {list.isPending && <div className="skeleton" style={{ height: 80 }} />}
        {list.isSuccess && items.length === 0 && (
          <p className="muted">Nenhum convite criado ainda.</p>
        )}
        <ul className="list">
          {items.map((i) => {
            const status = statusOf(i);
            return (
              <li key={i.id} className="row-link">
                <span className="row-link__main">
                  <strong className="num">{i.code}</strong>
                  <span className="muted">
                    {STATUS_TEXT[status]}
                    {i.email ? ` · ${i.email}` : ''}
                    {status === 'pending' && i.expiresAt ? ` · até ${dateBR(i.expiresAt)}` : ''}
                    {status === 'used' && i.usedAt ? ` · em ${dateBR(i.usedAt)}` : ''}
                  </span>
                </span>
                {status === 'pending' && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Copiar link do convite ${i.code}`}
                      onClick={() => void copy(linkFor(i.code), 'Link copiado.')}
                    >
                      <LinkIcon size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Copiar código ${i.code}`}
                      onClick={() => void copy(i.code, 'Código copiado.')}
                    >
                      <Copy size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Enviar convite ${i.code}`}
                      onClick={() => void share(i.code)}
                    >
                      <Share2 size={18} aria-hidden="true" />
                    </button>
                  </>
                )}
                {status !== 'used' && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Cancelar convite ${i.code}`}
                    onClick={() => revoke.mutate(i.id)}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
