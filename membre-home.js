/* ==========================================================================
   ACCUEIL MEMBRE - VALIDITES ET PROFIL
   ==========================================================================
   Les colonnes ci-dessous doivent exister dans la table Airtable "Utilisateurs".
   Pour "Photo" : prévoir un champ Texte (simple ou long) pour stocker le dataURL.
   ========================================================================== */

const MEMBRE_FIELDS = {
    COTISATION: 'Cotisation',
    LICENCE_FFVP: 'Licence FFVP',
    LICENCE_FFA: 'Licence FFA',
    LICENCE_FFPLUM: 'Licence FFPLUM',
    MEDICAL: 'Médical',
    LICENCE_SEP: 'Licence SEP',
    PHOTO: 'Photo',
    DATE_NAISSANCE: 'Date de naissance',
    AUTORISATION_PARENTALE: 'Autorisation parentale'
};

const VALIDITES = [
    { label: 'Cotisation', field: MEMBRE_FIELDS.COTISATION },
    { label: 'Licence assurance FFVP', field: MEMBRE_FIELDS.LICENCE_FFVP },
    { label: 'Licence assurance FFA', field: MEMBRE_FIELDS.LICENCE_FFA },
    { label: 'Licence assurance FFPLUM', field: MEMBRE_FIELDS.LICENCE_FFPLUM },
    { label: 'Médical', field: MEMBRE_FIELDS.MEDICAL },
    { label: 'Licence SEP', field: MEMBRE_FIELDS.LICENCE_SEP }
];

const TYPES_DOCUMENTS = ['Médical', 'SEP', 'Autorisation parentale', 'Brevet ULM'];
const SUIVIS_ACTIFS = 'Suivis actifs';
let membreSelectionne = null;

function formaterDateFr(str) {
    if (!str) return null;
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function debutJour(d) {
    const j = new Date(d);
    j.setHours(0, 0, 0, 0);
    return j;
}

function ageEnAnnees(dob) {
    if (!dob) return null;
    const naissance = new Date(dob);
    if (isNaN(naissance.getTime())) return null;
    const auj = new Date();
    let age = auj.getFullYear() - naissance.getFullYear();
    if (auj.getMonth() < naissance.getMonth() || (auj.getMonth() === naissance.getMonth() && auj.getDate() < naissance.getDate())) age--;
    return age;
}

function calcAutorisationParentale(dob, saved) {
    if (saved === true || saved === false) return saved;
    if (dob) {
        const age = ageEnAnnees(dob);
        return age !== null && age < 18;
    }
    return false;
}

function estValideJusqua(str) {
    if (!str) return false;
    const d = new Date(str);
    if (isNaN(d.getTime())) return false;
    return debutJour(d) >= debutJour(new Date());
}

function pastille(ok, dateStr, texteRouge) {
    const couleur = ok ? 'pastille-verte' : 'pastille-rouge';
    const texte = ok ? 'À jour' : (dateStr ? 'Non à jour' : (texteRouge || 'Non renseigné'));
    const date = formaterDateFr(dateStr) || '-';
    return `<span class="pastille ${couleur}">${ok ? '✓' : '✕'} ${texte}</span><span class="validite-date">Valide jusqu'au : ${date}</span>`;
}

async function chargerAccueilMembre(id) {
    const container = document.getElementById('accueil-membre-container');
    if (!container) return;
    if (!currentUser) {
        container.innerHTML = '<p class="carnet-empty">Veuillez vous connecter pour voir votre profil.</p>';
        return;
    }
    const membreId = id || currentUser.id;
    container.innerHTML = '<p class="carnet-empty">Chargement du profil...</p>';
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${membreId}`;
        const res = await cachedFetch(url, { headers }, 0, true);
        const record = await res.json();
        if (!res.ok) throw new Error(record.error?.message || 'Erreur');
        const f = record.fields || {};
        membreSelectionne = {
            id: record.id,
            prenom: f['Prénom'],
            nom: f['Nom'],
            mail: f['Mail'],
            telephone: f['Téléphone'],
            identifiant: f['Identifiant'],
            roles: Array.isArray(f['Rôles']) ? f['Rôles'] : [f['Rôles']].filter(Boolean),
            fields: f
        };
        if (isSuperAdmin()) await chargerListeMembres();
        renderAccueilMembre(membreSelectionne.fields);
    } catch (err) {
        console.error('Erreur chargement accueil membre:', err);
        container.innerHTML = '<p class="carnet-empty">Impossible de charger le profil.</p>';
    }
}

function renderPhoto(fields) {
    const img = document.getElementById('accueil-photo');
    if (!img) return;
    const photoField = fields[MEMBRE_FIELDS.PHOTO];
    let src = '';
    if (Array.isArray(photoField) && photoField.length) {
        const att = photoField[0];
        src = att.url || att.thumbnails?.large?.url || att.thumbnails?.small?.url || '';
    } else if (typeof photoField === 'string' && photoField.trim()) {
        src = photoField;
    }
    if (!src) {
        const membre = membreSelectionne || currentUser;
        const initiales = `${(membre.prenom || '').charAt(0)}${(membre.nom || '').charAt(0)}`.toUpperCase();
        img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initiales || 'User')}&background=random&size=128`;
        return;
    }
    img.src = src;
}

