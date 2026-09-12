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

## Atualizando

Mudança no Flow **não** exige reinstalar nada — a casca só aponta pra URL,
então um redeploy no self-host já aparece ao reabrir o app.

Só precisa gerar e instalar o `.wgt` de novo se mexer no `config.xml`, no
ícone, ou no `URL_FLOW`.

## Se o IP do PC mudar

O app abre no vazio. Reserve o IP no DHCP do roteador pra isso não
acontecer — é a única dependência frágil desta montagem.
