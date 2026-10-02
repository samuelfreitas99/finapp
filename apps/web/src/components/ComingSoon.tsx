import type { LucideIcon } from 'lucide-react';

/** Tela ainda não construída (mostra em que fase do roadmap ela entra). */
export function ComingSoon({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <section className="card empty">
      <Icon size={40} strokeWidth={1.5} aria-hidden="true" />
      <h2>{title}</h2>
      <p className="muted">{text}</p>
    </section>
  );
}
