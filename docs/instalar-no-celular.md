# Instalar o FinApp no celular

O FinApp é um **PWA**: instala direto do navegador, sem loja de aplicativos, e recebe avisos (push) como um app comum. Endereço: https://financas.voleidraft.top

## Android (Chrome)
1. Abra o endereço no **Chrome** e entre na sua conta.
2. Menu (⋮) › **Instalar app** (ou **Adicionar à tela inicial**).
3. Abra o FinApp pelo ícone novo. Ele abre em tela cheia, sem barra do navegador.
4. Em **Mais › Notificações e configurações**, toque em **Ligar notificações** e permita.

## iPhone (Safari, iOS 16.4 ou mais novo)
1. Abra o endereço no **Safari** (não no Chrome do iPhone).
2. Compartilhar › **Adicionar à Tela de Início**.
3. Abra pelo ícone da Tela de Início e só então ligue as notificações (no iPhone o aviso só funciona com o app instalado assim).

## Dicas
- O app se atualiza sozinho a cada versão nova (feche e abra o app uma vez).
- Sem internet, dá para lançar receitas e despesas: ficam numa fila e são enviadas quando a conexão volta.
- Bloqueio por PIN, 2FA e chaves de acesso ficam em **Mais › Notificações e configurações**.

## E o app "de loja" (Android nativo)?
Decisão no ADR-019: por enquanto **não**. O PWA já instala, abre em tela cheia e recebe push no Android. Um APK/TWA só entraria se surgir algo que o PWA não faz.

Se um dia for preciso (ADR-019 lista os gatilhos), o caminho é um TWA com o Bubblewrap:
1. Gerar o projeto com `bubblewrap init --manifest https://financas.voleidraft.top/manifest.webmanifest` (precisa de JDK e Android SDK).
2. Gerar a chave de assinatura (guardar fora do repositório e do servidor) e copiar o **SHA-256** dela.
3. Publicar `https://financas.voleidraft.top/.well-known/assetlinks.json` com o pacote e o SHA-256 (arquivo estático em `apps/web/public/.well-known/`), para o Chrome abrir sem a barra de endereço.
4. `bubblewrap build` gera o APK/AAB: instalar direto (sideload) ou enviar à Play Store (conta de desenvolvedor paga, US$ 25 uma vez).