function renderAccueilMembre(fields) {
    const container = document.getElementById('accueil-membre-container');
    if (!container || !membreSelectionne) return;
    const nomEl = document.getElementById('accueil-nom');
    const rolesEl = document.getElementById('accueil-roles');
    const titre = document.getElementById('accueil-titre');
    if (nomEl) nomEl.textContent = `${membreSelectionne.prenom || ''} ${membreSelectionne.nom || ''}`.trim();
    if (rolesEl) {
        const roles = membreSelectionne.roles || [];
        if (isSuperAdmin()) {
            const liste = (typeof ROLES_MEMBRES !== 'undefined' ? ROLES_MEMBRES : ['Mécanicien', 'Gestion VI', 'Pilote VI', 'Instructeur planeur', 'Élève planeur', 'Pilote planeur', 'Documentaliste', 'Super admin']);
            const cases = liste.map(role => {
                const checked = roles.includes(role) ? 'checked' : '';
                return `<label class="role-tag" title="${role}"><input type="checkbox" data-role="${role}" ${checked}> ${role}</label>`;
            }).join('');
            rolesEl.innerHTML = cases;
            rolesEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', () => {
                    if (typeof mettreAJourRolesMembre === 'function') {
                        mettreAJourRolesMembre(membreSelectionne.id, rolesEl.querySelectorAll('input[type="checkbox"]:checked'));
                    }
                });
            });
        } else {
            rolesEl.textContent = roles.join(' · ') || 'Membre';
        }
    }
    if (titre) {
        titre.textContent = isSuperAdmin() && membreSelectionne.id !== currentUser.id ?
            `Espace membre : ${(membreSelectionne.prenom || '')} ${(membreSelectionne.nom || '')}`.trim() :
            'Mon espace membre';
    }
    const peutEditer = isSuperAdmin();
    const actifList = Array.isArray(fields[SUIVIS_ACTIFS]) ? fields[SUIVIS_ACTIFS] : (fields[SUIVIS_ACTIFS] ? [fields[SUIVIS_ACTIFS]] : []);
    const estActif = (label) => actifList.length ? actifList.includes(label) : true;
    let grid = VALIDITES.map(item => {
        const val = fields[item.field];
        const ok = estValideJusqua(val);
        const iso = val ? new Date(val).toISOString().split('T')[0] : '';
        const actif = estActif(item.label);
        if (!peutEditer && !actif) return '';
        const input = peutEditer ? `<input type="date" class="validite-input" data-field="${item.field}" value="${iso}">` : '';
        const activer = peutEditer ? `<label class="activer-suivi" title="Activer/désactiver ce suivi"><input type="checkbox" class="activer-suivi-cb" data-label="${item.label}" ${actif ? 'checked' : ''}> Actif</label>` : '';
        const disabledClass = actif ? '' : 'suivi-inactif';
        return `
            <div class="validite-card ${disabledClass}" data-label="${item.label}">
                <div class="validite-label">${item.label}</div>
                ${activer}
                <div class="validite-pill">${pastille(ok, val)}</div>
                ${input}
            </div>
        `;
    }).join('');
    const saveBtn = peutEditer ? '<button type="button" id="accueil-save-validites" class="btn-enregistrer-validites">Enregistrer les informations</button>' : '';
    const docTypeOptions = TYPES_DOCUMENTS.map(t => `<option value="${t}">${t}</option>`).join('');
    const docForm = peutEditer ? `
        <div class="accueil-documents" id="accueil-documents">
            <h3>Documents du membre</h3>
            <form id="accueil-doc-form" class="accueil-doc-form">
                <div class="form-group">
                    <label for="accueil-doc-type">Type</label>
                    <select id="accueil-doc-type">${docTypeOptions}</select>
                </div>
                <div class="form-group">
                    <label for="accueil-doc-fichier">Fichier</label>
                    <input type="file" id="accueil-doc-fichier" accept="*">
                </div>
                <button type="submit" class="btn-primary">Ajouter</button>
            </form>
            <div class="accueil-doc-list" id="accueil-doc-list"><p>Chargement...</p></div>
        </div>
    ` : `
        <div class="accueil-documents" id="accueil-documents">
            <h3>Documents du membre</h3>
            <div class="accueil-doc-list" id="accueil-doc-list"><p>Chargement...</p></div>
        </div>
    `;
    const dateNaissance = fields[MEMBRE_FIELDS.DATE_NAISSANCE] || '';
    const isoDate = dateNaissance ? new Date(dateNaissance).toISOString().split('T')[0] : '';
    const age = ageEnAnnees(dateNaissance);
    const autorisation = calcAutorisationParentale(dateNaissance, fields[MEMBRE_FIELDS.AUTORISATION_PARENTALE]);
    const infosCards = [];
    const dateActif = estActif('Date de naissance');
    if (peutEditer || dateActif || dateNaissance) {
        const datePill = age !== null ? `<span class="pastille pastille-verte">✓ ${age} ans</span>` : `<span class="pastille pastille-rouge">✕ -</span>`;
        const dateInput = peutEditer ? `<input type="date" class="validite-input" id="accueil-date-naissance" data-field="${MEMBRE_FIELDS.DATE_NAISSANCE}" value="${isoDate}">` : '';
        const dateActiver = peutEditer ? `<label class="activer-suivi" title="Activer/désactiver ce suivi"><input type="checkbox" class="activer-suivi-cb" data-label="Date de naissance" ${dateActif ? 'checked' : ''}> Actif</label>` : '';
        const disabledClass = dateActif ? '' : 'suivi-inactif';
        infosCards.push(`
            <div class="validite-card ${disabledClass}" data-label="Date de naissance">
                <div class="validite-label">Date de naissance</div>
                ${dateActiver}
                <div class="validite-pill">${datePill}</div>
                ${dateInput}
            </div>
        `);
    }
    const autoActif = estActif('Autorisation parentale');
    if (peutEditer || autoActif || autorisation) {
        const autoPill = autorisation ? `<span class="pastille pastille-verte">✓ Oui</span>` : `<span class="pastille pastille-rouge">✕ Non</span>`;
        const autoInput = peutEditer ? `<label class="activer-suivi" for="accueil-autorisation-parentale"><input type="checkbox" class="validite-input" id="accueil-autorisation-parentale" data-field="${MEMBRE_FIELDS.AUTORISATION_PARENTALE}" ${autorisation ? 'checked' : ''}> Autorisation parentale</label>` : `<p>Autorisation parentale : ${autorisation ? 'Oui' : 'Non'}</p>`;
        const autoActiver = peutEditer ? `<label class="activer-suivi" title="Activer/désactiver ce suivi"><input type="checkbox" class="activer-suivi-cb" data-label="Autorisation parentale" ${autoActif ? 'checked' : ''}> Actif</label>` : '';
        const disabledClass = autoActif ? '' : 'suivi-inactif';
        infosCards.push(`
            <div class="validite-card ${disabledClass}" data-label="Autorisation parentale">
                <div class="validite-label">Autorisation parentale</div>
                ${autoActiver}
                <div class="validite-pill">${autoPill}</div>
                ${autoInput}
            </div>
        `);
    }
    grid += infosCards.join('');
    container.innerHTML = `
        <form id="accueil-validites-form">
            <div class="validite-grid">${grid}</div>
            ${saveBtn}
        </form>
        <div class="validite-card validite-experience">
            <div class="validite-label">Expérience récente (1 vol dans les 3 derniers mois)</div>
            <div class="validite-pill" id="accueil-experience">${pastille(false, null, 'Chargement...')}</div>
        </div>
        ${docForm}
    `;
    renderPhoto(fields);
    chargerExperienceRecente();
    chargerDocumentsMembre();
    attacherListenersAccueil();
}

