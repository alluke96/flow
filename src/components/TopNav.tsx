"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProfiles } from "@/context/profile-context";
import { avatarSrc } from "@/lib/avatars";

interface TopNavProps {
  search: string;
  onSearchChange: (value: string) => void;
}

export function TopNav({ search, onSearchChange }: TopNavProps) {
  const { activeProfile, exitProfile } = useProfiles();
  const router = useRouter();
  const [solid, setSolid] = useState(false);

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
    router.push("/");
  }

  return (
    <nav className={`topnav${solid ? " solid" : ""}`}>
      <Link href="/browse" className="brand">
        flow
      </Link>
      <div className="nav-right">
        <input
          className="search-input"
          placeholder="Buscar títulos"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Buscar títulos"
        />
        <button className="nav-avatar" onClick={switchProfile} aria-label="Trocar de perfil">
          {activeProfile && <img src={avatarSrc(activeProfile.avatarId)} alt="" />}
        </button>
      </div>
    </nav>
  );
}
