import { BackArrowIcon } from "../player-icons";

/**
 * Fica fora da camada que soma opacity+pointer-events com o resto dos
 * controles (.player-overlay) — mas ainda assim SOME visualmente junto com
 * o resto por inatividade (classe "hidden", só opacity). A diferença é só
 * que aqui pointer-events continua "auto": sair do player precisa funcionar
 * sempre, mesmo com os controles escondidos — não devia exigir um primeiro
 * toque só pra "acordar" os controles antes de conseguir voltar.
 */
export function PlayerTopBar({
  hidden,
  title,
  onExit,
}: {
  hidden: boolean;
  title: string;
  onExit: () => void;
}) {
  return (
    <div className={`player-top${hidden ? " hidden" : ""}`}>
      <button onClick={onExit} aria-label="Voltar">
        <BackArrowIcon />
      </button>
      <div className="player-title">{title}</div>
    </div>
  );
}
