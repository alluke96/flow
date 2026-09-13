"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { WatchScreen } from "@/components/screens/WatchScreen";

/** Rota web do player: só traduz URL (id + ?ep=) em props. A tela em si é
 * compartilhada com o app de TV, que não usa rotas (ver src/lib/nav.tsx).
 * O Suspense é exigência do useSearchParams em página estática — fica aqui,
 * no único lugar que ainda lê a URL. */
export default function WatchPage() {
  return (
    <Suspense fallback={<PlayerLoading />}>
      <WatchRoute />
    </Suspense>
  );
}

function WatchRoute() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  return <WatchScreen id={params.id} ep={searchParams.get("ep")} />;
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
