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
    const input = document.getElementById('message-destinataires-input');
    const suggestions = document.getElementById('message-destinataires-suggestions');
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
    if (input) {
        input.addEventListener('input', () => filtrerDestinataires(input.value));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    }
    if (suggestions) {
        suggestions.addEventListener('click', (e) => {
            const el = e.target.closest('.destinataire-suggestion');
            if (el) ajouterDestinataire(el.dataset.nom);
        });
    }
    if (tousBtn) tousBtn.addEventListener('click', ajouterTousLesDestinataires);
    chargerDestinataires();
}

function renderDestinatairesChips() {
    const container = document.getElementById('message-destinataires-chips');
    if (!container) return;
    if (destinatairesSelectionnes.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8; font-size:13px;">Aucun destinataire sélectionné</span>';
        return;
    }
    container.innerHTML = destinatairesSelectionnes.map(nom => `
        <span style="display:inline-flex; align-items:center; gap:4px; background:#1e3d59; color:white; padding:4px 8px; border-radius:12px; font-size:13px;">
            ${escHtml(nom)}
            <button type="button" data-nom="${escHtml(nom)}" class="retirer-destinataire" style="background:none; border:none; color:white; cursor:pointer; font-weight:bold; line-height:1;">×</button>
        </span>
    `).join('');
    container.querySelectorAll('.retirer-destinataire').forEach(btn => {
        btn.addEventListener('click', () => retirerDestinataire(btn.dataset.nom));
    });
}

function filtrerDestinataires(value) {
    const suggestions = document.getElementById('message-destinataires-suggestions');
    if (!suggestions) return;
    const v = (value || '').trim().toLowerCase();
    if (!v) { suggestions.style.display = 'none'; return; }
    const current = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
    const matches = (utilisateursMessagerieCache || []).filter(r => {
        const f = r.fields || {};
        const nom = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
        if (!nom || nom === current || destinatairesSelectionnes.includes(nom)) return false;
        return nom.toLowerCase().includes(v);
    });
    if (matches.length === 0) { suggestions.style.display = 'none'; return; }
    suggestions.innerHTML = matches.map(r => {
        const f = r.fields || {};
        const nom = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
        return `<div class="destinataire-suggestion" data-nom="${escHtml(nom)}" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; color:#334155;">${escHtml(nom)}</div>`;
    }).join('');
    suggestions.style.display = 'block';
}

function ajouterDestinataire(nom) {
    if (!nom || destinatairesSelectionnes.includes(nom)) return;
    destinatairesSelectionnes = destinatairesSelectionnes.filter(n => n !== 'Tous');
    destinatairesSelectionnes.push(nom);
    const input = document.getElementById('message-destinataires-input');
    if (input) input.value = '';
    const suggestions = document.getElementById('message-destinataires-suggestions');
    if (suggestions) suggestions.style.display = 'none';
    renderDestinatairesChips();
}

function retirerDestinataire(nom) {
    destinatairesSelectionnes = destinatairesSelectionnes.filter(n => n !== nom);
    renderDestinatairesChips();
}

function ajouterTousLesDestinataires() {
    destinatairesSelectionnes = ['Tous'];
    const input = document.getElementById('message-destinataires-input');
    if (input) input.value = '';
    const suggestions = document.getElementById('message-destinataires-suggestions');
    if (suggestions) suggestions.style.display = 'none';
    renderDestinatairesChips();
}

async function chargerDestinataires() {
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS_MESSAGERIE)}?sort[0][field]=Nom&sort[0][direction]=asc`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        utilisateursMessagerieCache = data.records || [];
        renderDestinatairesChips();
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
        const piece = (f[FIELDS_MESSAGE.PIECE] || []).length > 0 ? '📎' : '';
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
    if (!objet || !corps) return;

    const objetVal = objet.value.trim();
    const corpsVal = corps.value.trim();
    if (destinatairesSelectionnes.length === 0) { alert('Veuillez choisir au moins un destinataire.'); return; }
    if (!objetVal || !corpsVal) { alert('Objet et corps sont requis.'); return; }

    const expediteur = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
    if (!expediteur) { alert('Vous devez être connecté.'); return; }

    const fields = {
        [FIELDS_MESSAGE.DATE]: new Date().toISOString().slice(0, 10),
        [FIELDS_MESSAGE.EXPEDITEUR]: expediteur,
        [FIELDS_MESSAGE.DESTINATAIRE]: destinatairesSelectionnes.join('; '),
        [FIELDS_MESSAGE.OBJET]: objetVal,
        [FIELDS_MESSAGE.CORPS]: corpsVal,
        [FIELDS_MESSAGE.LU]: false
    };

    try {
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_MESSAGERIE)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur envoi');
        const record = (data.records || [])[0];
        if (!record) throw new Error('Aucune réponse Airtable');

        const file = fileInput && fileInput.files[0];
        if (file) await uploadPieceJointe(record.id, file);

        alert('Message envoyé.');
        const messageForm = document.getElementById('message-form');
        if (messageForm) messageForm.reset();
        if (fileName) fileName.textContent = '';
        const messageFormSection = document.getElementById('message-form-section');
        if (messageFormSection) messageFormSection.style.display = 'none';
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'envoi : ' + (err.message || 'inconnue'));
    }
}

async function uploadPieceJointe(recordId, file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
            const dataUrl = reader.result;
            const comma = dataUrl.indexOf(',');
            if (comma === -1) { reject(new Error('Lecture fichier impossible')); return; }
            const base64 = dataUrl.slice(comma + 1);
            try {
                const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(recordId)}/${encodeURIComponent(FIELDS_MESSAGE.PIECE)}/uploadAttachment`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        file: base64,
                        filename: file.name,
                        contentType: file.type || 'application/octet-stream'
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error?.message || 'Échec upload pièce jointe');
                resolve(data);
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('Erreur lecture fichier'));
        reader.readAsDataURL(file);
    });
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
    const pieces = Array.isArray(f[FIELDS_MESSAGE.PIECE]) ? f[FIELDS_MESSAGE.PIECE] : [];
    const piecesHtml = pieces.length
        ? `<div style="margin-top:15px;"><strong>Pièce(s) jointe(s) :</strong><br>` +
          pieces.map(p => `<a href="${escHtml(p.url)}" target="_blank" style="display:inline-block; margin-top:4px;">${escHtml(p.filename || p.url)}</a>`).join('<br>') +
          `</div>`
        : '';

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
