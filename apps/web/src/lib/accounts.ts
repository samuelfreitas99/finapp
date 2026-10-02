import type { AccountType } from '@finapp/shared';
import {
  Banknote,
  Landmark,
  PiggyBank,
  Smartphone,
  TrendingUp,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

export const ACCOUNT_TYPE_META: Record<AccountType, { label: string; icon: LucideIcon }> = {
  checking: { label: 'Conta corrente', icon: Landmark },
  savings: { label: 'Poupança', icon: PiggyBank },
  cash: { label: 'Dinheiro', icon: Banknote },
  investment: { label: 'Investimento', icon: TrendingUp },
  benefit: { label: 'Benefício (VR/VA)', icon: UtensilsCrossed },
  wallet: { label: 'Carteira digital', icon: Smartphone },
};

/** Cores sugeridas para contas (distintas em claridade, não só no tom). */
export const ACCOUNT_COLORS = [
  '#1F3A68',
  '#2F5597',
  '#6B3FA0',
  '#A23A28',
  '#B8652A',
  '#B03A6E',
  '#556070',
  '#161D2B',
] as const;
