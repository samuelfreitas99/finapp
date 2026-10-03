# API

REST em `/api`, JSON, autenticação por cookie de sessão. Recursos do espaço ficam em `/api/spaces/:spaceId/...`. Valores em centavos, datas `YYYY-MM-DD`. Erros: `{ error: { code, message, details? } }`. Listas paginadas por cursor (`?cursor=&limit=`). Documentação OpenAPI gerada em `/api/docs` (só em dev).

Cada endpoint tem schema Zod em `packages/shared`. Esta lista é o contrato planejado; ao implementar, mantenha esta página atualizada (✅ = implementado).

## Auth e usuário
- `POST /api/auth/*` (Better Auth: `sign-up/email` com `inviteCode`, `sign-in/email`, `sign-out`, `GET get-session`) ✅
- `GET /api/me` ✅ (usuário, espaços, espaço ativo); `PATCH /api/me`, `GET/PATCH /api/me/settings`
- `POST /api/invites` ✅ (`{ spaceId?, email?, expiresInDays? }`; para espaço, só o dono), `GET /api/invites` ✅

## Espaços
- `POST /api/spaces` ✅ (`{ name }`; cria compartilhado, você é dono), `PATCH /api/spaces/:id` ✅ (dono; só compartilhado), `PUT /api/me/active-space` ✅ (`{ spaceId }`)
- `GET /api/spaces/:id/members` ✅, `DELETE /api/spaces/:id/members/:userId` ✅ (dono remove; o próprio membro sai; o dono não)
- `POST /api/invites/accept` ✅ (`{ code }`; só convite de espaço, e-mail conferido se o convite tiver)
- `GET /api/consolidated?month=` ✅ (todos os espaços do usuário: por espaço e total de saldo, previsto, receitas e despesas efetivadas)

## Cadastros (prefixo `/api/spaces/:spaceId`)
- `/accounts` CRUD ✅ (lista com `balance` atual e `forecastBalance` em `forecastDate`, padrão fim do mês; `?includeArchived=`; `PATCH { archived }` arquiva; `DELETE` só sem lançamentos, senão 409), `GET /accounts/:id/balance?date=` ✅
- `/cards` CRUD ✅ (cada cartão traz `availableLimit`, `bestPurchaseDay` e `currentInvoice`; mudar fechamento/vencimento recalcula as faturas ainda abertas sem override; `DELETE` só sem lançamentos, senão 409), `GET /cards/:id/limit` ✅
- `/categories` CRUD ✅ (`?kind=&includeArchived=&includeSystem=`; subcategoria de um nível; técnicas só mudam nome/ícone/cor), `/tags` CRUD, `/contacts` CRUD, `/holidays` CRUD

## Lançamentos
- `GET /transactions?from=&to=&accountId=&cardId=&categoryId=&type=&status=&paymentMethod=&q=&tag=&cursor=&limit=` ✅ (data desc), `GET /transactions/:id` ✅
- `POST /transactions` ✅ (receita/despesa simples numa conta; Pix = `paymentMethod: "pix"` + `pixCounterparty`/`contactId`; `tagIds`)
- `PATCH /transactions/:id` ✅ (transferência: valor/data/descrição/status nas duas pontas; ajuste: só descrição/observações/tags), `DELETE /transactions/:id` ✅ (transferência apaga as duas pontas)
- `POST /transactions/:id/settle` ✅ (`{ amount?, date?, accountId? }`; data padrão: a prevista se já passou, senão hoje)
- `POST /transfers` ✅ (`{ fromAccountId, toAccountId, amount, date, status?, description?, notes? }` → `{ transferId, items }`)
- `POST /adjustments` ✅ (`{ accountId, realBalance, date? }` → `{ adjustment | null, balance }`)

Validações comuns: lançamento efetivado não pode ter data futura (`settled_in_future`); data antes do saldo inicial da conta é recusada (`date_before_initial_balance`); conta arquivada não recebe lançamento novo (`account_archived`); categoria tem que ser do mesmo tipo e não técnica. Erros de regra usam `{ error: { code, message } }` com códigos estáveis.

## Recorrências
- `POST /recurrences/preview?months=12` ✅ (gera ocorrências sem salvar; mesmo corpo do POST)
- `POST /recurrences` ✅ (`{ type, description, amount, frequency, interval?, dayRule | parts, adjust?, startDate, endDate?, accountId | cardId, categoryId?, paymentMethod?, variableAmount? }`; gera os previstos dos próximos 12 meses, a partir do mês atual), `GET /recurrences` ✅ (ativas, com as 3 próximas ocorrências), `GET /recurrences/:id` ✅
- `PATCH /recurrences/:id?from=YYYY-MM` ✅ (valor/regra valem a partir do mês, padrão o atual: encerra a atual no mês anterior e cria uma nova; se a recorrência ainda não começou, muda no lugar. Descrição/categoria mudam nos previstos não editados)
- `DELETE /recurrences/:id` ✅ (encerra; apaga os previstos futuros não editados)
- `POST /recurrences/generate` ✅ (estende a janela; o job diário faz o mesmo)
- Editar um lançamento gerado marca `detached` (a recorrência não mexe mais nele); confirmar com valor real tira o `estimated`.

