import { House } from 'lucide-react';
import { useMe } from '../auth/session';
import { ComingSoon } from '../components/ComingSoon';
import { TopBar } from '../layout/AppLayout';

export function HomePage() {
  const { data } = useMe();
  const firstName = data?.user.name.split(' ')[0] ?? '';
  return (
    <>
      <TopBar />
      <h1>Olá, {firstName}</h1>
      <ComingSoon
        icon={House}
        title="Seu resumo aparece aqui"
        text="Saldo atual, previsto para o fim do mês e o que vence nos próximos dias."
      />
    </>
  );
}
