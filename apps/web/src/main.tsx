import '@fontsource-variable/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { ToastProvider } from './components/Toast';
import { HiddenValuesProvider } from './lib/hidden-values';
import { applyTheme, readTheme } from './lib/theme';
import { router } from './router';
import './styles/tokens.css';
import './styles/app.css';

applyTheme(readTheme());
// Service worker: app instalável e casca disponível offline; atualiza sozinho a cada deploy.
registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
    // Sem pausar offline: a tela trata a falha (ex.: guarda o lançamento na fila).
    mutations: { networkMode: 'always' },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HiddenValuesProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </HiddenValuesProvider>
    </QueryClientProvider>
  </StrictMode>,
);
