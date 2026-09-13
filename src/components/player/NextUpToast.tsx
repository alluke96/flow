/**
 * Canto inferior direito, discreto (não bloqueia nada por baixo — diferente
 * do antigo modal de "fim do vídeo", que cobria a tela inteira e travava
 * até o botão de voltar). Só aparece com próximo episódio disponível;
 * cancelar ou dar replay já limpa o estado (ver useNextEpisodeCountdown).
 */
export function NextUpToast({ secondsLeft, onCancel }: { secondsLeft: number; onCancel: () => void }) {
  return (
    <div className="next-up-toast">
      <span>Iniciando o próximo em {secondsLeft}…</span>
      <button onClick={onCancel}>Cancelar</button>
    </div>
  );
}
