# API

REST em `/api`, JSON, autenticação por cookie de sessão. Recursos do espaço ficam em `/api/spaces/:spaceId/...`. Valores em centavos, datas `YYYY-MM-DD`. Erros: `{ error: { code, message, details? } }`. Listas paginadas por cursor (`?cursor=&limit=`). Documentação OpenAPI gerada em `/api/docs` (só em dev).

Cada endpoint tem schema Zod em `packages/shared`. Esta lista é o contrato planejado; ao implementar, mantenha esta página atualizada (✅ = implementado).

## Auth e usuário
- `POST /api/auth/*` (Better Auth: `sign-up/email` com `inviteCode`, `sign-in/email`, `sign-out`, `GET get-session`) ✅
- `GET /api/me` ✅ (usuário, espaços, espaço ativo); `PATCH /api/me`, `GET/PATCH /api/me/settings`
- `POST /api/invites` ✅ (`{ spaceId?, email?, expiresInDays? }`; para espaço, só o dono), `GET /api/invites` ✅

## Espaços
- `GET/POST /api/spaces`, `PATCH /api/spaces/:id`
- `GET/POST/DELETE /api/spaces/:id/members`

## Cadastros (prefixo `/api/spaces/:spaceId`)
- `/accounts` CRUD, `GET /accounts/:id/balance?date=`
- `/cards` CRUD, `GET /cards/:id/limit`
- `/categories` CRUD, `/tags` CRUD, `/contacts` CRUD, `/holidays` CRUD

## Lançamentos
- `GET /transactions?from=&to=&accountId=&cardId=&categoryId=&status=&q=&tag=`
- `POST /transactions` (receita/despesa simples, Pix)
- `PATCH /transactions/:id`, `DELETE /transactions/:id`
- `POST /transactions/:id/settle` (`{ amount?, date?, accountId? }`)
- `POST /transfers`
- `POST /adjustments`

## Recorrências
- `/recurrences` CRUD, `POST /recurrences/preview` (gera ocorrências sem salvar)
- `PATCH /recurrences/:id?from=YYYY-MM` (alterar a partir de um mês)

## Faturas e parcelamentos
- `GET /cards/:id/invoices?from=&to=`, `GET /invoices/:id` (com itens e total)
- `POST /invoices/:id/payments`, `PATCH /invoices/:id` (overrides de datas)
- `POST /installment-plans/preview`, `POST /installment-plans`, `GET /installment-plans?status=`
- `POST /installment-plans/:id/anticipate` (`{ count, discount? }`)
- `POST /installment-plans/:id/cancel`

## Dívidas
- `POST /debts/preview`, `/debts` CRUD, `GET /debts/:id` (painel + cronograma)
- `POST /debts/:id/installments/:n/pay` (`{ amount, date, accountId, discount? }`)
- `POST /debts/:id/amortize` (`{ amount, mode: reduce_term|reduce_installment }`)
- `POST /debts/:id/payoff`
- `PATCH /debts/:id/completion-date`
- `POST /debts/:id/phases/:phaseId/values` (valor do mês para fase variável)
- `GET/POST /index-values`

## Planejamento e relatórios
- `GET /dashboard?month=`
- `GET /projection?months=12`
- `GET /reports/by-category?from=&to=`, `/reports/monthly?from=&to=`, `/reports/net-worth`
- `/budgets` CRUD, `/goals` CRUD

## Racha (fora de espaço)
- `/api/split-groups` CRUD, `POST /api/split-groups/join/:code`
- `/api/split-groups/:id/expenses` CRUD
- `GET /api/split-groups/:id/balances?simplify=true`
- `POST /api/split-groups/:id/settlements`

## Notificações
- `POST/DELETE /api/push/subscriptions`, `GET /api/push/vapid-key`
- `GET /api/notifications`, `POST /api/notifications/:id/read`
- `GET/PATCH /api/notification-settings`

## Importação/exportação (V2)
- `POST /imports` (multipart OFX/CSV) → prévia, `POST /imports/:id/confirm`
- `GET /export?format=csv|xlsx|json`
