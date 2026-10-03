# Design e UX

## Princípios
1. **Calmo e claro**: o essencial primeiro (quanto tenho, quanto vai sobrar, o que vence). Sem poluição.
2. **Rápido com uma mão**: lançar um gasto em até 3 toques; alvos de toque ≥ 44px; ações principais na metade de baixo da tela.
3. **Sempre mostrar o futuro**: toda lista tem seletor de mês que vai para frente; parcelas e fixas aparecem como previstas.
4. **Prévia antes de salvar**: parcelamentos, recorrências e dívidas mostram o cronograma gerado antes de confirmar.
5. **Desfazer > confirmar**: toast com "Desfazer" para exclusões e mudanças de status; confirmação só para ações destrutivas grandes.
6. **Não genérico**: identidade própria (ver skill `frontend-design`), não o visual padrão de template.

## Identidade visual (protótipo aprovado em 01/10/2026; cor principal trocada para azul-marinho em 02/10/2026, ADR-015)
Protótipo de referência: https://claude.ai/artifact/TipKvxg72ojK7zERMLsgzH

| Token | Valor | Uso |
|---|---|---|
| Fonte | **Manrope** (títulos peso 600–700), números com `font-variant-numeric: tabular-nums` | todo o app |
| `--bg` | `#F4F3EE` | fundo (neutro quente) |
| `--surface` | `#FFFFFF` | cartões e painéis |
| `--text` | `#161D2B` | texto principal |
| `--muted` | `#556070` | texto secundário (6,4:1 sobre branco) |
| `--primary` | `#1F3A68` | azul-marinho: ações, destaques, cartão de saldo (branco sobre ele: 11,3:1). Hover `#16294B`, fundo suave `#E7EDF7` |
| `--income` | `#1B6E45` | receitas (semântica, nunca cor da marca) |
| `--expense` | `#A23A28` | despesas |
| `--warning-bg` / `--warning-text` | `#FBEBD3` / `#6E4100` | alertas |
| Raio | 16–20px | cartões, botões grandes, sheets |

- Semânticas: transferência violeta (`#6A45A6`; não azul, para não confundir com a marca), previsto em tom atenuado com borda tracejada. Nunca só cor: sempre sinal (+/−) ou ícone.
- Modo escuro (`apps/web/src/styles/tokens.css`): fundo `#11161F`, superfície `#1A212C`, `--primary` azul-claro `#8EB2EC` (texto `#0B1A33` sobre ele: 8,0:1), cartão de saldo continua azul-marinho. Todos os pares de texto passam AA.
- Gráficos (skill dataviz): séries `--series-1` azul `#2A78D6` (entradas, saldo positivo) e `--series-2` laranja `#EB6834` (saídas), validadas para daltonismo (ΔE 24,7 claro / 26,8 escuro); saldo negativo usa `--expense` com texto/ícone. Barras finas com ponta arredondada, base no zero, tooltip no toque/hover e "Ver como tabela". Verde e vermelho juntos não passam no teste de daltonismo: nunca como par de séries.
- Sombras suaves, espaçamento base 4px. Ícones: lucide. Cada categoria tem ícone e cor.

## Navegação
- **Mobile**: barra inferior: Início · Lançamentos · **+** (central, destacado) · Cartões · Mais.
  - "Mais": Dívidas, Planejamento (projeção, orçamentos, metas), Racha, Relatórios, Contas, Categorias, Configurações.
  - Dívidas pode substituir Cartões na barra conforme preferência do usuário.
- **Desktop** (≥1024px): barra lateral com todos os itens, conteúdo em 2 colunas.
- Seletor de espaço (Pessoal / Casa) no topo, com opção "Consolidado".

## Telas principais
1. **Início**: saldo atual total (olho para ocultar) · "Previsto para o fim do mês" · cartão "Próximos vencimentos" (7 dias) · faturas abertas com barra de limite · resumo receitas x despesas do mês · gastos por categoria (rosca) · progresso das dívidas · alertas.
2. **Lançar (+)**: abas Despesa / Receita / Transferência. Teclado numérico abre já no valor. Categoria em grade de ícones (mais usadas primeiro). Conta ou cartão (último usado como padrão). Botões rápidos: "Pix", "Parcelar", "Repetir". Data hoje, com atalhos Ontem/Outra.
3. **Lançamentos**: lista agrupada por dia, seletor de mês, filtros em chips, busca. Previstos com estilo atenuado e botão "Confirmar".
4. **Cartões**: carrossel de cartões; fatura do mês selecionado com total, status, fechamento/vencimento, itens, "Pagar fatura"; aba "Parcelamentos ativos" com progresso.
5. **Dívidas**: lista com barra de progresso (% quitado), parcelas x/y, restante e próxima parcela. Detalhe: anel de progresso, números-chave, cronograma com status, ações (Pagar parcela, Antecipar, Amortizar, Quitar). Imóvel: progresso por fase em linha do tempo.
6. **Planejamento**: gráfico de barras dos próximos 12 meses (receitas x comprometido) com linha de saldo final; meses negativos destacados; toque no mês abre o detalhe.
7. **Racha**: grupos, saldo "você deve / te devem", despesas, botão "Acertar" com Pix.
8. **Configurações**: espaços e membros, convites, notificações, tema, bloqueio por PIN, exportar dados.

## Estados
- Vazio: ilustração simples + ação principal ("Cadastre seu primeiro cartão").
- Carregando: skeletons, nunca spinner de tela cheia.
- Offline: faixa discreta "Sem conexão"; lançamentos feitos no "+" ficam guardados no aparelho (`lib/offline-queue.ts`) e são enviados quando a conexão volta.
- Erro: mensagem humana + tentar de novo.

## Formatos
`R$ 1.234,56` (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`), datas `dd/mm/aaaa` e relativas ("hoje", "amanhã", "em 3 dias"), meses "out/2026".

## Processo de design
1. Protótipos navegáveis das telas 1–6 como Artifact HTML (claude.ai) para aprovação do Samuel.
2. Aprovado o protótipo, tokens vão para `apps/web/src/styles/tokens.css` (claro e escuro) e os componentes base são classes em `apps/web/src/styles/app.css` (`.btn`, `.input`, `.card`, `.chip`, `.segmented`, `.list`...), ver ADR-014.
3. Implementação com a skill `frontend-design`; gráficos com a skill `dataviz`.
4. Revisão de acessibilidade a cada tela (contraste, foco visível, labels, leitor de tela).


## Navegação (ADR-018)
- As 4 telas da barra inferior (Início, Lançamentos, Cartões, Mais) não têm botão "voltar"; toda outra tela tem, no canto esquerdo do título (`PageHeader` com `back`).
- "Voltar" desfaz a última navegação; só vai para a tela-mãe (`back`) quando a tela foi aberta direto por link.
- A rolagem é restaurada ao voltar e começa no topo em tela nova.
