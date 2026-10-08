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
    LU: 'Lu',
    FAVORIS: 'Favoris',
    ARCHIVES: 'Archivés'
};

const DUREE_ARCHIVES_JOURS = 30;

function nomsFavoris(val) {
    return (val || '').toString().split(';').map(s => s.trim()).filter(Boolean);
}

// Champ "Archivés" : liste "Nom|AAAA-MM-JJ; Nom|AAAA-MM-JJ" (archive par utilisateur)
function parseArchives(val) {
    return (val || '').toString().split(';').map(s => s.trim()).filter(Boolean).map(e => {
        const i = e.lastIndexOf('|');
        return i === -1 ? { nom: e, date: '' } : { nom: e.slice(0, i).trim(), date: e.slice(i + 1).trim() };
    }).filter(e => e.nom);
}

function serialiserArchives(entries) {
    return entries.map(e => `${e.nom}|${e.date}`).join('; ');
}

function entreeArchiveMoi(fields) {
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    return parseArchives(fields[FIELDS_MESSAGE.ARCHIVES]).find(e => e.nom === current) || null;
}

function archiveExpiree(entry) {
    if (!entry || !entry.date) return false;
    const d = new Date(entry.date + 'T00:00:00');
    if (isNaN(d)) return false;
    return (Date.now() - d.getTime()) > DUREE_ARCHIVES_JOURS * 86400000;
}

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
        if (pieceVal.startsWith('http') || pieceVal.startsWith('/')) return true;
        try {
            const pj = JSON.parse(pieceVal);
            if (pj && pj.url) return true;
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
        if (pieceVal.startsWith('http') || pieceVal.startsWith('/')) {
            const nom = pieceVal.split('/').pop();
            return `<div class="message-attachments"><a href="${escHtml(pieceVal)}" target="_blank">📎 ${escHtml(nom)}</a></div>`;
        } else {
            try {
                const pj = JSON.parse(pieceVal);
                if (pj && pj.url) {
                    return `<div class="message-attachments"><a href="${escHtml(pj.url)}" target="_blank">📎 ${escHtml(pj.filename || pj.url.split('/').pop())}</a></div>`;
                }
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
let threadsSelectionnes = new Set();
let ongletMessagerie = 'recus';
let filtreMessagerie = 'tous';
let dernierRenduSignature = '';

function nomCompletCourant() {
    if (typeof currentUser === 'undefined' || !currentUser) return '';
    return `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
}

function initMessagerie() {
    const form = document.getElementById('message-form');
    const fileInput = document.getElementById('message-piece');
    const nouveauBtn = document.getElementById('btn-nouveau-message');
    const list = document.getElementById('message-destinataires-list');
    const tousBtn = document.getElementById('message-destinataires-tous');

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const nom = fileInput.files[0]?.name || '';
            const rename = document.getElementById('message-piece-rename');
            if (rename) {
                rename.style.display = nom ? 'block' : 'none';
                rename.value = nom;
            }
        });
    }
    const closeForm = document.getElementById('btn-close-message-form');
    if (closeForm) {
        closeForm.addEventListener('click', () => {
            const formSection = document.getElementById('message-form-section');
            if (formSection) formSection.style.display = 'none';
        });
    }
    if (form) form.addEventListener('submit', envoyerMessage);
    if (nouveauBtn) {
        nouveauBtn.addEventListener('click', () => {
            const formSection = document.getElementById('message-form-section');
            if (formSection) formSection.style.display = formSection.style.display === 'none' ? 'block' : 'none';
        });
    }
    const detailBack = document.getElementById('message-detail-back');
    if (detailBack) detailBack.addEventListener('click', fermerDetailThread);
    const detailDelete = document.getElementById('message-detail-delete');
    if (detailDelete) detailDelete.addEventListener('click', actionSupprimerDetail);
    const detailUnread = document.getElementById('message-detail-unread');
    if (detailUnread) detailUnread.addEventListener('click', actionNonLuDetail);
    const replySend = document.getElementById('message-detail-reply-send');
    if (replySend) replySend.addEventListener('click', envoyerReponseDetail);
    const replyCancel = document.getElementById('message-detail-reply-cancel');
    if (replyCancel) replyCancel.addEventListener('click', () => {
        const zone = document.getElementById('message-detail-replyzone');
        if (zone) zone.style.display = 'none';
    });
    const replyFile = document.getElementById('message-detail-reply-file');
    if (replyFile) {
        replyFile.addEventListener('change', () => {
            const nom = replyFile.files[0]?.name || '';
            const rename = document.getElementById('message-detail-reply-file-rename');
            if (rename) {
                rename.style.display = nom ? 'block' : 'none';
                rename.value = nom;
            }
        });
    }
    const messagesList = document.getElementById('messages-list');
    if (messagesList) {
        messagesList.addEventListener('click', (e) => {
            if (e.target.classList.contains('message-check')) {
                const key = e.target.dataset.key;
                if (e.target.checked) threadsSelectionnes.add(key);
                else threadsSelectionnes.delete(key);
                mettreAJourSelectAll();
                const item = e.target.closest('.message-item');
                if (item) item.classList.toggle('message-thread-selected', e.target.checked);
                return;
            }
            const star = e.target.closest('.message-star');
            if (star) {
                const thread = grouperParThread(messagesCache).find(t => t.key === star.dataset.key);
                if (thread) basculerFavoriThread(thread);
                return;
            }
            const restore = e.target.closest('.message-restore');
            if (restore) {
                const thread = grouperParThread(messagesCache).find(t => t.key === restore.dataset.key);
                if (thread) restaurerThread(thread);
                return;
            }
            const item = e.target.closest('.message-item');
            if (item) voirMessage(item.dataset.id);
        });
    }
    const tabRecus = document.getElementById('tab-messagerie-recus');
    const tabArchives = document.getElementById('tab-messagerie-archives');
    if (tabRecus) tabRecus.addEventListener('click', () => changerOngletMessagerie('recus'));
    if (tabArchives) tabArchives.addEventListener('click', () => changerOngletMessagerie('archives'));
    const deleteBtn = document.getElementById('btn-delete-messages');
    if (deleteBtn) deleteBtn.addEventListener('click', archiverThreadsSelectionnes);
    const filterSel = document.getElementById('messages-filter');
    if (filterSel) {
        filterSel.addEventListener('change', () => {
            filtreMessagerie = filterSel.value || 'tous';
            threadsSelectionnes.clear();
            dernierRenduSignature = '';
            afficherMessages(messagesCache);
        });
    }
    const selectAll = document.getElementById('messages-select-all');
    if (selectAll) {
        selectAll.addEventListener('change', () => {
            const threads = grouperParThread(messagesCache);
            if (selectAll.checked) threads.forEach(t => threadsSelectionnes.add(t.key));
            else threadsSelectionnes.clear();
            afficherMessages(messagesCache);
        });
    }
    const refreshBtn = document.getElementById('btn-refresh-messages');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            try {
                if (typeof viderApiCache === 'function') viderApiCache();
                await chargerMessagerie();
                if (typeof compterMessagesNonLus === 'function') await compterMessagesNonLus();
            } finally {
                refreshBtn.disabled = false;
            }
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

    // Auto-rafraîchissement (uniquement quand l'onglet est visible)
    setInterval(() => {
        if (document.hidden) return;
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
    container.innerHTML = utilisateurs.map(nom => `
        <label class="message-reply-dest">
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
        utilisateursMessagerieCache = await fetchTousRecordsCache(
            `${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS_MESSAGERIE)}?sort[0][field]=Nom&sort[0][direction]=asc`,
            { headers });
        renderDestinatairesListe();
    } catch (err) {
        console.error('Erreur chargement destinataires:', err);
    }
}

async function chargerMessagesAvecOffset(formula) {
    const all = [];
    let offset = '';
    do {
        const url = `${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100${offset ? '&offset=' + encodeURIComponent(offset) : ''}`;
        const res = await apiFetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        all.push(...(data.records || []));
        offset = data.offset || '';
    } while (offset);
    return all;
}

async function purgerArchivesExpires(records) {
    const gardes = [];
    for (const r of records) {
        const f = r.fields || {};
        const entries = parseArchives(f[FIELDS_MESSAGE.ARCHIVES]);
        if (!entries.length) { gardes.push(r); continue; }
        const dest = (f[FIELDS_MESSAGE.DESTINATAIRE] || '').toString().trim().toLowerCase();
        const estTous = dest === 'tous' || dest.startsWith('tous;') || dest.includes('; tous');
        if (estTous) { gardes.push(r); continue; }
        const frais = entries.filter(e => !archiveExpiree(e));
        if (frais.length === entries.length) { gardes.push(r); continue; }
        try {
            if (frais.length === 0) {
                const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}/${r.id}`, { method: 'DELETE', headers });
                if (res.ok) continue;
            } else {
                const val = serialiserArchives(frais);
                const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}/${r.id}`, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({ fields: { [FIELDS_MESSAGE.ARCHIVES]: val } })
                });
                if (res.ok) f[FIELDS_MESSAGE.ARCHIVES] = val;
            }
        } catch (err) {
            console.error('Erreur purge archives:', err);
        }
        gardes.push(r);
    }
    return gardes;
}

