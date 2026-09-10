/* ==========================================================================
   MESSAGERIE INTERNE
   ========================================================================== */

const TABLE_MESSAGERIE = 'Messagerie';
const TABLE_UTILISATEURS_MESSAGERIE = 'Utilisateurs';
const FIELDS_MESSAGE = {
    DATE: 'Date',
    EXPEDITEUR: 'Expéditeur',
    DESTINATAIRE: 'Destinataire',
    OBJET: 'Objet',
    CORPS: 'Corps',
    PIECE: 'Pièce jointe',
    LU: 'Lu'
};

function threadKey(objet) {
    return (objet || '').toString().replace(/^(re|ré)\s*:?\s*/i, '').trim().toLowerCase();
}

function formaterDateMessage(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return dateStr;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function aPieceJointe(pieceVal) {
    if (Array.isArray(pieceVal) && pieceVal.length) return true;
    if (typeof pieceVal === 'string' && pieceVal.trim()) {
        if (pieceVal.startsWith('http')) return true;
        try {
            const pj = JSON.parse(pieceVal);
            if (pj && pj.data && pj.filename) return true;
        } catch (e) {}
    }
    return false;
}

function renderPieceJointe(pieceVal) {
    if (Array.isArray(pieceVal) && pieceVal.length) {
        return `<div class="message-attachments"><strong>Pièce(s) jointe(s) :</strong><br>` +
          pieceVal.map(p => `<a href="${escHtml(p.url)}" target="_blank">${escHtml(p.filename || p.url)}</a>`).join('<br>') +
          `</div>`;
    } else if (typeof pieceVal === 'string' && pieceVal.trim()) {
        if (pieceVal.startsWith('http')) {
            return `<div class="message-attachments"><a href="${escHtml(pieceVal)}" target="_blank">📎 Ouvrir la pièce jointe</a></div>`;
        } else {
            try {
                const pj = JSON.parse(pieceVal);
                if (pj && pj.data && pj.filename) {
                    return `<div class="message-attachments"><a href="${escHtml(pj.data)}" download="${escHtml(pj.filename)}">📎 Télécharger ${escHtml(pj.filename)}</a></div>`;
                }
            } catch (e) {}
        }
    }
    return '';
}

let messagesCache = [];
let utilisateursMessagerieCache = [];
let destinatairesSelectionnes = [];

function nomCompletCourant() {
    if (typeof currentUser === 'undefined' || !currentUser) return '';
    return `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
}

function initMessagerie() {
    const form = document.getElementById('message-form');
    const fileInput = document.getElementById('message-piece');
    const fileName = document.getElementById('message-piece-name');
    const nouveauBtn = document.getElementById('btn-nouveau-message');
    const close = document.getElementById('message-read-close');
    const list = document.getElementById('message-destinataires-list');
    const tousBtn = document.getElementById('message-destinataires-tous');

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileName) fileName.textContent = fileInput.files[0]?.name || '';
        });
    }
    if (form) form.addEventListener('submit', envoyerMessage);
    if (nouveauBtn) {
        nouveauBtn.addEventListener('click', () => {
            const formSection = document.getElementById('message-form-section');
            if (formSection) formSection.style.display = formSection.style.display === 'none' ? 'block' : 'none';
        });
    }
    if (close) {
        close.addEventListener('click', () => {
            const modal = document.getElementById('message-read-modal');
            if (modal) modal.style.display = 'none';
        });
    }
    document.addEventListener('click', (e) => {
        const modal = document.getElementById('message-read-modal');
        if (modal && e.target === modal) modal.style.display = 'none';
    });
    const messagesList = document.getElementById('messages-list');
    if (messagesList) {
        messagesList.addEventListener('click', (e) => {
            const item = e.target.closest('.message-item');
            if (item) voirMessage(item.dataset.id);
        });
    }
    if (list) {
        list.addEventListener('change', (e) => {
            if (e.target && e.target.classList.contains('destinataire-check')) {
                basculerDestinataire(e.target.value, e.target.checked);
            }
        });
    }
    if (tousBtn) tousBtn.addEventListener('click', basculerTousLesDestinataires);
    chargerDestinataires();

    // Auto-rafraîchissement
    setInterval(() => {
        if (typeof compterMessagesNonLus === 'function') compterMessagesNonLus();
        const vue = document.getElementById('view-messagerie');
        if (vue && vue.style.display !== 'none' && typeof chargerMessagerie === 'function') chargerMessagerie();
    }, 15000);
}

function renderDestinatairesListe() {
    const container = document.getElementById('message-destinataires-list');
    if (!container) return;
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    const utilisateurs = (utilisateursMessagerieCache || []).map(r => {
        const f = r.fields || {};
        return `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
    }).filter(n => n && n !== current).sort();
    if (utilisateurs.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8; font-size:13px;">Aucun destinataire disponible</span>';
        return;
    }
    const allSelected = utilisateurs.length > 0 && utilisateurs.every(n => destinatairesSelectionnes.includes(n));
    container.innerHTML = utilisateurs.map((nom, i) => `
        <label style="display:flex; align-items:center; gap:8px; padding:6px 4px; cursor:pointer; color:#334155; ${i % 2 === 1 ? 'background:#f1f5f9;' : ''}">
            <input type="checkbox" class="destinataire-check" style="width:auto; padding:0; border:none; flex-shrink:0;" value="${escHtml(nom)}" ${destinatairesSelectionnes.includes(nom) ? 'checked' : ''}>
            <span style="flex:1; min-width:0; overflow-wrap:break-word;">${escHtml(nom)}</span>
        </label>
    `).join('');
    const tousBtn = document.getElementById('message-destinataires-tous');
    if (tousBtn) tousBtn.textContent = allSelected ? 'Décocher tout le monde' : 'Tout le monde';
}

