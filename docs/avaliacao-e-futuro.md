# Avaliação pós-lançamento e próximos passos (03/10/2026)

Revisão feita depois da Fase 9, a pedido do Samuel. Responde às dúvidas sobre domínio, dívidas, antecipação, espaços, menu "Mais", primeiro uso, IA, índices e abrir o app para mais gente. As tarefas que saíram daqui estão na **Fase 10** do `roadmap.md`.

## 1. Trocar de domínio (`financas.voleidraft.top` → domínio novo)

**Dá para trocar sem perder nenhum dado.** O banco não guarda o domínio; ele só aparece em `APP_URL` (`infra/.env`), que alimenta `trustedOrigins`, o `rpID` das passkeys e os links de convite.

O que muda para quem usa (tudo vem do navegador, que separa os dados por domínio):

| Item | O que acontece | Como resolver |
|---|---|---|
| Sessão (login) | Todos precisam entrar de novo | Normal, uma vez só |
| Passkeys (chave de acesso) | Param de funcionar (o `rpID` é o domínio) | Entrar com a senha e criar a chave de novo |
| App instalado (PWA) | O ícone antigo abre o domínio antigo | Instalar de novo pelo domínio novo |
| Notificações push | A inscrição é do domínio antigo | Ligar de novo em Configurações |
| Tema, PIN da tela, fila offline | Ficam no aparelho, no domínio antigo | Tema e PIN se refazem; **sincronize a fila offline antes** |
| 2FA (TOTP) | Continua funcionando (o código não depende do domínio) | Nada |

Roteiro da troca (Fase 10):
1. Adicionar o hostname novo ao túnel (generalizar `infra/cloudflared/add-financas-hostname.sh` para receber o hostname por parâmetro).
2. Trocar `APP_URL` (e `VAPID_SUBJECT`) no `infra/.env` e reiniciar só o `finapp-api`.
3. Manter o domínio antigo por uns 3 meses com **redirecionamento 301** para o novo (regra no Cloudflare), para links e ícones antigos.
4. Avisar os usuários: entrar de novo, reinstalar o app, religar notificações e recriar a passkey.

## 2. Tela de dívidas: avaliação de usabilidade

**O que está bom:** lista separada em "Você deve / Te devem / Quitadas" com totais e progresso; cadastro guiado ("Começando agora" / "Já estou pagando") com os dados que o app do banco mostra; prévia do cronograma antes de salvar; avançado recolhido; imóvel na planta com "Recebi as chaves".

**Problemas encontrados (por prioridade):**

1. **Pagar adiantado com o valor que o banco cobrou vira "parcial".** No formulário de pagar, se a pessoa digita o valor com desconto que o banco mostrou (menor que a parcela), o app registra pagamento **parcial** em vez de desconto. O único jeito de ter desconto é informar uma *taxa mensal*, que quase ninguém sabe. A API já aceita `discount` em valor; falta a tela. Correção: para parcela futura, perguntar "Quanto você pagou?" e, se for menor, oferecer "Foi desconto por antecipação" (padrão) ou "Paguei só uma parte".
2. **Não há "antecipar várias parcelas" na dívida.** O parcelamento do cartão tem ("Antecipar N parcelas"), a dívida não: hoje é uma por uma. Bancos costumam antecipar **as últimas** parcelas. Correção: ação "Adiantar parcelas" com quantidade, "das próximas" ou "das últimas", e o valor total cobrado (ou taxa).
3. **As ações ficam no fim da página, depois do cronograma.** Para achar "Amortizar" e "Quitar" é preciso rolar tudo; no imóvel ainda há três formulários juntos. Correção: logo abaixo do resumo, uma fileira de botões — **Pagar próxima**, **Adiantar**, **Amortizar**, **Quitar**, **Simular** — cada um abrindo seu formulário. "Cancelar dívida" vai para um menu discreto.
4. **"Amortizar" some quando a taxa não foi informada** (dívida "Já estou pagando" sem juros vira parcelas fixas). Correção: mostrar o cartão com a explicação "Para amortizar, informe a taxa de juros" e um botão que leva a editar.
5. **Não dá para editar a dívida.** A API tem `PATCH /debts/:id` (nome, instituição, valor do bem, observações), mas a tela não; errar o nome obriga a cancelar e cadastrar de novo. Correção: botão "Editar" no cabeçalho.
6. **"Para quitar hoje" pode confundir** em dívida sem taxa (é igual ao que falta pagar, sem desconto). Correção: dica "Sem a taxa de juros, o app não calcula o desconto de quitação".
7. **Lista sem urgência visual:** atraso aparece só no texto. Correção: selo vermelho "atrasada" e ordenar pela próxima parcela.
8. **Dívidas ficam escondidas no "Mais" no celular** (só o desktop tem na barra lateral). Ver item 5.

## 3. Adiantar parcelas e pagamentos em geral

| Onde | Já existe | Falta |
|---|---|---|
| Parcelamento no cartão / carnê | Antecipar N parcelas, com taxa de desconto opcional | Informar o valor cobrado em vez da taxa |
| Dívida | Pagar uma parcela futura com desconto por taxa; amortizar (Price/SAC); quitar tudo; simulador | Desconto em valor; várias parcelas de uma vez; "das últimas" (itens 2.1 e 2.2) |
| Fatura do cartão | Pagar total ou parcial a qualquer momento | — |
| Lançamento previsto (conta fixa, boleto) | "Confirmar" a qualquer momento | Conferir se dá para escolher a data real do pagamento ao confirmar antes do vencimento |

## 4. Espaços compartilhados e membros

