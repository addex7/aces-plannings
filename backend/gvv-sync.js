/* ==========================================================================
   SYNC GVV -> Glide 2000
   Recupere les soldes des comptes pilotes depuis GVV (gvvaces.qfu.fr) et les
   stocke dans PostgreSQL (table gvv_soldes), pour affichage dans "Compte
   pilote".

   Usage :
     node gvv-sync.js            -> synchronisation complete
     node gvv-sync.js --discover -> explore les pages GVV (mise au point)

   Env requis : GVV_BASE, GVV_USER, GVV_PASS, DATABASE_URL
   ========================================================================== */

const { Pool } = require('pg');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { GvvClient, GVV_BASE, GVV_USER, GVV_PASS } = require('./gvv-client');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://glide2000:glide2000@localhost:5432/glide2000';

const TABLE_SOLDES = 'gvv_soldes';
const TABLE_ECRITURES = 'gvv_ecritures';
const DELAI_REQUETES_MS = 150; // menage le serveur GVV

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --------------------------------------------------------------------------
// Export CSV de la balance GVV : "Code; Compte; Solde debiteur; Solde crediteur"
// encode en latin-1. Les comptes pilotes sont les 411.
// Solde pilote = crediteur - debiteur (positif = le pilote a une avance/credit)
// --------------------------------------------------------------------------
async function recupererSoldesCsv(client) {
    const res = await client.get('/index.php/comptes/balance_csv');
    const buf = Buffer.from(await res.arrayBuffer());
    const csv = buf.toString('latin1').replace(/\x80/g, '€');
    const lignes = csv.split(/\r?\n/);
    const soldes = [];
    for (const ligne of lignes) {
        const cols = ligne.split(';').map(c => c.trim());
        if (cols.length < 4 || cols[0] !== '411') continue;
        const deb = parseFloat((cols[2] || '0').replace(/\s/g, '').replace(',', '.')) || 0;
        const cred = parseFloat((cols[3] || '0').replace(/\s/g, '').replace(',', '.')) || 0;
        const compte = cols[1];
        if (!compte) continue;
        soldes.push({
            compte,
            solde: Math.round((cred - deb) * 100) / 100,
            debiteur: deb,
            crediteur: cred
        });
    }
    return soldes;
}

// --------------------------------------------------------------------------
// Comptes pilotes : page /comptes/page/411 -> nom + id journal par compte
// --------------------------------------------------------------------------
async function recupererComptes411(client) {
    const res = await client.get('/index.php/comptes/page/411');
    const html = await res.text();
    const $ = cheerio.load(html);
    const comptes = [];
    $('a[href*="journal_compte/"]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const m = href.match(/journal_compte\/(\d+)/);
        const nom = $(a).text().trim();
        if (m && nom) comptes.push({ compte: nom, journalId: m[1] });
    });
    // Dedoublonne (le nom peut apparaitre en double dans certains themes)
    const seen = new Set();
    return comptes.filter(c => !seen.has(c.journalId) && seen.add(c.journalId));
}

// --------------------------------------------------------------------------
// Export Excel du journal d'un compte : /compta/export/<id> (POST button=Excel)
// CSV latin-1 : entete compte, ligne "Solde avant le", puis ecritures
// --------------------------------------------------------------------------
function parseMontantGvv(s) {
    const t = (s || '').trim().replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
}