function basculerDestinataire(nom, checked) {
    if (checked) {
        if (!destinatairesSelectionnes.includes(nom)) destinatairesSelectionnes.push(nom);
    } else {
        destinatairesSelectionnes = destinatairesSelectionnes.filter(n => n !== nom);
    }
    renderDestinatairesListe();
}

function basculerTousLesDestinataires() {
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    const utilisateurs = (utilisateursMessagerieCache || []).map(r => {
        const f = r.fields || {};
        return `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
    }).filter(n => n && n !== current);
    const allSelected = utilisateurs.length > 0 && utilisateurs.every(n => destinatairesSelectionnes.includes(n));
    destinatairesSelectionnes = allSelected ? [] : [...utilisateurs];
    renderDestinatairesListe();
}

async function chargerDestinataires() {
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS_MESSAGERIE)}?sort[0][field]=Nom&sort[0][direction]=asc`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        utilisateursMessagerieCache = data.records || [];
        renderDestinatairesListe();
    } catch (err) {
        console.error('Erreur chargement destinataires:', err);
    }
}

async function chargerMessagesAvecOffset(formula) {
    const all = [];
    let offset = '';
    do {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_MESSAGERIE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100${offset ? '&offset=' + encodeURIComponent(offset) : ''}`;
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        all.push(...(data.records || []));
        offset = data.offset || '';
    } while (offset);
    return all;
}

async function chargerMessagerie() {
    const container = document.getElementById('messages-list');
    if (!container) return;
    container.innerHTML = '<div class="loading">Chargement...</div>';
    const nom = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    if (!nom) {
        container.innerHTML = '<p class="carnet-empty">Connectez-vous pour voir vos messages.</p>';
        return;
    }
    const escaped = nom.replace(/'/g, "\\'");
    const formula = `OR(FIND('Tous', {Destinataire}) > 0, FIND('${escaped}', {Destinataire}) > 0, {Expéditeur}='${escaped}')`;
    try {
        messagesCache = await chargerMessagesAvecOffset(formula);
        afficherMessages(messagesCache);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<p class="carnet-empty">Erreur de chargement : ${escHtml(err.message)}</p>`;
    }
}

function grouperParThread(records) {
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    const groups = {};
    records.forEach(r => {
        const f = r.fields || {};
        const key = threadKey(f[FIELDS_MESSAGE.OBJET]);
        if (!groups[key]) {
            groups[key] = { key, messages: [], participants: new Set(), hasPiece: false, unread: false };
        }
        const g = groups[key];
        g.messages.push(r);
        [f[FIELDS_MESSAGE.EXPEDITEUR], f[FIELDS_MESSAGE.DESTINATAIRE]].forEach(v => {
            if (typeof v === 'string') {
                v.split(';').forEach(n => {
                    n = n.trim();
                    if (n) g.participants.add(n);
                });
            }
        });
        g.hasPiece = g.hasPiece || aPieceJointe(f[FIELDS_MESSAGE.PIECE]);
        if (!f[FIELDS_MESSAGE.LU] && f[FIELDS_MESSAGE.EXPEDITEUR] !== current) g.unread = true;
    });
    Object.values(groups).forEach(g => {
        g.messages.sort((a, b) => new Date(a.fields[FIELDS_MESSAGE.DATE]) - new Date(b.fields[FIELDS_MESSAGE.DATE]));
        g.lastMessage = g.messages[g.messages.length - 1];
        g.subject = (g.lastMessage.fields[FIELDS_MESSAGE.OBJET] || '').replace(/^(re|ré)\s*:?\s*/i, '').trim() || '(sans objet)';
        g.participants = Array.from(g.participants).filter(Boolean);
    });
    return Object.values(groups).sort((a, b) => new Date(b.lastMessage.fields[FIELDS_MESSAGE.DATE]) - new Date(a.lastMessage.fields[FIELDS_MESSAGE.DATE]));
}

function formatParticipants(participants) {
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    const others = participants.filter(n => n !== current);
    if (others.length === 0) return 'Moi';
    let txt = others.slice(0, 2).join(', ');
    if (others.length > 2) txt += ` +${others.length - 2}`;
    return txt;
}

function afficherMessages(records) {
    const container = document.getElementById('messages-list');
    if (!container) return;
    if (!records.length) {
        container.innerHTML = '<p class="carnet-empty">Aucun message.</p>';
        return;
    }
    const threads = grouperParThread(records);
    container.innerHTML = threads.map(t => {
        const expediteur = t.lastMessage.fields[FIELDS_MESSAGE.EXPEDITEUR] || '';
        const preview = (t.lastMessage.fields[FIELDS_MESSAGE.CORPS] || '').replace(/\s+/g, ' ').trim().substring(0, 80);
        const date = formaterDateMessage(t.lastMessage.fields[FIELDS_MESSAGE.DATE]);
        const piece = t.hasPiece ? '<span class="message-thread-piece">📎</span>' : '';
        return `<div class="message-item message-thread-item ${t.unread ? 'message-thread-unread' : ''}" data-id="${escHtml(t.lastMessage.id)}" title="${escHtml(t.subject)}">
            <div class="message-thread-main">
                <span class="message-thread-sender">${escHtml(formatParticipants(t.participants))}</span>
                <span class="message-thread-subject">${escHtml(t.subject)} ${piece}</span>
                <span class="message-thread-preview">${escHtml(preview)}${preview.length >= 80 ? '…' : ''}</span>
            </div>
            <div class="message-thread-meta">
                <span class="message-thread-date">${escHtml(date)}</span>
                ${t.unread ? '<span class="message-thread-dot"></span>' : ''}
            </div>
        </div>`;
    }).join('');
}

async function envoyerMessage(e) {
    e.preventDefault();
    const objet = document.getElementById('message-objet');
    const corps = document.getElementById('message-corps');
    const fileInput = document.getElementById('message-piece');
    const fileName = document.getElementById('message-piece-name');
    const loader = document.getElementById('message-loader');
    if (!objet || !corps) return;

    const objetVal = objet.value.trim();
    const corpsVal = corps.value.trim();
    if (destinatairesSelectionnes.length === 0) { alert('Veuillez choisir au moins un destinataire.'); return; }
    if (!objetVal || !corpsVal) { alert('Objet et corps sont requis.'); return; }

    const expediteur = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    if (!expediteur) { alert('Vous devez être connecté.'); return; }

    if (loader) loader.style.display = 'flex';
    try {
        let pieceJointe = null;
        const file = fileInput && fileInput.files[0];
        if (file) {
            const uploader = typeof uploaderFichierDocument === 'function' ? uploaderFichierDocument : null;
            if (!uploader) throw new Error('Uploader non disponible');
            pieceJointe = await uploader(file);
        }

        const fields = {
            [FIELDS_MESSAGE.DATE]: new Date().toISOString().slice(0, 10),
            [FIELDS_MESSAGE.EXPEDITEUR]: expediteur,
            [FIELDS_MESSAGE.DESTINATAIRE]: destinatairesSelectionnes.join('; '),
            [FIELDS_MESSAGE.OBJET]: objetVal,
            [FIELDS_MESSAGE.CORPS]: corpsVal,
            [FIELDS_MESSAGE.LU]: false
        };
        if (pieceJointe !== null) fields[FIELDS_MESSAGE.PIECE] = pieceJointe;

        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_MESSAGERIE)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur envoi');
        const record = (data.records || [])[0];
        if (!record) throw new Error('Aucune réponse Airtable');

        if (typeof viderApiCache === 'function') viderApiCache();
        alert('Message envoyé.');
        const messageForm = document.getElementById('message-form');
        if (messageForm) messageForm.reset();
        if (fileName) fileName.textContent = '';
        destinatairesSelectionnes = [];
        renderDestinatairesListe();
        const messageFormSection = document.getElementById('message-form-section');
        if (messageFormSection) messageFormSection.style.display = 'none';
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'envoi : ' + (err.message || 'inconnue'));
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

function trouverThreadParMessageId(id) {
    const record = messagesCache.find(r => r.id === id);
    if (!record) return null;
    const key = threadKey(record.fields[FIELDS_MESSAGE.OBJET]);
    return grouperParThread(messagesCache).find(t => t.key === key);
}

function voirMessage(id) {
    const thread = trouverThreadParMessageId(id);
    if (!thread) return;
    afficherThread(thread);
}

function afficherThread(thread) {
    const modal = document.getElementById('message-read-modal');
    const content = document.getElementById('message-read-content');
    if (!modal || !content) return;

    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    const messagesHtml = thread.messages.map(r => {
        const f = r.fields || {};
        const date = formaterDateMessage(f[FIELDS_MESSAGE.DATE]);
        const expediteur = f[FIELDS_MESSAGE.EXPEDITEUR] || '';
        const isMe = expediteur === current;
        const body = escHtml(f[FIELDS_MESSAGE.CORPS] || '');
        const pieceHtml = renderPieceJointe(f[FIELDS_MESSAGE.PIECE]);
        return `<div class="message-bubble ${isMe ? 'message-bubble-me' : 'message-bubble-other'}">
            <div class="message-bubble-header">
                <span class="message-bubble-sender">${escHtml(expediteur) || 'Expéditeur'}</span>
                <span>${escHtml(date)}</span>
            </div>
            <div class="message-bubble-body">${body}</div>
            ${pieceHtml}
        </div>`;
    }).join('');

    content.innerHTML = `
        <div class="message-thread-header">
            <h3>${escHtml(thread.subject)}</h3>
            <div class="message-thread-participants">Avec : ${escHtml(formatParticipants(thread.participants))}</div>
        </div>
        <div class="message-thread-messages">${messagesHtml}</div>
        <div class="message-thread-actions">
            <button type="button" class="btn-secondary message-reply-expediteur" style="flex:1; min-width:140px;">Répondre à l'expéditeur</button>
            <button type="button" class="btn-secondary message-reply-destinataires" style="flex:1; min-width:140px;">Répondre aux destinataires</button>
            <button type="button" class="btn-secondary message-reply-tous" style="flex:1; min-width:140px;">Répondre à tout le monde</button>
        </div>
    `;
    modal.style.display = 'flex';

    const btnExp = content.querySelector('.message-reply-expediteur');
    const btnDest = content.querySelector('.message-reply-destinataires');
    const btnTous = content.querySelector('.message-reply-tous');
    if (btnExp) btnExp.addEventListener('click', () => repondreMessageThread(thread, 'expediteur'));
    if (btnDest) btnDest.addEventListener('click', () => repondreMessageThread(thread, 'destinataires'));
    if (btnTous) btnTous.addEventListener('click', () => repondreMessageThread(thread, 'tous'));

    const ids = thread.messages.filter(r => !r.fields[FIELDS_MESSAGE.LU] && r.fields[FIELDS_MESSAGE.EXPEDITEUR] !== current).map(r => r.id);
    if (ids.length) marquerMessagesLus(ids);
}

async function marquerMessagesLus(ids) {
    if (!ids || !ids.length) return;
    try {
        await Promise.all(ids.map(id => fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_MESSAGERIE)}/${id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { [FIELDS_MESSAGE.LU]: true } })
        })));
        ids.forEach(id => {
            const r = messagesCache.find(x => x.id === id);
            if (r) r.fields[FIELDS_MESSAGE.LU] = true;
        });
        afficherMessages(messagesCache);
        if (typeof compterMessagesNonLus === 'function') await compterMessagesNonLus();
    } catch (err) {
        console.error('Erreur marquer messages lus:', err);
    }
}

