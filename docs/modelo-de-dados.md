# Modelo de dados

PostgreSQL 17, schema definido em Drizzle (`apps/api/src/db/schema/*.ts`). Convenções:
- PK `id uuid` (uuid v7, gerado no app). Valores em centavos `bigint`. Datas de calendário `date`; instantes `timestamptz`.
- Toda tabela de domínio tem `space_id`, `created_at`, `updated_at`, `created_by`, `deleted_at` (exclusão lógica).
- Enums como `text` + check constraint (mais fácil de migrar) e union types no TS.
- Índices em `(space_id, date)`, `(space_id, deleted_at)` e chaves estrangeiras.
- Valores dos enums ficam em `packages/shared/src/enums.ts` (fonte única para Drizzle, Zod e front).
- Colunas que apontam para tabelas de fases futuras (ex.: `transactions.invoice_id`, `card_id`, `recurrence_id`) existem desde a 1ª migração, sem FK; a FK entra na migração da fase que cria a tabela.

Regras detalhadas em `regras-de-negocio.md`.

---

## Identidade e espaços
| Tabela | Colunas principais |
|---|---|
| `users` | id, name, email (unique), email_verified, image, created_at (gerenciada pelo Better Auth; as tabelas dele são `sessions`, `auth_accounts` (para não colidir com `accounts`, as carteiras) e `verifications`; `two_factors` (segredo TOTP e códigos de backup cifrados; `users.two_factor_enabled`); `passkeys`: id, name, public_key, user_id, credential_id (único), counter, device_type, backed_up, transports, aaguid, created_at) |
| `invites` | id, code (unique), created_by, space_id (opcional: convite para espaço), email opcional, expires_at, used_by, used_at |
| `spaces` | id, name, type (`personal`/`shared`), default_split (jsonb), currency (`BRL`), created_by |
| `space_members` | space_id, user_id, role (`owner`/`member`), split_percent (opcional), joined_at |
| `user_settings` | user_id, theme, hide_values, active_space_id, lock_pin_hash |

## Cadastros
| Tabela | Colunas principais |
|---|---|
| `accounts` | id, space_id, name, type (`checking`/`savings`/`cash`/`investment`/`benefit`/`wallet`), initial_balance, initial_date, color, icon, include_in_totals, archived_at, owner_user_id (no espaço compartilhado: de quem é) |
| `credit_cards` | id, space_id, name, brand (`visa`/`mastercard`/`elo`/`amex`/`hipercard`/`other`), limit_amount (≥0), closing_day e due_day (1–31), closing_day_goes_to_next (padrão true), payment_account_id, color, archived_at, parent_card_id (adicional) |
| `categories` | id, space_id, name, kind (`income`/`expense`), parent_id, icon, color, is_system, system_key (`invoice_payment`/`adjustment`/`transfer`/`loan`, único por espaço: identifica as técnicas), archived_at |
| `category_rules` | id, space_id, pattern (normalizado: sem acento, minúsculas; único por espaço), category_id, deleted_at |
| `tags` | id, space_id, name, color |
| `contacts` | id, space_id, name, pix_key, phone, linked_user_id |
| `holidays` | id, space_id (null = nacional), date, name |

## Movimentação
| Tabela | Colunas principais |
|---|---|
| `transactions` | id, space_id, type (`income`/`expense`/`transfer_in`/`transfer_out`/`adjustment`), status (`planned`/`settled`), amount (>0; no `adjustment`, a diferença com sinal, ≠0, ADR-013), date, description, notes, category_id, account_id **ou** invoice_id (check: exatamente um), card_id, payment_method (`pix`/`debit`/`credit`/`cash`/`boleto`/`ted`/`other`), pix_counterparty, contact_id, transfer_id, installment_plan_id, installment_number, anticipated, recurrence_id, recurrence_key (identidade da ocorrência: `YYYY-MM#parte` ou a data no semanal; único por recorrência, inclusive excluídos), detached, debt_installment_id, invoice_payment_id, split_id, estimated, import_key (chave de deduplicação da importação; única por conta, inclusive excluídos), reconciled_at, settled_at |
| `transaction_tags` | transaction_id, tag_id |
| `attachments` | id, space_id, transaction_id, file_name, mime, size, data (`bytea`, ADR-016), created_by, deleted_at |
| `recurrences` | id, space_id, type (`income`/`expense`), description, amount (>0), frequency, interval (1–120), day_rule (jsonb: `{kind, day?, n?}`), adjust, parts (jsonb, salário dividido), start_date, end_date, account_id **ou** card_id (check), category_id, payment_method, variable_amount, generated_until (migração `0004`) |

