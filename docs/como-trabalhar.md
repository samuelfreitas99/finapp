# Como trabalhar no projeto

## Modelo de trabalho (decisão)
O Samuel **só conversa e aprova**, pelo projeto FinApp no claude.ai (app do celular ou web). O Claude decide e executa.

```
Samuel (claude.ai, celular/PC)
   │ conversa, aprova
   ▼
Claude do projeto ──(Remote Control)──> Claude Code rodando NO SERVIDOR
   │                                      instala, configura Docker, roda testes, faz deploy
   └──(nuvem)──> abre PRs no GitHub samuelfreitas99/finapp
```

- **Claude Code no servidor + Remote Control**: o Claude instalado no servidor recebe as tarefas do projeto, roda comandos de verdade (Docker, Postgres, testes) e convive com os containers já existentes.
- **Sessões na nuvem**: escrevem código e abrem PRs quando não precisa do servidor.
- **VS Code**: opcional, só se quiser ver o código (Remote-SSH no servidor).
- **Plano B quando o limite acabar**: qualquer IA (Antigravity/Gemini, Codex) lendo `AGENTS.md` e `docs/roadmap.md`.

## Configuração única no servidor (o que o Samuel faz uma vez)
Pelo terminal (ssh ou terminal do VS Code conectado ao servidor):
```bash
# 1. Instalar o Claude Code no servidor e fazer login
curl -fsSL https://claude.ai/install.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc   # o instalador avisa se faltar
source ~/.bashrc
claude            # faz login com a mesma conta do claude.ai; depois saia com /exit

# 2. Pasta do projeto
mkdir -p ~/projetos/finapp && cd ~/projetos/finapp

# 3. Deixar o Remote Control rodando mesmo fechando o terminal
sudo apt install -y tmux        # se ainda não tiver
tmux new -s claude
claude remote-control
# para sair do tmux sem parar: Ctrl+B e depois D
# para voltar depois: tmux attach -t claude
```
Depois disso, tudo o mais (Node, pnpm, clone do repositório, Docker, subdomínio no túnel, backup) o Claude faz pelo Remote Control, pedindo aprovação nas etapas sensíveis.

Se o servidor reiniciar: `tmux new -s claude`, `cd ~/projetos/finapp`, `claude remote-control`.

## Modelos e comandos
- Padrão no servidor: `/model opusplan` (Opus planeja, Sonnet executa). O Claude avisa quando vale trocar.
- Fase 1 (núcleo) e Fase 5 (dívidas): Opus. CRUDs, telas, testes, infraestrutura: Sonnet.
- `/clear` entre tarefas; `/compact` em sessões longas.

## Fluxo de cada tarefa
1. Samuel diz no projeto: *"pode seguir"* (ou pede algo específico).
2. O Claude pega a próxima tarefa de `docs/roadmap.md`, cria branch, implementa com testes, abre PR.
3. Samuel aprova o merge (ou o Claude faz merge quando autorizado para aquele tipo de tarefa).
4. Roadmap atualizado no mesmo PR.

## Economizando o limite
- Uma tarefa por sessão; contexto curto.
- Documentação já cobre as decisões: ninguém precisa redescobrir nada.
- Tarefas bem delimitadas ("implemente `nthBusinessDay` com testes da RN 2").
- Quando o limite acabar: outra IA continua por `AGENTS.md`; ao voltar, o roadmap mostra o estado.

## Convenções de código
- Commits: Conventional Commits em inglês (`feat(cards): add invoice date calculation`).
- Branch por tarefa; PR pequeno; CI verde antes do merge.
- Nomes em inglês no código; textos da interface em português (centralizados em `apps/web/src/lib/i18n/pt-BR.ts`).
- Funções do core documentadas com JSDoc citando a seção da RN (ex.: `@see RN 4`).
