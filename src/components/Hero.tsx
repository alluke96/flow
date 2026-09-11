"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TitleSummary } from "@/types/catalog";
import { bannerUrl } from "@/lib/api-client";
import { metaLine } from "@/lib/format";

export function Hero({ title }: { title: TitleSummary }) {
  const router = useRouter();

  return (
    <div className="hero">
      <div className="hero-bg" style={{ backgroundImage: `url('${bannerUrl(title.id)}')` }} />
      <div className="hero-fade" />
      <div className="hero-content">
        <h1 className="hero-title">{title.titulo}</h1>
        <div className="hero-meta">{metaLine(title)}</div>
        <p className="hero-desc">{title.sinopse}</p>
        <div className="hero-actions">
          <button className="btn-hero play" onClick={() => router.push(`/watch/${title.id}`)}>
            ▶ Assistir
          </button>
          <Link href={`/title/${title.id}`} className="btn-hero info">
            ⓘ Detalhes
          </Link>
        </div>
      </div>
    </div>
  );
}
