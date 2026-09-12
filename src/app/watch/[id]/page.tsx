"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { RequireProfile } from "@/components/RequireProfile";
import { VideoPlayer } from "@/components/VideoPlayer";
import { useProfiles } from "@/context/profile-context";
import { fetchTitle } from "@/lib/api-client";
import type { EpisodeSummary, TitleDetail } from "@/types/catalog";

export default function WatchPage() {
  return (
    <RequireProfile>
      <Suspense fallback={<PlayerLoading />}>
        <WatchInner />
      </Suspense>
    </RequireProfile>
  );
}

function PlayerLoading() {
  return (
    <div className="player-shell">
      <div className="center-loader">
        <div className="spinner" />
      </div>
    </div>
  );
}

function WatchInner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const searchParams = useSearchParams();
  const router = useRouter();
  const { getProgress } = useProfiles();

  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetchTitle(id)
      .then((data) => {
        if (!active) return;
        if (!data) {
          setError(true);
          return;
        }
        setTitle(data);
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  // Prefetch da rota de saída enquanto o vídeo toca. Sem isso, o "voltar" só
  // COMEÇA a buscar a página de detalhe no momento do clique — e como ela é
  // dinâmica (renderizada no servidor), essa ida e volta acontece inteira
  // com o usuário ainda olhando pro player, que era boa parte do "o voltar
  // demora uma eternidade". Com o payload já em cache, a troca é imediata.
  useEffect(() => {
    router.prefetch(`/title/${id}`);
  }, [id, router]);

  if (loading) return <PlayerLoading />;

  if (error || !title) {
    return (
      <div
        className="player-shell"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}
      >
        <p>Não foi possível carregar este título.</p>
        <button className="btn btn-primary" onClick={() => router.push("/browse")}>
          Voltar
        </button>
      </div>
    );
  }

  const allEpisodes: (EpisodeSummary & { seasonNumero: number })[] =
    title.temporadas?.flatMap((s) => s.episodios.map((e) => ({ ...e, seasonNumero: s.numero }))) ?? [];

  let episodeId = searchParams.get("ep");
  let episode: (EpisodeSummary & { seasonNumero: number }) | undefined;

  if (title.tipo === "serie") {
    if (episodeId) {
      // Um episódio específico foi pedido na URL (ex: veio do avanço
      // automático pro próximo, ou de um link direto) — confia nele. Cair
      // pro fallback de "continuar assistindo"/primeiro episódio aqui seria
      // errado: bastava esse id não resolver por um instante (ex: um
      // re-render no meio da navegação) pra saltar de volta pro episódio 1
      // da temporada 1 sem nenhum aviso, mesmo estando no meio de outro
      // episódio qualquer.
      episode = allEpisodes.find((e) => e.id === episodeId);
    } else {
      // Nenhum episódio pedido (ex: clicou em "Assistir" na tela do
      // título) — aí sim faz sentido continuar de onde parou, ou começar
      // do primeiro se nunca assistiu nada dessa série.
      const progress = getProgress(title.id);
      episode = allEpisodes.find((e) => e.id === progress?.episodioId) ?? allEpisodes[0];
      episodeId = episode?.id ?? null;
    }
    if (!episode) {
      return (
        <div className="player-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p>
            {searchParams.get("ep")
              ? "Episódio não encontrado."
              : "Esta série ainda não tem episódios."}
          </p>
        </div>
      );
    }
  } else {
    episodeId = null;
  }

  const progress = getProgress(title.id);
  const initialTime = progress && progress.episodioId === episodeId ? progress.progressoSegundos : 0;
  const displayTitle = episode
    ? `${title.titulo} — T${episode.seasonNumero}:E${episode.numero} — ${episode.titulo}`
    : title.titulo;

  let nextEpisode: (EpisodeSummary & { seasonNumero: number }) | undefined;
  if (episode) {
    const idx = allEpisodes.findIndex((e) => e.id === episode!.id);
    nextEpisode = idx >= 0 ? allEpisodes[idx + 1] : undefined;
  }

  return (
    <VideoPlayer
      key={`${title.id}:${episodeId ?? "movie"}`}
      titleId={title.id}
      episodeId={episodeId}
      displayTitle={displayTitle}
      initialTime={initialTime}
      onExit={() => router.push(`/title/${title.id}`)}
      onNextEpisode={
        nextEpisode ? () => router.replace(`/watch/${title.id}?ep=${encodeURIComponent(nextEpisode!.id)}`) : undefined
      }
    />
  );
}
