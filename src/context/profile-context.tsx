"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Profile, ProfileStore, WatchProgress } from "@/types/profile";
import { MAX_PROFILES } from "@/types/profile";
import { mergeProfiles } from "@/lib/profile-merge";
import { DEFAULT_AVATAR_ID, isValidAvatarId } from "@/lib/avatars";
import { sanitizeProfileName } from "@/lib/validation";
import { useTVNav } from "@/lib/tv-nav";

/**
 * Perfis locais (sem login), com sincronização entre aparelhos.
 *
 * REGRA DE OURO DESTE ARQUIVO, e o motivo de ele ser escrito assim: o
 * localStorage é a fonte da verdade. Toda leitura e escrita que uma tela
 * faz é síncrona e local — nada nunca espera a rede, e nenhuma resposta de
 * rede mexe em estado do React em hora imprevisível.
 *
 * Isso não é preciosismo: a primeira versão disto (v0.1.10) fazia um POST a
 * cada 5 segundos DURANTE a reprodução e chamava setState no `.then()` de
 * cada resposta. Os dois lados doeram — os POSTs disputavam as ~6 conexões
 * por origem do HTTP/1.1 com o próprio streaming do vídeo, e os setState
 * fora de hora atropelavam transições de rota em andamento (era o "clico em
 * voltar e ele pausa, fica preto e não volta"). Por isso, aqui:
 *
 *  - o servidor é consultado UMA vez, no carregamento do app, quando não há
 *    nada tocando e nenhuma navegação em andamento;
 *  - o envio pro servidor é sempre por `navigator.sendBeacon`, que por
 *    construção não tem `.then` nem callback: é impossível ele mexer em
 *    estado. E só acontece em momento seguro (aba escondida, saindo da
 *    página, saindo do player DEPOIS de já ter navegado, trocando de
 *    perfil) — NUNCA durante a reprodução, e nunca em intervalo fixo;
 *  - a junção é feita perfil a perfil pelo carimbo `atualizadoEm` (ver
 *    lib/profile-merge.ts), então TV e celular em perfis diferentes ao
 *    mesmo tempo não se apagam.
 *
 * `perfilAtivoId` (quem está assistindo NESTE aparelho agora) fica só no
 * localStorage de propósito: é por aparelho, não faz sentido compartilhar.
 */

const STORAGE_KEY = "flow_profiles_v1";
const SYNC_URL = "/api/profiles/sync";

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
      // Sempre começa sem perfil ativo: abrir o site pergunta "Quem está
      // assistindo?" de novo, a pedido. Os PERFIS em si continuam salvos
      // normalmente aqui no localStorage — só a seleção não é lembrada.
      perfilAtivoId: null,
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

/** Duas listas com exatamente os mesmos perfis? (ordem não importa) */
function sameProfiles(a: Profile[], b: Profile[]): boolean {
  if (a.length !== b.length) return false;
  const chave = (l: Profile[]) =>
    JSON.stringify([...l].sort((x, y) => x.id.localeCompare(y.id)));
  return chave(a) === chave(b);
}

/**
 * Manda a cópia local pro servidor e esquece. `sendBeacon` é o ponto: o
 * navegador assume a entrega em segundo plano, a chamada volta na hora e
 * NÃO existe resposta pra tratar — nenhum callback, nenhum setState, nada
 * que possa atravessar uma navegação ou disputar banda com o vídeo.
 */
function enviarPerfis(perfis: Profile[]) {
  if (typeof navigator === "undefined" || perfis.length === 0) return;
  const corpo = JSON.stringify({ perfis });
  try {
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(SYNC_URL, new Blob([corpo], { type: "application/json" }));
      return;
    }
    // Navegador sem sendBeacon (alguns Tizen/webOS antigos): fetch com
    // keepalive, de propósito sem `.then` — mesmo contrato de "manda e
    // esquece".
    void fetch(SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Sem rede / bloqueado: os perfis continuam salvos localmente, que é o
    // que faz o app funcionar. Sincroniza na próxima oportunidade.
  }
}

function uid(): string {
  return "p" + Math.random().toString(36).slice(2, 10);
}

