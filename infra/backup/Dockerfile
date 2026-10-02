# finapp-backup: pg_dump diário do finapp-db para um repositório restic.
FROM postgres:17-alpine
RUN apk add --no-cache restic rclone tzdata
COPY backup.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]
