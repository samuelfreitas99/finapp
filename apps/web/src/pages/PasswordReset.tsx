import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authErrorMessage } from '../auth/messages';
import { BrandMark } from '../components/BrandMark';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <BrandMark />
          <div>
            <h1>{title}</h1>
          </div>
        </div>
        {children}
        <p className="auth__switch">
          Lembrou a senha? <Link to="/entrar">Entrar</Link>
        </p>
      </div>
    </main>
  );
}

/** "Esqueci a senha": manda o link por e-mail ou explica como pedir ao administrador. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const features = useQuery({
    queryKey: ['auth-features'],
    queryFn: () => api<{ passwordResetEmail: boolean }>('/api/auth-features'),
    staleTime: Infinity,
  });
  const request = useMutation({
    mutationFn: (value: string) =>
      api('/api/auth/request-password-reset', { method: 'POST', body: { email: value } }),
  });

  if (features.isPending) {
    return (
      <AuthShell title="Esqueci a senha">
        <div className="skeleton" style={{ height: 180 }} />
      </AuthShell>
    );
  }
  if (!features.data?.passwordResetEmail) {
    return (
      <AuthShell title="Esqueci a senha">
        <section className="card card--pad stack">
          <p>
            Por enquanto o FinApp não envia e-mail. Peça a quem te convidou um link para escolher
            uma senha nova: ele vale por 24 horas e só funciona uma vez.
          </p>
          <p className="muted">
            Seus dados continuam guardados; só a senha muda. O código do aplicativo autenticador, se
            você usa, continua o mesmo.
          </p>
        </section>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Esqueci a senha">
      {request.isSuccess ? (
        <section className="card card--pad stack" role="status">
          <p>
            Se existe uma conta com <strong>{email.trim()}</strong>, enviamos um link para escolher
            uma senha nova. Ele vale por 1 hora.
          </p>
          <p className="muted">Não chegou? Olhe o spam ou peça de novo daqui a um minuto.</p>
        </section>
      ) : (
        <form
          className="form card card--pad"
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            request.mutate(email.trim());
          }}
        >
          {request.isError && (
            <p className="alert alert--error" role="alert">
              {authErrorMessage(request.error)}
            </p>
          )}
          <p className="muted">Digite o e-mail da sua conta. Vamos mandar um link para ele.</p>
          <div className="field">
            <label htmlFor="forgot-email">E-mail</label>
            <input
              id="forgot-email"
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={request.isPending || !email.includes('@')}
          >
            {request.isPending ? 'Enviando…' : 'Enviar link'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

/** Tela aberta pelo link: escolher a senha nova. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const reset = useMutation({
    mutationFn: () =>
      api('/api/auth/reset-password', { method: 'POST', body: { token, newPassword: password } }),
    onSuccess: () => {
      toast({ text: 'Senha trocada. Entre com a senha nova.' });
      navigate('/entrar', { replace: true });
    },
  });
  const mismatch = again.length > 0 && again !== password;

  if (!token) {
    return (
      <AuthShell title="Redefinir senha">
        <p className="alert alert--error" role="alert">
          Link incompleto. Abra de novo o link que você recebeu ou peça outro em{' '}
          <Link to="/esqueci-senha">Esqueci a senha</Link>.
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Escolha uma senha nova">
      <form
        className="form card card--pad"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          reset.mutate();
        }}
      >
        {reset.isError && (
          <p className="alert alert--error" role="alert">
            {authErrorMessage(reset.error)}
          </p>
        )}
        <div className="field">
          <label htmlFor="new-password">Senha nova</label>
          <input
            id="new-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="muted field-hint">Pelo menos 8 caracteres.</span>
        </div>
        <div className="field">
          <label htmlFor="new-password-again">Repita a senha nova</label>
          <input
            id="new-password-again"
            className="input"
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          {mismatch && <span className="field-error">As duas senhas estão diferentes.</span>}
        </div>
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={reset.isPending || password.length < 8 || again !== password}
        >
          {reset.isPending ? 'Salvando…' : 'Trocar senha'}
        </button>
        <span className="muted field-hint">
          Ao trocar, o FinApp sai de todos os aparelhos em que você estava conectado.
        </span>
      </form>
    </AuthShell>
  );
}
