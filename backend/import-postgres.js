/* ==========================================================================
   IMPORT JSON -> POSTGRESQL
   Usage : DATABASE_URL=postgres://user:mdp@hote:5432/glide2000 node import-postgres.js
   Lit ./export/<table>.json, cree les tables et insere les enregistrements
   (les ids recXXX Airtable sont conserves -> les liens entre tables restent valides).
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Schema applique');

    for (const [nomAirtable, table] of Object.entries(TABLES)) {
        const fichier = path.join(__dirname, 'export', `${nomAirtable}.json`);
        if (!fs.existsSync(fichier)) {
            console.log(`${nomAirtable}: pas de fichier, ignore`);
            continue;
        }
        const records = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        await pool.query(`TRUNCATE ${table}`);
        for (const r of records) {
            await pool.query(
                `INSERT INTO ${table} (id, fields, created_at) VALUES ($1, $2, COALESCE($3::timestamptz, now())) ON CONFLICT (id) DO NOTHING`,
                [r.id, r.fields || {}, r.createdTime || null]
            );
        }
        console.log(`${nomAirtable} -> ${table}: ${records.length} lignes`);
    }
    await pool.end();
    console.log('Import termine');
})();
