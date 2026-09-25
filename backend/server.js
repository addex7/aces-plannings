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
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

const VI_LIEU = 'Aérodrome de Saint Romain, 1177 Rue de la Brûlerie, 76430 Gommerville';
const VI_LIEU_URL = 'https://www.google.com/maps/place/AéroClub+de+l%27Estuaire+de+la+Seine/@49.5433082,0.3521124,585m/data=!3m2!1e3!4b1!4m6!3m5!1s0x47e047ad6eb49ffb:0xb41074729aec96fb!8m2!3d49.5433082!4d0.3546873!16s%2Fg%2F11gmw6r8zs';
const VI_TYPE_LIBELLES = {
    VIP: "Vol d'initiation planeur",
    VIA: "Vol d'initiation avion",
    VIULM: "Vol d'initiation avion"
};
const libelleTypeVI = (t) => VI_TYPE_LIBELLES[t] || t || 'VI';

app.post('/v0/send-email', async (req, res) => {
    if (!SMTP.host || !SMTP.user || !SMTP.pass) {
        return erreur(res, 501, 'Envoi de mail non configure cote serveur (variables SMTP_*)');
    }
    const { to, prenom, url, type, viType, viDate, viHeure, viLieu } = req.body || {};
    if (!to || typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return erreur(res, 400, 'Destinataire invalide');
    }
    if (!url || typeof url !== 'string' || !/^https:\/\//.test(url) || url.length > 500) {
        return erreur(res, 400, 'URL invalide');
    }
    const nettoie = (s, n) => String(s || '').slice(0, n).replace(/[<>&"]/g, '');
    const prenomSafe = nettoie(prenom, 80);
    const estReset = type === 'reset';
    const estVI = type === 'vi' || type === 'vi-modification';
    const estVIModif = type === 'vi-modification';
    let sujet, texte, html;
    if (estVI) {
        const viTypeSafe = nettoie(libelleTypeVI(viType), 80);
        const viDateSafe = nettoie(viDate, 40);
        const viHeureSafe = nettoie(viHeure, 40);
        sujet = estVIModif
            ? 'Modification de votre réservation de vol d\'initiation ACES'
            : 'Confirmation de votre vol d\'initiation ACES';
        const viPhrase = estVIModif
            ? 'Votre réservation de vol d\'initiation a été modifiée.'
            : 'Votre réservation de vol d\'initiation est bien enregistrée.';
        const viPhraseHtml = estVIModif
            ? 'Votre réservation de vol d\'initiation a été modifiée. Voici vos informations à jour :'
            : 'Votre réservation est bien enregistrée.';
        const viBandeau = estVIModif ? 'Votre réservation a été modifiée' : 'Votre vol d\'initiation est réservé';
        const viCouleur = estVIModif ? '#3f51b5' : '#1e3d59';
        texte = `Bonjour ${prenomSafe},\n\n${viPhrase}\n\nType : ${viTypeSafe}\nDate : ${viDateSafe}\nHoraire : ${viHeureSafe}\nLieu : ${VI_LIEU}\nPlan : ${VI_LIEU_URL}\n\nVous pouvez modifier ou annuler votre réservation ici :\n${url}\n\nA bientôt.\nACES - Aéroclub de l'Estuaire de la Seine`;
        html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <div style="background:${viCouleur};color:#fff;padding:18px 24px;font-size:18px;font-weight:bold;">${viBandeau}</div>
            <div style="padding:24px;">
                <p>Bonjour ${prenomSafe},</p>
                <p>${viPhraseHtml}</p>
                <div style="background:#f1f5f9;border-radius:8px;padding:14px 18px;margin:18px 0;">
                    <p style="margin:4px 0;"><strong>Type :</strong> ${viTypeSafe}</p>
                    <p style="margin:4px 0;"><strong>Date :</strong> ${viDateSafe}</p>
                    <p style="margin:4px 0;"><strong>Horaire :</strong> ${viHeureSafe}</p>
                    <p style="margin:4px 0;"><strong>Lieu :</strong> <a href="${VI_LIEU_URL}" style="color:#1e3d59;">${VI_LIEU}</a></p>
                </div>
                <p>Vous pouvez modifier ou annuler votre réservation en cliquant sur le lien ci-dessous :</p>
                <p style="text-align:center;margin:28px 0;">
                    <a href="${url}" style="background:#1e3d59;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;">Gérer ma réservation</a>
                </p>
                <p style="font-size:12px;color:#64748b;word-break:break-all;">Si le bouton ne s'affiche pas, copiez ce lien : <a href="${url}">${url}</a></p>
                <p style="margin-top:24px;color:#64748b;">ACES - Aéroclub de l'Estuaire de la Seine</p>
            </div>
        </div>`;
    } else {
        sujet = estReset
            ? 'ACES - Réinitialisation de votre mot de passe'
            : 'Invitation ACES - Création de votre compte';
        const ligne = estReset
            ? 'Une demande de réinitialisation de mot de passe a été faite pour ton compte.'
            : 'Tu es invité(e) à rejoindre la plateforme ACES.';
        const action = estReset
            ? 'Définis ton nouveau mot de passe ici :'
            : 'Crée ton identifiant et mot de passe ici :';
        texte = `Bonjour ${prenomSafe},\n\n${ligne}\n${action}\n${url}\n\nA bientôt.\nAéroclub ACES`;
        html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <div style="background:#1e3d59;color:#fff;padding:18px 24px;font-size:18px;font-weight:bold;">Aéroclub ACES</div>
            <div style="padding:24px;">
                <p>Bonjour ${prenomSafe},</p>
                <p>${ligne}</p>
                <p>${action}</p>
                <p style="text-align:center;margin:28px 0;">
                    <a href="${url}" style="background:#1e3d59;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;">Accéder au site</a>
                </p>
                <p style="font-size:12px;color:#64748b;word-break:break-all;">Si le bouton ne fonctionne pas : <a href="${url}">${url}</a></p>
                <p style="margin-top:24px;">A bientôt.</p>
            </div>
        </div>`;
    }
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

// --- CONFIRMATION VI DECLENCHEE PAR LE SERVEUR ---
// Un client qui reserve un creneau envoie 'Date réservation' + Statut 'Réservé'
// dans le PATCH — ce declencheur ne depend pas du code execute par le navigateur.
async function envoyerMailConfirmationVI(fields) {
    if (!SMTP.host || !SMTP.user || !SMTP.pass) return;
    const f = fields || {};
    const to = f['Email'];
    const token = f['Token'];
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !token) return;
    const nettoie = (s, n) => String(s || '').slice(0, n).replace(/[<>&"]/g, '');
    const prenomSafe = nettoie(`${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim(), 80);
    const viTypeSafe = nettoie(libelleTypeVI(f['Type']), 80);
    let viDateSafe = '';
    try {
        viDateSafe = new Date(f['Date'] + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { viDateSafe = nettoie(f['Date'], 40); }
    const viHeureSafe = nettoie(`${f['Heure début'] || ''} - ${f['Heure fin'] || ''}`, 40);
    const url = `https://vps-1a4fbee9.vps.ovh.net/reserver-vi.html?token=${encodeURIComponent(token)}`;
    const sujet = 'Confirmation de votre vol d\'initiation ACES';
    const texte = `Bonjour ${prenomSafe},\n\nVotre réservation de vol d'initiation est bien enregistrée.\n\nType : ${viTypeSafe}\nDate : ${viDateSafe}\nHoraire : ${viHeureSafe}\nLieu : ${VI_LIEU}\nPlan : ${VI_LIEU_URL}\n\nVous pouvez modifier ou annuler votre réservation ici :\n${url}\n\nA bientôt.\nACES - Aéroclub de l'Estuaire de la Seine`;
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <div style="background:#1e3d59;color:#fff;padding:18px 24px;font-size:18px;font-weight:bold;">Votre vol d'initiation est réservé</div>
            <div style="padding:24px;">
                <p>Bonjour ${prenomSafe},</p>
                <p>Votre réservation est bien enregistrée.</p>
                <div style="background:#f1f5f9;border-radius:8px;padding:14px 18px;margin:18px 0;">
                    <p style="margin:4px 0;"><strong>Type :</strong> ${viTypeSafe}</p>
                    <p style="margin:4px 0;"><strong>Date :</strong> ${viDateSafe}</p>
                    <p style="margin:4px 0;"><strong>Horaire :</strong> ${viHeureSafe}</p>
                    <p style="margin:4px 0;"><strong>Lieu :</strong> <a href="${VI_LIEU_URL}" style="color:#1e3d59;">${VI_LIEU}</a></p>
                </div>
                <p>Vous pouvez modifier ou annuler votre réservation en cliquant sur le lien ci-dessous :</p>
                <p style="text-align:center;margin:28px 0;">
                    <a href="${url}" style="background:#1e3d59;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;">Gérer ma réservation</a>
                </p>
                <p style="font-size:12px;color:#64748b;word-break:break-all;">Si le bouton ne s'affiche pas, copiez ce lien : <a href="${url}">${url}</a></p>
                <p style="margin-top:24px;color:#64748b;">ACES - Aéroclub de l'Estuaire de la Seine</p>
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
        console.log(`Confirmation VI envoyee a ${to}`);
    } catch (e) {
        console.error('Erreur envoi confirmation VI:', e);
    }
}

async function envoyerMailLiberationVI(oldFields, suppression = false) {
    if (!SMTP.host || !SMTP.user || !SMTP.pass) return;
    const f = oldFields || {};
    const to = f['Email'];
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return;
    const nettoie = (s, n) => String(s || '').slice(0, n).replace(/[<>&"]/g, '');
    const prenomSafe = nettoie(`${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim(), 80) || 'Bonjour';
    const viTypeSafe = nettoie(libelleTypeVI(f['Type']), 80);
    let viDateSafe = '';
    try {
        viDateSafe = new Date(f['Date'] + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { viDateSafe = nettoie(f['Date'], 40); }
    const viHeureSafe = nettoie(`${f['Heure début'] || ''} - ${f['Heure fin'] || ''}`, 40);
    const url = 'https://vps-1a4fbee9.vps.ovh.net/reserver-vi.html';
    const sujet = 'Annulation de votre réservation de vol d\'initiation ACES';
    const phraseSuite = suppression ? '' : ' Le créneau est à nouveau disponible.';
    const texte = `Bonjour ${prenomSafe},\n\nVotre réservation de vol d'initiation prévue le ${viDateSafe} (${viHeureSafe}) a été annulée.${phraseSuite}\n\nVous pouvez réserver un autre créneau ici :\n${url}\n\nA bientôt.\nACES - Aéroclub de l'Estuaire de la Seine`;
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <div style="background:#dc2626;color:#fff;padding:18px 24px;font-size:18px;font-weight:bold;">Votre réservation a été annulée</div>
            <div style="padding:24px;">
                <p>Bonjour ${prenomSafe},</p>
                <p>Votre réservation de vol d'initiation a été annulée.${suppression ? '' : ' Le créneau est à nouveau disponible.'}</p>
                <div style="background:#f1f5f9;border-radius:8px;padding:14px 18px;margin:18px 0;">
                    <p style="margin:4px 0;"><strong>Type :</strong> ${viTypeSafe}</p>
                    <p style="margin:4px 0;"><strong>Date :</strong> ${viDateSafe}</p>
                    <p style="margin:4px 0;"><strong>Horaire :</strong> ${viHeureSafe}</p>
                </div>
                <p>Vous pouvez réserver un autre créneau en cliquant sur le lien ci-dessous :</p>
                <p style="text-align:center;margin:28px 0;">
                    <a href="${url}" style="background:#1e3d59;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;">Réserver un autre créneau</a>
                </p>
                <p style="margin-top:24px;color:#64748b;">ACES - Aéroclub de l'Estuaire de la Seine</p>
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
        console.log(`Annulation VI envoyee a ${to}`);
    } catch (e) {
        console.error('Erreur envoi annulation VI:', e);
    }
}

async function envoyerMailModificationVI(fields) {
    if (!SMTP.host || !SMTP.user || !SMTP.pass) return;
    const f = fields || {};
    const to = f['Email'];
    const token = f['Token'];
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !token) return;
    const nettoie = (s, n) => String(s || '').slice(0, n).replace(/[<>&"]/g, '');
    const prenomSafe = nettoie(`${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim(), 80);
    const viTypeSafe = nettoie(libelleTypeVI(f['Type']), 80);
    let viDateSafe = '';
    try {
        viDateSafe = new Date(f['Date'] + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { viDateSafe = nettoie(f['Date'], 40); }
    const viHeureSafe = nettoie(`${f['Heure début'] || ''} - ${f['Heure fin'] || ''}`, 40);
    const url = `https://vps-1a4fbee9.vps.ovh.net/reserver-vi.html?token=${encodeURIComponent(token)}`;
    const sujet = 'Modification de votre réservation de vol d\'initiation ACES';
    const texte = `Bonjour ${prenomSafe},\n\nVotre réservation de vol d'initiation a été modifiée. Voici votre nouveau créneau :\n\nType : ${viTypeSafe}\nDate : ${viDateSafe}\nHoraire : ${viHeureSafe}\nLieu : ${VI_LIEU}\nPlan : ${VI_LIEU_URL}\n\nVous pouvez consulter ou modifier votre réservation ici :\n${url}\n\nA bientôt.\nACES - Aéroclub de l'Estuaire de la Seine`;
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <div style="background:#3f51b5;color:#fff;padding:18px 24px;font-size:18px;font-weight:bold;">Votre réservation a été modifiée</div>
            <div style="padding:24px;">
                <p>Bonjour ${prenomSafe},</p>
                <p>Votre réservation de vol d'initiation a été modifiée. Voici votre nouveau créneau :</p>
                <div style="background:#f1f5f9;border-radius:8px;padding:14px 18px;margin:18px 0;">
                    <p style="margin:4px 0;"><strong>Type :</strong> ${viTypeSafe}</p>
                    <p style="margin:4px 0;"><strong>Date :</strong> ${viDateSafe}</p>
                    <p style="margin:4px 0;"><strong>Horaire :</strong> ${viHeureSafe}</p>
                    <p style="margin:4px 0;"><strong>Lieu :</strong> <a href="${VI_LIEU_URL}" style="color:#1e3d59;">${VI_LIEU}</a></p>
                </div>
                <p>Vous pouvez consulter ou modifier votre réservation en cliquant sur le lien ci-dessous :</p>
                <p style="text-align:center;margin:28px 0;">
                    <a href="${url}" style="background:#1e3d59;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;">Gérer ma réservation</a>
                </p>
                <p style="font-size:12px;color:#64748b;word-break:break-all;">Si le bouton ne s'affiche pas, copiez ce lien : <a href="${url}">${url}</a></p>
                <p style="margin-top:24px;color:#64748b;">ACES - Aéroclub de l'Estuaire de la Seine</p>
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
        console.log(`Modification VI envoyee a ${to}`);
    } catch (e) {
        console.error('Erreur envoi modification VI:', e);
    }
}

function declencherConfirmationVI(req, recordsReponse, anciens, decalages) {
    try {
        const table = decodeURIComponent(req.params.table || '');
        if (table !== 'VI Créneaux') return;
        const reqs = req.body.records || [];
        (recordsReponse || []).forEach((rec, i) => {
            const reqFields = (reqs[i] && reqs[i].fields) || {};
            const estDecalage = !!(decalages || [])[i];
            if (reqFields['Statut'] === 'Réservé' && reqFields['Date réservation']) {
                if (estDecalage) envoyerMailModificationVI(rec.fields);
                else envoyerMailConfirmationVI(rec.fields);
            } else if (reqFields['Statut'] === 'Disponible') {
                if (estDecalage) return;
                const ancien = (anciens || [])[i];
                if (ancien && ancien['Statut'] === 'Réservé' && ancien['Email']) {
                    envoyerMailLiberationVI(ancien);
                }
            }
        });
    } catch (e) {
        console.error('Declencheur confirmation VI:', e);
    }
}

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

// --- UPLOAD DE FICHIERS (stockage local, servi par nginx sous /uploads/) ---
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const EXT_AUTORISEES = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.txt', '.csv', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.zip']);
const uploadFichier = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname || '').toLowerCase();
            cb(null, `doc-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${EXT_AUTORISEES.has(ext) ? ext : '.bin'}`);
        }
    }),
    limits: { fileSize: 50 * 1024 * 1024 }
});

app.post('/v0/upload', (req, res) => {
    uploadFichier.single('file')(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (50 Mo max)' : (err.message || 'Erreur upload');
            return erreur(res, 400, msg);
        }
        if (!req.file) return erreur(res, 400, 'Aucun fichier recu');
        res.json({ url: `/uploads/${req.file.filename}` });
    });
});

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
        const sortQ = Array.isArray(req.query.sort) ? req.query.sort : (req.query.sort ? [req.query.sort] : []);
        for (let i = 0; i < 16; i++) {
            const f = req.query[`sort[${i}][field]`] || (sortQ[i] && sortQ[i].field);
            if (!f) break;
            params.push(f);
            const dirRaw = req.query[`sort[${i}][direction]`] || (sortQ[i] && sortQ[i].direction);
            const dir = (dirRaw || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
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
        let champsDemandes = req.query['fields[]'] || req.query.fields;
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
        const tableNom = decodeURIComponent(req.params.table || '');
        const crees = [];
        const decalages = [];
        for (const r of records) {
            const id = nouvelId();
            let decalage = false;
            if (r.fields && r.fields._decalage) {
                decalage = true;
                delete r.fields._decalage;
            }
            if (tableNom === 'VI Créneaux') {
                const f = r.fields || {};
                const { rows: dup } = await pool.query(
                    `SELECT id FROM ${table} WHERE fields->>'Date' = $1 AND fields->>'Heure début' = $2 AND fields->>'Heure fin' = $3 AND fields->>'Type' = $4 AND COALESCE(fields->>'Statut','Disponible') <> 'Annulé' LIMIT 1`,
                    [f['Date'] || '', f['Heure début'] || '', f['Heure fin'] || '', f['Type'] || '']
                );
                if (dup.length) return erreur(res, 409, `Un créneau ${f['Type'] || ''} existe déjà le ${f['Date'] || ''} de ${f['Heure début'] || ''} à ${f['Heure fin'] || ''}.`);
            }
            const { rows } = await pool.query(
                `INSERT INTO ${table} (id, fields) VALUES ($1, $2) RETURNING id, fields, created_at`,
                [id, r.fields || {}]
            );
            crees.push(formatRecord(rows[0]));
            decalages.push(decalage);
        }
        res.json({ records: crees });
        if (tableNom === 'VI Créneaux') {
            crees.forEach((rec, i) => {
                if (!rec.fields || rec.fields['Statut'] !== 'Réservé') return;
                if (decalages[i]) envoyerMailModificationVI(rec.fields);
                else envoyerMailConfirmationVI(rec.fields);
            });
        }
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
        const tableNom = decodeURIComponent(req.params.table || '');
        const maj = [];
        const anciens = [];
        const decalages = [];
        for (const r of records) {
            if (!r.id) return erreur(res, 422, 'id manquant');
            let decalage = false;
            if (r.fields && r.fields._decalage) {
                decalage = true;
                delete r.fields._decalage;
            }
            let ancien = null;
            if (tableNom === 'VI Créneaux' && r.fields && r.fields['Statut'] === 'Disponible') {
                const { rows: ar } = await pool.query(`SELECT fields FROM ${table} WHERE id = $1`, [r.id]);
                ancien = ar.length ? ar[0].fields : null;
            }
            const { rows } = await pool.query(
                remplacer
                    ? `UPDATE ${table} SET fields = $2 WHERE id = $1 RETURNING id, fields, created_at`
                    : `UPDATE ${table} SET fields = fields || $2 WHERE id = $1 RETURNING id, fields, created_at`,
                [r.id, r.fields || {}]
            );
            if (!rows.length) return erreur(res, 404, `Record introuvable: ${r.id}`);
            maj.push(formatRecord(rows[0]));
            anciens.push(ancien);
            decalages.push(decalage);
        }
        res.json({ records: maj });
        declencherConfirmationVI(req, maj, anciens, decalages);
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
    let viReserves = [];
    if (table === 'vi_creneaux') {
        try {
            const { rows } = await pool.query(`SELECT fields FROM ${table} WHERE id = ANY($1)`, [ids]);
            viReserves = rows.map(r => r.fields).filter(f => f && f['Statut'] === 'Réservé' && f['Email']);
        } catch (e) {
            console.error('Lecture VI avant suppression:', e);
        }
    }
    for (const id of ids) {
        await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    }
    res.json({ records: ids.map(id => ({ id, deleted: true })) });
    viReserves.forEach(f => {
        envoyerMailLiberationVI(f, true).catch(e => console.error('Mail suppression VI:', e));
    });
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
