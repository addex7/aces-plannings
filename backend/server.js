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
const { spawn } = require('child_process');
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
    'Signalements': 'signalements',
    'Carnet de vol': 'carnet_vol',
    'Soldes GVV': 'gvv_soldes',
    'Écritures GVV': 'gvv_ecritures'
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
        const mentionAnnuaire = estReset
            ? ''
            : 'En créant ton compte, tu acceptes que ton adresse e-mail et ton numéro de téléphone soient visibles par les autres membres du site dans l\'annuaire.';
        texte = `Bonjour ${prenomSafe},\n\n${ligne}\n${action}\n${url}\n\n${mentionAnnuaire ? mentionAnnuaire + '\n\n' : ''}A bientôt.\nAéroclub ACES`;
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
                ${mentionAnnuaire ? `<p style="font-size:12px;color:#64748b;background:#f1f5f9;border-radius:8px;padding:10px 14px;">${mentionAnnuaire}</p>` : ''}
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
        journaliserEcriture(req, 'Emails', 'Envoi email', `À : ${to} | Sujet : ${sujet}`, 'Emails');
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
        journaliserEcriture(req, 'Fichiers', 'Upload fichier', `${req.file.originalname || ''} → ${req.file.filename}`, 'Fichiers');
    });
});

// --- LISTE ---
// --- SYNCHRO GVV MANUELLE ---
// Lance gvv-sync.js en tache de fond (soldes + ecritures, ~2-3 min).
// Le bouton n'est visible que pour tresorier/super admin cote front ;
// ici on garde l'endpoint protege par le jeton + anti-doublon.
let gvvSyncEnCours = false;
let gvvSyncDernier = null;

app.post('/v0/:base/sync-gvv', (req, res) => {
    if (gvvSyncEnCours) return erreur(res, 409, 'Synchro GVV déjà en cours');
    gvvSyncEnCours = true;
    gvvSyncDernier = null;
    let log = '';
    const p = spawn(process.execPath, [path.join(__dirname, 'gvv-sync.js')], { cwd: __dirname });
    p.stdout.on('data', d => { log += d.toString(); });
    p.stderr.on('data', d => { log += d.toString(); });
    const fin = (code) => {
        gvvSyncEnCours = false;
        gvvSyncDernier = { fin: new Date().toISOString(), code, log: log.slice(-3000) };
    };
    p.on('close', fin);
    p.on('error', err => { gvvSyncEnCours = false; gvvSyncDernier = { fin: new Date().toISOString(), code: -1, log: String(err) }; });
    res.json({ status: 'demarre' });
    journaliserEcriture(req, 'GVV', 'Synchro GVV', 'Synchronisation manuelle lancée', 'GVV');
});

app.get('/v0/:base/sync-gvv/statut', (req, res) => {
    res.json({ enCours: gvvSyncEnCours, dernier: gvvSyncDernier });
});

// --- FICHES MEMBRES GVV ---
// Renvoie les fiches membres GVV (naissance, telephone, adresse...) pour
// completer les fiches du site. Resultat mis en cache 10 min pour menager GVV.
let gvvMembresCache = null;
let gvvMembresCacheAt = 0;
app.get('/v0/:base/gvv-membres', async (req, res) => {
    if (gvvMembresCache && Date.now() - gvvMembresCacheAt < 10 * 60 * 1000) {
        return res.json({ membres: gvvMembresCache, cache: true });
    }
    try {
        const { recupererMembresGvv } = require('./gvv-membres');
        const membres = await recupererMembresGvv();
        gvvMembresCache = membres;
        gvvMembresCacheAt = Date.now();
        res.json({ membres });
    } catch (e) {
        console.error('GVV membres:', e);
        erreur(res, 502, `Lecture GVV impossible : ${e.message}`);
    }
});

