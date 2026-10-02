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
- `/accounts` CRUD ✅ (lista com `balance` atual e `forecastBalance` em `forecastDate`, padrão fim do mês; `?includeArchived=`; `PATCH { archived }` arquiva; `DELETE` só sem lançamentos, senão 409), `GET /accounts/:id/balance?date=` ✅
- `/cards` CRUD, `GET /cards/:id/limit`
- `/categories` CRUD ✅ (`?kind=&includeArchived=&includeSystem=`; subcategoria de um nível; técnicas só mudam nome/ícone/cor), `/tags` CRUD, `/contacts` CRUD, `/holidays` CRUD

## Lançamentos
- `GET /transactions?from=&to=&accountId=&cardId=&categoryId=&type=&status=&paymentMethod=&q=&tag=&cursor=&limit=` ✅ (data desc; `cardId` na Fase 3), `GET /transactions/:id` ✅
- `POST /transactions` ✅ (receita/despesa simples numa conta; Pix = `paymentMethod: "pix"` + `pixCounterparty`/`contactId`; `tagIds`)
- `PATCH /transactions/:id` ✅ (transferência: valor/data/descrição/status nas duas pontas; ajuste: só descrição/observações/tags), `DELETE /transactions/:id` ✅ (transferência apaga as duas pontas)
- `POST /transactions/:id/settle` ✅ (`{ amount?, date?, accountId? }`; data padrão: a prevista se já passou, senão hoje)
- `POST /transfers` ✅ (`{ fromAccountId, toAccountId, amount, date, status?, description?, notes? }` → `{ transferId, items }`)
- `POST /adjustments` ✅ (`{ accountId, realBalance, date? }` → `{ adjustment | null, balance }`)

Validações comuns: lançamento efetivado não pode ter data futura (`settled_in_future`); data antes do saldo inicial da conta é recusada (`date_before_initial_balance`); conta arquivada não recebe lançamento novo (`account_archived`); categoria tem que ser do mesmo tipo e não técnica. Erros de regra usam `{ error: { code, message } }` com códigos estáveis.

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
- `GET /dashboard?month=` ✅ (`balance`, `forecastBalance`/`forecastDate`, `income`/`expense` `{ settled, planned }`, `upcoming` (previstos vencidos e dos próximos 7 dias, até 10), `overdueCount`, `hasAccounts`)
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
