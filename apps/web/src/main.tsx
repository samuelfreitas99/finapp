import '@fontsource-variable/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { HiddenValuesProvider } from './lib/hidden-values';
import { applyTheme, readTheme } from './lib/theme';
import { router } from './router';
import './styles/tokens.css';
import './styles/app.css';

applyTheme(readTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HiddenValuesProvider>
        <RouterProvider router={router} />
      </HiddenValuesProvider>
    </QueryClientProvider>
  </StrictMode>,
);
