import type { DebtKind, DebtSystem } from '@finapp/shared';
import {
  Building2,
  CreditCard,
  Handshake,
  HandCoins,
  Landmark,
  Car,
  Users,
  Ellipsis,
  type LucideIcon,
} from 'lucide-react';

export const DEBT_KIND_META: Record<DebtKind, { label: string; icon: LucideIcon }> = {
  bank_loan: { label: 'Empréstimo no banco', icon: Landmark },
  card_loan: { label: 'Empréstimo no cartão', icon: CreditCard },
  personal_loan: { label: 'Empréstimo com pessoa', icon: Handshake },
  third_party_card: { label: 'Cartão de outra pessoa', icon: Users },
  financing: { label: 'Financiamento', icon: Car },
  agreement: { label: 'Acordo / renegociação', icon: HandCoins },
  consortium: { label: 'Consórcio', icon: Users },
  property: { label: 'Imóvel na planta', icon: Building2 },
  other: { label: 'Outra', icon: Ellipsis },
};

export const DEBT_SYSTEM_LABEL: Record<DebtSystem, string> = {
  fixed: 'Parcelas fixas',
  price: 'Price (parcela fixa com juros)',
  sac: 'SAC (amortização constante)',
  variable: 'Valor variável (juros de obra)',
  balloon: 'Parcelas avulsas (intermediárias)',
};

export const INSTALLMENT_STATUS_LABEL = {
  pending: 'A pagar',
  paid: 'Paga',
  late: 'Atrasada',
  partial: 'Paga em parte',
} as const;