// --- ENVOI MANUEL D'UN VOL DU CARNET VERS GVV ---
// Bouton reserve aux super admin cote front. Cree le vol dans GVV (vols_avion),
// ce qui declenche la facturation GVV, puis note l'id GVV sur le record.
app.post('/v0/:base/gvv-vol', async (req, res) => {
    const recordId = String((req.body || {}).recordId || '');
    if (!recordId) return erreur(res, 400, 'recordId requis');
    try {
        const { envoyerVolAvion, cleNomGvvLettres } = require('./gvv-vols');
        const { rows } = await pool.query(
            'SELECT id, fields FROM carnet_route_pilotes WHERE id = $1', [recordId]);
        if (!rows.length) return erreur(res, 404, 'Vol introuvable dans le carnet');
        const fields = rows[0].fields || {};
        if (fields['GVV ID']) {
            return erreur(res, 409, `Vol déjà envoyé à GVV (#${fields['GVV ID']})`);
        }
        const pilote = (fields['Pilote'] || '').toString().trim();
        // Alias « Compte GVV » de la fiche membre quand le nom GVV differe
        let alias = null;
        if (pilote) {
            const cible = cleNomGvvLettres(pilote);
            const { rows: membres } = await pool.query('SELECT fields FROM utilisateurs');
            const membre = membres.find(r => {
                const f = r.fields || {};
                const nc = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
                return nc && cleNomGvvLettres(nc) === cible;
            });
            alias = ((membre && (membre.fields || {})['Compte GVV']) || '').toString().trim() || null;
        }
        const resultat = await envoyerVolAvion(fields, alias, pool);
        if (!resultat.ok) return erreur(res, 502, resultat.message);
        const nouveaux = { ...fields, 'GVV ID': resultat.gvvId || '', 'Envoyé GVV le': new Date().toISOString() };
        await pool.query(
            'UPDATE carnet_route_pilotes SET fields = $1 WHERE id = $2',
            [JSON.stringify(nouveaux), recordId]);
        journaliserEcriture(req, 'Carnet de route Pilotes', 'Envoi GVV',
            `${pilote} — ${fields['Machine'] || ''} du ${fields['Date'] || ''} → vol GVV #${resultat.gvvId || '?'} (compteurs ${resultat.resume ? resultat.resume.compteurs : ''}, payeur ${resultat.resume ? resultat.resume.payeur : ''})`,
            `${pilote} ${fields['Date'] || ''}`.trim() || recordId);
        res.json({ ok: true, gvvId: resultat.gvvId, resume: resultat.resume });
    } catch (e) {
        console.error('Envoi GVV:', e);
        erreur(res, 502, `Envoi GVV impossible : ${e.message}`);
    }
});

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

        let orderBy = 'ORDER BY created_at ASC, f.id ASC';
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
        if (sorts.length) orderBy = `ORDER BY ${sorts.join(', ')}, f.id ASC`;

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
// --- AUDIT AUTOMATIQUE DES ECRITURES ---
// Chaque POST/PATCH/PUT/DELETE laisse une trace dans la table audit, avec
// l'utilisateur transmis par le header X-User-Name. La table audit elle-meme
// est exclue (les entrees du journal ne doivent pas s'auto-journaliser).
function utilisateurDepuis(req) {
    return (req.headers['x-user-name'] || '').toString().trim() || 'Visiteur';
}

// Champs sensibles dont la valeur ne doit jamais apparaitre dans le journal
const CHAMPS_SECRETS = /mot de passe|password|token|jeton|secret|apikey|api_key|clé/i;

// Liste lisible « champ : valeur » pour les creations/suppressions
function resumeChamps(fields, max = 400) {
    const lignes = [];
    for (const k of Object.keys(fields || {})) {
        if (CHAMPS_SECRETS.test(k)) { lignes.push(`${k} : •••`); continue; }
        const v = fmtValAudit(fields[k]);
        if (v !== '') lignes.push(`${k} : ${v}`);
    }
    const s = lignes.join(' | ');
    return s.length > max ? s.slice(0, max) + '…' : s;
}

// Libelle lisible d'un enregistrement pour la colonne Cible de l'audit
function libelleRecord(fields) {
    if (!fields) return '';
    const prenomNom = `${fields['Prénom'] || ''} ${fields['Nom'] || ''}`.trim();
    if (prenomNom && (fields['Prénom'] || fields['Identifiant'] || fields['Mail'])) return prenomNom;
    const cles = ['Immatriculation', 'Titre', 'Pilote', 'Compte', 'Objet', 'Libellé', 'Instructeur', 'Passager'];
    for (const c of cles) { if (fields[c]) return String(fields[c]); }
    if (prenomNom) return prenomNom;
    for (const c of ['Nom', 'Type', 'Date']) { if (fields[c]) return String(fields[c]); }
    return '';
}

