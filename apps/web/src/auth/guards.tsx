import { Navigate, Outlet } from 'react-router';
import { LockGate } from '../components/LockGate';
import { useMe } from './session';

function Loading() {
  return (
    <div className="app__main" aria-busy="true" aria-label="Carregando">
      <div className="skeleton" style={{ height: 44 }} />
      <div className="skeleton" style={{ height: 150 }} />
      <div className="skeleton" style={{ height: 220 }} />
    </div>
  );
}

function ServerError({ retry }: { retry: () => void }) {
  return (
    <main className="auth">
      <div className="auth__panel card card--pad">
        <h1>Sem conexão com o servidor</h1>
        <p className="muted">Verifique sua internet e tente de novo.</p>
        <button type="button" className="btn btn--primary" onClick={retry}>
          Tentar de novo
        </button>
      </div>
    </main>
  );
}

/** Só entra logado; senão vai para /entrar. */
export function RequireAuth() {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.isError) return <ServerError retry={() => void me.refetch()} />;
  if (!me.data) return <Navigate to="/entrar" replace />;
  return (
    <LockGate enabled={me.data.pinEnabled}>
      <Outlet />
    </LockGate>
  );
}

/** Telas de login/cadastro: quem já está logado vai para o início. */
export function GuestOnly() {
  const me = useMe();
  if (me.isPending) return null;
  if (me.data) return <Navigate to="/" replace />;
  return <Outlet />;
}
