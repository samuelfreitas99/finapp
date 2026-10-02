import { CreditCard, ListOrdered, Plus, Tags } from 'lucide-react';
import { ComingSoon } from '../components/ComingSoon';
import { TopBar } from '../layout/AppLayout';

export function TransactionsPage() {
  return (
    <>
      <TopBar />
      <h1>Lançamentos</h1>
      <ComingSoon
        icon={ListOrdered}
        title="Lista de lançamentos"
        text="Seus lançamentos por dia, com busca e filtros, chegam na próxima etapa."
      />
    </>
  );
}

export function NewEntryPage() {
  return (
    <>
      <TopBar />
      <h1>Novo lançamento</h1>
      <ComingSoon
        icon={Plus}
        title="Lançar despesa, receita ou transferência"
        text="Chega na próxima etapa."
      />
    </>
  );
}

export function CardsPage() {
  return (
    <>
      <TopBar />
      <h1>Cartões</h1>
      <ComingSoon
        icon={CreditCard}
        title="Cartões e faturas"
        text="Faturas, limite e parcelamentos entram na fase de cartões."
      />
    </>
  );
}

export function CategoriesPage() {
  return (
    <>
      <TopBar />
      <h1>Categorias</h1>
      <ComingSoon icon={Tags} title="Categorias" text="Edição de categorias chega em breve." />
    </>
  );
}
