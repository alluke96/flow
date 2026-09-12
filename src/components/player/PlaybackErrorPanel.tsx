import type { PlaybackErrorDetail } from "./types";

/**
 * Navegador não conseguiu decodificar/abrir o arquivo (contêiner não
 * suportado, arquivo corrompido, MAS TAMBÉM uma resposta de erro HTTP no
 * lugar dos bytes do vídeo — ex: um 403/429/500 do nosso próprio servidor).
 * `detail` guarda o MediaError de verdade (ver onError no VideoPlayer) pra
 * não esconder qual dessas causas foi — sem isso, QUALQUER falha mostrava a
 * mesma mensagem genérica de ".mkv não compatível".
 */
export function PlaybackErrorPanel({ detail }: { detail: PlaybackErrorDetail | null }) {
  return (
    <div className="player-center">
      <div className="player-error">
        <p>Não foi possível reproduzir este vídeo.</p>
        <p className="player-error-hint">
          {detail?.code === 2
            ? // MEDIA_ERR_NETWORK: o navegador NÃO recebeu o arquivo de
              // vídeo de verdade — algo entre ele e o servidor falhou
              // (conexão caiu, CORS bloqueou, o servidor respondeu com erro
              // em vez dos bytes do vídeo). Não é o formato.
              "Falha de rede ao carregar o vídeo — não chegou a baixar o suficiente pra tocar. Verifique a conexão com o servidor e tente de novo."
            : detail?.code === 3
              ? // MEDIA_ERR_DECODE: os bytes chegaram, mas o navegador não
                // conseguiu decodificá-los (arquivo corrompido, ou um codec
                // dentro do contêiner que ele não suporta).
                "O navegador recebeu o arquivo mas não conseguiu decodificá-lo — o codec dentro dele pode não ser suportado, ou o arquivo está corrompido."
              : "O formato do arquivo pode não ser compatível com o navegador (ex: .mkv não toca em Chrome/Safari — prefira .mp4 com vídeo H.264 e áudio AAC)."}
        </p>
        {detail && (
          <p className="player-error-code">
            Detalhe técnico: código {detail.code ?? "?"} — {detail.message}
          </p>
        )}
      </div>
    </div>
  );
}
