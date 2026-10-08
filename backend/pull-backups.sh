#!/bin/bash
# ==========================================================================
# pull-backups.sh — rapatrie les sauvegardes PostgreSQL du VPS vers le Mac
#
# Lancé automatiquement par launchd (~/Library/LaunchAgents/
# ai.glide2000.backup-sync.plist) tous les jours.
#
# Destination : ~/Glide2000-Backups/
# Le VPS applique la rétention (30 j) ; ici on garde tout (260 Ko/jour).
# ==========================================================================
set -uo pipefail

DEST="$HOME/Glide2000-Backups"
mkdir -p "$DEST"

/usr/bin/rsync -az \
    -e "ssh -i $HOME/.ssh/glide2000_vps -o BatchMode=yes -o ConnectTimeout=15" \
    "ubuntu@vps-1a4fbee9.vps.ovh.net:/opt/glide2000/backups/" \
    "$DEST/"

echo "$(date '+%Y-%m-%d %H:%M:%S') rapatriement OK ($(find "$DEST" -name 'glide2000-*.sql.gz' | wc -l | tr -d ' ') dumps, $(du -sh "$DEST" | cut -f1))"
