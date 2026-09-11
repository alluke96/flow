"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useProfiles } from "@/context/profile-context";

/**
 * Garante que exista um perfil ativo antes de renderizar a tela protegida
 * (catálogo, detalhe, player). Sem perfil ativo, manda de volta pra seleção
 * de perfis. Perfis são só locais — isto não é uma fronteira de segurança
 * real, é navegação de UX.
 */
export function RequireProfile({ children }: { children: ReactNode }) {
  const { ready, activeProfile } = useProfiles();
  const router = useRouter();

  useEffect(() => {
    if (ready && !activeProfile) router.replace("/");
  }, [ready, activeProfile, router]);

  if (!ready || !activeProfile) {
    return (
      <div className="center-loader" style={{ position: "fixed", inset: 0 }}>
        <div className="spinner" />
      </div>
    );
  }

  return <>{children}</>;
}
