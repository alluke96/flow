"use client";

import { BrowseScreen } from "@/components/screens/BrowseScreen";

/** Rota web do catálogo. A tela em si (ver BrowseScreen) é compartilhada
 * com o app de TV, que não usa rotas — ver src/lib/nav.tsx. */
export default function BrowsePage() {
  return <BrowseScreen />;
}
