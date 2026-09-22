#!/bin/bash
# ==========================================================================
# GLIDE 2000 - Installation complete du VPS (Ubuntu 26.04)
# Usage (en root ou avec sudo) :
#   curl -sL https://raw.githubusercontent.com/addex7/aces-plannings/main/backend/setup-vps.sh | sudo bash
# ==========================================================================
set -e

DOMAINE="${1:-vps-1a4fbee9.vps.ovh.net}"
REPO="https://github.com/addex7/aces-plannings.git"
APP_DIR="/opt/glide2000"

echo "==> Domaine utilise : $DOMAINE"
echo "==> Mise a jour du systeme..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

echo "==> Installation de Docker, nginx, certbot, git..."
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates curl git nginx certbot python3-certbot-nginx ufw

# Docker (depot officiel)
if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# Pare-feu : SSH + HTTP + HTTPS uniquement
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "==> Clone du depot..."
mkdir -p /opt
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" pull --ff-only
else
    git clone "$REPO" "$APP_DIR"
fi

echo "==> Generation des secrets..."
DB_PASSWORD=$(openssl rand -hex 24)
API_TOKEN=$(openssl rand -hex 32)
cat > "$APP_DIR/backend/.env" <<EOF
DB_PASSWORD=$DB_PASSWORD
API_TOKEN=$API_TOKEN
EOF
chmod 600 "$APP_DIR/backend/.env"

echo "==> Demarrage PostgreSQL + API..."
cd "$APP_DIR/backend"
docker compose up -d --build

echo "==> Configuration nginx..."
sed -e "s|<domaine>|$DOMAINE|g" -e "s|/var/www/glide2000|$APP_DIR|g" nginx-site.conf > /etc/nginx/sites-available/glide2000
ln -sf /etc/nginx/sites-available/glide2000 /etc/nginx/sites-enabled/glide2000
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Certificat HTTPS..."
certbot --nginx -d "$DOMAINE" --non-interactive --agree-tos --register-unsafely-without-email --redirect || \
    echo "!! Certbot a echoue — tu pourras le relancer : certbot --nginx -d $DOMAINE"

echo ""
echo "======================================================================"
echo " INSTALLATION TERMINEE"
echo "======================================================================"
echo " API_BASE a mettre dans app.js :"
echo "   https://$DOMAINE/v0/glide2000"
echo ""
echo " API_TOKEN (a mettre dans app.js a la place du PAT Airtable) :"
echo "   $API_TOKEN"
echo "======================================================================"
curl -s http://127.0.0.1:3000/health || true
echo ""
