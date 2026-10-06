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
    INSTRUCTEUR: 'Date de validité instructeur',
    INSTRUCTEUR_ULM: 'Date de validité instructeur ULM'
};

const VALIDITES = [
    { label: 'Cotisation', field: MEMBRE_FIELDS.COTISATION },
    { label: 'Licence assurance FFVP', field: MEMBRE_FIELDS.LICENCE_FFVP },
    { label: 'Licence assurance FFA', field: MEMBRE_FIELDS.LICENCE_FFA },
    { label: 'Licence assurance FFPLUM', field: MEMBRE_FIELDS.LICENCE_FFPLUM },
    { label: 'Médical', field: MEMBRE_FIELDS.MEDICAL },
    { label: 'Licence SEP', field: MEMBRE_FIELDS.LICENCE_SEP },
    { label: 'Autorisation parentale', field: MEMBRE_FIELDS.AUTORISATION_PARENTALE_DATE },
    { label: 'Instructeur avion', field: MEMBRE_FIELDS.INSTRUCTEUR, dataLabel: 'Instructeur avion', suiviLabels: ['Instructeur', 'Instructeur avion'] },
    { label: 'Instructeur ULM', field: MEMBRE_FIELDS.INSTRUCTEUR_ULM, dataLabel: 'Instructeur ULM', suiviLabels: ['Instructeur ULM'] }
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

function estSuiviActif(fields, labelOrLabels) {
    const actifList = Array.isArray(fields[SUIVIS_ACTIFS]) ? fields[SUIVIS_ACTIFS] : (fields[SUIVIS_ACTIFS] ? [fields[SUIVIS_ACTIFS]] : []);
    const labels = Array.isArray(labelOrLabels) ? labelOrLabels : [labelOrLabels];
    return actifList.length ? labels.some(l => actifList.includes(l)) : true;
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
    let couleur = ok ? 'pastille-verte' : 'pastille-rouge';
    let texte = ok ? 'À jour' : (dateStr ? 'Non à jour' : (texteRouge || 'Non renseigné'));
    let icone = ok ? '✓' : '✕';
    if (ok && dateStr) {
        const d = new Date(dateStr);
        const seuil = new Date();
        seuil.setMonth(seuil.getMonth() + 3);
        if (!isNaN(d.getTime()) && debutJour(d) < debutJour(seuil)) {
            couleur = 'pastille-orange';
            texte = 'Bientôt à renouveler';
            icone = '⚠';
        }
    }
    const date = formaterDateFr(dateStr) || '-';
    return `<span class="pastille ${couleur}">${icone} ${texte}</span><span class="validite-date">Valide jusqu'au : ${date}</span>`;
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
        const url = `${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS)}/${membreId}`;
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

// Ouvre la modale des roles du membre affiche : lecture pour tous,
// cases a cocher editables pour les super admin.
function ouvrirModaleRolesMembre() {
    if (!membreSelectionne || typeof afficherModaleAlerte !== 'function') return;
    const nom = `${membreSelectionne.prenom || ''} ${membreSelectionne.nom || ''}`.trim() || 'Membre';
    const roles = membreSelectionne.roles || [];
    const liste = (typeof ROLES_MEMBRES !== 'undefined' ? ROLES_MEMBRES : ['Mécanicien', 'Gestion VI', 'Pilote VI', 'Instructeur planeur', 'Instructeur avion', 'Instructeur ULM', 'Pilote planeur', 'Documentaliste', 'Super admin', 'Trésorier']);
    const descRole = r => (typeof DESCRIPTIONS_ROLES !== 'undefined' && DESCRIPTIONS_ROLES[r])
        ? `<div style="font-size:12px; color:#64748b; margin-top:2px; white-space:pre-line;">${DESCRIPTIONS_ROLES[r]}</div>`
        : '';

    let html;
    if (isSuperAdmin()) {
        html = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px 24px; text-align:left;">` + liste.map(role => {
            const checked = roles.includes(role) ? 'checked' : '';
            return `<label style="display:flex; gap:8px; align-items:flex-start; cursor:pointer;">
                <input type="checkbox" data-role="${role}" ${checked} style="margin-top:3px;">
                <span><strong>${role}</strong>${descRole(role)}</span>
            </label>`;
        }).join('') + `</div>`;
    } else {
        html = roles.length
            ? `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px 24px; text-align:left;">` + roles.map(role =>
                `<div><strong>${role}</strong>${descRole(role)}</div>`).join('') + `</div>`
            : '<em style="color:#64748b;">Aucun rôle attribué.</em>';
    }

    afficherModaleAlerte(`Rôles — ${nom}`, html, '👤');

    const modal = document.getElementById('planning-alert-modal');
    if (modal) {
        const content = modal.querySelector('.modal-content');
        if (content) {
            content.style.maxWidth = '760px';
            content.style.maxHeight = '85vh';
            content.style.overflowY = 'auto';
        }
    }

    if (isSuperAdmin() && modal) {
        modal.querySelectorAll('input[type="checkbox"][data-role]').forEach(cb => {
            cb.addEventListener('change', async () => {
                const action = cb.checked ? 'Attribuer' : 'Retirer';
                const ok = typeof docsConfirmer === 'function'
                    ? await docsConfirmer(`${action} un rôle`, `<p style="margin:0;">${action} le rôle <strong>« ${cb.dataset.role} »</strong> ${cb.checked ? 'à' : 'de'} <strong>${nom}</strong> ?</p>`, '👤', action, !cb.checked)
                    : confirm(`${action} le rôle « ${cb.dataset.role} » ?`);
                if (!ok) { cb.checked = !cb.checked; return; }
                const coches = modal.querySelectorAll('input[type="checkbox"][data-role]:checked');
                membreSelectionne.roles = Array.from(coches).map(c => c.dataset.role);
                if (typeof mettreAJourRolesMembre === 'function') mettreAJourRolesMembre(membreSelectionne.id, coches);
                // Attribution d'un role instructeur : demander le trigramme si absent
                if (cb.checked && /instructeur/i.test(cb.dataset.role || '') && !(membreSelectionne.fields['Trigramme'] || '').trim()) {
                    const sugg = ((((membreSelectionne.prenom || '')[0]) || '') + ((membreSelectionne.nom || '').replace(/\s/g, '').slice(0, 2))).toUpperCase();
                    const saisie = prompt(`Rôle instructeur attribué à ${nom}.\nTrigramme à enregistrer :`, sugg);
                    if (saisie && saisie.trim()) {
                        const tri = saisie.trim().toUpperCase().slice(0, 3);
                        try {
                            await patchMembre(membreSelectionne.id, { 'Trigramme': tri });
                            membreSelectionne.fields['Trigramme'] = tri;
                            const inp = document.querySelector('#accueil-infos input[data-field="Trigramme"]');
                            if (inp) inp.value = tri;
                        } catch (e) { console.error('Erreur trigramme:', e); }
                    }
                }
            });
        });
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
        rolesEl.innerHTML = `<button type="button" class="btn-legende-couleurs" title="Rôles du membre">i</button>`;
        const btnRoles = rolesEl.querySelector('button');
        if (btnRoles) btnRoles.addEventListener('click', (e) => {
            e.stopPropagation();
            ouvrirModaleRolesMembre();
        });
    }
    const infosEl = document.getElementById('accueil-infos');
    if (infosEl) {
        const editable = isSuperAdmin() || membreSelectionne.id === currentUser.id;
        const toISO = v => { const d = v ? new Date(v) : null; return (d && !isNaN(d)) ? d.toISOString().split('T')[0] : ''; };
        const esc = v => String(v ?? '').replace(/"/g, '&quot;');
        const ligne = (label, cle, val, type) => editable
            ? `<div class="accueil-info"><span class="accueil-info-label">${label}</span><input type="${type}" class="accueil-info-input" data-field="${cle}" value="${esc(val)}"></div>`
            : `<div class="accueil-info"><span class="accueil-info-label">${label}</span><span class="accueil-info-val">${val || '—'}</span></div>`;
        const ligneLecture = (label, val, id = '') =>
            `<div class="accueil-info"><span class="accueil-info-label">${label}</span><span class="accueil-info-val"${id ? ` id="${id}"` : ''}>${val || '—'}</span></div>`;
        const d0 = fields['Date de naissance'] ? new Date(fields['Date de naissance']) : null;
        let age = '';
        if (d0 && !isNaN(d0)) {
            const auj = new Date();
            let a = auj.getFullYear() - d0.getFullYear();
            if (auj.getMonth() < d0.getMonth() || (auj.getMonth() === d0.getMonth() && auj.getDate() < d0.getDate())) a--;
            age = `${a} ans`;
        }
        const dn = editable ? toISO(fields['Date de naissance']) : (fields['Date de naissance'] ? new Date(fields['Date de naissance']).toLocaleDateString('fr-FR') : '');
        infosEl.innerHTML =
            ligne('Mail', 'Mail', fields['Mail'], 'email') +
            ligne('Identifiant', 'Identifiant', fields['Identifiant'], 'text') +
            (editable
                ? `<div class="accueil-info"><span class="accueil-info-label">Mot de passe</span><input type="password" class="accueil-info-input" data-field="Mot de passe" value="" placeholder="${fields['Mot de passe'] ? '••••••••' : 'Non défini'}" autocomplete="new-password"></div>`
                : ligneLecture('Mot de passe', fields['Mot de passe'] ? '••••••••' : '')) +
            ligne('Téléphone', 'Téléphone', fields['Téléphone'], 'text') +
            ligne('Date de naissance', 'Date de naissance', dn, editable ? 'date' : 'text') +
            ligneLecture('Âge', age, 'accueil-age-val') +
            ligne('Lieu de naissance', 'Lieu de naissance', fields['Lieu de naissance'], 'text') +
            ligne('Adresse', 'Adresse', fields['Adresse'], 'text') +
            ligne('Trigramme', 'Trigramme', fields['Trigramme'], 'text') +
            ligne('Licence FFA', 'Numéro licence FFA', fields['Numéro licence FFA'], 'text') +
            ligne('Licence FFVP', 'Numéro licence FFVP', fields['Numéro licence FFVP'], 'text') +
            ligne('Licence FFPLUM', 'Numéro licence FFPLUM', fields['Numéro licence FFPLUM'], 'text') +
            (editable ? `<div id="accueil-infos-actions" style="display:none; grid-column:1/-1; justify-content:flex-end; gap:10px; margin-top:4px;">
                <button type="button" class="nr-btn-cancel" id="accueil-infos-annuler">Annuler</button>
                <button type="button" class="btn-primary" id="accueil-infos-sauver">💾 Enregistrer les modifications</button>
            </div>` : '');
        if (editable) {
            const originales = {};
            const modifs = {};
            const actionsEl = () => document.getElementById('accueil-infos-actions');
            const majActions = () => { const a = actionsEl(); if (a) a.style.display = Object.keys(modifs).length ? 'flex' : 'none'; };
            infosEl.querySelectorAll('input').forEach(inp => {
                const champ = inp.dataset.field;
                originales[champ] = inp.value;
                if (champ === 'Trigramme') {
                    inp.maxLength = 3;
                    inp.style.textTransform = 'uppercase';
                }
                inp.addEventListener('input', () => {
                    let v = inp.value.trim();
                    if (champ === 'Trigramme') v = v.toUpperCase();
                    if (v === originales[champ] || (champ === 'Mot de passe' && !v)) delete modifs[champ];
                    else modifs[champ] = v;
                    majActions();
                });
            });
            const btnAnnuler = document.getElementById('accueil-infos-annuler');
            const btnSauver = document.getElementById('accueil-infos-sauver');
            if (btnAnnuler) btnAnnuler.addEventListener('click', () => {
                infosEl.querySelectorAll('input').forEach(inp => { inp.value = originales[inp.dataset.field] ?? ''; });
                Object.keys(modifs).forEach(c => delete modifs[c]);
                majActions();
            });
            if (btnSauver) btnSauver.addEventListener('click', async () => {
                const champs = Object.keys(modifs);
                if (!champs.length) return;
                const nom = `${membreSelectionne.prenom || ''} ${membreSelectionne.nom || ''}`.trim();
                let autorisationAuto = null;
                if (modifs['Date de naissance'] !== undefined) {
                    const age = ageEnAnnees(modifs['Date de naissance'] || null);
                    autorisationAuto = age !== null && age < 18;
                }
                const listeHtml = '<ul style="margin:10px 0 0; padding-left:20px;">' + champs.map(c =>
                    c === 'Mot de passe'
                        ? '<li><strong>Mot de passe</strong> : sera modifié</li>'
                        : `<li><strong>${esc(c)}</strong> : « ${esc(originales[c]) || '—'} » → « ${esc(modifs[c]) || '—'} »</li>`
                ).join('') + (autorisationAuto !== null
                    ? `<li><strong>Autorisation parentale</strong> : suivi ${autorisationAuto ? 'activé' : 'désactivé'} automatiquement (${autorisationAuto ? 'moins de' : 'plus de'} 18 ans)</li>`
                    : '') + '</ul>';
                const ok = await membreConfirmerEnregistrement(nom, listeHtml, modifs['Mot de passe'] || null);
                if (!ok) return;
                try {
                    const payload = {};
                    for (const c of champs) payload[c] = c === 'Mot de passe' ? await hacherMotDePasse(modifs[c]) : (modifs[c] || null);
                    if (autorisationAuto !== null) {
                        payload[MEMBRE_FIELDS.AUTORISATION_PARENTALE] = autorisationAuto;
                        const sa = membreSelectionne.fields[SUIVIS_ACTIFS];
                        const suivis = Array.isArray(sa) ? [...sa] : (sa ? [sa] : []);
                        const idx = suivis.indexOf('Autorisation parentale');
                        if (autorisationAuto && idx === -1) suivis.push('Autorisation parentale');
                        if (!autorisationAuto && idx !== -1) suivis.splice(idx, 1);
                        payload[SUIVIS_ACTIFS] = suivis;
                    }
                    await patchMembre(membreSelectionne.id, payload);
                    Object.keys(payload).forEach(c => { membreSelectionne.fields[c] = payload[c]; });
                    if (typeof enregistrerAudit === 'function') enregistrerAudit('Mise à jour de membre', nom, 'Champs modifiés : ' + champs.join(', '), 'Membres');
                    renderAccueilMembre(membreSelectionne.fields);
                } catch (e) {
                    console.error(e);
                    alert('Erreur lors de la sauvegarde : ' + e.message);
                }
            });
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
    const actifRecent = estActif('1 vol / 3 mois');
    const actifPassager = estActif('Emport de passager');
    let grid = VALIDITES.map(item => {
        const val = fields[item.field];
        const ok = estValideJusqua(val);
        const iso = val ? new Date(val).toISOString().split('T')[0] : '';
        const labelsActifs = item.suiviLabels || [item.label];
        const actif = item.label === 'Autorisation parentale' ? (autorisation && estActif(labelsActifs)) : estActif(labelsActifs);
        if (item.label === 'Autorisation parentale' && !autorisation) return '';
        if (!peutEditer && !actif) return '';
        const input = peutEditer ? `<input type="date" class="validite-input" data-field="${item.field}" value="${iso}">` : '';
        const activer = peutEditer ? `<label class="activer-suivi" title="Activer/désactiver ce suivi"><input type="checkbox" class="activer-suivi-cb" data-label="${item.dataLabel || item.label}" ${actif ? 'checked' : ''}> Actif</label>` : '';
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
            <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
                <h3 style="margin:0;">Documents du membre</h3>
                <span style="font-size:13px; color:#64748b; text-align:right;">Pour les pilotes ayant un compte Gesasso, retrouvez les documents sur <a href="https://moncompte.ffvp.fr/auth/realms/heva/protocol/openid-connect/auth?client_id=gesasso&amp;redirect_uri=https%3A%2F%2Fgesasso.ffvp.fr%2Fauth%2Fcallback&amp;state=df83886c-203f-4bc5-bd65-b6e881458f8a&amp;response_type=code&amp;response_mode=query&amp;code_challenge=wAx65brpcl57rOiQsfO0oHYUtOJ_7bFKAiqelhK--sI&amp;code_challenge_method=S256" target="_blank" rel="noopener noreferrer" style="color:#1e3d59; text-decoration:underline;">leur profil Gesasso</a></span>
            </div>
            <form id="accueil-doc-form" class="accueil-doc-form" style="display:flex; align-items:stretch; gap:10px; flex-wrap:wrap; margin-bottom:15px;">
                <div class="form-group" style="flex:1; min-width:120px; margin:0; display:flex; flex-direction:column;">
                    <label for="accueil-doc-type" style="margin-bottom:4px; font-size:13px;">Type</label>
                    <select id="accueil-doc-type" style="height:40px; box-sizing:border-box; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; background:white;">${docTypeOptions}</select>
                </div>
                <div class="form-group" style="flex:2; min-width:200px; margin:0; display:flex; flex-direction:column;">
                    <label for="accueil-doc-fichier" style="margin-bottom:4px; font-size:13px;">Fichier</label>
                    <input type="file" id="accueil-doc-fichier" accept="*" style="height:40px; box-sizing:border-box; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; background:white;">
                </div>
                <button type="submit" class="btn-primary" style="align-self:flex-end; height:40px; margin:0; padding:0 16px;">Ajouter</button>
            </form>
            <div class="accueil-doc-list" id="accueil-doc-list"><p>Chargement...</p></div>
        </div>
    ` : `
        <div class="accueil-documents" id="accueil-documents">
            <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
                <h3 style="margin:0;">Documents du membre</h3>
                <span style="font-size:13px; color:#64748b; text-align:right;">Pour les pilotes ayant un compte Gesasso, retrouvez les documents sur <a href="https://moncompte.ffvp.fr/auth/realms/heva/protocol/openid-connect/auth?client_id=gesasso&amp;redirect_uri=https%3A%2F%2Fgesasso.ffvp.fr%2Fauth%2Fcallback&amp;state=df83886c-203f-4bc5-bd65-b6e881458f8a&amp;response_type=code&amp;response_mode=query&amp;code_challenge=wAx65brpcl57rOiQsfO0oHYUtOJ_7bFKAiqelhK--sI&amp;code_challenge_method=S256" target="_blank" rel="noopener noreferrer" style="color:#1e3d59; text-decoration:underline;">leur profil Gesasso</a></span>
            </div>
            <div class="accueil-doc-list" id="accueil-doc-list"><p>Chargement...</p></div>
        </div>
    `;
    container.innerHTML = `
        <form id="accueil-validites-form">
            <div class="validite-grid">${grid}</div>
        </form>
        <div class="validite-card validite-experience">
            <div class="validite-label">Expériences récentes moteur</div>
            <div class="experience-list" id="accueil-experiences">
                ${peutEditer || actifRecent ? `
                <div class="experience-row ${actifRecent ? '' : 'suivi-inactif'}" data-exp="recent">
                    <span class="experience-titre">1 vol dans les 3 derniers mois</span>
                    <span class="validite-pill" id="accueil-exp-recent">${pastille(false, null, 'Chargement...')}</span>
                    ${peutEditer ? `<label class="activer-suivi"><input type="checkbox" class="activer-suivi-cb" data-label="1 vol / 3 mois" ${actifRecent ? 'checked' : ''}> Suivi actif</label>` : ''}
                </div>` : ''}
                ${peutEditer || actifPassager ? `
                <div class="experience-row ${actifPassager ? '' : 'suivi-inactif'}" data-exp="passager">
                    <span class="experience-titre">Emport de passager avion (3 décollages / 3 atterrissages sur 3 mois)</span>
                    <span class="validite-pill" id="accueil-exp-passager">${pastille(false, null, 'Chargement...')}</span>
                    ${peutEditer ? `<label class="activer-suivi"><input type="checkbox" class="activer-suivi-cb" data-label="Emport de passager" ${actifPassager ? 'checked' : ''}> Suivi actif</label>` : ''}
                </div>` : ''}
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
        const formula = `AND(FIND(UPPER("${prenom}"), UPPER({Pilote})) > 0, FIND(UPPER("${nom}"), UPPER({Pilote})) > 0, IS_AFTER({Date}, "${dateMin}"))`;
        const baseUrl = `${API_BASE}/${encodeURIComponent(tableCarnet)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;

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

        // Vols extérieurs saisis à la main dans le carnet de vol du pilote
        try {
            const urlManu = `${API_BASE}/${encodeURIComponent('Carnet de vol')}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
            records = records.concat(await fetchTousRecords(urlManu, { headers }));
        } catch (e) { console.error('Erreur lecture carnet de vol manuel:', e); }

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
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS)}/${membre.id}`, {
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

function membreConfirmerEnregistrement(nom, listeHtml, mdpSaisi) {
    return new Promise((resolve) => {
        const existing = document.getElementById('membre-mdp-modal');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'membre-mdp-modal';
        overlay.className = 'modal';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '20000';
        const nomEsc = typeof docsEscAttr === 'function' ? docsEscAttr(nom) : nom;
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 480px; text-align: left;">
                <span class="close-modal" style="font-size:22px; cursor:pointer;">&times;</span>
                <h3 style="display:flex; align-items:center; gap:10px; color:#1e3d59; margin-top:0;">
                    <span style="font-size:28px;">✏️</span>
                    <span>Confirmer les modifications</span>
                </h3>
                <p style="margin:0; line-height:1.6; font-size:15px; color:#334155;">
                    Enregistrer ces modifications pour <strong>${nomEsc}</strong> :
                </p>
                <div style="line-height:1.7; font-size:14px; color:#334155;">${listeHtml}</div>
                ${mdpSaisi ? `
                <p style="margin:15px 0 0; line-height:1.6; font-size:15px; color:#334155;">Retapez le nouveau mot de passe pour confirmer.</p>
                <input type="password" id="membre-mdp-confirm" placeholder="Retapez le mot de passe" autocomplete="new-password"
                    style="width:100%; margin-top:8px; padding:10px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:15px; box-sizing:border-box;">
                <p id="membre-mdp-erreur" style="display:none; margin:8px 0 0; color:#dc2626; font-size:13px;">Les deux mots de passe ne correspondent pas.</p>` : ''}
                <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:20px;">
                    <button type="button" class="nr-btn-cancel" id="membre-mdp-cancel">Annuler</button>
                    <button type="button" class="btn-primary" id="membre-mdp-ok">Enregistrer</button>
                </div>
            </div>
        `;
        const champ = overlay.querySelector('#membre-mdp-confirm');
        const erreur = overlay.querySelector('#membre-mdp-erreur');
        const fermer = (val) => { overlay.remove(); resolve(val); };
        const valider = () => {
            if (!mdpSaisi || champ.value === mdpSaisi) { fermer(true); return; }
            erreur.style.display = 'block';
            champ.value = '';
            champ.focus();
        };
        overlay.querySelector('.close-modal').addEventListener('click', () => fermer(false));
        overlay.querySelector('#membre-mdp-cancel').addEventListener('click', () => fermer(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) fermer(false); });
        overlay.querySelector('#membre-mdp-ok').addEventListener('click', valider);
        if (champ) champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') valider(); });
        document.body.appendChild(overlay);
        if (champ) champ.focus();
    });
}

