#!/bin/sh
# pg_dump -Fc do banco direto para o restic (sem arquivo temporário) e aplica a retenção.
set -eu

echo "[$(date -Iseconds)] backup: início"
restic backup \
  --host finapp-backup \
  --tag finapp-db \
  --stdin-filename finapp.dump \
  --stdin-from-command -- pg_dump -Fc --no-owner

# Agrupa só por tag, para a retenção valer mesmo se o host do snapshot mudar.
restic forget --prune \
  --group-by tags \
  --tag finapp-db \
  --keep-daily "${KEEP_DAILY:-7}" \
  --keep-weekly "${KEEP_WEEKLY:-4}" \
  --keep-monthly "${KEEP_MONTHLY:-12}"

echo "[$(date -Iseconds)] backup: ok"
