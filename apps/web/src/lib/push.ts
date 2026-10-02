import { api, ApiError } from './api';

/** Push só funciona com service worker; no iPhone, só com o app instalado (iOS 16.4+). */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function base64UrlToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Pede permissão, inscreve este aparelho e registra no servidor. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) {
    throw new ApiError(0, 'push_unsupported', 'Este navegador não recebe notificações.');
  }
  const { publicKey } = await api<{ publicKey: string }>('/api/push/vapid-key');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new ApiError(
      0,
      'push_denied',
      'Permissão negada. Libere as notificações do FinApp nas configurações do navegador.',
    );
  }
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    }));
  await api('/api/push/subscriptions', { method: 'POST', body: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/api/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}
