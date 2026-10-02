import { createBrowserRouter, Navigate } from 'react-router';
import { GuestOnly, RequireAuth } from './auth/guards';
import { AppLayout } from './layout/AppLayout';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { MorePage } from './pages/More';
import {
  AccountsPage,
  CardsPage,
  CategoriesPage,
  NewEntryPage,
  TransactionsPage,
} from './pages/Placeholders';
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
          { path: '/lancar', element: <NewEntryPage /> },
          { path: '/cartoes', element: <CardsPage /> },
          { path: '/contas', element: <AccountsPage /> },
          { path: '/categorias', element: <CategoriesPage /> },
          { path: '/mais', element: <MorePage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
