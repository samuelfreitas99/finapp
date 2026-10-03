# Regras de negócio

Fonte da verdade para os cálculos do FinApp. Toda regra aqui vira uma função pura em `packages/core` com testes cobrindo os exemplos desta página. Valores em centavos; datas `YYYY-MM-DD`.

---

## 1. Conceitos básicos

- **Espaço (space)**: dono dos dados. Todo usuário tem um espaço **pessoal** criado no cadastro. Pode criar ou entrar em espaços **compartilhados** (casal/família). Contas, cartões, lançamentos, dívidas, orçamentos pertencem a um espaço.
- **Carteira (account)**: onde o dinheiro está (corrente, poupança, dinheiro, investimento, benefício VR/VA, carteira digital).
- **Lançamento (transaction)**: receita, despesa ou transferência. Tem `date` (quando acontece/aconteceu) e `status`:
  - `planned` (previsto): ainda não aconteceu. Não altera o saldo atual; entra no saldo previsto.
  - `settled` (efetivado): pago/recebido. Altera o saldo atual.
- **Competência**: mês ao qual o gasto pertence para relatórios. Para cartão, é o mês da **fatura** (padrão) com opção de visão por data da compra.

### Saldos
- `saldo_atual(conta) = saldo_inicial + Σ receitas settled - Σ despesas settled ± transferências settled` (até hoje, inclusive).
- `saldo_previsto(conta, data) = saldo_atual + Σ lançamentos planned com date <= data` (inclui pagamentos de fatura previstos e parcelas de dívida previstas debitadas daquela conta).
- Lançamentos de cartão **não** mexem em conta nenhuma; quem mexe é o **pagamento da fatura**.
- Ajuste de saldo: o usuário informa o saldo real; lançamento do tipo `adjustment`, efetivado, com a diferença **com sinal** (`saldo_real − saldo_efetivado_até_a_data`), categoria "Ajuste", fora dos relatórios de gasto. Sem diferença, nada é criado.
- O saldo inicial vale na `initial_date` da conta e já inclui o que aconteceu antes: lançamentos com data anterior são recusados.
- Efetivado com data futura é recusado (o que ainda vai acontecer é `planned`). Ao efetivar um previsto sem informar a data, usa a data prevista se já passou, senão hoje.

### Transferência
Dois lançamentos ligados por `transfer_id` (saída na origem, entrada no destino), mesmo valor, excluídos de relatórios de receita/despesa.

---

## 2. Datas e dias úteis

- **Dia útil**: segunda a sexta que não está na tabela `holidays` (nacionais + os locais que o espaço cadastrar).
- **Feriados nacionais**: fixos (01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11, 25/12) + móveis calculados a partir da Páscoa (Carnaval segunda e terça como ponto facultativo, configurável; Sexta-feira Santa; Corpus Christi como configurável). O core calcula a Páscoa (algoritmo de Meeus/Butcher), sem dependência externa.
- **Dia inexistente no mês** (31 em abril, 29-31 em fevereiro): usar o último dia do mês (`clampDay`).
- `nthBusinessDay(ano, mês, n)`: n-ésimo dia útil do mês. Ex.: 5º dia útil de setembro/2026 = 08/09/2026 (01 ter, 02 qua, 03 qui, 04 sex, 07 é feriado, 08 ter).
- `lastBusinessDay(ano, mês)`.
- Ajuste para dia não útil (`businessDayAdjust`): `none` | `previous` (antecipa) | `next` (adia).
- **Vencido de fato** (`isPastDue`): conta que vence em fim de semana ou feriado pode ser paga no dia útil seguinte sem multa, então só está atrasada **depois** desse dia útil. Vale para parcela de dívida (`late`), fatura (`overdue`), aviso "Venceu" e contagem de vencidos do Início. A data exibida continua sendo a do contrato.

---

## 3. Regras de recorrência (receitas e despesas fixas)

Uma `recurrence` gera lançamentos `planned` para frente (janela padrão: 12 meses; um job diário mantém a janela).

Campos:
- `frequency`: `monthly` | `weekly` | `yearly` | `every_n_months` (com `interval`).
- `day_rule`: `fixed_day` (dia D, com clamp) | `nth_business_day` (N) | `last_business_day`.
- `adjust`: `none` | `previous` | `next` (só para `fixed_day`).
- `start_date`, `end_date` opcional, `amount`, conta ou cartão de destino, categoria.
- `parts` (opcional, para salário dividido): lista de partes, cada uma com `day_rule`, `amount` ou `percent`, e `month_offset` (0 = mesmo mês de referência, 1 = mês seguinte).