function repondreMessageThread(thread, mode) {
    const lastRecord = thread.lastMessage;
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    const expediteur = lastRecord.fields[FIELDS_MESSAGE.EXPEDITEUR] || '';
    let destinataires = [];
    if (mode === 'expediteur') {
        const full = trouverNomComplet(expediteur);
        destinataires = [full].filter(Boolean);
    } else {
        const others = thread.participants.filter(n => n && n !== current);
        destinataires = others.length ? others : nomsDestinatairesPossibles();
    }
    ouvrirReponse(lastRecord, destinataires);
}

async function compterMessagesNonLus() {
    const badge = document.getElementById('messagerie-badge');
    if (!badge) return;
    const destinataire = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    if (!destinataire) { badge.style.display = 'none'; return; }
    const formula = `AND(OR(FIND('Tous', {Destinataire}) > 0, FIND('${destinataire.replace(/'/g, "\\'")}', {Destinataire}) > 0), {Lu}=FALSE())`;
    try {
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_MESSAGERIE)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=1`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const count = (data.records || []).length;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    } catch (err) {
        console.error('Erreur compteur messages:', err);
    }
}

function nomsDestinatairesPossibles() {
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    return (utilisateursMessagerieCache || []).map(r => {
        const f = r.fields || {};
        return `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
    }).filter(n => n && n !== current);
}

