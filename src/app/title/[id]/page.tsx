"use client";

import { useParams } from "next/navigation";
import { TitleScreen } from "@/components/screens/TitleScreen";

/** Rota web do detalhe do título: só traduz o parâmetro da URL em prop. A
 * tela em si é compartilhada com o app de TV, que não usa rotas (ver
 * src/lib/nav.tsx). */
export default function TitlePage() {
  const params = useParams<{ id: string }>();
  return <TitleScreen id={params.id} />;
}
