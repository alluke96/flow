import { isDriveConfigured } from "@/lib/drive/client";
import { mockCatalogSource } from "./mock";
import { driveCatalogSource } from "./drive";
import type { CatalogSource } from "./types";

export type { CatalogSource, OpenResult, StreamResult, RedirectResult, FileRange, ImageKind } from "./types";

/**
 * Ponto único de decisão: mock vs. Google Drive real. Assim que
 * GOOGLE_SERVICE_ACCOUNT_KEY e GOOGLE_DRIVE_ROOT_FOLDER_ID estiverem
 * configuradas no ambiente (Vercel → Project Settings → Environment
 * Variables), o app passa a usar o Drive automaticamente — nenhuma rota ou
 * componente precisa mudar.
 */
export function getCatalogSource(): CatalogSource {
  return isDriveConfigured() ? driveCatalogSource : mockCatalogSource;
}

export function isUsingMockCatalog(): boolean {
  return !isDriveConfigured();
}
