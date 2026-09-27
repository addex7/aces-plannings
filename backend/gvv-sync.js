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

const GVV_BASE = (process.env.GVV_BASE || 'https://gvvaces.qfu.fr').replace(/\/+$/, '');
const GVV_USER = process.env.GVV_USER;
const GVV_PASS = process.env.GVV_PASS;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://glide2000:glide2000@localhost:5432/glide2000';

const TABLE_SOLDES = 'gvv_soldes';

// --------------------------------------------------------------------------
// Client HTTP minimal avec jar a cookies (GVV = session PHP classique)
// --------------------------------------------------------------------------
class GvvClient {
    constructor() {
        this.cookies = new Map(); // nom -> valeur
    }

    cookieHeader() {
        return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    storeCookies(res) {
        const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        for (const c of raw) {
            const [pair] = c.split(';');
            const idx = pair.indexOf('=');
            if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
        }
    }

    async get(path) {
        const res = await fetch(`${GVV_BASE}${path}`, {
            headers: { Cookie: this.cookieHeader() },
            redirect: 'manual'
        });
        this.storeCookies(res);
        // GVV repond souvent par un 302 apres login : suivre a la main
        if ([301, 302, 303].includes(res.status)) {
            const loc = res.headers.get('location') || '';
            const rel = loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc;
            return this.get(rel);
        }
        return res;
    }

    async postForm(path, fields) {
        const res = await fetch(`${GVV_BASE}${path}`, {
            method: 'POST',
            headers: {
                Cookie: this.cookieHeader(),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams(fields).toString(),
            redirect: 'manual'
        });
        this.storeCookies(res);
        if ([301, 302, 303].includes(res.status)) {
            const loc = res.headers.get('location') || '';
            const rel = loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc;
            return this.get(rel);
        }
        return res;
    }

    // Login : on lit le formulaire pour trouver les vrais noms de champs
    async login() {
        const page = await this.get('/index.php/auth/login');
        const html = await page.text();
        const $ = cheerio.load(html);
        const form = $('form:has(input[type="password"])').first();
        const action = form.attr('action') || '/index.php/auth/login';
        const actionPath = action.startsWith('http') ? new URL(action).pathname + new URL(action).search : action;

        const fields = {};
        form.find('input').each((_, el) => {
            const name = $(el).attr('name');
            if (!name) return;
            const type = ($(el).attr('type') || 'text').toLowerCase();
            if (type === 'password') fields[name] = GVV_PASS;
            else if (type === 'text' || type === 'email') fields[name] = GVV_USER;
            else if (type === 'checkbox' || type === 'radio') {
                if ($(el).attr('checked')) fields[name] = $(el).attr('value') || '1';
            } else if (type !== 'button') fields[name] = $(el).attr('value') || '';
        });

        const res = await this.postForm(actionPath, fields);
        const resHtml = await res.text();
        const $res = cheerio.load(resHtml);
        if ($res('input[name="username"], input[type="password"]').length > 0) {
            throw new Error('Login GVV refuse (identifiants invalides ?)');
        }
        return resHtml;
    }
}

// --------------------------------------------------------------------------
// Export CSV de la balance GVV : "Code; Compte; Solde debiteur; Solde crediteur"
// encode en latin-1. Les comptes pilotes sont les 411.
// Solde pilote = crediteur - debiteur (positif = le pilote a une avance/credit)
// --------------------------------------------------------------------------
async function recupererSoldesCsv(client) {
    const res = await client.get('/index.php/comptes/balance_csv');
    const buf = Buffer.from(await res.arrayBuffer());
    const csv = buf.toString('latin1');
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
// PostgreSQL
// --------------------------------------------------------------------------
async function ensureTable(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_SOLDES} (
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
    await sauvegarderSoldes(pool, soldes);
    await pool.end();
    console.log('Soldes enregistres.');
}

main().catch(e => { console.error('Echec synchro GVV:', e.message); process.exit(1); });
