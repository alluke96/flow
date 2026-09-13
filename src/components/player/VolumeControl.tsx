import type { ChangeEvent } from "react";
import { VolumeHighIcon, VolumeLowIcon, VolumeMuteIcon } from "../player-icons";

export function VolumeControl({
  muted,
  volume,
  onToggleMute,
  onVolumeChange,
}: {
  muted: boolean;
  volume: number;
  onToggleMute: () => void;
  onVolumeChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  const VolumeIcon = muted || volume === 0 ? VolumeMuteIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon;
  return (
    <div className="volume-control">
      <button onClick={onToggleMute} aria-label={muted ? "Ativar som" : "Silenciar"}>
        <VolumeIcon />
      </button>
      <input
        className="volume-slider"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={onVolumeChange}
        aria-label="Volume"
      />
    </div>
  );
}