### Salário dividido (exemplo)
Salário de R$ 5.000 com adiantamento de 40% no dia 15 e o restante no 5º dia útil do mês seguinte:
```
parts: [
  { label: "Adiantamento", percent: 40, day_rule: fixed_day 15, adjust: previous, month_offset: 0 },
  { label: "Salário",      percent: 60, day_rule: nth_business_day 5,           month_offset: 1 }
]
```
Referência setembro/2026 gera: R$ 2.000 em 15/09/2026 e R$ 3.000 em 07/10/2026 (5º dia útil de outubro: 01 qui, 02 sex, 05 seg, 06 ter, 07 qua).
Percentuais: a última parte recebe o resto, para a soma bater no centavo.

### Edição
- Alterar valor/regra **"a partir deste mês"**: encerra a recorrência atual no mês anterior e cria uma nova. Lançamentos já `settled` nunca mudam.
- Alterar **só uma ocorrência**: edita o lançamento gerado e marca `detached = true` (o job não sobrescreve).
- Valor variável (`variable_amount`), em despesas (conta de luz) **e em receitas** (salário com horas extras, feriados, comissão), inclusive no salário em partes: os `planned` usam o valor informado como estimativa (`estimated = true`) e, ao confirmar, a pessoa informa o valor real (o lançamento deixa de ser estimado). Os meses seguintes continuam com a estimativa.

### Receitas avulsas
Lançamento único `planned` (a receber) com data prevista, ou `settled` se já recebido.

---

## 4. Cartão de crédito e fatura

Cartão: `limit`, `closing_day`, `due_day`, `closing_day_goes_to_next` (bool, padrão `true`: compra **no** dia do fechamento já vai para a próxima fatura), `payment_account_id`.

### Datas de uma fatura
Fatura identificada pelo **mês de vencimento** (`reference_month`, `YYYY-MM`).
- `due_date = clampDay(reference_month, due_day)`.
- `closing_date`: o fechamento que precede o vencimento. Se `due_day > closing_day`, o fechamento está no mesmo mês do vencimento; senão, no mês anterior. Aplica `clampDay`.
- Overrides por fatura (`closing_date_override`, `due_date_override`) para quando o banco muda a data num mês.

### Em qual fatura cai uma compra (`invoiceForPurchase`)
Dada a data da compra `p`, encontrar a primeira fatura cujo período a contém:
- período da fatura = (fechamento anterior, fechamento atual], ajustado pela regra do dia do fechamento:
  - `closing_day_goes_to_next = true`: compra em `p < closing_date` entra; `p == closing_date` vai para a próxima.
  - `false`: `p <= closing_date` entra.

Exemplo: fechamento dia 3, vencimento dia 10, regra `true`.
- Compra 02/10/2026 → fecha 03/10 → fatura de **outubro/2026** (vence 10/10).
- Compra 03/10/2026 → fatura de **novembro/2026** (vence 10/11).
- **Melhor dia de compra** = dia do fechamento (com regra `true`) ou dia seguinte (com `false`).

Exemplo com vencimento antes do fechamento no mês: fechamento 25, vencimento 5. Fatura de novembro/2026 vence 05/11 e fecha 25/10. Compra 20/10 → novembro; compra 26/10 → dezembro.

### Estados da fatura
`open` (hoje < fechamento) → `closed` (fechou, não paga) → `paid` | `partial` | `overdue` (passou do vencimento sem pagamento total).
- `total = Σ itens` (compras, parcelas, assinaturas, encargos, estornos negativos, saldo anterior não pago).
- **Pagar fatura**: cria um lançamento de despesa na conta escolhida (categoria técnica "Pagamento de fatura", fora dos relatórios de gasto, porque os itens já contam como gasto) e registra em `invoice_payments`. Pode haver vários pagamentos.
- **Pagamento parcial**: o restante vira item "Saldo anterior" na próxima fatura; o usuário pode lançar juros/IOF do rotativo como item "Encargos".
- O pagamento da fatura é sugerido como lançamento `planned` na data de vencimento, com o total atual, para entrar na projeção.

### Limite disponível
`limite - Σ itens ainda não pagos de todas as faturas (abertas, fechadas e futuras, incluindo parcelas futuras) + Σ pagamentos já feitos`. Estornos liberam limite.

### Estorno
Item negativo na fatura em que cai a data do estorno. Estorno de compra parcelada: ver 5.4.

---

## 5. Compras parceladas

`installment_plan`: `total_amount`, `installments` (N), `first_date` (data da compra), `card_id` **ou** `account_id` (carnê/boleto), `interest` opcional, `start_installment` (para cadastrar plano já em andamento).