async function chargerMessagerie() {
    const container = document.getElementById('messages-list');
    if (!container) return;
    if (!container.querySelector('.message-item') && !container.querySelector('.carnet-empty')) {
        container.innerHTML = '<div class="loading">Chargement...</div>';
    }
    const nom = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    if (!nom) {
        container.innerHTML = '<p class="carnet-empty">Connectez-vous pour voir vos messages.</p>';
        return;
    }
    const escaped = nom.replace(/'/g, "\\'");
    const formula = `OR(FIND('Tous', {Destinataire}) > 0, FIND('${escaped}', {Destinataire}) > 0, {Expéditeur}='${escaped}')`;
    try {
        messagesCache = await purgerArchivesExpires(await chargerMessagesAvecOffset(formula));
        afficherMessages(messagesCache);
    } catch (err) {
        console.error(err);
        if (!container.querySelector('.message-item')) {
            container.innerHTML = `<p class="carnet-empty">Erreur de chargement : ${escHtml(err.message)}</p>`;
        }
    }
}

function grouperParThread(records) {
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    const groups = {};
    records.forEach(r => {
        const f = r.fields || {};
        const key = threadKey(f[FIELDS_MESSAGE.OBJET]);
        if (!groups[key]) {
            groups[key] = { key, messages: [], participants: new Set(), hasPiece: false, unread: false, favori: false };
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
        if (nomsFavoris(f[FIELDS_MESSAGE.FAVORIS]).includes(current)) g.favori = true;
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

function threadArchive(thread) {
    return thread.messages.some(r => entreeArchiveMoi(r.fields || {}));
}

function threadsBoite(records) {
    const threads = grouperParThread(records);
    let visibles;
    if (ongletMessagerie === 'archives') {
        visibles = threads.filter(t => {
            const e = entreeArchiveMoi(t.lastMessage.fields || {}) || t.messages.map(r => entreeArchiveMoi(r.fields || {})).find(Boolean);
            return e && !archiveExpiree(e);
        });
    } else {
        visibles = threads.filter(t => !threadArchive(t));
    }
    if (filtreMessagerie === 'nonlus') visibles = visibles.filter(t => t.unread);
    else if (filtreMessagerie === 'lus') visibles = visibles.filter(t => !t.unread);
    else if (filtreMessagerie === 'favoris') visibles = visibles.filter(t => t.favori);
    return visibles;
}

function afficherMessages(records) {
    const container = document.getElementById('messages-list');
    if (!container) return;
    const threads = threadsBoite(records);
    const signature = ongletMessagerie + '|' + filtreMessagerie + '|' + threads.map(t =>
        `${t.key}:${t.lastMessage.id}:${t.unread ? 1 : 0}:${t.favori ? 1 : 0}:${t.hasPiece ? 1 : 0}:${t.messages.length}:${threadsSelectionnes.has(t.key) ? 1 : 0}`
    ).join(',');
    if (signature === dernierRenduSignature) { mettreAJourSelectAll(threads); return; }
    dernierRenduSignature = signature;
    if (!threads.length) {
        container.innerHTML = `<p class="carnet-empty">${ongletMessagerie === 'archives' ? 'Aucun message archivé.' : 'Aucun message.'}</p>`;
        mettreAJourSelectAll(threads);
        return;
    }
    const keysVisibles = new Set(threads.map(t => t.key));
    threadsSelectionnes = new Set([...threadsSelectionnes].filter(k => keysVisibles.has(k)));
    container.innerHTML = threads.map(t => {
        const preview = (t.lastMessage.fields[FIELDS_MESSAGE.CORPS] || '').replace(/\s+/g, ' ').trim().substring(0, 120);
        const date = formaterDateMessage(t.lastMessage.fields[FIELDS_MESSAGE.DATE]);
        const piece = t.hasPiece ? '<span class="message-thread-piece" title="Pièce jointe">📎</span>' : '';
        const coche = threadsSelectionnes.has(t.key) ? 'checked' : '';
        if (ongletMessagerie === 'archives') {
            const entree = entreeArchiveMoi(t.lastMessage.fields || {}) || t.messages.map(r => entreeArchiveMoi(r.fields || {})).find(Boolean);
            const dateArch = entree && entree.date ? formaterDateMessage(entree.date) : '';
            return `<div class="message-item message-thread-item" data-id="${escHtml(t.lastMessage.id)}" title="Archivé le ${escHtml(dateArch)}">
                <button type="button" class="message-restore" data-key="${escHtml(t.key)}" title="Ramener dans la boîte de réception">↩</button>
                <span class="message-thread-sender">${escHtml(formatParticipants(t.participants))}</span>
                <span class="message-thread-text">
                    <span class="message-thread-subject">${escHtml(t.subject)}</span>
                    ${preview ? `<span class="message-thread-preview">— ${escHtml(preview)}</span>` : ''}
                </span>
                <span class="message-thread-right">
                    ${piece}
                    <span class="message-thread-date">${escHtml(date)}</span>
                </span>
            </div>`;
        }
        return `<div class="message-item message-thread-item ${t.unread ? 'message-thread-unread' : ''} ${coche ? 'message-thread-selected' : ''}" data-id="${escHtml(t.lastMessage.id)}" title="${escHtml(t.subject)}">
            <input type="checkbox" class="message-check" data-key="${escHtml(t.key)}" ${coche}>
            <button type="button" class="message-star ${t.favori ? 'message-star-on' : ''}" data-key="${escHtml(t.key)}" title="${t.favori ? 'Retirer des favoris' : 'Marquer comme favori'}">${t.favori ? '★' : '☆'}</button>
            <span class="message-thread-sender">${escHtml(formatParticipants(t.participants))}</span>
            <span class="message-thread-text">
                <span class="message-thread-subject">${escHtml(t.subject)}</span>
                ${preview ? `<span class="message-thread-preview">— ${escHtml(preview)}</span>` : ''}
            </span>
            <span class="message-thread-right">
                ${piece}
                ${t.unread ? '<span class="message-thread-dot"></span>' : ''}
                <span class="message-thread-date">${escHtml(date)}</span>
            </span>
        </div>`;
    }).join('');
    mettreAJourSelectAll(threads);
}

function mettreAJourSelectAll(threads) {
    const selectAll = document.getElementById('messages-select-all');
    const info = document.getElementById('messages-selection-info');
    const deleteBtn = document.getElementById('btn-delete-messages');
    const total = (threads || threadsBoite(messagesCache)).length;
    const nb = threadsSelectionnes.size;
    if (selectAll) {
        selectAll.checked = total > 0 && nb === total;
        selectAll.indeterminate = nb > 0 && nb < total;
    }
    if (deleteBtn) deleteBtn.style.display = (ongletMessagerie === 'recus' && nb > 0) ? 'inline-block' : 'none';
    if (info) info.textContent = nb > 0 ? `${nb} sélectionné${nb > 1 ? 's' : ''}` : '';
}

function changerOngletMessagerie(onglet) {
    if (ongletMessagerie === onglet) return;
    ongletMessagerie = onglet;
    threadsSelectionnes.clear();
    dernierRenduSignature = '';
    const tabRecus = document.getElementById('tab-messagerie-recus');
    const tabArchives = document.getElementById('tab-messagerie-archives');
    if (tabRecus) tabRecus.classList.toggle('messages-tab-active', onglet === 'recus');
    if (tabArchives) tabArchives.classList.toggle('messages-tab-active', onglet === 'archives');
    const notice = document.getElementById('messages-archive-notice');
    if (notice) notice.style.display = onglet === 'archives' ? 'block' : 'none';
    const wrapSelectAll = document.getElementById('messages-selectall-wrap');
    if (wrapSelectAll) wrapSelectAll.style.display = onglet === 'archives' ? 'none' : 'flex';
    afficherMessages(messagesCache);
}

async function archiverThreadsSelectionnes() {
    const threads = grouperParThread(messagesCache).filter(t => threadsSelectionnes.has(t.key));
    if (!threads.length) return;
    const nbMsg = threads.reduce((n, t) => n + t.messages.length, 0);
    if (!(await confirmerAction(`Archiver ${threads.length} conversation(s) (${nbMsg} message(s)) ? Elles seront conservées 30 jours dans « Messages archivés ».`, { okLabel: 'Archiver', icone: '📦' }))) return;
    await archiverThreads(threads);
    threadsSelectionnes.clear();
    afficherMessages(messagesCache);
    if (typeof compterMessagesNonLus === 'function') compterMessagesNonLus();
}

async function archiverThreads(threads) {
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    if (!current || !threads.length) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
        await Promise.all(threads.flatMap(t => t.messages.map(async r => {
            const f = r.fields || {};
            const entries = parseArchives(f[FIELDS_MESSAGE.ARCHIVES]);
            if (entries.some(e => e.nom === current)) return;
            entries.push({ nom: current, date: today });
            const val = serialiserArchives(entries);
            const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}/${r.id}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ fields: { [FIELDS_MESSAGE.ARCHIVES]: val } })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error?.message || 'Erreur archivage');
            }
            f[FIELDS_MESSAGE.ARCHIVES] = val;
        })));
    } catch (err) {
        console.error('Erreur archivage:', err);
        alert('Erreur lors de l\'archivage : ' + (err.message || 'inconnue'));
    }
}

