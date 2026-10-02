import { healthResponseSchema } from '@finapp/shared';
import { useEffect, useState } from 'react';

type ApiState = 'checking' | 'online' | 'offline';

const labels: Record<ApiState, string> = {
  checking: 'Verificando servidor…',
  online: 'Servidor online',
  offline: 'Servidor indisponível',
};

export function App() {
  const [api, setApi] = useState<ApiState>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((body) => setApi(healthResponseSchema.safeParse(body).success ? 'online' : 'offline'))
      .catch(() => setApi('offline'));
  }, []);

  return (
    <main className="shell">
      <h1>FinApp</h1>
      <p>Seu controle financeiro está sendo construído.</p>
      <p className={`status status--${api}`} role="status">
        {labels[api]}
      </p>
    </main>
  );
}
