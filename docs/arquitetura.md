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
| Web | React 19 + Vite, `vite-plugin-pwa` (Workbox), TanStack Router + TanStack Query, Tailwind CSS v4 + shadcn/ui, react-hook-form, Recharts, date-fns, lucide-react |
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
- Cadastro só com código de convite (`invites`).
- Rate limit no login (`@fastify/rate-limit`).
- Front e API no **mesmo domínio** (API em `/api`), sem CORS.

## PWA
- Manifest com ícones, `display: standalone`, cor do tema.
- Service worker: cache do app shell (precache) e `StaleWhileRevalidate` para GETs da API, permitindo consultar offline.
- Lançamentos offline: fila no IndexedDB, reenviados ao reconectar (Fase 6+), com id gerado no cliente para idempotência.
- Push: VAPID, inscrição salva em `push_subscriptions`. No iPhone só funciona com o app instalado na tela inicial (iOS 16.4+).

## Jobs (pg-boss)
| Job | Quando |
|---|---|
| `recurrences.generate` | diário 02:00, mantém 12 meses gerados |
| `invoices.updateStatus` | diário 00:05 |
| `alerts.daily` | diário 08:00 |
| `debts.markLate` | diário 00:10 |
| `backup` | container separado, diário 03:00 |

## Desenvolvimento
Pré-requisitos: Node 22, pnpm 9+, Docker.
```
cp infra/.env.example .env
docker compose -f infra/docker-compose.dev.yml up -d   # só o Postgres, porta 5432 local
pnpm install
pnpm db:migrate && pnpm db:seed                        # categorias padrão, feriados, usuário de teste
pnpm dev                                               # api :3000, web :5173 (proxy /api -> 3000)
```

## Deploy no servidor do Samuel
O servidor já roda `cloudflared` com um túnel para outro site. O FinApp usa **o mesmo túnel**, com um subdomínio novo do domínio existente: **`financas.voleidraft.top`**:
1. No servidor: `git clone` do repositório, `cp infra/.env.example infra/.env` e preencher (senha do banco, `BETTER_AUTH_SECRET`, chaves VAPID, `APP_URL`).
2. `docker compose -f infra/docker-compose.yml up -d` (sobe `finapp-api`, `finapp-db`, `finapp-backup`).
3. Ligar o `finapp-api` à rede Docker do `cloudflared` existente (ou publicar `127.0.0.1:3000` se o cloudflared roda fora do Docker).
4. No painel Cloudflare Zero Trust → Tunnels → túnel existente → **Public Hostname** → adicionar `financas.voleidraft.top` → `http://finapp-api:3000` (ou `http://localhost:3000`). A Cloudflare cria o DNS e o certificado.
5. Opcional: Cloudflare Access na aplicação com login por código de e-mail para os e-mails permitidos.

Atualizar: `git pull && docker compose -f infra/docker-compose.yml up -d --build` (ou puxar imagem do GHCR). Migrações rodam automaticamente na subida da API.

Se no futuro comprar um domínio próprio, basta adicionar outro Public Hostname; nada no app muda além de `APP_URL`.

## Backup
- `pg_dump -Fc` diário, criptografado e enviado com `restic` para um destino externo (Backblaze B2, Google Drive via rclone, ou outro disco). Retenção 7 diários / 4 semanais / 12 mensais.
- Script `infra/backup/restore.sh` e teste de restauração documentado; rodar o teste uma vez por mês.

## Segurança
- Postgres sem porta publicada em produção.
- Segredos só no `.env` (fora do git). `.env.example` sem valores reais.
- Headers de segurança (`@fastify/helmet`), CSP.
- Toda consulta filtrada por `space_id` do usuário autenticado (testes de autorização obrigatórios por módulo).
- Repositório privado recomendado.
