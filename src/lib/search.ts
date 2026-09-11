/**
 * Normaliza texto pra comparacao de busca: minusculas + remove acentuacao
 * (via decomposicao Unicode NFD + descarte dos diacriticos combinantes, faixa
 * U+0300-U+036F). Assim a busca ignora acentos.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function matchesSearch(text: string, query: string): boolean {
  return normalizeForSearch(text).includes(normalizeForSearch(query));
}