function dateFrToIso(s) {
    const m = (s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function recupererEcrituresCompte(client, compte) {
    const res = await client.postForm(`/index.php/compta/export/${compte.journalId}`, { button: 'Excel' });
    const buf = Buffer.from(await res.arrayBuffer());
    const lignes = buf.toString('latin1').replace(/\x80/g, '€').split(/\r?\n/);
    const ecritures = [];
    let dansTable = false;
    for (const ligne of lignes) {
        const cols = ligne.split(';').map(c => c.trim());
        if (cols[0].toLowerCase().startsWith('solde avant le')) {
            // "Solde avant le; 01/01/2026; débiteur; -2,39"
            const sens = (cols[2] || '').toLowerCase();
            const montant = Math.abs(parseMontantGvv(cols[3]) || 0);
            ecritures.push({
                compte: compte.compte,
                date: dateFrToIso(cols[1]),
                description: 'Solde initial',
                reference: '',
                debit: /d.bit/.test(sens) ? montant : null,
                credit: /cr.dit/.test(sens) ? montant : null
            });
            continue;
        }
        if (!dansTable) {
            if (/^date$/i.test(cols[0]) && /description/i.test(cols[1] || '')) dansTable = true;
            continue;
        }
        const dateIso = dateFrToIso(cols[0]);
        if (!dateIso) continue;
        ecritures.push({
            compte: compte.compte,
            date: dateIso,
            description: cols[1] || '',
            reference: cols[2] || '',
            prix: parseMontantGvv(cols[3]),
            quantite: parseMontantGvv(cols[4]),
            debit: parseMontantGvv(cols[5]),
            credit: parseMontantGvv(cols[6])
        });
    }
    return ecritures;
}
async function ensureTable(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_SOLDES} (
            id          TEXT PRIMARY KEY,
            fields      JSONB NOT NULL DEFAULT '{}',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_ECRITURES} (
            id          TEXT PRIMARY KEY,
            fields      JSONB NOT NULL DEFAULT '{}',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

// Id stable par compte GVV -> upsert idempotent
function idPourCompte(compte) {
    const h = crypto.createHash('sha1').update(compte.normalize('NFC').trim().toLowerCase()).digest('hex').slice(0, 14);
    return `gvv_${h}`;
}

async function sauvegarderSoldes(pool, soldes) {
    await ensureTable(pool);
    const maintenant = new Date().toISOString();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const s of soldes) {
            await client.query(
                `INSERT INTO ${TABLE_SOLDES} (id, fields) VALUES ($1, $2)
                 ON CONFLICT (id) DO UPDATE SET fields = $2`,
                [idPourCompte(s.compte), JSON.stringify({
                    'Compte': s.compte,
                    'Solde': s.solde,
                    'Solde débiteur': s.debiteur,
                    'Solde créditeur': s.crediteur,
                    'Synchronisé le': maintenant
                })]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
    // Journal
    await pool.query(
        `INSERT INTO audit (fields) VALUES ($1)`,
        [JSON.stringify({
            Type: 'Synchro GVV',
            Détail: `${soldes.length} soldes importés`,
            Date: new Date().toISOString()
        })]
    ).catch(() => {});
}

// Remplace les ecritures d'un seul compte (rafraichissement cible apres envoi de vol)
async function sauvegarderEcrituresCompte(pool, compte, ecritures) {
    await ensureTable(pool);
    const maintenant = new Date().toISOString();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM ${TABLE_ECRITURES} WHERE fields->>'Compte' = $1`, [compte]);
        for (let idx = 0; idx < ecritures.length; idx++) {
            const e = ecritures[idx];
            const id = 'gvve_' + crypto.createHash('sha1')
                .update(`${e.compte}|${e.date}|${e.description}|${e.reference}|${e.debit}|${e.credit}|${idx}`)
                .digest('hex').slice(0, 16);
            await client.query(
                `INSERT INTO ${TABLE_ECRITURES} (id, fields) VALUES ($1, $2)`,
                [id, JSON.stringify({
                    'Compte': e.compte,
                    'Date': e.date,
                    'Description': e.description,
                    'Référence': e.reference,
                    'Prix unitaire': e.prix,
                    'Quantité': e.quantite,
                    'Débit': e.debit,
                    'Crédit': e.credit,
                    'Synchronisé le': maintenant
                })]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// Remplace toutes les ecritures : snapshot frais a chaque synchro
async function sauvegarderEcritures(pool, ecritures) {
    const maintenant = new Date().toISOString();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`TRUNCATE ${TABLE_ECRITURES}`);
        for (let idx = 0; idx < ecritures.length; idx++) {
            const e = ecritures[idx];
            const id = 'gvve_' + crypto.createHash('sha1')
                .update(`${e.compte}|${e.date}|${e.description}|${e.reference}|${e.debit}|${e.credit}|${idx}`)
                .digest('hex').slice(0, 16);
            await client.query(
                `INSERT INTO ${TABLE_ECRITURES} (id, fields) VALUES ($1, $2)`,
                [id, JSON.stringify({
                    'Compte': e.compte,
                    'Date': e.date,
                    'Description': e.description,
                    'Référence': e.reference,
                    'Prix unitaire': e.prix,
                    'Quantité': e.quantite,
                    'Débit': e.debit,
                    'Crédit': e.credit,
                    'Synchronisé le': maintenant
                })]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// --------------------------------------------------------------------------
// Mode decouverte : affiche les tables de quelques pages candidates
// --------------------------------------------------------------------------
const PAGES_CANDIDATES = [
    '/index.php/compta/page',
    '/index.php/compta/soldes',
    '/index.php/comptes/page',
    '/index.php/comptes/soldes',
    '/index.php/comptes_club/page',
    '/index.php/welcome',
    '/index.php/'
];

async function discover(client) {
    for (const path of PAGES_CANDIDATES) {
        try {
            const res = await client.get(path);
            const html = await res.text();
            const $ = cheerio.load(html);
            const title = $('title').text().trim() || $('h2, h3').first().text().trim();
            const tables = $('table').length;
            console.log(`\n=== ${path} [${res.status}] "${title}" — ${tables} table(s)`);
            $('table').each((i, table) => {
                const heads = $(table).find('tr').first().find('th,td')
                    .map((_, el) => $(el).text().trim()).get();
                const nbLignes = $(table).find('tr').length;
                console.log(`  table ${i}: ${nbLignes} lignes | ${heads.join(' | ')}`);
            });
            // Liens d'export / pages compta visibles dans le menu
            $('a[href]').each((_, a) => {
                const href = $(a).attr('href') || '';
                const txt = $(a).text().trim().slice(0, 40);
                if (/csv|export|solde|compta|compte/i.test(href + ' ' + txt)) {
                    console.log(`  lien: "${txt}" -> ${href}`);
                }
            });
        } catch (e) {
            console.log(`\n=== ${path} ERREUR: ${e.message}`);
        }
    }
}

// --------------------------------------------------------------------------
async function main() {
    if (!GVV_USER || !GVV_PASS) {
        console.error('GVV_USER / GVV_PASS manquants dans l\'environnement');
        process.exit(1);
    }
    const discoverMode = process.argv.includes('--discover');
    const client = new GvvClient();

    console.log(`Connexion a GVV (${GVV_BASE})...`);
    await client.login();
    console.log('Connecte.');

    if (discoverMode) {
        await discover(client);
        return;
    }

    const soldes = await recupererSoldesCsv(client);
    console.log(`${soldes.length} soldes trouves`);
    if (soldes.length === 0) {
        console.error('Aucun solde trouve — verifier la page/parseur');
        process.exit(2);
    }

    const pool = new Pool({ connectionString: DATABASE_URL });
    await ensureTable(pool);
    await sauvegarderSoldes(pool, soldes);
    console.log('Soldes enregistres.');

    // Detail : export Excel de chaque journal de compte pilote
    const comptes = await recupererComptes411(client);
    console.log(`${comptes.length} comptes pilotes a exporter...`);
    const ecritures = [];
    let nbErreurs = 0;
    for (let i = 0; i < comptes.length; i++) {
        try {
            const lignes = await recupererEcrituresCompte(client, comptes[i]);
            ecritures.push(...lignes);
        } catch (e) {
            nbErreurs++;
            console.error(`  echec journal ${comptes[i].compte}: ${e.message}`);
        }
        if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${comptes.length} comptes...`);
        await sleep(DELAI_REQUETES_MS);
    }
    console.log(`${ecritures.length} ecritures recuperees (${nbErreurs} erreurs)`);
    if (ecritures.length > 0) {
        await sauvegarderEcritures(pool, ecritures);
        console.log('Ecritures enregistrees.');
    }
    await pool.end();
}

if (require.main === module) {
    main().catch(e => { console.error('Echec synchro GVV:', e.message); process.exit(1); });
}

module.exports = {
    recupererSoldesCsv,
    recupererComptes411,
    recupererEcrituresCompte,
    sauvegarderSoldes,
    sauvegarderEcritures,
    sauvegarderEcrituresCompte,
    ensureTable
};
