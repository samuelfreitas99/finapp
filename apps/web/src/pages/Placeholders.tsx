import { Tags } from 'lucide-react';
import { ComingSoon } from '../components/ComingSoon';
import { TopBar } from '../layout/AppLayout';

export function CategoriesPage() {
  return (
    <>
      <TopBar />
      <h1>Categorias</h1>
      <ComingSoon icon={Tags} title="Categorias" text="Edição de categorias chega em breve." />
    </>
  );
}
