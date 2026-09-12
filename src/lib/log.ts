/**
 * Carimbo de hora local (HH:MM:SS.mmm) pros logs do servidor — sem isso,
 * uma linha em flow.log não dava pra saber se era de agora ou de ontem
 * (o self-host roda como serviço, não reinicia todo dia). Log local, não
 * ISO/UTC de propósito: o que importa é bater com o relógio de quem está
 * lendo o log ao vivo tentando correlacionar "apertei o botão agora" com
 * a linha que acabou de aparecer.
 */
export function horaLog(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}
