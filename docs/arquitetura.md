# Arquitetura

## Visão geral
```
Celular/PC (PWA) ──HTTPS──> Cloudflare ──túnel──> cloudflared (já existente no servidor)
                                                      │
                                                      ▼
                                   finapp-api :3000 (Fastify, serve também o front estático)
                                                      │ rede docker interna
                                                      ▼
                                   finapp-db (PostgreSQL 17, sem porta publicada)
                                   finapp-backup (pg_dump + restic, diário)
```

## Stack
| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript (strict) em tudo, Node.js 22 LTS, pnpm workspaces |
| Núcleo | `packages/core`: funções puras, sem I/O. Testes com Vitest |
| Contratos | `packages/shared`: schemas Zod e tipos (requests/responses) |
| API | Fastify 5, `fastify-type-provider-zod`, Drizzle ORM + drizzle-kit, Better Auth, pg-boss, `web-push`, pino (logs) |
| Web | React 19 + Vite, `vite-plugin-pwa` (Workbox), React Router (modo data) + TanStack Query, CSS próprio com tokens (`apps/web/src/styles`), Manrope via `@fontsource-variable`, lucide-react; gráficos com Recharts quando chegarem (ADR-014) |
| Testes | Vitest (core, api com Postgres de teste via Testcontainers ou banco do compose), Playwright (E2E dos fluxos críticos) |
| Qualidade | ESLint (typescript-eslint), Prettier, tsc |
| CI | GitHub Actions: lint, typecheck, test, build da imagem Docker (GHCR) |

## Estrutura de pastas
```
finapp/
├── AGENTS.md, CLAUDE.md, README.md
├── docs/
├── packages/
│   ├── core/src/{money,dates,holidays,recurrence,cards,installments,debts,projection,splits}/
│   └── shared/src/schemas/
├── apps/
│   ├── api/src/{db/schema,db/migrations,modules/<feature>/{routes,service,repo}.ts,jobs,auth,plugins}
│   └── web/src/{routes,features/<feature>,components/ui,lib,styles}
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   ├── backup/
│   └── .env.example
└── .github/workflows/ci.yml
```

Cada funcionalidade da API é um módulo (`modules/cards`, `modules/debts`...) com rotas finas, serviço (orquestra e chama o core) e repositório (Drizzle). Toda rota passa pelo plugin de autenticação e pelo `requireSpaceMember(space_id)`.

## Autenticação
- Better Auth com e-mail/senha (V1), passkeys e 2FA (V2). Sessão em cookie `HttpOnly; Secure; SameSite=Lax`.
- Cadastro só com código de convite (`invites`): `POST /api/auth/sign-up/email` com `inviteCode`. Ao criar o usuário nascem o espaço **Pessoal**, as configurações e, se o convite for de um espaço compartilhado, a participação nele.
- Primeiro acesso / convite pelo servidor: `docker exec finapp-api node server.cjs --create-invite [dias]` (produção) ou `pnpm --filter @finapp/api invite:create [dias]` (dev). Depois, convites pelo app (`POST /api/invites`).
- A API aplica as migrações pendentes ao subir (desligar com `RUN_MIGRATIONS=false`) e depois o seed idempotente: feriados nacionais do ano anterior até +30 anos e categorias padrão dos espaços que não têm (desligar com `RUN_SEED=false`; manual: `pnpm db:seed`).
- Rate limit do próprio Better Auth em produção (5 tentativas/min em login e cadastro), IP pelo `cf-connecting-ip`.
- Front e API no **mesmo domínio** (API em `/api`), sem CORS.

## PWA
- Manifest com ícones, `display: standalone`, cor do tema.
- Service worker: cache do app shell (precache) e `StaleWhileRevalidate` para GETs da API, permitindo consultar offline.
- Lançamentos offline: fila no IndexedDB, reenviados ao reconectar (Fase 6+), com id gerado no cliente para idempotência.
- Push: VAPID, inscrição salva em `push_subscriptions`. No iPhone só funciona com o app instalado na tela inicial (iOS 16.4+).

## Jobs (pg-boss)
pg-boss no mesmo Postgres (schema `pgboss`), iniciado pela API (`apps/api/src/jobs`); desligar com `RUN_JOBS=false`. Os jobs só chamam serviços idempotentes.

| Job | Quando |
|---|---|
| `recurrences-generate` ✅ | diário 02:00 (America/Sao_Paulo, `missed: once`), mantém 12 meses gerados; também roda na subida da API |
| `invoices.updateStatus` | diário 00:05 |
| `alerts.daily` | diário 08:00 |
| `debts.markLate` | diário 00:10 |
| `backup` | container separado, diário 03:00 |

## Desenvolvimento
Pré-requisitos: Node 22 (no servidor: via `fnm`), pnpm (via `corepack enable`, versão fixada em `packageManager`), Docker.
```
docker compose -f infra/docker-compose.dev.yml up -d   # só o Postgres (finapp-dev-db), 127.0.0.1:5433
pnpm install
pnpm db:migrate && pnpm db:seed                        # feriados nacionais e categorias padrão (idempotente)
pnpm dev                                               # api :3001, web :5174 (proxy /api -> 3001)
```
Portas escolhidas para não colidir com outros projetos do servidor (3000 = voleidraft, 5173 = centralsuporte, 5432 reservado). Ver ADR-012.

