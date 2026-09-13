"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
 * chamam `ir()` e pronto. É isso que permite o mesmo código de UI servir os
 * dois sem `if (tizen)` espalhado. O "voltar" global (botão Return do
 * controle) é `voltarNav()`, logo abaixo.
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

/**
 * "Voltar" global — o que o botão Return do controle remoto chama (ver
 * src/lib/tv-nav.ts).
 *
 * Por que um registro de módulo e não mais um campo do contexto: quem
 * escuta a tecla é o ProfileProvider, que fica ACIMA do NavEstadoProvider
 * na árvore (ver src/app/tv/page.tsx) — de lá, um useNav() alcançaria
 * apenas o provider de rota do layout, e no widget `router.back()` não tem
 * pra onde ir (é `file://`, uma página só, sem histórico): era exatamente
 * isso que fazia o Return não voltar tela nenhuma na TV.
 *
 * Só o modo estado se registra. Sem registro — ou seja, na web — o
 * comportamento certo continua sendo o histórico do navegador.
 */
let voltarRegistrado: (() => void) | null = null;

export function voltarNav(): void {
  if (voltarRegistrado) {
    voltarRegistrado();
    return;
  }
  window.history.back();
}

/**
 * Return na tela raiz fecha o app: é o que a TV faz em qualquer app dela, e
 * o que a Samsung exige pra certificação. Fora da TV não existe `tizen`
 * nenhum e isso não faz nada.
 */
function sairDoApp(): void {
  const tz = (window as unknown as {
    tizen?: { application?: { getCurrentApplication(): { exit(): void } } };
  }).tizen;
  try {
    tz?.application?.getCurrentApplication().exit();
  } catch {
    // sem widget por baixo não há o que fechar — seguir na tela mesmo
  }
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
      if (opts?.substituir) return tela;
      // Ir pra tela de onde acabamos de vir é VOLTAR, não avançar — e a
      // maior parte do app navega assim: sair do player cai no detalhe do
      // título, o botão de voltar do detalhe cai no browse. Empilhando
      // esses, o botão Return do controle ficaria pingando entre as duas
      // telas pra sempre, sem nunca chegar no começo.
      const anterior = pilhaRef.current[pilhaRef.current.length - 1];
      if (anterior && hrefDeTela(anterior) === hrefDeTela(tela)) {
        pilhaRef.current.pop();
        return tela;
      }
      pilhaRef.current.push(atual);
      return tela;
    });
  }, []);

  const voltar = useCallback(() => {
    const anterior = pilhaRef.current.pop();
    if (anterior) setTelaAtual(anterior);
    else sairDoApp();
  }, []);

  useEffect(() => {
    voltarRegistrado = voltar;
    return () => {
      if (voltarRegistrado === voltar) voltarRegistrado = null;
    };
  }, [voltar]);

  const valor = useMemo<NavContexto>(
    () => ({ ir, href: () => "#", telaAtual, prefetch: () => {} }),
    [ir, telaAtual]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
