/** APIs não-padrão do WebKit/iOS Safari pra fullscreen do <video>. */
export interface WebkitVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
}

export interface SeekFlashState {
  dir: "back" | "fwd";
  id: number;
}

export interface ProgressPreview {
  pct: number;
  time: number;
}

export interface PlaybackErrorDetail {
  code: number | undefined;
  message: string;
}
