import {
  ArrowLeftRight,
  CalendarRange,
  CreditCard,
  Ellipsis,
  House,
  Landmark,
  ListOrdered,
  Plus,
  Repeat,
  Tags,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Barra inferior (mobile). O "+" fica no meio. */
export const bottomNav: { left: NavItem[]; right: NavItem[] } = {
  left: [
    { to: '/', label: 'Início', icon: House },
    { to: '/lancamentos', label: 'Lançamentos', icon: ListOrdered },
  ],
  right: [
    { to: '/cartoes', label: 'Cartões', icon: CreditCard },
    { to: '/mais', label: 'Mais', icon: Ellipsis },
  ],
};

/** Barra lateral (desktop): todos os itens. */
export const sideNav: NavItem[] = [
  { to: '/', label: 'Início', icon: House },
  { to: '/lancamentos', label: 'Lançamentos', icon: ListOrdered },
  { to: '/cartoes', label: 'Cartões', icon: CreditCard },
  { to: '/contas', label: 'Contas', icon: Landmark },
  { to: '/fixas', label: 'Fixas', icon: Repeat },
  { to: '/planejamento', label: 'Planejamento', icon: CalendarRange },
  { to: '/categorias', label: 'Categorias', icon: Tags },
  { to: '/mais', label: 'Mais', icon: Ellipsis },
];

export const newEntry = { to: '/lancar', label: 'Novo lançamento', icon: Plus };
export const transferIcon = ArrowLeftRight;
