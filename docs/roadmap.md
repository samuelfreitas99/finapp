# Roadmap e progresso

**Para qualquer IA**: pegue a primeira tarefa não marcada da fase atual, leia os docs indicados, implemente com testes, marque `[x]` aqui no mesmo PR e anote em "Registro" o que foi feito. Fase atual: **Fase 5** (Fases 1–4 concluídas; Fase 2 aguarda confirmar o uso real).

Legenda dos docs: RN = regras-de-negocio.md, MD = modelo-de-dados.md, ARQ = arquitetura.md, API = api.md, DS = design.md.

## Fase 0: Fundação
- [x] Decisões e documentação inicial
- [x] Criar repositório privado `finapp` e subir esta documentação
- [x] Monorepo pnpm (core, shared, api, web), TypeScript strict, ESLint, Prettier, Vitest (ARQ)
- [x] `infra/docker-compose.dev.yml` (Postgres) e `docker-compose.yml` de produção, `.env.example` (ARQ)
- [x] CI no GitHub Actions: lint, typecheck, test, build
- [x] Protótipos das telas principais como Artifact para aprovação (DS): https://claude.ai/artifact/TipKvxg72ojK7zERMLsgzH (aprovado em 01/10/2026)
- [x] Subdomínio no túnel Cloudflare existente apontando para o app "hello world" (ARQ › Deploy)
- [x] Backup diário com restic + teste de restauração (ARQ › Backup)
  - [ ] destino externo (offsite): escolher B2, Google Drive (rclone) ou outro disco e configurar no `.env`

## Fase 1: Núcleo (`packages/core`, só funções puras e testes)
- [x] `money`: centavos, divisão com resto (5.1), formatação pt-BR (RN 5.1)
- [x] `dates`: clampDay, addMonths, Páscoa, feriados nacionais, dia útil, nthBusinessDay, lastBusinessDay, adjust (RN 2)
- [x] `recurrence`: gerar ocorrências, salário em partes (RN 3)
- [x] `cards`: datas da fatura, invoiceForPurchase, melhor dia de compra, status, limite disponível (RN 4)
- [x] `installments`: gerar parcelas, plano em andamento, antecipação com desconto (RN 5)
- [x] `debts`: fixed, price, sac, variable, balloon, painel, amortização, quitação, fases e completion_date (RN 6)
- [x] `projection`: fluxo de caixa mensal (RN 7)
- [x] `splits`: divisão, saldos, simplificação de dívidas (RN 10, 11)

## Fase 2: Base usável
- [x] Schema Drizzle de identidade, espaços, contas, categorias, tags, contatos, feriados, lançamentos (MD)
- [x] Better Auth com convite; espaço pessoal criado no cadastro (ARQ › Autenticação)
- [x] Seed: categorias padrão brasileiras e feriados
- [x] API: contas, categorias, lançamentos, transferências, ajuste, Pix (API)
- [x] Web: layout, navegação, tema, login/cadastro, telas de contas e lançamentos, botão + (DS)
- [x] Dashboard simples (saldo atual, previsto, receitas x despesas)
- [x] PWA instalável (manifest, service worker, ícones)
- [ ] Deploy no servidor e uso real

## Fase 3: Cartões e parcelamentos
- [x] Schema: cartões, faturas, pagamentos, planos de parcelamento
- [x] API e telas de cartões e faturas, pagar fatura (total/parcial), estorno
- [x] Compra parcelada com prévia, parcelamentos ativos, antecipar, cancelar
- [x] Parcelamento fora do cartão (carnê/boleto)
- [x] Limite disponível e melhor dia de compra na UI

## Fase 4: Recorrências e projeção
- [x] Schema e API de recorrências (com prévia e "alterar a partir de")
- [x] Salário em partes e receitas avulsas a receber
- [x] Despesas fixas (conta e cartão), confirmar com valor real
- [x] Job pg-boss de geração
- [x] Tela de Planejamento: projeção 12 meses