async function restaurerThread(thread) {
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    if (!current || !thread) return;
    try {
        await Promise.all(thread.messages.map(async r => {
            const f = r.fields || {};
            const entries = parseArchives(f[FIELDS_MESSAGE.ARCHIVES]);
            const nv = entries.filter(e => e.nom !== current);
            if (nv.length === entries.length) return;
            const val = serialiserArchives(nv);
            const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}/${r.id}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ fields: { [FIELDS_MESSAGE.ARCHIVES]: val } })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error?.message || 'Erreur restauration');
            }
            f[FIELDS_MESSAGE.ARCHIVES] = val;
        }));
        afficherMessages(messagesCache);
        if (typeof compterMessagesNonLus === 'function') compterMessagesNonLus();
    } catch (err) {
        console.error('Erreur restauration:', err);
        alert('Erreur lors de la restauration : ' + (err.message || 'inconnue'));
    }
}

async function basculerFavoriThread(thread) {
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    if (!current || !thread) return;
    const want = !thread.favori;
    try {
        await Promise.all(thread.messages.map(async r => {
            const favs = nomsFavoris(r.fields[FIELDS_MESSAGE.FAVORIS]);
            if (favs.includes(current) === want) return;
            const nv = want ? [...favs, current] : favs.filter(n => n !== current);
            const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}/${r.id}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ fields: { [FIELDS_MESSAGE.FAVORIS]: nv.join('; ') } })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error?.message || 'Erreur favori');
            }
            r.fields[FIELDS_MESSAGE.FAVORIS] = nv.join('; ');
        }));
        thread.favori = want;
        afficherMessages(messagesCache);
    } catch (err) {
        console.error('Erreur favori:', err);
        alert('Erreur lors de la mise à jour du favori : ' + (err.message || 'inconnue'));
    }
}

