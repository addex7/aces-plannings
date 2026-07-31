/* ==========================================================================
   ÉVÉNEMENTS CLUB - CRÉATION, INSCRIPTION ET AFFICHAGE
   ========================================================================== */

const TABLE_EVENEMENTS = 'Événements';

const FIELDS = {
    TITRE: 'Titre',
    DESCRIPTION: 'Description',
    DATE_DEBUT: 'Date début',
    HEURE_DEBUT: 'Heure début',
    DATE_FIN: 'Date de fin',
    HEURE_FIN: 'Heure fin',
    INSCRITS: 'Inscrits',
    AJOUTE_PAR: 'Ajouté par'
};

function parseInscrits(text) {
    if (!text) return [];
    return text.split('\n').map(line => {
        const parts = line.split('|');
        const nom = parts[0].trim();
        const commentaire = parts.slice(1).join('|').trim();
        return { nom, commentaire };
    }).filter(i => i.nom);
}

function formatInscrits(list) {
    return list.map(i => `${i.nom}|${i.commentaire || ''}`).join('\n');
}

function initEvenements() {
    const btn = document.getElementById('btn-creer-evenement');
    const overlay = document.getElementById('modale-evenement');
    const form = document.getElementById('form-evenement');
    const btnClose = document.getElementById('btn-close-evenement');

    if (btn) btn.addEventListener('click', ouvrirModaleEvenement);
    if (btnClose) btnClose.addEventListener('click', fermerModaleEvenement);
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) fermerModaleEvenement(); });
    if (form) form.addEventListener('submit', enregistrerEvenement);

    chargerProchainsEvenements();
    chargerEvenementsJour();
}

function ouvrirModaleEvenement() {
    const overlay = document.getElementById('modale-evenement');
    if (!overlay) return;
    const d = dateAffichee || new Date();
    const iso = d.toISOString().split('T')[0];
    document.getElementById('ev-titre').value = '';
    document.getElementById('ev-description').value = '';
    document.getElementById('ev-date-debut').value = iso;
    document.getElementById('ev-heure-debut').value = '09:00';
    document.getElementById('ev-date-fin').value = iso;
    document.getElementById('ev-heure-fin').value = '11:00';
    overlay.style.display = 'flex';
}

function fermerModaleEvenement() {
    const overlay = document.getElementById('modale-evenement');
    if (overlay) overlay.style.display = 'none';
}

async function enregistrerEvenement(e) {
    e.preventDefault();
    const nom = nomPiloteCourant();
    if (!nom) { alert('Connecte-toi pour créer un événement.'); return; }

    const titre = document.getElementById('ev-titre').value.trim();
    const description = document.getElementById('ev-description').value.trim();
    const dateDebut = document.getElementById('ev-date-debut').value;
    const heureDebut = document.getElementById('ev-heure-debut').value;
    const dateFin = document.getElementById('ev-date-fin').value;
    const heureFin = document.getElementById('ev-heure-fin').value;

    if (!titre || !dateDebut || !dateFin || !heureDebut || !heureFin) {
        alert('Veuillez remplir tous les champs obligatoires.');
        return;
    }

    const payload = {
        records: [{
            fields: {
                [FIELDS.TITRE]: titre,
                [FIELDS.DESCRIPTION]: description,
                [FIELDS.DATE_DEBUT]: dateDebut,
                [FIELDS.HEURE_DEBUT]: heureDebut,
                [FIELDS.DATE_FIN]: dateFin,
                [FIELDS.HEURE_FIN]: heureFin,
                [FIELDS.INSCRITS]: nom + '|',
                [FIELDS.AJOUTE_PAR]: nom
            }
        }]
    };

    try {
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_EVENEMENTS)}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            console.error(data);
            alert(`Erreur lors de la création : ${data.error ? data.error.message : 'Erreur inconnue'}`);
            return;
        }
        fermerModaleEvenement();
        chargerProchainsEvenements();
        chargerEvenementsJour();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la création de l\'événement.');
    }
}

function estDansIntervalle(date, debut, fin) {
    const d = new Date(date + 'T00:00:00');
    const db = new Date(debut + 'T00:00:00');
    const df = new Date(fin + 'T00:00:00');
    return d >= db && d <= df;
}

