import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { authErrorMessage } from '../auth/messages';
import { useSignIn } from '../auth/session';
import { BrandMark } from '../components/BrandMark';

export function LoginPage() {
  const signIn = useSignIn();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate(
      { email: email.trim(), password },
      { onSuccess: () => navigate('/', { replace: true }) },
    );
  };

  return (
    <main className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <BrandMark />
          <div>
            <h1>Entrar no FinApp</h1>
            <p className="muted">Seu dinheiro, o que vence e o que vai sobrar.</p>
          </div>
        </div>
        <form className="form card card--pad" onSubmit={submit} noValidate>
          {signIn.isError && (
            <p className="alert alert--error" role="alert">
              {authErrorMessage(signIn.error)}
            </p>
          )}
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            className="btn btn--primary btn--block"
            type="submit"
            disabled={signIn.isPending || !email || !password}
          >
            {signIn.isPending ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <p className="auth__switch">
          Recebeu um convite? <Link to="/criar-conta">Criar conta</Link>
        </p>
      </div>
    </main>
  );
}
