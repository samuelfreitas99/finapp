# Registro de decisões (ADRs)

Formato: contexto → decisão → consequências. Para mudar uma decisão, adicione uma nova entrada que a substitua; não apague as antigas.

## ADR-001 PWA em vez de app Android nativo (01/10/2026)
Contexto: app pessoal para o Samuel e amigos, alguns podem ter iPhone; sem interesse em loja de apps.
Decisão: PWA instalável, mobile-first.
Consequências: um código para todas as plataformas, atualização instantânea, push no Android e iOS 16.4+. Sem leitura de notificações do banco e widgets. Se necessário, empacotar com Capacitor depois.

## ADR-002 HTTPS via Cloudflare Tunnel no domínio existente `voleidraft.top` (01/10/2026)
Contexto: PWA exige HTTPS; o servidor já roda cloudflared com outro site; Samuel não quer lidar com certificados.
Decisão: usar o túnel existente com um subdomínio novo do domínio atual. Domínio próprio pode ser comprado depois sem impacto.
Consequências: zero configuração de certificado e de roteador; depende da Cloudflare (plano gratuito).

## ADR-003 PostgreSQL local em vez de Supabase (01/10/2026)
Contexto: servidor próprio com Docker; dados financeiros sensíveis; plano gratuito do Supabase pausa após 7 dias sem uso.
Decisão: PostgreSQL 17 em Docker, sem porta pública, com backup diário criptografado externo.
Consequências: privacidade e sem limites; disponibilidade depende do servidor de casa (mitigado com cache offline do PWA).

## ADR-004 TypeScript full-stack em monorepo (01/10/2026)
Decisão: pnpm workspaces com `packages/core` (regras puras), `packages/shared` (Zod), `apps/api` (Fastify + Drizzle + Better Auth + pg-boss), `apps/web` (React + Vite + PWA + Tailwind/shadcn).
Consequências: regras e validações compartilhadas entre API e front; uma linguagem para qualquer IA ou pessoa continuar.

## ADR-005 Núcleo primeiro, depois fatias verticais (01/10/2026)
Decisão: regras de cálculo em `packages/core` com testes antes de qualquer tela; depois cada funcionalidade de ponta a ponta.

## ADR-006 Dinheiro em centavos inteiros, datas sem fuso (01/10/2026)
Decisão: `bigint` centavos; `date` para datas de calendário; fuso de referência `America/Sao_Paulo`.

## ADR-007 Dados pertencem a espaços, não a usuários (01/10/2026)
Contexto: Samuel quer espaço compartilhado de casal.
Decisão: todas as tabelas de domínio usam `space_id`; cada usuário tem um espaço pessoal; espaços compartilhados têm membros.
Consequências: compartilhamento nasce no modelo, sem migração futura dolorosa.

## ADR-008 Racha entre amigos como módulo separado dos espaços (01/10/2026)
Decisão: grupos de divisão estilo Splitwise com participantes que podem não ter conta; integração opcional com as finanças do usuário.

## ADR-009 Sem Open Finance (01/10/2026)
Contexto: agregadores têm custo alto.
Decisão: fora de escopo. Importação por OFX/CSV cobre a necessidade.

## ADR-010 Recomeçar do zero em vez de aproveitar o repositório `finanapp` antigo (01/10/2026)
Contexto: tentativa anterior em FastAPI + Next.js, com `venv` commitado, segredos de teste no compose e repositório público.
Decisão: novo repositório privado `finapp` com a stack desta documentação. O antigo pode ser arquivado.

## ADR-011 Ferramentas de desenvolvimento (01/10/2026)
Decisão: Claude Code instalado **no servidor**, ligado ao projeto do claude.ai por **Remote Control**: o Samuel só conversa e aprova pelo projeto (app/web); o Claude no servidor instala, configura e roda tudo. Sessões na nuvem do claude.ai abrem PRs. VS Code com Remote-SSH fica opcional, para ver o código. Documentação agnóstica (AGENTS.md) para permitir continuar com outra IA (ex.: Antigravity/Gemini). Detalhes em `como-trabalhar.md`.

## ADR-012 Portas e nomes no servidor compartilhado (01/10/2026)
Contexto: o servidor já usa as portas 3000 (voleidraft), 5173 (centralsuporte) e tem containers antigos parados de um projeto Compose chamado `finapp` (com volume `finapp_postgres_data`). O `cloudflared` roda no host (systemd), não em Docker.
Decisão: projetos Compose `finapp-dev` e `finapp-prod`; containers `finapp-dev-db`, `finapp-api`, `finapp-db`. Dev: API 3001, web 5174, Postgres `127.0.0.1:5433`. Produção: API publicada só em `127.0.0.1:3010` para o cloudflared do host; banco sem porta publicada.
Consequências: nenhum conflito com os outros projetos nem reaproveitamento acidental do volume antigo. A API escuta em 3000 dentro do container.

## ADR-013 Ajuste de saldo com valor com sinal (01/10/2026)
Contexto: `transactions.amount` era sempre positivo e o tipo dava o sentido, mas o ajuste (RN 1) pode aumentar ou diminuir o saldo, e `adjustment` é um tipo só.
Decisão: só no tipo `adjustment` o `amount` guarda a diferença com sinal (≠ 0); os demais tipos continuam > 0. Check `transactions_amount_check` (migração `0002`). A regra de sinal fica em `packages/core/balances` (`signedAmount`).
Consequências: um tipo a menos para tratar nos relatórios; quem soma valores precisa usar `signedAmount` em vez de assumir positivo.

