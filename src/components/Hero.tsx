"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { useNav } from "@/lib/nav";
import type { TitleSummary } from "@/types/catalog";
import { bannerUrl } from "@/lib/api-client";
import { metaLine } from "@/lib/format";
import { useProfiles } from "@/context/profile-context";

const ROTATE_MS = 10000;
// Tem que bater com a duração da animação de .hero-bg-current no CSS —
// depois desse tempo a camada de baixo (imagem anterior) some, porque a
// de cima já terminou de entrar e está cobrindo ela por completo.
const FADE_MS = 900;
// Abaixo disso é considerado um toque/tap, não um swipe — evita trocar de
// slide sem querer ao tocar num botão/link (que não move o dedo no eixo X).
const SWIPE_THRESHOLD_PX = 50;

export function Hero({ titles }: { titles: TitleSummary[] }) {
  const { ir, href } = useNav();
  const { getProgress } = useProfiles();
  const [index, setIndex] = useState(0);
  // Guarda o id do título pra que o aviso "ainda não disponível" apareça só
  // pra ele — troca de slide já limpa o aviso sem precisar de um efeito.
  const [unavailableId, setUnavailableId] = useState<string | null>(null);

  // Garante um índice válido se a lista encolher (ex: busca alterando o catálogo).
  const title = titles[index] ?? titles[0];
  const hasProgress = Boolean(title && getProgress(title.id));
  const unavailable = title?.id === unavailableId;

  // Crossfade entre banners: mantém o título anterior visível (parado) numa
  // camada por baixo enquanto o novo entra com fade-in por cima; depois que
  // a animação termina, solta a camada de baixo.
  const [prevTitle, setPrevTitle] = useState<TitleSummary | null>(null);

  // Limpa a camada antiga depois que a de cima termina de cobrir ela por
  // completo. Só cleanup (não afeta o que aparece na tela) — pode rodar
  // depois do commit sem problema, ao contrário de setPrevTitle em si (ver
  // changeSlide abaixo).
  useEffect(() => {
    if (!prevTitle) return;
    const t = setTimeout(() => setPrevTitle(null), FADE_MS);
    return () => clearTimeout(t);
  }, [prevTitle]);

  // Troca o slide E guarda o título que estava na tela num ÚNICO evento
  // (setPrevTitle + setIndex chamados juntos, síncronos, no mesmo handler —
  // React agrupa os dois numa render só). Antes, prevTitle vinha de um
  // useEffect observando `title` mudar — só que esse efeito roda DEPOIS do
  // React já ter pintado a tela com o título novo, então por um frame a
  // camada de baixo (prevTitle) ainda não existia: só a imagem/texto novos
  // apareciam, entrando do zero (opacity 0) sem nada por baixo — um flash
  // visível pro preto/gradiente antes da camada antiga reaparecer no frame
  // seguinte. Era esse frame sem camada de baixo, e não a duração do fade,
  // que dava a impressão de "flick"/pisca e de o texto "atrasar".
  function changeSlide(newIndex: number) {
    setPrevTitle(title);
    setIndex(newIndex);
  }

  // Pré-carrega todos os banners do carrossel assim que a lista chega, em
  // vez de só quando cada slide entra. Sem isso, o crossfade (abaixo) começa
  // a animar a opacidade de uma camada cujo background-image ainda nem
  // terminou de baixar — o resultado visual é a imagem antiga sumindo, uma
  // caixa em branco/preta entrando no lugar dela, e a nova imagem só
  // "estourando" (pop-in) quando o carregamento termina, bem depois da
  // animação já ter acabado. Isso é boa parte do porquê o carrossel nunca
  // pareceu de verdade suave: com a imagem já em cache do navegador, o
  // crossfade de opacidade não compete com rede nenhuma.
  useEffect(() => {
    const imgs = titles.map((t) => {
      const img = new Image();
      img.src = bannerUrl(t.id);
      return img;
    });
    return () => {
      imgs.forEach((img) => {
        img.src = "";
      });
    };
  }, [titles]);

  // Avança automaticamente pelos títulos disponíveis. Depende de `index`
  // (não só de titles.length) pra reiniciar a contagem sempre que o slide
  // muda por QUALQUER motivo, inclusive um swipe manual — sem isso, um
  // swipe logo antes do próximo tick automático faria o carrossel trocar
  // de novo quase na sequência, parecendo instável.
  useEffect(() => {
    if (titles.length < 2) return;
    const id = setInterval(() => {
      changeSlide((index + 1) % titles.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titles.length, index]);

  // Swipe por toque (smartphone/tablet): compara só a posição inicial e
  // final do toque (touchstart/touchend) — não precisa acompanhar o
  // touchmove, então não interfere no scroll vertical normal da página.
  // Descarta toques que também se moveram bastante no eixo Y (provável
  // scroll, não swipe horizontal) e os pequenos demais no eixo X (tap
  // normal num botão/link do hero). Precisa vir ANTES do "if (!title)
  // return null" abaixo — hooks não podem ser chamados condicionalmente.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  if (!title) return null;

  function handlePlay() {
    if (title.disponivel === false) {
      setUnavailableId(title.id);
      return;
    }
    ir({ nome: "player", id: title.id });
  }

  function goTo(delta: 1 | -1) {
    if (titles.length < 2) return;
    // Soma titles.length antes do módulo pra funcionar com delta negativo
    // também (voltar do primeiro slide vai pro último — cycle nos dois
    // sentidos, igual ao avanço automático já faz).
    changeSlide((index + delta + titles.length) % titles.length);
  }

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
    goTo(dx < 0 ? 1 : -1);
  }

  return (
    <div className="hero" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {prevTitle && (
        <div
          className="hero-bg"
          style={{ backgroundImage: `url('${bannerUrl(prevTitle.id)}')` }}
        />
      )}
      <div
        key={title.id}
        className="hero-bg hero-bg-current"
        style={{ backgroundImage: `url('${bannerUrl(title.id)}')` }}
      />
      <div className="hero-fade" />
      {/* O texto NÃO crossfada com o anterior, ao contrário da imagem —
          testado e revertido duas vezes na mesma sessão: duas fotos se
          misturando fica natural, mas dois blocos de texto (ou o título
          desenhado na própria arte do banner anterior, que também fica em
          opacidade total por baixo) sobrepostos no mesmo lugar só parece
          embaralhado/empilhado, texto por cima de texto, não importa a
          duração. Troca de `key` derruba o bloco antigo na hora e o novo
          entra deslizando de baixo pra cima, sem sobreposição nenhuma —
          fica decidido assim, não é questão de velocidade. */}
      <div key={`${title.id}-content`} className="hero-content">
        <h1 className="hero-title">{title.titulo}</h1>
        <div className="hero-meta">{metaLine(title)}</div>
        <p className="hero-desc">{title.sinopse}</p>
        <div className="hero-actions">
          <button className="btn-hero play" onClick={handlePlay}>
            ▶ {hasProgress ? "Continuar assistindo" : "Assistir"}
          </button>
          <a
            href={href({ nome: "titulo", id: title.id })}
            className="btn-hero info"
            onClick={(e) => {
              e.preventDefault();
              ir({ nome: "titulo", id: title.id });
            }}
          >
            ⓘ Detalhes
          </a>
        </div>
        {unavailable && <p className="unavailable-notice">Ainda não disponível.</p>}
      </div>
    </div>
  );
}
