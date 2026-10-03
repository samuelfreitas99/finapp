#!/usr/bin/env bash
# Adiciona um hostname do FinApp ao túnel Cloudflare existente (cloudflared rodando
# no host via systemd, com config local em /etc/cloudflared/config.yml).
#
# Uso: sudo bash /srv/finapp/infra/cloudflared/add-hostname.sh <hostname> [serviço]
#   ex.: sudo bash .../add-hostname.sh financas.voleidraft.top
#        sudo bash .../add-hostname.sh app.meudominio.com.br http://localhost:3010
# Sem argumento, usa financas.voleidraft.top (o hostname original).
# Para um domínio novo (não subdomínio de voleidraft.top), o domínio precisa estar na
# mesma conta da Cloudflare; veja docs/trocar-dominio.md.
#
# O que faz:
#  1. backup do config.yml com data/hora;
#  2. insere a regra do FinApp antes da regra final http_status:404 (se ainda não existir);
#  3. valida o config; se falhar, restaura o backup e sai sem reiniciar nada;
#  4. cria o DNS do subdomínio, se houver cert.pem de login do cloudflared;
#  5. reinicia o cloudflared (voleidraft.top fica fora por poucos segundos);
#  6. testa voleidraft.top e o hostname novo.
set -euo pipefail

CONFIG="${CONFIG:-/etc/cloudflared/config.yml}"
HOSTNAME_NEW="${1:-financas.voleidraft.top}"
SERVICE_NEW="${2:-http://localhost:3010}"

if [[ ! "$HOSTNAME_NEW" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]]; then
  echo "Hostname inválido: $HOSTNAME_NEW (use letras minúsculas, ex.: app.meudominio.com.br)" >&2
  exit 1
fi
DRY_RUN="${DRY_RUN:-0}" # DRY_RUN=1 só altera o arquivo (para testes), sem validar/reiniciar

log() { printf '\n==> %s\n' "$*"; }

# Insere a regra antes da linha "- service: http_status:404", com a mesma indentação.
insert_rule() {
  local file="$1"
  awk -v host="$HOSTNAME_NEW" -v svc="$SERVICE_NEW" '
    !done && /^[[:space:]]*-[[:space:]]*service:[[:space:]]*http_status:404/ {
      match($0, /^[[:space:]]*/)
      indent = substr($0, 1, RLENGTH)
      print indent "# FinApp (" host ")"
      print indent "- hostname: \"" host "\""
      print indent "  service: " svc
      print ""
      done = 1
    }
    { print }
    END { if (!done) exit 3 }
  ' "$file" >"$file.new" || return 1
  cat "$file.new" >"$file" # mantém dono e permissões do original
  rm -f "$file.new"
}

if [[ ! -f "$CONFIG" ]]; then
  echo "Config não encontrado: $CONFIG" >&2
  exit 1
fi

if [[ "$DRY_RUN" != "1" && "$(id -u)" -ne 0 ]]; then
  echo "Rode com sudo: sudo bash $0" >&2
  exit 1
fi

BACKUP="$CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
log "Backup: $BACKUP"
cp -p "$CONFIG" "$BACKUP"

if grep -qF "\"$HOSTNAME_NEW\"" "$CONFIG"; then
  log "$HOSTNAME_NEW já está no config; nada a inserir."
else
  log "Inserindo $HOSTNAME_NEW -> $SERVICE_NEW"
  if ! insert_rule "$CONFIG"; then
    echo "Regra final 'http_status:404' não encontrada; restaurando backup." >&2
    rm -f "$CONFIG.new"
    cp -p "$BACKUP" "$CONFIG"
    exit 1
  fi
fi

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY_RUN: config resultante:"
  cat "$CONFIG"
  exit 0
fi

CLOUDFLARED="$(command -v cloudflared || echo /usr/bin/cloudflared)"

log "Validando config"
if ! "$CLOUDFLARED" tunnel --config "$CONFIG" ingress validate; then
  echo "Validação falhou; restaurando backup. Nada foi reiniciado." >&2
  cp -p "$BACKUP" "$CONFIG"
  exit 1
fi
"$CLOUDFLARED" tunnel --config "$CONFIG" ingress rule "https://$HOSTNAME_NEW" || true

TUNNEL_ID="$(awk '/^tunnel:/ { print $2 }' "$CONFIG")"
CERT=""
for c in /etc/cloudflared/cert.pem /root/.cloudflared/cert.pem; do
  if [[ -f "$c" ]]; then
    CERT="$c"
    break
  fi
done
if [[ -n "$CERT" ]]; then
  log "Criando DNS de $HOSTNAME_NEW (cert: $CERT)"
  TUNNEL_ORIGIN_CERT="$CERT" "$CLOUDFLARED" tunnel route dns "$TUNNEL_ID" "$HOSTNAME_NEW" || true
else
  log "Sem cert.pem: crie o DNS no painel da Cloudflare (zona do domínio > DNS):"
  echo "    CNAME  $HOSTNAME_NEW  ->  $TUNNEL_ID.cfargotunnel.com  (proxy ligado, nuvem laranja)"
fi

log "Reiniciando cloudflared"
systemctl restart cloudflared
sleep 5
systemctl is-active cloudflared

log "Testando"
for url in "https://voleidraft.top" "https://$HOSTNAME_NEW/api/health"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)"
  echo "$url -> $code"
done
echo
echo "Se $HOSTNAME_NEW der 000 ou 530, o DNS ainda não existe/propagou."
echo "Domínio de outra zona: se o 'route dns' falhou, crie o CNAME no painel:"
echo "    CNAME  $HOSTNAME_NEW  ->  $TUNNEL_ID.cfargotunnel.com  (proxy ligado)"
echo "Para desfazer: sudo cp -p $BACKUP $CONFIG && sudo systemctl restart cloudflared"
