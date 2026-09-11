"use client";

import { useEffect, useMemo, useState } from "react";
import { RequireProfile } from "@/components/RequireProfile";
import { TopNav } from "@/components/TopNav";
import { Hero } from "@/components/Hero";
import { Row } from "@/components/Row";
import { useProfiles } from "@/context/profile-context";
import { fetchCatalog } from "@/lib/api-client";
import { matchesSearch } from "@/lib/search";
import type { TitleSummary } from "@/types/catalog";

export default function BrowsePage() {
  return (
    <RequireProfile>
      <BrowseInner />
    </RequireProfile>
  );
}

function BrowseInner() {
  const { activeProfile } = useProfiles();
  const [titles, setTitles] = useState<TitleSummary[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    fetchCatalog()
      .then((data) => {
        if (active) setTitles(data.titulos);
      })
      .catch(() => active && setTitles([]));
    return () => {
      active = false;
    };
  }, []);

  const byId = useMemo(() => new Map((titles ?? []).map((t) => [t.id, t])), [titles]);

  const continuando = useMemo(() => {
    if (!activeProfile) return [];
    return activeProfile.continuarAssistindo
      .map((c) => byId.get(c.tituloId))
      .filter((t): t is TitleSummary => Boolean(t));
  }, [activeProfile, byId]);

  const progressMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!activeProfile) return map;
    for (const c of activeProfile.continuarAssistindo) {
      const t = byId.get(c.tituloId);
      if (t?.duracaoMinutos) {
        map[c.tituloId] = (c.progressoSegundos / (t.duracaoMinutos * 60)) * 100;
      }
    }
    return map;
  }, [activeProfile, byId]);

  const minhaLista = useMemo(() => {
    if (!activeProfile) return [];
    return activeProfile.listaAssistirMaisTarde
      .map((id) => byId.get(id))
      .filter((t): t is TitleSummary => Boolean(t));
  }, [activeProfile, byId]);

  const filmes = useMemo(() => (titles ?? []).filter((t) => t.tipo === "filme"), [titles]);
  const series = useMemo(() => (titles ?? []).filter((t) => t.tipo === "serie"), [titles]);

  if (!titles) {
    return (
      <div className="center-loader" style={{ position: "fixed", inset: 0 }}>
        <div className="spinner" />
      </div>
    );
  }

  const q = search.trim();
  const filterList = (list: TitleSummary[]) =>
    q ? list.filter((t) => matchesSearch(t.titulo, q)) : list;

  const hero = titles[0];
  const rows = [
    { title: "Continuar assistindo", items: filterList(continuando) },
    { title: "Minha lista", items: filterList(minhaLista) },
    { title: "Séries", items: filterList(series) },
    { title: "Filmes", items: filterList(filmes) },
  ];
  const anyResults = rows.some((r) => r.items.length > 0);

  return (
    <div>
      <TopNav search={search} onSearchChange={setSearch} />
      {!q && hero && <Hero title={hero} />}
      <div className="rows">
        {q && !anyResults ? (
          <p className="search-empty">Nenhum título encontrado para &ldquo;{search}&rdquo;.</p>
        ) : (
          rows.map((r) => (
            <Row
              key={r.title}
              title={r.title}
              items={r.items}
              progressMap={r.title === "Continuar assistindo" ? progressMap : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
