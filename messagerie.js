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

let messagesCache = [];
let utilisateursMessagerieCache = [];
let destinatairesSelectionnes = [];

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
    const current = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
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
        <label style="display:flex; align-items:center; gap:8px; padding:6px 0; cursor:pointer; color:#334155; ${i % 2 === 1 ? 'background:#f1f5f9;' : ''}">
            <input type="checkbox" class="destinataire-check" value="${escHtml(nom)}" ${destinatairesSelectionnes.includes(nom) ? 'checked' : ''}>
            <span>${escHtml(nom)}</span>
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
    const current = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
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

async function chargerMessagerie() {
    const container = document.getElementById('messages-list');
    if (!container) return;
    container.innerHTML = '<div class="loading">Chargement...</div>';
    const destinataire = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
    if (!destinataire) {
        container.innerHTML = '<p class="carnet-empty">Connectez-vous pour voir vos messages.</p>';
        return;
    }
    const formula = `OR(FIND('Tous', {Destinataire}), FIND('${destinataire.replace(/'/g, "\\'")}', {Destinataire}))`;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_MESSAGERIE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=50`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        messagesCache = data.records || [];
        afficherMessages(messagesCache);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<p class="carnet-empty">Erreur de chargement : ${escHtml(err.message)}</p>`;
    }
}

function afficherMessages(records) {
    const container = document.getElementById('messages-list');
    if (!container) return;
    if (records.length === 0) {
        container.innerHTML = '<p class="carnet-empty">Aucun message.</p>';
        return;
    }
    container.innerHTML = records.map(r => {
        const f = r.fields || {};
        const d = f[FIELDS_MESSAGE.DATE] ? new Date(f[FIELDS_MESSAGE.DATE] + 'T00:00:00') : null;
        const date = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '';
        const lu = f[FIELDS_MESSAGE.LU];
        const expediteur = f[FIELDS_MESSAGE.EXPEDITEUR] || '';
        const objet = f[FIELDS_MESSAGE.OBJET] || '(sans objet)';
        const pieceVal = f[FIELDS_MESSAGE.PIECE];
        const aPiece = Array.isArray(pieceVal) ? pieceVal.length > 0 : (typeof pieceVal === 'string' && pieceVal.trim().length > 0);
        const piece = aPiece ? '📎' : '';
        return `<div class="message-item ${lu ? 'message-lu' : 'message-non-lu'}" data-id="${escHtml(r.id)}" style="cursor:pointer; padding:10px 12px; border-bottom:1px solid #e2e8f0;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:#1e3d59;">${escHtml(expediteur)}</strong>
                <span style="font-size:12px; color:#64748b;">${escHtml(date)}</span>
            </div>
            <div style="margin-top:4px;">${lu ? '' : '<span style="color:#dc2626; font-weight:bold;">●</span> '}<span style="color:#334155;">${escHtml(objet)}</span> ${piece}</div>
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

    const expediteur = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
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

function voirMessage(id) {
    const record = messagesCache.find(r => r.id === id);
    if (!record) return;
    const f = record.fields || {};
    const modal = document.getElementById('message-read-modal');
    const content = document.getElementById('message-read-content');
    if (!modal || !content) return;

    const d = f[FIELDS_MESSAGE.DATE] ? new Date(f[FIELDS_MESSAGE.DATE] + 'T00:00:00') : null;
    const date = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '';
    const pieceVal = f[FIELDS_MESSAGE.PIECE];
    let piecesHtml = '';
    if (Array.isArray(pieceVal) && pieceVal.length) {
        piecesHtml = `<div style="margin-top:15px;"><strong>Pièce(s) jointe(s) :</strong><br>` +
          pieceVal.map(p => `<a href="${escHtml(p.url)}" target="_blank" style="display:inline-block; margin-top:4px;">${escHtml(p.filename || p.url)}</a>`).join('<br>') +
          `</div>`;
    } else if (typeof pieceVal === 'string' && pieceVal.trim()) {
        if (pieceVal.startsWith('http')) {
            piecesHtml = `<div style="margin-top:15px;"><a href="${escHtml(pieceVal)}" target="_blank" style="display:inline-block; background:#1e3d59; color:white; padding:8px 12px; border-radius:6px; text-decoration:none;">📎 Ouvrir la pièce jointe</a></div>`;
        } else {
            try {
                const pj = JSON.parse(pieceVal);
                if (pj && pj.data && pj.filename) {
                    piecesHtml = `<div style="margin-top:15px;"><a href="${escHtml(pj.data)}" download="${escHtml(pj.filename)}" style="display:inline-block; background:#1e3d59; color:white; padding:8px 12px; border-radius:6px; text-decoration:none;">📎 Télécharger ${escHtml(pj.filename)}</a></div>`;
                }
            } catch (e) {
                piecesHtml = '';
            }
        }
    }

    content.innerHTML = `
        <h3>${escHtml(f[FIELDS_MESSAGE.OBJET] || '')}</h3>
        <div style="color:#64748b; font-size:13px; margin-bottom:10px;">De : ${escHtml(f[FIELDS_MESSAGE.EXPEDITEUR] || '')} — ${escHtml(date)}</div>
        <div style="white-space:pre-wrap; color:#334155;">${escHtml(f[FIELDS_MESSAGE.CORPS] || '')}</div>
        ${piecesHtml}
    `;
    modal.style.display = 'flex';
    if (!f[FIELDS_MESSAGE.LU]) marquerLu(id);
}

async function marquerLu(id) {
    try {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_MESSAGERIE)}/${id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { [FIELDS_MESSAGE.LU]: true } })
        });
        const r = messagesCache.find(x => x.id === id);
        if (r) r.fields[FIELDS_MESSAGE.LU] = true;
        afficherMessages(messagesCache);
        if (typeof compterMessagesNonLus === 'function') await compterMessagesNonLus();
    } catch (err) {
        console.error('Erreur marquer lu:', err);
    }
}

async function compterMessagesNonLus() {
    const badge = document.getElementById('messagerie-badge');
    if (!badge) return;
    const destinataire = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
    if (!destinataire) { badge.style.display = 'none'; return; }
    const formula = `AND(OR(FIND('Tous', {Destinataire}), FIND('${destinataire.replace(/'/g, "\\'")}', {Destinataire})), {Lu}=FALSE())`;
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

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('view-messagerie')) { initMessagerie(); compterMessagesNonLus(); }
});
