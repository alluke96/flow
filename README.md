# Flow — Streaming

Plataforma de streaming estilo Netflix (Next.js + TypeScript + Tailwind CSS),
com catálogo de filmes/séries, seleção de perfis locais (sem login), player
customizado com Range Requests de verdade, e um backend pronto pra ler o
catálogo direto do Google Drive.

**Estado atual:** roda 100% com um catálogo **mock** (6 títulos fictícios,
pôsteres/banners gerados, um vídeo de amostra livre de direitos). Não tem
nenhuma credencial configurada ainda — veja [Conectar o Google Drive
real](#conectar-o-google-drive-real) pra trocar isso sem tocar em código.

## Rodando localmente

```bash
npm install
npm run dev
```

Abra http://localhost:3000 — a primeira tela é a seleção de perfil.

```bash
npm run build && npm start   # build de produção
npm run lint                 # eslint
```

## Deploy (Vercel)

1. Importe este repositório na Vercel (ou `vercel --prod` pela CLI).
2. Nenhuma variável de ambiente é obrigatória pro primeiro deploy — o app
   sobe funcionando de ponta a ponta (perfil → catálogo → player) com o
   catálogo mock.
3. Depois do deploy, defina `NEXT_PUBLIC_SITE_ORIGIN` com a URL final (ex:
   `https://flow.vercel.app`) em Project Settings → Environment Variables e
   faça um redeploy — isso aperta a checagem de CORS em `/api/*` (ver
   `src/proxy.ts`). Sem essa variável o app funciona igual, só com CORS mais
   permissivo.

## Conectar o Google Drive real

O app já sabe ler um catálogo real do Google Drive — só falta a credencial.
Sem ela, ele usa o catálogo mock automaticamente (ver
`src/lib/catalog-source/index.ts`).

1. **Crie uma Service Account** no Google Cloud Console (IAM & Admin →
   Service Accounts) e gere uma chave em JSON.
2. **Compartilhe a pasta raiz do catálogo** no Google Drive com o e-mail da
   service account (`...@...iam.gserviceaccount.com`), permissão de leitura.
3. **Configure duas variáveis de ambiente** (local: `.env.local`; produção:
   Vercel → Environment Variables — veja `.env.example`):
   - `GOOGLE_SERVICE_ACCOUNT_KEY`: o JSON da chave inteiro, como string (ou
     em base64, se o provedor lidar mal com newlines).
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID`: o ID da pasta raiz (trecho depois de
     `/folders/` na URL da pasta).
4. Redeploy. Pronto — nenhuma rota, componente ou tela muda; o app passa a
   servir o catálogo real automaticamente.

### Estrutura de pastas esperada no Drive

```
Catálogo/
├── Nome do Filme (2023)/
│   ├── capa.jpg            → pôster vertical (2:3)
│   ├── banner.jpg          → imagem widescreen (16:9)
│   ├── info.json           → metadados (opcional, ver abaixo)
│   └── filme.mp4
└── Nome da Série/
    ├── capa.jpg
    ├── banner.jpg
    ├── info.json
    ├── Temporada 01/
    │   ├── 01 - Nome do Episódio.mp4
    │   └── 02 - Nome do Episódio.mp4
    └── Temporada 02/
        └── 01 - Nome do Episódio.mp4
```

- Pasta de filme/série = título exibido; `(2023)` no nome é opcional.
- `Temporada NN` com dois dígitos.
- Episódio: `NN - Nome do Episódio.mp4` (dois dígitos + " - " + nome).
- Pôster sempre `capa.{jpg,png,webp}`; banner sempre `banner.{jpg,png,webp}`.
- `info.json` (opcional) sobrescreve os metadados parseados do nome da pasta:

  ```json
  {
    "titulo": "Nome do Filme",
    "titulo_original": "Original Title",
    "ano": 2023,
    "genero": ["Ficção Científica", "Drama"],
    "sinopse": "Resumo curto do enredo.",
    "classificacao_indicativa": "14",
    "duracao_minutos": 118,
    "elenco": ["Ator Um", "Ator Dois"],
    "diretor": "Nome do Diretor",
    "tipo": "filme"
  }
  ```

O parser está em `src/lib/drive/scan.ts`. O índice construído a partir da
árvore de pastas é cacheado em memória por 5 minutos
(`src/lib/catalog-source/drive.ts`) pra não estourar a cota da API do Drive.

## Arquitetura

```
src/
  app/
    page.tsx                 seleção de perfil ("/")
    browse/                  catálogo (hero + carrosséis)
    title/[id]/               detalhe (sinopse, temporadas/episódios)
    watch/[id]/                player
    api/
      catalog/                GET → lista de títulos
      title/[id]/              GET → detalhe de um título
      image/[id]/[kind]/        GET → pôster/banner (proxy, nunca link direto do Drive)
      stream/[id]/              GET → vídeo (proxy com Range Requests reais)
  lib/
    catalog-source/           contrato único (mock ⇄ Drive) — ver abaixo
    drive/                    cliente + scanner do Google Drive
    avatars.ts                allowlist de avatares (galeria fixa)
    validation.ts              zod: formato de IDs, sanitização de nome de perfil
    rate-limit.ts, cache.ts    utilitários em memória (ver comentários nos arquivos)
  context/
    profile-context.tsx        perfis locais (localStorage), isolados atrás de um contexto
  proxy.ts                     headers de segurança, CSP com nonce, CORS, rate limiting
```

**Por que `catalog-source`?** `src/lib/catalog-source/index.ts` decide, numa
função só, se usa `mock.ts` ou `drive.ts` — com base em que variáveis de
ambiente existem. Toda rota de API e toda tela fala só com essa interface
(`CatalogSource`), então trocar a fonte de dados nunca exige tocar em UI.

**Por que perfis em Context + localStorage?** Não há login (spec do
produto). A lógica fica isolada em `ProfileProvider` pra que, se autenticação
de verdade for adicionada no futuro, só a persistência troque (localStorage →
API), sem reescrever telas. Perfis não são uma fronteira de segurança real —
é só conveniência de UX, como no Netflix antes de "entrar" numa conta.

## Segurança

- **IDOR**: `/api/stream` e `/api/image` nunca repassam um ID de arquivo do
  Drive vindo do cliente — `titleId`/`episodeId` são validados contra o
  índice do catálogo (`CatalogSource`) antes de qualquer chamada ao Drive.
- **Validação de entrada**: zod em `src/lib/validation.ts` (formato de IDs,
  nome de perfil sem `<`/`>`); avatares validados contra uma allowlist fixa
  (`src/lib/avatars.ts`) — nunca uma URL arbitrária.
- **CSP com nonce** (`src/proxy.ts` + `await connection()` no layout raiz):
  `script-src` travado a `'self'` + nonce por request + `strict-dynamic`;
  também `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`.
- **CORS restrito** em `/api/*` (via `NEXT_PUBLIC_SITE_ORIGIN`) e **rate
  limiting** por IP, com foco em `/api/stream` (ver `src/lib/rate-limit.ts` —
  em memória; para múltiplas regiões, trocar por um backend compartilhado
  mantendo a mesma assinatura).
- **Credenciais nunca chegam ao frontend**: `GOOGLE_SERVICE_ACCOUNT_KEY` só é
  lida em `src/lib/drive/client.ts`, do lado do servidor.
- **Auth pluggável**: `src/lib/auth.ts` já existe como middleware "vazio" —
  hoje libera tudo (não há contas de usuário), mas é o ponto de entrada
  pronto pra JWT/sessão real no futuro.

## Limitações conhecidas / próximos passos

- Cache de catálogo e rate limiting são em memória (por instância) — ótimo
  para uso pessoal/pequena escala; para multi-região, trocar por Redis/KV.
- Sem miniaturas por episódio (usa o banner do título como thumb) — dá pra
  ler de `Temporada NN/capa-episodio.jpg` se quiser adicionar.
- Sem testes automatizados ainda.