function fmtValAudit(v) {
    if (v === undefined || v === null || v === '') return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

// Diff lisible entre l'ancien etat et les champs envoyes : « champ : avant → apres »
// Retourne '' quand rien n'a reellement change : l'appelant n'ecrit alors pas de ligne.
function diffChamps(ancien, nouveau) {
    const lignes = [];
    for (const k of Object.keys(nouveau || {})) {
        const a = fmtValAudit(ancien ? ancien[k] : undefined);
        const b = fmtValAudit(nouveau[k]);
        if (a === b) continue;
        if (/mot de passe|password/i.test(k)) {
            lignes.push(`Mot de passe ${a ? 'réinitialisé' : 'initialisé'}`);
        } else if (CHAMPS_SECRETS.test(k)) {
            lignes.push(`${k} : (modifié)`);
        } else {
            lignes.push(`${k} : ${a || '∅'} → ${b || '∅'}`);
        }
    }
    const s = lignes.join(' | ');
    return s.length > 600 ? s.slice(0, 600) + '…' : s;
}

function journaliserEcriture(req, tableNom, action, details, cible = '') {
    if (!tableNom || ['audit', 'notifications'].includes(String(tableNom).toLowerCase())) return;
    pool.query(
        `INSERT INTO audit (id, fields) VALUES ($1, $2)`,
        [nouvelId(), {
            'Date': new Date().toISOString(),
            'Utilisateur': utilisateurDepuis(req),
            'Action': action,
            'Cible': cible || tableNom,
            'Détails': String(details || '').slice(0, 3000),
            'Module': 'Auto'
        }]
    ).catch(e => console.error('Audit auto:', e.message));
}

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
        journaliserEcriture(req, tableNom, 'Création',
            crees.length === 1
                ? `${resumeChamps(crees[0].fields)} (id ${crees[0].id})`
                : `${crees.length} enregistrements : ${crees.map(c => c.id).join(', ')}`,
            crees.length === 1 ? (libelleRecord(crees[0].fields) || tableNom) : tableNom);
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

// Restaure les creneaux Disponible supprimes par la creation manuelle d'un
// creneau (champ "Créneaux remplacés" = JSON [{Date, Heure début, Heure fin, Type}]).
async function restaurerCreneauxRemplaces(ancienFields) {
    let liste = null;
    try { liste = JSON.parse((ancienFields || {})['Créneaux remplacés'] || 'null'); } catch (e) { liste = null; }
    if (!Array.isArray(liste) || !liste.length) return;
    for (const c of liste) {
        if (!c || !c['Date'] || !c['Heure début'] || !c['Heure fin']) continue;
        const type = c['Type'] || 'VI';
        try {
            const { rows } = await pool.query(
                `SELECT id FROM vi_creneaux
                 WHERE fields->>'Date' = $1
                   AND COALESCE(fields->>'Type','VI') = $2
                   AND COALESCE(fields->>'Statut','Disponible') <> 'Annulé'
                   AND fields->>'Heure début' < $4
                   AND fields->>'Heure fin' > $3`,
                [c['Date'], type, c['Heure début'], c['Heure fin']]
            );
            if (rows.length) continue;
            await pool.query(
                `INSERT INTO vi_creneaux (id, fields) VALUES ($1, $2)`,
                [nouvelId(), { 'Date': c['Date'], 'Heure début': c['Heure début'], 'Heure fin': c['Heure fin'], 'Type': type, 'Statut': 'Disponible' }]
            );
        } catch (e) {
            console.error('Restauration creneau VI:', e);
        }
    }
}

// --- MISE A JOUR ---
async function majRecords(req, res, remplacer) {
    const table = tableSql(req, res);
    if (!table) return;
    try {
        const records = req.body.records;
        if (!Array.isArray(records) || !records.length) return erreur(res, 422, 'records manquant');
        const tableNom = decodeURIComponent(req.params.table || '');
        let anciensMap = {};
        try {
            const idsMaj = records.map(r => r.id).filter(Boolean);
            if (idsMaj.length) {
                const { rows: av } = await pool.query(`SELECT id, fields FROM ${table} WHERE id = ANY($1)`, [idsMaj]);
                anciensMap = Object.fromEntries(av.map(x => [x.id, x.fields]));
            }
        } catch (e) { console.error('Audit diff:', e); }
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
                if (ancien && ancien['Créneaux remplacés']) {
                    // Creneau cree a la main en ecrasant d'autres creneaux : au lieu de le
                    // liberer tel quel, on le supprime et on restaure les creneaux d'origine.
                    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [r.id]);
                    await restaurerCreneauxRemplaces(ancien);
                    maj.push({ id: r.id, deleted: true });
                    anciens.push(ancien);
                    decalages.push(decalage);
                    continue;
                }
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
        {
            const parties = maj.map((m, i) => {
                if (m.deleted) return `enregistrement ${m.id} supprimé`;
                const envoye = (records[i] && records[i].fields) || {};
                return diffChamps(anciensMap[m.id], envoye);
            }).filter(Boolean);
            if (parties.length) {
                journaliserEcriture(req, tableNom, 'Modification',
                    maj.length === 1 ? parties[0] : `${maj.length} enregistrements | ${parties.slice(0, 4).join(' || ')}${maj.length > 4 ? ' || …' : ''}`,
                    maj.length === 1 ? (libelleRecord(maj[0].fields) || tableNom) : tableNom);
            }
        }
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
        let ancien = null;
        try {
            const { rows: av } = await pool.query(`SELECT fields FROM ${table} WHERE id = $1`, [req.params.id]);
            ancien = av.length ? av[0].fields : null;
        } catch (e) { console.error('Audit diff:', e); }
        const { rows } = await pool.query(
            remplacer
                ? `UPDATE ${table} SET fields = $2 WHERE id = $1 RETURNING id, fields, created_at`
                : `UPDATE ${table} SET fields = fields || $2 WHERE id = $1 RETURNING id, fields, created_at`,
            [req.params.id, fields]
        );
        if (!rows.length) return erreur(res, 404, `Record introuvable: ${req.params.id}`);
        res.json(formatRecord(rows[0]));
        const diff = diffChamps(ancien, fields);
        if (diff) {
            journaliserEcriture(req, decodeURIComponent(req.params.table || ''), 'Modification',
                diff,
                libelleRecord(rows[0].fields) || decodeURIComponent(req.params.table || ''));
        }
    } catch (e) {
        console.error('PATCH/PUT one:', e);
        erreur(res, 500, e.message);
    }
}
app.patch('/v0/:base/:table/:id', (req, res) => majRecordUnitaire(req, res, false));
app.put('/v0/:base/:table/:id', (req, res) => majRecordUnitaire(req, res, true));

