import { useCallback, useEffect, useRef, useState } from "react";
import type { SeekFlashState } from "./types";

/**
 * Feedback visual do duplo-toque pra buscar ±10s (estilo YouTube) — sem
 * isso, o seek era seco demais: nada na tela indicava que o duplo-toque
 * tinha sido reconhecido, só o tempo pulando. `id` incrementa a cada
 * duplo-toque, mesmo repetido do mesmo lado — é a troca de `key` no JSX
 * (ver SeekFlashBadge) que reinicia a animação CSS a cada vez.
 */
export function useSeekFlash() {
  const [seekFlash, setSeekFlash] = useState<SeekFlashState | null>(null);
  const idRef = useRef(0);

  // Some sozinho depois de tocar a animação (ver .seek-flash no CSS) — tem
  // que bater com a duração dela.
  useEffect(() => {
    if (!seekFlash) return;
    const t = setTimeout(() => setSeekFlash(null), 700);
    return () => clearTimeout(t);
  }, [seekFlash]);

  const triggerSeekFlash = useCallback((dir: SeekFlashState["dir"]) => {
    idRef.current += 1;
    setSeekFlash({ dir, id: idRef.current });
  }, []);

  return { seekFlash, triggerSeekFlash };
}
