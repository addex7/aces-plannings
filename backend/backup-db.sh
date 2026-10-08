#!/bin/bash
# ==========================================================================
# backup-db.sh — sauvegarde quotidienne PostgreSQL (glide2000)
#
# - pg_dump dans le conteneur backend-db-1, compressé en gzip
# - rétention : supprime les dumps de plus de 30 jours
# - installé sur le VPS dans /opt/glide2000/backup-db.sh
#   + cron : 0 3 * * * /opt/glide2000/backup-db.sh
#
# Restauration :
#   gunzip -c glide2000-AAAAMMJJ-HHMMSS.sql.gz | \
#     sudo docker exec -i backend-db-1 psql -U glide2000 -d glide2000
# ==========================================================================
set -euo pipefail

BACKUP_DIR="/opt/glide2000/backups"
DB_CONTAINER="backend-db-1"
DB_NAME="glide2000"
DB_USER="glide2000"
RETENTION_JOURS=30

sudo mkdir -p "$BACKUP_DIR"
sudo chown "$(whoami):$(whoami)" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
FICHIER="$BACKUP_DIR/glide2000-$TS.sql.gz"

sudo docker exec "$DB_CONTAINER" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
    | gzip -9 > "$FICHIER"

chmod 600 "$FICHIER"

# Le dump ne doit pas être vide (sinon la sauvegarde a échoué silencieusement)
if [ "$(stat -c%s "$FICHIER")" -lt 1024 ]; then
    echo "ERREUR : dump anormalement petit ($FICHIER)" >&2
    rm -f "$FICHIER"
    exit 1
fi

find "$BACKUP_DIR" -name 'glide2000-*.sql.gz' -mtime +"$RETENTION_JOURS" -delete

echo "$(date '+%Y-%m-%d %H:%M:%S') sauvegarde OK : $(basename "$FICHIER") ($(du -h "$FICHIER" | cut -f1))"
