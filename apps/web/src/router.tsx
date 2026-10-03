import { createBrowserRouter, Navigate } from 'react-router';
import { GuestOnly, RequireAuth } from './auth/guards';
import { AppLayout } from './layout/AppLayout';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordReset';
import { PrivacyPage, TermsPage } from './pages/legal/LegalPages';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { MorePage } from './pages/More';
import { EditAccountPage, NewAccountPage } from './pages/accounts/AccountFormPage';
import { AccountsPage } from './pages/accounts/AccountsPage';
import { EditCardPage, NewCardPage } from './pages/cards/CardFormPage';
import { CardsPage } from './pages/cards/CardsPage';
import { PlanPage } from './pages/cards/PlanPage';
import { PlansPage } from './pages/cards/PlansPage';
import { CategoriesPage } from './pages/categories/CategoriesPage';
import { EditEntryPage, NewEntryPage } from './pages/transactions/EntryPages';
import { TransactionsPage } from './pages/transactions/TransactionsPage';
import { EditRecurrencePage, NewRecurrencePage } from './pages/recurrences/RecurrenceFormPage';
import { RecurrencesPage } from './pages/recurrences/RecurrencesPage';
import { PlanningPage } from './pages/planning/PlanningPage';
import { DebtPage } from './pages/debts/DebtPage';
import { DebtsPage } from './pages/debts/DebtsPage';
import { NewDebtPage } from './pages/debts/NewDebtPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { GoalsPage } from './pages/planning/GoalsPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { ImportPage } from './pages/import/ImportPage';
import { ExportPage } from './pages/export/ExportPage';
import { AuditPage } from './pages/audit/AuditPage';
import { InvitesPage } from './pages/invites/InvitesPage';
import { SpacesPage } from './pages/spaces/SpacesPage';
import { CouplePage } from './pages/couple/CouplePage';
import { GroupPage } from './pages/racha/GroupPage';
import { RachaPage } from './pages/racha/RachaPage';
import { SimulatorsPage } from './pages/simulators/SimulatorsPage';
import { BudgetsPage } from './pages/planning/BudgetsPage';
import { RemindersPage } from './pages/RemindersPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignUpPage } from './pages/SignUp';

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/entrar', element: <LoginPage /> },
      { path: '/criar-conta', element: <SignUpPage /> },
      { path: '/esqueci-senha', element: <ForgotPasswordPage /> },
    ],
  },
  // Aberta pelo link do e-mail, com ou sem sessão.
  { path: '/redefinir-senha', element: <ResetPasswordPage /> },
  // Públicas (link no login e no cadastro).
  { path: '/privacidade', element: <PrivacyPage /> },
  { path: '/termos', element: <TermsPage /> },
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
          { path: '/planejamento', element: <PlanningPage /> },
          { path: '/dividas', element: <DebtsPage /> },
          { path: '/dividas/nova', element: <NewDebtPage /> },
          { path: '/dividas/:id', element: <DebtPage /> },
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
          { path: '/configuracoes', element: <SettingsPage /> },
          { path: '/notificacoes', element: <NotificationsPage /> },
          { path: '/simuladores', element: <SimulatorsPage /> },
          { path: '/racha', element: <RachaPage /> },
          { path: '/racha/:id', element: <GroupPage /> },
          { path: '/casal', element: <CouplePage /> },
          { path: '/convites', element: <InvitesPage /> },
          { path: '/espacos', element: <SpacesPage /> },
          { path: '/historico', element: <AuditPage /> },
          { path: '/exportar', element: <ExportPage /> },
          { path: '/importar', element: <ImportPage /> },
          { path: '/relatorios', element: <ReportsPage /> },
          { path: '/metas', element: <GoalsPage /> },
          { path: '/orcamentos', element: <BudgetsPage /> },
          { path: '/lembretes', element: <RemindersPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