## Cartões
| Tabela | Colunas principais |
|---|---|
| `invoices` | id, space_id, card_id, reference_month (`YYYY-MM`, unique com card_id), closing_date, due_date (já com overrides; check fechamento ≤ vencimento), closing_date_override, due_date_override, status (`open`/`closed`/`paid`/`partial`/`overdue`, último estado calculado), carried_balance |
| `invoice_payments` | id, space_id, invoice_id, account_id, amount (>0), date, transaction_id, deleted_at |
| `installment_plans` | id, space_id, description, total_amount, installments (1–420), first_date, first_due_date (fora do cartão), card_id **ou** account_id (check), category_id, interest_amount, start_installment (1..installments), status (`active`/`finished`/`cancelled`) |

Itens da fatura = `transactions` com `invoice_id` (e `card_id`). Total da fatura é calculado na consulta (soma dos itens), não armazenado. Parcelas: `installment_plan_id` e `installment_number` andam juntos (check); `anticipated` marca parcela antecipada (RN 5.5). Migração `0003`.

## Dívidas
| Tabela | Colunas principais |
|---|---|
| `debts` | id, space_id, name, direction (`i_owe`/`owed_to_me`), kind (`bank_loan`/`card_loan`/`personal_loan`/`third_party_card`/`financing`/`agreement`/`consortium`/`property`/`other`), contact_id, institution, principal (≥0), payment_account_id, payment_card_id (no máximo um dos dois), completion_date (imóvel), asset_value, status (`active`/`paid_off`/`cancelled`), notes (migração `0005`) |
| `debt_phases` | id, space_id, debt_id, position (ordem, única na dívida), name, system (`fixed`/`price`/`sac`/`variable`/`balloon`), principal, rate_monthly (numeric, decimal 0–1), index (`none`/`incc`/`ipca`/`igpm`), installments (1–600), start_date, end_date, installment_amount, ends_at_completion, starts_after_completion |
| `debt_installments` | id, space_id, debt_id, phase_id, number, due_date, amount, principal_part, interest_part, estimated, paid_amount, paid_date, discount, status (`pending`/`paid`/`late`/`partial`), transaction_id, deleted_at (parcelas pendentes regeneradas são excluídas logicamente) |
| `debt_events` | id, space_id, debt_id, type (`amortization`/`payoff`/`index_correction`/`completion_date_change`), amount, date, data (jsonb), created_by |
| `index_values` | index (`incc`/`ipca`/`igpm`), month (`YYYY-MM`, único por índice), value (numeric, ex.: 0.0045), global (não pertence a espaço) |

## Planejamento
| Tabela | Colunas principais |
|---|---|
| `budgets` | id, space_id, category_id (despesa, categoria principal), month (`YYYY-MM`, null = todo mês; único por categoria+mês), amount, rollover, deleted_at |
| `goals` | id, space_id, name, target_amount, target_date (opcional), account_id (opcional: o guardado é o saldo dela), saved_amount_manual, archived_at, deleted_at |

## Divisão (casal) e racha
| Tabela | Colunas principais |
|---|---|
| `transaction_splits` | id, space_id, transaction_id, user_id, amount (parte do membro, ≥0), paid_by_user_id; único por (transaction_id, user_id) |
| `space_settlements` | id, space_id, from_user_id (quem pagou), to_user_id, amount (>0), date, notes, created_by, deleted_at |
| `split_groups` | id, name, currency, join_code (único), created_by, archived_at |
| `split_participants` | id, group_id, user_id (opcional; único por grupo), name |
| `split_expenses` | id, group_id, description, amount, date, split_mode (`equal`/`percent`/`amount`/`shares`), category, created_by, deleted_at |
| `split_expense_payers` | expense_id, participant_id, amount |
| `split_expense_shares` | expense_id, participant_id, amount, weight |
| `split_settlements` | id, group_id, from_participant_id, to_participant_id, amount, date, method, created_by, deleted_at (`transaction_id` virá com a integração ao espaço pessoal) |

| `split_group_links` | id, group_id, user_id, space_id, account_id, category_id (opcional); único por (group_id, user_id): onde a parte do usuário vira lançamento |
| `split_expense_postings` | expense_id, user_id, transaction_id: o lançamento que representa a parte do usuário em cada despesa (chave primária composta) |

Grupos de racha **não** pertencem a um espaço: o acesso é por `split_participants.user_id`.

## Notificações e auditoria
| Tabela | Colunas principais |
|---|---|
| `push_subscriptions` | id, user_id, endpoint, p256dh, auth, user_agent |
| `notification_settings` | user_id, type, enabled, days_before, quiet_start, quiet_end |
| `notifications` | id, user_id, space_id, type, title, body, entity_type, entity_id, dedupe_key (unique), read_at, sent_at |
| `reminders` | id, user_id, title, notes, due_at (timestamptz, opcional: sem horário = checklist), repeat (`none`/`daily`/`weekly`/`monthly`/`yearly`), done_at, notified_for, deleted_at (migração `0008`) |
| `audit_log` | id, space_id, user_id, entity_type, entity_id, action, before (jsonb, hoje sempre nulo), after (jsonb: corpo enviado sem campos sensíveis), at |
| `import_batches` (V2) | id, space_id, account_id/card_id, source, file_name, created_at; `transactions.import_batch_id`, `external_id` |
