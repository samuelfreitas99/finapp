import type { Theme } from '@finapp/shared';
import {
  BadgePercent,
  Calculator,
  Download,
  FileUp,
  Flag,
  History,
  CalendarRange,
  ChevronRight,
  ChartPie,
  HandCoins,
  Landmark,
  Layers,
  ListChecks,
  Repeat,
  LogOut,
  Settings,
  ShieldCheck,
  Split,
  Tags,
  Scale,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSignOut } from '../auth/session';
import { TopBar } from '../layout/AppLayout';
import { applyTheme, readTheme } from '../lib/theme';

interface MenuItem {
  to: string;
  label: string;
  /** O que a pessoa encontra lá, em poucas palavras. */
  hint: string;
  icon: LucideIcon;
}

/** Menu "Mais" agrupado por assunto (ver docs/avaliacao-e-futuro.md, item 5). */
const sections: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Dia a dia',
    items: [
      { to: '/contas', label: 'Contas', hint: 'Saldos, ajustes e transferências', icon: Landmark },
      {
        to: '/fixas',
        label: 'Receitas e despesas fixas',
        hint: 'Salário, aluguel, assinaturas',
        icon: Repeat,
      },
      {
        to: '/parcelamentos',
        label: 'Parcelamentos e carnês',
        hint: 'Compras parceladas e boletos',
        icon: Layers,
      },
      {
        to: '/dividas',
        label: 'Dívidas e empréstimos',
        hint: 'Financiamentos, imóvel, o que te devem',
        icon: HandCoins,
      },
      {
        to: '/lembretes',
        label: 'Lembretes e checklist',
        hint: 'Avisos no horário que você escolher',
        icon: ListChecks,
      },
    ],
  },
  {
    title: 'Planejar e acompanhar',
    items: [
      {
        to: '/planejamento',
        label: 'Planejamento',
        hint: 'Saldo previsto mês a mês',
        icon: CalendarRange,
      },
      {
        to: '/orcamentos',
        label: 'Orçamentos',
        hint: 'Limite de gasto por categoria',
        icon: BadgePercent,
      },
      { to: '/metas', label: 'Metas', hint: 'Cofrinhos para juntar dinheiro', icon: Flag },
      {
        to: '/relatorios',
        label: 'Relatórios',
        hint: 'Para onde vai o dinheiro, patrimônio',
        icon: ChartPie,
      },
      {
        to: '/simuladores',
        label: 'Simuladores',
        hint: 'Parcelar ou à vista, quitar dívida',
        icon: Calculator,
      },
    ],
  },
  {
    title: 'Dividir com pessoas',
    items: [
      {
        to: '/espacos',
        label: 'Espaços e membros',
        hint: 'Finanças da casa com outra pessoa',
        icon: Users,
      },
      {
        to: '/casal',
        label: 'Divisão do espaço (casal)',
        hint: 'Quem pagou o quê e quem deve',
        icon: Scale,
      },
      {
        to: '/racha',
        label: 'Racha entre amigos',
        hint: 'Viagens, festas, contas divididas',
        icon: Split,
      },
      {
        to: '/convites',
        label: 'Convidar pessoas',
        hint: 'Código para alguém criar conta no app',
        icon: UserPlus,
      },
    ],
  },
  {
    title: 'Dados e configurações',
    items: [
      { to: '/categorias', label: 'Categorias', hint: 'Criar, editar e organizar', icon: Tags },
      {
        to: '/importar',
        label: 'Importar extrato',
        hint: 'Arquivo OFX ou CSV do banco',
        icon: FileUp,
      },
      {
        to: '/exportar',
        label: 'Exportar dados',
        hint: 'Planilha ou cópia completa',
        icon: Download,
      },
      {
        to: '/historico',
        label: 'Histórico de alterações',
        hint: 'Quem mudou o quê no espaço',
        icon: History,
      },
      {
        to: '/configuracoes',
        label: 'Notificações e configurações',
        hint: 'Avisos, segurança, PIN, excluir conta',
        icon: Settings,
      },
      {
        to: '/privacidade',
        label: 'Privacidade e termos de uso',
        hint: 'O que guardamos e seus direitos',
        icon: ShieldCheck,
      },
    ],
  },
];

const themes: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Automático' },
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
      {sections.map((section) => {
        const id = `more-${section.title.toLowerCase().replace(/\W+/g, '-')}`;
        return (
          <section key={section.title} className="stack" aria-labelledby={id}>
            <h2 id={id} className="menu-section__title">
              {section.title}
            </h2>
            <ul className="list card">
              {section.items.map(({ to, label, hint, icon: Icon }) => (
                <li key={to}>
                  <Link className="menu-row" to={to}>
                    <Icon size={22} aria-hidden="true" />
                    <span className="menu-row__label">
                      {label}
                      <span className="menu-row__hint">{hint}</span>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

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
