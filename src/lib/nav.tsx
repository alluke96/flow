"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Camada de navegação do app — existe porque o Flow roda em DOIS contextos
 * bem diferentes:
 *
 * 1) Web (PC, celular, navegador): cada tela é uma rota de verdade do
 *    Next.js, com URL própria, botão voltar do navegador funcionando, link
 *    compartilhável. É o modo "router" (ver NavRouterProvider).
 *
 * 2) App de TV (widget Tizen): o app inteiro é empacotado no `.wgt` e roda
 *    a partir de `file://`, onde NÃO EXISTE roteamento por URL — um
 *    `router.push("/browse")` viraria `file:///browse`, que não existe, e
 *    quebraria tudo. Lá o app é uma página só e a "navegação" é estado
 *    React puro, com uma pilha pra dar o efeito de voltar. É o modo
 *    "estado" (ver NavEstadoProvider).
 *
 * As telas (ver src/components/screens) não sabem em qual dos dois estão:
 * chamam `ir()`/`voltar()` e pronto. É isso que permite o mesmo código de
 * UI servir os dois sem `if (tizen)` espalhado.
 */

export type Tela =
  | { nome: "perfis" }
  | { nome: "browse" }
  | { nome: "titulo"; id: string }
  | { nome: "player"; id: string; ep?: string | null };

/** URL equivalente a uma tela — só usada no modo router (web). */
export function hrefDeTela(t: Tela): string {
  switch (t.nome) {
    case "perfis":
      return "/";
    case "browse":
      return "/browse";
    case "titulo":
      return `/title/${t.id}`;
    case "player":
      return t.ep ? `/watch/${t.id}?ep=${encodeURIComponent(t.ep)}` : `/watch/${t.id}`;
  }
}

interface NavContexto {
  ir(tela: Tela, opts?: { substituir?: boolean }): void;
  /** Href pra <a href>: na web é a URL real; no modo estado é só "#". */
  href(tela: Tela): string;
  /** Só no modo estado (TV) — na web é null, quem manda é a rota. */
  telaAtual: Tela | null;
  /**
   * Adianta o carregamento de uma tela. Na web isso importa de verdade: sem
   * prefetch, o "voltar" do player só COMEÇA a buscar a página de detalhe no
   * clique, e a ida e volta inteira acontece com o usuário olhando pro
   * player parado. No modo estado (TV) não existe carregamento de rota
   * nenhum — a troca é só estado React —, então vira no-op.
   */
  prefetch(tela: Tela): void;
}

const Ctx = createContext<NavContexto | null>(null);

export function useNav(): NavContexto {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNav precisa estar dentro de um NavProvider");
  return ctx;
}

/** Modo web: cada tela é uma rota do Next.js, com URL de verdade. */
export function NavRouterProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const valor = useMemo<NavContexto>(
    () => ({
      ir(tela, opts) {
        const href = hrefDeTela(tela);
        if (opts?.substituir) router.replace(href);
        else router.push(href);
      },
      href: hrefDeTela,
      telaAtual: null,
      prefetch(tela) {
        router.prefetch(hrefDeTela(tela));
      },
    }),
    [router]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/**
 * Modo TV (widget Tizen): uma página só, tela atual em estado React.
 *
 * `substituir` existe pelo mesmo motivo do router.replace na web: avançar
 * pro próximo episódio não deve empilhar mais um nível pra trás (senão
 * "voltar" percorreria episódio por episódio em vez de sair do player).
 */
export function NavEstadoProvider({
  inicial = { nome: "perfis" },
  children,
}: {
  inicial?: Tela;
  children: ReactNode;
}) {
  const [telaAtual, setTelaAtual] = useState<Tela>(inicial);
  const pilhaRef = useRef<Tela[]>([]);

  const ir = useCallback<NavContexto["ir"]>((tela, opts) => {
    setTelaAtual((atual) => {
      if (!opts?.substituir) pilhaRef.current.push(atual);
      return tela;
    });
  }, []);

  const valor = useMemo<NavContexto>(
    () => ({ ir, href: () => "#", telaAtual, prefetch: () => {} }),
    [ir, telaAtual]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
