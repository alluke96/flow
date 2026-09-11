"use client";

import { useEffect, useState } from "react";
import { AVATAR_IDS, avatarSrc, DEFAULT_AVATAR_ID } from "@/lib/avatars";

interface ProfileModalProps {
  mode: "create" | "edit";
  initialName?: string;
  initialAvatarId?: string;
  onCancel: () => void;
  onSave: (nome: string, avatarId: string) => void;
  onDelete?: () => void;
}

export function ProfileModal({
  mode,
  initialName = "",
  initialAvatarId,
  onCancel,
  onSave,
  onDelete,
}: ProfileModalProps) {
  const [name, setName] = useState(initialName);
  const [avatarId, setAvatarId] = useState(initialAvatarId ?? DEFAULT_AVATAR_ID);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function handleSave() {
    const trimmed = name.replace(/[<>]/g, "").trim();
    if (!trimmed) {
      setError("Digite um nome para o perfil.");
      return;
    }
    onSave(trimmed, avatarId);
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-heading">
        <h2 id="modal-heading">{mode === "create" ? "Novo perfil" : "Editar perfil"}</h2>
        <input
          type="text"
          maxLength={20}
          placeholder="Nome do perfil"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          autoFocus
        />
        {error && <p className="form-error">{error}</p>}
        <span className="avatar-label">Escolha um avatar</span>
        <div className="avatar-grid">
          {AVATAR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`avatar-choice${id === avatarId ? " selected" : ""}`}
              onClick={() => setAvatarId(id)}
              aria-label={`Escolher avatar ${id}`}
              aria-pressed={id === avatarId}
            >
              <img src={avatarSrc(id)} alt="" />
            </button>
          ))}
        </div>
        <div className="modal-actions">
          {mode === "edit" && onDelete && (
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              Excluir
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