async function chargerListeMembres() {
    const select = document.getElementById('accueil-select-membre');
    if (!select || !isSuperAdmin()) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS)}?sort[0][field]=Nom&sort[0][direction]=asc`, { headers });
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
        select.dispatchEvent(new Event('maj-affichage'));

        const btnModifier = document.getElementById('accueil-btn-modifier');
        if (btnModifier) btnModifier.style.display = '';

        // Le nom du membre dans le profil devient le select deroulant
        if (typeof rendreSelectRecherchable === 'function') rendreSelectRecherchable(select);
        const wrap = select.closest('.select-recherche');
        const nomEl = document.getElementById('accueil-nom');
        if (wrap && nomEl && nomEl.parentElement && wrap.parentElement !== nomEl.parentElement) {
            wrap.classList.add('accueil-nom-select');
            nomEl.parentElement.insertBefore(wrap, nomEl);
            nomEl.style.display = 'none';
        }
    } catch (err) {
        console.error('Erreur chargement liste membres:', err);
    }
}

async function patchMembre(membreId, fieldsToSend) {
    const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS)}/${membreId}`, {
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
            let aEnvoyer = suivisActifs.slice();
            const refuses = [];
            while (true) {
                try {
                    const data = await patchMembre(membreSelectionne.id, { [SUIVIS_ACTIFS]: aEnvoyer });
                    updatedFields = { ...updatedFields, ...(data.fields || {}) };
                    break;
                } catch (err) {
                    const m = (err.message || '').match(/select option\s*['"]+([^'"]+)['"]+/i);
                    if (m && aEnvoyer.includes(m[1])) {
                        refuses.push(m[1]);
                        aEnvoyer = aEnvoyer.filter(l => l !== m[1]);
                        continue;
                    }
                    throw err;
                }
            }
            if (refuses.length) {
                alert(`Option(s) manquante(s) dans le champ Airtable "Suivis actifs" : ${refuses.join(', ')}.\nAjoute-les dans les options du champ pour activer ces suivis.`);
            }
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
        const url = `${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}?filterByFormula=${encodeURIComponent(formula)}`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const records = data.records || [];
        const actifs = records.filter(r => !(r.fields || {})['Archivé']);
        const archives = records.filter(r => (r.fields || {})['Archivé']);

        const ligneDoc = (r, archive) => {
            const f = r.fields || {};
            const titre = f['Titre'] || 'Document';
            const lien = f['Lien'] || '#';
            let actions = `<a href="${lien}" target="_blank" rel="noopener" style="color:#166534; text-decoration:underline; font-size:13px;">Ouvrir ↗</a>`;
            if (isSuperAdmin()) {
                actions += `<button type="button" class="btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="renommerDocumentMembre('${r.id}', '${titre.replace(/'/g, "\\'")}')">Renommer</button>`;
                actions += archive
                    ? `<button type="button" class="btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="restaurerDocumentMembre('${r.id}')">Restaurer</button>`
                    : `<button type="button" class="btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="archiverDocumentMembre('${r.id}')">Archiver</button>`;
            }
            return `
                <div class="accueil-doc-item" style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; margin-bottom:8px;${archive ? ' opacity:0.75;' : ''}">
                    <span>${titre}</span>
                    <div style="display:flex; align-items:center; gap:8px;">${actions}</div>
                </div>
            `;
        };

        let html = actifs.length
            ? actifs.map(r => ligneDoc(r, false)).join('')
            : '<p>Aucun document actif pour ce membre.</p>';
        if (archives.length) {
            html += `
                <details style="margin-top:12px;">
                    <summary style="cursor:pointer; color:#64748b; font-size:13px; font-weight:600;">📦 Documents archivés (${archives.length})</summary>
                    <div style="margin-top:8px;">${archives.map(r => ligneDoc(r, true)).join('')}</div>
                </details>`;
        }
        list.innerHTML = html;
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
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}`, {
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

async function archiverDocumentMembre(id) {
    await basculerArchiveDocumentMembre(id, true);
}

async function restaurerDocumentMembre(id) {
    await basculerArchiveDocumentMembre(id, false);
}

async function basculerArchiveDocumentMembre(id, archive) {
    if (!isSuperAdmin()) { alert('Action réservée au super admin.'); return; }
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { 'Archivé': archive } })
        });
        if (!res.ok) throw new Error((await res.json()).error?.message || 'Erreur Airtable');
        await chargerDocumentsMembre();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'archivage : ' + (err.message || ''));
    }
}

async function renommerDocumentMembre(id, titreActuel) {
    if (!isSuperAdmin()) { alert('Action réservée au super admin.'); return; }
    const nouveau = prompt('Nouveau nom du document :', titreActuel || '');
    if (nouveau === null) return;
    const titre = nouveau.trim();
    if (!titre) { alert('Le nom ne peut pas être vide.'); return; }
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { 'Titre': titre } })
        });
        if (!res.ok) throw new Error((await res.json()).error?.message || 'Erreur Airtable');
        await chargerDocumentsMembre();
    } catch (err) {
        console.error(err);
        alert('Erreur lors du renommage : ' + (err.message || ''));
    }
}

async function supprimerDocumentMembre(id) {
    if (!confirm('Supprimer définitivement ce document ? Cette action est irréversible.')) return;
    if (!isSuperAdmin()) { alert('Action réservée au super admin.'); return; }
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers
        });
        if (!res.ok) throw new Error((await res.json()).error?.message || 'Erreur Airtable');
        await chargerDocumentsMembre();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la suppression : ' + (err.message || ''));
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

    const btnBilanAccueil = document.getElementById('btn-bilan-validites-accueil');
    if (btnBilanAccueil) {
        const voitBilan = typeof peutVoirBilanMembres === 'function' && peutVoirBilanMembres();
        btnBilanAccueil.style.display = voitBilan ? 'inline-block' : 'none';
    }

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

async function ouvrirAnnuaireMembres() {
    const modal = document.getElementById('annuaire-membres-modal');
    if (!modal) return;
    const tbody = document.getElementById('annuaire-membres-body');
    const search = document.getElementById('annuaire-membres-search');
    if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="carnet-empty">Chargement...</td></tr>';
    modal.style.display = 'flex';
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS)}?sort[0][field]=Nom&sort[0][direction]=asc`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const records = (data.records || []).filter(r => r.fields && r.fields['Actif'] !== false);
        window.annuaireMembresCache = records;
        afficherAnnuaireMembres(records);
        if (search) {
            search.value = '';
            search.oninput = () => {
                const q = search.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const filtered = window.annuaireMembresCache.filter(r => {
                    const f = r.fields || {};
                    const text = `${f['Prénom'] || ''} ${f['Nom'] || ''} ${f['Mail'] || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    return text.includes(q);
                });
                afficherAnnuaireMembres(filtered);
            };
        }
    } catch (err) {
        console.error(err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="carnet-empty">Erreur de chargement.</td></tr>';
    }
}

function afficherAnnuaireMembres(records) {
    const tbody = document.getElementById('annuaire-membres-body');
    if (!tbody) return;
    if (!records || records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="carnet-empty">Aucun membre trouvé.</td></tr>';
        return;
    }
    tbody.innerHTML = records.map(r => {
        const f = r.fields || {};
        const prenom = f['Prénom'] || '';
        const nom = f['Nom'] || '';
        const nomComplet = `${prenom} ${nom}`.trim() || 'Membre';
        const mail = f['Mail'] || '-';
        const telephone = f['Téléphone'] || '-';
        return `
            <tr>
                <td>${nomComplet}</td>
                <td>${mail}</td>
                <td>${telephone}</td>
            </tr>
        `;
    }).join('');
}

function fermerAnnuaireMembres() {
    const modal = document.getElementById('annuaire-membres-modal');
    if (modal) modal.style.display = 'none';
}

function initAccueilMembre() {
    const input = document.getElementById('accueil-photo-input');
    if (input) input.addEventListener('change', uploaderPhoto);
    const select = document.getElementById('accueil-select-membre');
    if (select) select.addEventListener('change', () => chargerAccueilMembre(select.value));
    const btnModifier = document.getElementById('accueil-btn-modifier');
    if (btnModifier) btnModifier.addEventListener('click', ouvrirModaleMembreSelectionne);
    const btnAnnuaire = document.getElementById('btn-annuaire-membres');
    if (btnAnnuaire) btnAnnuaire.addEventListener('click', ouvrirAnnuaireMembres);
    const btnBilanAccueil = document.getElementById('btn-bilan-validites-accueil');
    if (btnBilanAccueil) btnBilanAccueil.addEventListener('click', () => {
        if (typeof ouvrirBilanMembres === 'function') ouvrirBilanMembres();
    });
    const closeAnnuaire = document.getElementById('close-annuaire-membres');
    if (closeAnnuaire) closeAnnuaire.addEventListener('click', fermerAnnuaireMembres);
    const btnLegendeV = document.getElementById('btn-legende-validites');
    if (btnLegendeV) btnLegendeV.addEventListener('click', () => {
        const titre = t => `<div style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:0.6px; margin:14px 0 2px;">${t}</div>`;
        const item = (color, label) => `<div class="legende-ligne"><span class="legende-pastille" style="background:${color};"></span><span>${label}</span></div>`;
        if (typeof afficherModaleAlerte === 'function') afficherModaleAlerte('Légende', `
            ${titre('👤 Statuts des validités')}
            ${item('#dcfce7', 'À jour — échéance dans plus de 3 mois')}
            ${item('#ffedd5', 'Bientôt à renouveler — échéance dans moins de 3 mois')}
            ${item('#fee2e2', 'Non à jour — échéance dépassée ou date non renseignée')}
            ${item('#f1f5f9', 'Suivi désactivé (pastille grisée)')}
        `, 'ℹ️');
    });
}

document.addEventListener('DOMContentLoaded', initAccueilMembre);
