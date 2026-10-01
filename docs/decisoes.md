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
