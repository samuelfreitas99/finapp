import { Download, FileJson, FileSpreadsheet, FileText, type LucideIcon } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { spacePath } from '../../lib/api';
import { useSpaceId } from '../../lib/queries';

const FORMATS: { format: string; label: string; text: string; icon: LucideIcon }[] = [
  {
    format: 'xlsx',
    label: 'Planilha (XLSX)',
    text: 'Lançamentos e contas, para abrir no Excel ou Google Planilhas.',
    icon: FileSpreadsheet,
  },
  {
    format: 'csv',
    label: 'CSV',
    text: 'Todos os lançamentos, valores com sinal (saídas negativas).',
    icon: FileText,
  },
  {
    format: 'json',
    label: 'Cópia completa (JSON)',
    text: 'Contas, categorias, cartões, lançamentos, dívidas, orçamentos e metas, com valores em centavos.',
    icon: FileJson,
  },
];

/** Exportar os dados do espaço. */
export function ExportPage() {
  const spaceId = useSpaceId();
  return (
    <>
      <PageHeader title="Exportar dados" back="/mais" />
      <p className="muted">
        Baixe o que está registrado neste espaço. Os arquivos ficam só com você: não saem do app
        para nenhum serviço.
      </p>
      <ul className="list card">
        {FORMATS.map(({ format, label, text, icon: Icon }) => (
          <li key={format}>
            <a className="row-link" href={spacePath(spaceId, `/export?format=${format}`)} download>
              <Icon size={22} aria-hidden="true" />
              <span className="row-link__main">
                <strong>{label}</strong>
                <span className="muted">{text}</span>
              </span>
              <Download size={18} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
