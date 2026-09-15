import { useCallback, useRef } from "react";

/**
 * Busca que ACELERA enquanto a seta fica pressionada.
 *
 * Num controle de TV, atravessar um filme de duas horas de 10 em 10
 * segundos é inviável — são centenas de toques. Segurando a seta, o salto
 * vai crescendo: começa nos mesmos 10s de um toque solto e, se a tecla
 * continuar pressionada, passa a andar por VELOCIDADE (segundos de vídeo
 * por segundo de dedo), até varrer um filme inteiro em poucos segundos.
 *
 * O cálculo é por velocidade, e não "tanto por tecla", de propósito: a
 * repetição automática de teclado varia de aparelho pra aparelho (e o
 * controle da TV é bem mais lento que um teclado). Por velocidade, segurar
 * dois segundos anda a mesma coisa em qualquer um deles.
 */

/**
 * Acima disto, a tecla foi solta e apertada de novo: recomeça do passo base.
 *
 * Folgado de propósito. Antes de engatar a repetição automática, o teclado
 * (e o controle da TV) espera meio segundo — com uma janela curta, esse
 * primeiro repique era lido como toque novo e a aceleração nunca engatava.
 * E não custa nada errar pra cá: no começo da rampa a velocidade é tal que
 * uma sequência de toques espaçados rende quase o mesmo que o passo base.
 */
const INTERVALO_MESMA_RAJADA_MS = 600;

/**
 * Quanto vídeo passa por segundo de tecla pressionada, conforme ela vai
 * ficando presa. O primeiro toque de cada rajada não entra aqui — ele vale
 * o passo base, pra um toque solto continuar sendo exatamente ±10s.
 */
const RAMPA: { apos: number; porSegundo: number }[] = [
  { apos: 0, porSegundo: 20 },
  { apos: 1000, porSegundo: 60 },
  { apos: 2500, porSegundo: 180 },
  { apos: 4500, porSegundo: 480 },
];

function velocidade(seguraHaMs: number): number {
  let atual = RAMPA[0].porSegundo;
  for (const faixa of RAMPA) if (seguraHaMs >= faixa.apos) atual = faixa.porSegundo;
  return atual;
}

export function useSeekAcelerado() {
  const inicioRef = useRef(0);
  const ultimoRef = useRef(0);
  const direcaoRef = useRef(0);

  /**
   * Quantos segundos pular AGORA. `passoBase` é o salto de um toque solto
   * (±10s nas setas, ±5s na barra de progresso).
   */
  return useCallback((direcao: 1 | -1, passoBase: number) => {
    const agora = Date.now();
    const mesmaRajada =
      direcao === direcaoRef.current && agora - ultimoRef.current <= INTERVALO_MESMA_RAJADA_MS;
    direcaoRef.current = direcao;
    const anterior = ultimoRef.current;
    ultimoRef.current = agora;

    if (!mesmaRajada) {
      inicioRef.current = agora;
      return passoBase * direcao;
    }
    const salto = (velocidade(agora - inicioRef.current) * (agora - anterior)) / 1000;
    return salto * direcao;
  }, []);
}
