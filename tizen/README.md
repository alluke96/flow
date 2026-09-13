# App de TV (Samsung / Tizen)

O Flow empacotado como app nativo de TV. O app **inteiro** vai dentro do
`.wgt` e roda a partir de `file://` na própria TV; o PC continua sendo só o
servidor de dados e vídeo (as rotas `/api/*`).

## Por que assim (e não um iframe apontando pro PC)

A montagem anterior era uma casca que carregava `http://<ip-do-pc>:3000`
num `<iframe>` em tela cheia. Funcionava pra assistir, mas tinha um teto
que não dava pra furar: **`webapis` — a API nativa da Samsung, incluindo o
player `avplay` — só existe no documento de TOPO de um widget empacotado.**
Dentro do iframe, que é conteúdo de outra origem, ela simplesmente não
existe.

Isso importa porque o `<video>` HTML5 dessa TV tem um bug confirmado: ele
sabe que o arquivo é buscável o inteiro (`seekable` cobre tudo) mas nunca
chega a pedir os bytes de um trecho ainda não baixado quando o usuário
busca — só volta pro ponto anterior. É por isso que ±10s e "continuar
assistindo" não funcionavam na TV, e só nela. O AVPlay contorna isso
porque fala direto com o pipeline de mídia do aparelho.

A tentativa de ponte (o app no iframe mandando comandos por `postMessage`
pra casca, que chamaria o AVPlay) nunca entregou uma mensagem sequer nessa
TV. Junto disso, o iframe carregado também desenhava por cima de qualquer
elemento irmão da casca, ignorando `z-index` e até o próprio tamanho em
CSS — o que inviabilizava até depurar o problema. Com o app dentro do
widget, as duas coisas deixam de existir: não há fronteira pra atravessar,
e `webapis.avplay` está disponível direto no código do player (ver
`src/lib/tizen-player-bridge.ts`).

## Gerando o conteúdo do app

No PC, dentro do repositório:

```powershell
npm run build:tizen -- http://192.168.15.7:3000
```

O endereço é o do **PC que roda o self-host** — é pra ele que o app
instalado vai pedir catálogo, imagens, perfis e vídeo. Ele fica embutido no
build: se o IP do PC mudar, precisa gerar e reinstalar de novo (vale
reservar o IP no DHCP do roteador pra isso não acontecer).

O resultado sai em **`tizen/app/`**. Esse é o conteúdo do projeto do Tizen
Studio: `index.html` na raiz, junto com `_next/`, `avatars/` e os ícones.

O script cuida sozinho das partes que um export estático não suporta
(rotas de API, o proxy, e as rotas dinâmicas `/title/[id]` e `/watch/[id]`)
— ver `scripts/build-tizen.mjs`. Nada disso sai do lugar de verdade: ele
devolve tudo no fim, inclusive se o build falhar no meio.

## Instalando

1. Tizen Studio → File → New → Tizen Project → Template → TV → Web
   Application → Basic Project.
2. Copie **todo o conteúdo de `tizen/app/`** pra pasta do projeto,
   substituindo o `index.html` gerado pelo template. Mantenha o
   `config.xml` do template e o `icon.png` (ver abaixo).
3. Certificado: Certificate Manager → `+` → **Samsung** → **TV** (precisa
   da extensão "Samsung Certificate Extension" no Package Manager, e da TV
   conectada via `sdb`, porque o certificado é amarrado ao DUID dela).
4. Botão direito no projeto → Run As → Tizen Web Application.

Pra conectar a TV: Developer Mode ligado nela (Apps → segurar o ícone do
Smart Hub → Developer mode → On → IP do **PC**), e no PC:

```powershell
cd C:\tizen-studio\tools
.\sdb connect <ip-da-tv>
.\sdb devices
```

### config.xml

O `config.xml` do template já funciona. As duas linhas que valem a pena
conferir no `<tizen:setting>`:

- `hwkey-event="enable"` — faz o botão Return físico chegar como keydown
  (keyCode 10009), que o player já trata pra sair.
- `pointing-device-support="disable"` — desliga o cursor do Smart Remote,
  deixando o controle em modo D-pad (foco pulando de elemento em elemento).
  Em TVs 2015-2020 o padrão é "enable", por isso o cursor aparece sem essa
  linha; em 2021+ já vem desligado. Documentado em
  [Configuring Web Applications](https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html).

**Uma linha que provavelmente precisa ser adicionada**, agora que o app vai
dentro do widget: a política de segurança (CSP). Sem declarar nada, a TV
aplica a padrão dela, que pode bloquear script inline — e o Next embute o
estado inicial da página num `<script>` inline. Bloqueado ali, o JS nunca
roda e sobra só o HTML pré-renderizado: um spinner eterno, sem erro visível
em lugar nenhum. Copie do `config.xml` de referência daqui, trocando o IP
pelo do seu PC (o mesmo que você passa pro `npm run build:tizen`):

```xml
<tizen:content-security-policy>default-src 'self' data: blob: http://192.168.15.7:3000; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http://192.168.15.7:3000; media-src 'self' http://192.168.15.7:3000; connect-src 'self' http://192.168.15.7:3000</tizen:content-security-policy>
```

