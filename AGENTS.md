# Glide 2000 — Consignes agent

## Notifications de fin de tâche
À chaque fois qu'une demande de l'utilisateur est terminée, envoyer une notification macOS :
```
osascript -e 'display notification "Résumé court de ce qui a été fait." with title "Devin — Glide 2000" sound name "Glass"'
```

## Sauvegardes
- `backend/backup-db.sh` : `pg_dump` quotidien sur le VPS (cron `/etc/cron.d/glide2000-backup`, 3h00) → `/opt/glide2000/backups/`, rétention 30 jours. Log : `/var/log/glide2000-backup.log`.
- `backend/pull-backups.sh` : rapatriement rsync vers `~/Glide2000-Backups/` sur le Mac, via launchd (`ai.glide2000.backup-sync.plist`, 12h30). Copie installée dans `~/bin/glide2000-pull-backups.sh` (Desktop inaccessible à launchd).
- Restauration : `gunzip -c dump.sql.gz | sudo docker exec -i backend-db-1 psql -U glide2000 -d glide2000`

## Déploiement
- Déployer sur le VPS avec `./deploy.sh` (frontend rsync vers `/opt/glide2000`, nginx).
- Les cache-busters `?v=` dans `index.html` et `reserver-vi.html` sont régénérés automatiquement (hash du contenu) — ne pas les éditer à la main.
- Committer en local à chaque changement terminé.
- Ne PAS pousser sur GitHub sauf demande explicite de l'utilisateur.