async function chargerEvenementsJour() {
    const container = document.getElementById('evenements-jour');
    if (!container) return;
    const section = container.closest('.evenements-section');
    const row = container.closest('.club-evenements-row');
    const dateIso = dateAffichee.toISOString().split('T')[0];
    container.innerHTML = '<div class="loading">Chargement des événements...</div>';

    try {
        const formula = encodeURIComponent(`NOT(IS_BEFORE({${FIELDS.DATE_FIN}}, DATETIME_PARSE('${dateIso}', 'YYYY-MM-DD')))`);
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_EVENEMENTS)}?filterByFormula=${formula}&sort[0][field]=${encodeURIComponent(FIELDS.DATE_DEBUT)}&sort[0][direction]=asc&pageSize=100`;
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur Airtable');

        const evenements = (data.records || []).filter(r => estDansIntervalle(dateIso, r.fields[FIELDS.DATE_DEBUT], r.fields[FIELDS.DATE_FIN]));
        if (!evenements.length) {
            container.innerHTML = '';
            if (section) section.style.display = 'none';
            if (row) row.style.gridTemplateColumns = '1fr';
            return;
        }

        if (section) section.style.display = '';
        if (row) row.style.gridTemplateColumns = '1fr 1fr';
        container.innerHTML = evenements.map(r => renderEvenement(r)).join('');
    } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="evenement-empty">Impossible de charger les événements.</div>';
    }
}

function renderEvenement(record) {
    const f = record.fields || {};
    const titre = escapeHtml(f[FIELDS.TITRE] || 'Événement');
    const description = escapeHtml(f[FIELDS.DESCRIPTION] || '');
    const debut = formatDateEvenement(f[FIELDS.DATE_DEBUT]);
    const fin = formatDateEvenement(f[FIELDS.DATE_FIN]);
    const hDebut = escapeHtml(f[FIELDS.HEURE_DEBUT] || '');
    const hFin = escapeHtml(f[FIELDS.HEURE_FIN] || '');
    const inscrits = parseInscrits(f[FIELDS.INSCRITS] || '');
    const dateTexte = debut === fin ? debut : `${debut} › ${fin}`;
    const horaireTexte = `${hDebut} - ${hFin}`;
    const createur = f[FIELDS.AJOUTE_PAR] || '';
    const nomConnecte = nomPiloteCourant() || '';
    const estInscrit = inscrits.some(i => i.nom === nomConnecte);

    const listeInscrits = inscrits.map(i => {
        const nom = escapeHtml(i.nom);
        const commentaire = escapeHtml(i.commentaire || '');
        const removable = i.nom === nomConnecte || createur === nomConnecte || (currentUser && currentUser.roles && currentUser.roles.includes('Super admin'));
        const btnSup = removable ? `<button class="btn-remove-inscrit" onclick="desinscrireEvenement('${record.id}', '${nom.replace(/'/g, "\\'")}')" title="Supprimer">×</button>` : '';
        const btnComment = `<button class="btn-comment" onclick="modifierCommentaireEvenement('${record.id}', '${nom.replace(/'/g, "\\'")}', '${commentaire.replace(/'/g, "\\'")}')" title="Ajouter/Modifier un commentaire">💬</button>`;
        const commentText = i.commentaire ? `<span class="comment-text" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${commentaire}</span>` : '';
        return `<div class="inscrit-ligne" style="display:flex; align-items:center; gap:8px; flex:1; min-width:0; overflow:hidden;">
            <span style="white-space:nowrap;">- ${nom}</span>
            ${btnComment}
            ${commentText}
            ${btnSup}
        </div>`;
    }).join('');

    const btnInscription = estInscrit
        ? `<button class="btn-inscription" disabled style="opacity:0.6;">Déjà inscrit</button>`
        : `<button class="btn-inscription" onclick="sinscrireEvenement('${record.id}')">M'inscrire</button>`;
    const peutSupprimer = createur === nomConnecte || (currentUser && currentUser.roles && currentUser.roles.includes('Super admin'));
    const btnSupprimer = peutSupprimer ? `<button class="btn-delete" onclick="supprimerEvenement('${record.id}')">Supprimer l'évènement</button>` : '';

    return `
        <div class="evenement-card" data-record-id="${record.id}">
            <div class="evenement-header">
                <div class="evenement-titre">${titre}</div>
                <div class="evenement-sous-titre">${dateTexte} • ${horaireTexte}</div>
                ${description ? `<div class="evenement-description">${description}</div>` : ''}
            </div>
            <div class="evenement-inscrits">
                ${listeInscrits || '<div class="evenement-empty">Aucun inscrit pour le moment.</div>'}
            </div>
            <div class="evenement-actions" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
                ${btnInscription}
                ${btnSupprimer}
            </div>
        </div>
    `;
}

