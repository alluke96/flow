# App de TV (Samsung / Tizen)

Casca que abre o Flow numa TV Samsung. Não tem lógica de produto nenhuma:
carrega `http://<ip-do-pc>:3000` num `<iframe>` em tela cheia.

## Por que iframe e não um redirect

A versão óbvia — `location.replace("http://ip:3000")` no `index.html` —
funciona, mas a TV sai do contexto do app e passa a tratar a página como
conteúdo de navegador. Duas consequências ruins:

1. Liga o **ponteiro do Smart Remote** (o cursor que anda de pixel em pixel)
   e ele engole as setas: o `tv-nav` nunca recebe um `ArrowDown`.
2. As configurações do `config.xml` (tecla Return, orientação, etc.) deixam
   de valer sobre a página.

Dentro do iframe o documento de cima continua sendo o app Tizen, então o
controle segue em modo D-pad e as teclas chegam no Flow normalmente.

Isso exige que o servidor permita ser enquadrado: o CSP em `src/proxy.ts`
manda `frame-ancestors 'self' file:` (a casca vive em `file://` na TV) e
não manda mais `X-Frame-Options`.

## Desligando o cursor do Smart Remote

Se o controle ainda aparecer como ponteiro (cursor andando de pixel em
pixel) em vez de foco pulando de elemento em elemento, falta um atributo no
`<tizen:setting>` do SEU `config.xml`:

```xml
<tizen:setting ... pointing-device-support="disable"/>
```

Em TVs 2015-2020 o padrão é "enable" (por isso o cursor aparece sem essa
linha); em 2021+ já vem desligado por padrão. Documentado em
[Configuring Web Applications](https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html).
Muda `config.xml` → precisa reinstalar o `.wgt` (ver "Atualizando" abaixo).

(Se você tem uma linha `<tizen:metadata key=".../use.pointer.mode" .../>`
de uma sugestão anterior nossa: pode apagar. Não é uma metadata real —
`tizen:metadata` aceita qualquer chave sem validar, então nunca deu erro,
só nunca fez efeito nenhum.)

## Instalando

1. Tizen Studio → File → New → Tizen Project → Template → TV → Web
   Application → Basic Project
2. Copie **apenas o `index.html`** daqui por cima do gerado. O `config.xml`
   do template já funciona como está — o `config.xml` daqui é referência,
   não é pra copiar: declarar privilege de internet, `<access>` ou features
   de tela que o perfil `tv-samsung` não conhece faz o validador recusar o
   projeto e o launch nem começa. A única linha que vale adicionar ao SEU
   `config.xml` é o `pointing-device-support="disable"` acima.
3. Ajuste `URL_FLOW` no topo do `index.html` pro IP do PC.
4. Copie o `icon.png` daqui pra raiz do projeto (512x423, que é o tamanho
   que a Samsung usa na fileira de apps). Tem também `icon-512.png`, a
   versão quadrada, pra onde for pedido 1:1.

   Os dois são o wordmark do site: Space Grotesk 700, `letter-spacing`
   -0.04em, `#f5f5f7` sobre `#0a0a0b` — os mesmos valores de `.brand` em
   `globals.css` e dos tokens `--text`/`--bg`. Foram renderizados no
   Chromium a partir do arquivo de fonte que o `next/font` gera no build,
   então batem com a marca da web, não são uma aproximação.
5. Certificado: Certificate Manager → `+` → **Samsung** → **TV** (precisa da
   extensão "Samsung Certificate Extension" no Package Manager, e da TV
   conectada via `sdb`, porque o certificado é amarrado ao DUID dela).
6. Botão direito no projeto → Run As → Tizen Web Application.

Depois de instalado, o app fica na TV: Home → Apps → final da lista.

## Player nativo (AVPlay) — corrige a busca (±10s / continuar assistindo)

O `<video>` HTML5 desta TV tem um bug confirmado: ele sabe que o arquivo é
buscável o inteiro (`seekable` cobre tudo), mas nunca chega a pedir os bytes
de um trecho ainda não baixado quando o usuário busca — só volta pro ponto
anterior, tanto num ±10s quanto na retomada de "continuar assistindo".

Por isso o `index.html` desta casca também abre e controla o vídeo pelo
**AVPlay** (`webapis.avplay`) — o motor de vídeo nativo da própria Samsung,
o mesmo que apps como Netflix usam nessas TVs. Ele fala direto com o
pipeline de mídia do aparelho, contornando esse bug do WebKit por completo.

Não precisa de nenhuma privilege nova no `config.xml`: desde os modelos de
2015 a Samsung não exige mais isso pra apps web usarem AVPlay.

Como funciona, resumido: `webapis` só existe no documento de TOPO do widget
(esta casca) — nunca dentro do iframe, que é conteúdo de outra origem. O
Flow, rodando no iframe, detecta a casca sozinho (um handshake por
`postMessage` ao montar o player) e, se ela responder, manda comandos
(abrir/tocar/pausar/buscar/redimensionar) em vez de usar um `<video>` — a
casca é quem de fato chama `webapis.avplay` e devolve o estado (tempo,
duração, buffering...) do mesmo jeito. Em qualquer lugar que não seja esta
casca (PC, celular, navegador web, ou uma versão antiga do `.wgt` sem esse
bloco), o handshake nunca é respondido e o Flow cai de volta pro `<video>`
normal sozinho — nada muda fora da TV.

**Limitação conhecida:** AVPlay não expõe volume por instância (é sempre o
volume do sistema, controlado pelo controle remoto físico) — os botões de
volume/mudo do Flow continuam na tela, mas não têm efeito real no áudio
quando o player nativo está ativo. Não é um bug, é a API mesmo.

Como o vídeo do AVPlay é desenhado NUM PLANO DE HARDWARE atrás da página
inteira (não dentro do DOM), tanto esta casca quanto o app dentro do
iframe ficam com o fundo transparente enquanto ele toca — sem isso, a cor
de fundo normal do site tampa o vídeo por completo, sem erro nenhum.

## Atualizando

Mudança no Flow (o app dentro do iframe) **não** exige reinstalar nada — a
casca só aponta pra URL, então um redeploy no self-host já aparece ao
reabrir o app.

Só precisa gerar e instalar o `.wgt` de novo se mexer no `config.xml`, no
ícone, no `URL_FLOW`, **ou no `index.html`** (é o caso da ponte AVPlay
acima — se você já tinha o app instalado antes dela existir, precisa
reinstalar o `.wgt` uma vez pra ganhar o `index.html` novo).

## Se o IP do PC mudar

O app abre no vazio. Reserve o IP no DHCP do roteador pra isso não
acontecer — é a única dependência frágil desta montagem.
