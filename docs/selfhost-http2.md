# HTTP/2 no self-host (por que .mkv toca no Vercel e não localmente)

## O problema

`next start` serve **HTTP/1.1 puro** (verificável: `curl -o /dev/null -w "%{http_version}" http://SEU-HOST:3000/api/health` responde `1.1`).
O Vercel serve **HTTP/2**. Essa é a diferença medida entre os dois ambientes —
mesmo código, mesmos arquivos.

Por que isso castiga `.mkv` e não `.mp4`:

- O navegador limita ~**6 conexões por origem** em HTTP/1.1. Cada range
  request ocupa uma conexão, e o streaming de vídeo segura a dele aberta.
- O índice do **Matroska (Cues) fica no FIM do arquivo**. Pra tocar ou
  buscar, o navegador precisa de um range request lá no final ao mesmo tempo
  que lê do começo.
- Em HTTP/2 isso é multiplexado numa conexão só — de graça.
- Em HTTP/1.1 esse request disputa as 6 conexões com o stream aberto e trava.
- Um **MP4 "faststart"** tem o índice (`moov`) no COMEÇO, então nunca precisa
  desse segundo request — por isso MP4 toca local e MKV não.

## Solução: Caddy na frente (HTTPS + HTTP/2, ~5 min)

Caddy é um executável único, sem dependências, com HTTP/2 ligado por padrão.

```powershell
winget install CaddyServer.Caddy
```

Crie `C:\flow-secrets\Caddyfile`:

```
ultra-allyson.local {
    tls internal
    reverse_proxy 127.0.0.1:3000
}
```

(troque `ultra-allyson.local` pelo hostname que você usa)

```powershell
# instala a CA local do Caddy no Windows (pra ele mesmo confiar no cert)
caddy trust

# roda
caddy run --config C:\flow-secrets\Caddyfile
```

Agora acesse `https://ultra-allyson.local` (sem `:3000`).

Pra virar serviço permanente, use o NSSM igual ao serviço `Flow`
(ver selfhost-windows.md), apontando pro `caddy.exe` com
`run --config C:\flow-secrets\Caddyfile`.

### Confiar no certificado nos outros aparelhos

`tls internal` usa uma CA local — cada aparelho precisa confiar nela:

- **iPhone/iPad**: exporte a CA (`C:\Users\<você>\AppData\Roaming\Caddy\pki\authorities\local\root.crt`),
  mande pro aparelho, instale e ative em Ajustes → Geral → Sobre →
  Certificados Confiáveis.
- **Samsung TV**: normalmente **não deixa** instalar CA própria. Pra TV, veja
  a alternativa abaixo.

## Alternativa sem mexer em certificado: Cloudflare Tunnel

Dá uma URL HTTPS real (certificado válido, HTTP/2, funciona em qualquer
aparelho inclusive a TV) sem abrir porta no roteador:

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

Contrapartida: o vídeo passa pela rede da Cloudflare (banda e termos de uso).

## Alternativa garantida, sem infraestrutura: converter os arquivos

Remuxar `.mkv` → `.mp4` (só troca o contêiner, sem reencodar — ver
`scripts/remux-mkv-to-mp4.ps1`) elimina o problema na raiz: MP4 faststart
não precisa do request no fim do arquivo, então toca bem até em HTTP/1.1.
