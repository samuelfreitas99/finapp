import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { authErrorMessage } from '../auth/messages';
import { meKey, useSignIn, useVerifyTwoFactor } from '../auth/session';
import { useQueryClient } from '@tanstack/react-query';
import { BrandMark } from '../components/BrandMark';
import { passkeysSupported, signInWithPasskey } from '../lib/passkeys';

export function LoginPage() {
  const signIn = useSignIn();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const verify = useVerifyTwoFactor();
  const qc = useQueryClient();
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate(
      { email: email.trim(), password },
      {
        onSuccess: (data) => {
          if (data?.twoFactorRedirect) setNeedCode(true);
          else navigate('/', { replace: true });
        },
      },
    );
  };

  const loginWithPasskey = async () => {
    setPasskeyError(null);
    setPasskeyBusy(true);
    try {
      if (await signInWithPasskey()) {
        await qc.invalidateQueries({ queryKey: meKey });
        navigate('/', { replace: true });
      }
    } catch (err) {
      setPasskeyError(authErrorMessage(err));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate(
      { code: code.trim(), backup },
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
        {needCode ? (
          <form className="form card card--pad" onSubmit={submitCode} noValidate>
            <h2>Verificação em duas etapas</h2>
            <p className="muted">
              {backup
                ? 'Digite um dos códigos de backup que você guardou. Cada um vale uma vez.'
                : 'Digite o código de 6 números do seu aplicativo autenticador.'}
            </p>
            {verify.isError && (
              <p className="alert alert--error" role="alert">
                {authErrorMessage(verify.error)}
              </p>
            )}
            <div className="field">
              <label htmlFor="code">{backup ? 'Código de backup' : 'Código'}</label>
              <input
                id="code"
                className="input pin-input"
                autoComplete="one-time-code"
                inputMode={backup ? 'text' : 'numeric'}
                autoFocus
                value={code}
                onChange={(e) =>
                  setCode(backup ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))
                }
              />
            </div>
            <button
              className="btn btn--primary btn--block"
              type="submit"
              disabled={verify.isPending || code.trim().length < 6}
            >
              {verify.isPending ? 'Verificando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              className="btn btn--block"
              onClick={() => {
                setBackup((b) => !b);
                setCode('');
              }}
            >
              {backup ? 'Usar o aplicativo' : 'Usar um código de backup'}
            </button>
          </form>
        ) : (
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
              <Link to="/esqueci-senha" className="field-hint">
                Esqueci a senha
              </Link>
            </div>
            <button
              className="btn btn--primary btn--block"
              type="submit"
              disabled={signIn.isPending || !email || !password}
            >
              {signIn.isPending ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        )}
        {!needCode && passkeysSupported() && (
          <div className="stack">
            {passkeyError && (
              <p className="alert alert--error" role="alert">
                {passkeyError}
              </p>
            )}
            <button
              type="button"
              className="btn btn--block"
              disabled={passkeyBusy}
              onClick={() => void loginWithPasskey()}
            >
              {passkeyBusy ? 'Aguardando o aparelho…' : 'Entrar com chave de acesso'}
            </button>
          </div>
        )}
        <p className="auth__switch">
          Recebeu um convite? <Link to="/criar-conta">Criar conta</Link>
        </p>
        <p className="auth__switch muted">
          <Link to="/privacidade">Privacidade</Link> · <Link to="/termos">Termos de uso</Link>
        </p>
      </div>
    </main>
  );
}