**A outra linha que passou a ser necessária** com o app dentro do widget:
o `<access>`. Antes quem falava com o PC era o `<iframe>` — uma navegação
do navegador, que não passa pela política de acesso do widget. Agora é o
próprio widget que busca catálogo, imagens, perfis e vídeo, e aí a origem
precisa estar declarada:

```xml
<access origin="http://192.168.15.7:3000" subdomains="false"/>
```

(Numa versão anterior deste README dizia pra NÃO declarar `<access>` —
aquilo valia pra montagem com iframe, em que o widget não fazia requisição
nenhuma. Se o validador reclamar de alguma coisa ao adicionar, é a
mensagem dele que manda, não este texto.)

O AVPlay não precisa de privilege: desde os modelos de 2015 a Samsung não
exige mais isso.

### Ícone

Use o `tizen/icon.png` (512x423, o tamanho que a Samsung usa na fileira de
apps). Tem também `icon-512.png`, quadrado, pra onde for pedido 1:1. Os
dois são o wordmark do site, renderizados a partir do mesmo arquivo de
fonte que o `next/font` gera no build — batem com a marca da web, não são
aproximação.

## Atualizando

Diferente da montagem antiga: agora **toda mudança no app exige gerar o
`tizen/app/` de novo e reinstalar o `.wgt`**. Um redeploy do self-host
sozinho só atualiza o servidor (API e vídeo), não o que está instalado na
TV. Esse é o preço de ter o app dentro do widget — e o que compra o acesso
ao player nativo.

## Depurando

Dentro do widget não há console alcançável: a TV não expõe DevTools e
`sdb dlog`/`dlogutil` não devolvem nada nela (parece bloqueado de fábrica,
mesmo com Developer Mode ligado). Duas saídas:

- **Overlay na tela** — 5 toques no número da versão (tela de perfis) liga
  um quadro de diagnóstico com os eventos de entrada, o estado do player e
  se o AVPlay está mesmo ativo. Agora ele aparece normalmente: sem iframe,
  nada desenha por cima dele.
- **Log no servidor** — o build injeta um `tizen-boot.js` que roda ANTES de
  tudo e reporta pro `flow.log` do PC: user agent da TV, qualquer erro de
  JavaScript (inclusive erro de sintaxe nos bundles, que mata o app antes
  de qualquer código nosso rodar), script que falhou ao carregar, violação
  de CSP, e um balanço 5s depois dizendo se a interface hidratou. É a única
  janela pra dentro do widget quando o app não sobe — foi ela que achou o
  `globalThis` faltando (ver abaixo). Além do log, esse mesmo arquivo
  define os globais que o Chromium 69 da TV não tem.
  ```powershell
  Get-Content C:\flow-secrets\flow.log -Wait -Tail 50 | Select-String tizen-debug
  ```

Pra conferir o modo de tela única sem instalar nada na TV, abra `/tv` no
navegador — é exatamente o mesmo componente que vai empacotado.

## O navegador da TV é antigo (Chromium 69)

O user agent do aparelho é `Tizen 5.5 ... Chrome/69.0.3497.106`. Duas
consequências que já morderam, as duas com o mesmo sintoma (carregamento
eterno, sem erro visível) e causas diferentes:

- **Sintaxe**: `?.`, `??` e `??=` são Chrome 80/85. Resolvido pelo
  `browserslist` no `package.json` (`chrome >= 63`), que faz o compilador
  baixar a sintaxe e o Next injetar polyfills.
- **Globais**: `globalThis` é Chrome 71 e o runtime do empacotador usa ele
  na primeira linha de CADA chunk; `queueMicrotask` é 71 e o React usa.
  Browserslist não cobre isso — ele baixa sintaxe, não define globais.
  Resolvido no `tizen-boot.js`, que roda antes de qualquer chunk.
- **CSS**: o navegador descarta calado a declaração que não entende — e,
  pior, a regra `@` inteira. Deu o app todo colado na borda da tela
  (`clamp()`/`min()`/`max()`, Chrome 79), perfis sem espaçamento (`gap` em
  flexbox é Chrome 84), foco invisível (`:focus-visible` é Chrome 86) e
  `<button>` cinza do sistema na lista de episódios — este último porque o
  Tailwind põe o reset dele dentro de `@layer` (Chrome 99), que some
  inteiro. Tudo isso está resolvido num bloco `@supports` só, no fim de
  `src/app/globals.css`, com o porquê de cada item.

  Fica o aviso pra quem for mexer lá: **não adianta escrever o valor antigo
  numa linha e o moderno na seguinte**. Parece o jeito certo (e é, em CSS
  escrito à mão), mas o minificador do build apaga a primeira por enxergar
  uma declaração morta, e o que chega na TV é só a que ela não entende.

Se um dia o app voltar a ficar num carregamento eterno depois de atualizar
dependência, o primeiro lugar pra olhar é o `flow.log`: o erro vem de lá
com nome e arquivo.

## Limitação conhecida

AVPlay não expõe volume por instância (é sempre o volume do sistema,
controlado pelo controle remoto físico) — os botões de volume/mudo do Flow
continuam na tela, mas não têm efeito real no áudio quando o player nativo
está ativo. É a API mesmo, não um bug.
