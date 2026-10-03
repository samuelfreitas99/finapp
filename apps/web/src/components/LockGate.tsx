import { Lock } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSignOut } from '../auth/session';
import { api } from '../lib/api';
import { isUnlockedThisSession, markLocked, markUnlocked, shouldAutoLock } from '../lib/app-lock';
import { errorText } from '../pages/transactions/EntryForm';

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const signOut = useSignOut();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/me/pin/verify', { method: 'POST', body: { pin } });
      onUnlock();
    } catch (err) {
      setError(errorText(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <form className="auth__panel card card--pad form" onSubmit={(e) => void submit(e)}>
        <Lock size={32} aria-hidden="true" />
        <h1>App bloqueado</h1>
        <p className="muted">Digite seu PIN para continuar.</p>
        {error && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="lock-pin">PIN</label>
          <input
            id="lock-pin"
            className="input pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <button type="submit" className="btn btn--primary" disabled={busy || pin.length < 4}>
          Desbloquear
        </button>
        <button type="button" className="btn" onClick={() => signOut.mutate()}>
          Esqueci o PIN: sair e entrar com a senha
        </button>
      </form>
    </main>
  );
}

/**
 * Bloqueio do app por PIN: pede ao abrir e depois de um tempo em segundo plano. Enquanto
 * bloqueado, nada do app é mostrado. É uma trava de tela (protege o celular desbloqueado
 * na mão de outra pessoa); a sessão de login continua valendo.
 */
export function LockGate({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [locked, setLocked] = useState(() => enabled && !isUnlockedThisSession());

  useEffect(() => {
    if (!enabled) return;
    let hiddenAt: number | null = null;
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && shouldAutoLock(hiddenAt, Date.now())) {
        markLocked();
        setLocked(true);
        hiddenAt = null;
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [enabled]);

  if (enabled && locked) {
    return (
      <LockScreen
        onUnlock={() => {
          markUnlocked();
          setLocked(false);
        }}
      />
    );
  }
  return <>{children}</>;
}
