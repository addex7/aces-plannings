#!/bin/bash
# Déploie le frontend sur le VPS OVH.
# - régénère version.js avec l'horodatage courant (affiché en bas à droite)
# - met à jour le cache-buster version.js?v=... dans index.html
# - synchronise les fichiers statiques vers /opt/glide2000 (nginx)
# Usage : ./deploy.sh
set -e
cd "$(dirname "$0")"

VPS="ubuntu@vps-1a4fbee9.vps.ovh.net"
KEY="$HOME/.ssh/glide2000_vps"
REMOTE="/opt/glide2000"

TS_LABEL="$(date '+%Y-%m-%d %H:%M:%S')"
TS_PARAM="$(date '+%Y%m%d%H%M%S')"

cat > version.js <<EOF
const APP_VERSION = 'v${TS_LABEL}';

document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('app-version');
    if (el) el.textContent = APP_VERSION;
});
EOF

python3 - "$TS_PARAM" <<'PY'
import re, sys
p = 'index.html'
s = open(p).read()
s = re.sub(r'version\.js\?v=\d+', 'version.js?v=' + sys.argv[1], s)
open(p, 'w').write(s)
PY

rsync -az -e "ssh -i $KEY" \
    --rsync-path="sudo rsync" \
    --exclude '.git' --exclude 'backend' --exclude 'OLD_Versions' \
    --exclude 'node_modules' --exclude '.DS_Store' --exclude 'deploy.sh' \
    --exclude '*.md' \
    ./ "$VPS:$REMOTE/"

echo "Déployé sur $VPS — version v$TS_LABEL"
