/* ==========================================================================
   GLIDE 2000 - BACKEND API
   Facade compatible Airtable au-dessus de PostgreSQL.
   Le front appelle les memes URL, seul l'hote change (API_BASE dans app.js).

   Routes :
     GET    /v0/:base/:table?filterByFormula=&sort[0][field]=&pageSize=&offset=&fields[]=
     GET    /v0/:base/:table/:id
     POST   /v0/:base/:table            { records: [{ fields }] }
     PATCH  /v0/:base/:table            { records: [{ id, fields }] }  (fusion)
     PUT    /v0/:base/:table            { records: [{ id, fields }] }  (remplacement)
     DELETE /v0/:base/:table/:id
     DELETE /v0/:base/:table?records[]=id1&records[]=id2
     GET    /health
   ========================================================================== */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const { formulaToSql } = require('./formula');

const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN || 'change-moi';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://glide2000:glide2000@localhost:5432/glide2000';

// Nom de table Airtable -> table PostgreSQL (liste blanche)
const TABLES = {
    'Réservations': 'reservations',
    'Aéronefs': 'aeronefs',
    'Utilisateurs': 'utilisateurs',
    'Événements': 'evenements',
    'Disponibilités instructeurs': 'disponibilites_instructeurs',
    'Carnet de route Pilotes': 'carnet_route_pilotes',
    'Carnet de route': 'carnet_route',
    'Présences Planeur': 'presences_planeur',
    'Présences Club': 'presences_club',
    'Maintenance': 'maintenance',
    'Comptes Pilotes': 'comptes_pilotes',
    'Messagerie': 'messagerie',
    'Documents Aéronefs': 'documents_aeronefs',
    'Documents': 'documents',
    'VI Créneaux': 'vi_creneaux',
    'VI Planeur': 'vi_planeur',
    'Notifications': 'notifications',
    'Dossiers': 'dossiers',
    'Audit': 'audit',
    'Signalements': 'signalements'
};

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

function erreur(res, status, message) {
    res.status(status).json({ error: { type: 'ERROR', message } });
}

// Auth : jeton partage (meme niveau que le PAT Airtable actuel)
app.use((req, res, next) => {
    if (req.path === '/health') return next();
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${API_TOKEN}`) return erreur(res, 401, 'Non autorise');
    next();
});

// --- ENVOI D'EMAILS VIA LE SERVEUR (SMTP) ---
// Configure via SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM / MAIL_FROM_NAME.
// Le corps du mail est fixe cote serveur : l'endpoint n'est pas un relais libre.
const SMTP = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    fromName: process.env.MAIL_FROM_NAME || 'ACES'
};

app.post('/v0/send-email', async (req, res) => {
    if (!SMTP.host || !SMTP.user || !SMTP.pass) {
        return erreur(res, 501, 'Envoi de mail non configure cote serveur (variables SMTP_*)');
    }
    const { to, prenom, url, type } = req.body || {};
    if (!to || typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return erreur(res, 400, 'Destinataire invalide');
    }
    if (!url || typeof url !== 'string' || !/^https:\/\//.test(url) || url.length > 500) {
        return erreur(res, 400, 'URL invalide');
    }
    const prenomSafe = String(prenom || '').slice(0, 80).replace(/[<>&"']/g, '');
    const estReset = type === 'reset';
    const sujet = estReset
        ? 'ACES - Reinitialisation de votre mot de passe'
        : 'Invitation ACES - Creation de votre compte';
    const ligne = estReset
        ? 'Une demande de reinitialisation de mot de passe a ete faite pour ton compte.'
        : 'Tu es invite(e) a rejoindre la plateforme ACES.';
    const action = estReset
        ? 'Definis ton nouveau mot de passe ici :'
        : 'Cree ton identifiant et mot de passe ici :';
    const texte = `Bonjour ${prenomSafe},\n\n${ligne}\n${action}\n${url}\n\nA bientot.\nAeroclub ACES`;
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <div style="background:#1e3d59;color:#fff;padding:18px 24px;font-size:18px;font-weight:bold;">Aeroclub ACES</div>
            <div style="padding:24px;">
                <p>Bonjour ${prenomSafe},</p>
                <p>${ligne}</p>
                <p>${action}</p>
                <p style="text-align:center;margin:28px 0;">
                    <a href="${url}" style="background:#1e3d59;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;">Acceder au site</a>
                </p>
                <p style="font-size:12px;color:#64748b;word-break:break-all;">Si le bouton ne fonctionne pas : <a href="${url}">${url}</a></p>
                <p style="margin-top:24px;">A bientot.</p>
            </div>
        </div>`;
    try {
        const transport = nodemailer.createTransport({
            host: SMTP.host,
            port: SMTP.port,
            secure: SMTP.port === 465,
            auth: { user: SMTP.user, pass: SMTP.pass }
        });
        await transport.sendMail({
            from: `"${SMTP.fromName}" <${SMTP.from}>`,
            to, subject: sujet, text: texte, html
        });
        res.json({ ok: true });
    } catch (e) {
        console.error('Erreur envoi email:', e);
        erreur(res, 502, 'Echec envoi email : ' + e.message);
    }
});

