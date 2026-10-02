import { createBrowserRouter, Navigate } from 'react-router';
import { GuestOnly, RequireAuth } from './auth/guards';
import { AppLayout } from './layout/AppLayout';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { MorePage } from './pages/More';
import { EditAccountPage, NewAccountPage } from './pages/accounts/AccountFormPage';
import { AccountsPage } from './pages/accounts/AccountsPage';
import { EditCardPage, NewCardPage } from './pages/cards/CardFormPage';
import { CardsPage } from './pages/cards/CardsPage';
import { PlanPage } from './pages/cards/PlanPage';
import { PlansPage } from './pages/cards/PlansPage';
import { CategoriesPage } from './pages/Placeholders';
import { EditEntryPage, NewEntryPage } from './pages/transactions/EntryPages';
import { TransactionsPage } from './pages/transactions/TransactionsPage';
import { EditRecurrencePage, NewRecurrencePage } from './pages/recurrences/RecurrenceFormPage';
import { RecurrencesPage } from './pages/recurrences/RecurrencesPage';
import { SignUpPage } from './pages/SignUp';

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/entrar', element: <LoginPage /> },
      { path: '/criar-conta', element: <SignUpPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/lancamentos', element: <TransactionsPage /> },
          { path: '/lancamentos/:id', element: <EditEntryPage /> },
          { path: '/lancar', element: <NewEntryPage /> },
          { path: '/cartoes', element: <CardsPage /> },
          { path: '/cartoes/novo', element: <NewCardPage /> },
          { path: '/cartoes/:id/editar', element: <EditCardPage /> },
          { path: '/fixas', element: <RecurrencesPage /> },
          { path: '/fixas/nova', element: <NewRecurrencePage /> },
          { path: '/fixas/:id', element: <EditRecurrencePage /> },
          { path: '/parcelamentos', element: <PlansPage /> },
          { path: '/parcelamentos/:id', element: <PlanPage /> },
          { path: '/contas', element: <AccountsPage /> },
          { path: '/contas/nova', element: <NewAccountPage /> },
          { path: '/contas/:id', element: <EditAccountPage /> },
          { path: '/categorias', element: <CategoriesPage /> },
          { path: '/mais', element: <MorePage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
