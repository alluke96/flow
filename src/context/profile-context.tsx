"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Profile, WatchProgress } from "@/types/profile";
import { MAX_PROFILES } from "@/types/profile";
import { DEFAULT_AVATAR_ID, isValidAvatarId } from "@/lib/avatars";
import { sanitizeProfileName } from "@/lib/validation";
import { useTVNav } from "@/lib/tv-nav";
import {
  clearProgressApi,
  createProfile as createProfileApi,
  deleteProfileApi,
  fetchProfiles,
  importLegacyProfiles,
  saveProgressApi,
  setWatchlistApi,
  updateProfileApi,
} from "@/lib/api-client";

/**
 * Camada de perfis — sem login (não é fronteira de segurança/privacidade
 * real, só conveniência de UX, ver spec). A lista de perfis em si (nomes,
 * avatares, watchlist, progresso) mora no SERVIDOR agora — um arquivo JSON
 * compartilhado (ver src/lib/profiles-store.ts e as rotas /api/profiles) —
 * em vez de localStorage, que era isolado por navegador/aparelho: TV,
 * celular e PC cada um enxergava perfis diferentes (ou nenhum). Como o app
 * roda só localmente, sem login de verdade, guardar num arquivo do próprio
 * servidor sem autenticação é uma troca aceitável (ver comentário na rota).
 *
 * `perfilAtivoId` (qual perfil ESTE navegador tem selecionado agora)
 * continua em localStorage de propósito — é por dispositivo, não
 * compartilhado: trocar de perfil na TV não deveria mudar o que está ativo
 * no celular de quem também estiver usando o app ao mesmo tempo.
 *
 * Toda mutação (criar/editar/excluir perfil, watchlist, progresso) atualiza
 * o estado local na hora (otimista, pra UI continuar instantânea como
 * antes) e manda a mudança pro servidor em seguida, reconciliando com a
 * lista que ele devolve — que é a fonte da verdade de verdade.
 */

const ACTIVE_ID_KEY = "flow_active_profile_id_v1";
// Chave antiga (versão só-localStorage) — usada uma única vez pra migrar
// perfis que já existiam neste navegador antes desta mudança, pra ninguém
// perder o que já tinha criado (ver loadLegacyProfiles abaixo).
const LEGACY_STORAGE_KEY = "flow_profiles_v1";

function loadActiveId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_ID_KEY);
  } catch {
    return null;
  }
}

function saveActiveId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_ID_KEY, id);
    else window.localStorage.removeItem(ACTIVE_ID_KEY);
  } catch {
    // localStorage indisponível (aba privada, quota cheia...) — a sessão
    // atual continua funcionando, só não lembra o perfil ativo no reload.
  }
}

