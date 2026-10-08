# Glide 2000 — Consignes agent

## Notifications de fin de tâche
À chaque fois qu'une demande de l'utilisateur est terminée, envoyer une notification macOS :
```
osascript -e 'display notification "Résumé court de ce qui a été fait." with title "Devin — Glide 2000" sound name "Glass"'
```

## Déploiement
- Déployer sur le VPS avec `./deploy.sh` (frontend rsync vers `/opt/glide2000`, nginx).
- Les cache-busters `?v=` dans `index.html` et `reserver-vi.html` sont régénérés automatiquement (hash du contenu) — ne pas les éditer à la main.
- Committer en local à chaque changement terminé.
- Ne PAS pousser sur GitHub sauf demande explicite de l'utilisateur.
