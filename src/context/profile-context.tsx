"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Profile, ProfileStore, WatchProgress } from "@/types/profile";
import { MAX_PROFILES } from "@/types/profile";
import { DEFAULT_AVATAR_ID, isValidAvatarId } from "@/lib/avatars";
import { sanitizeProfileName } from "@/lib/validation";

/**
 * Camada de perfis locais (sem login) — persistida em localStorage no
 * formato descrito no spec do produto. Fica isolada atrás deste contexto de
 * propósito: se autenticação real (JWT/sessão + backend de usuários) for
 * adicionada no futuro, só a implementação de `loadStore`/`saveStore`
 * precisa trocar por chamadas de API — nenhuma tela consumidora muda.
 *
 * Perfis não são uma fronteira de segurança/privacidade real (não há
 * senha): é só uma conveniência de UX, como no spec.
 */

const STORAGE_KEY = "flow_profiles_v1";

function emptyStore(): ProfileStore {
  return { perfis: [], perfilAtivoId: null };
}

function loadStore(): ProfileStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<ProfileStore>;
    if (!Array.isArray(parsed.perfis)) return emptyStore();
    return {
      perfis: parsed.perfis,
      perfilAtivoId: parsed.perfilAtivoId ?? null,
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: ProfileStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage indisponível (aba privada, quota cheia...) — a sessão
    // atual continua funcionando em memória, só não persiste no reload.
  }
}

function uid(): string {
  return "p" + Math.random().toString(36).slice(2, 10);
}

interface ProfileContextValue {
  ready: boolean;
  profiles: Profile[];
  activeProfile: Profile | null;
  selectProfile: (id: string) => void;
  exitProfile: () => void;
  addProfile: (nome: string, avatarId: string) => boolean;
  updateProfile: (id: string, nome: string, avatarId: string) => boolean;
  deleteProfile: (id: string) => void;
  canAddProfile: boolean;
  toggleWatchlist: (tituloId: string) => void;
  isInWatchlist: (tituloId: string) => boolean;
  saveProgress: (
    tituloId: string,
    episodioId: string | null,
    progressoSegundos: number,
    duracaoSegundos: number
  ) => void;
  getProgress: (tituloId: string) => WatchProgress | undefined;
  clearProgress: (tituloId: string) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<ProfileStore>(emptyStore);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // localStorage só existe no cliente — lê aqui (pós-montagem) de
    // propósito, pra não divergir do HTML renderizado no servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStore(loadStore());
    setReady(true);
  }, []);

  const update = useCallback((updater: (s: ProfileStore) => ProfileStore) => {
    setStore((prev) => {
      const next = updater(prev);
      saveStore(next);
      return next;
    });
  }, []);

  const selectProfile = useCallback(
    (id: string) => {
      update((s) => (s.perfis.some((p) => p.id === id) ? { ...s, perfilAtivoId: id } : s));
    },
    [update]
  );

  const exitProfile = useCallback(() => {
    update((s) => ({ ...s, perfilAtivoId: null }));
  }, [update]);

  const addProfile = useCallback(
    (nomeRaw: string, avatarIdRaw: string): boolean => {
      const nome = sanitizeProfileName(nomeRaw);
      if (!nome) return false;
      const avatarId = isValidAvatarId(avatarIdRaw) ? avatarIdRaw : DEFAULT_AVATAR_ID;
      let ok = false;
      update((s) => {
        if (s.perfis.length >= MAX_PROFILES) return s;
        ok = true;
        const profile: Profile = {
          id: uid(),
          nome,
          avatarId,
          listaAssistirMaisTarde: [],
          continuarAssistindo: [],
        };
        return { ...s, perfis: [...s.perfis, profile] };
      });
      return ok;
    },
    [update]
  );

  const updateProfile = useCallback(
    (id: string, nomeRaw: string, avatarIdRaw: string): boolean => {
      const nome = sanitizeProfileName(nomeRaw);
      if (!nome) return false;
      const avatarId = isValidAvatarId(avatarIdRaw) ? avatarIdRaw : DEFAULT_AVATAR_ID;
      update((s) => ({
        ...s,
        perfis: s.perfis.map((p) => (p.id === id ? { ...p, nome, avatarId } : p)),
      }));
      return true;
    },
    [update]
  );

  const deleteProfile = useCallback(
    (id: string) => {
      update((s) => ({
        perfis: s.perfis.filter((p) => p.id !== id),
        perfilAtivoId: s.perfilAtivoId === id ? null : s.perfilAtivoId,
      }));
    },
    [update]
  );

  const activeProfile = useMemo(
    () => store.perfis.find((p) => p.id === store.perfilAtivoId) ?? null,
    [store]
  );

  const toggleWatchlist = useCallback(
    (tituloId: string) => {
      if (!activeProfile) return;
      const id = activeProfile.id;
      update((s) => ({
        ...s,
        perfis: s.perfis.map((p) => {
          if (p.id !== id) return p;
          const has = p.listaAssistirMaisTarde.includes(tituloId);
          return {
            ...p,
            listaAssistirMaisTarde: has
              ? p.listaAssistirMaisTarde.filter((x) => x !== tituloId)
              : [...p.listaAssistirMaisTarde, tituloId],
          };
        }),
      }));
    },
    [activeProfile, update]
  );

  const isInWatchlist = useCallback(
    (tituloId: string) => Boolean(activeProfile?.listaAssistirMaisTarde.includes(tituloId)),
    [activeProfile]
  );

  const saveProgress = useCallback(
    (
      tituloId: string,
      episodioId: string | null,
      progressoSegundos: number,
      duracaoSegundos: number
    ) => {
      if (!activeProfile || !duracaoSegundos) return;
      const id = activeProfile.id;
      update((s) => ({
        ...s,
        perfis: s.perfis.map((p) => {
          if (p.id !== id) return p;
          const rest = p.continuarAssistindo.filter((c) => c.tituloId !== tituloId);
          const quaseNoFim = progressoSegundos >= duracaoSegundos - 5;
          const quaseNoInicio = progressoSegundos <= 5;
          if (quaseNoFim || quaseNoInicio) {
            return { ...p, continuarAssistindo: rest };
          }
          return {
            ...p,
            continuarAssistindo: [...rest, { tituloId, episodioId, progressoSegundos }],
          };
        }),
      }));
    },
    [activeProfile, update]
  );

  const getProgress = useCallback(
    (tituloId: string) => activeProfile?.continuarAssistindo.find((c) => c.tituloId === tituloId),
    [activeProfile]
  );

  const clearProgress = useCallback(
    (tituloId: string) => {
      if (!activeProfile) return;
      const id = activeProfile.id;
      update((s) => ({
        ...s,
        perfis: s.perfis.map((p) =>
          p.id === id
            ? { ...p, continuarAssistindo: p.continuarAssistindo.filter((c) => c.tituloId !== tituloId) }
            : p
        ),
      }));
    },
    [activeProfile, update]
  );

  const value: ProfileContextValue = {
    ready,
    profiles: store.perfis,
    activeProfile,
    selectProfile,
    exitProfile,
    addProfile,
    updateProfile,
    deleteProfile,
    canAddProfile: store.perfis.length < MAX_PROFILES,
    toggleWatchlist,
    isInWatchlist,
    saveProgress,
    getProgress,
    clearProgress,
  };

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfiles(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfiles precisa estar dentro de <ProfileProvider>");
  return ctx;
}