function loadLegacyProfiles(): Profile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { perfis?: unknown };
    return Array.isArray(parsed.perfis) ? (parsed.perfis as Profile[]) : [];
  } catch {
    return [];
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
  addProfile: (nome: string, avatarId: string) => void;
  updateProfile: (id: string, nome: string, avatarId: string) => void;
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
  // Registered once here (wraps every route in the root layout) instead of
  // per-page — TV remote/D-pad navigation then works everywhere for free.
  useTVNav();
  const [perfis, setPerfis] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const localActiveId = loadActiveId();
      let serverPerfis: Profile[];
      try {
        serverPerfis = await fetchProfiles();
        // Servidor ainda não tem nenhum perfil — se este navegador tinha
        // perfis do formato antigo (localStorage), migra pra cá agora, de
        // uma vez só. Se outro dispositivo migrar os dele primeiro, a rota
        // de import ignora silenciosamente (só aplica quando o servidor
        // ainda está vazio) e a leitura abaixo já reflete o que ele gravou.
        if (serverPerfis.length === 0) {
          const legacy = loadLegacyProfiles();
          if (legacy.length > 0) {
            serverPerfis = await importLegacyProfiles(legacy);
          }
        }
      } catch {
        // Servidor inacessível — segue com lista vazia; a tela de perfis
        // fica vazia mas não trava. Tenta de novo no próximo carregamento.
        serverPerfis = [];
      }
      if (cancelled) return;
      setPerfis(serverPerfis);
      setActiveId(
        localActiveId && serverPerfis.some((p) => p.id === localActiveId) ? localActiveId : null
      );
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Aplica a mudança já computada localmente (feedback instantâneo, como
  // antes) e reconcilia em seguida com o que o servidor de fato gravou —
  // que pode diferir um pouco se outro dispositivo mexeu em outro perfil
  // nesse meio-tempo. Se a chamada falhar (rede caiu, servidor fora do ar),
  // mantém a versão otimista: a sessão atual continua funcionando, só não
  // fica salva de verdade até a próxima mutação bem-sucedida.
  //
  // startTransition (não um setTimeout(...,0)) nas duas atualizações NÃO é
  // cosmético — é a correção de um bug real (botão de voltar quebrando de
  // novo depois desta mudança): saveProgress toca este contexto (ancestral)
  // a cada 5s enquanto o vídeo toca (ver VideoPlayer), e antes de perfis
  // morarem no servidor bastava adiar essa chamada por UM tick (setTimeout)
  // pra nunca coincidir com uma transição de rota em andamento (ex: clicar
  // em "voltar"). Isso funcionava porque a transição em si também só levava
  // um punhado de ticks. Agora a reconciliação dispara quando um fetch de
  // rede resolve — um tempo IMPREVISÍVEL que pode facilmente ultrapassar
  // aqueles poucos ticks, especialmente se a rota de destino também precisa
  // buscar dados (ex: catálogo do /browse), alargando a janela em que a
  // transição continua "pendente". Um atraso fixo não acompanha isso;
  // startTransition sim — marca a atualização como de baixa prioridade,
  // então o React sempre prioriza terminar a navegação em andamento antes
  // dela, não importa quanto tempo isso leve.
  const applyMutation = useCallback(
    (optimistic: Profile[], action: () => Promise<Profile[]>) => {
      startTransition(() => setPerfis(optimistic));
      action()
        .then((serverPerfis) => {
          startTransition(() => setPerfis(serverPerfis));
        })
        .catch(() => {});
    },
    []
  );

  const selectProfile = useCallback(
    (id: string) => {
      if (!perfis.some((p) => p.id === id)) return;
      saveActiveId(id);
      setActiveId(id);
    },
    [perfis]
  );

  const exitProfile = useCallback(() => {
    saveActiveId(null);
    setActiveId(null);
  }, []);

  const addProfile = useCallback(
    (nomeRaw: string, avatarIdRaw: string) => {
      const nome = sanitizeProfileName(nomeRaw);
      if (!nome || perfis.length >= MAX_PROFILES) return;
      const avatarId = isValidAvatarId(avatarIdRaw) ? avatarIdRaw : DEFAULT_AVATAR_ID;
      const novo: Profile = {
        id: uid(),
        nome,
        avatarId,
        listaAssistirMaisTarde: [],
        continuarAssistindo: [],
      };
      applyMutation([...perfis, novo], () => createProfileApi(nome, avatarId));
    },
    [perfis, applyMutation]
  );

  const updateProfile = useCallback(
    (id: string, nomeRaw: string, avatarIdRaw: string) => {
      const nome = sanitizeProfileName(nomeRaw);
      if (!nome) return;
      const avatarId = isValidAvatarId(avatarIdRaw) ? avatarIdRaw : DEFAULT_AVATAR_ID;
      const next = perfis.map((p) => (p.id === id ? { ...p, nome, avatarId } : p));
      applyMutation(next, () => updateProfileApi(id, nome, avatarId));
    },
    [perfis, applyMutation]
  );

  const deleteProfile = useCallback(
    (id: string) => {
      const next = perfis.filter((p) => p.id !== id);
      if (activeId === id) {
        saveActiveId(null);
        setActiveId(null);
      }
      applyMutation(next, () => deleteProfileApi(id));
    },
    [perfis, activeId, applyMutation]
  );

  const activeProfile = useMemo(
    () => perfis.find((p) => p.id === activeId) ?? null,
    [perfis, activeId]
  );

  const toggleWatchlist = useCallback(
    (tituloId: string) => {
      if (!activeProfile) return;
      const id = activeProfile.id;
      const has = activeProfile.listaAssistirMaisTarde.includes(tituloId);
      const next = perfis.map((p) => {
        if (p.id !== id) return p;
        return {
          ...p,
          listaAssistirMaisTarde: has
            ? p.listaAssistirMaisTarde.filter((x) => x !== tituloId)
            : [...p.listaAssistirMaisTarde, tituloId],
        };
      });
      applyMutation(next, () => setWatchlistApi(id, tituloId, has ? "remove" : "add"));
    },
    [activeProfile, perfis, applyMutation]
  );

  const isInWatchlist = useCallback(
    (tituloId: string) => Boolean(activeProfile?.listaAssistirMaisTarde.includes(tituloId)),
    [activeProfile]
  );

  // saveProgress é chamado com frequência (a cada 5s enquanto o vídeo toca,
  // ver VideoPlayer) — manda cada chamada pro servidor conforme acontece
  // (sem debounce aqui: o intervalo de 5s do player já é o "debounce").
  const saveProgress = useCallback(
    (
      tituloId: string,
      episodioId: string | null,
      progressoSegundos: number,
      duracaoSegundos: number
    ) => {
      if (!activeProfile || !duracaoSegundos) return;
      const id = activeProfile.id;
      const quaseNoFim = progressoSegundos >= duracaoSegundos - 5;
      const quaseNoInicio = progressoSegundos <= 5;
      const next = perfis.map((p) => {
        if (p.id !== id) return p;
        const rest = p.continuarAssistindo.filter((c) => c.tituloId !== tituloId);
        if (quaseNoFim || quaseNoInicio) return { ...p, continuarAssistindo: rest };
        return {
          ...p,
          continuarAssistindo: [...rest, { tituloId, episodioId, progressoSegundos }],
        };
      });
      applyMutation(next, () =>
        saveProgressApi(id, tituloId, episodioId, progressoSegundos, duracaoSegundos)
      );
    },
    [activeProfile, perfis, applyMutation]
  );

  const getProgress = useCallback(
    (tituloId: string) => activeProfile?.continuarAssistindo.find((c) => c.tituloId === tituloId),
    [activeProfile]
  );

  const clearProgress = useCallback(
    (tituloId: string) => {
      if (!activeProfile) return;
      const id = activeProfile.id;
      const next = perfis.map((p) =>
        p.id === id
          ? { ...p, continuarAssistindo: p.continuarAssistindo.filter((c) => c.tituloId !== tituloId) }
          : p
      );
      applyMutation(next, () => clearProgressApi(id, tituloId));
    },
    [activeProfile, perfis, applyMutation]
  );

  const value: ProfileContextValue = {
    ready,
    profiles: perfis,
    activeProfile,
    selectProfile,
    exitProfile,
    addProfile,
    updateProfile,
    deleteProfile,
    canAddProfile: perfis.length < MAX_PROFILES,
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
