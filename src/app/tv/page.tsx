"use client";

import { NavEstadoProvider, useNav } from "@/lib/nav";
import { ProfileScreen } from "@/components/ProfileScreen";
import { BrowseScreen } from "@/components/screens/BrowseScreen";
import { TitleScreen } from "@/components/screens/TitleScreen";
import { WatchScreen } from "@/components/screens/WatchScreen";

/**
 * O app INTEIRO numa página só — é esta a versão que vai empacotada dentro
 * do `.wgt` do app de TV (ver scripts/build-tizen.mjs, que copia este
 * arquivo por cima de src/app/page.tsx no build de export).
 *
 * Por que uma página só: dentro do widget o app roda a partir de `file://`,
 * onde não existe roteamento por URL — um `/browse` viraria `file:///browse`
 * e quebraria tudo. Aqui a tela atual é estado React (ver NavEstadoProvider),
 * e as telas em si são exatamente as mesmas da web (src/components/screens),
 * sem nenhuma cópia paralela pra manter em sincronia.
 *
 * Também dá pra abrir em /tv num navegador normal pra conferir este modo
 * sem precisar instalar nada na TV.
 */
export default function TvApp() {
  return (
    <NavEstadoProvider>
      <TelaAtual />
    </NavEstadoProvider>
  );
}

function TelaAtual() {
  const { telaAtual } = useNav();
  const tela = telaAtual ?? { nome: "perfis" as const };

  switch (tela.nome) {
    case "perfis":
      return <ProfileScreen />;
    case "browse":
      return <BrowseScreen />;
    case "titulo":
      return <TitleScreen id={tela.id} />;
    case "player":
      // key por episódio: trocar de episódio (avançar pro próximo) precisa
      // remontar o player do zero, igual acontece na web quando a rota
      // muda — senão o <video>/AVPlay continuaria com a mídia anterior.
      return <WatchScreen key={`${tela.id}:${tela.ep ?? "filme"}`} id={tela.id} ep={tela.ep} />;
  }
}
