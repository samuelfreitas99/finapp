# CLAUDE.md

@AGENTS.md

## Específico do Claude Code
- **Modelo**: use `/model opusplan` (Opus planeja no plan mode, Sonnet executa). Para tarefas difíceis de regra de negócio (Fase 1 core, dívidas), avise o Samuel para usar Opus; para CRUD/telas/testes, Sonnet basta. Quando a sessão ficar longa, avise para usar `/compact` ou `/clear`.
- O Samuel não programa: decida, execute e peça só aprovação para passos irreversíveis (produção, apagar dados, mexer em outros containers do servidor).
- O servidor já roda outros containers (inclusive o `cloudflared` do voleidraft.top): nunca pare, recrie ou altere containers que não sejam do FinApp sem perguntar.
- Para telas e componentes, use o plugin/skill **frontend-design** e siga `docs/design.md`.
- Para gráficos, siga a skill **dataviz** se disponível.
- Economize contexto: leia só os docs relevantes à tarefa atual (o roadmap indica quais).
- Prefira tarefas pequenas e uma sessão por tarefa (`/clear` entre tarefas).
