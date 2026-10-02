# Roadmap e progresso

**Para qualquer IA**: pegue a primeira tarefa não marcada da fase atual, leia os docs indicados, implemente com testes, marque `[x]` aqui no mesmo PR e anote em "Registro" o que foi feito. Fase atual: **Fase 0**.

Legenda dos docs: RN = regras-de-negocio.md, MD = modelo-de-dados.md, ARQ = arquitetura.md, API = api.md, DS = design.md.

## Fase 0: Fundação
- [x] Decisões e documentação inicial
- [x] Criar repositório privado `finapp` e subir esta documentação
- [x] Monorepo pnpm (core, shared, api, web), TypeScript strict, ESLint, Prettier, Vitest (ARQ)
- [x] `infra/docker-compose.dev.yml` (Postgres) e `docker-compose.yml` de produção, `.env.example` (ARQ)
- [x] CI no GitHub Actions: lint, typecheck, test, build
- [ ] Protótipos das telas principais como Artifact para aprovação (DS)
- [ ] Subdomínio no túnel Cloudflare existente apontando para o app "hello world" (ARQ › Deploy)
- [ ] Backup diário com restic + teste de restauração (ARQ › Backup)

## Fase 1: Núcleo (`packages/core`, só funções puras e testes)
- [ ] `money`: centavos, divisão com resto (5.1), formatação pt-BR (RN 5.1)
- [ ] `dates`: clampDay, addMonths, Páscoa, feriados nacionais, dia útil, nthBusinessDay, lastBusinessDay, adjust (RN 2)
- [ ] `recurrence`: gerar ocorrências, salário em partes (RN 3)
- [ ] `cards`: datas da fatura, invoiceForPurchase, melhor dia de compra, status, limite disponível (RN 4)
- [ ] `installments`: gerar parcelas, plano em andamento, antecipação com desconto (RN 5)
- [ ] `debts`: fixed, price, sac, variable, balloon, painel, amortização, quitação, fases e completion_date (RN 6)
- [ ] `projection`: fluxo de caixa mensal (RN 7)
- [ ] `splits`: divisão, saldos, simplificação de dívidas (RN 10, 11)

## Fase 2: Base usável
- [ ] Schema Drizzle de identidade, espaços, contas, categorias, tags, contatos, feriados, lançamentos (MD)
- [ ] Better Auth com convite; espaço pessoal criado no cadastro (ARQ › Autenticação)
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

## Registro
- 01/10/2026: decisões e documentação inicial (Claude).
- 01/10/2026: monorepo pnpm (core, shared, api com `/api/health`, web mínima), TS strict, ESLint, Prettier, Vitest, Dockerfile, compose de dev e produção, `.env.example`, CI. Servidor preparado: projeto em `/srv/finapp`, Node 22 via fnm, pnpm via corepack (Claude no servidor). Portas ajustadas por conflito com outros projetos (ver ADR-012).