## Fase 5: Dívidas e empréstimos
- [x] Schema de dívidas, fases, parcelas, eventos, índices
- [ ] Cadastro com prévia (todos os tipos e sistemas), painel e cronograma
- [ ] Pagar, pagar adiantado, amortizar, quitar
- [ ] Cartão de terceiro, empréstimo no cartão, emprestei/peguei com pessoa
- [ ] Imóvel na planta com fases e data de entrega

## Fase 6: Alertas
- [ ] Web Push (VAPID), inscrição e configurações
- [ ] Job diário de alertas e central de notificações
- [ ] Lançamentos offline com fila

## Fase 7: Planejamento e relatórios
- [ ] Orçamentos por categoria com alertas
- [ ] Metas
- [ ] Relatórios (categoria, mensal, patrimônio, dívidas)
- [ ] Anexos de comprovantes
- [ ] Importação OFX/CSV com deduplicação e regras de categoria
- [ ] Exportação CSV/XLSX/JSON
- [ ] Passkeys, 2FA, bloqueio por PIN, audit log

## Fase 8: Compartilhamento e racha
- [ ] Espaço compartilhado: convites, membros, seletor de espaço, visão consolidada
- [ ] Divisão de despesas do casal e saldo entre membros
- [ ] Racha: grupos, despesas, saldos, simplificação, acertos com Pix
- [ ] Integração do racha com o espaço pessoal

## Fase 9: Extras
- [ ] Correção por índice (INCC/IPCA/IGP-M) com busca automática (API pública do Banco Central/IBGE, gratuita)
- [ ] Simuladores: "e se eu comprar em Nx?" e quitação antecipada
- [ ] Resumo semanal/mensal por push
- [ ] Empacotar como app Android (Capacitor/TWA), se fizer falta

## Dúvidas em aberto
- Recorrências: a geração começa no **mês atual** (ou no início da regra, se for depois); meses passados não são criados. Usa só os feriados nacionais (os locais do espaço ainda não entram). No cartão, ocorrências com data até hoje viram itens efetivados na fatura; na conta, ficam previstas até confirmar. Ocorrência excluída pelo usuário não volta (`recurrence_key` único).
- Fatura com pagamento parcial: o restante só vira "Saldo anterior" da fatura do mês seguinte **depois do vencimento** (antes disso ainda dá para completar o pagamento nela). Fatura vencida sem nenhum pagamento (`overdue`) continua cobrando o total nela mesma. O saldo anterior é calculado (`invoiceLedger` no core), não é um lançamento.
- Override de fechamento numa fatura reposiciona só compras avulsas de faturas vizinhas ainda sem pagamento; parcelas ficam na fatura do plano. Mudar o dia de fechamento/vencimento do cartão recalcula as datas das faturas abertas sem override, mas não move itens já lançados.
- Cartão adicional (`parent_card_id`) existe no banco, mas ainda não é usado pela API (limite compartilhado e fatura do titular ficam para depois).
- Nome definitivo do app (provisório: FinApp)
- Carnaval (seg/ter) e Corpus Christi contam como **não úteis por padrão** (`nationalHolidays` com `carnival`/`corpusChristi` = `true`), seguindo o calendário bancário: vencimentos adiam e o 5º dia útil do salário fica na data mais tardia (conservador). Configurável por espaço quando houver tela de configurações.
- Recorrência com `parts` (salário dividido): `start_date`/`end_date` delimitam o **mês de referência**, então o salário do último mês ainda é gerado no mês seguinte; sem `parts`, nada é gerado depois de `end_date`. Partes percentuais usam `floor` e a última recebe o resto; partes com valor fixo precisam somar o total. Recorrência semanal usa o dia da semana de `start_date` e não aceita `parts`.
- Status da fatura depois do fechamento: `paid` se pagamentos ≥ total; `partial` se houve algum pagamento menor (mesmo após o vencimento, porque o restante vira "Saldo anterior" na próxima); `overdue` só quando venceu **sem nenhum** pagamento; senão `closed`.
- Antecipação com taxa mensal: desconto por valor presente arredondado **para baixo** (não promete economia maior que a real). Só parcelas em faturas depois da aberta podem ser antecipadas.
- Plano cadastrado em andamento ("parcela 4 de 10"): a parcela 4 vai na fatura em que cai a data de hoje; o painel (`planSummary`) considera só as parcelas existentes.
- Dívidas: SAC divide a amortização com a regra de 5.1 (resto na 1ª); Price com taxa 0 usa parcela arredondada para cima e a última ajusta. Fase `variable`: antes do primeiro valor informado, usa esse primeiro valor como estimativa. Fases que começam após a entrega usam o mês seguinte ao de `completion_date`, no dia do vencimento cadastrado. Quitação = principal ainda não amortizado das parcelas não pagas (sem juros futuros). Correção por índice é aplicada pelo chamador às parcelas pendentes do mês (aniversário/mensal).
- Projeção: despesas previstas já vencidas entram no 1º mês (ainda vão sair da conta); receitas previstas vencidas e não confirmadas ficam de fora (conservador).
- Divisão (casal e racha): nos modos proporcionais cada parte é arredondada para baixo e o resto inteiro vai para quem pagou (se não participa, para o 1º participante). Simplificação gulosa com desempate por id.

