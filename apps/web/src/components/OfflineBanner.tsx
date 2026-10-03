import { useQueryClient } from '@tanstack/react-query';
import { CloudOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { flushQueue, queued, subscribeQueue } from '../lib/offline-queue';
import { useToast } from './Toast';

/** Faixa discreta de offline e envio automático dos lançamentos guardados no aparelho. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pending, setPending] = useState(() => queued().length);
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => subscribeQueue((items) => setPending(items.length)), []);

  useEffect(() => {
    const flush = async () => {
      if (!navigator.onLine || queued().length === 0) return;
      const { sent, rejected } = await flushQueue();
      if (sent) {
        await qc.invalidateQueries();
        toast({ text: `${sent} lançamento(s) feitos offline foram enviados.` });
      }
      if (rejected.length) {
        toast({
          text: `${rejected.length} lançamento(s) offline foram recusados pelo servidor. Lance de novo.`,
        });
      }
    };
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    void flush();
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [qc, toast]);

  if (online && pending === 0) return null;
  return (
    <div className="offline-banner" role="status">
      <CloudOff size={16} aria-hidden="true" />
      {online
        ? `Enviando ${pending} lançamento(s) feitos offline…`
        : pending
          ? `Sem conexão. ${pending} lançamento(s) guardados no aparelho.`
          : 'Sem conexão. Os dados podem estar desatualizados.'}
    </div>
  );
}
