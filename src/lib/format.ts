import type { TitleSummary } from "@/types/catalog";

export function formatDuration(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${m.toString().padStart(2, "0")}min`;
}

export function metaLine(t: TitleSummary): string {
  const parts: string[] = [];
  if (t.ano) parts.push(String(t.ano));
  if (t.tipo === "filme") {
    if (t.duracaoMinutos) parts.push(formatDuration(t.duracaoMinutos));
  } else if (t.totalTemporadas) {
    parts.push(`${t.totalTemporadas} temporada${t.totalTemporadas > 1 ? "s" : ""}`);
  }
  if (t.genero.length) parts.push(t.genero.join(", "));
  return parts.join("  •  ");
}

export function fmtTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