### 5.1 Divisão de centavos
`base = floor(total / N)`, `resto = total - base*N`. A **1ª parcela** recebe `base + resto`, as demais `base`.
Ex.: 10000 em 3x → 3334, 3333, 3333.
Se o usuário informar o valor da parcela em vez do total: `total = parcela * N` (o banco já arredonda).

### 5.2 Distribuição nas faturas
Parcela 1 vai na fatura de `invoiceForPurchase(first_date)`; parcela k vai na fatura `k-1` meses depois. Cada parcela é um lançamento com `installment_plan_id` e `installment_number`. A `date` da parcela k é `first_date + (k-1) meses` (com clamp) para ordenação; a fatura é o que manda.

Parcelamento fora do cartão: parcela k vence em `first_due_date + (k-1) meses` (com clamp e ajuste de dia útil opcional), como lançamento `planned` na conta.

### 5.3 Plano já em andamento
"Estou na parcela 4 de 10": gera só as parcelas 4..10, a 4 na fatura atual. Parcelas 1..3 não são criadas (opção de criar como históricas já pagas).

### 5.4 Cancelar / devolver
Cancela as parcelas ainda não faturadas (faturas `open` e futuras) com `deleted_at`, e cria estorno na fatura aberta para parcelas já em faturas fechadas, se o banco devolver.

### 5.5 Antecipar parcelas
Escolher K parcelas (as últimas, padrão dos bancos) para trazer à fatura aberta atual. Desconto opcional (valor informado ou taxa mensal: valor presente `parcela / (1+i)^m`, m = meses de antecipação), somado em frações exatas e arredondado para baixo (nunca a favor do usuário em 1 centavo). As parcelas antecipadas mudam de fatura e ganham `anticipated = true`; o desconto vira item negativo "Desconto antecipação".

### 5.6 Painel do parcelamento
`pagas` = parcelas em faturas `paid`; `restantes = N - pagas`; `valor_pago`, `valor_restante`, `% por valor`, `% por parcelas`.

---

## 6. Dívidas e empréstimos

`debt`: `direction` (`i_owe` devo | `owed_to_me` me devem), `kind` (`bank_loan`, `card_loan`, `personal_loan`, `third_party_card`, `financing`, `agreement`, `consortium`, `property`, `other`), `creditor` (contato ou instituição), `principal` (valor recebido/emprestado), `payment_account_id`, `status` (`active`, `paid_off`, `cancelled`).

Uma dívida tem **uma ou mais fases** (`debt_phases`); a maioria tem uma só.

### 6.1 Sistemas de cálculo da fase
- `fixed`: N parcelas de valor informado (ou total/N com a regra de centavos de 5.1).
- `price`: parcela constante `PMT = PV * i / (1 - (1+i)^-n)`. Para cada parcela: juros = saldo * i; amortização = PMT - juros. Arredondar juros ao centavo (half-up) e ajustar a última parcela para zerar o saldo.
- `sac`: amortização constante `PV/n`; juros = saldo * i; parcela = amortização + juros.
- `variable`: valor informado mês a mês (juros de obra). Meses futuros sem valor usam o último valor informado como **estimativa** (`estimated = true`).
- `balloon`: parcelas únicas em datas específicas (intermediárias/anuais).

Taxa: o usuário pode informar mensal ou anual; conversão `i_m = (1+i_a)^(1/12) - 1`.

### 6.2 Correção por índice (fase com `index` = INCC, IPCA, IGP-M)
O usuário (ou um job, no futuro) informa o índice do mês em `index_values`. O saldo devedor e as parcelas seguintes são multiplicados por `(1 + índice)` no mês de aniversário/mensalmente conforme a fase. Parcelas já pagas não mudam.

### 6.3 Parcelas (`debt_installments`)
Cada parcela: `number`, `due_date`, `amount` previsto, `principal_part`, `interest_part`, `paid_amount`, `paid_date`, `status` (`pending`, `paid`, `late`, `partial`). Pagar uma parcela cria uma despesa `settled` na conta (categoria "Dívidas" ou a da dívida) ligada por `debt_installment_id`. Parcelas pendentes aparecem como `planned` na projeção.

Se a dívida é paga **por cartão** (ex.: empréstimo na fatura), as parcelas viram itens de fatura em vez de lançamentos de conta.

