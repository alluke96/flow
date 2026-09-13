"use client";

import { useEffect, useRef, useState } from "react";
import { useNav } from "@/lib/nav";
import { useProfiles } from "@/context/profile-context";
import { avatarSrc } from "@/lib/avatars";
import { NO_APP_DE_TV } from "@/lib/tv";

interface TopNavProps {
  search: string;
  onSearchChange: (value: string) => void;
}

export function TopNav({ search, onSearchChange }: TopNavProps) {
  const { activeProfile, exitProfile } = useProfiles();
  const { ir, href } = useNav();
  const [solid, setSolid] = useState(false);
  // Na TV o campo de busca só vira campo DEPOIS de escolhido (ver o JSX).
  const [buscando, setBuscando] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);

  // Header fica transparente sobre o banner até rolar um pouco a página —
  // depois disso fica sólido pra continuar legível por cima das fileiras.
  useEffect(() => {
    function onScroll() {
      setSolid(window.scrollY > 10);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function switchProfile() {
    exitProfile();
    ir({ nome: "perfis" });
  }

  return (
    <nav className={`topnav${solid ? " solid" : ""}`}>
      <a
        href={href({ nome: "browse" })}
        className="brand"
        onClick={(e) => {
          e.preventDefault();
          ir({ nome: "browse" });
        }}
      >
        flow
      </a>
      <div className="nav-right">
        {/* Na TV, o campo de busca começa como BOTÃO.
            O teclado da tela aparece quando um campo de texto ganha foco —
            e num controle remoto o foco passa por cima das coisas só de
            navegar até o lado. O resultado era o teclado abrindo sozinho no
            caminho pra outra coisa. Como botão, ele só vira campo quando o
            usuário escolhe (OK), e volta a ser botão quando o foco sai.
            No navegador nada disso existe: lá o campo é campo. */}
        {NO_APP_DE_TV && !buscando ? (
          <button
            className="search-input search-botao"
            onClick={() => setBuscando(true)}
            aria-label="Buscar títulos"
          >
            {search || "Buscar títulos"}
          </button>
        ) : (
          <input
            ref={buscaRef}
            className="search-input"
            placeholder="Buscar títulos"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onBlur={() => setBuscando(false)}
            // Só na TV: o campo acabou de substituir o botão, e é este foco
            // — um foco novo, não um foco de passagem — que abre o teclado.
            autoFocus={NO_APP_DE_TV}
            aria-label="Buscar títulos"
          />
        )}
        <button className="nav-avatar" onClick={switchProfile} aria-label="Trocar de perfil">
          {activeProfile && <img src={avatarSrc(activeProfile.avatarId)} alt="" />}
        </button>
      </div>
    </nav>
  );
}