async function sinscrireEvenement(recordId) {
    const nom = nomPiloteCourant();
    if (!nom) { alert('Connecte-toi pour t\'inscrire.'); return; }

    try {
        const getRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_EVENEMENTS)}/${recordId}`, { headers });
        const record = await getRes.json();
        if (!getRes.ok) throw new Error(record.error ? record.error.message : 'Erreur Airtable');

        const inscrits = parseInscrits(record.fields[FIELDS.INSCRITS] || '');
        if (inscrits.some(i => i.nom === nom)) { alert('Tu es déjà inscrit.'); return; }
        inscrits.push({ nom, commentaire: '' });

        const patchRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_EVENEMENTS)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id: recordId, fields: { [FIELDS.INSCRITS]: formatInscrits(inscrits) } }] })
        });
        if (!patchRes.ok) throw new Error(await patchRes.text());
        chargerEvenementsJour();
        chargerProchainsEvenements();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'inscription.');
    }
}

async function desinscrireEvenement(recordId, nom) {
    if (!confirm(`Retirer ${nom} de l'événement ?`)) return;
    try {
        const getRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_EVENEMENTS)}/${recordId}`, { headers });
        const record = await getRes.json();
        if (!getRes.ok) throw new Error(record.error ? record.error.message : 'Erreur Airtable');

        let inscrits = parseInscrits(record.fields[FIELDS.INSCRITS] || '');
        inscrits = inscrits.filter(i => i.nom !== nom);

        const patchRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_EVENEMENTS)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id: recordId, fields: { [FIELDS.INSCRITS]: formatInscrits(inscrits) } }] })
        });
        if (!patchRes.ok) throw new Error(await patchRes.text());
        chargerEvenementsJour();
        chargerProchainsEvenements();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la désinscription.');
    }
}

async function supprimerEvenement(recordId) {
    if (!confirm('Supprimer définitivement cet évènement ?')) return;
    try {
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_EVENEMENTS)}?records[]=${recordId}`, { method: 'DELETE', headers: headers });
        if (res.ok) {
            chargerEvenementsJour();
            chargerProchainsEvenements();
        } else {
            const err = await res.json();
            console.error(err);
            alert('Erreur lors de la suppression.');
        }
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la suppression.');
    }
}

async function modifierCommentaireEvenement(recordId, nom, commentaireActuel) {
    const nouveauCommentaire = prompt("Commentaire :", commentaireActuel || "");
    if (nouveauCommentaire === null) return;
    try {
        const getRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_EVENEMENTS)}/${recordId}`, { headers });
        const record = await getRes.json();
        if (!getRes.ok) throw new Error(record.error ? record.error.message : 'Erreur Airtable');

        const inscrits = parseInscrits(record.fields[FIELDS.INSCRITS] || '');
        const inscrit = inscrits.find(i => i.nom === nom);
        if (!inscrit) return;
        inscrit.commentaire = nouveauCommentaire.trim();

        const patchRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_EVENEMENTS)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id: recordId, fields: { [FIELDS.INSCRITS]: formatInscrits(inscrits) } }] })
        });
        if (!patchRes.ok) throw new Error(await patchRes.text());
        chargerEvenementsJour();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la sauvegarde du commentaire.');
    }
}

async function chargerProchainsEvenements() {
    const container = document.getElementById('prochains-evenements');
    if (!container) return;
    container.innerHTML = '<div class="loading" style="font-size:11px; color:#94a3b8;">Chargement...</div>';

    try {
        const today = new Date().toISOString().split('T')[0];
        const formula = encodeURIComponent(`NOT(IS_BEFORE({${FIELDS.DATE_FIN}}, DATETIME_PARSE('${today}', 'YYYY-MM-DD')))`);
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_EVENEMENTS)}?filterByFormula=${formula}&sort[0][field]=${encodeURIComponent(FIELDS.DATE_DEBUT)}&sort[0][direction]=asc&sort[1][field]=${encodeURIComponent(FIELDS.HEURE_DEBUT)}&sort[1][direction]=asc&pageSize=10`;
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur Airtable');

        const events = (data.records || []).slice(0, 5);
        if (!events.length) {
            container.innerHTML = '<div class="prochains-evenements-empty">Aucun événement à venir</div>';
            return;
        }

        container.innerHTML = '<h4 style="margin:0 0 6px; font-size:11px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px;">Prochains</h4>' +
            events.map(r => {
                const f = r.fields || {};
                const titre = escapeHtml(f[FIELDS.TITRE] || 'Événement');
                const date = formatDateEvenement(f[FIELDS.DATE_DEBUT]);
                return `<div class="prochain-evenement" onclick="allerAEvenement('${f[FIELDS.DATE_DEBUT]}')" title="${titre}">- ${date}: ${titre}</div>`;
            }).join('');
    } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="prochains-evenements-empty">Erreur de chargement</div>';
    }
}

function allerAEvenement(dateStr) {
    if (!dateStr) return;
    dateAffichee = new Date(dateStr + 'T12:00:00');
    mettreAJourDateAffichee();
    chargerDonneesPlanning();
    if (typeof rafraichirMiniCalendrier === 'function') rafraichirMiniCalendrier();
    chargerEvenementsJour();
}

function formatDateEvenement(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');
}

function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