function trouverNomComplet(short) {
    if (!short) return '';
    if (short.indexOf('.') === -1) return short;
    const all = (utilisateursMessagerieCache || []).map(r => {
        const f = r.fields || {};
        return `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
    }).filter(Boolean);
    const formater = typeof formaterNomPilote === 'function' ? formaterNomPilote : n => n;
    const found = all.find(full => formater(full) === short);
    return found || short;
}

function ouvrirReponse(record, destinataires) {
    const modal = document.getElementById('message-read-modal');
    const formSection = document.getElementById('message-form-section');
    const objet = document.getElementById('message-objet');
    const corps = document.getElementById('message-corps');
    if (modal) modal.style.display = 'none';
    if (formSection) formSection.style.display = 'block';
    if (objet) {
        const original = (record.fields || {})[FIELDS_MESSAGE.OBJET] || '';
        const originalTrim = original.trim();
        objet.value = originalTrim.toLowerCase().startsWith('re: ') ? originalTrim : 'Re: ' + originalTrim;
    }
    if (corps) corps.value = '';
    destinatairesSelectionnes = [...destinataires];
    renderDestinatairesListe();
    if (corps) corps.focus();
}

function repondreMessage(record, mode) {
    const f = record.fields || {};
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    if (mode === 'expediteur') {
        const expediteur = f[FIELDS_MESSAGE.EXPEDITEUR] || '';
        const full = trouverNomComplet(expediteur);
        ouvrirReponse(record, [full].filter(Boolean));
    } else if (mode === 'destinataires') {
        const destRaw = (f[FIELDS_MESSAGE.DESTINATAIRE] || '').toString().trim();
        let liste = [];
        if (destRaw === 'Tous' || destRaw.toLowerCase().includes('tous')) {
            liste = nomsDestinatairesPossibles();
        } else {
            liste = destRaw.split(';').map(s => s.trim()).filter(s => s && s !== current);
        }
        if (liste.includes('Tous')) {
            liste = nomsDestinatairesPossibles();
        }
        ouvrirReponse(record, liste);
    } else if (mode === 'tous') {
        ouvrirReponse(record, nomsDestinatairesPossibles());
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('view-messagerie')) { initMessagerie(); compterMessagesNonLus(); }
});
