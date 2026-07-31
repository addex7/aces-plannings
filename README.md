# Gestion des Vols & Plannings ACES

Application web pour la gestion des plannings, réservations, présences, membres et base documentaire du club ACES.

- **URL en ligne** : https://addex7.github.io/aces-plannings/
- **Dépôt GitHub** : https://github.com/addex7/aces-plannings

## Technologies

- HTML, CSS, JavaScript (vanilla)
- Airtable : base de données et API
- Uploadcare : upload et hébergement des fichiers de la base documentaire
- GitHub Pages : hébergement du site

## Fichiers principaux

- `index.html` : structure de l'application
- `app.js` : point d'entrée et navigation
- `membres.js` : authentification et gestion des membres
- `planning.js` : réservations et planning
- `presences.js` : présences Planeur et Club
- `documents.js` : base documentaire (CRUD, upload Uploadcare)
- `aeronefs.js` : gestion des aéronefs
- `utils.js` : fonctions utilitaires

## Configuration

Les clés et identifiants sont à définir dans les fichiers JavaScript concernés :

- Airtable (`BASE_ID`, `API_KEY`) : voir `utils.js` / `app.js`
- Uploadcare (`UPLOADCARE_PUBLIC_KEY`, `UPLOADCARE_CDN_BASE`) : voir `documents.js`

## Données Airtable

Les tables utilisées comprennent notamment :

- `Utilisateurs` : membres et rôles
- `Réservations` : créneaux de planning
- `VI Planeur` : vols d'initiation
- `Présences Planeur` / `Présences Club` : inscriptions aux présences
- `Documents` : fiches documentaires
- `Dossiers` : catégories de documents

Les noms exacts de champs et de tables sont ajustables dans les constantes au début de chaque fichier `.js`.

## Rôles

- `Super admin` : accès complet
- `Documentaliste` : accès à la base documentaire (créer, modifier, supprimer)

## Déploiement

1. Modifier les fichiers localement.
2. Commiter et pousser :
   ```bash
   git add .
   git commit -m "..."
   git push
   ```
3. GitHub Pages se met à jour automatiquement en 1 à 3 minutes.

## Auteur

ACES / Benjamin Quoniam
