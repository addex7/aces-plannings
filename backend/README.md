# Backend Glide 2000 (PostgreSQL)

Facade REST **compatible Airtable** au-dessus de PostgreSQL. Le front existant
appelle les memes URL — seul `API_BASE` dans `app.js` change.

## Architecture

```
navigateur --> app.js (API_BASE) --> https://api.<domaine>/v0/glide2000/<Table>
                                        |
                                   nginx + Let's Encrypt
                                        |
                                   Express :3000  --(SQL)-->  PostgreSQL 16
```

- `server.js` : endpoints compatibles Airtable (GET liste/fiche, POST, PATCH, DELETE)
- `formula.js` : traduit `filterByFormula` Airtable en SQL sur colonne JSONB
- `schema.sql` : une table par table Airtable (`id`, `fields jsonb`, `created_at`)
- `export-airtable.js` : vide chaque table Airtable vers `export/<table>.json`
- `import-postgres.js` : cree le schema et insere l'export (ids `recXXX` conserves)

## Deploiement VPS (Ubuntu/Debian, Docker)

```bash
# 1. Sur le VPS
apt update && apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
git clone https://github.com/addex7/aces-plannings.git
cd aces-plannings/backend

# 2. Secrets
cat > .env <<EOF
DB_PASSWORD=<mot-de-passe-costaud>
API_TOKEN=<jeton-api-costaud>
EOF

# 3. Demarrer
docker compose up -d
curl http://localhost:3000/health   # {"ok":true}
```

## nginx + HTTPS

Deux options :

**A. Installation automatique (recommande)**

```bash
curl -sL https://raw.githubusercontent.com/addex7/aces-plannings/main/backend/setup-vps.sh | sudo bash
# ou avec un domaine perso : | sudo bash -s mon-domaine.fr
```

Le script installe Docker + nginx + certbot + ufw, clone le repo dans
`/opt/glide2000`, genere les secrets, demarre les conteneurs, configure
nginx + HTTPS. Le site statique est servi depuis le meme clone (deploys = `git pull`).

**B. Installation manuelle — site + API sur le meme domaine (voir `nginx-site.conf`)**
```bash
git clone https://github.com/addex7/aces-plannings.git /opt/glide2000
cp /opt/glide2000/backend/nginx-site.conf /etc/nginx/sites-available/glide2000
# editer : remplacer <domaine> et le chemin root, puis
ln -s /etc/nginx/sites-available/glide2000 /etc/nginx/sites-enabled/
certbot --nginx -d <domaine>
```
Dans `app.js` : `const API_BASE = 'https://<domaine>/v0/glide2000';`

**C. API seule sur un sous-domaine** (site reste sur GitHub Pages) :
```nginx
server {
    server_name api.<domaine>;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
    }
}
```
`certbot --nginx -d api.<domaine>` puis dans `app.js` :
`const API_BASE = 'https://api.<domaine>/v0/glide2000';`

## Deployer une mise a jour du site (option A)

```bash
cd /opt/glide2000 && git pull
```

## Migration des donnees

```bash
# Sur une machine avec node (ou le VPS) — apres le reset du quota Airtable
cd backend
AIRTABLE_PAT=patXXX BASE_ID=appufjvD3gYG6H44n node export-airtable.js
DATABASE_URL=postgres://glide2000:<mdp>@localhost:5432/glide2000 node import-postgres.js
```

## Bascule du front

Dans `app.js` :

```js
const API_TOKEN = '<jeton-api-costaud>';   // API_TOKEN du .env serveur
const API_BASE  = 'https://api.<domaine>/v0/glide2000';
```

C'est la seule modification front necessaire — tous les appels
`${API_BASE}/<Table>?filterByFormula=...` fonctionnent a l'identique.
