#!/usr/bin/env bash
# Teste de restauração: restaura um snapshot (padrão: o mais recente) num Postgres
# descartável e confere o resultado. Não toca no banco de produção.
#
# Uso (no servidor, da raiz do repositório):
#   bash infra/backup/restore.sh            # snapshot mais recente
#   bash infra/backup/restore.sh <id>       # snapshot específico (ids: veja abaixo)
#   docker exec finapp-backup restic snapshots
#
# Restaurar POR CIMA da produção (só em caso de perda real de dados; ver arquitetura.md › Backup):
#   docker compose -f infra/docker-compose.yml stop api
#   docker exec finapp-backup restic dump <id|latest> finapp.dump \
#     | docker exec -i finapp-db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
#   docker compose -f infra/docker-compose.yml start api
set -euo pipefail

SNAPSHOT="${1:-latest}"
BACKUP_CONTAINER="${BACKUP_CONTAINER:-finapp-backup}"
PROD_DB_CONTAINER="${PROD_DB_CONTAINER:-finapp-db}"
TEST_CONTAINER="finapp-restore-test"

cleanup() { docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "==> Snapshot: $SNAPSHOT"
docker exec "$BACKUP_CONTAINER" restic snapshots --tag finapp-db --group-by tags --latest 3 --compact

echo "==> Subindo Postgres descartável ($TEST_CONTAINER)"
docker run -d --name "$TEST_CONTAINER" -e POSTGRES_PASSWORD=restore-test \
  -e POSTGRES_DB=finapp_restore postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$TEST_CONTAINER" pg_isready -U postgres -d finapp_restore >/dev/null 2>&1 && break
  sleep 1
done
sleep 2

echo "==> Restaurando"
docker exec "$BACKUP_CONTAINER" restic dump "$SNAPSHOT" finapp.dump \
  | docker exec -i "$TEST_CONTAINER" pg_restore --no-owner --exit-on-error -U postgres -d finapp_restore

echo "==> Conferindo"
SQL="select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')"
restored="$(docker exec "$TEST_CONTAINER" psql -tA -U postgres -d finapp_restore -c "$SQL")"
prod="$(docker exec -e SQL="$SQL" "$PROD_DB_CONTAINER" sh -c 'psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$SQL"')"
echo "Tabelas restauradas: $restored | tabelas em produção agora: $prod"

if [[ "$restored" != "$prod" ]]; then
  echo "AVISO: contagem diferente (normal se o schema mudou depois do snapshot)." >&2
fi
docker exec "$TEST_CONTAINER" psql -tA -U postgres -d finapp_restore -c "select 'restore-ok'" | grep -q restore-ok
echo "==> Teste de restauração OK"