## Faturas e parcelamentos
- Faturas são endereçadas pelo **mês de vencimento** e criadas na hora em que precisam existir:
  - `GET /cards/:id/invoices?from=YYYY-MM&to=YYYY-MM` ✅ (padrão: últimos 6 meses até o mês seguinte ao atual; mais recente primeiro; `items`, `carried` (saldo anterior), `total`, `paid`, `remaining`, `status`)
  - `GET /cards/:id/invoices/:month` ✅ (resumo + `entries` + `payments`)
  - `PATCH /cards/:id/invoices/:month` ✅ (`{ closingDateOverride?, dueDateOverride? }`; compras avulsas das faturas vizinhas sem pagamento são reposicionadas)
  - `POST /cards/:id/invoices/:month/payments` ✅ (`{ accountId?, amount?, date? }`, padrões: conta do cartão, o que falta, hoje; cria a despesa "Fatura <cartão> <mês>" na conta com a categoria técnica `invoice_payment`)
  - `DELETE /cards/:id/invoices/:month/payments/:paymentId` ✅ (excluir o lançamento do pagamento também desfaz o pagamento)
- Compra no cartão = `POST /transactions` com `cardId` (sem `accountId`): despesa é compra, receita é estorno; a fatura sai da data. Editar a data de um item avulso troca a fatura; parcelas não mudam de fatura pela data.
- `POST /installment-plans/preview` ✅ e `POST /installment-plans` ✅ (`{ description, cardId | accountId, totalAmount | installmentAmount, installments, firstDate, firstDueDate? (obrigatório fora do cartão), adjust?, startInstallment?, categoryId?, interestAmount? }`; cria uma parcela por lançamento `"<descrição> (k/N)"`: no cartão, uma por fatura; fora dele, previstas na conta)
- `GET /installment-plans?status=&cardId=` ✅ e `GET /installment-plans/:id` ✅ (painel RN 5.6: `summary`, `next`, status `active`/`finished`/`cancelled`; o detalhe traz as parcelas)
- `POST /installment-plans/:id/anticipate` ✅ (`{ count, discount?: { amount } | { monthlyRate } }`, só no cartão; parcelas movidas ganham `anticipated`, desconto vira estorno na fatura aberta)
- `POST /installment-plans/:id/cancel` ✅ (`{ refundBilled? }`; RN 5.4)
- Parcelas não são editadas (valor/data/conta) nem excluídas sozinhas: `installment_locked`.

## Dívidas
- `POST /debts/preview` ✅ (cronograma + painel sem gravar), `POST /debts` ✅ (`{ name, direction?, kind, contactId?, institution?, principal?, paymentAccountId | paymentCardId, completionDate?, assetValue?, notes?, paidInstallments?, phases: [{ name, system, firstDueDate, installments?, installmentAmount | total, principal, rateMonthly | rateAnnual, index?, values?, lastMonth?, endsAtCompletion?, startsAfterCompletion?, payments? }] }`; `moneyAccountId`/`moneyDate` lançam o valor recebido (devo) ou emprestado (me devem) na conta, fora dos relatórios; `card_loan` exige `paymentCardId`; `third_party_card` não aceita cartão; cria as parcelas e os lançamentos previstos de cada parcela pendente na conta (despesa se devo, receita se me devem) ou como itens das faturas do cartão)
- `GET /debts` ✅ (com painel e próxima parcela), `GET /debts/:id` ✅ (painel geral e por fase, patrimônio líquido `assetValue − saldo devedor`, cronograma com status do dia), `PATCH /debts/:id` ✅ (nome, contato, instituição, valor do bem, observações), `DELETE /debts/:id` ✅ (cancela; apaga os previstos não pagos)
- `POST /debts/:id/installments/:n/pay` ✅ (`{ amount?, date?, accountId?, discount? | discountMonthlyRate? }`; padrão: o que falta, hoje; o previsto da parcela vira o pagamento; parcial deixa o resto previsto; desconto por taxa = valor presente arredondado para baixo; última parcela paga = `paid_off`)
- `POST /debts/:id/amortize` ✅ (`{ amount, mode: reduce_term|reduce_installment, phaseId?, date?, accountId? }`; só fase price/sac, sem parcela parcial; recalcula as pendentes, renumera e registra evento)
- `POST /debts/:id/payoff` ✅ (`{ date?, accountId? }`; paga o saldo devedor, encerra as pendentes, `paid_off`, evento)
- `PATCH /debts/:id/completion-date` ✅ (`{ completionDate }`; refaz só as parcelas pendentes das fases que terminam na entrega ou começam depois dela; pagas ficam; evento)
- `POST /debts/:id/phases/:phaseId/values` ✅ (`{ month, amount }`; valor real do mês na fase variável; meses seguintes ainda estimados passam a usar esse valor)
- `GET/POST /index-values` ✅ (`{ index: incc|ipca|igpm, month, value }`, global; reenviar o mesmo mês atualiza)
- `POST /debts/:id/phases/:phaseId/index` ✅ (`{ month }`; aplica o índice cadastrado às parcelas pendentes da fase com vencimento a partir do mês; uma vez por mês e fase; evento)

