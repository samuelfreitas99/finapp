import type { Theme } from '@finapp/shared';
import {
  BadgePercent,
  CalendarRange,
  ChevronRight,
  ChartPie,
  HandCoins,
  Landmark,
  LogOut,
  Settings,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSignOut } from '../auth/session';
import { TopBar } from '../layout/AppLayout';
import { applyTheme, readTheme } from '../lib/theme';

const ready: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/contas', label: 'Contas', icon: Landmark },
  { to: '/categorias', label: 'Categorias', icon: Tags },
];

const later: { label: string; icon: LucideIcon }[] = [
  { label: 'Dívidas', icon: HandCoins },
  { label: 'Planejamento', icon: CalendarRange },
  { label: 'Racha', icon: Users },
  { label: 'Relatórios', icon: ChartPie },
  { label: 'Orçamentos e metas', icon: BadgePercent },
  { label: 'Configurações', icon: Settings },
];

const themes: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
];

export function MorePage() {
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(readTheme);

  const chooseTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
  };

  return (
    <>
      <TopBar />
      <h1>Mais</h1>
      <ul className="list card">
        {ready.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link className="menu-row" to={to}>
              <Icon size={22} aria-hidden="true" />
              <span className="menu-row__label">{label}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
          </li>
        ))}
        {later.map(({ label, icon: Icon }) => (
          <li key={label}>
            <span className="menu-row" aria-disabled="true">
              <Icon size={22} aria-hidden="true" />
              <span className="menu-row__label">{label}</span>
              <span className="badge">Em breve</span>
            </span>
          </li>
        ))}
      </ul>

      <section className="card card--pad form" aria-labelledby="theme-title">
        <h2 id="theme-title">Tema</h2>
        <div className="segmented" role="group" aria-label="Tema">
          {themes.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={theme === t.value}
              onClick={() => chooseTheme(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="btn btn--danger"
        disabled={signOut.isPending}
        onClick={() =>
          signOut.mutate(undefined, { onSuccess: () => navigate('/entrar', { replace: true }) })
        }
      >
        <LogOut size={20} aria-hidden="true" />
        Sair
      </button>
    </>
  );
}
