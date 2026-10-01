# AGENTS.md: instruções para qualquer IA (Claude, Gemini/Antigravity, Codex, Copilot...)

Este arquivo é a porta de entrada para qualquer assistente de código. Leia-o inteiro antes de mexer no projeto.

## O que é
FinApp: app pessoal de controle financeiro (PWA) para o Samuel e amigos. Idioma da interface e da documentação: **português do Brasil**. Código (nomes de variáveis, tabelas, funções) em **inglês**.

## Leia antes de programar
1. `docs/roadmap.md`: o que já foi feito e qual é a próxima tarefa (checklist). **Comece sempre por aqui.**
2. `docs/regras-de-negocio.md`: as regras financeiras (fatura, parcelas, dias úteis, dívidas, racha). É a fonte da verdade.
3. `docs/modelo-de-dados.md`: tabelas e colunas.
4. `docs/arquitetura.md`: stack, pastas, infraestrutura e deploy.
5. `docs/design.md`: telas e diretrizes de UX/UI (quando for mexer no front).
6. `docs/decisoes.md`: por que cada escolha foi feita. Não reverta uma decisão sem registrar uma nova.

## Regras inegociáveis
- **Dinheiro em centavos inteiros** (`bigint` no banco, `number` inteiro no TS). Nunca `float` para dinheiro. Formatação só na borda (UI).
- **Datas de calendário** (vencimento, competência, compra) são `date` sem fuso, no formato `YYYY-MM-DD`. Fuso de referência `America/Sao_Paulo`.
- **Toda regra de cálculo mora em `packages/core`**, como função pura com testes. API e front só chamam o core.
- **Isolamento por espaço**: toda consulta filtra por `space_id` e checa se o usuário é membro do espaço. Nunca confie em `space_id` vindo do cliente sem checar.
- **Nada financeiro é apagado fisicamente**: use `deleted_at`.
- Toda mudança de banco é uma migração Drizzle versionada. Nunca edite migração já aplicada.
- Validação de entrada com Zod (schemas em `packages/shared`).
- Não adicione dependências pagas nem serviços externos pagos (Open Finance está fora de escopo por custo).

## Fluxo de trabalho
- Uma tarefa do roadmap por vez, em branch própria (`feat/...`, `fix/...`), commits no padrão Conventional Commits, PR pequeno.
- Antes de concluir: `pnpm lint && pnpm typecheck && pnpm test`.
- **Ao terminar uma tarefa, marque-a como feita em `docs/roadmap.md`** e, se descobriu algo que muda regra ou modelo, atualize o doc correspondente no mesmo PR. A documentação é o que permite outra IA continuar o trabalho.
- Se uma regra de negócio estiver ambígua, registre a dúvida em `docs/roadmap.md` (seção "Dúvidas em aberto") e escolha o padrão mais conservador.

## Comandos (após a Fase 0)
```
pnpm install          # dependências
pnpm dev              # api + web em modo dev (precisa do Postgres: docker compose up -d db)
pnpm test             # testes (Vitest)
pnpm lint             # ESLint
pnpm typecheck        # tsc
pnpm db:generate      # gera migração a partir do schema Drizzle
pnpm db:migrate       # aplica migrações
```
