import { z } from "zod";

/**
 * Validação de entrada das rotas de API (zod). IDs de título/episódio são
 * validados quanto ao *formato* aqui — a validação de que o ID realmente
 * existe no catálogo (allowlist) acontece na camada de CatalogSource, que é
 * quem decide se chama o Drive ou não.
 */

// IDs do nosso índice: tanto os do mock ("t1", "s1e2") quanto os do Drive
// real (fileIds do Google, alfanuméricos com "-"/"_") cabem neste formato.
const idPattern = /^[A-Za-z0-9_-]{1,200}$/;

export const titleIdSchema = z.string().regex(idPattern, "id de título inválido");
export const episodeIdSchema = z.string().regex(idPattern, "id de episódio inválido");
export const imageKindSchema = z.enum(["poster", "banner"]);
export const seasonNumberSchema = z.coerce.number().int().positive().max(1000);

export const profileNameSchema = z
  .string()
  .trim()
  .min(1, "nome é obrigatório")
  .max(20, "nome muito longo")
  .refine((v) => !/[<>]/.test(v), "nome não pode conter < ou >");

export function sanitizeProfileName(input: string): string {
  return input.replace(/[<>]/g, "").trim().slice(0, 20);
}
