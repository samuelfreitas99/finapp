#!/bin/sh
# Inicializa o repositório restic (se ainda não existir) e agenda o backup diário.
set -eu

: "${RESTIC_REPOSITORY:?defina RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD:?defina RESTIC_PASSWORD}"
BACKUP_CRON="${BACKUP_CRON:-0 3 * * *}"

if ! restic cat config >/dev/null 2>&1; then
  echo "Inicializando repositório restic em $RESTIC_REPOSITORY"
  restic init
fi

# Repassa o ambiente para o cron (busybox crond não herda variáveis).
export -p | grep -E 'export (PG|RESTIC_|B2_|AWS_|RCLONE_|GOOGLE_|AZURE_|TZ|KEEP_)' >/etc/backup.env
echo "$BACKUP_CRON . /etc/backup.env && backup.sh >/proc/1/fd/1 2>/proc/1/fd/2" >/etc/crontabs/root
chmod 600 /etc/backup.env

echo "Backup agendado: '$BACKUP_CRON' (TZ=${TZ:-UTC})"
exec crond -f -l 8