async function chargerExperienceRecente() {
    const target = document.getElementById('accueil-experience');
    if (!target || !membreSelectionne) return;
    try {
        const tableCarnet = typeof TABLE_CARNET_ROUTE !== 'undefined' ? TABLE_CARNET_ROUTE : 'Carnet de route Pilotes';
        const prenom = (membreSelectionne.prenom || '').replace(/"/g, '\\"');
        const nom = (membreSelectionne.nom || '').replace(/"/g, '\\"');
        const formula = `OR(FIND(UPPER("${prenom}"), UPPER({Pilote})) > 0, FIND(UPPER("${nom}"), UPPER({Pilote})) > 0)`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableCarnet)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=1`;
        const res = await cachedFetch(url, { headers }, 0, true);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const vol = (data.records || [])[0];
        if (!vol || !vol.fields['Date']) {
            target.innerHTML = pastille(false, null, 'Aucun vol dans les 3 derniers mois');
            return;
        }
        const dateVol = new Date(vol.fields['Date']);
        const limite = new Date(dateVol);
        limite.setMonth(limite.getMonth() + 3);
        const joursRestants = Math.floor((debutJour(limite) - debutJour(new Date())) / (1000 * 60 * 60 * 24));
        let couleur, icone, texte;
        if (joursRestants < 0) {
            couleur = 'pastille-rouge';
            icone = '✕';
            texte = 'Non à jour';
        } else if (joursRestants < 30) {
            couleur = 'pastille-orange';
            icone = '';
            texte = 'Bientôt à renouveler';
        } else {
            couleur = 'pastille-verte';
            icone = '✓';
            texte = 'À jour';
        }
        target.innerHTML = `
            <span class="pastille ${couleur}">${icone ? icone + ' ' : ''}${texte}</span>
            <span class="validite-date">Dernier vol : ${formaterDateFr(dateVol.toISOString())}</span>
            <span class="validite-date">Valide jusqu'au : ${formaterDateFr(limite.toISOString())}</span>
        `;
    } catch (err) {
        console.error('Erreur expérience récente:', err);
        target.innerHTML = pastille(false, null, 'Erreur de chargement');
    }
}

async function mettreAJourPhoto(dataURL) {
    const membre = membreSelectionne || currentUser;
    if (!membre) return;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${membre.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { [MEMBRE_FIELDS.PHOTO]: dataURL } })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        renderPhoto(data.fields || {});
    } catch (err) {
        console.error('Erreur upload photo:', err);
        alert('Erreur lors de la sauvegarde de la photo. Vérifiez que le champ "Photo" est un champ Texte dans Airtable.');
    }
}

async function chargerListeMembres() {
    const select = document.getElementById('accueil-select-membre');
    const bar = document.getElementById('accueil-admin-bar');
    if (!select || !bar || !isSuperAdmin()) return;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}?sort[0][field]=Nom&sort[0][direction]=asc`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const previous = select.value;
        select.innerHTML = '';
        (data.records || []).forEach(r => {
            const f = r.fields || {};
            const nomComplet = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim() || 'Membre';
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.textContent = nomComplet;
            opt.dataset.record = JSON.stringify({ id: r.id, fields: f });
            select.appendChild(opt);
        });
        select.value = previous || (membreSelectionne ? membreSelectionne.id : '') || currentUser.id;
        bar.style.display = 'flex';
    } catch (err) {
        console.error('Erreur chargement liste membres:', err);
    }
}

async function patchMembre(membreId, fieldsToSend) {
    const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${membreId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ fields: fieldsToSend })
    });
    const data = await res.json();
    if (!res.ok) {
        const msg = data.error?.message || 'Erreur';
        const err = new Error(msg);
        err.data = data;
        throw err;
    }
    return data;
}