Funciona: criar espaço, convidar por código (7 dias, uso único), aceitar já tendo conta ou no cadastro, remover membro, sair, renomear, seletor de espaço, visão consolidada, divisão do casal e audit log. Isolamento por `space_id` coberto por testes.

Lacunas:
- **Excluir espaço** e **transferir a posse** não existem; o dono não consegue sair (e, por isso, não consegue excluir a própria conta enquanto houver outros membros).
- Todo membro pode editar e apagar tudo (não há papel "só leitura").
- `owner_user_id` de contas e cartões existe no banco mas não é usado (não dá para marcar "este cartão é da Ana").
- Há **dois convites diferentes** ("Convidar pessoas", para criar conta no app, e o convite dentro de "Espaços e membros") — fácil confundir. Correção: deixar claro no texto de cada um e, no convite de espaço, explicar que serve também para quem ainda não tem conta.

## 5. Menu "Mais"

Hoje são **19 itens numa lista só, sem ordem lógica** (Relatórios perto do fim, Fixas e Parcelamentos depois de Exportar). Proposta de grupos:

- **Dinheiro:** Contas · Dívidas e empréstimos · Receitas e despesas fixas · Parcelamentos e carnês
- **Planejar:** Planejamento · Orçamentos · Metas · Relatórios · Simuladores
- **Dividir:** Espaços e membros · Divisão do casal · Racha entre amigos
- **Organizar:** Categorias · Lembretes e checklist · Importar extrato · Exportar dados
- **Conta e segurança:** Notificações e configurações · Convidar pessoas · Histórico de alterações · Tema · Sair

E, na barra inferior do celular, avaliar trocar "Cartões" por um item mais usado no dia a dia ou deixar o Início com atalhos para Dívidas e Planejamento.

## 6. O app é intuitivo para quem chega agora?

O Início já tem um estado vazio ("Comece pelas suas contas") e as telas têm estados vazios explicativos. Falta um **roteiro de primeiros passos**: um cartão no Início com checklist (1. cadastrar contas, 2. cartões, 3. salário, 4. contas fixas, 5. dívidas, 6. ligar notificações) que some quando concluído. Também ajudam: dicas "?" nos termos técnicos (Price, SAC, competência, previsto) e um link para o guia de instalação.

## 7. Vale colocar IA?

**Recomendação: não agora.** Motivos:
- Os dados são financeiros e pessoais; IA gratuita (Gemini, Groq etc.) envia esses dados para fora e o plano grátis pode usá-los ou mudar de regra a qualquer hora. Rodar um modelo no próprio servidor (Ollama) pesa no processador e divide a máquina com os outros projetos.
- O que a IA faria de mais útil já tem solução sem IA: categorização automática (regras da importação), simulações e alertas.

Se um dia fizer sentido, as ideias com melhor custo-benefício, nesta ordem:
1. **Lançamento por texto sem IA**: "mercado 52,90 nubank ontem" → preenche o "+" (regras simples, funciona offline).
2. Ler foto de comprovante (OCR local, ex.: Tesseract) para preencher valor e data.
3. Só então um assistente com IA, opcional por usuário, com aviso claro do que é enviado.

## 8. Índices (INCC, IGP-M, IPCA) do governo

Situação em 03/10/2026: `api.bcb.gov.br` continua sem DNS (o resto do `bcb.gov.br` responde). IPCA vem do IBGE e funciona.

**Alternativa encontrada e testada: IPEADATA** (Ipea, governo federal, gratuito, sem chave):
- IGP-M: `https://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='IGP12_IGPMG12')` (último: set/2026, 1,57%)
- INCC-M: `SERCODIGO='IGP12_INCCMG12'` (último: set/2026, 0,25%)

Plano: usar o Banco Central como fonte principal e o IPEADATA como reserva (como já é feito com IPCA: IBGE + BCB). Leitor novo em `packages/core/indexes`, com testes.

## 9. Abrir para mais pessoas (grátis ou SaaS)

A base já está pronta para vários usuários: dados separados por espaço, cadastro, 2FA, exportação e exclusão de conta. Hoje o cadastro **só com convite**, o que é bom enquanto é para amigos.

Para abrir ao público, nesta ordem:
1. **Domínio próprio** (item 1) e nome definitivo do app.
2. **Envio de e-mail** (confirmar e-mail e recuperar senha — hoje não existe "esqueci a senha"). Opções grátis: Brevo (300/dia) ou Resend (3.000/mês).
3. **LGPD:** política de privacidade e termos de uso, onde os dados ficam, como pedir exclusão (já existe) e exportação (já existe).
4. **Backup externo** (pendente desde a Fase 0) — obrigatório antes de guardar dados de estranhos.
5. Cadastro aberto com proteção contra robôs (Cloudflare Turnstile, grátis) e limite de tentativas.
6. Painel mínimo de administração (quantos usuários, uso do disco) e monitoramento (ex.: Uptime Kuma).

Capacidade: o servidor atual com Cloudflare Tunnel aguenta tranquilamente dezenas a poucas centenas de usuários. Acima disso, ou se virar negócio, vale um VPS (a partir de ~R$ 25/mês) por disponibilidade, já que hoje o app cai junto com o servidor de casa.

**SaaS (cobrar):** possível, mas exige CNPJ/MEI, cobrança recorrente (Mercado Pago, Asaas ou Stripe aceitam Pix/cartão; cobram taxa por transação, sem mensalidade), planos (ex.: grátis com 1 espaço, pago com espaços compartilhados e racha) e suporte. Sugestão: abrir **grátis com convite + lista de espera** primeiro, medir o uso e só depois decidir cobrar.
