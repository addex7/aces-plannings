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
    AUTORISATION_PARENTALE: 'Autorisation parentale',
    AUTORISATION_PARENTALE_DATE: 'Date de validité autorisation parentale',
    CPL: 'Pilote CPL',
    INSTRUCTEUR: 'Date de validité instructeur'
};

const VALIDITES = [
    { label: 'Cotisation', field: MEMBRE_FIELDS.COTISATION },
    { label: 'Licence assurance FFVP', field: MEMBRE_FIELDS.LICENCE_FFVP },
    { label: 'Licence assurance FFA', field: MEMBRE_FIELDS.LICENCE_FFA },
    { label: 'Licence assurance FFPLUM', field: MEMBRE_FIELDS.LICENCE_FFPLUM },
    { label: 'Médical', field: MEMBRE_FIELDS.MEDICAL },
    { label: 'Licence SEP', field: MEMBRE_FIELDS.LICENCE_SEP },
    { label: 'Autorisation parentale', field: MEMBRE_FIELDS.AUTORISATION_PARENTALE_DATE },
    { label: 'Instructeur', field: MEMBRE_FIELDS.INSTRUCTEUR }
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

function estSuiviActif(fields, label) {
    const actifList = Array.isArray(fields[SUIVIS_ACTIFS]) ? fields[SUIVIS_ACTIFS] : (fields[SUIVIS_ACTIFS] ? [fields[SUIVIS_ACTIFS]] : []);
    return actifList.length ? actifList.includes(label) : true;
}

function dureeVolMinutes(f) {
    if (f['Horamètre départ'] !== undefined && f['Horamètre arrivée'] !== undefined) {
        const dep = parseFloat(f['Horamètre départ']);
        const arr = parseFloat(f['Horamètre arrivée']);
        if (!isNaN(dep) && !isNaN(arr) && arr >= dep) return Math.round((arr - dep) * 60);
    }
    if (!f['Heure départ'] || !f['Heure arrivée']) return 0;
    const [hD, mD] = f['Heure départ'].split(':').map(Number);
    const [hA, mA] = f['Heure arrivée'].split(':').map(Number);
    if (isNaN(hD) || isNaN(mD) || isNaN(hA) || isNaN(mA)) return 0;
    let minutes = (hA * 60 + mA) - (hD * 60 + mD);
    if (minutes < 0) minutes += 24 * 60;
    return minutes;
}

function dateIlYAMois(mois) {
    const auj = new Date();
    return new Date(auj.getFullYear(), auj.getMonth() - mois, auj.getDate());
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
    const estActif = (label) => estSuiviActif(fields, label);
    const dateNaissance = fields[MEMBRE_FIELDS.DATE_NAISSANCE] || '';
    const autorisation = calcAutorisationParentale(dateNaissance, fields[MEMBRE_FIELDS.AUTORISATION_PARENTALE]);
    const cpl = fields[MEMBRE_FIELDS.CPL] === true;
    const actifLAPL = estActif('LAPL');
    const actifInitiation = estActif('Pilote vol initiation avion');
    let grid = VALIDITES.map(item => {
        const val = fields[item.field];
        const ok = estValideJusqua(val);
        const iso = val ? new Date(val).toISOString().split('T')[0] : '';
        const actif = item.label === 'Autorisation parentale' ? (autorisation && estActif(item.label)) : estActif(item.label);
        if (item.label === 'Autorisation parentale' && !autorisation) return '';
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
    container.innerHTML = `
        <form id="accueil-validites-form">
            <div class="validite-grid">${grid}</div>
        </form>
        <div class="validite-card validite-experience">
            <div class="validite-label">Expériences récentes</div>
            <div class="experience-list" id="accueil-experiences">
                <div class="experience-row" data-exp="recent">
                    <span class="experience-titre">1 vol dans les 3 derniers mois</span>
                    <span class="validite-pill" id="accueil-exp-recent">${pastille(false, null, 'Chargement...')}</span>
                </div>
                <div class="experience-row" data-exp="passager">
                    <span class="experience-titre">Emport de passager (3 décollages / 3 atterrissages sur 3 mois)</span>
                    <span class="validite-pill" id="accueil-exp-passager">${pastille(false, null, 'Chargement...')}</span>
                </div>
                ${peutEditer || actifLAPL ? `
                <div class="experience-row ${actifLAPL ? '' : 'suivi-inactif'}" data-exp="lapl">
                    <span class="experience-titre">LAPL (12 h / 1 h instructeur / 12 décollages / 12 atterrissages sur 24 mois)</span>
                    <span class="validite-pill" id="accueil-exp-lapl">${pastille(false, null, 'Chargement...')}</span>
                    ${peutEditer ? `<label class="activer-suivi"><input type="checkbox" class="activer-suivi-cb" data-label="LAPL" ${actifLAPL ? 'checked' : ''}> Suivi actif</label>` : ''}
                </div>` : ''}
                ${peutEditer || actifInitiation ? `
                <div class="experience-row ${actifInitiation ? '' : 'suivi-inactif'}" data-exp="initiation">
                    <span class="experience-titre">Pilote vol d'initiation avion (25 h sur 12 mois + emport passager)</span>
                    <span class="validite-pill" id="accueil-exp-initiation">${pastille(false, null, 'Chargement...')}</span>
                    ${peutEditer ? `<label class="activer-suivi"><input type="checkbox" class="activer-suivi-cb" data-label="Pilote vol initiation avion" ${actifInitiation ? 'checked' : ''}> Suivi actif</label>
                    <label class="activer-suivi"><input type="checkbox" class="validite-input" data-field="${MEMBRE_FIELDS.CPL}" ${cpl ? 'checked' : ''}> Pilote CPL</label>` : ''}
                    ${!peutEditer && cpl ? '<span class="pastille pastille-verte">Pilote CPL</span>' : ''}
                </div>` : ''}
            </div>
        </div>
        <p class="accueil-disclaimer">Le pilote reste responsable de la validité de ses qualifications et de ses licences. Ce système est informatif.</p>
        ${docForm}
    `;
    renderPhoto(fields);
    chargerExperiences();
    chargerDocumentsMembre();
    attacherListenersAccueil();
}

async function chargerExperiences() {
    const container = document.getElementById('accueil-experiences');
    if (!container || !membreSelectionne) return;
    const elRecent = document.getElementById('accueil-exp-recent');
    const elPassager = document.getElementById('accueil-exp-passager');
    const elLAPL = document.getElementById('accueil-exp-lapl');
    const elInitiation = document.getElementById('accueil-exp-initiation');

    const updatePill = (el, couleur, texte) => { if (el) el.innerHTML = `<span class="pastille ${couleur}">${texte}</span>`; };
    const updateDetail = (el, couleur, texte, detail) => { if (el) el.innerHTML = `<span class="pastille ${couleur}">${texte}</span>${detail ? `<span class="validite-date">${detail}</span>` : ''}`; };

    try {
        const tableCarnet = typeof TABLE_CARNET_ROUTE !== 'undefined' ? TABLE_CARNET_ROUTE : 'Carnet de route Pilotes';
        const prenom = (membreSelectionne.prenom || '').replace(/"/g, '\\"');
        const nom = (membreSelectionne.nom || '').replace(/"/g, '\\"');
        const mois24 = dateIlYAMois(24);
        const dateMin = `${mois24.getFullYear()}-${String(mois24.getMonth() + 1).padStart(2, '0')}-${String(mois24.getDate()).padStart(2, '0')}`;
        const formula = `AND(OR(FIND(UPPER("${prenom}"), UPPER({Pilote})) > 0, FIND(UPPER("${nom}"), UPPER({Pilote})) > 0), IS_AFTER({Date}, "${dateMin}"))`;
        const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableCarnet)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;

        let records = [];
        let offset = '';
        do {
            const url = baseUrl + (offset ? `&offset=${offset}` : '');
            const res = await cachedFetch(url, { headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || 'Erreur');
            records = records.concat(data.records || []);
            offset = data.offset || '';
        } while (offset);

        const auj = new Date();
        const limite3m = dateIlYAMois(3);
        const limite12m = dateIlYAMois(12);
        const limite24m = dateIlYAMois(24);

        let dernierVol = null;
        let decollages3m = 0, atterrissages3m = 0;
        let minutes24m = 0, decollages24m = 0, atterrissages24m = 0, instruction1h = false;
        let minutes12m = 0;

        records.forEach(r => {
            const f = r.fields || {};
            if (!f['Date']) return;
            const d = new Date(f['Date']);
            if (d < limite24m) return;
            if (!dernierVol || d > dernierVol) dernierVol = d;
            const duree = dureeVolMinutes(f);
            const dec = parseInt(f['Décollages'], 10) || 1;
            const att = parseInt(f['Atterrissages'], 10) || 1;

            if (d >= limite3m) {
                decollages3m += dec;
                atterrissages3m += att;
            }
            if (d >= limite24m) {
                minutes24m += duree;
                decollages24m += dec;
                atterrissages24m += att;
                const inst = (f['Instructeur'] || '').trim();
                if (inst && duree >= 60) instruction1h = true;
            }
            if (d >= limite12m) {
                minutes12m += duree;
            }
        });

        const h24 = Math.floor(minutes24m / 60);
        const m24 = minutes24m % 60;
        const h12 = Math.floor(minutes12m / 60);
        const m12 = minutes12m % 60;

        // 1 vol 3 mois
        if (!dernierVol || dernierVol < limite3m) {
            updatePill(elRecent, 'pastille-rouge', '✕ Aucun vol dans les 3 derniers mois');
        } else {
            const validite = new Date(dernierVol);
            validite.setMonth(validite.getMonth() + 3);
            const jours = Math.floor((debutJour(validite) - debutJour(auj)) / (1000 * 60 * 60 * 24));
            if (jours < 0) {
                updateDetail(elRecent, 'pastille-rouge', '✕ Non à jour', `Dernier vol : ${formaterDateFr(dernierVol.toISOString())}`);
            } else if (jours < 30) {
                updateDetail(elRecent, 'pastille-orange', 'Bientôt à renouveler', `Dernier vol : ${formaterDateFr(dernierVol.toISOString())} — Valide jusqu'au : ${formaterDateFr(validite.toISOString())}`);
            } else {
                updateDetail(elRecent, 'pastille-verte', '✓ À jour', `Dernier vol : ${formaterDateFr(dernierVol.toISOString())} — Valide jusqu'au : ${formaterDateFr(validite.toISOString())}`);
            }
        }

        // Emport de passager
        const emportOk = decollages3m >= 3 && atterrissages3m >= 3;
        if (emportOk) {
            updatePill(elPassager, 'pastille-verte', `✓ À jour (${decollages3m} décollages, ${atterrissages3m} atterrissages)`);
        } else if (decollages3m > 0 || atterrissages3m > 0) {
            updatePill(elPassager, 'pastille-orange', `${decollages3m} décollages, ${atterrissages3m} atterrissages / 3`);
        } else {
            updatePill(elPassager, 'pastille-rouge', '✕ Aucun décollage/atterrissage sur 3 mois');
        }

        // LAPL
        const heuresLAPL = minutes24m >= 12 * 60;
        const decLAPL = decollages24m >= 12;
        const attLAPL = atterrissages24m >= 12;
        const laplOk = heuresLAPL && decLAPL && attLAPL && instruction1h;
        const texteLAPL = `${h24}h${String(m24).padStart(2, '0')} / 12h00 — ${decollages24m} décollages / 12 — ${atterrissages24m} atterrissages / 12 — 1h instructeur : ${instruction1h ? 'oui' : 'non'}`;
        updatePill(elLAPL, laplOk ? 'pastille-verte' : 'pastille-rouge', (laplOk ? '✓ À jour — ' : '✕ Non à jour — ') + texteLAPL);

        // Initiation avion
        const fields = membreSelectionne.fields || {};
        const cpl = fields[MEMBRE_FIELDS.CPL] === true;
        const initiationOk = emportOk && (cpl || minutes12m >= 25 * 60);
        const texteInit = cpl
            ? `Pilote CPL — ${h12}h${String(m12).padStart(2, '0')} sur 12 mois`
            : `${h12}h${String(m12).padStart(2, '0')} / 25h00 sur 12 mois — emport passager : ${emportOk ? 'oui' : 'non'}`;
        updatePill(elInitiation, initiationOk ? 'pastille-verte' : 'pastille-rouge', (initiationOk ? '✓ À jour — ' : '✕ Non à jour — ') + texteInit);
    } catch (err) {
        console.error('Erreur chargement expériences:', err);
        if (elRecent) elRecent.innerHTML = pastille(false, null, 'Erreur de chargement');
        if (elPassager) elPassager.innerHTML = pastille(false, null, 'Erreur de chargement');
        if (elLAPL) elLAPL.innerHTML = pastille(false, null, 'Erreur de chargement');
        if (elInitiation) elInitiation.innerHTML = pastille(false, null, 'Erreur de chargement');
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
    const dob = membreSelectionne.fields[MEMBRE_FIELDS.DATE_NAISSANCE];
    const age = ageEnAnnees(dob);
    fields[MEMBRE_FIELDS.AUTORISATION_PARENTALE] = age !== null && age < 18;
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
    const formDoc = document.getElementById('accueil-doc-form');
    if (formDoc) formDoc.addEventListener('submit', uploaderDocumentMembre);

    if (!isSuperAdmin()) return;

    document.querySelectorAll('.validite-input').forEach(input => {
        input.addEventListener('change', () => sauvegarderValidites());
    });
    document.querySelectorAll('.activer-suivi-cb').forEach(cb => {
        cb.addEventListener('change', () => sauvegarderValidites());
    });
    const rolesEl = document.getElementById('accueil-roles');
    if (rolesEl) {
        rolesEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                if (typeof mettreAJourRolesMembre === 'function') {
                    mettreAJourRolesMembre(membreSelectionne.id, rolesEl.querySelectorAll('input[type="checkbox"]:checked'));
                }
            });
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