async function sauvegarderValidites() {
    if (!membreSelectionne || !isSuperAdmin()) return;
    const inputs = document.querySelectorAll('.validite-input');
    const fields = {};
    inputs.forEach(input => {
        const field = input.dataset.field;
        if (!field) return;
        if (input.type === 'checkbox') fields[field] = input.checked;
        else fields[field] = input.value || null;
    });
    const activerCbs = document.querySelectorAll('.activer-suivi-cb');
    const suivisActifs = activerCbs.length ? Array.from(activerCbs).filter(cb => cb.checked).map(cb => cb.dataset.label) : null;
    let updatedFields = membreSelectionne.fields || {};

    try {
        if (Object.keys(fields).length > 0) {
            const data = await patchMembre(membreSelectionne.id, fields);
            updatedFields = { ...updatedFields, ...(data.fields || {}) };
        }
        if (suivisActifs) {
            const data = await patchMembre(membreSelectionne.id, { [SUIVIS_ACTIFS]: suivisActifs });
            updatedFields = { ...updatedFields, ...(data.fields || {}) };
        }
        alert('Informations enregistrées.');
        renderAccueilMembre(updatedFields);
    } catch (err) {
        const missingField = Object.keys(fields).concat([SUIVIS_ACTIFS]).find(f => err.message && err.message.includes(f));
        if (missingField) {
            console.warn(`Champ manquant : ${missingField}`, err);
            alert(`Le champ "${missingField}" n'existe pas ou a une option inconnue dans Airtable. Les autres informations ont peut-être été enregistrées.`);
        } else {
            console.error('Erreur sauvegarde validités:', err);
            alert('Erreur lors de la sauvegarde : ' + (err.message || ''));
        }
    }
}