async function envoyerMessage(e) {
    e.preventDefault();
    const objet = document.getElementById('message-objet');
    const corps = document.getElementById('message-corps');
    const fileInput = document.getElementById('message-piece');
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
            const url = await uploader(file);
            const rename = document.getElementById('message-piece-rename');
            const nomFichier = (rename && rename.value.trim()) || file.name;
            pieceJointe = JSON.stringify({ url, filename: nomFichier });
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

        const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}`, {
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
        const rename = document.getElementById('message-piece-rename');
        if (rename) { rename.value = ''; rename.style.display = 'none'; }
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

let threadCourant = null;

function voirMessage(id) {
    const thread = trouverThreadParMessageId(id);
    if (!thread) return;
    ouvrirDetailThread(thread);
}

const ZONES_LISTE_MESSAGERIE = ['.messages-tabs', '#messages-archive-notice', '#messages-toolbar', '#messages-list', '#message-form-section'];

function afficherZoneListe(visible) {
    ZONES_LISTE_MESSAGERIE.forEach(sel => {
        const el = document.querySelector(sel);
        if (!el) return;
        if (sel === '#messages-archive-notice') {
            el.style.display = (visible && ongletMessagerie === 'archives') ? 'block' : 'none';
        } else if (sel === '.messages-tabs' || sel === '#messages-toolbar') {
            el.style.display = visible ? 'flex' : 'none';
        } else if (sel === '#message-form-section') {
            el.style.display = 'none';
        } else {
            el.style.display = visible ? 'block' : 'none';
        }
    });
}

function ouvrirDetailThread(thread) {
    const detail = document.getElementById('message-detail');
    if (!detail) return;
    threadCourant = thread;
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    const premier = thread.messages[0];
    const fp = premier.fields || {};

    const subject = document.getElementById('message-detail-subject');
    const sender = document.getElementById('message-detail-sender');
    const dest = document.getElementById('message-detail-dest');
    const messages = document.getElementById('message-detail-messages');
    const deleteBtn = document.getElementById('message-detail-delete');
    const replyBtn = document.getElementById('message-detail-reply');
    const replyZone = document.getElementById('message-detail-replyzone');
    const replyText = document.getElementById('message-detail-reply-text');
    const replyFile = document.getElementById('message-detail-reply-file');
    const replyRename = document.getElementById('message-detail-reply-file-rename');
    if (replyZone) replyZone.style.display = 'none';
    if (replyText) replyText.value = '';
    if (replyFile) replyFile.value = '';
    if (replyRename) { replyRename.value = ''; replyRename.style.display = 'none'; }

    if (subject) subject.textContent = thread.subject;
    if (sender) sender.innerHTML = `<strong>De :</strong> ${escHtml(fp[FIELDS_MESSAGE.EXPEDITEUR] || 'Inconnu')}`;
    if (dest) dest.innerHTML = `<strong>À :</strong> ${escHtml(fp[FIELDS_MESSAGE.DESTINATAIRE] || '')}`;
    if (deleteBtn) {
        const archive = threadArchive(thread);
        deleteBtn.innerHTML = archive ? '↩ Restaurer' : '🗑 Supprimer';
        deleteBtn.title = archive ? 'Ramener dans la boîte de réception' : 'Archiver le message';
    }
    if (messages) {
        messages.innerHTML = thread.messages.map(r => {
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
    }

    if (replyBtn) replyBtn.onclick = () => ouvrirReponseZone(thread);

    afficherZoneListe(false);
    detail.style.display = 'block';
    detail.scrollIntoView({ block: 'start' });

    const ids = thread.messages.filter(r => !r.fields[FIELDS_MESSAGE.LU] && r.fields[FIELDS_MESSAGE.EXPEDITEUR] !== current).map(r => r.id);
    if (ids.length) marquerMessagesLus(ids);
}

function fermerDetailThread() {
    const detail = document.getElementById('message-detail');
    if (detail) detail.style.display = 'none';
    threadCourant = null;
    afficherZoneListe(true);
    afficherMessages(messagesCache);
}

async function actionSupprimerDetail() {
    if (!threadCourant) return;
    const thread = threadCourant;
    if (threadArchive(thread)) {
        await restaurerThread(thread);
    } else {
        await archiverThreads([thread]);
        if (typeof compterMessagesNonLus === 'function') compterMessagesNonLus();
    }
    fermerDetailThread();
}

async function actionNonLuDetail() {
    if (!threadCourant) return;
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    let cibles = threadCourant.messages.filter(r => (r.fields || {})[FIELDS_MESSAGE.EXPEDITEUR] !== current);
    if (!cibles.length) cibles = [threadCourant.lastMessage];
    try {
        await Promise.all(cibles.map(r => apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}/${r.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { [FIELDS_MESSAGE.LU]: false } })
        })));
        cibles.forEach(r => { r.fields[FIELDS_MESSAGE.LU] = false; });
        if (typeof compterMessagesNonLus === 'function') await compterMessagesNonLus();
        fermerDetailThread();
    } catch (err) {
        console.error('Erreur marquer non lu:', err);
        alert('Erreur : ' + (err.message || 'inconnue'));
    }
}

function ouvrirReponseZone(thread) {
    const zone = document.getElementById('message-detail-replyzone');
    const dests = document.getElementById('message-detail-reply-dests');
    const text = document.getElementById('message-detail-reply-text');
    if (!zone || !dests) return;
    const current = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    const tous = (utilisateursMessagerieCache || []).map(r => {
        const f = r.fields || {};
        return `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
    }).filter(n => n && n !== current).sort();
    const participants = thread.participants.filter(n => n && n !== current);
    const tousConvo = participants.some(n => n.toLowerCase() === 'tous');
    dests.innerHTML = tous.length ? tous.map((nom, i) => {
        const coche = tousConvo || participants.includes(nom);
        return `<label class="message-reply-dest ${i % 2 === 1 ? 'message-reply-dest-alt' : ''}">
            <input type="checkbox" class="reply-dest-check" value="${escHtml(nom)}" ${coche ? 'checked' : ''}>
            <span>${escHtml(nom)}</span>
        </label>`;
    }).join('') : '<span style="color:#94a3b8; font-size:13px;">Aucun destinataire disponible</span>';
    zone.style.display = 'block';
    if (text) text.focus();
    zone.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function envoyerReponseDetail() {
    if (!threadCourant) return;
    const thread = threadCourant;
    const text = document.getElementById('message-detail-reply-text');
    const corps = (text && text.value || '').trim();
    const dests = [...document.querySelectorAll('#message-detail-reply-dests .reply-dest-check:checked')].map(c => c.value);
    if (!dests.length) { alert('Veuillez choisir au moins un destinataire.'); return; }
    if (!corps) { alert('Le message est vide.'); return; }
    const expediteur = typeof nomCompletCourant === 'function' ? nomCompletCourant() : '';
    if (!expediteur) { alert('Vous devez être connecté.'); return; }
    const objet = thread.subject.toLowerCase().startsWith('re:') ? thread.subject : 'Re: ' + thread.subject;
    const sendBtn = document.getElementById('message-detail-reply-send');
    if (sendBtn) sendBtn.disabled = true;
    try {
        let pieceJointe = null;
        const fileInput = document.getElementById('message-detail-reply-file');
        const file = fileInput && fileInput.files[0];
        if (file) {
            const uploader = typeof uploaderFichierDocument === 'function' ? uploaderFichierDocument : null;
            if (!uploader) throw new Error('Uploader non disponible');
            const url = await uploader(file);
            const rename = document.getElementById('message-detail-reply-file-rename');
            const nomFichier = (rename && rename.value.trim()) || file.name;
            pieceJointe = JSON.stringify({ url, filename: nomFichier });
        }
        const fields = {
            [FIELDS_MESSAGE.DATE]: new Date().toISOString().slice(0, 10),
            [FIELDS_MESSAGE.EXPEDITEUR]: expediteur,
            [FIELDS_MESSAGE.DESTINATAIRE]: dests.join('; '),
            [FIELDS_MESSAGE.OBJET]: objet,
            [FIELDS_MESSAGE.CORPS]: corps,
            [FIELDS_MESSAGE.LU]: false
        };
        if (pieceJointe !== null) fields[FIELDS_MESSAGE.PIECE] = pieceJointe;
        const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur envoi');
        const record = (data.records || [])[0];
        if (record) messagesCache.push(record);
        if (typeof viderApiCache === 'function') viderApiCache();
        if (text) text.value = '';
        if (fileInput) fileInput.value = '';
        const renameInput = document.getElementById('message-detail-reply-file-rename');
        if (renameInput) { renameInput.value = ''; renameInput.style.display = 'none'; }
        const zone = document.getElementById('message-detail-replyzone');
        if (zone) zone.style.display = 'none';
        const nvThread = trouverThreadParMessageId(record ? record.id : thread.lastMessage.id) || thread;
        ouvrirDetailThread(nvThread);
        const detail = document.getElementById('message-detail-messages');
        if (detail) detail.lastElementChild && detail.lastElementChild.scrollIntoView({ block: 'nearest' });
        if (typeof compterMessagesNonLus === 'function') compterMessagesNonLus();
    } catch (err) {
        console.error('Erreur envoi réponse:', err);
        alert('Erreur lors de l\'envoi : ' + (err.message || 'inconnue'));
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
}

async function marquerMessagesLus(ids) {
    if (!ids || !ids.length) return;
    try {
        await Promise.all(ids.map(id => apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}/${id}`, {
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
    const escaped = destinataire.replace(/'/g, "\\'");
    const formula = `AND(OR(FIND('Tous', {Destinataire}) > 0, FIND('${escaped}', {Destinataire}) > 0), {Lu}=FALSE(), {Expéditeur}!='${escaped}', NOT(FIND('${escaped}', {Archivés}) > 0))`;
    try {
        const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_MESSAGERIE)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=1`, { headers });
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
    const formSection = document.getElementById('message-form-section');
    const objet = document.getElementById('message-objet');
    const corps = document.getElementById('message-corps');
    fermerDetailThread();
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
