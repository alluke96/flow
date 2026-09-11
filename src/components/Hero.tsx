"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TitleSummary } from "@/types/catalog";
import { bannerUrl } from "@/lib/api-client";
import { metaLine } from "@/lib/format";
import { useProfiles } from "@/context/profile-context";

const ROTATE_MS = 10000;
// Tem que bater com a duração da animação de .hero-bg-current no CSS —
// depois desse tempo a camada de baixo (imagem anterior) some, porque a
// de cima já terminou de entrar e está cobrindo ela por completo.
const FADE_MS = 900;

export function Hero({ titles }: { titles: TitleSummary[] }) {
  const router = useRouter();
  const { getProgress } = useProfiles();
  const [index, setIndex] = useState(0);
  // Guarda o id do título pra que o aviso "ainda não disponível" apareça só
  // pra ele — troca de slide já limpa o aviso sem precisar de um efeito.
  const [unavailableId, setUnavailableId] = useState<string | null>(null);

  // Garante um índice válido se a lista encolher (ex: busca alterando o catálogo).
  const title = titles[index] ?? titles[0];
  const hasProgress = Boolean(title && getProgress(title.id));
  const unavailable = title?.id === unavailableId;

  // Crossfade entre banners: mantém o título anterior visível (parado) numa
  // camada por baixo enquanto o novo entra com fade-in por cima; depois que
  // a animação termina, solta a camada de baixo.
  const [prevTitle, setPrevTitle] = useState<TitleSummary | null>(null);
  const lastTitleRef = useRef(title);

  useEffect(() => {
    if (lastTitleRef.current.id === title.id) return;
    setPrevTitle(lastTitleRef.current);
    lastTitleRef.current = title;
    const t = setTimeout(() => setPrevTitle(null), FADE_MS);
    return () => clearTimeout(t);
  }, [title]);

  // Avança automaticamente pelos títulos disponíveis, sem controle manual.
  useEffect(() => {
    if (titles.length < 2) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % titles.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [titles.length]);

  if (!title) return null;

  function handlePlay() {
    if (title.disponivel === false) {
      setUnavailableId(title.id);
      return;
    }
    router.push(`/watch/${title.id}`);
  }

  return (
    <div className="hero">
      {prevTitle && (
        <div
          className="hero-bg"
          style={{ backgroundImage: `url('${bannerUrl(prevTitle.id)}')` }}
        />
      )}
      <div
        key={title.id}
        className="hero-bg hero-bg-current"
        style={{ backgroundImage: `url('${bannerUrl(title.id)}')` }}
      />
      <div className="hero-fade" />
      <div key={`${title.id}-content`} className="hero-content">
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
