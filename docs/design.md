# Design e UX

## Princípios
1. **Calmo e claro**: o essencial primeiro (quanto tenho, quanto vai sobrar, o que vence). Sem poluição.
2. **Rápido com uma mão**: lançar um gasto em até 3 toques; alvos de toque ≥ 44px; ações principais na metade de baixo da tela.
3. **Sempre mostrar o futuro**: toda lista tem seletor de mês que vai para frente; parcelas e fixas aparecem como previstas.
4. **Prévia antes de salvar**: parcelamentos, recorrências e dívidas mostram o cronograma gerado antes de confirmar.
5. **Desfazer > confirmar**: toast com "Desfazer" para exclusões e mudanças de status; confirmação só para ações destrutivas grandes.
6. **Não genérico**: identidade própria (ver skill `frontend-design`), não o visual padrão de template.

## Identidade visual (aprovada no protótipo em 01/10/2026)
Protótipo de referência: https://claude.ai/artifact/TipKvxg72ojK7zERMLsgzH

| Token | Valor | Uso |
|---|---|---|
| Fonte | **Manrope** (títulos peso 600–700), números com `font-variant-numeric: tabular-nums` | todo o app |
| `--bg` | `#F4F3EE` | fundo (neutro quente) |
| `--surface` | `#FFFFFF` | cartões e painéis |
| `--text` | `#17201F` | texto principal |
| `--muted` | `#56625F` | texto secundário |
| `--primary` | `#0F4C5C` | verde-petróleo: ações, destaques |
| `--income` | `#1B6E45` | receitas |
| `--expense` | `#A23A28` | despesas |
| `--warning-bg` / `--warning-text` | `#FBEBD3` / `#6E4100` | alertas |
| Raio | 16–20px | cartões, botões grandes, sheets |

- Semânticas: transferência azul, previsto em tom atenuado com borda tracejada. Nunca só cor: sempre sinal (+/−) ou ícone.
- Modo escuro: derivar os mesmos tokens com contraste AA mínimo (definir em `apps/web/src/styles/tokens.css`).
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
- Offline: faixa discreta "Offline, mostrando dados de HH:MM".
- Erro: mensagem humana + tentar de novo.

## Formatos
`R$ 1.234,56` (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`), datas `dd/mm/aaaa` e relativas ("hoje", "amanhã", "em 3 dias"), meses "out/2026".

## Processo de design
1. Protótipos navegáveis das telas 1–6 como Artifact HTML (claude.ai) para aprovação do Samuel.
2. Aprovado o protótipo, tokens vão para `apps/web/src/styles/tokens.css` e componentes base no shadcn/ui.
3. Implementação com a skill `frontend-design`; gráficos com a skill `dataviz`.
4. Revisão de acessibilidade a cada tela (contraste, foco visível, labels, leitor de tela).
