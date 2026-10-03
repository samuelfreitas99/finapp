import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { authErrorMessage } from '../auth/messages';
import { meKey, useMe } from '../auth/session';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { copyText } from '../lib/clipboard';

interface Setup {
  totpURI: string;
  backupCodes: string[];
}

/** Verificação em duas etapas por aplicativo autenticador (TOTP), com códigos de backup. */
export function TwoFactorCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const enabled = me.data?.twoFactorEnabled ?? false;
  const [mode, setMode] = useState<'idle' | 'enable' | 'confirm' | 'disable'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (!setup) return;
    let cancelled = false;
    void QRCode.toDataURL(setup.totpURI, { margin: 1, width: 192 }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [setup]);

  const reset = () => {
    setMode('idle');
    setPassword('');
    setCode('');
    setSetup(null);
    setQr('');
  };

  const start = useMutation({
    mutationFn: () =>
      api<Setup>('/api/auth/two-factor/enable', { method: 'POST', body: { password } }),
    onSuccess: (data) => {
      setSetup(data);
      setPassword('');
      setMode('confirm');
    },
  });
  const confirm = useMutation({
    mutationFn: () => api('/api/auth/two-factor/verify-totp', { method: 'POST', body: { code } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      toast({ text: 'Verificação em duas etapas ligada.' });
      // Os códigos de backup continuam na tela até o usuário fechar.
      setCode('');
      setMode('idle');
    },
  });
  const disable = useMutation({
    mutationFn: () => api('/api/auth/two-factor/disable', { method: 'POST', body: { password } }),
    onSuccess: async () => {
      reset();
      await qc.invalidateQueries({ queryKey: meKey });
      toast({ text: 'Verificação em duas etapas desligada.' });
    },
  });
  const error = start.error ?? confirm.error ?? disable.error;
  const secret = setup ? (new URL(setup.totpURI).searchParams.get('secret') ?? '') : '';

  return (
    <section className="card card--pad form" aria-labelledby="2fa-title">
      <h2 id="2fa-title">Verificação em duas etapas</h2>
      <p className="muted">
        {enabled
          ? 'Ligada: além da senha, o login pede um código do aplicativo autenticador.'
          : 'Além da senha, pede um código de 6 números de um aplicativo autenticador (Google Authenticator, Authy, 1Password...).'}
      </p>
      {error && (
        <p className="alert alert--error" role="alert">
          {authErrorMessage(error)}
        </p>
      )}

      {setup && mode === 'idle' && enabled && (
        <div className="stack">
          <h3>Guarde seus códigos de backup</h3>
          <p className="muted">
            Se perder o celular, cada código entra uma vez no lugar do aplicativo. Eles não serão
            mostrados de novo.
          </p>
          <ul className="backup-codes">
            {setup.backupCodes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <div className="form__actions">
            <button
              type="button"
              className="btn"
              onClick={async () =>
                toast({
                  text: (await copyText(setup.backupCodes.join('\n')))
                    ? 'Códigos copiados.'
                    : 'Não consegui copiar. Anote à mão.',
                })
              }
            >
              <Copy size={18} aria-hidden="true" />
              Copiar todos
            </button>
            <button type="button" className="btn btn--primary" onClick={reset}>
              Guardei os códigos
            </button>
          </div>
        </div>
      )}

      {mode === 'confirm' && setup && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            confirm.mutate();
          }}
        >
          <p>1. No aplicativo autenticador, escaneie o QR code (ou digite a chave).</p>
          {qr && (
            <img src={qr} width={192} height={192} alt="QR code para o aplicativo autenticador" />
          )}
          <div className="copy-line">
            <span className="muted">Ou digite esta chave no aplicativo:</span>
            <div className="copy-line__box">
              <code className="copy-line__value">{secret}</code>
              <button
                type="button"
                className="btn"
                onClick={async () =>
                  toast({
                    text: (await copyText(secret))
                      ? 'Chave copiada.'
                      : 'Não consegui copiar. Selecione e copie à mão.',
                  })
                }
              >
                <Copy size={18} aria-hidden="true" />
                Copiar chave
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="tf-code">2. Digite o código de 6 números que o aplicativo mostra</label>
            <input
              id="tf-code"
              className="input pin-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          <div className="form__actions">
            <button type="button" className="btn" onClick={reset}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={code.length !== 6 || confirm.isPending}
            >
              Ligar
            </button>
          </div>
        </form>
      )}

      {(mode === 'enable' || mode === 'disable') && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            (mode === 'enable' ? start : disable).mutate();
          }}
        >
          <div className="field">
            <label htmlFor="tf-password">Confirme com a sua senha</label>
            <input
              id="tf-password"
              className="input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="form__actions">
            <button type="button" className="btn" onClick={reset}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!password || start.isPending || disable.isPending}
            >
              {mode === 'enable' ? 'Continuar' : 'Desligar'}
            </button>
          </div>
        </form>
      )}

      {mode === 'idle' && !setup && (
        <div className="form__actions">
          {enabled ? (
            <button type="button" className="btn" onClick={() => setMode('disable')}>
              Desligar
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => setMode('enable')}>
              Ligar
            </button>
          )}
        </div>
      )}
    </section>
  );
}
