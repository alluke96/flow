import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Profile } from "@/types/profile";

/**
 * Persistência dos perfis, compartilhada entre dispositivos.
 *
 * Antes vivia só em localStorage — cada navegador/aparelho (PC, celular, TV)
 * tinha seus próprios perfis "do zero", já que localStorage nunca é
 * compartilhado entre origens/dispositivos diferentes. Como o app não tem
 * login de verdade (uso local/doméstico, ver spec — perfis não são fronteira
 * de segurança), passa a viver num arquivo JSON no próprio servidor: qualquer
 * dispositivo na mesma rede lendo /api/profiles enxerga os mesmos perfis,
 * watchlist e progresso.
 *
 * `perfilAtivoId` (qual perfil ESTE navegador tem selecionado agora)
 * continua só em localStorage, de propósito — é por dispositivo, não
 * compartilhado (ver profile-context.tsx), senão trocar de perfil na TV
 * mudaria o perfil ativo no celular de quem também estiver usando o app.
 *
 * FLOW_DATA_DIR aponta pra fora do checkout do git de propósito: o pipeline
 * de deploy self-host faz um checkout limpo a cada push (git clean, ver
 * deploy-selfhost.yml), que apagaria este arquivo se ele vivesse dentro do
 * repositório. Configure em .env.local (o mesmo arquivo já restaurado de
 * C:\flow-secrets a cada deploy) algo como:
 *   FLOW_DATA_DIR=C:\flow-data
 * Sem essa variável, cai num "data/" dentro do próprio projeto — ótimo pra
 * rodar localmente, mas seria apagado a cada deploy self-host se usado em
 * produção sem configurar.
 */

const DATA_DIR = process.env.FLOW_DATA_DIR || path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "profiles.json");

/** Quanto tempo uma lápide (ver abaixo) fica guardada antes de ser varrida. */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias

export interface ProfilesFile {
  perfis: Profile[];
  /**
   * "Lápides": id de perfil excluído -> quando foi excluído.
   *
   * Existe porque a junção entre aparelhos nunca pode ler "ausente" como
   * "apagado" (ver lib/profile-merge.ts). Sem isto, apagar um perfil no PC
   * duraria até a TV — que ainda tem o perfil na cópia local dela — mandar
   * a lista dela e RESSUSCITAR o perfil. Com a lápide, o servidor sabe a
   * diferença entre "esse aparelho ainda não conhece esse perfil" e "esse
   * perfil foi apagado de propósito", e os aparelhos recebem a lápide pra
   * apagar a cópia local também.
   */
  excluidos: Record<string, number>;
}

function vazio(): ProfilesFile {
  return { perfis: [], excluidos: {} };
}

/** Descarta lápides velhas demais pra importar (o aparelho já sincronizou). */
function podar(f: ProfilesFile): ProfilesFile {
  const limite = Date.now() - TOMBSTONE_TTL_MS;
  const excluidos: Record<string, number> = {};
  for (const [id, ts] of Object.entries(f.excluidos)) {
    if (ts >= limite) excluidos[id] = ts;
  }
  return { perfis: f.perfis, excluidos };
}

async function readFromDisk(): Promise<ProfilesFile> {
  try {
    const raw = await readFile(FILE_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    // Formato antigo do arquivo (só a lista de perfis, sem lápides).
    if (Array.isArray(parsed)) return { perfis: parsed as Profile[], excluidos: {} };
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Partial<ProfilesFile>;
      return {
        perfis: Array.isArray(obj.perfis) ? obj.perfis : [],
        excluidos:
          obj.excluidos && typeof obj.excluidos === "object" ? { ...obj.excluidos } : {},
      };
    }
    return vazio();
  } catch {
    // Primeiro uso (arquivo ainda não existe) ou JSON corrompido — começa
    // vazio em vez de derrubar a rota.
    return vazio();
  }
}

async function writeToDisk(f: ProfilesFile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE_PATH, JSON.stringify(f, null, 2), "utf-8");
}

export function readProfiles(): Promise<ProfilesFile> {
  return readFromDisk();
}

// Serializa toda escrita numa fila só: cada mutação lê o estado mais
// recente do disco (já refletindo qualquer mutação anterior na fila) antes
// de aplicar sua própria mudança. Isso é o que evita perder atualizações
// quando dois dispositivos mexem em perfis diferentes quase ao mesmo tempo
// (ex: duas pessoas assistindo títulos diferentes) — cada rota manda só a
// mudança pontual, nunca a lista inteira "por fora", então não há como uma
// escrita pisar às cegas na outra.
let queue: Promise<unknown> = Promise.resolve();

export function mutateProfiles(
  mutator: (current: ProfilesFile) => ProfilesFile
): Promise<ProfilesFile> {
  const result = queue.catch(() => {}).then(async () => {
    const current = await readFromDisk();
    const next = podar(mutator(current));
    await writeToDisk(next);
    return next;
  });
  // Encadeia a próxima mutação a partir desta mesmo se ela falhar, senão uma
  // escrita com erro travaria a fila pra sempre.
  queue = result.catch(() => {});
  return result;
}