async function ouvrirModaleMembreSelectionne() {
    if (!membreSelectionne) return;
    ouvrirModaleMembre({ id: membreSelectionne.id, fields: membreSelectionne.fields });
}

async function chargerDocumentsMembre() {
    const list = document.getElementById('accueil-doc-list');
    if (!list || !membreSelectionne) return;
    list.innerHTML = '<p>Chargement...</p>';
    try {
        const nomComplet = `${(membreSelectionne.prenom || '').replace(/"/g, '\\"')} ${(membreSelectionne.nom || '').replace(/"/g, '\\"')}`.trim();
        const formula = `FIND(UPPER("${nomComplet}"), UPPER({Sous-dossier})) > 0`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOCUMENTS)}?filterByFormula=${encodeURIComponent(formula)}`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const records = data.records || [];
        if (!records.length) { list.innerHTML = '<p>Aucun document pour ce membre.</p>'; return; }
        list.innerHTML = records.map(r => {
            const f = r.fields || {};
            const titre = f['Titre'] || 'Document';
            const lien = f['Lien'] || '#';
            return `
                <div class="accueil-doc-item">
                    <span>${titre}</span>
                    <a href="${lien}" target="_blank" rel="noopener">Ouvrir ↗</a>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Erreur chargement documents membre:', err);
        list.innerHTML = '<p>Erreur de chargement.</p>';
    }
}

async function uploaderDocumentMembre(e) {
    e.preventDefault();
    if (!membreSelectionne || !isSuperAdmin()) return;
    const selectType = document.getElementById('accueil-doc-type');
    const inputFichier = document.getElementById('accueil-doc-fichier');
    const btn = e.target.querySelector('button[type="submit"]');
    const type = selectType ? selectType.value : 'Autre';
    const file = inputFichier ? inputFichier.files[0] : null;
    if (!file) { alert('Veuillez choisir un fichier.'); return; }
    if (typeof uploaderFichierDocument !== 'function') { alert('Uploader non disponible.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours...'; }
    try {
        const lien = await uploaderFichierDocument(file);
        const nomComplet = `${membreSelectionne.prenom || ''} ${membreSelectionne.nom || ''}`.trim();
        const fields = {
            'Titre': type,
            'Lien': lien,
            'Sous-dossier': nomComplet,
            'Description': 'Justificatif membre',
            'Auteur': currentUser ? `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() : ''
        };
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOCUMENTS)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        e.target.reset();
        await chargerDocumentsMembre();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'upload : ' + (err.message || err));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Ajouter'; }
    }
}

function redimensionnerImage(file, maxLargeur = 400, qualite = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = e => {
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ratio = Math.min(1, maxLargeur / img.width);
                canvas.width = Math.round(img.width * ratio);
                canvas.height = Math.round(img.height * ratio);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', qualite));
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function uploaderPhoto(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    try {
        const dataURL = await redimensionnerImage(file, 400, 0.7);
        if (dataURL.length > 90000) {
            alert('L\'image reste trop volumineuse après compression. Choisissez une photo plus légère (moins de 2 Mo idéalement).');
            return;
        }
        const preview = document.getElementById('accueil-photo');
        if (preview) preview.src = dataURL;
        await mettreAJourPhoto(dataURL);
    } catch (err) {
        console.error(err);
        alert('Erreur lors du traitement de l\'image.');
    }
    input.value = '';
}

function attacherListenersAccueil() {
    const btnValidites = document.getElementById('accueil-save-validites');
    if (btnValidites) btnValidites.addEventListener('click', sauvegarderValidites);
    const formDoc = document.getElementById('accueil-doc-form');
    if (formDoc) formDoc.addEventListener('submit', uploaderDocumentMembre);
    const dateNaissance = document.getElementById('accueil-date-naissance');
    const autorisationParentale = document.getElementById('accueil-autorisation-parentale');
    if (dateNaissance && autorisationParentale) {
        dateNaissance.addEventListener('change', () => {
            const age = ageEnAnnees(dateNaissance.value);
            autorisationParentale.checked = age !== null && age < 18;
        });
    }
}

function initAccueilMembre() {
    const input = document.getElementById('accueil-photo-input');
    if (input) input.addEventListener('change', uploaderPhoto);
    const select = document.getElementById('accueil-select-membre');
    if (select) select.addEventListener('change', () => chargerAccueilMembre(select.value));
    const btnModifier = document.getElementById('accueil-btn-modifier');
    if (btnModifier) btnModifier.addEventListener('click', ouvrirModaleMembreSelectionne);
}

document.addEventListener('DOMContentLoaded', initAccueilMembre);
