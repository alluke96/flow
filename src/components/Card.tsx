import Link from "next/link";
import type { TitleSummary } from "@/types/catalog";
import { posterUrl } from "@/lib/api-client";

interface CardProps {
  title: TitleSummary;
  progressPct?: number;
}

export function Card({ title, progressPct }: CardProps) {
  return (
    <Link href={`/title/${title.id}`} className="card">
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
      </div>
      <div className="card-name">{title.titulo}</div>
    </Link>
  );
}
