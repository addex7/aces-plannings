/* ==========================================================================
   EXPORT AIRTABLE -> JSON
   Usage : AIRTABLE_PAT=patXXX BASE_ID=appXXX node export-airtable.js
   Produit ./export/<table>.json (un tableau d'enregistrements {id, fields})
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const PAT = process.env.AIRTABLE_PAT;
const BASE_ID = process.env.BASE_ID;
if (!PAT || !BASE_ID) {
    console.error('Definir AIRTABLE_PAT et BASE_ID');
    process.exit(1);
}

const TABLES = [
    'Réservations', 'Aéronefs', 'Utilisateurs', 'Événements',
    'Disponibilités instructeurs', 'Carnet de route Pilotes', 'Carnet de route',
    'Présences Planeur', 'Présences Club', 'Maintenance', 'Comptes Pilotes',
    'Messagerie', 'Documents Aéronefs', 'Documents', 'VI Créneaux', 'VI Planeur',
    'Notifications', 'Dossiers', 'Audit', 'Signalements'
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function exportTable(nom) {
    const tous = [];
    let offset = null;
    do {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(nom)}?pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`;
        let res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
        let essais = 0;
        while (res.status === 429 && essais < 8) {
            essais++;
            await sleep(1000 * essais);
            res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
        }
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`${nom}: HTTP ${res.status} ${t.slice(0, 200)}`);
        }
        const data = await res.json();
        tous.push(...(data.records || []));
        offset = data.offset || null;
        await sleep(250); // rester sous la limite de 5 req/s
    } while (offset);
    return tous;
}

(async () => {
    const dir = path.join(__dirname, 'export');
    fs.mkdirSync(dir, { recursive: true });
    for (const t of TABLES) {
        try {
            const records = await exportTable(t);
            fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(records, null, 2));
            console.log(`${t}: ${records.length} enregistrements`);
        } catch (e) {
            console.error(`${t}: ECHEC - ${e.message}`);
        }
    }
    console.log('Export termine -> ./export/');
})();
