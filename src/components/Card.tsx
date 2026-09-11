import Link from "next/link";
import type { TitleSummary } from "@/types/catalog";
import { posterUrl } from "@/lib/api-client";

interface CardProps {
  title: TitleSummary;
  progressPct?: number;
  /** Fileira "Continuar assistindo": clicar vai direto pro player, já na
   * posição salva — em vez de passar pela tela de detalhe primeiro. */
  resume?: boolean;
}

export function Card({ title, progressPct, resume }: CardProps) {
  const href = resume ? `/watch/${title.id}` : `/title/${title.id}`;
  return (
    <Link href={href} className="card">
      <div className="card-poster">
        <img src={posterUrl(title.id)} alt={title.titulo} loading="lazy" />
        {typeof progressPct === "number" && (
          <div className="card-progress">
            <div
              className="card-progress-fill"
              style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
            />
          </div>
        )}
        {resume && (
          <div className="card-resume-badge" aria-hidden="true">
            ▶
          </div>
        )}
      </div>
      <div className="card-name">{title.titulo}</div>
    </Link>
  );
}
