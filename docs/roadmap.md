# Roadmap e progresso

**Para qualquer IA**: pegue a primeira tarefa não marcada da fase atual, leia os docs indicados, implemente com testes, marque `[x]` aqui no mesmo PR e anote em "Registro" o que foi feito. Fase atual: **Fase 2** (Fase 1 concluída).

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
- [ ] Seed: categorias padrão brasileiras e feriados
- [ ] API: contas, categorias, lançamentos, transferências, ajuste, Pix (API)
- [ ] Web: layout, navegação, tema, login/cadastro, telas de contas e lançamentos, botão + (DS)
- [ ] Dashboard simples (saldo atual, previsto, receitas x despesas)
- [ ] PWA instalável (manifest, service worker, ícones)
- [ ] Deploy no servidor e uso real

## Fase 3: Cartões e parcelamentos
- [ ] Schema: cartões, faturas, pagamentos, planos de parcelamento
- [ ] API e telas de cartões e faturas, pagar fatura (total/parcial), estorno
- [ ] Compra parcelada com prévia, parcelamentos ativos, antecipar, cancelar
- [ ] Parcelamento fora do cartão (carnê/boleto)
- [ ] Limite disponível e melhor dia de compra na UI

## Fase 4: Recorrências e projeção
- [ ] Schema e API de recorrências (com prévia e "alterar a partir de")
- [ ] Salário em partes e receitas avulsas a receber
- [ ] Despesas fixas (conta e cartão), confirmar com valor real
- [ ] Job pg-boss de geração
- [ ] Tela de Planejamento: projeção 12 meses

## Fase 5: Dívidas e empréstimos
- [ ] Schema de dívidas, fases, parcelas, eventos, índices
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
