"use client";

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

  function switchProfile() {
    exitProfile();
    router.push("/");
  }

  return (
    <nav className="topnav">
      <Link href="/browse" className="brand">
        Flow
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