Build: `pnpm build` gera `apps/web/dist` e `apps/api/dist/server.cjs` (bundle único via tsup, inclui os pacotes do workspace e as dependências). A imagem (`infra/Dockerfile`) roda só esse arquivo e serve o front de `WEB_DIST`; rotas fora de `/api` caem no `index.html` (SPA).

## Deploy no servidor do Samuel
O servidor já roda `cloudflared` com um túnel para outro site. O FinApp usa **o mesmo túnel**, com um subdomínio novo do domínio existente: **`financas.voleidraft.top`**:
O `cloudflared` do servidor roda **no host, como serviço systemd**, com túnel **gerenciado localmente** (`/etc/cloudflared/config.yml` com regras `ingress`; voleidraft.top → `http://localhost:3000`). Por isso o painel da Cloudflare **não** serve para adicionar o hostname: a mudança é no arquivo.
1. No servidor (repositório em `/srv/finapp`): `cp infra/.env.example infra/.env` e preencher (senha do banco, `BETTER_AUTH_SECRET`, chaves VAPID, `APP_URL`).
2. `docker compose -f infra/docker-compose.yml up -d --build` (projeto `finapp-prod`: `finapp-api`, `finapp-db`; depois `finapp-backup`). A API fica em `127.0.0.1:3010` (só loopback).
3. Automático: `sudo bash /srv/finapp/infra/cloudflared/add-financas-hostname.sh` (faz backup, insere, valida, reinicia e testa; os passos 3–5 abaixo são o equivalente manual). Manual: em `/etc/cloudflared/config.yml` (precisa de sudo), adicionar **antes** da regra final `http_status:404`:
   ```yaml
   - hostname: "financas.voleidraft.top"
     service: http://localhost:3010
   ```
   Validar com `cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate`.
4. Criar o DNS: `cloudflared tunnel route dns <id-do-túnel> financas.voleidraft.top` (precisa do `cert.pem` de login; ou criar no painel um CNAME `financas` → `<id-do-túnel>.cfargotunnel.com`, com proxy ligado).
5. Recarregar o túnel: `sudo systemctl restart cloudflared` (o voleidraft.top fica fora do ar por alguns segundos; fazer com aprovação do Samuel).
5. Opcional: Cloudflare Access na aplicação com login por código de e-mail para os e-mails permitidos.

Atualizar: `git pull && docker compose -f infra/docker-compose.yml up -d --build` (ou puxar imagem do GHCR). Migrações rodam automaticamente na subida da API.

Se no futuro comprar um domínio próprio, basta adicionar outro Public Hostname; nada no app muda além de `APP_URL`.

## Backup
- Container `finapp-backup` (imagem `infra/backup/`: postgres:17-alpine + restic + rclone, cron do busybox). Todo dia às 03:00 (`BACKUP_CRON`, fuso America/Sao_Paulo) faz `pg_dump -Fc` do `finapp-db` direto para o restic (snapshot com tag `finapp-db`, arquivo `finapp.dump`) e aplica a retenção 7 diários / 4 semanais / 12 mensais com `forget --prune`.
- Repositório restic criptografado com `RESTIC_PASSWORD` (no `infra/.env`; **guarde uma cópia fora do servidor**, sem ela o backup é ilegível). O container cria o repositório na primeira subida.
- Destino padrão: local, em `/srv/finapp-backups/restic` (`BACKUP_LOCAL_DIR`), fora do checkout do git. **Ainda falta o destino externo (offsite).**
- Trocar para destino externo é só `.env`, sem mudar código: `RESTIC_REPOSITORY=b2:<bucket>:finapp` com `B2_ACCOUNT_ID`/`B2_ACCOUNT_KEY`, ou `RESTIC_REPOSITORY=rclone:<remoto>:finapp` com as variáveis `RCLONE_CONFIG_<REMOTO>_*` (geradas pelo `rclone config`), ou qualquer backend do restic (s3, sftp...). Depois: `docker compose -f infra/docker-compose.yml up -d backup`.
- Comandos úteis:
  - backup agora: `docker exec finapp-backup sh -c '. /etc/backup.env && backup.sh'`
  - listar: `docker exec finapp-backup restic snapshots`
  - teste de restauração (Postgres descartável, não toca na produção): `bash infra/backup/restore.sh [id|latest]`. Rodar uma vez por mês.
- Restaurar **por cima da produção** (perda real de dados; com aprovação do Samuel):
  ```
  docker compose -f infra/docker-compose.yml stop api
  docker exec finapp-backup restic dump <id|latest> finapp.dump \
    | docker exec -i finapp-db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  docker compose -f infra/docker-compose.yml start api
  ```

## Segurança
- Postgres sem porta publicada em produção.
- Segredos só no `.env` (fora do git). `.env.example` sem valores reais.
- Headers de segurança (`@fastify/helmet`), CSP.
- Toda consulta filtrada por `space_id` do usuário autenticado (testes de autorização obrigatórios por módulo).
- Repositório privado recomendado.