### 6.4 Painel da dívida
- `parcelas_pagas / total`, `restantes`
- `valor_pago = Σ paid_amount`, `valor_restante = Σ amount das pendentes` (para `price`/`sac`: mostrar também o **saldo devedor** = principal ainda não amortizado, que é o valor para quitar hoje sem juros futuros)
- `% quitado por valor = valor_pago / (valor_pago + valor_restante)`, `% por parcelas`
- `juros_pagos`, `juros_a_pagar`, `data_prevista_quitação`
- Atrasadas: `due_date < hoje` e não pagas.

### 6.4.1 Cadastro de dívida em andamento
A pessoa informa o que vê no app do banco: quantas parcelas faltam, o próximo vencimento e o valor da parcela. Com a taxa mensal (opcional), a fase vira Price com o saldo devedor calculado pelo valor presente das parcelas restantes (`principalFromPayment`, arredondado para baixo); sem a taxa, parcelas fixas. Com o total de parcelas do contrato (opcional), as anteriores entram como já pagas (sem lançamento) para mostrar o progresso desde o começo.

### 6.5 Pagar adiantado e amortizar
- **Pagar parcela adiantada**: marcar parcela futura como paga hoje (com desconto opcional, igual 5.5). Na tela, a pessoa digita **quanto pagou**; se for menos que a parcela e antes do vencimento, escolhe "Foi desconto" (padrão: a parcela fica paga com `discount` = diferença) ou "Ainda falta pagar" (fica parcial). A taxa mensal continua como opção.
- **Adiantar várias parcelas** (`planAdvance` no core): K parcelas futuras sem pagamento (vencimento depois da data do pagamento), **as últimas** (padrão, como os bancos fazem: a parcela não muda e o contrato acaba antes) ou as próximas. Desconto pelo **total cobrado** (soma − total, repartido na proporção de cada parcela, arredondado para baixo, resto na mais distante) ou por taxa mensal (valor presente de cada parcela). Um único lançamento na conta ("Adiantamento: ..."); sem conta, só marca como pagas. Não registra evento (as parcelas guardam pago e desconto).
- Dívida cadastrada sem taxa (parcelas fixas) não pode ser amortizada; a tela explica e sugere adiantar as últimas parcelas, que tem o mesmo efeito.
- **Amortização extraordinária** (price/sac): valor extra abate o saldo devedor. Opção `reduce_term` (mantém a parcela, recalcula e remove parcelas do fim) ou `reduce_installment` (mantém o prazo, recalcula as parcelas). Recalcular só parcelas pendentes.
- **Quitação total**: paga o saldo devedor, cancela pendentes, status `paid_off`.

### 6.6 Casos especiais
- **Cartão de outra pessoa** (`third_party_card`): você usou o cartão do João para comprar ou sacar. Vira dívida com o contato João, com as parcelas que você repassa a ele (em datas que você combinar, padrão: vencimento do cartão dele). Não entra em nenhuma fatura sua.
- **Empréstimo no cartão / saque** (`card_loan`): valor recebido entra numa conta (receita técnica "Empréstimo recebido", fora dos relatórios de renda); parcelas vão para as faturas do seu cartão.
- **Peguei dinheiro emprestado de alguém** (`personal_loan`, `i_owe`): entrada na conta + cronograma com o contato.
- **Emprestei para alguém** (`owed_to_me`): saída da conta (fora dos relatórios de gasto) + parcelas a receber como receitas `planned`.
- O dinheiro recebido de um empréstimo não é renda e o pagamento do principal não é gasto de consumo; relatórios mostram juros como custo.

### 6.7 Imóvel na planta (dívida `property` com fases)
Exemplo de cadastro:
| Fase | Sistema | Período | Observação |
|---|---|---|---|
| Entrada/sinal | `fixed` | 24 parcelas a partir de 11/2026 | direto com a construtora, pode ter índice INCC |
| Intermediárias | `balloon` | dezembro de cada ano | anuais |
| Juros de obra | `variable` | desde a assinatura até `completion_date` | valor muda todo mês |
| Financiamento | `price` ou `sac` | a partir de `completion_date + 1 mês` | índice IPCA/IGP-M + juros |

- `completion_date` é a **previsão** de entrega das chaves (o contrato costuma dar um prazo maior, `completion_deadline`, que é só informativo: o pior caso). O cronograma e a projeção usam a previsão. Alterá-la estende/encurta os juros de obra e desloca o início do financiamento (regenera só as parcelas pendentes dessas fases; as pagas ficam).
- **"Recebi as chaves"**: grava a data real (`completion_confirmed = true`), os juros de obra terminam no mês da entrega e o financiamento começa no mês seguinte. Depois disso a data não muda mais como estimativa.
- Painel do imóvel: pago e restante por fase e total, % geral, valor do imóvel (manual) e patrimônio líquido = valor - saldo devedor.