// --- SUPPRESSION ---
async function supprimerIds(req, res, table, ids) {
    let viReserves = [];
    let viRemplaces = [];
    let anciensMap = {};
    try {
        const { rows } = await pool.query(`SELECT id, fields FROM ${table} WHERE id = ANY($1)`, [ids]);
        anciensMap = Object.fromEntries(rows.map(x => [x.id, x.fields]));
        if (table === 'vi_creneaux') {
            viReserves = rows.map(r => r.fields).filter(f => f && f['Statut'] === 'Réservé' && f['Email']);
            viRemplaces = rows.map(r => r.fields).filter(f => f && f['Créneaux remplacés']);
        }
    } catch (e) {
        console.error('Lecture enregistrements avant suppression:', e);
    }
    for (const id of ids) {
        await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    }
    res.json({ records: ids.map(id => ({ id, deleted: true })) });
    journaliserEcriture(req, decodeURIComponent(req.params.table || ''), 'Suppression',
        ids.length === 1
            ? `${resumeChamps(anciensMap[ids[0]], 300)} (id ${ids[0]})`
            : `${ids.length} enregistrements : ${ids.join(', ')}`,
        libelleRecord(anciensMap[ids[0]]) || decodeURIComponent(req.params.table || ''));
    viReserves.forEach(f => {
        envoyerMailLiberationVI(f, true).catch(e => console.error('Mail suppression VI:', e));
    });
    for (const f of viRemplaces) {
        try { await restaurerCreneauxRemplaces(f); } catch (e) { console.error('Restauration creneaux:', e); }
    }
}
app.delete('/v0/:base/:table/:id', async (req, res) => {
    const table = tableSql(req, res);
    if (!table) return;
    try {
        await supprimerIds(req, res, table, [req.params.id]);
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
        await supprimerIds(req, res, table, ids);
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
