#!/bin/bash
# Déploie le frontend sur le VPS OVH.
# - régénère version.js avec l'horodatage courant (affiché en bas à droite)
# - met à jour TOUS les cache-busters ?v=... avec le hash du contenu :
#   tout fichier modifié obtient automatiquement une nouvelle URL
# - synchronise les fichiers statiques vers /opt/glide2000 (nginx)
# Usage : ./deploy.sh
set -e
cd "$(dirname "$0")"

VPS="ubuntu@vps-1a4fbee9.vps.ovh.net"
KEY="$HOME/.ssh/glide2000_vps"
REMOTE="/opt/glide2000"

TS_LABEL="$(date '+%Y-%m-%d %H:%M:%S')"

cat > version.js <<EOF
const APP_VERSION = 'v${TS_LABEL}';

document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('app-version');
    if (el) el.textContent = APP_VERSION;
});
EOF

python3 <<'PY'
import hashlib, os, re

def bust(page):
    s = open(page).read()
    def repl(m):
        fname = m.group(1)
        if not os.path.exists(fname):
            return m.group(0)
        h = hashlib.md5(open(fname, 'rb').read()).hexdigest()[:10]
        return f'{fname}?v={h}'
    s = re.sub(r'([A-Za-z0-9_.-]+\.(?:js|css))\?v=[0-9a-zA-Z]+', repl, s)
    open(page, 'w').write(s)

for page in ('index.html', 'reserver-vi.html'):
    if os.path.exists(page):
        bust(page)
PY

rsync -az -e "ssh -i $KEY" \
    --rsync-path="sudo rsync" \
    --exclude '.git' --exclude 'backend' --exclude 'OLD_Versions' \
    --exclude 'node_modules' --exclude '.DS_Store' --exclude 'deploy.sh' \
    --exclude '*.md' \
    ./ "$VPS:$REMOTE/"

echo "Déployé sur $VPS — version v$TS_LABEL"
