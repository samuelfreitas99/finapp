# Trocar o domínio do FinApp

Roteiro para sair de `financas.voleidraft.top` para um domínio próprio (ex.: `app.meudominio.com.br`). **Nenhum dado se perde**: o banco não guarda o domínio. O que muda é só a configuração e o que cada navegador guarda por domínio.

## Antes (uma vez, no painel da Cloudflare)
1. Comprar o domínio (Registro.br para `.com.br`).
2. Na Cloudflare, **Add a domain** na **mesma conta** do `voleidraft.top` (plano Free).
3. No Registro.br, trocar os servidores DNS pelos dois que a Cloudflare mostrar. Esperar o domínio ficar "Active" na Cloudflare (minutos a algumas horas).

## No servidor (a IA faz, com o OK do Samuel no passo 2)
1. **Backup** como em toda publicação (`docker exec finapp-backup sh -c '. /etc/backup.env && backup.sh'`).
2. **Túnel**: `sudo bash /srv/finapp/infra/cloudflared/add-hostname.sh app.meudominio.com.br`
   - Faz backup do `config.yml`, insere a regra, valida, cria o DNS e reinicia o `cloudflared` (o voleidraft.top fica fora por alguns segundos: por isso precisa do OK).
   - Se o `route dns` falhar (o `cert.pem` do servidor é da zona voleidraft.top), criar no painel do domínio novo: `CNAME app → <id-do-túnel>.cfargotunnel.com`, proxy ligado. O script imprime o valor.
   - A regra antiga (`financas.voleidraft.top`) **continua** no túnel: é ela que redireciona.
3. **`infra/.env`**:
   ```
   APP_URL=https://app.meudominio.com.br
   REDIRECT_HOSTS=financas.voleidraft.top
   VAPID_SUBJECT=mailto:seu-email@exemplo.com
   ```
   `REDIRECT_HOSTS` faz a API responder **301** para o mesmo caminho no domínio novo a qualquer pedido que chegue pelo endereço antigo (links, favoritos, app instalado).
4. Recriar só a API: `docker compose -f infra/docker-compose.yml up -d --no-deps api`.
5. Conferir:
   - `https://app.meudominio.com.br/api/health` → 200
   - `curl -sI https://financas.voleidraft.top/dividas` → `301` com `location: https://app.meudominio.com.br/dividas`
   - entrar no app pelo domínio novo e abrir o Início.

## O que cada pessoa precisa fazer (mandar esta mensagem)
> O FinApp mudou de endereço: **https://app.meudominio.com.br**. Seus dados continuam lá.
> 1. Abra o endereço novo e entre com seu e-mail e senha (o código do autenticador continua o mesmo).
> 2. Apague o ícone antigo e instale de novo pelo endereço novo.
> 3. Em Mais › Notificações e configurações, ligue as notificações de novo.
> 4. Se usava chave de acesso (passkey) ou PIN, crie de novo em Configurações.
> 5. Se lançou algo sem internet e ainda não sincronizou, abra o app antigo com internet **antes** de trocar.

Por quê: sessão, chave de acesso, inscrição de notificações, app instalado, tema, PIN da tela e a fila offline ficam guardados no navegador **por domínio**.

## Depois
- Manter `REDIRECT_HOSTS` e a regra antiga do túnel por uns **3 meses**. Depois, tirar `REDIRECT_HOSTS` do `.env` e a regra `financas.voleidraft.top` do `config.yml` (o script de backup do config ajuda a desfazer se precisar).
- Atualizar `APP_URL` em `infra/.env.example`, os links em `README`/docs e o guia `instalar-no-celular.md`.

## Desfazer
Voltar `APP_URL` para `https://financas.voleidraft.top`, apagar `REDIRECT_HOSTS` e recriar a API. O túnel pode ficar com as duas regras.
