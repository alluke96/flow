/**
 * Este código está rodando dentro do app de TV (o widget Tizen)?
 *
 * O valor é fixado no build (ver scripts/build-tizen.mjs), não lido do DOM:
 * assim o servidor e o navegador respondem a mesma coisa, sem divergir na
 * hidratação, e o empacotador pode até remover o que não vale pro outro
 * lado.
 *
 * Serve pro punhado de lugares em que a TV não é "uma tela menor", e sim
 * outro aparelho: sem mouse, sem teclado à mão, e com um controle remoto em
 * que cada elemento a mais na tela é um toque a mais pra atravessar.
 */
export const NO_APP_DE_TV = process.env.NEXT_PUBLIC_FLOW_TV === "1";
