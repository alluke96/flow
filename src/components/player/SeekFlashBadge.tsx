import { Back10Icon, Forward10Icon } from "../player-icons";
import type { SeekFlashState } from "./types";

/**
 * Independente de .player-overlay/controls-hidden de propósito — o
 * feedback do seek tem que aparecer mesmo se os controles já sumiram por
 * inatividade (é bem comum dar duplo-toque justo quando eles estão
 * escondidos). pointer-events:none no CSS: nunca deve atrapalhar nenhum
 * toque por baixo.
 */
export function SeekFlashBadge({ flash }: { flash: SeekFlashState | null }) {
  if (!flash) return null;
  return (
    <div key={flash.id} className={`seek-flash seek-flash-${flash.dir}`}>
      <div className="seek-flash-badge">
        {flash.dir === "back" ? <Back10Icon /> : <Forward10Icon />}
        <span>10 segundos</span>
      </div>
    </div>
  );
}