## ADR-014 Front sem Tailwind/shadcn e com React Router (01/10/2026)
Contexto: a ADR-004 previa Tailwind + shadcn/ui, TanStack Router e react-hook-form. Na hora de implementar, a identidade já aprovada no protótipo cabe em poucos tokens e componentes, e os formulários são curtos.
Decisão: CSS próprio com variáveis (`styles/tokens.css` com claro/escuro, `styles/app.css` com os componentes base), React Router (modo data) e TanStack Query; formulários com estado do React. Fonte Manrope empacotada (`@fontsource-variable/manrope`, funciona offline no PWA).
Consequências: menos dependências e build menor; quem mexer no front usa as classes de `app.css` em vez de utilitários. Se surgirem diálogos/menus complexos, adicionar primitivas acessíveis (ex.: Radix) pontualmente.

## ADR-015 Cor principal azul-marinho (02/10/2026)
Contexto: o Samuel não gosta de verde; o verde-petróleo do protótipo era a cor da marca.
Decisão: cor principal azul-marinho `#1F3A68` (azul-claro `#8EB2EC` no modo escuro), aplicada aos tokens, ao manifest do PWA e aos ícones. O verde fica só como cor semântica de receita. Transferência passa de azul para violeta, para não se confundir com a marca. Todos os pares de texto conferidos com WCAG AA.
Consequências: identidade visual difere do protótipo só na cor; layout e tipografia seguem aprovados.

## ADR-016 Comprovantes guardados no Postgres (03/10/2026)
Contexto: o roadmap pede anexos de comprovantes. O modelo previa `file_path` (arquivo em disco), mas isso exigiria um volume novo no compose e o backup cobrir dois lugares.
Decisão: o arquivo fica na coluna `attachments.data` (`bytea`), limitado a 8 MB e 10 por lançamento, só JPG, PNG, WebP ou PDF (tipo conferido pelos primeiros bytes). O app reduz fotos grandes (máx. 1800 px) antes de enviar. Exclusão lógica (`deleted_at`).
Consequências: o `pg_dump` diário já inclui os comprovantes e não há infraestrutura nova; o banco cresce mais rápido (fotos reduzidas ficam em ~300 KB). Se o volume virar problema, mover os bytes para disco/objeto sem mudar a API (`/attachments/:id/file`).

## ADR-017 Metas em estilo cofrinho (03/10/2026)
Contexto: a primeira versão das metas usava o saldo inteiro da conta vinculada como "guardado". Com uma conta só e várias metas, todas mostravam o mesmo valor, e o dinheiro de uma meta parecia estar em todas.
Decisão: cada meta tem o próprio cofrinho: o guardado é a soma dos aportes e retiradas (`goal_deposits`, com histórico e desfazer). A conta vinculada é opcional e só informativa ("onde o dinheiro está"); o app avisa quando o total reservado nas metas passa do saldo da conta. Aportes não movem dinheiro entre contas (é uma reserva no papel).
Consequências: várias metas podem apontar para a mesma conta sem se misturar; o valor guardado não muda sozinho quando o saldo da conta muda. Migração 0019 transforma o "valor marcado à mão" antigo no primeiro aporte.

## ADR-018 Padrão de navegação: "voltar" e rolagem (03/10/2026)
Contexto: algumas telas tinham botão de voltar e outras não, e uma tela nova abria na rolagem da anterior.
Decisão: as 4 telas da barra inferior (Início, Lançamentos, Cartões, Mais) não têm "voltar"; toda outra tela tem. "Voltar" desfaz a última navegação (a tela anterior reabre onde estava); se a tela foi aberta direto por link, vai para a tela-mãe indicada em `back`. A rolagem é restaurada ao voltar e volta ao topo ao abrir uma tela nova (`ScrollRestoration`).
Consequências: no desktop, os itens da barra lateral que não são abas (Contas, Dívidas...) também mostram "voltar", que leva à tela anterior.

## ADR-019 Sem app Android empacotado por enquanto (03/10/2026)
Contexto: o roadmap previa "empacotar como app Android (Capacitor/TWA), se fizer falta". O app já é um PWA com manifest, ícones (inclusive maskable), service worker e push (Web Push/VAPID) testados no Android.
Decisão: não empacotar agora. O Chrome instala o PWA em tela cheia e entrega as notificações; um APK/TWA exigiria JDK + Android SDK no servidor, uma chave de assinatura para guardar e manter, o arquivo `assetlinks.json` e, para a Play Store, conta paga, sem ganho funcional.
Gatilhos para rever: precisar de algo que PWA não faz (ler SMS/notificações de banco, widgets, biometria nativa fora do WebAuthn), entrega por loja para quem não sabe instalar o PWA, ou o Chrome deixar de oferecer a instalação. O caminho (Bubblewrap/TWA) está em `docs/instalar-no-celular.md`.
Consequências: nada a manter além do PWA; o guia de instalação para Android e iPhone fica em `docs/instalar-no-celular.md`.

