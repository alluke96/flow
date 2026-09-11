"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { RequireProfile } from "@/components/RequireProfile";
import { useProfiles } from "@/context/profile-context";
import { fetchTitle, getCachedTitle, bannerUrl, seasonImageUrl } from "@/lib/api-client";
import { metaLine } from "@/lib/format";
import type { TitleDetail } from "@/types/catalog";

export default function TitlePage() {
  return (
    <RequireProfile>
      <TitleDetailInner />
    </RequireProfile>
  );
}

function TitleDetailInner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { isInWatchlist, toggleWatchlist, getProgress } = useProfiles();
  // Se o título já foi visto nesta sessão (ex: voltando do player), mostra
  // na hora em vez de piscar uma tela de loading pra buscar algo que já
  // temos — a busca ainda roda em segundo plano pra manter atualizado.
  const [title, setTitle] = useState<TitleDetail | null>(() => getCachedTitle(id) ?? null);
  const [loading, setLoading] = useState(() => !getCachedTitle(id));
  const [notFound, setNotFound] = useState(false);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    const cached = getCachedTitle(id);
    // reseta estado dependente de `id` — se já está em cache, mostra na
    // hora (sem piscar loading); senão pisca loading normalmente enquanto
    // busca. Ambos os casos exigem sincronizar vários estados de uma vez.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeasonIdx(0);
    if (cached) {
      setTitle(cached);
      setNotFound(false);
      setLoading(false);
    } else {
      setLoading(true);
      setNotFound(false);
    }
    fetchTitle(id)
      .then((data) => {
        if (!active) return;
        if (!data) {
          setNotFound(true);
          return;
        }
        setTitle(data);
      })
      .catch(() => {
        if (active && !cached) setNotFound(true);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="center-loader" style={{ position: "fixed", inset: 0 }}>
        <div className="spinner" />
      </div>
    );
  }

  if (notFound || !title) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <p>Título não encontrado.</p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => router.push("/browse")}>
          Voltar
        </button>
      </div>
    );
  }

  const inList = isInWatchlist(title.id);
  const season = title.temporadas?.[seasonIdx];
  const progress = getProgress(title.id);

  function handlePlay() {
    if (title!.disponivel === false) {
      setUnavailable(true);
      return;
    }
    router.push(`/watch/${title!.id}`);
  }

  function handleSelectSeason(i: number) {
    setSeasonIdx(i);
    setUnavailable(false);
  }

  return (
    <div>
      <div className="detail-banner">
        <button className="back-btn" onClick={() => router.push("/browse")} aria-label="Voltar">
          ←
        </button>
        <div className="detail-banner-bg" style={{ backgroundImage: `url('${bannerUrl(title.id)}')` }} />
        <div className="detail-banner-fade" />
      </div>
      <div className="detail-body">
        <h1 className="detail-title">{title.titulo}</h1>
        <div className="detail-meta">{metaLine(title)}</div>
        <p className="detail-desc">{title.sinopse}</p>
        {title.elenco && title.elenco.length > 0 && (
          <p className="detail-cast">Com {title.elenco.join(", ")}</p>
        )}
        <div className="detail-actions">
          <button className="btn-hero play" onClick={handlePlay}>
            ▶ {progress ? "Continuar assistindo" : "Assistir"}
          </button>
          <button
            className={`btn-icon${inList ? " active" : ""}`}
            onClick={() => toggleWatchlist(title.id)}
            title="Minha lista"
            aria-pressed={inList}
          >
            {inList ? "✓" : "+"}
          </button>
        </div>
        {unavailable && <p className="unavailable-notice">Ainda não disponível.</p>}

        {title.tipo === "serie" && title.temporadas && title.temporadas.length > 0 && (
          <>
            <div className="season-picker">
              {title.temporadas.map((s, i) => (
                <button
                  key={s.numero}
                  className={`season-chip${i === seasonIdx ? " active" : ""}`}
                  onClick={() => handleSelectSeason(i)}
                >
                  Temporada {s.numero}
                </button>
              ))}
            </div>
            {season && season.episodios.length === 0 ? (
              <p key={seasonIdx} className="unavailable-notice fade-in">
                Ainda não disponível.
              </p>
            ) : (
              <div key={seasonIdx} className="episode-list">
                {season?.episodios.map((ep, i) => (
                  <button
                    key={ep.id}
                    className="episode"
                    onClick={() => router.push(`/watch/${title.id}?ep=${encodeURIComponent(ep.id)}`)}
                  >
                    <div className="ep-num">{i + 1}</div>
                    <div className="ep-thumb">
                      <img
                        src={season ? seasonImageUrl(title.id, season.numero) : bannerUrl(title.id)}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          // temporada sem capa.jpg própria -> cai pro banner do título
                          // (guarda por dataset pra não entrar em loop se o banner também falhar)
                          const img = e.currentTarget;
                          if (img.dataset.fallback) return;
                          img.dataset.fallback = "1";
                          img.src = bannerUrl(title.id);
                        }}
                      />
                    </div>
                    <div className="ep-info">
                      <div className="ep-title">{ep.titulo}</div>
                      <div className="ep-dur">{ep.duracaoMinutos ? `${ep.duracaoMinutos}min` : ""}</div>
                    </div>
                    <div className="ep-play">▶</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
