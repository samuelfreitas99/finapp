import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** Título de tela interna, com "voltar" e ação à direita. */
export function PageHeader({
  title,
  back,
  action,
}: {
  title: string;
  back?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      {back && (
        <Link to={back} className="icon-btn" aria-label="Voltar">
          <ArrowLeft size={20} aria-hidden="true" />
        </Link>
      )}
      <h1>{title}</h1>
      {action && <div className="page-header__action">{action}</div>}
    </header>
  );
}
