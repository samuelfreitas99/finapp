import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * Título de tela interna, com "voltar" e ação à direita.
 *
 * Padrão do app: as 4 telas da barra inferior (Início, Lançamentos, Cartões, Mais) não têm
 * "voltar"; toda outra tela tem. "Voltar" desfaz a última navegação (e a tela anterior reabre
 * onde estava); se a tela foi aberta direto por link, vai para `back`.
 */
export function PageHeader({
  title,
  back,
  action,
}: {
  title: string;
  back?: string;
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(back ?? '/', { replace: true });
  };
  return (
    <header className="page-header">
      {back && (
        <button type="button" className="icon-btn" aria-label="Voltar" onClick={goBack}>
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
      )}
      <h1>{title}</h1>
      {action && <div className="page-header__action">{action}</div>}
    </header>
  );
}
