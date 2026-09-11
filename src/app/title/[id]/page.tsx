"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { RequireProfile } from "@/components/RequireProfile";
import { useProfiles } from "@/context/profile-context";
import { fetchTitle, bannerUrl } from "@/lib/api-client";
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
  const { isInWatchlist, toggleWatchlist } = useProfiles();
  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [seasonIdx, setSeasonIdx] = useState(0);

  useEffect(() => {
    let active = true;
    // reseta o estado de carregamento a cada troca de `id` (navegação entre títulos)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setNotFound(false);
    fetchTitle(id)
      .then((data) => {
        if (!active) return;
        if (!data) {
          setNotFound(true);
          return;
        }
        setTitle(data);
        setSeasonIdx(0);
      })
      .catch(() => active && setNotFound(true))
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
          <button className="btn-hero play" onClick={() => router.push(`/watch/${title.id}`)}>
            ▶ Assistir
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

        {title.tipo === "serie" && title.temporadas && title.temporadas.length > 0 && (
          <>
            <div className="season-picker">
              {title.temporadas.map((s, i) => (
                <button
                  key={s.numero}
                  className={`season-chip${i === seasonIdx ? " active" : ""}`}
                  onClick={() => setSeasonIdx(i)}
                >
                  Temporada {s.numero}
                </button>
              ))}
            </div>
            <div>
              {season?.episodios.map((ep, i) => (
                <button
                  key={ep.id}
                  className="episode"
                  onClick={() => router.push(`/watch/${title.id}?ep=${encodeURIComponent(ep.id)}`)}
                >
                  <div className="ep-num">{i + 1}</div>
                  <div className="ep-thumb">
                    <img src={bannerUrl(title.id)} alt="" loading="lazy" />
                  </div>
                  <div className="ep-info">
                    <div className="ep-title">{ep.titulo}</div>
                    <div className="ep-dur">{ep.duracaoMinutos ? `${ep.duracaoMinutos}min` : ""}</div>
                  </div>
                  <div className="ep-play">▶</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
