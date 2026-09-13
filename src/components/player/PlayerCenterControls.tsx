import { Back10Icon, Forward10Icon, PauseIcon, PlayIcon, ReplayIcon } from "../player-icons";

/**
 * Play/pause (ou replay, no fim) e os botões ±10s. Depois do primeiro play,
 * um rebuffer (ex: logo após um seek) não esconde mais estes botões — só
 * troca o play/pause por um spinner pequeno; ±10s continuam clicáveis
 * normalmente (ver o componente pai, que decide quando isto é exibido em
 * vez do spinner de carregamento inicial).
 */
export function PlayerCenterControls({
  playing,
  ended,
  loading,
  onSeekBack,
  onSeekForward,
  onTogglePlay,
  onReplay,
}: {
  playing: boolean;
  ended: boolean;
  loading: boolean;
  onSeekBack: () => void;
  onSeekForward: () => void;
  onTogglePlay: () => void;
  onReplay: () => void;
}) {
  return (
    <div className="player-center">
      <button onClick={onSeekBack} aria-label="Voltar 10 segundos">
        <Back10Icon />
      </button>
      {loading ? (
        <div className="spinner spinner-inline" />
      ) : ended ? (
        <button className="player-playpause" onClick={onReplay} aria-label="Assistir de novo">
          <ReplayIcon />
        </button>
      ) : (
        <button className="player-playpause" onClick={onTogglePlay} aria-label={playing ? "Pausar" : "Reproduzir"}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      )}
      <button onClick={onSeekForward} aria-label="Avançar 10 segundos">
        <Forward10Icon />
      </button>
    </div>
  );
}
