"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TitleSummary } from "@/types/catalog";
import { bannerUrl } from "@/lib/api-client";
import { metaLine } from "@/lib/format";
import { useProfiles } from "@/context/profile-context";

export function Hero({ title }: { title: TitleSummary }) {
  const router = useRouter();
  const { getProgress } = useProfiles();
  const [unavailable, setUnavailable] = useState(false);
  const hasProgress = Boolean(getProgress(title.id));

  function handlePlay() {
    if (title.disponivel === false) {
      setUnavailable(true);
      return;
    }
    router.push(`/watch/${title.id}`);
  }

  return (
    <div className="hero">
      <div className="hero-bg" style={{ backgroundImage: `url('${bannerUrl(title.id)}')` }} />
      <div className="hero-fade" />
      <div className="hero-content">
        <h1 className="hero-title">{title.titulo}</h1>
        <div className="hero-meta">{metaLine(title)}</div>
        <p className="hero-desc">{title.sinopse}</p>
        <div className="hero-actions">
          <button className="btn-hero play" onClick={handlePlay}>
            ▶ {hasProgress ? "Continuar assistindo" : "Assistir"}
          </button>
          <Link href={`/title/${title.id}`} className="btn-hero info">
            ⓘ Detalhes
          </Link>
        </div>
        {unavailable && <p className="unavailable-notice">Ainda não disponível.</p>}
      </div>
    </div>
  );
}
