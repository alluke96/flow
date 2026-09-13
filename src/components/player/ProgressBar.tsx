import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import { fmtTime } from "@/lib/format";
import type { ProgressPreview } from "./types";

export function ProgressBar({
  progressRef,
  currentTime,
  duration,
  pct,
  bufferedPct,
  dragging,
  preview,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onKeyDown,
}: {
  progressRef: RefObject<HTMLDivElement | null>;
  currentTime: number;
  duration: number;
  pct: number;
  bufferedPct: number;
  dragging: boolean;
  preview: ProgressPreview | null;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="progress-row">
      <span className="time">{fmtTime(currentTime)}</span>
      <div
        className={`progress-bar${dragging ? " dragging" : ""}`}
        ref={progressRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        role="slider"
        aria-label="Progresso do vídeo"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        tabIndex={0}
      >
        {preview && (
          <div className="progress-tooltip" style={{ left: `${preview.pct * 100}%` }}>
            {fmtTime(preview.time)}
          </div>
        )}
        <div className="progress-track">
          <div className="progress-buffered" style={{ width: `${bufferedPct}%` }} />
        </div>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
        <div className="progress-handle" style={{ left: `${pct}%` }} />
      </div>
      <span className="time">{fmtTime(duration)}</span>
    </div>
  );
}
