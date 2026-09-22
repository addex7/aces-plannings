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

```nginx
server {
    server_name api.<domaine>;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```
`certbot --nginx -d api.<domaine>` puis le site statique peut etre servi
par le meme nginx (ou GitHub Pages / file:// comme aujourd'hui).

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
