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

function initMessagerie() {
    const form = document.getElementById('message-form');
    const fileInput = document.getElementById('message-piece');
    const fileName = document.getElementById('message-piece-name');
    const nouveauBtn = document.getElementById('btn-nouveau-message');
    const close = document.getElementById('message-read-close');

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
    document.getElementById('messages-list')?.addEventListener('click', (e) => {
        const item = e.target.closest('.message-item');
        if (item) voirMessage(item.dataset.id);
    });
    const select = document.getElementById('message-destinataire');
    if (select) chargerDestinataires(select);
}

async function chargerDestinataires(select) {
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS_MESSAGERIE)}?sort[0][field]=Nom&sort[0][direction]=asc`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const records = data.records || [];
        utilisateursMessagerieCache = records;
        const current = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
        select.innerHTML = '<option value="">Choisir un destinataire</option>';
        records.forEach(r => {
            const f = r.fields || {};
            const nom = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
            if (!nom || nom === current) return;
            const opt = document.createElement('option');
            opt.value = nom;
            opt.textContent = nom;
            select.appendChild(opt);
        });
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
    const formula = `{Destinataire}='${destinataire.replace(/'/g, "\\'")}'`;
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
        const d = f[FIELDS_MESSAGE.DATE] ? new Date(f[FIELDS_MESSAGE.DATE]) : null;
        const date = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
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
    const select = document.getElementById('message-destinataire');
    const objet = document.getElementById('message-objet');
    const corps = document.getElementById('message-corps');
    const fileInput = document.getElementById('message-piece');
    const fileName = document.getElementById('message-piece-name');
    if (!select || !objet || !corps) return;

    const destinataire = select.value;
    const objetVal = objet.value.trim();
    const corpsVal = corps.value.trim();
    if (!destinataire || !objetVal || !corpsVal) { alert('Destinataire, objet et corps sont requis.'); return; }

    const expediteur = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
    if (!expediteur) { alert('Vous devez être connecté.'); return; }

    const fields = {
        [FIELDS_MESSAGE.DATE]: new Date().toISOString(),
        [FIELDS_MESSAGE.EXPEDITEUR]: expediteur,
        [FIELDS_MESSAGE.DESTINATAIRE]: destinataire,
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
        document.getElementById('message-form')?.reset();
        if (fileName) fileName.textContent = '';
        document.getElementById('message-form-section')?.style.display = 'none';
        if (typeof chargerMessagerie === 'function' && select.value === expediteur) chargerMessagerie();
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

    const d = f[FIELDS_MESSAGE.DATE] ? new Date(f[FIELDS_MESSAGE.DATE]) : null;
    const date = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
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
    } catch (err) {
        console.error('Erreur marquer lu:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('view-messagerie')) initMessagerie();
});
