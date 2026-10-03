import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authErrorMessage } from '../auth/messages';
import { useSignUp } from '../auth/session';
import { BrandMark } from '../components/BrandMark';

export function SignUpPage() {
  const signUp = useSignUp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    inviteCode: params.get('convite') ?? '',
    name: '',
    email: '',
    password: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const shortPassword = form.password.length > 0 && form.password.length < 8;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signUp.mutate(
      {
        inviteCode: form.inviteCode.trim(),
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      },
      { onSuccess: () => navigate('/', { replace: true }) },
    );
  };

  const ready =
    form.inviteCode.trim().length >= 4 &&
    form.name.trim() &&
    form.email.trim() &&
    form.password.length >= 8;

  return (
    <main className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <BrandMark />
          <div>
            <h1>Criar conta</h1>
            <p className="muted">O FinApp é só para convidados. Use o código que você recebeu.</p>
          </div>
        </div>
        <form className="form card card--pad" onSubmit={submit} noValidate>
          {signUp.isError && (
            <p className="alert alert--error" role="alert">
              {authErrorMessage(signUp.error)}
            </p>
          )}
          <div className="field">
            <label htmlFor="invite">Código do convite</label>
            <input
              id="invite"
              className="input num"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="XXXX-XXXX"
              required
              value={form.inviteCode}
              onChange={set('inviteCode')}
            />
          </div>
          <div className="field">
            <label htmlFor="name">Seu nome</label>
            <input
              id="name"
              className="input"
              autoComplete="name"
              required
              value={form.name}
              onChange={set('name')}
            />
          </div>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={form.email}
              onChange={set('email')}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="new-password"
              aria-invalid={shortPassword}
              aria-describedby="password-hint"
              required
              value={form.password}
              onChange={set('password')}
            />
            <span id="password-hint" className={shortPassword ? 'field-error' : 'muted'}>
              Pelo menos 8 caracteres.
            </span>
          </div>
          <button
            className="btn btn--primary btn--block"
            type="submit"
            disabled={signUp.isPending || !ready}
          >
            {signUp.isPending ? 'Criando…' : 'Criar conta'}
          </button>
          <span className="muted field-hint">
            Ao criar a conta, você concorda com os <Link to="/termos">termos de uso</Link> e a{' '}
            <Link to="/privacidade">política de privacidade</Link>.
          </span>
        </form>
        <p className="auth__switch">
          Já tem conta? <Link to="/entrar">Entrar</Link>
        </p>
      </div>
    </main>
  );
}
