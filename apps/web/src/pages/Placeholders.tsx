import { CreditCard, Tags } from 'lucide-react';
import { ComingSoon } from '../components/ComingSoon';
import { TopBar } from '../layout/AppLayout';

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
