"use client";

import { useEffect, useRef, useState } from "react";
import { useNav } from "@/lib/nav";
import { RequireProfile } from "@/components/RequireProfile";
import { VideoPlayer } from "@/components/VideoPlayer";
import { useProfiles } from "@/context/profile-context";
import { fetchTitle } from "@/lib/api-client";
import type { EpisodeSummary, TitleDetail } from "@/types/catalog";

export function WatchScreen({ id, ep }: { id: string; ep?: string | null }) {
  return (
    <RequireProfile>
      <WatchInner id={id} epFromUrl={ep ?? null} />
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

type EpisodeWithSeason = EpisodeSummary & { seasonNumero: number };

function flattenEpisodes(title: TitleDetail): EpisodeWithSeason[] {
  return title.temporadas?.flatMap((s) => s.episodios.map((e) => ({ ...e, seasonNumero: s.numero }))) ?? [];
}

interface Resolved {
  episodeId: string | null;
  initialTime: number;
  /**
   * Duração do que foi salvo, quando se sabe. Só serve pro app de TV: lá o
   * vídeo pode vir já cortado no ponto de retomada (ver src/lib/remux.ts) e
   * esse stream não carrega duração nenhuma — é daqui que a barra de
   * progresso tira o total até o player descobrir sozinho.
   */
  duracaoConhecida?: number;
}

function WatchInner({ id, epFromUrl }: { id: string; epFromUrl: string | null }) {
  const { ir, prefetch } = useNav();
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
    prefetch({ nome: "titulo", id });
  }, [id, prefetch]);

  // getProgress muda de identidade toda vez que QUALQUER coisa no contexto
  // de perfis muda — inclusive o próprio VideoPlayer salvando progresso a
  // cada 5s ENQUANTO o vídeo está tocando (ver o intervalo em
  // VideoPlayer). Uma ref sempre aponta pra versão atual sem nunca entrar
  // como dependência de nada abaixo — é o que faz a resolução do episódio
  // (ver efeito logo adiante) só rodar quando de fato deveria, nunca só
  // porque um save de progresso aconteceu no meio da própria reprodução.
  const getProgressRef = useRef(getProgress);
  useEffect(() => {
    getProgressRef.current = getProgress;
  }, [getProgress]);

  /**
   * Qual episódio tocar e de onde, resolvido UMA VEZ — não a cada render.
   *
   * Antes isso era calculado direto no corpo do componente, lendo
   * getProgress() toda vez que WatchInner renderizava. Parecia inofensivo,
   * mas o VideoPlayer salva progresso a cada 5s ENQUANTO o vídeo está
   * tocando, e cada salvamento muda o contexto de perfis — o que
   * re-renderiza este componente. Nesse re-render, o cálculo rodava de
   * novo: se a amostra de progresso daquele instante fosse "perto do
   * início" (ex: por alguma instabilidade logo depois do seek de retomada
   * — mais fácil de acontecer numa rede mais lenta, como a de uma TV),
   * `saveProgress` (profile-context.tsx) descarta a entrada de "continuar
   * assistindo" inteira. No PRÓXIMO recálculo, sem progresso nenhum pra
   * achar, o fallback escolhia allEpisodes[0] (T1E1). Como esse valor vira
   * a `key` do VideoPlayer, trocar de episódio NO MEIO da reprodução
   * derrubava o player em andamento e remontava um novo do zero — o
   * "começa de onde parei, mas alguns segundos depois volta pro T1E1
   * do zero" relatado.
   *
   * Resolvendo uma vez só (quando o título carrega, ou quando a URL pede
   * um episódio explícito de verdade — ex: avançar pro próximo, que troca
   * de tela com `substituir`) essa classe inteira de bug deixa de existir:
   * nada que
   * aconteça DEPOIS que o vídeo já começou a tocar pode mudar qual
   * episódio está em cena.
   */
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (!title) return;

    if (title.tipo !== "serie") {
      const progress = getProgressRef.current(title.id);
      setResolved({
        episodeId: null,
        initialTime: progress?.progressoSegundos ?? 0,
        duracaoConhecida: progress?.duracaoSegundos,
      });
      return;
    }

    const allEpisodes = flattenEpisodes(title);
    let epId = epFromUrl;
    if (!epId) {
      // Nenhum episódio pedido na URL (ex: clicou em "Assistir"/"Continuar
      // assistindo" na tela do título) — continua de onde parou, ou começa
      // do primeiro se nunca assistiu nada dessa série.
      const progress = getProgressRef.current(title.id);
      epId = (allEpisodes.find((e) => e.id === progress?.episodioId) ?? allEpisodes[0])?.id ?? null;
    }
    const progress = getProgressRef.current(title.id);
    const doEpisodio = progress && progress.episodioId === epId ? progress : null;
    setResolved({
      episodeId: epId,
      initialTime: doEpisodio?.progressoSegundos ?? 0,
      duracaoConhecida: doEpisodio?.duracaoSegundos,
    });
    // getProgress vem por ref de propósito (ver comentário acima) — é por
    // isso que não entra aqui: refs não recriam o efeito ao mudar.
  }, [title, epFromUrl]);

  if (loading) return <PlayerLoading />;

  if (error || !title) {
    return (
      <div
        className="player-shell"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}
      >
        <p>Não foi possível carregar este título.</p>
        <button className="btn btn-primary" onClick={() => ir({ nome: "browse" })}>
          Voltar
        </button>
      </div>
    );
  }

  // Título já carregou, mas o efeito acima ainda não rodou nesta rodada de
  // render (roda logo após o commit) — mais um frame de loading, igual ao
  // que já acontecia esperando o fetch do título.
  if (!resolved) return <PlayerLoading />;

  const allEpisodes = flattenEpisodes(title);
  const episode = resolved.episodeId ? allEpisodes.find((e) => e.id === resolved.episodeId) : undefined;

  if (title.tipo === "serie" && !episode) {
    return (
      <div className="player-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p>{epFromUrl ? "Episódio não encontrado." : "Esta série ainda não tem episódios."}</p>
      </div>
    );
  }

  const displayTitle = episode
    ? `${title.titulo} — T${episode.seasonNumero}:E${episode.numero} — ${episode.titulo}`
    : title.titulo;

  let nextEpisode: EpisodeWithSeason | undefined;
  if (episode) {
    const idx = allEpisodes.findIndex((e) => e.id === episode.id);
    nextEpisode = idx >= 0 ? allEpisodes[idx + 1] : undefined;
  }

  return (
    <VideoPlayer
      key={`${title.id}:${resolved.episodeId ?? "movie"}`}
      titleId={title.id}
      episodeId={resolved.episodeId}
      displayTitle={displayTitle}
      initialTime={resolved.initialTime}
      duracaoConhecida={resolved.duracaoConhecida}
      onExit={() => ir({ nome: "titulo", id: title.id })}
      onNextEpisode={
        nextEpisode
          ? () => ir({ nome: "player", id: title.id, ep: nextEpisode!.id }, { substituir: true })
          : undefined
      }
    />
  );
}
