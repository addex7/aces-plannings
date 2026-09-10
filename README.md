# Gestion des Vols & Plannings ACES

Application web interne pour la gestion des plannings, réservations, présences, membres, carnet de route, messagerie et base documentaire du club ACES.

- **URL en ligne** : https://addex7.github.io/aces-plannings/
- **Dépôt GitHub** : https://github.com/addex7/aces-plannings
- **Hébergement** : GitHub Pages
- **Base de données** : Airtable

## Technologies

- HTML, CSS, JavaScript (vanilla)
- Airtable REST API
- Uploadcare : upload et hébergement des fichiers de la base documentaire
- EmailJS : envoi d’emails (invitations, confirmations de réservation, etc.)
- GitHub Pages : hébergement du site

## Fichiers principaux

- `index.html` : structure principale de l’application
- `app.js` : point d’entrée, navigation et initialisation globale
- `utils.js` : utilitaires partagés (`cachedFetch`, `escHtml`, selects recherchables, etc.)
- `comptes.js` : authentification (connexion, setup, hachage SHA-256)
- `membres.js` : gestion des membres (création, édition, rôles, import CSV)
- `membre-home.js` : espace membre, validités, expériences récentes, documents
- `accueil-pilote.js` : tableau de bord pilote
- `planning.js` : planning des réservations d’aéronefs
- `calendrier.js` : vue calendrier des réservations
- `instructeur-planning.js` : gestion des disponibilités instructeurs
- `presences.js` : présences Planeur et Club
- `evenements.js` : événements du club
- `carnet.js` : carnet de route (vols, pilotes, instructeurs, suivi maintenance)
- `aeronefs.js` : gestion des aéronefs et documents machine
- `documents.js` : base documentaire (CRUD, upload Uploadcare)
- `messagerie.js` : messagerie interne avec fils de discussion
- `audit.js` : journal d’audit des actions administrateur
- `reserver-vi.html` : page publique de réservation des baptêmes de l’air

## Fonctionnalités principales

### Membres et rôles
- Gestion des membres (création, édition, désactivation, suppression)
- Attribution de rôles : `Super admin`, `Gestion VI`, `Pilote VI`, `Instructeur avion`, `Instructeur planeur`, `Instructeur ULM`, `Eleve planeur`, `Pilote planeur`, `Documentaliste`, `Trésorier`, `Mécanicien`, etc.
- Authentification par identifiant / mot de passe avec migration SHA-256
- Création de compte par invitation (token de setup)

### Espace membre
- Suivi des validités : Cotisation, Licences FFVP / FFA / FFPLUM, Médical, SEP, Autorisation parentale, Instructeur avion, Instructeur ULM
- Indicateurs de statut (vert / orange / rouge)
- Suivi des expériences récentes (1 vol / 3 mois, emport de passager, LAPL, vol d’initiation)
- Upload de documents et photo de profil

### Planning et réservations
- Réservation des aéronefs par créneaux horaires
- Vue calendrier et vue planning
- Détection des conflits
- Gestion des disponibilités instructeurs
- Présences Planeur / Club

### Carnet de route
- Saisie des vols (date, pilote, instructeur, fonction, machine, lieux, horaires, carburant, huile, horamètre, observations)
- Sélection du pilote parmi les membres ou saisie manuelle d’un pilote non inscrit (lien automatique lors de sa création)
- Vue par machine ou par section Planeur / Remorques
- Suivi documentaire et observations sur les aéronefs

### Messagerie
- Messagerie interne entre membres
- Vue par fils de discussion (expéditeur, objet, aperçu, date)
- Réponse à l’expéditeur / aux destinataires / à tous
- Pièces jointes

### Base documentaire
- CRUD de fiches documentaires par dossier
- Upload de fichiers via Uploadcare

### Vols d’initiation (baptêmes de l’air)
- Créneaux de baptêmes de l’air (`VI Créneaux`)
- Page publique `reserver-vi.html` pour réserver avec un bon cadeau
- Confirmation par email (EmailJS `template_zol8z2e`)
- Lien avec token pour modification ou annulation

### Journal d’audit
- Enregistrement des actions administrateur

## Configuration

Les clés et identifiants sont à définir dans les fichiers JavaScript concernés :

- Airtable (`BASE_ID`, `API_KEY`) : voir `utils.js` / `app.js`
- Uploadcare (`UPLOADCARE_PUBLIC_KEY`, `UPLOADCARE_CDN_BASE`) : voir `documents.js`
- EmailJS : voir `membres.js` / `utils.js`

## Données Airtable

Les tables utilisées comprennent notamment :

- `Utilisateurs` : membres, rôles, validités, mots de passe, photo
- `Réservations` : créneaux de planning
- `Carnet de route Pilotes` : vols du carnet de route
- `Carnet de route` : suivi maintenance / observations machines
- `Messagerie` : messages internes
- `Documents` : fiches documentaires
- `Dossiers` : catégories de documents
- `Présences Planeur` / `Présences Club` : inscriptions aux présences
- `VI Créneaux` : créneaux de vols d’initiation (baptêmes de l’air)
- `VI Planeur` : réservations de baptêmes
- `Audit` : journal d’audit

Les noms exacts de champs et de tables sont ajustables dans les constantes au début de chaque fichier `.js`.

> Important : certaines fonctionnalités nécessitent que les champs Airtable correspondent exactement aux constantes définies dans le code (notamment `Suivis actifs`, les dates de validité, les rôles, etc.).

## Rôles

- `Super admin` : accès complet
- `Gestion VI` : gestion des créneaux de vols d’initiation
- `Pilote VI` : pilote de baptêmes de l’air
- `Instructeur avion`, `Instructeur planeur`, `Instructeur ULM` : instructeurs
- `Eleve planeur`, `Pilote planeur` : membres planeur
- `Documentaliste` : accès à la base documentaire (créer, modifier, supprimer)
- `Trésorier`, `Mécanicien` : rôles dédiés

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
