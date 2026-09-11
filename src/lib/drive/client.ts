import { google, drive_v3 } from "googleapis";

/**
 * Autenticação com o Google Drive via Service Account (nunca OAuth de
 * usuário final — não há login de usuário nesta aplicação).
 *
 * Configuração esperada em variáveis de ambiente do servidor (nunca no
 * bundle do frontend):
 *   - GOOGLE_SERVICE_ACCOUNT_KEY: o JSON inteiro da chave da service
 *     account, como string. Aceita tanto o JSON "cru" quanto uma versão em
 *     base64 (útil em provedores que lidam mal com newlines/aspas em env
 *     vars multi-linha).
 *   - GOOGLE_DRIVE_ROOT_FOLDER_ID: ID da pasta raiz do catálogo no Drive
 *     (a pasta precisa estar compartilhada com o e-mail da service account,
 *     com permissão de leitura).
 */

function readCredentials(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    } catch {
      return null;
    }
  }
}

export function isDriveConfigured(): boolean {
  return Boolean(readCredentials() && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
}

export function getRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID não configurada.");
  return id;
}

let cachedClient: drive_v3.Drive | null = null;

export function getDriveClient(): drive_v3.Drive {
  if (cachedClient) return cachedClient;
  const credentials = readCredentials();
  if (!credentials) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY ausente ou inválida — configure a credencial da service account."
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  cachedClient = google.drive({ version: "v3", auth });
  return cachedClient;
}
