"use client";

import { useEffect, type ReactNode } from "react";
import { useNav } from "@/lib/nav";
import { useProfiles } from "@/context/profile-context";

/**
 * Garante que exista um perfil ativo antes de renderizar a tela protegida
 * (catálogo, detalhe, player). Sem perfil ativo, manda de volta pra seleção
 * de perfis. Perfis são só locais — isto não é uma fronteira de segurança
 * real, é navegação de UX.
 */
export function RequireProfile({ children }: { children: ReactNode }) {
  const { ready, activeProfile } = useProfiles();
  const { ir } = useNav();

  useEffect(() => {
    if (ready && !activeProfile) ir({ nome: "perfis" }, { substituir: true });
  }, [ready, activeProfile, ir]);

  if (!ready || !activeProfile) {
    return (
      <div className="center-loader tela-cheia">
        <div className="spinner" />
      </div>
    );
  }

  return <>{children}</>;
}