## Registro
- 01/10/2026: decisões e documentação inicial (Claude).
- 01/10/2026: monorepo pnpm (core, shared, api com `/api/health`, web mínima), TS strict, ESLint, Prettier, Vitest, Dockerfile, compose de dev e produção, `.env.example`, CI. Servidor preparado: projeto em `/srv/finapp`, Node 22 via fnm, pnpm via corepack (Claude no servidor). Portas ajustadas por conflito com outros projetos (ver ADR-012).
- 01/10/2026: produção no ar em https://financas.voleidraft.top (finapp-prod: `finapp-api` em 127.0.0.1:3010, `finapp-db`), rota adicionada ao túnel com `infra/cloudflared/add-financas-hostname.sh` (DNS criado pelo script; o servidor tem `/root/.cloudflared/cert.pem`). Apps financeiros antigos removidos do servidor (Claude).
- 01/10/2026: backup diário (`finapp-backup`: pg_dump -Fc → restic local em `/srv/finapp-backups/restic`, 03:00, retenção 7/4/12) e `infra/backup/restore.sh`; primeiro backup e teste de restauração OK. Falta destino externo (Claude).
- 01/10/2026: protótipos aprovados; `packages/core`: `money` (centavos, `splitCents`, `formatBRL`, `parseBRL`), `dates` (ISO, `clampDay`, `addMonths` com dia âncora, dias úteis) e `holidays` (Páscoa, feriados nacionais) com testes (Claude).
- 01/10/2026: `packages/core/recurrence`: `resolveDayRule`, `splitParts`, `generateOccurrences` (mensal, a cada N meses, anual, semanal, salário em partes com `monthOffset`) e `splitRecurrenceFrom` ("alterar a partir de"), com os exemplos da RN 3 (Claude).
- 01/10/2026: `packages/core/cards` (datas da fatura com overrides, `invoiceForPurchase`, período, melhor dia de compra, status, saldo anterior, limite disponível) e `installments` (parcelas no cartão e fora, plano em andamento, cancelamento, antecipação com desconto, painel), com os exemplos da RN 4 e 5 (Claude).
- 01/10/2026: `packages/core/debts`: cronogramas fixed, price, sac, variable (estimativa), balloon; correção por índice; amortização extraordinária (reduzir prazo/parcela); desconto por antecipação; quitação; painel; fases do imóvel com data de entrega (Claude).
- 01/10/2026: `packages/core/projection` (fluxo de caixa mês a mês, comprometido/livre, meses negativos) e `splits` (divisão equal/percent/amount/shares, saldos, acertos, simplificação). **Fase 1 concluída** (Claude).
- 01/10/2026: schema Drizzle + migração `0000_init` (tabelas do Better Auth `users`/`sessions`/`auth_accounts`/`verifications`, espaços, membros, convites, configurações, contas, categorias, tags, contatos, feriados, lançamentos, tags de lançamento), enums em `packages/shared`, `pnpm db:generate`/`db:migrate`, teste de integração em banco temporário (CI com serviço Postgres) (Claude).
- 01/10/2026: Better Auth (e-mail/senha, sessão em cookie) em `/api/auth/*`, cadastro só com convite (reserva atômica, convite por e-mail e para espaço compartilhado), espaço pessoal + configurações no cadastro, `GET /api/me`, `GET/POST /api/invites`, convite de administrador por CLI, migrações automáticas na subida da API; testes de integração do fluxo (Claude).
- 01/10/2026: correções da revisão do Codex no core (PR #11). Seed idempotente (`apps/api/src/db/seed.ts`): feriados nacionais (`space_id` nulo) do ano anterior até +30 anos, 23 categorias padrão + 4 técnicas (`invoice_payment`, `adjustment`, `transfer`, `loan`) criadas no cadastro do espaço pessoal; roda na subida da API (`RUN_SEED=false` desliga) e em `pnpm db:seed` (Claude).
- 01/10/2026: API de contas (CRUD, saldo atual/previsto, arquivar), categorias (CRUD, subcategoria de um nível, técnicas protegidas), lançamentos (lista com filtros e cursor, receita/despesa, Pix, efetivar, editar, excluir lógico), transferências e ajuste de saldo; acesso por espaço em `modules/spaces/scope.ts`; `packages/core/balances` (`signedAmount`, `accountBalance`, `adjustmentAmount`) e `todayIn`; migração `0002` (ajuste com sinal, ADR-013) (Claude).
- 01/10/2026: web, parte 1 (casca): tokens claro/escuro, tema, login e cadastro com convite, layout com barra inferior e "+" (mobile) e barra lateral (desktop), ocultar valores, tela "Mais"; telas de contas e lançamentos ainda são provisórias (ADR-014) (Claude).
- 02/10/2026: web, parte 2: tela de contas (lista com saldo atual e previsto, total, criar/editar, cor, somar nos totais, arquivar com desfazer, excluir, ajustar saldo), campo de valor estilo app de banco (`MoneyInput`), toasts (Claude).
- 02/10/2026: web, parte 3: lançamentos (lista por dia com seletor de mês, busca, filtros, totais do mês, previstos atenuados com "Confirmar") e o "+" (despesa/receita/transferência, valor grande, categorias mais usadas primeiro, Pix, conta usada por último, Hoje/Ontem/Outra, data futura vira previsto, desfazer), edição e exclusão (Claude).
- 02/10/2026: Início: `GET /dashboard?month=` (saldo das contas que somam nos totais, previsto no fim do mês, receitas x despesas efetivadas/previstas sem transferências e ajustes, previstos vencidos e dos próximos 7 dias) com `monthFlow` no core; tela com o cartão de saldo do protótipo, alerta de vencidos, próximos vencimentos e entradas/saídas do mês (Claude).
- 02/10/2026: PWA com `vite-plugin-pwa`: manifest (nome, cores, atalho "Novo lançamento"), ícones 192/512/maskable/apple-touch gerados do glifo da carteira, service worker que guarda só a casca do app (API sempre pela rede, `/api` fora do fallback) e se atualiza sozinho a cada deploy (Claude).
- 02/10/2026: produção atualizada (main `5f71f6a`): migrações 0001–0002 e seed aplicados, convite do Samuel criado. Fase 3: schema `credit_cards`, `invoices`, `invoice_payments`, `installment_plans`, FKs de `transactions` para cartão/fatura/parcelamento/pagamento e coluna `anticipated` (migração `0003`), com testes de restrições (Claude).
- 02/10/2026: API de cartões e faturas: CRUD de cartões com limite disponível, melhor dia e fatura atual; faturas por mês (criadas sob demanda) com saldo anterior encadeado (`invoiceLedger` no core), status recalculado e gravado, overrides de datas com reposicionamento de compras; compra e estorno no cartão via `POST /transactions` com `cardId`; pagar fatura total/parcial (despesa na conta + `invoice_payments`) e desfazer (Claude).
- 02/10/2026: cor principal azul-marinho (ADR-015). API de parcelamentos: prévia e criação no cartão (uma parcela por fatura, plano em andamento) e fora dele (carnê/boleto com ajuste de dia útil), painel com parcelas pagas/restantes e próxima, antecipação com desconto (estorno na fatura aberta) e cancelamento com estorno opcional das já faturadas; parcelas travadas para edição individual. Telas ainda faltam (Claude).
- 02/10/2026: telas de cartões: carrossel com fatura atual e limite disponível, melhor dia de compra, fatura por mês (status, fechamento/vencimento, saldo anterior, itens, pagamentos com desfazer), pagar fatura total/parcial, cadastro/edição/arquivo de cartão; parcelamentos ativos com progresso e tela do plano (antecipar com taxa, cancelar com estorno); no "+", conta ou cartão no mesmo campo, compra/estorno no cartão e "Parcelar" com prévia (Claude).
- 02/10/2026: carnê/boleto na tela: "Parcelar" também numa conta, com vencimento da 1ª parcela, ajuste para dia útil e prévia das datas; parcelas ficam previstas na conta. Tela "Parcelamentos e carnês" (ativos/quitados/cancelados) no menu Mais. **Fase 3 concluída** (Claude).
- 02/10/2026: **Fase 3 concluída** (PR #24). Recorrências: tabela `recurrences` e `transactions.recurrence_key` (migração 0004), prévia, criação com geração idempotente de 12 meses (conta ou cartão, salário em partes, valor variável estimado), edição "a partir de" (divide a recorrência) ou no lugar, metadados propagados, ocorrência editada fica `detached`, encerramento (Claude).
- 02/10/2026: produção atualizada (main `b7b8c82`, migração 0003: cartões e parcelamentos, cor azul). Tela "Fixas" (receitas e despesas fixas): lista por tipo com total mensal, criação/edição com regra do dia (dia fixo com ajuste, N-ésimo dia útil, último dia útil), semanal/anual/a cada N meses, salário em partes (percentuais, mês seguinte), valor variável, conta ou cartão, prévia das próximas ocorrências e "a partir de" na edição; filtro "A receber" em Lançamentos. API: recorrência pode começar antes do saldo inicial da conta (ocorrências anteriores são puladas) (Claude).
- 02/10/2026: confirmar previsto com valor real: itens estimados (conta variável) mostram "Estimado" e "Informar valor real" na lista, que efetiva com o valor digitado; campo de valor sugerido é substituído ao digitar (`typedCents`, também no pagar fatura e ajustar saldo). Botão "Repetir" no + cria uma recorrência mensal no dia da data (conta ou cartão) e confirma a ocorrência de hoje se já foi paga (Claude).
- 02/10/2026: pg-boss (schema `pgboss`) iniciado pela API; job `recurrences-generate` diário às 02:00 (São Paulo) e na subida, estende a janela de 12 meses de todas as recorrências ativas (idempotente); `RUN_JOBS=false` desliga; testado no bundle CJS (Claude).
- 02/10/2026: Planejamento: `GET /projection?months=` (core `projectCashFlow` com previstos das contas e faturas a pagar) e tela com menor saldo previsto, alerta de meses negativos, gráfico de saldo no fim de cada mês e de entradas x saídas (SVG próprio, paleta validada pela skill dataviz, tooltip, tabela), detalhe do mês e 6/12/24 meses. **Fase 4 concluída** (Claude).
- 02/10/2026: **Fase 4 concluída** (PR #29). Fase 5: schema `debts`, `debt_phases`, `debt_installments`, `debt_events`, `index_values` e FK `transactions.debt_installment_id` (migração 0005); taxas e índices em `numeric` lidos como número (não são dinheiro) (Claude).
- 02/10/2026: produção atualizada (main `2bb5b97`: Fase 4 e migração 0005); publicação automática registrada em arquitetura.md. API de dívidas: prévia, cadastro de todos os sistemas e fases (imóvel na planta com entrada, intermediárias, juros de obra até a entrega e financiamento depois dela), dívida em andamento (parcelas já pagas), previstos por parcela na conta ou na fatura, a receber quando me devem, painel geral e por fase, patrimônio líquido, cancelamento. Telas ainda faltam (Claude).