function tableSql(req, res) {
    const nom = decodeURIComponent(req.params.table);
    const t = TABLES[nom];
    if (!t) { erreur(res, 404, `Table inconnue: ${nom}`); return null; }
    return t;
}

function nouvelId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'rec';
    for (let i = 0; i < 14; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

function formatRecord(row) {
    return {
        id: row.id,
        createdTime: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        fields: row.fields || {}
    };
}

// --- LISTE ---
app.get('/v0/:base/:table', async (req, res) => {
    const table = tableSql(req, res);
    if (!table) return;
    try {
        const params = [];
        let where = '';
        if (req.query.filterByFormula) {
            const sql = formulaToSql(req.query.filterByFormula);
            if (sql) where = `WHERE ${sql}`;
        }

        let orderBy = 'ORDER BY created_at ASC';
        const sorts = [];
        for (let i = 0; i < 16; i++) {
            const f = req.query[`sort[${i}][field]`];
            if (!f) break;
            params.push(f);
            const dir = (req.query[`sort[${i}][direction]`] || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
            sorts.push(`(f.fields->>$${params.length}) ${dir} NULLS LAST`);
        }
        if (sorts.length) orderBy = `ORDER BY ${sorts.join(', ')}`;

        const pageSize = Math.min(parseInt(req.query.pageSize || '100', 10) || 100, 100);
        const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
        const maxRecords = parseInt(req.query.maxRecords || '0', 10) || 0;

        const { rows } = await pool.query(
            `SELECT id, fields, created_at FROM ${table} f ${where} ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, pageSize + 1, offset]
        );

        let records = rows;
        const aPlus = records.length > pageSize;
        if (aPlus) records = records.slice(0, pageSize);

        // Projection fields[]
        let champsDemandes = req.query['fields[]'];
        if (champsDemandes && !Array.isArray(champsDemandes)) champsDemandes = [champsDemandes];
        if (Array.isArray(champsDemandes) && champsDemandes.length) {
            records = records.map(r => {
                const f = {};
                for (const k of champsDemandes) {
                    const nom = decodeURIComponent(k);
                    if (r.fields && nom in r.fields) f[nom] = r.fields[nom];
                }
                return { ...r, fields: f };
            });
        }

        const body = { records: records.map(formatRecord) };
        if (aPlus) body.offset = String(offset + pageSize);
        res.json(body);
    } catch (e) {
        console.error('GET list:', e);
        erreur(res, 422, `Requete invalide: ${e.message}`);
    }
});

// --- LECTURE UNITAIRE ---
app.get('/v0/:base/:table/:id', async (req, res) => {
    const table = tableSql(req, res);
    if (!table) return;
    try {
        const { rows } = await pool.query(`SELECT id, fields, created_at FROM ${table} WHERE id = $1`, [req.params.id]);
        if (!rows.length) return erreur(res, 404, 'Record introuvable');
        res.json(formatRecord(rows[0]));
    } catch (e) {
        console.error('GET one:', e);
        erreur(res, 500, e.message);
    }
});

// --- CREATION ---
app.post('/v0/:base/:table', async (req, res) => {
    const table = tableSql(req, res);
    if (!table) return;
    try {
        let records = req.body.records;
        if (!records && req.body.fields) records = [{ fields: req.body.fields }];
        if (!Array.isArray(records) || !records.length) return erreur(res, 422, 'records manquant');
        const crees = [];
        for (const r of records) {
            const id = nouvelId();
            const { rows } = await pool.query(
                `INSERT INTO ${table} (id, fields) VALUES ($1, $2) RETURNING id, fields, created_at`,
                [id, r.fields || {}]
            );
            crees.push(formatRecord(rows[0]));
        }
        res.json({ records: crees });
    } catch (e) {
        console.error('POST:', e);
        erreur(res, 500, e.message);
    }
});

// --- MISE A JOUR ---
async function majRecords(req, res, remplacer) {
    const table = tableSql(req, res);
    if (!table) return;
    try {
        const records = req.body.records;
        if (!Array.isArray(records) || !records.length) return erreur(res, 422, 'records manquant');
        const maj = [];
        for (const r of records) {
            if (!r.id) return erreur(res, 422, 'id manquant');
            const { rows } = await pool.query(
                remplacer
                    ? `UPDATE ${table} SET fields = $2 WHERE id = $1 RETURNING id, fields, created_at`
                    : `UPDATE ${table} SET fields = fields || $2 WHERE id = $1 RETURNING id, fields, created_at`,
                [r.id, r.fields || {}]
            );
            if (!rows.length) return erreur(res, 404, `Record introuvable: ${r.id}`);
            maj.push(formatRecord(rows[0]));
        }
        res.json({ records: maj });
    } catch (e) {
        console.error('PATCH/PUT:', e);
        erreur(res, 500, e.message);
    }
}
app.patch('/v0/:base/:table', (req, res) => majRecords(req, res, false));
app.put('/v0/:base/:table', (req, res) => majRecords(req, res, true));

// Mise a jour unitaire : PATCH/PUT /:table/:id avec { fields } (Airtable accepte aussi cette forme)
async function majRecordUnitaire(req, res, remplacer) {
    const table = tableSql(req, res);
    if (!table) return;
    try {
        const fields = req.body.fields;
        if (!fields) return erreur(res, 422, 'fields manquant');
        const { rows } = await pool.query(
            remplacer
                ? `UPDATE ${table} SET fields = $2 WHERE id = $1 RETURNING id, fields, created_at`
                : `UPDATE ${table} SET fields = fields || $2 WHERE id = $1 RETURNING id, fields, created_at`,
            [req.params.id, fields]
        );
        if (!rows.length) return erreur(res, 404, `Record introuvable: ${req.params.id}`);
        res.json(formatRecord(rows[0]));
    } catch (e) {
        console.error('PATCH/PUT one:', e);
        erreur(res, 500, e.message);
    }
}
app.patch('/v0/:base/:table/:id', (req, res) => majRecordUnitaire(req, res, false));
app.put('/v0/:base/:table/:id', (req, res) => majRecordUnitaire(req, res, true));

// --- SUPPRESSION ---
async function supprimerIds(res, table, ids) {
    for (const id of ids) {
        await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    }
    res.json({ records: ids.map(id => ({ id, deleted: true })) });
}
app.delete('/v0/:base/:table/:id', async (req, res) => {
    const table = tableSql(req, res);
    if (!table) return;
    try {
        await supprimerIds(res, table, [req.params.id]);
    } catch (e) {
        console.error('DELETE:', e);
        erreur(res, 500, e.message);
    }
});
app.delete('/v0/:base/:table', async (req, res) => {
    const table = tableSql(req, res);
    if (!table) return;
    try {
        let ids = req.query['records[]'] || req.query.records;
        if (!ids) return erreur(res, 422, 'records manquant');
        if (!Array.isArray(ids)) ids = [ids];
        await supprimerIds(res, table, ids);
    } catch (e) {
        console.error('DELETE:', e);
        erreur(res, 500, e.message);
    }
});

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.listen(PORT, () => console.log(`API Glide 2000 sur le port ${PORT}`));