---

## 7. Projeção (fluxo de caixa futuro)

Para cada mês dos próximos 12 (configurável até 36):
- `receitas_previstas` (recorrências, avulsas planned, parcelas a receber)
- `despesas_fixas` (recorrências de despesa em conta)
- `faturas` (total de cada fatura com vencimento no mês, incluindo parcelas já lançadas e assinaturas). Fatura com total negativo (estornos maiores que as compras) entra como crédito, reduzindo o comprometido.
- `dívidas` (parcelas pendentes pagas por conta)
- `saldo_final = saldo_inicial_do_mês + receitas - despesas`; o saldo inicial do mês 1 é o saldo atual somado das contas marcadas `include_in_totals`.
- **Comprometido** = faturas futuras + dívidas + fixas. **Livre** = receitas - comprometido.
- Meses com `saldo_final < 0` ficam em destaque.

---

## 8. Orçamentos e metas

- **Orçamento**: limite mensal por categoria (ou grupo). `consumido` = despesas da categoria na competência do mês (cartão pela fatura). Alertas em 80% e 100%. Opção de acumular sobra para o mês seguinte.
- **Meta**: valor alvo, data alvo, conta vinculada opcional. `aporte_sugerido = (alvo - guardado) / meses_restantes`. Aportes são transferências para a conta da meta ou marcações manuais.

---

## 9. Alertas

Job diário (08:00 `America/Sao_Paulo`) e jobs por evento geram `notifications` e enviam Web Push conforme `notification_settings`:
| Tipo | Quando |
|---|---|
| `due_soon` | lançamento planned de despesa ou parcela de dívida vence em X dias (padrão 3) e no dia |
| `overdue` | vencido e não pago |
| `invoice_closing` | fatura fecha amanhã |
| `invoice_closed` | fatura fechou (com total) |
| `invoice_due` | fatura vence em X dias e no dia |
| `income_unconfirmed` | receita prevista não confirmada 1 dia depois |
| `negative_forecast` | saldo previsto do mês ficará negativo |
| `budget` | orçamento em 80% / 100% |
| `card_limit` | uso do limite acima de 80% |
| `split_pending` | racha com saldo pendente há X dias |
| `weekly_summary` | resumo da semana (segunda, 08:00); começa desligado |
| `monthly_summary` | resumo do mês anterior (dia 1º, 08:00); começa desligado |
Horário de silêncio respeitado. Uma notificação por evento (idempotência por chave `tipo+entidade+data`).

---

## 10. Espaço compartilhado (casal/família)

- Espaço `shared` com membros (`owner`, `member`). Membros veem e editam tudo do espaço.
- Cada usuário pode alternar entre espaços; o dashboard pode mostrar **consolidado** (pessoal + compartilhados).
- **Divisão de contas no casal**: cada despesa do espaço compartilhado pode ter `split`: `equal`, `percent` (ex.: 60/40 proporcional à renda), `amount` ou `none`. Padrão do espaço configurável. Se uma pessoa pagou com dinheiro pessoal, gera saldo entre os membros, igual ao racha (seção 11), e o app mostra "Ana deve R$ X a Samuel".
- Lançamentos pessoais nunca aparecem no espaço compartilhado.

## 11. Racha entre amigos (grupos de divisão)

Estilo Splitwise, separado das finanças do espaço (os participantes podem nem ter conta no app):
- **Grupo** (ex.: "Viagem Floripa") com participantes: usuários do app ou contatos sem conta.
- **Despesa do grupo**: quem pagou (um ou vários, com valores), como dividir (`equal`, `percent`, `amount`, `shares`), participantes incluídos.
- **Saldo**: para cada participante, `pagou - deve`. Divisão de centavos: o resto vai para quem pagou.
- **Simplificar dívidas**: algoritmo guloso que casa maiores devedores com maiores credores, minimizando o número de pagamentos.
- **Acertar (settle up)**: registrar pagamento entre dois participantes (Pix, dinheiro).
- **Integração com as finanças**: se você é usuário do app, sua parte de cada despesa pode virar lançamento no seu espaço (opcional), e o que você pagou pelos outros vira "a receber". Acertos podem gerar lançamento na sua conta.
- Convite por link para amigos com conta acompanharem o grupo.

---

## 12. Importação (V2)

- OFX e CSV de extrato; CSV de fatura. Mapeamento de colunas salvo por banco.
- Deduplicação: mesmo valor, data ±2 dias e descrição similar, ou `fit_id` do OFX.
- Regras automáticas de categoria aplicadas na importação.
- **Fora de escopo**: Open Finance/agregadores pagos.