/** Carimba o perfil como alterado agora (é o que a junção usa pra desempatar). */
function carimbar(p: Profile): Profile {
  return { ...p, atualizadoEm: Date.now() };
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
  /**
   * Empurra o que estiver salvo localmente pro servidor. Manda e esquece
   * (ver enviarPerfis) — chamável de qualquer lugar sem medo, desde que
   * seja num momento tranquilo: o player chama isto DEPOIS de já ter
   * navegado de volta, nunca durante a reprodução.
   */
  syncProfiles: () => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  // Registered once here (wraps every route in the root layout) instead of
  // per-page — TV remote/D-pad navigation then works everywhere for free.
  useTVNav();
  const [store, setStore] = useState<ProfileStore>(emptyStore);
  const [ready, setReady] = useState(false);

  // Espelho síncrono do estado. Existe porque `update` precisa ler o valor
  // mais recente NA HORA (o setState do React só aplica depois), e porque
  // o envio pro servidor tem que conseguir ler o progresso que acabou de
  // ser salvo, sem depender de quando o React resolveu renderizar.
  const storeRef = useRef<ProfileStore>(emptyStore());
  // Só manda pro servidor se algo de fato mudou desde o último envio.
  const pendenteRef = useRef(false);

  const update = useCallback((updater: (s: ProfileStore) => ProfileStore) => {
    const prev = storeRef.current;
    const next = updater(prev);
    if (next === prev) return;
    if (next.perfis !== prev.perfis) pendenteRef.current = true;
    storeRef.current = next;
    saveStore(next);
    setStore(next);
  }, []);

  const syncProfiles = useCallback(() => {
    if (!pendenteRef.current) return;
    pendenteRef.current = false;
    enviarPerfis(storeRef.current.perfis);
  }, []);

  useEffect(() => {
    // localStorage só existe no cliente — lê aqui (pós-montagem) de
    // propósito, pra não divergir do HTML renderizado no servidor. O app
    // fica utilizável NESTE instante: `ready` não espera a rede.
    const local = loadStore();
    storeRef.current = local;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStore(local);
    setReady(true);

    // Só agora, em segundo plano, pergunta ao servidor o que ele tem. É a
    // ÚNICA leitura de rede desta camada, e ela cai no carregamento do app
    // (tela "Quem está assistindo?"): nada tocando, nenhuma navegação em
    // andamento.
    let cancelado = false;
    fetch("/api/profiles", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { perfis?: unknown; excluidos?: unknown } | null) => {
        if (cancelado || !data || !Array.isArray(data.perfis)) return;
        const doServidor = data.perfis as Profile[];
        // Lápides: ids apagados em outro aparelho. É o que faz a exclusão
        // valer aqui também, em vez de a cópia local ressuscitar o perfil
        // na próxima sincronização (ver lib/profiles-store.ts).
        const excluidos = (data.excluidos ?? {}) as Record<string, number>;
        const atual = storeRef.current;
        const locais = atual.perfis.filter((p) => {
          const apagadoEm = excluidos[p.id];
          // Sem lápide, fica. Com lápide, só sobrevive se esta cópia for
          // mais nova que a exclusão (alguém editou depois).
          return apagadoEm === undefined || (p.atualizadoEm ?? 0) > apagadoEm;
        });
        const juntos = mergeProfiles(locais, doServidor).slice(0, MAX_PROFILES);

        // O servidor não conhece tudo que existe aqui (ex: perfis criados
        // neste aparelho antes de existir sincronização)? Conta pra ele.
        if (!sameProfiles(juntos, doServidor)) enviarPerfis(juntos);

        // Nada novo pra mostrar: não mexe em estado à toa.
        if (sameProfiles(juntos, atual.perfis)) return;

        const next = { ...atual, perfis: juntos };
        storeRef.current = next;
        saveStore(next);
        setStore(next);
      })
      .catch(() => {
        // Servidor fora do ar / offline: segue com a cópia local, que é a
        // fonte da verdade de qualquer forma.
      });

    return () => {
      cancelado = true;
    };
  }, []);

  // Momentos seguros pra empurrar o que mudou: a aba foi escondida (trocar
  // de app no celular/TV) ou a página está saindo. Nos dois casos o envio é
  // por sendBeacon justamente porque continua valendo mesmo com a página
  // sendo descarregada.
  useEffect(() => {
    const aoEsconder = () => {
      if (document.visibilityState === "hidden") syncProfiles();
    };
    document.addEventListener("visibilitychange", aoEsconder);
    window.addEventListener("pagehide", syncProfiles);
    return () => {
      document.removeEventListener("visibilitychange", aoEsconder);
      window.removeEventListener("pagehide", syncProfiles);
    };
  }, [syncProfiles]);

  const selectProfile = useCallback(
    (id: string) => {
      update((s) => (s.perfis.some((p) => p.id === id) ? { ...s, perfilAtivoId: id } : s));
    },
    [update]
  );

  const exitProfile = useCallback(() => {
    update((s) => ({ ...s, perfilAtivoId: null }));
    // Voltar pra tela de perfis é um momento tranquilo (nada tocando) e é
    // justamente quando o que foi assistido interessa aos outros aparelhos.
    syncProfiles();
  }, [update, syncProfiles]);

  const addProfile = useCallback(
    (nomeRaw: string, avatarIdRaw: string): boolean => {
      const nome = sanitizeProfileName(nomeRaw);
      if (!nome) return false;
      const avatarId = isValidAvatarId(avatarIdRaw) ? avatarIdRaw : DEFAULT_AVATAR_ID;
      let ok = false;
      update((s) => {
        if (s.perfis.length >= MAX_PROFILES) return s;
        ok = true;
        const profile: Profile = carimbar({
          id: uid(),
          nome,
          avatarId,
          listaAssistirMaisTarde: [],
          continuarAssistindo: [],
        });
        return { ...s, perfis: [...s.perfis, profile] };
      });
      if (ok) syncProfiles();
      return ok;
    },
    [update, syncProfiles]
  );

  const updateProfile = useCallback(
    (id: string, nomeRaw: string, avatarIdRaw: string): boolean => {
      const nome = sanitizeProfileName(nomeRaw);
      if (!nome) return false;
      const avatarId = isValidAvatarId(avatarIdRaw) ? avatarIdRaw : DEFAULT_AVATAR_ID;
      update((s) => ({
        ...s,
        perfis: s.perfis.map((p) => (p.id === id ? carimbar({ ...p, nome, avatarId }) : p)),
      }));
      syncProfiles();
      return true;
    },
    [update, syncProfiles]
  );

  const deleteProfile = useCallback(
    (id: string) => {
      update((s) => ({
        perfis: s.perfis.filter((p) => p.id !== id),
        perfilAtivoId: s.perfilAtivoId === id ? null : s.perfilAtivoId,
      }));
      pendenteRef.current = false;
      // Exclusão é a única coisa que precisa de rota própria: a junção
      // nunca lê "ausente" como "apagado" (senão outro aparelho
      // desatualizado ressuscitaria o perfil). Também é manda-e-esquece —
      // sem `.then` que mexa em estado.
      void fetch(`/api/profiles/${encodeURIComponent(id)}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
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
          return carimbar({
            ...p,
            listaAssistirMaisTarde: has
              ? p.listaAssistirMaisTarde.filter((x) => x !== tituloId)
              : [...p.listaAssistirMaisTarde, tituloId],
          });
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
      // Repare: aqui NÃO há envio pro servidor. Esta função é chamada de 5
      // em 5 segundos com o vídeo tocando — é exatamente o lugar onde a
      // versão anterior colocou um POST e quebrou o player. O que foi
      // salvo aqui sai depois, num momento tranquilo (ver syncProfiles).
      update((s) => ({
        ...s,
        perfis: s.perfis.map((p) => {
          if (p.id !== id) return p;
          const rest = p.continuarAssistindo.filter((c) => c.tituloId !== tituloId);
          const quaseNoFim = progressoSegundos >= duracaoSegundos - 5;
          const quaseNoInicio = progressoSegundos <= 5;
          if (quaseNoFim || quaseNoInicio) {
            return carimbar({ ...p, continuarAssistindo: rest });
          }
          return carimbar({
            ...p,
            continuarAssistindo: [...rest, { tituloId, episodioId, progressoSegundos }],
          });
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
            ? carimbar({
                ...p,
                continuarAssistindo: p.continuarAssistindo.filter((c) => c.tituloId !== tituloId),
              })
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
    syncProfiles,
  };

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfiles(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfiles precisa estar dentro de <ProfileProvider>");
  return ctx;
}
