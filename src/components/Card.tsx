"use client";

import { useNav, type Tela } from "@/lib/nav";
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
  const { ir, href } = useNav();
  // <a> com href + onClick, em vez de <Link>: no app de TV não existe
  // roteamento por URL nenhum (ver src/lib/nav.tsx), então quem decide o
  // destino é sempre o ir(). Na web o href continua real, só pra o link
  // parecer/copiar-se como link de verdade.
  const destino: Tela = resume
    ? { nome: "player", id: title.id }
    : { nome: "titulo", id: title.id };
  return (
    <a
      href={href(destino)}
      className="card"
      onClick={(e) => {
        e.preventDefault();
        ir(destino);
      }}
    >
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
    </a>
  );
}