## Planejamento e relatórios
- `GET /dashboard?month=` ✅ (receitas/despesas sem categorias técnicas; `balance`, `forecastBalance`/`forecastDate`, `income`/`expense` `{ settled, planned }`, `upcoming` (previstos vencidos e dos próximos 7 dias, até 10), `overdueCount`, `hasAccounts`)
- `GET /projection?months=12` ✅ (1–36; saldo atual das contas que somam nos totais + previstos dessas contas por tipo (receita, fixa = recorrência, parcela = carnê, outras) + o que falta pagar de cada fatura no vencimento; transferências fora; RN 7)
- `GET /reports/by-category?from=&to=&kind=expense|income` (meses `YYYY-MM`; total e itens com fatia, até 9 + "Outras"), `GET /reports/monthly?months=12` (receita, despesa, sobra e taxa de poupança por mês), `GET /reports/net-worth` (ativos, passivos e linhas); só efetivados, categorias técnicas fora
- `GET /budgets?month=` (situação do mês: limite, sobra, gasto, faixa), `PUT /budgets` (cria/atualiza por categoria e mês; `month` nulo = todo mês), `DELETE /budgets/:id`
- `GET/POST /goals`, `PATCH/DELETE /goals/:id` (situação e aporte sugerido calculados), `POST /goals/:id/deposit` (guardar/retirar à mão, só sem conta vinculada)

- `GET /transactions/:id/attachments`, `POST /transactions/:id/attachments?name=` (corpo = o arquivo cru; `image/jpeg|png|webp` ou `application/pdf`, até 8 MB, 10 por lançamento; 400 `invalid_file` se o conteúdo não for do tipo aceito, 413 se grande), `GET /attachments/:id/file` (abre o arquivo), `DELETE /attachments/:id` (lógico)

- `POST /import/preview` (`{ accountId, format: ofx|csv, content, invert? }` → linhas com `duplicate` (`exact`/`possible`), categoria sugerida por regra e `beforeInitialDate`; não grava), `POST /import/commit` (`{ accountId, items: [{ date, type, amount, description, importKey, categoryId?, saveRule? }] }` → `{ created, skipped, rulesCreated }`; efetivados, repetidos ignorados), `GET/POST /category-rules`, `DELETE /category-rules/:id`

- `GET /audit-log?limit=&cursor=&entity=` ✅ (histórico de alterações do espaço, mais recentes primeiro; `nextCursor`)

- `PUT /api/me/pin` ✅ (`{ pin, currentPin? }`, 4–6 dígitos; trocar exige `currentPin`), `POST /api/me/pin/verify` ✅ (`{ pin }`; 400 `pin_invalid`, 429 `pin_locked` após 5 erros), `DELETE /api/me/pin` ✅ (`{ pin }`); `GET /api/me` traz `pinEnabled`

- 2FA (Better Auth, `/api/auth/two-factor/*`): `POST enable` (`{ password }` → `totpURI` e `backupCodes`), `POST verify-totp` (`{ code }`; confirma a ativação ou conclui o login), `POST verify-backup-code`, `POST disable` (`{ password }`); `POST /api/auth/sign-in/email` devolve `{ twoFactorRedirect: true }` quando ligado; `GET /api/me` traz `twoFactorEnabled`

- Passkeys (Better Auth, `/api/auth/passkey/*`): `GET generate-register-options` e `POST verify-registration` (`{ response, name }`, logado), `GET generate-authenticate-options` e `POST verify-authentication` (`{ response }`, cria a sessão), `GET list-user-passkeys`, `POST delete-passkey` (`{ id }`)

## Racha (fora de espaço)
- `/api/split-groups` CRUD, `POST /api/split-groups/join/:code`
- `/api/split-groups/:id/expenses` CRUD
- `GET /api/split-groups/:id/balances?simplify=true`
- `POST /api/split-groups/:id/settlements`

## Notificações
- `GET /api/push/vapid-key` ✅ (503 `push_disabled` sem chaves), `POST/DELETE /api/push/subscriptions` ✅ (`PushSubscription.toJSON()`; upsert por endpoint), `POST /api/push/test` ✅
- `GET /api/notifications` ✅ (50 mais recentes + `unread`), `POST /api/notifications/:id/read` ✅, `POST /api/notifications/read-all` ✅
- `GET/POST /api/reminders` ✅, `PATCH /api/reminders/:id` ✅ (`{ title?, notes?, dueAt?, repeat?, done? }`; concluir com repetição avança para o próximo horário), `DELETE /api/reminders/:id` ✅ (lembretes e checklist do usuário; aviso no horário via push)
- `GET/PATCH /api/notification-settings` ✅ (`{ quietStart, quietEnd, types: [{ type, enabled, daysBefore }] }`; sem linha = ligado, 3 dias)

## Importação/exportação (V2)
- `POST /imports` (multipart OFX/CSV) → prévia, `POST /imports/:id/confirm`
- `GET /api/spaces/:spaceId/export?format=csv|xlsx|json` ✅ (download do espaço; padrão csv)
