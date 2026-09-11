"use client";

import { useState, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import { useProfiles } from "@/context/profile-context";
import { avatarSrc } from "@/lib/avatars";
import { refreshCatalog } from "@/lib/api-client";
import { ProfileModal } from "./ProfileModal";
import type { Profile } from "@/types/profile";

function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

type RefreshState = "idle" | "loading" | "done" | "error";

export function ProfileScreen() {
  const { ready, profiles, canAddProfile, selectProfile, addProfile, updateProfile, deleteProfile } =
    useProfiles();
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const router = useRouter();

  function enter(id: string) {
    selectProfile(id);
    router.push("/browse");
  }

  function handleAvatarClick(p: Profile) {
    if (managing) setEditing(p);
    else enter(p.id);
  }

  // Refresh forçado do catálogo (bypassa o cache de ~5min do Drive — ver
  // POST /api/catalog): pensado pra rodar aqui, antes de entrar num perfil,
  // então quando você chegar no /browse o catálogo já está na hora.
  async function handleRefresh() {
    if (refreshState === "loading") return;
    setRefreshState("loading");
    try {
      await refreshCatalog();
      setRefreshState("done");
      setTimeout(() => setRefreshState("idle"), 1200);
    } catch {
      setRefreshState("error");
      setTimeout(() => setRefreshState("idle"), 2200);
    }
  }

  const refreshTitle = {
    idle: "Atualizar catálogo",
    loading: "Atualizando catálogo…",
    done: "Catálogo atualizado!",
    error: "Falha ao atualizar — tentar de novo",
  }[refreshState];

  if (!ready) {
    return (
      <div className="profiles-screen">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="profiles-screen">
      <button
        className={`profiles-refresh-btn ${refreshState}`}
        onClick={handleRefresh}
        disabled={refreshState === "loading"}
        aria-label={refreshTitle}
        title={refreshTitle}
      >
        <RefreshIcon />
      </button>
      <div className="profiles-wrap">
        <h1 className="profiles-title">{managing ? "Gerenciar perfis" : "Quem está assistindo?"}</h1>
        <div className="profiles-grid">
          {profiles.map((p) => (
            <div className={`profile-card${managing ? " managing" : ""}`} key={p.id}>
              <button className="profile-avatar-btn" onClick={() => handleAvatarClick(p)}>
                <span className="profile-avatar-wrap">
                  <img src={avatarSrc(p.avatarId)} alt="" />
                  {managing && <span className="profile-edit-badge">Editar</span>}
                </span>
              </button>
              <div className="profile-name">{p.nome}</div>
            </div>
          ))}
          {canAddProfile && (
            <div className="profile-card add">
              <button
                className="profile-avatar-btn"
                onClick={() => setCreating(true)}
                aria-label="Adicionar perfil"
              >
                +
              </button>
              <div className="profile-name">Adicionar</div>
            </div>
          )}
        </div>
        {profiles.length > 0 && (
          <button className="profiles-manage-btn" onClick={() => setManaging((m) => !m)}>
            {managing ? "Concluído" : "Gerenciar perfis"}
          </button>
        )}
        <p className="profiles-note">Os perfis ficam salvos apenas neste navegador.</p>
      </div>

      {creating && (
        <ProfileModal
          mode="create"
          onCancel={() => setCreating(false)}
          onSave={(nome, avatarId) => {
            addProfile(nome, avatarId);
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <ProfileModal
          mode="edit"
          initialName={editing.nome}
          initialAvatarId={editing.avatarId}
          onCancel={() => setEditing(null)}
          onSave={(nome, avatarId) => {
            updateProfile(editing.id, nome, avatarId);
            setEditing(null);
          }}
          onDelete={() => {
            deleteProfile(editing.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
