"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProfiles } from "@/context/profile-context";
import { avatarSrc } from "@/lib/avatars";
import { ProfileModal } from "./ProfileModal";
import type { Profile } from "@/types/profile";

export function ProfileScreen() {
  const { ready, profiles, canAddProfile, selectProfile, addProfile, updateProfile, deleteProfile } =
    useProfiles();
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  function enter(id: string) {
    selectProfile(id);
    router.push("/browse");
  }

  function handleAvatarClick(p: Profile) {
    if (managing) setEditing(p);
    else enter(p.id);
  }

  if (!ready) {
    return (
      <div className="profiles-screen">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="profiles-screen">
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
