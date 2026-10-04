/* ==========================================================================
   PLANNING - GESTION DES RÉSERVATIONS ET PLANNING
   ========================================================================== */

// Les variables globales sont définies dans app.js
console.log('%c[planning.js] version 179 chargée', 'color:#7c3aed;font-weight:bold');

function afficherChargementGlobal() {
    const o = document.getElementById('saving-overlay');
    if (o) o.style.display = 'flex';
}
function masquerChargementGlobal() {
    const o = document.getElementById('saving-overlay');
    if (o) o.style.display = 'none';
}
let afficherVIPPlaneur = localStorage.getItem('planning_afficherVIP') === '1';
let idVIModale = null;
let tableVIModale = null;
let volChoixCreneau = null;
let volVIModale = null;
const URL_RESERVER_VI = 'https://vps-1a4fbee9.vps.ovh.net/reserver-vi.html';
let listeVolsInitiationCache = [];
let listeReservationsConflits = [];
let filtreInitiationActif = 'apourvoir';
let filtreTypesInitiation = ['VIP', 'VIULM', 'VIA'];
let listeMembresCache = [];
let hMinPlanning = 0;
let hMaxPlanning = 24;

function parseTempsDeVol(tempsStr) {
    if (!tempsStr) return NaN;
    const match = String(tempsStr).trim().match(/^(\d+)h(\d{2})$/i);
    if (!match) return NaN;
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    return h + m / 60;
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function afficherModaleAlerte(titre, messageHtml, icone = '⚠️') {
    const existing = document.getElementById('planning-alert-modal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'planning-alert-modal';
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '20000';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 420px; text-align: left;">
            <span class="close-modal" style="font-size:22px; cursor:pointer;">&times;</span>
            <h3 style="display:flex; align-items:center; gap:10px; color:#1e3d59; margin-top:0;">
                <span style="font-size:28px;">${icone}</span>
                <span>${escapeHtml(titre)}</span>
            </h3>
            <div style="margin-top:15px; line-height:1.6; font-size:15px; color:#334155;">${messageHtml}</div>
            <div style="text-align:right; margin-top:20px;">
                <button type="button" class="btn-primary" id="planning-alert-close">Fermer</button>
            </div>
        </div>
    `;
    overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#planning-alert-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

// Avertit (sans bloquer) lorsqu'un document de l'aeronef sera perime a la
// date du vol, ou expire dans les 30 jours qui suivent. La comparaison se
// fait sur la date du vol, pas sur aujourd'hui — une reservation lointaine
// signale donc les echeances qui tomberont d'ici la.
async function verifierDocumentsAeronefAvantReservation(immat, dateVol) {
    if (!immat || !(dateVol instanceof Date) || isNaN(dateVol) || typeof chargerDocumentsAeronef !== 'function') return;
    try {
        const docs = await chargerDocumentsAeronef(immat);
        if (!Array.isArray(docs) || !docs.length) return;
        const jourVol = new Date(dateVol.getFullYear(), dateVol.getMonth(), dateVol.getDate());
        const dans30j = new Date(jourVol);
        dans30j.setDate(dans30j.getDate() + 30);
        const perimes = [];
        const bientot = [];
        docs.forEach(r => {
            const f = r.fields || {};
            if (f['Activé'] === false) return;
            const dv = f['Date de validité'];
            if (!dv) return;
            const d = new Date(dv + 'T00:00:00');
            if (isNaN(d)) return;
            const type = (typeof TYPES_DOCUMENTS_AERONEFS !== 'undefined'
                ? ((TYPES_DOCUMENTS_AERONEFS.find(t => t.code === f['Type de document']) || {}).nom)
                : null) || f['Type de document'] || 'Document';
            const dateStr = d.toLocaleDateString('fr-FR');
            if (d < jourVol) perimes.push(`${type} — expiré le ${dateStr}`);
            else if (d <= dans30j) bientot.push(`${type} — expire le ${dateStr}`);
        });
        if (!perimes.length && !bientot.length) return;
        const lis = arr => arr.map(x => `<li>${escapeHtml(x)}</li>`).join('');
        let html = `<p>Pour le vol prévu le <strong>${jourVol.toLocaleDateString('fr-FR')}</strong> sur <strong>${escapeHtml(immat)}</strong> :</p>`;
        if (perimes.length) html += `<p style="margin-top:10px; color:#dc2626; font-weight:600;">Documents périmés à cette date :</p><ul style="margin:6px 0; padding-left:20px;">${lis(perimes)}</ul>`;
        if (bientot.length) html += `<p style="margin-top:10px; color:#d97706; font-weight:600;">Expire dans les 30 jours suivant le vol :</p><ul style="margin:6px 0; padding-left:20px;">${lis(bientot)}</ul>`;
        html += `<p style="margin-top:12px; font-size:13px; color:#64748b;">Ceci n'empêche pas la réservation — pensez à le signaler au club.</p>`;
        afficherModaleAlerte(`Documents ${immat}`, html, '📄');
    } catch (e) {
        console.warn('Vérification documents aéronef avant réservation:', e);
    }
}

function afficherModaleConfirmation(titre, messageHtml, onConfirm) {
    const existing = document.getElementById('planning-confirm-modal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'planning-confirm-modal';
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '20000';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 420px; text-align: left;">
            <span class="close-modal" style="font-size:22px; cursor:pointer;">&times;</span>
            <h3 style="display:flex; align-items:center; gap:10px; color:#1e3d59; margin-top:0;">
                <span style="font-size:28px;">🗑️</span>
                <span>${escapeHtml(titre)}</span>
            </h3>
            <div style="margin-top:15px; line-height:1.6; font-size:15px; color:#334155;">${messageHtml}</div>
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:20px;">
                <button type="button" class="nr-btn-cancel" id="planning-confirm-cancel">Annuler</button>
                <button type="button" id="planning-confirm-ok" style="background:#dc2626; color:#fff; border:none; padding:10px 16px; border-radius:8px; cursor:pointer; font-weight:600;">Supprimer</button>
            </div>
        </div>
    `;
    const fermer = () => overlay.remove();
    overlay.querySelector('.close-modal').addEventListener('click', fermer);
    overlay.querySelector('#planning-confirm-cancel').addEventListener('click', fermer);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fermer(); });
    overlay.querySelector('#planning-confirm-ok').addEventListener('click', () => { fermer(); onConfirm(); });
    document.body.appendChild(overlay);
}

function formaterDateISO(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// --- FONCTION POUR METTRE À JOUR L'HORAMÈTRE ---
async function mettreAJourHorametreAeronef(avionId, heuresAjoutees) {
    try {
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('Aéronefs')}/${avionId}`, {
            headers: headers
        });
        const avion = await response.json();

        if (!avion.fields || avion.fields['Horamètre actuel'] === undefined) {
            console.error("Horamètre non trouvé pour l'aéronef:", avionId);
            return;
        }

        const nouvelHorametre = parseFloat(avion.fields['Horamètre actuel']) + parseFloat(heuresAjoutees);

        const updateResponse = await cachedFetch(`${API_BASE}/${encodeURIComponent('Aéronefs')}/${avionId}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({
                fields: {
                    'Horamètre actuel': nouvelHorametre,
                    'Potentiel restant': avion.fields['Potentiel restant'] - parseFloat(heuresAjoutees)
                }
            })
        });

        if (!updateResponse.ok) {
            console.error("Erreur lors de la mise à jour de l'horamètre:", await updateResponse.text());
        }
    } catch (error) {
        console.error("Erreur dans mettreAJourHorametreAeronef:", error);
    }
}

// --- FONCTION POUR METTRE À JOUR LE CARNET DE ROUTE ---
async function ajouterAuCarnetDeRoute(avionId, piloteId, heuresVol) {
    try {
        const dateVol = dateAffichee.toISOString().split('T')[0];

        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('Carnet de route')}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                records: [{
                    fields: {
                        'Pilote': [piloteId],
                        'Machine': [avionId],
                        'Nouvel Horamètre': heuresVol,
                        'Date du vol': dateVol
                    }
                }]
            })
        });

        if (!response.ok) {
            console.error("Erreur lors de l'ajout au carnet de route:", await response.text());
        }
    } catch (error) {
        console.error("Erreur dans ajouterAuCarnetDeRoute:", error);
    }
}

async function mettreAJourStatutCreneauxConflit(dateJour, avionId) {
    const avion = (listeAvionsCache || []).find(a => a.id === avionId);
    const immat = avion ? (avion.fields['Immatriculation'] || '').toString().trim().toUpperCase() : '';
    const typeAttendu = immat === 'F-JVIO' ? 'VIULM' : (immat === 'F-GASB' ? 'VIA' : null);
    if (!typeAttendu) return;
    try {
        const urlCreneaux = `${API_BASE}/${encodeURIComponent('VI Créneaux')}?filterByFormula=DATETIME_FORMAT({Date},'YYYY-MM-DD')='${dateJour}'&pageSize=100&sort[0][field]=Date&sort[0][direction]=asc&sort[1][field]=${encodeURIComponent('Heure début')}&sort[1][direction]=asc`;
        const resCreneaux = await cachedFetch(urlCreneaux, { headers });
        const dataCreneaux = await resCreneaux.json();
        const urlResa = `${API_BASE}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({Date de début},'YYYY-MM-DD')<='${dateJour}', DATETIME_FORMAT({Date de fin},'YYYY-MM-DD')>='${dateJour}', FIND('${immat}', ARRAYJOIN({Machine},',')))`)}&pageSize=100`;
        const resResa = await cachedFetch(urlResa, { headers });
        const dataResa = await resResa.json();
        const reservations = dataResa.records || [];
        const updates = [];
        (dataCreneaux.records || []).forEach(r => {
            const f = r.fields || {};
            if ((f['Type'] || '') !== typeAttendu) return;
            const heureDebut = f['Heure début'] || '00:00';
            const heureFin = f['Heure fin'] || '00:00';
            const creneauDebut = new Date(`${f['Date']}T${heureDebut}`);
            const creneauFin = new Date(`${f['Date']}T${heureFin}`);
            const conflit = reservations.some(res => {
                const rf = res.fields || {};
                const resDebut = new Date(rf['Date de début']);
                const resFin = new Date(rf['Date de fin']);
                return resDebut < creneauFin && resFin > creneauDebut;
            });
            const statut = f['Statut'] || 'Disponible';
            if (conflit && statut === 'Disponible') {
                updates.push({ id: r.id, fields: { 'Statut': 'Bloqué' } });
            } else if (!conflit && statut === 'Bloqué') {
                updates.push({ id: r.id, fields: { 'Statut': 'Disponible' } });
            }
        });
        if (updates.length) {
            for (let i = 0; i < updates.length; i += 10) {
                await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}`, {
                    method: 'PATCH',
                    headers: headers,
                    body: JSON.stringify({ records: updates.slice(i, i + 10) })
                });
            }
        }
    } catch (error) {
        console.error('Erreur mise à jour créneaux conflit:', error);
    }
}

// --- FONCTION POUR OUVRIR LA MODALE DE MODIFICATION ---
async function ouvrirModaleModification(reservationId) {
    if (!reservationId) return;

    // Trouver la réservation dans le cache
    const cacheReservations = Array.isArray(listeReservationsCache) ? listeReservationsCache : ((listeReservationsCache && listeReservationsCache.records) || []);
    const reservation = cacheReservations.find(r => r.id === reservationId);
    if (!reservation || !reservation.fields) {
        alert("Réservation introuvable.");
        return;
    }
    if (!peutBougerReservations() && !estProprietaireReservation(reservation)) {
        ouvrirModaleInformation(reservation);
        return;
    }

    // Remplir le formulaire avec les données de la réservation
    const form = document.getElementById('reservation-form');
    if (!form) return;

    // Remplir les champs du formulaire
    form['form-debut'].value = reservation.fields['Date de début'] ? formaterDateHeureLocal(new Date(reservation.fields['Date de début'])) : '';
    form['form-fin'].value = reservation.fields['Date de fin'] ? formaterDateHeureLocal(new Date(reservation.fields['Date de fin'])) : '';

    // Remplir le pilote
    if (typeof peuplerPiloteSelect === 'function') {
        const piloteId = Array.isArray(reservation.fields['Pilote']) ? reservation.fields['Pilote'][0] : reservation.fields['Pilote'];
        await peuplerPiloteSelect(piloteId || null);
    }

    // Remplir la machine
    if (reservation.fields['Machine'] && form['form-machine']) {
        form['form-machine'].value = Array.isArray(reservation.fields['Machine'])
            ? reservation.fields['Machine'].join(', ')
            : reservation.fields['Machine'].toString().trim();
    }

    // Remplir le type de vol
    form['form-type-vol'].value = Array.isArray(reservation.fields['Type de vol'])
        ? reservation.fields['Type de vol'].join(', ')
        : (reservation.fields['Type de vol'] || 'Vol Classique');

    // Remplir l'instructeur
    if (typeof peuplerInstructeursSelect === 'function') await peuplerInstructeursSelect();
    if (typeof chargerListeMembresCache === 'function') await chargerListeMembresCache();
    if (form['form-instructeur']) {
        const savedInstructeur = reservation.fields['Instructeur'];
        let nomInstructeur = '';
        if (savedInstructeur) {
            const idInstructeur = Array.isArray(savedInstructeur) ? savedInstructeur[0] : savedInstructeur;
            if (typeof idInstructeur === 'string' && idInstructeur.startsWith('rec')) {
                const found = (typeof listeInstructeursCache !== 'undefined' ? listeInstructeursCache : []).find(i => i.id === idInstructeur);
                nomInstructeur = found ? found.nomComplet : nomUtilisateurDepuisId(idInstructeur, typeof listeMembresCache !== 'undefined' ? listeMembresCache : []);
            } else {
                nomInstructeur = String(idInstructeur).trim();
            }
        }
        const selInst = form['form-instructeur'];
        const options = Array.from(selInst.options);
        const match = nomInstructeur && options.find(o => o.value && typeof correspondanceNom === 'function' && correspondanceNom(o.value, nomInstructeur));
        if (match) {
            selInst.value = match.value;
        } else if (nomInstructeur && !String(nomInstructeur).startsWith('rec')) {
            if (!options.some(o => o.value === nomInstructeur)) {
                const opt = document.createElement('option');
                opt.value = nomInstructeur;
                opt.textContent = nomInstructeur;
                selInst.appendChild(opt);
            }
            selInst.value = nomInstructeur;
        } else {
            selInst.value = '';
        }
        selInst.dispatchEvent(new Event('maj-affichage'));
    }

    // Stocker l'ID de la réservation en cours d'édition
    idReservationEnEdition = reservationId;

    // Afficher la modale
    const modal = document.getElementById('reservation-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// --- FONCTION POUR SAUVEGARDER UNE RÉSERVATION ---
async function sauvegarderReservation() {
    const form = document.getElementById('reservation-form');
    if (!form.checkValidity()) {
        alert("Veuillez remplir tous les champs obligatoires.");
        return;
    }

    const formData = new FormData(form);
    const reservationData = {};
    for (let [key, value] of formData.entries()) {
        reservationData[key] = value;
    }

    // Récupérer l'ID de l'aéronef sélectionné
    const selectMachine = document.getElementById('form-machine');
    const avionId = selectMachine.value;

    // Récupérer le pilote
    const selPilote = document.getElementById('form-pilote');
    let piloteId = currentUser ? currentUser.id : '';
    let piloteNom = nomPiloteCourant();
    if (selPilote && selPilote.value) {
        const selected = selPilote.options[selPilote.selectedIndex];
        piloteId = selPilote.value;
        piloteNom = selected ? selected.textContent.trim() : piloteNom;
    }
    if (piloteNom && typeof getSoldePilote === 'function') {
        const solde = await getSoldePilote(piloteNom);
        if (solde <= -500) {
            const soldeText = solde.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const msg = `<p>Le compte pilote de <strong>${escapeHtml(piloteNom)}</strong> est à <strong>${escapeHtml(soldeText)} €</strong>.</p><p style="margin-top:8px;">Le plafond autorisé est de <strong>-500 €</strong>. La réservation est impossible avant de recréditer le compte.</p>`;
            afficherModaleAlerte('Compte pilote insuffisant', msg, '💳');
            return;
        }
    }

    // Avertissement si des validités sont invalides
    if (typeof chargerValiditesAccueil === 'function') {
        try {
            const validites = await chargerValiditesAccueil();
            if (validites && validites.items) {
                const invalides = validites.items.filter(i => i.ok === false);
                if (invalides.length) {
                    const liste = invalides.map(i => `<li>${escapeHtml(i.label)}</li>`).join('');
                    const msg = `<p>Les validités suivantes ne sont pas à jour :</p><ul style="margin:10px 0; padding-left:20px;">${liste}</ul>`;
                    afficherModaleAlerte('Validités à mettre à jour', msg, '🛡️');
                }
            }
        } catch (err) {
            console.warn('Vérification des validités avant réservation:', err);
        }
    }

    // Calculer la durée du vol en heures
    const heureDebut = new Date(reservationData['form-debut']);
    const heureFin = new Date(reservationData['form-fin']);
    const dureeHeures = (heureFin - heureDebut) / (1000 * 60 * 60);

    try {
        if (idReservationEnEdition) {
            // METTRE À JOUR UNE RÉSERVATION EXISTANTE
            const updateResponse = await cachedFetch(`${API_BASE}/${encodeURIComponent('Réservations')}/${idReservationEnEdition}`, {
                method: 'PATCH',
                headers: headers,
                body: JSON.stringify({
                    fields: {
                        'Pilote': [piloteId],
                        'Date de début': heureDebut.toISOString(),
                        'Date de fin': heureFin.toISOString(),
                        'Machine': [avionId],
                        'Type de vol': reservationData['form-type-vol'],
                        'Temps estimé': dureeHeures
                    }
                })
            });

            if (!updateResponse.ok) {
                throw new Error("Erreur lors de la mise à jour de la réservation");
            }

            // Mettre à jour l'horamètre (TODO: annuler l'ancien et ajouter le nouveau)
            await mettreAJourHorametreAeronef(avionId, dureeHeures);

        } else {
            // CRÉER UNE NOUVELLE RÉSERVATION
            const reservationResponse = await cachedFetch(`${API_BASE}/${encodeURIComponent('Réservations')}`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    records: [{
                        fields: {
                            'Pilote': [piloteId],
                            'Date de début': heureDebut.toISOString(),
                            'Date de fin': heureFin.toISOString(),
                            'Machine': [avionId],
                            'Type de vol': reservationData['form-type-vol'],
                            'Temps estimé': dureeHeures,
                            'Statut machine': 'OK'
                        }
                    }]
                })
            });

            if (!reservationResponse.ok) {
                throw new Error("Erreur lors de la création de la réservation");
            }

            const newReservation = await reservationResponse.json();
            const recordId = (newReservation.records && newReservation.records[0] && newReservation.records[0].id) || '';
            await mettreAJourHorametreAeronef(avionId, dureeHeures);
            await ajouterAuCarnetDeRoute(avionId, piloteId, dureeHeures);
            if (typeof enregistrerAudit === 'function') {
                console.log('Tentative log audit réservation', { piloteNom, avionId, recordId });
                await enregistrerAudit('Création de réservation', avionId, `Pilote : ${piloteNom} | ${heureDebut.toLocaleString('fr-FR')} - ${heureFin.toLocaleString('fr-FR')} | ${recordId}`, 'Planning');
            }
        }

        // Rafraîchir les données
        const dateJour = formaterDateISO(heureDebut);
        await chargerDonneesPlanning();
        await mettreAJourStatutCreneauxConflit(dateJour, avionId);
        await chargerVolsInitiation();

        // Fermer la modale
        const modal = document.getElementById('reservation-modal');
        if (modal) modal.style.display = 'none';
        form.reset();
        idReservationEnEdition = null;

        alert(idReservationEnEdition ? "Réservation mise à jour !" : "Réservation enregistrée !");

    } catch (error) {
        console.error("Erreur lors de la sauvegarde:", error);
        alert("Erreur lors de la sauvegarde. Veuillez réessayer.");
    }
}

// --- FONCTION POUR SUPPRIMER UNE RÉSERVATION ---
async function supprimerReservation() {
    if (!idReservationEnEdition) return;
    const cache = Array.isArray(listeReservationsCache) ? listeReservationsCache : (listeReservationsCache.records || []);
    const resa = cache.find(r => r.id === idReservationEnEdition);
    const resaMachine = (resa && resa.fields && resa.fields['Machine'] || [])[0];
    const resaDate = resa && resa.fields && resa.fields['Date de début'] ? formaterDateISO(new Date(resa.fields['Date de début'])) : null;
    const piloteNom = resa ? nomUtilisateurDepuisId(resa.fields['Pilote'], listeMembresCache) : '';
    const instructeurNom = resa ? nomUtilisateurDepuisId(resa.fields['Instructeur'], listeMembresCache) : '';
    const estProprietaire = typeof estUtilisateurCourant === 'function' && (estUtilisateurCourant(piloteNom) || estUtilisateurCourant(instructeurNom));
    const rolesAutorises = ['Super admin', 'Instructeur avion', 'Instructeur ULM'];
    const aRoleAutorise = (currentUser && Array.isArray(currentUser.roles) && currentUser.roles.some(r => rolesAutorises.includes(r))) || false;
    if (!estProprietaire && !aRoleAutorise) {
        alert("Tu n'as pas le droit de supprimer cette réservation.");
        return;
    }

    if (!confirm("Es-tu sûr de vouloir supprimer cette réservation ?")) return;

    try {
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('Réservations')}?records[]=${idReservationEnEdition}`, {
            method: 'DELETE',
            headers: headers
        });

        if (response.ok) {
            // TODO: Annuler la mise à jour de l'horamètre

            // Rafraîchir les données
            await chargerDonneesPlanning();
            if (resaDate && resaMachine) {
                await mettreAJourStatutCreneauxConflit(resaDate, resaMachine);
                await chargerVolsInitiation();
            }

            // Fermer la modale
            const modal = document.getElementById('reservation-modal');
            if (modal) modal.style.display = 'none';
            document.getElementById('reservation-form').reset();
            idReservationEnEdition = null;
        }
    } catch (error) {
        console.error(error);
    }
}

function mettreAJourBoutonVIPPlaneur() {
    const btn = document.getElementById('btn-toggle-vi-planeur');
    if (btn) {
        btn.classList.toggle('active', afficherVIPPlaneur);
    }
}

function setAfficherVIPPlaneur(val) {
    afficherVIPPlaneur = val;
    localStorage.setItem('planning_afficherVIP', val ? '1' : '0');
    mettreAJourBoutonVIPPlaneur();
}

async function peuplerSelectPilotesVI(valeurSelectionnee = '', selectId = 'form-vi-pilote', typeVI = null) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    await chargerListeMembresCache();
    let cible = (valeurSelectionnee || '').toString().trim();
    if (cible.startsWith('rec')) {
        cible = nomUtilisateurDepuisId(cible, listeMembresCache) || cible;
    }
    const pilotes = (listeMembresCache || []).filter(r => {
        const roles = Array.isArray(r.fields?.['Rôles']) ? r.fields['Rôles'] : [r.fields?.['Rôles']].filter(Boolean);
        return roles.includes('Pilote VI') && piloteAutoriseSurTypeVI(roles, typeVI);
    });
    sel.innerHTML = '<option value="">-- Aucun --</option>';
    let trouve = false;
    pilotes.forEach(r => {
        const f = r.fields || {};
        const nomComplet = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
        if (!nomComplet) return;
        const opt = document.createElement('option');
        opt.value = nomComplet;
        opt.textContent = nomComplet;
        if (cible && (nomComplet === cible || (typeof correspondanceNom === 'function' && correspondanceNom(nomComplet, cible)))) {
            opt.selected = true;
            trouve = true;
        }
        sel.appendChild(opt);
    });
    if (cible && !trouve) {
        const opt = document.createElement('option');
        opt.value = cible;
        opt.textContent = cible;
        opt.selected = true;
        sel.appendChild(opt);
    }
    if (!cible) sel.value = '';
}

async function ouvrirModaleEditionVIPlaneur(vol) {
    const modal = document.getElementById('vi-planeur-modal');
    const modalTitle = modal ? modal.querySelector('h3') : null;
    const btnDeleteVI = document.getElementById('btn-delete-vi-planeur');
    const groupTelephone = document.getElementById('group-vi-telephone');
    const groupStatut = document.getElementById('group-vi-statut');
    if (modalTitle) modalTitle.textContent = "Modifier VI Planeur";
    if (btnDeleteVI) btnDeleteVI.style.display = hasRoleGestionVI() ? 'block' : 'none';
    if (groupTelephone) groupTelephone.style.display = 'none';
    if (groupStatut) groupStatut.style.display = 'none';
    if (!modal) return;
    tableVIModale = 'VI Planeur';
    volVIModale = vol;
    idVIModale = vol.id;
    document.getElementById('form-vi-nom').value = (vol.fields['Nom'] || '').toString().trim();
    document.getElementById('form-vi-telephone').value = (vol.fields['Téléphone'] || '').toString().trim();
    document.getElementById('form-vi-statut').value = 'Réservé';
    document.getElementById('form-vi-debut').value = formaterPourInput(new Date(vol.fields['Date de début']));
    document.getElementById('form-vi-fin').value = formaterPourInput(new Date(vol.fields['Date de fin']));
    await peuplerSelectPilotesVI((vol.fields['Pilote'] || '').toString().trim(), 'form-vi-pilote', 'VIP');
    document.getElementById('form-vi-commentaire').value = (vol.fields['Commentaire'] || '').toString().trim();
    modal.style.display = 'flex';
}

async function ouvrirModaleEditionVICreneau(vol) {
    const modal = document.getElementById('vi-planeur-modal');
    const modalTitle = modal ? modal.querySelector('h3') : null;
    const btnDeleteVI = document.getElementById('btn-delete-vi-planeur');
    const groupTelephone = document.getElementById('group-vi-telephone');
    const groupStatut = document.getElementById('group-vi-statut');
    if (modalTitle) modalTitle.textContent = "Modifier Créneau VI";
    if (btnDeleteVI) btnDeleteVI.style.display = 'none';
    if (groupTelephone) groupTelephone.style.display = 'block';
    if (groupStatut) groupStatut.style.display = 'block';
    if (!modal) return;
    tableVIModale = 'VI Créneaux';
    volVIModale = vol;
    idVIModale = vol.id;
    document.getElementById('form-vi-nom').value = (vol.passager || '').toString().trim();
    document.getElementById('form-vi-telephone').value = (vol.telephone || '').toString().trim();
    document.getElementById('form-vi-statut').value = (vol.statut || 'Disponible');
    document.getElementById('form-vi-debut').value = formaterPourInput(new Date(vol.debut));
    document.getElementById('form-vi-fin').value = formaterPourInput(new Date(vol.fin));
    await peuplerSelectPilotesVI((vol.pilote || '').toString().trim(), 'form-vi-pilote', vol.type);
    document.getElementById('form-vi-commentaire').value = (vol.commentaire || '').toString().trim();
    modal.style.display = 'flex';
}

function afficherLigneVIPlaneur(volsVIP, rowsContainer, soleil, hMin = 0, hMax = 24) {
    if (!afficherVIPPlaneur) return;
    const rowDiv = document.createElement('div');
    rowDiv.className = 'timeline-row vi-planeur-row';
    const machineCell = document.createElement('div');
    machineCell.className = 'machine-cell';
    machineCell.textContent = 'VI Planeur';
    rowDiv.appendChild(machineCell);
    const contentWrapper = document.createElement('div');
    contentWrapper.style.cssText = 'flex: 1; position: relative; overflow: hidden;';

    const gridBg = document.createElement('div');
    gridBg.className = 'hours-grid-background';
    const aubeAeroPercent = (Math.max(0, soleil.aubeAero) / 24) * 100;
    const leverPercent = (Math.max(0, soleil.leverSoleil) / 24) * 100;
    const coucherPercent = (Math.min(24, soleil.coucherSoleil) / 24) * 100;
    const crepusculeAeroPercent = (Math.min(24, soleil.crepusculeAero) / 24) * 100;

    const divNuitMatin = document.createElement('div');
    divNuitMatin.className = 'night-zone night-aero';
    divNuitMatin.style.left = '0%';
    divNuitMatin.style.width = `${aubeAeroPercent}%`;
    gridBg.appendChild(divNuitMatin);
    const divAube = document.createElement('div');
    divAube.className = 'night-zone night-civil';
    divAube.style.left = `${aubeAeroPercent}%`;
    divAube.style.width = `${leverPercent - aubeAeroPercent}%`;
    gridBg.appendChild(divAube);
    const divCrepuscule = document.createElement('div');
    divCrepuscule.className = 'night-zone night-civil';
    divCrepuscule.style.left = `${coucherPercent}%`;
    divCrepuscule.style.width = `${crepusculeAeroPercent - coucherPercent}%`;
    gridBg.appendChild(divCrepuscule);
    const divNuitSoir = document.createElement('div');
    divNuitSoir.className = 'night-zone night-aero';
    divNuitSoir.style.left = `${crepusculeAeroPercent}%`;
    divNuitSoir.style.width = `${100 - crepusculeAeroPercent}%`;
    gridBg.appendChild(divNuitSoir);

    const gridCells = creerWrapperCellulesGrille(gridBg);
    for (let h = 0; h < 24; h++) {
        const gridBlock = document.createElement('div');
        gridBlock.className = 'grid-hour-block';
        gridBlock.style.flex = LARGEURS_HEURES[h];
        gridBlock.style.cursor = 'pointer';
        gridBlock.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('[VI PLANEUR CELL CLICK]', h, typeof window.ouvrirModaleNouvelleReservation);
            if (typeof window.ouvrirModaleNouvelleReservation === 'function') window.ouvrirModaleNouvelleReservation({ type: 'VI Planeur', dureeMinutes: 45, heureDebut: h });
        });
        gridCells.appendChild(gridBlock);
    }

    volsVIP.forEach(vol => {
        if (!vol.fields) return;
        const nom = (vol.fields['Nom'] || '').toString().trim();
        const pilote = nomUtilisateurDepuisId(vol.fields['Pilote'], listeMembresCache);
        const debutRaw = vol.fields['Date de début'];
        const finRaw = vol.fields['Date de fin'];
        if (debutRaw && finRaw) {
            const dateDebut = new Date(debutRaw);
            const dateFin = new Date(finRaw);
            let heureDebut = dateDebut.getHours() + (dateDebut.getMinutes() / 60);
            let heureFin = dateFin.getHours() + (dateFin.getMinutes() / 60);
            let duree = heureFin - heureDebut;
            if (duree > 0) {
                const barresDiv = document.createElement('div');
                const type = (vol.fields['Type'] || 'VI');
                const isCreneau = vol._table === 'VI Créneaux';
                const estMoi = estUtilisateurCourant(pilote);
                const classePilote = pilote ? 'vi-avec-pilote' : 'vi-sans-pilote';
                barresDiv.className = `reservation-bar ${classePilote}${estMoi ? ' ma-reservation' : ''}`;
                if (duree <= 2) barresDiv.classList.add('short-reservation');
                if (duree <= 1) barresDiv.classList.add('very-short-reservation');
                barresDiv.style.left = `${positionHeure(heureDebut)}%`;
                barresDiv.style.width = `${positionHeure(heureFin) - positionHeure(heureDebut)}%`;
                const libelle = pilote ? `${type} (${formaterNomPilote(pilote)})` : `${type} — ${nom}`;
                barresDiv.innerHTML = `<strong>${libelle}</strong>`;
                const debutStr = convertirHeureEnHHMM(heureDebut);
                const finStr = convertirHeureEnHHMM(heureFin);
                barresDiv.setAttribute('data-tooltip', [
                    `Type : ${type}`,
                    `Nom : ${nom}`,
                    `Pilote : ${formaterNomPilote(pilote) || '—'}`,
                    `Horaires : ${debutStr} - ${finStr}`,
                    `Téléphone : ${vol.fields['Téléphone'] || '—'}`,
                    `Commentaire : ${vol.fields['Commentaire'] || '—'}`
                ].join('\n'));
                barresDiv.removeAttribute('title');
                if (!isCreneau) {
                    const handleLeft = document.createElement('div');
                    handleLeft.className = 'resize-handle resize-handle-left';
                    const handleRight = document.createElement('div');
                    handleRight.className = 'resize-handle resize-handle-right';
                    barresDiv.appendChild(handleLeft);
                    barresDiv.appendChild(handleRight);
                    handleLeft.addEventListener('pointerdown', (e) => {
                        e.stopPropagation();
                        initierResize(e, vol.id, gridBg, barresDiv, 'gauche', heureDebut, heureFin, null, 'VI Planeur');
                    });
                    handleRight.addEventListener('pointerdown', (e) => {
                        e.stopPropagation();
                        initierResize(e, vol.id, gridBg, barresDiv, 'droite', heureDebut, heureFin, null, 'VI Planeur');
                    });
                    barresDiv.addEventListener('pointerdown', (e) => {
                        if (e.target.classList.contains('resize-handle')) return;
                        e.stopPropagation();
                        initierDeplacementBarre(e, vol.id, null, gridBg, barresDiv, heureDebut, duree, null, 'VI Planeur');
                    });
                }
                barresDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isResizing || isDraggingBar) return;
                    ouvrirActionsVI({
                        source: isCreneau ? 'creneau' : 'planeur',
                        id: vol.id,
                        passager: nom,
                        pilote: pilote,
                        auteur: vol.fields['Auteur'] || '',
                        telephone: vol.fields['Téléphone'] || '',
                        debut: vol.fields['Date de début'],
                        fin: vol.fields['Date de fin'],
                        commentaire: vol.fields['Commentaire'] || '',
                        token: vol.fields['Token'] || '',
                        type: type
                    });
                });
                barresDiv.addEventListener('mouseenter', () => { barresDiv.style.zIndex = '100'; });
                barresDiv.addEventListener('mouseleave', () => { barresDiv.style.zIndex = '5'; });
                gridBg.appendChild(barresDiv);
            }
        }
    });

    appliquerEchelleGrid(gridBg, hMin, hMax);
    contentWrapper.appendChild(gridBg);
    rowDiv.appendChild(contentWrapper);
    rowsContainer.appendChild(rowDiv);
}

// --- FONCTION POUR CHARGER ET AFFICHER LES DONNÉES DU PLANNING ---
async function chargerDonneesPlanning(forceRefresh = false, autoActiverVIP = true, silencieux = false) {
    const rowsContainer = document.getElementById('timeline-rows');
    if (!rowsContainer) return;
    if (!silencieux) rowsContainer.innerHTML = "<div class='loading'>Mise à jour du planning...</div>";
    const debutJour = dateAffichee.toISOString().split('T')[0];
    try {
        await chargerListeMembresCache();
        if (forceRefresh || listeAvionsCache.length === 0) {
            const resAvions = await cachedFetch(`${API_BASE}/${encodeURIComponent('Aéronefs')}`, { headers });
            const dataAvions = await resAvions.json();
            if (dataAvions.records) listeAvionsCache = trierAvionsParImmat(dataAvions.records);
        }
        const trouverAvionParImmat = (immat) => (listeAvionsCache || []).find(a => (a.fields['Immatriculation'] || a.fields['Nom'] || '').toString().trim().toUpperCase() === immat.toUpperCase());
        const avionJVIO = trouverAvionParImmat('F-JVIO');
        const avionGASB = trouverAvionParImmat('F-GASB');
        const avionIdJVIO = avionJVIO ? avionJVIO.id : null;
        const avionIdGASB = avionGASB ? avionGASB.id : null;
        let creneauxVIMotor = [];
        const urlReservations = `${API_BASE}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')<='${debutJour}', DATETIME_FORMAT({Date de fin}, 'YYYY-MM-DD')>='${debutJour}')`)}`;
        const urlVIPlaneur = `${API_BASE}/${encodeURIComponent('VI Planeur')}?filterByFormula=DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')='${debutJour}'`;
        const urlVICreneaux = `${API_BASE}/${encodeURIComponent('VI Créneaux')}?filterByFormula=DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${debutJour}'`;

        const [resReservations, resVIPlaneur, resVICreneaux] = await Promise.all([
            cachedFetch(urlReservations, { headers }, API_CACHE_TTL, forceRefresh),
            cachedFetch(urlVIPlaneur, { headers }, API_CACHE_TTL, forceRefresh),
            cachedFetch(urlVICreneaux, { headers }, API_CACHE_TTL, forceRefresh)
        ]);
        const [dataReservations, dataVIPlaneur, dataVICreneaux] = await Promise.all([
            resReservations.json(),
            resVIPlaneur.json(),
            resVICreneaux.json()
        ]);
        let disposInstructeurs = [];
        if (typeof afficherDisposInstructeurs !== 'undefined' && afficherDisposInstructeurs) {
            disposInstructeurs = await chargerDisponibilitesInstructeurs(dateAffichee, forceRefresh);
        }
        if (dataReservations.records) listeReservationsCache = dataReservations.records;
        let volsVIP = (dataVIPlaneur.records || []).filter(vol => {
            if (!vol.fields) return false;
            const debutRaw = vol.fields['Date de début'];
            if (!debutRaw) return false;
            const dateVol = new Date(debutRaw);
            return dateVol.getFullYear() === dateAffichee.getFullYear() &&
                   dateVol.getMonth() === dateAffichee.getMonth() &&
                   dateVol.getDate() === dateAffichee.getDate();
        });
        const creneauxVI = (dataVICreneaux.records || []).map(vol => {
            if (!vol.fields) return null;
            const f = vol.fields;
            const statut = f['Statut'] || 'Disponible';
            if (statut !== 'Réservé') return null;
            const dateRaw = f['Date'];
            if (!dateRaw) return null;
            const dateVol = new Date(dateRaw + 'T00:00:00');
            if (dateVol.getFullYear() !== dateAffichee.getFullYear() ||
                dateVol.getMonth() !== dateAffichee.getMonth() ||
                dateVol.getDate() !== dateAffichee.getDate()) return null;
            const passager = [f['Prénom'], f['Nom']].filter(Boolean).join(' ').trim();
            const pilote = (f['Pilote'] || '').toString().trim();
            const nom = passager || 'DISPONIBLE';
            const type = f['Type'] || 'VI';
            if (type === 'VIP') {
                return {
                    id: vol.id,
                    _table: 'VI Créneaux',
                    fields: {
                        'Type': 'VIP',
                        'Nom': nom,
                        'Date de début': dateRaw + 'T' + (f['Heure début'] || '00:00') + ':00',
                        'Date de fin': dateRaw + 'T' + (f['Heure fin'] || '00:00') + ':00',
                        'Pilote': pilote,
                        'Téléphone': f['Téléphone'] || '',
                        'Token': f['Token'] || '',
                        'Commentaire': f['Commentaire'] || ''
                    }
                };
            }
            const avionId = type === 'VIULM' ? avionIdJVIO : (type === 'VIA' ? avionIdGASB : null);
            if (!avionId || nom === 'DISPONIBLE') return null;
            creneauxVIMotor.push({
                id: vol.id,
                _table: 'VI Créneaux',
                _typeVI: type,
                fields: {
                    'Type de vol': ['VI Moteur'],
                    'Passager': nom,
                    'Pilote': pilote,
                    'Téléphone': f['Téléphone'] || '',
                    'Email': f['Email'] || '',
                    'Token': f['Token'] || '',
                    'Machine': [avionId],
                    'Date de début': dateRaw + 'T' + (f['Heure début'] || '00:00') + ':00',
                    'Date de fin': dateRaw + 'T' + (f['Heure fin'] || '00:00') + ':00',
                    'Commentaires VI': f['Commentaire'] || '',
                    'Temps estimé': 1
                }
            });
            return null;
        }).filter(Boolean);
        volsVIP.push(...creneauxVI);
        volsVIP = volsVIP.filter(vol => {
            const nom = (vol.fields['Nom'] || '').toString().trim();
            return nom && nom !== 'DISPONIBLE';
        });
        const formulaJour = `DATETIME_FORMAT({Date},'YYYY-MM-DD')='${debutJour}'`;
        const urlCarnetPilotes = `${API_BASE}/${encodeURIComponent('Carnet de route Pilotes')}?filterByFormula=${encodeURIComponent(formulaJour)}`;
        const urlCarnetPilotesTous = `${API_BASE}/${encodeURIComponent('Carnet de route Pilotes')}?pageSize=100`;
        // Maintenances chevauchant le jour affiche : Date < fin du jour ET Date + durée > debut du jour
        const debutJourDt = new Date(`${debutJour}T00:00:00`);
        const finJourDt = new Date(debutJourDt.getTime() + 24 * 60 * 60 * 1000);
        const formulaMaint = `AND(IS_BEFORE({Date},DATETIME_PARSE('${finJourDt.toISOString()}')),IS_AFTER(DATEADD({Date},{durée},'hours'),DATETIME_PARSE('${debutJourDt.toISOString()}')))`;
        const urlMaintenance = `${API_BASE}/${encodeURIComponent('Maintenance')}?filterByFormula=${encodeURIComponent(formulaMaint)}`;
        const [resCarnetPilotes, resCarnetPilotesTous, resMaintenance] = await Promise.all([
            cachedFetch(urlCarnetPilotes, { headers }, API_CACHE_TTL, forceRefresh),
            cachedFetch(urlCarnetPilotesTous, { headers }, API_CACHE_TTL, forceRefresh),
            cachedFetch(urlMaintenance, { headers }, API_CACHE_TTL, forceRefresh)
        ]);
        const [dataCarnetPilotes, dataCarnetPilotesTous, dataMaintenance] = await Promise.all([
            resCarnetPilotes.json(),
            resCarnetPilotesTous.json(),
            resMaintenance.json()
        ]);
        const carnetsPilotes = dataCarnetPilotes.records || [];
        const carnetsPilotesTous = dataCarnetPilotesTous.records || [];
        const maintenancesJour = dataMaintenance.records || [];
        rowsContainer.innerHTML = "";
        if (listeAvionsCache.length === 0) {
            rowsContainer.innerHTML = "<div class='loading'>Aucun aéronef trouvé.</div>";
            return;
        }
        populerSelectAvions(listeAvionsCache);
        const soleil = calculerSoleilLFOY(dateAffichee);
        const dayStart = new Date(dateAffichee.getFullYear(), dateAffichee.getMonth(), dateAffichee.getDate());
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        let hMin = Math.max(0, soleil.aubeAero - 1.5);
        let hMax = Math.min(24, soleil.crepusculeAero + 1.5);
        const toutesReservations = [...listeReservationsCache, ...volsVIP, ...creneauxVIMotor];
        let etendreFenetre = false;
        toutesReservations.forEach(vol => {
            if (!vol.fields) return;
            const debutRaw = vol.fields['Date de début'];
            const finRaw = vol.fields['Date de fin'];
            if (!debutRaw || !finRaw) return;
            const dateDebut = new Date(debutRaw);
            const dateFin = new Date(finRaw);
            const segmentDebut = new Date(Math.max(dateDebut.getTime(), dayStart.getTime()));
            const segmentFin = new Date(Math.min(dateFin.getTime(), dayEnd.getTime()));
            if (segmentFin <= segmentDebut) return;
            const heureDebut = segmentDebut.getHours() + (segmentDebut.getMinutes() / 60);
            let heureFin = segmentFin.getHours() + (segmentFin.getMinutes() / 60);
            if (segmentFin.getTime() >= dayEnd.getTime()) heureFin = 24;
            if (heureDebut < hMin || heureFin > hMax) etendreFenetre = true;
        });
        maintenancesJour.forEach(m => {
            const mf = m.fields || {};
            if (!mf['Date'] || isNaN(parseFloat(mf['durée']))) return;
            const mStart = new Date(mf['Date']);
            const mEnd = new Date(mStart.getTime() + parseFloat(mf['durée']) * 3600000);
            const segDebut = new Date(Math.max(mStart.getTime(), dayStart.getTime()));
            const segFin = new Date(Math.min(mEnd.getTime(), dayEnd.getTime()));
            if (segFin <= segDebut) return;
            const heureDebut = segDebut.getHours() + (segDebut.getMinutes() / 60);
            let heureFin = segFin.getHours() + (segFin.getMinutes() / 60);
            if (segFin.getTime() >= dayEnd.getTime()) heureFin = 24;
            if (heureDebut < hMin || heureFin > hMax) etendreFenetre = true;
        });
        if (etendreFenetre) { hMin = 0; hMax = 24; }
        if (hMax <= hMin) { hMin = 0; hMax = 24; }
        hMinPlanning = hMin;
        hMaxPlanning = hMax;
        genererFriseHeures(hMin, hMax);
        listeAvionsCache.forEach(avion => {
            if (!avion.fields) return;
            const avionId = avion.id;
            const avionNom = avion.fields['Immatriculation'] || avion.fields['Nom'] || 'Sans nom';
            const rowDiv = document.createElement('div');
            rowDiv.className = 'timeline-row';
            const dayStart = new Date(dateAffichee.getFullYear(), dateAffichee.getMonth(), dateAffichee.getDate());
            const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
            let volsAvion = listeReservationsCache.filter(res => {
                if (!res.fields) return false;
                const linkAvion = res.fields['Machine'] || [];
                const debutRaw = res.fields['Date de début'];
                const finRaw = res.fields['Date de fin'];
                if (!linkAvion.includes(avionId) || !debutRaw || !finRaw) return false;
                const dateVol = new Date(debutRaw);
                const dateFin = new Date(finRaw);
                return dateVol < dayEnd && dateFin > dayStart;
            });
            const creneauxMotorAvion = creneauxVIMotor.filter(c => (c.fields['Machine'] || []).includes(avionId));
            volsAvion = volsAvion.concat(creneauxMotorAvion);
            const immatBadge = avionNom.toString().trim().toUpperCase();
            const horaCarnet = (carnetsPilotesTous || []).reduce((max, c) => {
                const f = c.fields || {};
                if ((f['Machine'] || '').toString().trim().toUpperCase() !== immatBadge) return max;
                const h = parseFloat(String(f['Horamètre arrivée'] || '').replace(',', '.'));
                return !isNaN(h) && h > max ? h : max;
            }, 0);
            const horaStocke = parseFloat(String(avion.fields['Horamètre actuel'] || '0').replace(',', '.')) || 0;
            const tempsCarnetDepuisJour = (carnetsPilotesTous || []).reduce((sum, c) => {
                const f = c.fields || {};
                if ((f['Machine'] || '').toString().trim().toUpperCase() !== immatBadge) return sum;
                if (!f['Date'] || f['Date'] < debutJour) return sum;
                const t = parseTempsDeVol(f['Temps de vol']);
                return sum + (isNaN(t) ? 0 : t);
            }, 0);
            const buteeBadge = parseFloat(String(avion.fields['Prochaine Butée'] || '').replace(',', '.')) || 0;
            const potentielActuel = buteeBadge > 0
                ? buteeBadge - (Math.max(horaStocke, horaCarnet) - tempsCarnetDepuisJour)
                : (avion.fields['Potentiel restant'] !== undefined ? parseFloat(avion.fields['Potentiel restant']) || 0 : 0);
            let couleurStatus = "status-green";
            let textPotentiel = `Potentiel actuel : ${potentielActuel.toFixed(1)}h`;
            if (potentielActuel <= 0) {
                couleurStatus = "status-red";
                textPotentiel = `Potentiel épuisé / dépassement (${potentielActuel.toFixed(1)}h)`;
            } else if (potentielActuel <= 10) {
                couleurStatus = "status-orange";
                textPotentiel = `Alerte révision (${potentielActuel.toFixed(1)}h restantes)`;
            } else {
                couleurStatus = "status-green";
                textPotentiel = `Potentiel OK (${potentielActuel.toFixed(1)}h restantes)`;
            }
            const machineCell = document.createElement('div');
            machineCell.className = 'machine-cell';
            const badgeMaint = document.createElement('span');
            badgeMaint.className = `maintenance-status ${couleurStatus}`;
            badgeMaint.setAttribute('data-tooltip', textPotentiel);
            machineCell.appendChild(badgeMaint);
            machineCell.appendChild(document.createTextNode(avionNom));
            machineCell.style.cursor = 'pointer';
            machineCell.title = `Voir le suivi de ${avionNom}`;
            machineCell.addEventListener('click', (e) => {
                e.stopPropagation();
                const selMachine = document.getElementById('select-machine-suivi');
                if (selMachine) selMachine.value = avionId;
                const tabAero = document.getElementById('tab-aeronefs');
                if (tabAero) tabAero.click();
                if (selMachine && selMachine.value === avionId) selMachine.dispatchEvent(new Event('change', { bubbles: true }));
            });
            rowDiv.appendChild(machineCell);
            const gridBg = document.createElement('div');
            gridBg.className = 'hours-grid-background';
            gridBg.dataset.avionId = avionId;
            const aubeAeroPercent = (Math.max(0, soleil.aubeAero) / 24) * 100;
            const leverPercent = (Math.max(0, soleil.leverSoleil) / 24) * 100;
            const coucherPercent = (Math.min(24, soleil.coucherSoleil) / 24) * 100;
            const crepusculeAeroPercent = (Math.min(24, soleil.crepusculeAero) / 24) * 100;
            const divNuitMatin = document.createElement('div');
            divNuitMatin.className = 'night-zone night-aero';
            divNuitMatin.style.left = '0%';
            divNuitMatin.style.width = `${aubeAeroPercent}%`;
            gridBg.appendChild(divNuitMatin);
            const divAube = document.createElement('div');
            divAube.className = 'night-zone night-civil';
            divAube.style.left = `${aubeAeroPercent}%`;
            divAube.style.width = `${leverPercent - aubeAeroPercent}%`;
            gridBg.appendChild(divAube);
            const divCrepuscule = document.createElement('div');
            divCrepuscule.className = 'night-zone night-civil';
            divCrepuscule.style.left = `${coucherPercent}%`;
            divCrepuscule.style.width = `${crepusculeAeroPercent - coucherPercent}%`;
            gridBg.appendChild(divCrepuscule);
            const divNuitSoir = document.createElement('div');
            divNuitSoir.className = 'night-zone night-aero';
            divNuitSoir.style.left = `${crepusculeAeroPercent}%`;
            divNuitSoir.style.width = `${100 - crepusculeAeroPercent}%`;
            gridBg.appendChild(divNuitSoir);
            const gridCells = creerWrapperCellulesGrille(gridBg);
            for (let h = 0; h < 24; h++) {
                const gridBlock = document.createElement('div');
                gridBlock.className = 'grid-hour-block';
                gridBlock.style.flex = LARGEURS_HEURES[h];
                gridBlock.addEventListener('click', (e) => {
                    if (isResizing || isDraggingBar) {
                        e.stopPropagation();
                        return;
                    }
                    ouvrirModaleCreationDepuisGrille(avionId, h);
                });
                gridCells.appendChild(gridBlock);
            }
            const contentWrapper = document.createElement('div');
            contentWrapper.style.cssText = 'display: flex; flex-direction: column; flex: 1; position: relative; overflow: hidden;';
            appliquerEchelleGrid(gridBg, hMin, hMax);
            contentWrapper.appendChild(gridBg);
            rowDiv.appendChild(contentWrapper);
            const barresInfos = [];
            volsAvion.forEach(vol => {
                if (!vol.fields) return;
                const piloteNom = nomUtilisateurDepuisId(vol.fields['Pilote'], listeMembresCache);
                const piloteFormate = formaterNomPilote(piloteNom);
                const typeVol = vol.fields['Type de vol'] || 'Vol Classique';
                const debutRaw = vol.fields['Date de début'];
                const finRaw = vol.fields['Date de fin'];
                if (debutRaw && finRaw) {
                    const dateDebut = new Date(debutRaw);
                    const dateFin = new Date(finRaw);
                    const segmentDebut = new Date(Math.max(dateDebut.getTime(), dayStart.getTime()));
                    const segmentFin = new Date(Math.min(dateFin.getTime(), dayEnd.getTime()));
                    let heureDebut = segmentDebut.getHours() + (segmentDebut.getMinutes() / 60);
                    let heureFin = segmentFin.getHours() + (segmentFin.getMinutes() / 60);
                    if (segmentFin.getTime() >= dayEnd.getTime()) heureFin = 24;
                    let duree = heureFin - heureDebut;
                    if (duree > 0) {
                        const barresDiv = document.createElement('div');
                        barresDiv.className = 'reservation-bar';
                        barresDiv.style.left = `${positionHeure(heureDebut)}%`;
                        barresDiv.style.width = `${positionHeure(heureFin) - positionHeure(heureDebut)}%`;
                        barresDiv.style.boxSizing = 'border-box';
                        barresDiv.style.borderLeft = '5px solid #1e3d59';
                        barresDiv.style.borderTopLeftRadius = '4px';
                        barresDiv.style.borderBottomLeftRadius = '4px';
                        barresDiv.style.zIndex = '5';
                        if (duree <= 2) {
                            barresDiv.classList.add('short-reservation');
                        }
                        if (duree <= 1) {
                            barresDiv.classList.add('very-short-reservation');
                        }
                        const passagerNom = (vol.fields['Passager'] || '').toString().trim();
                        const instructeurNom = nomUtilisateurDepuisId(vol.fields['Instructeur'], listeMembresCache);
                        const typesVol = Array.isArray(typeVol) ? typeVol : [typeVol];
                        const isVIMoteur = typesVol.includes('VI Moteur');
                        const isAncienVI = typesVol.includes("Vol d'Initiation") || typesVol.includes("Vol d'Initiation (VI)");
                        const isCreneau = vol._table === 'VI Créneaux';
                        const isInstruction = typesVol.includes('Instruction');
                        const isRemorquage = typesVol.includes('Remorquage');
                        const estMoi = estUtilisateurCourant(piloteNom) || estUtilisateurCourant(instructeurNom);
                        if (estMoi) barresDiv.classList.add('ma-reservation');
                        if (isInstruction) barresDiv.classList.add('reservation-instruction');
                        if (isRemorquage) barresDiv.classList.add('reservation-remorquage');
                        let libelleEntete = piloteFormate || 'Pilote non défini';
                        if (instructeurNom) {
                            barresDiv.classList.add('reservation-avec-instructeur');
                            const trigramme = trouverTrigrammeInstructeur(instructeurNom);
                            if (trigramme) libelleEntete += ` — ${trigramme}`;
                        }
                        if (isVIMoteur || isAncienVI) {
                            if (!piloteNom || piloteNom.trim() === "") {
                                barresDiv.classList.add('vi-sans-pilote');
                                const suffix = passagerNom || 'dispo';
                                libelleEntete = isVIMoteur ? `🎯 VI Moteur — ${suffix}` : `🎯 VI — ${suffix}`;
                            } else {
                                barresDiv.classList.add('vi-avec-pilote');
                                libelleEntete = isVIMoteur ? `🎯 VI Moteur (${piloteFormate})` : `🎯 VI (${piloteFormate})`;
                            }
                        }
                        const debutStr = convertirHeureEnHHMM(heureDebut);
                        const finStr = convertirHeureEnHHMM(heureFin);
                        if (isCreneau) {
                            barresDiv.setAttribute('data-tooltip', (vol.fields['Commentaires VI'] || '') + (passagerNom ? '\nPassager : ' + passagerNom : ''));
                        } else {
                            barresDiv.setAttribute('data-tooltip', [
                                `Type : ${Array.isArray(typeVol) ? typeVol.join(', ') : typeVol}`,
                                `Pilote : ${piloteFormate || '—'}`,
                                `Passager : ${passagerNom || '—'}`,
                                `Instructeur : ${instructeurNom || '—'}`,
                                `Horaires : ${debutStr} - ${finStr}`
                            ].join('\n'));
                        }
                        barresDiv.removeAttribute('title');
                        barresDiv.innerHTML = `<strong>${libelleEntete}</strong>`;
                        if (!isCreneau) {
                            const handleLeft = document.createElement('div');
                            handleLeft.className = 'resize-handle resize-handle-left';
                            const handleRight = document.createElement('div');
                            handleRight.className = 'resize-handle resize-handle-right';
                            barresDiv.appendChild(handleLeft);
                            barresDiv.appendChild(handleRight);
                            handleLeft.addEventListener('pointerdown', (e) => {
                                e.stopPropagation();
                                initierResize(e, vol.id, gridBg, barresDiv, 'gauche', heureDebut, heureFin, null);
                            });
                            handleRight.addEventListener('pointerdown', (e) => {
                                e.stopPropagation();
                                initierResize(e, vol.id, gridBg, barresDiv, 'droite', heureDebut, heureFin, null);
                            });
                            barresDiv.addEventListener('pointerdown', (e) => {
                                if (e.target.classList.contains('resize-handle')) return;
                                e.stopPropagation();
                                initierDeplacementBarre(e, vol.id, avionId, gridBg, barresDiv, heureDebut, duree, null);
                            });
                            barresDiv.addEventListener('click', (e) => {
                                e.stopPropagation();
                                if (isResizing || isDraggingBar) return;
                                if (isVIMoteur || isAncienVI) {
                                    ouvrirActionsVI({
                                        source: 'moteur',
                                        id: vol.id,
                                        passager: passagerNom,
                                        pilote: piloteNom,
                                        telephone: vol.fields['Téléphone'] || '',
                                        debut: vol.fields['Date de début'],
                                        fin: vol.fields['Date de fin'],
                                        commentaire: vol.fields['Commentaires VI'] || '',
                                        machineName: (avion.fields['Immatriculation'] || '').toString().trim(),
                                        type: vol._typeVI || 'VI Moteur'
                                    });
                                    return;
                                }
                                ouvrirModaleEdition(vol, avionId);
                            });
                        } else {
                            barresDiv.style.cursor = 'pointer';
                            barresDiv.addEventListener('click', (e) => {
                                e.stopPropagation();
                                ouvrirActionsVI({
                                    source: 'creneau',
                                    id: vol.id,
                                    passager: passagerNom,
                                    pilote: vol.fields['Pilote'] || '',
                                    telephone: vol.fields['Téléphone'] || '',
                                    debut: vol.fields['Date de début'],
                                    fin: vol.fields['Date de fin'],
                                    commentaire: vol.fields['Commentaires VI'] || '',
                                    token: vol.fields['Token'] || '',
                                    type: vol._typeVI || 'VI Moteur'
                                });
                            });
                        }
                        barresDiv.addEventListener('mouseenter', () => { barresDiv.style.zIndex = '100'; });
                        barresDiv.addEventListener('mouseleave', () => { barresDiv.style.zIndex = '5'; });
                        gridBg.appendChild(barresDiv);
                        barresInfos.push({ bar: barresDiv, debut: heureDebut, fin: heureFin, vol });
                    }
                }
            });

            const avionImmat = (avion.fields['Immatriculation'] || '').toString().trim().toUpperCase();
            maintenancesJour.forEach(m => {
                const mf = m.fields || {};
                if (!mf['Date'] || isNaN(parseFloat(mf['durée']))) return;
                const mImmat = (mf['Machine'] || '').toString().trim().toUpperCase();
                if (mImmat !== avionImmat) return;
                const mStart = new Date(mf['Date']);
                const mEnd = new Date(mStart.getTime() + parseFloat(mf['durée']) * 3600000);
                const segDebut = new Date(Math.max(mStart.getTime(), dayStart.getTime()));
                const segFin = new Date(Math.min(mEnd.getTime(), dayEnd.getTime()));
                let hDebut = segDebut.getHours() + (segDebut.getMinutes() / 60);
                let hFin = segFin.getHours() + (segFin.getMinutes() / 60);
                if (segFin.getTime() >= dayEnd.getTime()) hFin = 24;
                const dureeM = hFin - hDebut;
                if (dureeM > 0) {
                    const maintDiv = document.createElement('div');
                    maintDiv.className = 'maintenance-bar';
                    maintDiv.style.left = `${positionHeure(hDebut)}%`;
                    maintDiv.style.width = `${positionHeure(hFin) - positionHeure(hDebut)}%`;
                    maintDiv.style.zIndex = '4';
                    maintDiv.style.pointerEvents = 'auto';
                    maintDiv.style.cursor = 'pointer';
                    maintDiv.title = `Maintenance ${mImmat} — ${hDebut.toFixed(2)}h à ${hFin.toFixed(2)}h`;
                    if (dureeM >= 1) maintDiv.textContent = 'Maintenance';

                    const handleLeftM = document.createElement('div');
                    handleLeftM.className = 'resize-handle resize-handle-left';
                    const handleRightM = document.createElement('div');
                    handleRightM.className = 'resize-handle resize-handle-right';
                    maintDiv.appendChild(handleLeftM);
                    maintDiv.appendChild(handleRightM);
                    handleLeftM.addEventListener('pointerdown', (e) => {
                        e.stopPropagation();
                        initierResize(e, m.id, gridBg, maintDiv, 'gauche', hDebut, hFin, dateAffichee, 'Maintenance', m);
                    });
                    handleRightM.addEventListener('pointerdown', (e) => {
                        e.stopPropagation();
                        initierResize(e, m.id, gridBg, maintDiv, 'droite', hDebut, hFin, dateAffichee, 'Maintenance', m);
                    });
                    maintDiv.addEventListener('pointerdown', (e) => {
                        if (e.target.classList.contains('resize-handle')) return;
                        e.stopPropagation();
                        initierDeplacementBarre(e, m.id, avionId, gridBg, maintDiv, hDebut, dureeM, dateAffichee, 'Maintenance', m);
                    });
                    maintDiv.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (isResizing || isDraggingBar) return;
                        if (typeof ouvrirModaleMaintenance === 'function') ouvrirModaleMaintenance(m);
                    });
                    gridBg.appendChild(maintDiv);
                }
            });

            if (typeof afficherConflitsReservations === 'function') afficherConflitsReservations(barresInfos);

            const immatAvion = avionImmat;
            if (immatAvion && carnetsPilotes.length > 0) {
                const volsCarnetJour = carnetsPilotes.filter(c => {
                    const f = c.fields || {};
                    return f['Machine'] && f['Machine'].toString().trim().toUpperCase() === immatAvion;
                }).sort((a, b) => String(a.fields['Heure départ'] || '').localeCompare(String(b.fields['Heure départ'] || '')));
                if (volsCarnetJour.length > 0) {
                    const carnetContainer = document.createElement('div');
                    carnetContainer.style.cssText = 'position: relative; height: 10px; margin-top: 4px; width: 100%;';
                    // Heures carnet : UTC pour les avions moteur, heure locale pour F-JVIO
                    const offsetHeures = immatAvion === 'F-JVIO' ? 0 : -dateAffichee.getTimezoneOffset() / 60;
                    volsCarnetJour.forEach(c => {
                        const f = c.fields || {};
                        const [hD, mD] = String(f['Heure départ'] || '').split(':').map(Number);
                        const [hA, mA] = String(f['Heure arrivée'] || '').split(':').map(Number);
                        if (isNaN(hD) || isNaN(mD)) return;
                        const heureDepartCarnet = hD + mD / 60;
                        let heureArriveeCarnet = heureDepartCarnet;
                        if (!isNaN(hA) && !isNaN(mA)) {
                            heureArriveeCarnet = hA + mA / 60;
                        } else {
                            const t = parseTempsDeVol(f['Temps de vol']);
                            heureArriveeCarnet = heureDepartCarnet + (isNaN(t) ? 0.5 : t);
                        }
                        const dureeCarnet = Math.max(heureArriveeCarnet - heureDepartCarnet, 0);
                        const heureDepartCarnetLocal = heureDepartCarnet + offsetHeures;
                        // carnetContainer est hors de gridBg (non etire) : l'echelle
                        // est la fenetre visible hMin-hMax, pas 0-24h.
                        const spanH = hMax - hMin;
                        const left = ((heureDepartCarnetLocal - hMin) / spanH) * 100;
                        const widthPct = Math.max((dureeCarnet / spanH) * 100, 1.0);
                        const item = document.createElement('div');
                        item.style.cssText = `
                            position: absolute; top: 0; height: 9px;
                            left: ${left}%;
                            width: ${widthPct}%;
                            background: #475569; color: white; border-radius: 3px;
                            font-size: 10px; font-weight: 500;
                            display: flex; align-items: center; padding: 0 4px;
                            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                            box-sizing: border-box;
                        `;
                        const pilote = nomUtilisateurDepuisId(f['Pilote'], listeMembresCache);
                        const piloteFormate = formaterNomPilote(pilote);
                        const hd = f['Heure départ'] || '';
                        const ha = f['Heure arrivée'] || '';
                        const tv = f['Temps de vol'] || '';
                        item.title = `${piloteFormate} : ${hd}-${ha} (${tv})`;
                        carnetContainer.appendChild(item);
                    });
                    contentWrapper.appendChild(carnetContainer);
                }
            }
            rowsContainer.appendChild(rowDiv);
        });
        if (autoActiverVIP && volsVIP.length > 0 && localStorage.getItem('planning_afficherVIP') === null) afficherVIPPlaneur = true;
        mettreAJourBoutonVIPPlaneur();
        afficherLigneVIPlaneur(volsVIP, rowsContainer, soleil, hMin, hMax);
        if (typeof afficherLignesInstructeurs === 'function') afficherLignesInstructeurs(rowsContainer, soleil, disposInstructeurs, [...listeReservationsCache, ...volsVIP, ...creneauxVIMotor], hMin, hMax);
        await chargerPresencesPlaneur();
        await chargerPresencesClub();
        actualiserLigneHeureCourante();
    } catch (error) {
        console.error(error);
        rowsContainer.innerHTML = "<div class='loading'>Erreur de chargement des données.</div>";
    }
}

function genererFriseHeures(hMin = 0, hMax = 24) {
    const container = document.getElementById('timeline-hours');
    if (!container) return;
    if (hMax <= hMin) { hMin = 0; hMax = 24; }
    const echelle = 24 / (hMax - hMin);
    const margeGauche = -(hMin / (hMax - hMin)) * 100;
    container.innerHTML = "";
    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    container.style.display = 'block';
    container.style.width = '100%';
    container.style.height = '100%';
    const grille = document.createElement('div');
    grille.style.cssText = `display:flex; position:relative; width:${echelle * 100}%; height:100%; margin-left:${margeGauche}%;`;
    for (let h = 0; h < 24; h++) {
        const heureStr = h + 'h';
        const div = document.createElement('div');
        div.className = 'hour-cell-header';
        div.style.flex = '1';
        div.innerHTML = `<span>${heureStr}</span>`;
        grille.appendChild(div);
    }
    container.appendChild(grille);
}

function mettreAJourDateAffichee() {
    const elementDate = document.getElementById('current-date');
    if (elementDate) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = dateAffichee.toLocaleDateString('fr-FR', options);
        elementDate.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    }
    const elementDateSuivi = document.getElementById('current-date-suivi');
    if (elementDateSuivi) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = dateAffichee.toLocaleDateString('fr-FR', options);
        elementDateSuivi.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    }
}

function populerSelectAvions(avions) {
    const select = document.getElementById('form-machine');
    const selectSuivi = document.getElementById('select-machine-suivi');
    if (select) {
        select.innerHTML = "";
        avions.forEach(avion => {
            const option = document.createElement('option');
            option.value = avion.id;
            option.textContent = avion.fields['Immatriculation'] || avion.fields['Nom'] || 'Sans nom';
            select.appendChild(option);
        });
    }
    if (selectSuivi && selectSuivi.children.length === 0) {
        selectSuivi.innerHTML = "";
        avions.forEach(avion => {
            const option = document.createElement('option');
            option.value = avion.id;
            option.textContent = avion.fields['Immatriculation'] || avion.fields['Nom'] || 'Sans nom';
            selectSuivi.appendChild(option);
        });
        // Restaure la derniere machine consultee sur la page Aeronefs
        try {
            const derniereMachine = localStorage.getItem('aeronef-derniere-machine');
            if (derniereMachine && Array.from(selectSuivi.options).some(o => o.value === derniereMachine)) {
                selectSuivi.value = derniereMachine;
            }
        } catch (e) {}
        selectSuivi.addEventListener('change', () => {
            try { localStorage.setItem('aeronef-derniere-machine', selectSuivi.value); } catch (e) {}
            chargerSuiviAeronef();
        });
    }
}

function peutBougerReservations(record = null, tableName = 'Réservations') {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    const roles = currentUser.roles || [];
    const norm = r => (r || '').toString().toLowerCase().trim();
    if (roles.some(r => ['super admin', 'instructeur avion', 'instructeur ulm'].includes(norm(r)))) return true;
    // Un instructeur planeur ne gère que les vols planeur : pas de modification
    // des réservations avion/ULM des autres (ses propres vols passent par
    // estProprietaireReservation).
    if (roles.some(r => norm(r) === 'instructeur planeur')) {
        return tableName === 'VI Planeur';
    }
    return false;
}

function estProprietaireReservation(record) {
    if (typeof currentUser === 'undefined' || !currentUser || !record || !record.fields) return false;
    const piloteRecord = record.fields['Pilote'];
    const piloteIds = Array.isArray(piloteRecord) ? piloteRecord : (piloteRecord ? [piloteRecord] : []);
    if (currentUser.id && piloteIds.some(id => id === currentUser.id)) return true;
    const pilote = piloteIds.join(' ').toString().trim();
    const moi = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    return (typeof correspondanceNom === 'function' && correspondanceNom(pilote, moi))
        || (typeof correspondanceNom === 'function' && correspondanceNom(nomPiloteCourant(), pilote))
        || pilote.trim().toLowerCase() === nomPiloteCourant().toLowerCase();
}

async function peuplerPiloteSelect(piloteSelectionne = null) {
    const sel = document.getElementById('form-pilote');
    const group = document.getElementById('group-pilote');
    if (!sel || !group) return;
    const typesVolSel = typeof getTypeVolSelectionne === 'function' ? getTypeVolSelectionne() : [];
    const piloteLimiteVI = typesVolSel.includes('VI Planeur') || typesVolSel.includes('VI Moteur');
    sel.dataset.allowCustom = piloteLimiteVI ? '0' : '1';
    const roles = (typeof currentUser !== 'undefined' && currentUser ? currentUser.roles || [] : []);
    const autorise = (typeof isSuperAdmin === 'function' && isSuperAdmin()) ||
        roles.some(r => ['Instructeur avion', 'Instructeur planeur', 'Instructeur ULM'].includes(r));
    const monId = (currentUser || {}).id || '';
    const monNom = `${(currentUser || {}).prenom || ''} ${(currentUser || {}).nom || ''}`.trim() || 'Moi';
    if (!autorise) {
        sel.innerHTML = `<option value="${escapeHtml(monId)}">${escapeHtml(monNom)}</option>`;
        sel.value = monId;
        group.style.display = 'none';
        return;
    }
    try {
        if (!listeMembresCache.length) {
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS)}?sort[0][field]=Nom&sort[0][direction]=asc&pageSize=100`, { headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || 'Erreur');
            listeMembresCache = data.records || [];
        }
        sel.innerHTML = `<option value="">${piloteLimiteVI ? '-- Choisir un pilote VI --' : '-- Choisir un pilote --'}</option>`;
        listeMembresCache.forEach(r => {
            const f = r.fields || {};
            if (piloteLimiteVI) {
                const rolesMembre = Array.isArray(f['Rôles']) ? f['Rôles'] : [f['Rôles']].filter(Boolean);
                if (!rolesMembre.includes('Pilote VI')) return;
                let typeVI = null;
                if (typesVolSel.includes('VI Planeur')) {
                    typeVI = 'VIP';
                } else if (typesVolSel.includes('VI Moteur')) {
                    const cbMachine = document.querySelector('input[name="form-machine"]:checked');
                    const avionSel = (listeAvionsCache || []).find(a => a.id === (cbMachine && cbMachine.value));
                    const immatSel = ((avionSel && avionSel.fields && (avionSel.fields['Immatriculation'] || avionSel.fields['Nom'])) || '').toString().trim();
                    typeVI = immatSel === 'F-JVIO' ? 'VIULM' : (immatSel === 'F-GASB' ? 'VIA' : null);
                }
                if (!piloteAutoriseSurTypeVI(rolesMembre, typeVI)) return;
            }
            const nomComplet = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim() || 'Membre';
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.textContent = nomComplet;
            if (piloteSelectionne && (r.id === piloteSelectionne || nomComplet === piloteSelectionne)) opt.selected = true;
            else if (!piloteSelectionne && r.id === monId) opt.selected = true;
            sel.appendChild(opt);
        });
        let valeurChoisie = piloteLimiteVI ? '' : monId;
        if (piloteSelectionne) {
            const existe = [...sel.options].some(o => o.value === piloteSelectionne || o.textContent.trim() === piloteSelectionne);
            if (!existe && !piloteLimiteVI) {
                const optLibre = document.createElement('option');
                optLibre.value = piloteSelectionne;
                optLibre.textContent = piloteSelectionne;
                optLibre.selected = true;
                sel.appendChild(optLibre);
            }
            if (existe || !piloteLimiteVI) valeurChoisie = piloteSelectionne;
        }
        sel.value = valeurChoisie;
        group.style.display = 'flex';
    } catch (err) {
        console.error('Erreur chargement membres:', err);
        sel.innerHTML = `<option value="${escapeHtml(monId)}">${escapeHtml(monNom)}</option>`;
        sel.value = monId;
        group.style.display = 'none';
    }
}

async function chargerListeMembresCache(force = false) {
    if (!force && listeMembresCache.length) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS)}?sort[0][field]=Nom&sort[0][direction]=asc&pageSize=100`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        listeMembresCache = data.records || [];
    } catch (err) {
        console.error('Erreur chargement membres:', err);
    }
}

function nomUtilisateurDepuisId(field, cache = []) {
    if (!field) return '';
    const ids = Array.isArray(field) ? field : [field];
    const id = ids[0];
    if (typeof id !== 'string' || !id.startsWith('rec')) return String(id).trim();
    const membre = cache.find(r => r.id === id);
    if (membre) {
        const f = membre.fields || {};
        return `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim() || String(id);
    }
    return String(id).trim();
}

function actualiserLigneHeureCourante() {
    const rows = document.getElementById('timeline-rows');
    if (!rows) return;
    if (typeof dateAffichee === 'undefined' || !dateAffichee) return;
    const now = new Date();
    const isToday = now.getFullYear() === dateAffichee.getFullYear() &&
        now.getMonth() === dateAffichee.getMonth() &&
        now.getDate() === dateAffichee.getDate();
    let line = document.getElementById('ligne-heure-courante');
    if (!line) {
        line = document.createElement('div');
        line.id = 'ligne-heure-courante';
        line.style.cssText = 'position:absolute;top:0;bottom:0;width:1px;background:#ef4444;z-index:1000;pointer-events:none;display:none;';
        rows.appendChild(line);
    }
    if (!isToday) {
        line.style.display = 'none';
        return;
    }
    if (rows.style.position !== 'relative' && getComputedStyle(rows).position !== 'relative') {
        rows.style.position = 'relative';
    }
    const heureDec = now.getHours() + (now.getMinutes() / 60);
    const hMin = (typeof hMinPlanning === 'number') ? hMinPlanning : 0;
    const hMax = (typeof hMaxPlanning === 'number') ? hMaxPlanning : 24;
    if (heureDec < hMin || heureDec > hMax) {
        line.style.display = 'none';
        return;
    }
    const pourcentage = ((heureDec - hMin) / (hMax - hMin)) * 100;
    line.style.display = 'block';
    line.style.left = `calc(90px + (100% - 90px) * ${pourcentage / 100})`;
}

function initierDeplacementBarre(e, volId, avionId, gridBg, barresDiv, heureDebutInitiale, dureeVol, callbackMiseAJour, tableName = 'Réservations', record = null) {
    e.preventDefault();
    const resa = record || (listeReservationsCache || []).find(r => r.id === volId);
    if (tableName !== 'Maintenance' && !peutBougerReservations(resa, tableName) && !estProprietaireReservation(resa)) return;
    let aBouge = false;
    let ghost = null;
    let avionIdCible = avionId;
    let gridCible = gridBg;
    let dateJourCible = null;
    const rectGrid = gridBg.getBoundingClientRect();
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.mozUserSelect = 'none';
    barresDiv.style.opacity = '0.4';
    function onMouseMove(evt) {
        if (!aBouge) {
            aBouge = true;
            isDraggingBar = true;
            ghost = document.createElement('div');
            ghost.className = 'drag-ghost-preview';
            ghost.style.width = `${positionHeure(heureDebutInitiale + dureeVol) - positionHeure(heureDebutInitiale)}%`;
            ghost.style.left = `${positionHeure(heureDebutInitiale)}%`;
            const hDebutStr = convertirHeureEnHHMM(heureDebutInitiale);
            const hFinStr = convertirHeureEnHHMM(heureDebutInitiale + dureeVol);
            ghost.innerHTML = `<span>${hDebutStr} - ${hFinStr}</span>`;
            gridBg.appendChild(ghost);
        }
        const xPos = evt.clientX - rectGrid.left;
        let pourcentageX = Math.max(0, Math.min(1, xPos / rectGrid.width));
        let nouvelleHeureDebut = positionHeureInverse(pourcentageX * 100);
        nouvelleHeureDebut = Math.round(nouvelleHeureDebut * 4) / 4;
        if (nouvelleHeureDebut + dureeVol > 24) {
            nouvelleHeureDebut = 24 - dureeVol;
        }
        if (tableName === 'Réservations') {
            const el = document.elementFromPoint(evt.clientX, evt.clientY);
            const row = el && el.closest ? el.closest('.timeline-row') : null;
            const grid = row ? row.querySelector('.hours-grid-background') : null;
            if (grid && grid.dataset.avionId) {
                avionIdCible = grid.dataset.avionId;
                gridCible = grid;
                if (ghost && ghost.parentNode !== grid) grid.appendChild(ghost);
            }
        } else if (tableName === 'Maintenance') {
            const tbody = gridBg.closest('tbody');
            if (tbody) {
                for (const tr of tbody.querySelectorAll('tr')) {
                    const td = tr.children[1];
                    const g = td ? td.firstElementChild : null;
                    if (!g) continue;
                    const r = g.getBoundingClientRect();
                    if (evt.clientY >= r.top && evt.clientY <= r.bottom) {
                        gridCible = g;
                        const txt = (tr.children[0] && tr.children[0].textContent || '').trim();
                        const mDate = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                        dateJourCible = mDate ? `${mDate[3]}-${mDate[2]}-${mDate[1]}` : (g.dataset.dateJour || null);
                        if (ghost && ghost.parentNode !== g) g.appendChild(ghost);
                        break;
                    }
                }
            }
        }
        ghost.style.left = `${positionHeure(nouvelleHeureDebut)}%`;
        const hDebutStr = convertirHeureEnHHMM(nouvelleHeureDebut);
        const hFinStr = convertirHeureEnHHMM(nouvelleHeureDebut + dureeVol);
        ghost.innerHTML = `<span>${hDebutStr} - ${hFinStr}</span>`;
    }
    function onMouseUp(evt) {
        window.removeEventListener('pointermove', onMouseMove);
        window.removeEventListener('pointerup', onMouseUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        barresDiv.style.opacity = '1';
        if (aBouge) {
            if (tableName === 'Maintenance') {
                const tbody = gridBg.closest('tbody');
                if (tbody) {
                    for (const tr of tbody.querySelectorAll('tr')) {
                        const td = tr.children[1];
                        const g = td ? td.firstElementChild : null;
                        if (!g) continue;
                        const r = g.getBoundingClientRect();
                        if (evt.clientY >= r.top && evt.clientY <= r.bottom) {
                            gridCible = g;
                            const txt = (tr.children[0] && tr.children[0].textContent || '').trim();
                            const mDate = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                            dateJourCible = mDate ? `${mDate[3]}-${mDate[2]}-${mDate[1]}` : (g.dataset.dateJour || null);
                            break;
                        }
                    }
                }
            }
            if (ghost) ghost.remove();
            const xPosFinal = evt.clientX - rectGrid.left;
            let pourcentageFin = Math.max(0, Math.min(1, xPosFinal / rectGrid.width));
            let heureFinale = Math.round(positionHeureInverse(pourcentageFin * 100) * 4) / 4;
            if (heureFinale + dureeVol > 24) heureFinale = 24 - dureeVol;
            const jourChangeMove = tableName === 'Maintenance' && gridCible && gridCible !== gridBg;
            if (!jourChangeMove) {
                barresDiv.style.left = `${positionHeure(heureFinale)}%`;
                barresDiv.style.width = `${positionHeure(heureFinale + dureeVol) - positionHeure(heureFinale)}%`;
                if (avionIdCible && avionIdCible !== avionId && gridCible && gridCible !== gridBg) {
                    gridCible.appendChild(barresDiv);
                }
            }
            const dateCibleFinale = (tableName === 'Maintenance' && dateJourCible) ? new Date(`${dateJourCible}T12:00:00`) : callbackMiseAJour;
            if (typeof sauvegarderDeplacementVol === 'function') {
                afficherChargementGlobal();
                sauvegarderDeplacementVol(volId, avionId, heureFinale, dureeVol, tableName, record, dateCibleFinale, avionIdCible).catch(err => {
                    console.error(err);
                    chargerDonneesPlanning(true, true, true);
                }).finally(() => masquerChargementGlobal());
            }
        }
        setTimeout(() => {
            isDraggingBar = false;
            document.body.style.userSelect = '';
            document.body.style.webkitUserSelect = '';
            document.body.style.mozUserSelect = '';
        }, 100);
    }
    // Geste tactile annule par le navigateur (appel entrant, scroll…) :
    // on nettoie sans sauvegarder le deplacement.
    function onPointerCancel() {
        window.removeEventListener('pointermove', onMouseMove);
        window.removeEventListener('pointerup', onMouseUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        if (ghost) ghost.remove();
        barresDiv.style.opacity = '1';
        isDraggingBar = false;
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        document.body.style.mozUserSelect = '';
    }
    window.addEventListener('pointermove', onMouseMove);
    window.addEventListener('pointerup', onMouseUp);
    window.addEventListener('pointercancel', onPointerCancel);
}

function initierResize(e, reservationId, parentGrid, barElement, bord, hDebutInitiale, hFinInitiale, dateCibleVol, tableName = 'Réservations', record = null) {
    e.preventDefault();
    const resa = record || (listeReservationsCache || []).find(r => r.id === reservationId);
    if (tableName !== 'Maintenance' && !peutBougerReservations(resa, tableName) && !estProprietaireReservation(resa)) return;
    isResizing = true;
    barElement.style.opacity = '0.3';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.mozUserSelect = 'none';
    const rectGrid = parentGrid.getBoundingClientRect();
    const ghostBar = document.createElement('div');
    ghostBar.className = 'ghost-bar-preview';
    ghostBar.innerHTML = `<span style="font-size:11px; font-weight:bold; color:#1e3d59; display:block; text-align:center; margin-top:15px;"></span>`;
    ghostBar.style.left = `${positionHeure(hDebutInitiale)}%`;
    ghostBar.style.width = `${positionHeure(hFinInitiale) - positionHeure(hDebutInitiale)}%`;
    parentGrid.appendChild(ghostBar);
    let hDebFinale = hDebutInitiale;
    let hFinFinale = hFinInitiale;
    let dateJourCible = null;
    let gridResizeCible = parentGrid;
    const dateOrigineStr = dateCibleVol ? `${dateCibleVol.getFullYear()}-${String(dateCibleVol.getMonth() + 1).padStart(2, '0')}-${String(dateCibleVol.getDate()).padStart(2, '0')}` : null;
    const mStartRef = (tableName === 'Maintenance' && record && record.fields) ? new Date(record.fields['Date']) : null;
    const mEndRef = mStartRef ? new Date(mStartRef.getTime() + parseFloat(record.fields['durée'] || 0) * 3600000) : null;
    const ghostsMulti = [];
    function majGhostsMulti() {
        while (ghostsMulti.length) { const g = ghostsMulti.pop(); if (g.parentNode) g.parentNode.removeChild(g); }
        const tbody = parentGrid.closest('tbody');
        if (!mStartRef || !mEndRef || !tbody) return false;
        let effStart, effEnd;
        if (dateJourCible) {
            const [cy, cm, cd] = dateJourCible.split('-').map(Number);
            const jourCible = new Date(cy, cm - 1, cd);
            effStart = bord === 'gauche' ? new Date(jourCible.getTime() + hDebFinale * 3600000) : mStartRef;
            effEnd = bord === 'droite' ? new Date(jourCible.getTime() + hFinFinale * 3600000) : mEndRef;
        } else {
            effStart = mStartRef;
            effEnd = mEndRef;
        }
        if (!(effEnd > effStart)) return true;
        const startDay = new Date(effStart.getFullYear(), effStart.getMonth(), effStart.getDate());
        const endDay = new Date(effEnd.getFullYear(), effEnd.getMonth(), effEnd.getDate());
        for (const tr of tbody.querySelectorAll('tr')) {
            const td = tr.children[1];
            const g = td ? td.firstElementChild : null;
            if (!g) continue;
            const txt = (tr.children[0] && tr.children[0].textContent || '').trim();
            const mDate = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            const dStr = mDate ? `${mDate[3]}-${mDate[2]}-${mDate[1]}` : (g.dataset.dateJour || null);
            if (!dStr) continue;
            const [ry, rm, rd] = dStr.split('-').map(Number);
            const rowDay = new Date(ry, rm - 1, rd);
            if (rowDay < startDay || rowDay > endDay) continue;
            const segStart = rowDay.getTime() === startDay.getTime() ? (effStart - startDay) / 3600000 : 0;
            const segEnd = rowDay.getTime() === endDay.getTime() ? Math.min(24, (effEnd - endDay) / 3600000) : 24;
            if (segEnd <= 0) continue;
            const gb = document.createElement('div');
            gb.className = 'ghost-bar-preview';
            gb.innerHTML = `<span style="font-size:11px; font-weight:bold; color:#1e3d59; display:block; text-align:center; margin-top:15px;"></span>`;
            gb.style.left = `${positionHeure(segStart)}%`;
            gb.style.width = `${positionHeure(segEnd) - positionHeure(segStart)}%`;
            gb.querySelector('span').textContent = `${minutesToTimeString(segStart * 60)} - ${minutesToTimeString(segEnd * 60)}`;
            g.appendChild(gb);
            ghostsMulti.push(gb);
        }
        return ghostsMulti.length > 0;
    }
    function onMouseMove(moveEvent) {
        const xRelatif = moveEvent.clientX - rectGrid.left;
        let pourcentage = xRelatif / rectGrid.width;
        pourcentage = Math.max(0, Math.min(1, pourcentage));
        let heureCalculee = Math.round(positionHeureInverse(pourcentage * 100) * 4) / 4;
        if (bord === 'gauche') {
            if (heureCalculee >= hFinInitiale) heureCalculee = hFinInitiale - 0.25;
            hDebFinale = heureCalculee;
        } else {
            if (heureCalculee <= hDebutInitiale) heureCalculee = hDebutInitiale + 0.25;
            hFinFinale = heureCalculee;
        }
        if (tableName === 'Maintenance') {
            const tbody = parentGrid.closest('tbody');
            if (tbody) {
                for (const tr of tbody.querySelectorAll('tr')) {
                    const td = tr.children[1];
                    const g = td ? td.firstElementChild : null;
                    if (!g) continue;
                    const r = g.getBoundingClientRect();
                    if (moveEvent.clientY >= r.top && moveEvent.clientY <= r.bottom) {
                        gridResizeCible = g;
                        const txt = (tr.children[0] && tr.children[0].textContent || '').trim();
                        const mDate = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                        dateJourCible = mDate ? `${mDate[3]}-${mDate[2]}-${mDate[1]}` : (g.dataset.dateJour || null);
                        break;
                    }
                }
            }
            if (majGhostsMulti()) { ghostBar.style.display = 'none'; return; }
        }
        ghostBar.style.display = '';
        ghostBar.style.left = `${positionHeure(hDebFinale)}%`;
        ghostBar.style.width = `${positionHeure(hFinFinale) - positionHeure(hDebFinale)}%`;
        const txtStart = minutesToTimeString(hDebFinale * 60);
        const txtEnd = minutesToTimeString(hFinFinale * 60);
        ghostBar.querySelector('span').textContent = `${txtStart} - ${txtEnd}`;
    }
    async function onMouseUp() {
        document.removeEventListener('pointermove', onMouseMove);
        document.removeEventListener('pointerup', onMouseUp);
        document.removeEventListener('pointercancel', onPointerCancel);
        barElement.style.opacity = '1';
        if (ghostBar.parentNode) ghostBar.parentNode.removeChild(ghostBar);
        while (ghostsMulti.length) { const g = ghostsMulti.pop(); if (g.parentNode) g.parentNode.removeChild(g); }
        const jourChange = tableName === 'Maintenance' && dateJourCible && dateJourCible !== dateOrigineStr;
        if (hDebFinale !== hDebutInitiale || hFinFinale !== hFinInitiale || jourChange) {
            if (!jourChange) {
                barElement.style.left = `${positionHeure(hDebFinale)}%`;
                barElement.style.width = `${positionHeure(hFinFinale) - positionHeure(hDebFinale)}%`;
            }
            afficherChargementGlobal();
            appliquerChangementDuree(reservationId, hDebFinale, hFinFinale, dateCibleVol, tableName, record, bord, jourChange ? dateJourCible : null).catch(err => {
                console.error(err);
                chargerDonneesPlanning(true, true, true);
            }).finally(() => masquerChargementGlobal());
        }
        setTimeout(() => {
            isResizing = false;
            document.body.style.userSelect = '';
            document.body.style.webkitUserSelect = '';
            document.body.style.mozUserSelect = '';
        }, 100);
    }
    function onPointerCancel() {
        document.removeEventListener('pointermove', onMouseMove);
        document.removeEventListener('pointerup', onMouseUp);
        document.removeEventListener('pointercancel', onPointerCancel);
        barElement.style.opacity = '1';
        if (ghostBar.parentNode) ghostBar.parentNode.removeChild(ghostBar);
        while (ghostsMulti.length) { const g = ghostsMulti.pop(); if (g.parentNode) g.parentNode.removeChild(g); }
        isResizing = false;
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        document.body.style.mozUserSelect = '';
    }
    document.addEventListener('pointermove', onMouseMove);
    document.addEventListener('pointerup', onMouseUp);
    document.addEventListener('pointercancel', onPointerCancel);
}

async function appliquerChangementDuree(reservationId, hDeb, hFin, dateCible, tableName = 'Réservations', record = null, bord = null, dateJourCible = null) {
    const referenceDate = dateCible ? new Date(dateCible) : dateAffichee;
    const annee = referenceDate.getFullYear();
    const mois = referenceDate.getMonth();
    const jour = referenceDate.getDate();
    const dateDebut = new Date(annee, mois, jour, Math.floor(hDeb), (hDeb % 1) * 60, 0);
    const dateFin = new Date(annee, mois, jour, Math.floor(hFin), (hFin % 1) * 60, 0);
    const isMaintenance = tableName === 'Maintenance';
    let fieldsPatch;
    let dateDebutOut = dateDebut;
    let dateFinOut = dateFin;
    if (isMaintenance && record && dateJourCible) {
        const mStart = new Date(record.fields['Date']);
        const mEnd = new Date(mStart.getTime() + parseFloat(record.fields['durée']) * 3600000);
        const [y, mo, d] = dateJourCible.split('-').map(Number);
        const jourCible = new Date(y, mo - 1, d);
        const newStart = bord === 'gauche' ? new Date(jourCible.getTime() + hDeb * 3600000) : mStart;
        const newEnd = bord === 'droite' ? new Date(jourCible.getTime() + hFin * 3600000) : mEnd;
        if (!(newEnd > newStart)) return;
        fieldsPatch = { "Date": newStart.toISOString(), "durée": (newEnd - newStart) / 3600000 };
        dateDebutOut = newStart;
        dateFinOut = newEnd;
    } else if (isMaintenance && record) {
        const mStart = new Date(record.fields['Date']);
        const mEnd = new Date(mStart.getTime() + parseFloat(record.fields['durée']) * 3600000);
        const startOfDay = new Date(annee, mois, jour, 0, 0, 0);
        const hDebInit = Math.max(0, Math.min(24, (mStart.getTime() - startOfDay.getTime()) / 3600000));
        const hFinInit = Math.max(0, Math.min(24, (mEnd.getTime() - startOfDay.getTime()) / 3600000));
        const changedDeb = Math.abs(hDeb - hDebInit) > 0.001;
        const changedFin = Math.abs(hFin - hFinInit) > 0.001;
        const newStart = changedDeb ? new Date(startOfDay.getTime() + hDeb * 3600000) : mStart;
        const newEnd = changedFin ? new Date(startOfDay.getTime() + hFin * 3600000) : mEnd;
        fieldsPatch = { "Date": newStart.toISOString(), "durée": (newEnd - newStart) / 3600000 };
        dateDebutOut = newStart;
        dateFinOut = newEnd;
    } else if (isMaintenance) {
        fieldsPatch = { "Date": dateDebut.toISOString(), "durée": (dateFin - dateDebut) / 3600000 };
    } else {
        fieldsPatch = { "Date de début": dateDebut.toISOString(), "Date de fin": dateFin.toISOString() };
    }
    try {
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent(tableName)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id: reservationId, fields: fieldsPatch }] })
        });
        if (response.ok) {
            const resData = await response.json();
            const resaId = resData.records?.[0]?.id || reservationId || '';
            const resa = (listeReservationsCache || []).find(r => r.id === reservationId);
            const pilote = nomUtilisateurDepuisId(resa?.fields?.['Pilote'], listeMembresCache);
            const machine = Array.isArray(resa?.fields?.['Machine']) ? resa.fields['Machine'][0] : (resa?.fields?.['Machine'] || tableName);
            const avion = (listeAvionsCache || []).find(a => a.id === machine);
            const machineNom = (avion && avion.fields && (avion.fields['Immatriculation'] || avion.fields['Nom'])) || machine;
            const ancienDebut = resa?.fields?.['Date de début'] || '';
            const ancienFin = resa?.fields?.['Date de fin'] || '';
            if (typeof enregistrerAudit === 'function') {
                const message = `Nouveau : ${dateDebutOut.toISOString().slice(0,16).replace('T',' ')} - ${dateFinOut.toISOString().slice(0,16).replace('T',' ')}`;
                if (isMaintenance) {
                    enregistrerAudit('Modification maintenance (durée)', tableName, message, 'Maintenance').catch(err => console.error('Audit:', err));
                } else {
                    enregistrerAudit('Modification de réservation (durée)', machineNom, `Pilote : ${pilote} | Début initial : ${ancienDebut.slice(0,16).replace('T',' ')} | Fin initiale : ${ancienFin.slice(0,16).replace('T',' ')} | ${message}`, 'Planning').catch(err => console.error('Audit:', err));
                }
            }
            const viewAeronefs = document.getElementById('view-aeronefs');
            if (viewAeronefs && viewAeronefs.style.display !== 'none' && typeof chargerSuiviAeronef === 'function') {
                chargerDonneesPlanning(true, true, true).catch(() => {});
                await chargerSuiviAeronef();
            } else {
                await chargerDonneesPlanning(true, true, true);
            }
        } else {
            const data = await response.json().catch(() => ({}));
            console.error('Échec modification durée:', response.status, data.error?.message || data);
        }
    } catch (error) {
        console.error(error);
    }
}

async function sauvegarderDeplacementVol(volId, avionId, nouvelleHeureDebut, dureeVol, tableName = 'Réservations', record = null, dateCible = null, nouvelAvionId = null) {
    const ref = dateCible ? new Date(dateCible) : dateAffichee;
    const annee = ref.getFullYear();
    const mois = ref.getMonth();
    const jour = ref.getDate();
    const hInteger = Math.floor(nouvelleHeureDebut);
    const mInteger = Math.round((nouvelleHeureDebut % 1) * 60);
    const nouvelleDateDebut = new Date(annee, mois, jour, hInteger, mInteger, 0);
    const nouvelleDateFin = new Date(nouvelleDateDebut.getTime() + (dureeVol * 60 * 60 * 1000));
    const isMaintenance = tableName === 'Maintenance';
    let fieldsPatch;
    let dateDebutOut = nouvelleDateDebut;
    let dateFinOut = nouvelleDateFin;
    if (isMaintenance && record) {
        const mStart = new Date(record.fields['Date']);
        const mEnd = new Date(mStart.getTime() + parseFloat(record.fields['durée']) * 3600000);
        const dureeMs = mEnd - mStart;
        const startOfDayCible = new Date(annee, mois, jour, 0, 0, 0);
        const newStart = new Date(startOfDayCible.getTime() + nouvelleHeureDebut * 3600000);
        const newEnd = new Date(newStart.getTime() + dureeMs);
        fieldsPatch = { "Date": newStart.toISOString(), "durée": (newEnd - newStart) / 3600000 };
        dateDebutOut = newStart;
        dateFinOut = newEnd;
    } else if (isMaintenance) {
        fieldsPatch = { "Date": nouvelleDateDebut.toISOString(), "durée": dureeVol };
    } else {
        fieldsPatch = { "Date de début": nouvelleDateDebut.toISOString(), "Date de fin": nouvelleDateFin.toISOString() };
        if (nouvelAvionId && nouvelAvionId !== avionId) fieldsPatch['Machine'] = [nouvelAvionId];
    }
    try {
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent(tableName)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id: volId, fields: fieldsPatch }] })
        });
        if (response.ok) {
            const resData = await response.json();
            const resaId = resData.records?.[0]?.id || volId || '';
            const resa = (listeReservationsCache || []).find(r => r.id === volId);
            const pilote = nomUtilisateurDepuisId(resa?.fields?.['Pilote'], listeMembresCache);
            const machine = nouvelAvionId || (Array.isArray(resa?.fields?.['Machine']) ? resa.fields['Machine'][0] : (resa?.fields?.['Machine'] || avionId));
            const avion = (listeAvionsCache || []).find(a => a.id === machine);
            const machineNom = (avion && avion.fields && (avion.fields['Immatriculation'] || avion.fields['Nom'])) || machine;
            const ancienDebut = resa?.fields?.['Date de début'] || '';
            const ancienFin = resa?.fields?.['Date de fin'] || '';
            if (typeof enregistrerAudit === 'function') {
                const message = `Nouveau : ${dateDebutOut.toISOString().slice(0,16).replace('T',' ')} - ${dateFinOut.toISOString().slice(0,16).replace('T',' ')}`;
                if (isMaintenance) {
                    enregistrerAudit('Modification maintenance (déplacement)', tableName, message, 'Maintenance').catch(err => console.error('Audit:', err));
                } else {
                    enregistrerAudit('Modification de réservation (déplacement)', machineNom, `Pilote : ${pilote} | Début initial : ${ancienDebut.slice(0,16).replace('T',' ')} | Fin initiale : ${ancienFin.slice(0,16).replace('T',' ')} | ${message}`, 'Planning').catch(err => console.error('Audit:', err));
                }
            }
            const viewAeronefs = document.getElementById('view-aeronefs');
            if (viewAeronefs && viewAeronefs.style.display !== 'none' && typeof chargerSuiviAeronef === 'function') {
                chargerDonneesPlanning(true, true, true).catch(() => {});
                await chargerSuiviAeronef();
            } else {
                await chargerDonneesPlanning(true, true, true);
            }
        } else {
            const data = await response.json().catch(() => ({}));
            console.error('Échec déplacement réservation:', response.status, data.error?.message || data);
        }
    } catch (error) {
        console.error(error);
    }
}

function estMaintenancePlanningAutorisee() {
    const roles = (typeof currentUser !== 'undefined' && currentUser ? currentUser.roles || [] : []);
    return roles.some(r => ['Super admin', 'Mécanicien', 'Instructeur avion', 'Instructeur ULM', 'Instructeur planeur'].includes(r));
}

async function enregistrerMaintenanceDepuisPlanning() {
    const machineId = getMachineSelectionnee();
    if (!machineId) {
        alert('Veuillez sélectionner un aéronef.');
        return;
    }
    const avion = (listeAvionsCache || []).find(a => a.id === machineId);
    const immat = (avion && avion.fields && (avion.fields['Immatriculation'] || avion.fields['Nom'])) || '';
    if (!immat) {
        alert('Aéronef invalide.');
        return;
    }
    const dateTime = new Date(document.getElementById('form-debut').value);
    const dateTimeFin = new Date(document.getElementById('form-fin').value);
    if (isNaN(dateTime.getTime()) || isNaN(dateTimeFin.getTime()) || dateTimeFin <= dateTime) {
        alert('La date de fin doit être postérieure à la date de début.');
        return;
    }
    const ancienneButee = parseFloat(String(document.getElementById('form-ancienne-butee').value).replace(',', '.')) || 0;
    const changerButee = document.getElementById('form-changer-butee').checked;
    const nouvelleButee = changerButee
        ? parseFloat(String(document.getElementById('form-nouvelle-butee').value).replace(',', '.'))
        : ancienneButee;
    if (changerButee && isNaN(nouvelleButee)) {
        alert('Renseigne la nouvelle butée.');
        return;
    }
    try {
        await persisterMaintenance({ maintenanceId: null, immat, avionId: machineId, dateTime, dateTimeFin, ancienneButee, nouvelleButee });
        const modalResa = document.getElementById('reservation-modal');
        if (modalResa) modalResa.style.display = 'none';
        if (formReservation) formReservation.reset();
        await chargerDonneesPlanning(true);
        const viewAeronefs = document.getElementById('view-aeronefs');
        if (viewAeronefs && viewAeronefs.style.display !== 'none' && typeof chargerSuiviAeronef === 'function') {
            chargerSuiviAeronef();
        }
    } catch (err) {
        console.error(err);
        alert("Erreur lors de l'enregistrement de la maintenance.");
    }
}

function appliquerEtatFormulaire() {
    const inputPilote = document.getElementById('form-pilote');
    const inputEstimation = document.getElementById('form-estimation');
    const groupCommentaires = document.getElementById('group-commentaires');
    const groupMachine = document.getElementById('group-machine');
    const groupEstimation = document.getElementById('group-estimation');
    const groupPassager = document.getElementById('group-passager');
    const groupTelephone = document.getElementById('group-telephone');
    const groupEmail = document.getElementById('group-email');
    const groupPrenom = document.getElementById('group-prenom-passager');
    const groupBon = document.getElementById('group-bon');
    const labelPilote = document.getElementById('label-pilote');
    const labelCommentaires = document.getElementById('label-commentaires');

    // Mode maintenance : bandeau reserve aux instructeurs / mecanicien / super admin
    const maintenanceCb = document.getElementById('form-maintenance');
    const maintenanceMode = !!(maintenanceCb && maintenanceCb.checked);
    const bannerMaintenance = document.getElementById('option-maintenance');
    const enEditionResa = typeof idReservationEnEdition !== 'undefined' && !!idReservationEnEdition;
    if (bannerMaintenance) {
        bannerMaintenance.style.display = (estMaintenancePlanningAutorisee() && !enEditionResa) ? 'flex' : 'none';
    }
    const groupMaintenance = document.getElementById('group-maintenance');
    if (maintenanceMode) {
        if (groupMaintenance) groupMaintenance.style.display = 'block';
        if (groupMachine) groupMachine.style.display = 'block';
        if (groupEstimation) groupEstimation.style.display = 'none';
        if (groupPrenom) groupPrenom.style.display = 'none';
        if (groupPassager) groupPassager.style.display = 'none';
        if (groupEmail) groupEmail.style.display = 'none';
        if (groupTelephone) groupTelephone.style.display = 'none';
        if (groupBon) groupBon.style.display = 'none';
        if (groupCommentaires) groupCommentaires.style.display = 'none';
        const grpInst = document.getElementById('group-instructeur');
        if (grpInst) grpInst.style.display = 'none';
        const grpPilote = document.getElementById('group-pilote');
        if (grpPilote) grpPilote.style.display = 'none';
        if (inputPilote) inputPilote.required = false;
        if (inputEstimation) inputEstimation.required = false;
        const machineIdM = getMachineSelectionnee();
        const avionM = (listeAvionsCache || []).find(a => a.id === machineIdM);
        const ancienneInput = document.getElementById('form-ancienne-butee');
        if (avionM && avionM.fields && ancienneInput) {
            ancienneInput.value = parseFloat(String(avionM.fields['Prochaine Butée'] || '').replace(',', '.')) || 0;
        }
        const changerCb = document.getElementById('form-changer-butee');
        const grpNouvelle = document.getElementById('group-nouvelle-butee');
        if (grpNouvelle) grpNouvelle.style.display = (changerCb && changerCb.checked) ? 'block' : 'none';
        const btnSaveM = document.getElementById('btn-save-reservation');
        if (btnSaveM) btnSaveM.innerHTML = '<span class="nr-icon-save">💾</span> Enregistrer';
        return;
    }
    if (groupMaintenance) groupMaintenance.style.display = 'none';

    const typeSelectionne = getTypeVolSelectionne();
    const isVIPlaneur = typeSelectionne.includes('VI Planeur');
    const isVIMoteur = typeSelectionne.includes('VI Moteur');
    const isVI = isVIPlaneur || isVIMoteur;

    const groupInstructeur = document.getElementById('group-instructeur');
    if (groupInstructeur) {
        const showInstructeur = !isVI && typeSelectionne.includes('Instruction');
        groupInstructeur.style.display = showInstructeur ? '' : 'none';
        const selInst = document.getElementById('form-instructeur');
        if (isVI && selInst) selInst.value = '';
    }
    const viPrecedent = appliquerEtatFormulaire._viPlaneur;
    appliquerEtatFormulaire._viPlaneur = isVI;
    if (viPrecedent !== isVI && (viPrecedent !== undefined || isVI)) {
        const selPil = document.getElementById('form-pilote');
        const enEdition = typeof idReservationEnEdition !== 'undefined' && !!idReservationEnEdition;
        peuplerPiloteSelect(isVI && !enEdition ? '' : (selPil ? selPil.value : null));
    }

    const machineId = getMachineSelectionnee();
    const avionSelectionne = (listeAvionsCache || []).find(a => a.id === machineId);
    const immatSelectionnee = (avionSelectionne && avionSelectionne.fields ? (avionSelectionne.fields['Immatriculation'] || avionSelectionne.fields['Nom'] || '').toString().trim().toUpperCase() : '');
    const showRemorquage = ['F-BLIO', 'F-JVIO'].includes(immatSelectionnee);
    const showVolDeNuit = !['F-BLIO', 'F-JVIO'].includes(immatSelectionnee);
    document.querySelectorAll('input[name="form-type-vol"][value="Remorquage"]').forEach(cb => {
        if (cb.parentElement) cb.parentElement.style.display = showRemorquage ? '' : 'none';
        if (!showRemorquage) cb.checked = false;
    });
    document.querySelectorAll('input[name="form-type-vol"][value="Vol de nuit"]').forEach(cb => {
        if (cb.parentElement) cb.parentElement.style.display = showVolDeNuit ? '' : 'none';
        if (!showVolDeNuit) cb.checked = false;
    });
    const typeGroup = document.getElementById('form-type-vol-group');
    if (typeGroup) {
        const ordreTypes = showRemorquage
            ? ['Local', 'Navigation', 'Instruction', 'Remorquage', 'VI Moteur', 'VI Planeur']
            : ['Local', 'Navigation', 'Instruction', 'Vol de nuit', 'VI Moteur', 'VI Planeur'];
        ordreTypes.forEach(v => {
            const cb = typeGroup.querySelector(`input[name="form-type-vol"][value="${v}"]`);
            if (cb && cb.parentElement) typeGroup.appendChild(cb.parentElement);
        });
    }
    verifierAlertesReservation();

    if (groupMachine) groupMachine.style.display = isVIPlaneur ? 'none' : 'block';
    if (groupEstimation) groupEstimation.style.display = isVI ? 'none' : 'block';
    if (groupPrenom) groupPrenom.style.display = isVI ? 'block' : 'none';
    if (groupPassager) groupPassager.style.display = isVI ? 'block' : 'none';
    if (groupEmail) groupEmail.style.display = isVI ? 'block' : 'none';
    if (groupTelephone) groupTelephone.style.display = isVI ? 'block' : 'none';
    if (groupBon) groupBon.style.display = isVI ? 'block' : 'none';

    const fbLio = (listeAvionsCache || []).find(a => {
        const immat = (a.fields['Immatriculation'] || '').toString().trim().toUpperCase();
        return immat === 'F-BLIO' || immat === 'FBLIO';
    });
    if (fbLio) {
        document.querySelectorAll('input[name="form-machine"]').forEach(cb => {
            if (cb.value === fbLio.id) {
                cb.disabled = isVIMoteur;
                cb.parentElement.style.opacity = isVIMoteur ? '0.5' : '1';
                cb.parentElement.style.pointerEvents = isVIMoteur ? 'none' : 'auto';
                if (isVIMoteur) cb.checked = false;
            }
        });
    }

    const btnSave = document.getElementById('btn-save-reservation');
    if (isVI) {
        if (labelPilote) labelPilote.textContent = 'Nom du Pilote (optionnel) :';
        if (inputPilote) {
            inputPilote.placeholder = 'Ex: Jean Dupont';
            inputPilote.required = false;
        }
        if (labelCommentaires) labelCommentaires.textContent = 'COMMENTAIRES';
        if (groupCommentaires) groupCommentaires.style.display = 'block';
        if (inputEstimation) inputEstimation.required = false;
        if (btnSave) btnSave.innerHTML = '<span class="nr-icon-save">💾</span> Enregistrer et envoyer le mail';
        return;
    }

    if (btnSave) btnSave.innerHTML = '<span class="nr-icon-save">💾</span> Enregistrer';
    if (labelPilote) labelPilote.textContent = 'Nom du Pilote :';
    if (inputPilote) {
        inputPilote.placeholder = 'Ex: Jean Dupont';
        inputPilote.required = true;
    }
    if (labelCommentaires) labelCommentaires.textContent = 'COMMENTAIRES';
    if (groupCommentaires) groupCommentaires.style.display = 'none';
    if (inputEstimation) inputEstimation.required = true;
}

function majAlerteModale(id, parent, afficher, texte, niveau = 'erreur') {
    let warn = document.getElementById(id);
    if (!afficher || !parent) {
        if (warn) warn.remove();
        return;
    }
    if (!warn) {
        warn = document.createElement('div');
        warn.id = id;
        const style = niveau === 'warning'
            ? 'background:#fff7ed; border:1px solid #fdba74; color:#c2410c;'
            : 'background:#fef2f2; border:1px solid #fca5a5; color:#b91c1c;';
        warn.style.cssText = `margin-top:8px; padding:8px 10px; border-radius:8px; font-size:13px; font-weight:600; ${style}`;
        parent.appendChild(warn);
    }
    warn.textContent = texte;
}

function verifierTempsMoteur() {
    const est = document.getElementById('form-estimation');
    const debut = document.getElementById('form-debut');
    const fin = document.getElementById('form-fin');
    const group = document.getElementById('group-estimation');
    if (!est || !debut || !fin || !group) return;
    const dureeH = (new Date(fin.value) - new Date(debut.value)) / 3600000;
    const estH = parseFloat(String(est.value).replace(',', '.'));
    const depasse = Number.isFinite(dureeH) && dureeH > 0 && Number.isFinite(estH) && estH > dureeH;
    majAlerteModale('alerte-temps-moteur', group, depasse, '⚠️ Le temps moteur estimé dépasse la durée du créneau réservé.', 'warning');
}

let alerteInstructeurDemandee = false;

function verifierInstructeurObligatoire() {
    const group = document.getElementById('group-instructeur');
    const sel = document.getElementById('form-instructeur');
    if (!group || !sel) return;
    const types = (typeof getTypeVolSelectionne === 'function') ? getTypeVolSelectionne() : [];
    const besoin = types.includes('Instruction') && !types.includes('VI Moteur') && !types.includes('VI Planeur');
    majAlerteModale('alerte-instructeur-obligatoire', group, alerteInstructeurDemandee && besoin && !sel.value.trim(), '⚠️ Un instructeur est obligatoire pour un vol d\'instruction.');
}

function verifierDatePassee() {
    const debut = document.getElementById('form-debut');
    if (!debut) return;
    const section = debut.closest('.nr-section');
    const passee = !!debut.value && new Date(debut.value) < new Date();
    majAlerteModale('alerte-date-passee', section, passee, '⚠️ La date de la réservation est dans le passé.', 'warning');
}

function verifierFinAvantDebut() {
    const debut = document.getElementById('form-debut');
    const fin = document.getElementById('form-fin');
    if (!debut || !fin) return;
    const section = fin.closest('.nr-section');
    const invalide = !!debut.value && !!fin.value && new Date(fin.value) <= new Date(debut.value);
    majAlerteModale('alerte-fin-avant-debut', section, invalide, '⛔ La fin du créneau doit être postérieure au début.', 'erreur');
}

function verifierAlertesReservation() {
    verifierTempsMoteur();
    verifierInstructeurObligatoire();
    verifierDatePassee();
    verifierFinAvantDebut();
}

function getTypeVolSelectionne() {
    const checkboxes = document.querySelectorAll('input[name="form-type-vol"]:checked');
    const types = Array.from(checkboxes).map(cb => cb.value);
    return types.length > 0 ? types : ['Local'];
}

function initGestionnaireModaleVIPlaneur() {
    const modal = document.getElementById('vi-planeur-modal');
    const form = document.getElementById('vi-planeur-form');
    const btnClose = document.querySelector('.close-modal-vi');
    const btnDeleteVI = document.getElementById('btn-delete-vi-planeur');
    if (btnClose && modal) {
        btnClose.addEventListener('click', () => modal.style.display = 'none');
    }
    window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    if (btnDeleteVI) {
        btnDeleteVI.addEventListener('click', async () => {
            if (!idVIModale || tableVIModale !== 'VI Planeur') return;
            if (!confirm("Es-tu sûr de vouloir supprimer ce VI Planeur ?")) return;
            try {
                const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Planeur')}?records[]=${idVIModale}`, {
                    method: 'DELETE',
                    headers: headers
                });
                if (response.ok) {
                    if (typeof enregistrerAudit === 'function') {
                        const pilote = nomUtilisateurDepuisId(volVIModale?.pilote, listeMembresCache) || '';
                        const dateVol = volVIModale?.debut ? volVIModale.debut.slice(0,16).replace('T',' ') : '';
                        const finVol = volVIModale?.fin ? volVIModale.fin.slice(0,16).replace('T',' ') : '';
                        await enregistrerAudit('Suppression VI Planeur', 'VI Planeur', `Pilote : ${pilote} | ${dateVol} - ${finVol}`, 'Initiation');
                    }
                    modal.style.display = 'none';
                    form.reset();
                    idVIModale = null;
                    tableVIModale = null;
                    setAfficherVIPPlaneur(false);
                    chargerDonneesPlanning(true);
                }
            } catch (error) {
                console.error(error);
            }
        });
    }
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const table = tableVIModale || 'VI Planeur';
            const nomComplet = document.getElementById('form-vi-nom').value.trim();
            if (!nomComplet) return;
            const debutInput = document.getElementById('form-vi-debut').value;
            const finInput = document.getElementById('form-vi-fin').value;
            const dateDebut = new Date(debutInput).toISOString();
            const dateFin = new Date(finInput).toISOString();
            const pilote = document.getElementById('form-vi-pilote').value.trim();
            const commentaire = document.getElementById('form-vi-commentaire').value.trim();
            const debutDate = new Date(debutInput);
            const finDate = new Date(finInput);
            const date = debutInput ? debutInput.split('T')[0] : null;
            const heureDebut = `${String(debutDate.getHours()).padStart(2, '0')}:${String(debutDate.getMinutes()).padStart(2, '0')}`;
            const heureFin = `${String(finDate.getHours()).padStart(2, '0')}:${String(finDate.getMinutes()).padStart(2, '0')}`;
            try {
                if (table === 'VI Créneaux') {
                    const parts = nomComplet.split(/\s+/);
                    const prenom = parts.shift() || '';
                    const nom = parts.join(' ') || '';
                    const telephone = document.getElementById('form-vi-telephone').value.trim();
                    const statut = document.getElementById('form-vi-statut').value;
                    const oldDate = volVIModale && volVIModale.debut ? volVIModale.debut.split('T')[0] : null;
                    const oldHeureDebut = volVIModale && volVIModale.debut ? volVIModale.debut.split('T')[1].slice(0, 5) : null;
                    const oldHeureFin = volVIModale && volVIModale.fin ? volVIModale.fin.split('T')[1].slice(0, 5) : null;
                    const moved = !(date === oldDate && heureDebut === oldHeureDebut && heureFin === oldHeureFin);
                    if (!moved) {
                        const recordData = {
                            id: idVIModale,
                            fields: {
                                'Prénom': prenom,
                                'Nom': nom,
                                'Téléphone': telephone,
                                'Pilote': pilote,
                                'Commentaire': commentaire,
                                'Date': date,
                                'Heure début': heureDebut,
                                'Heure fin': heureFin,
                                'Statut': statut
                            }
                        };
                        await cachedFetch(`${API_BASE}/${encodeURIComponent(table)}`, {
                            method: 'PATCH',
                            headers: headers,
                            body: JSON.stringify({ records: [recordData] })
                        });
                    } else {
                        const newRecord = {
                            fields: {
                                'Prénom': prenom,
                                'Nom': nom,
                                'Téléphone': telephone,
                                'Email': volVIModale ? (volVIModale.email || '') : '',
                                'Pilote': pilote,
                                'Commentaire': commentaire,
                                'Bon cadeau': volVIModale ? (volVIModale.bonCadeau || '') : '',
                                'Token': volVIModale ? (volVIModale.token || '') : '',
                                'Date': date,
                                'Heure début': heureDebut,
                                'Heure fin': heureFin,
                                'Type': volVIModale ? (volVIModale.type || 'VI') : 'VI',
                                'Statut': 'Réservé'
                            }
                        };
                        const oldRecord = {
                            id: idVIModale,
                            fields: {
                                'Statut': 'Disponible',
                                'Prénom': null,
                                'Nom': null,
                                'Email': null,
                                'Téléphone': null,
                                'Pilote': null,
                                'Commentaire': null,
                                'Bon cadeau': null,
                                'Token': null
                            }
                        };
                        await cachedFetch(`${API_BASE}/${encodeURIComponent(table)}`, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({ fields: newRecord.fields })
                        });
                        await cachedFetch(`${API_BASE}/${encodeURIComponent(table)}`, {
                            method: 'PATCH',
                            headers: headers,
                            body: JSON.stringify({ records: [oldRecord] })
                        });
                    }
                } else {
                    const recordData = {
                        fields: { "Nom": nomComplet, "Date de début": dateDebut, "Date de fin": dateFin, "Pilote": pilote, "Commentaire": commentaire }
                    };
                    let methode = 'POST';
                    if (idVIModale) {
                        recordData.id = idVIModale;
                        methode = 'PATCH';
                    }
                    await cachedFetch(`${API_BASE}/${encodeURIComponent(table)}`, {
                        method: methode,
                        headers: headers,
                        body: JSON.stringify({ records: [recordData] })
                    });
                }
                if (typeof enregistrerAudit === 'function') {
                    const action = idVIModale ? 'Modification' : 'Création';
                    const typeCible = table === 'VI Créneaux' ? 'Créneau VI' : 'VI Planeur';
                    await enregistrerAudit(`${action} ${typeCible}`, typeCible, `Pilote : ${nomUtilisateurDepuisId(pilote, listeMembresCache) || pilote} | Passager : ${nomComplet} | ${dateDebut.slice(0,16).replace('T',' ')} - ${dateFin.slice(0,16).replace('T',' ')}`, 'Initiation');
                }
                modal.style.display = 'none';
                form.reset();
                idVIModale = null;
                tableVIModale = null;
                volVIModale = null;
                if (table === 'VI Planeur') {
                    setAfficherVIPPlaneur(true);
                }
                chargerDonneesPlanning(true);
                if (typeof chargerVolsInitiation === 'function') chargerVolsInitiation();
            } catch (error) {
                console.error(error);
            }
        });
    }
}

function populerMachinesCases(avions) {
    const container = document.getElementById('form-machine-group');
    if (!container) return;
    container.innerHTML = '';
    avions.forEach(avion => {
        const label = document.createElement('label');
        label.className = 'nr-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'form-machine';
        input.value = avion.id;
        input.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.querySelectorAll('input[name="form-machine"]').forEach(cb => { if (cb !== e.target) cb.checked = false; });
            }
            appliquerEtatFormulaire();
        });
        const icon = document.createElement('span');
        icon.className = 'nr-icon';
        icon.textContent = '✈️';
        const txt = document.createElement('span');
        txt.className = 'nr-label';
        txt.textContent = avion.fields['Immatriculation'] || avion.fields['Nom'] || 'Sans nom';
        label.appendChild(input);
        label.appendChild(icon);
        label.appendChild(txt);
        container.appendChild(label);
    });
}

function cocherTypeVol(valeur) {
    const mapping = {
        "Vol Classique": ["Local"],
        "Vol d'Initiation": ["Instruction", "Local"]
    };
    let cibles = [];
    if (Array.isArray(valeur)) {
        valeur.forEach(v => { cibles.push(...(mapping[v] || [v])); });
    } else {
        cibles = mapping[valeur] || [valeur];
    }
    cibles = [...new Set(cibles)];
    const viTypes = cibles.filter(v => v === 'VI Planeur' || v === 'VI Moteur');
    const final = viTypes.length > 0 ? viTypes : cibles;
    document.querySelectorAll('input[name="form-type-vol"]').forEach(cb => { cb.checked = final.includes(cb.value); });
}

function selectionnerMachine(machineId) {
    document.querySelectorAll('input[name="form-machine"]').forEach(cb => { cb.checked = (cb.value === machineId); });
}

function getMachineSelectionnee() {
    const checked = document.querySelector('input[name="form-machine"]:checked');
    return checked ? checked.value : null;
}

function initGestionnaireModale() {
    modal = document.getElementById('reservation-modal');
    groupCommentaires = document.getElementById('group-commentaires');
    btnDelete = document.getElementById('btn-delete-reservation');
    titleModal = document.getElementById('modal-title');
    formReservation = document.getElementById('reservation-form');
    const typeVolGroup = document.getElementById('form-type-vol-group');
    const machineGroup = document.getElementById('form-machine-group');
    const btnOpenModal = document.getElementById('btn-add-reservation');
    const btnCloseModal = document.querySelector('.close-modal');
    if (typeVolGroup) {
        typeVolGroup.addEventListener('change', (e) => {
            if (e.target.name !== 'form-type-vol') return;
            const value = e.target.value;
            if (!e.target.checked) {
                appliquerEtatFormulaire();
                return;
            }
            const cbMaint = document.getElementById('form-maintenance');
            if (cbMaint) cbMaint.checked = false;
            if (value === 'VI Planeur' || value === 'VI Moteur') {
                document.querySelectorAll('input[name="form-type-vol"]').forEach(cb => { if (cb !== e.target) cb.checked = false; });
            } else {
                if (value === 'Local') {
                    document.querySelectorAll('input[name="form-type-vol"][value="Navigation"]').forEach(cb => cb.checked = false);
                } else if (value === 'Navigation') {
                    document.querySelectorAll('input[name="form-type-vol"][value="Local"]').forEach(cb => cb.checked = false);
                }
            }
            if (value === 'VI Planeur' || value === 'VI Moteur') {
                const debutInput = document.getElementById('form-debut');
                const finInput = document.getElementById('form-fin');
                if (debutInput && finInput && debutInput.value) {
                    const d = new Date(debutInput.value);
                    d.setMinutes(d.getMinutes() + (value === 'VI Planeur' ? 45 : 60));
                    finInput.value = formaterPourInput(d);
                }
            }
            appliquerEtatFormulaire();
        });
    }
    if (machineGroup) {
        machineGroup.addEventListener('change', (e) => {
            if (e.target.name !== 'form-machine') return;
            if (e.target.checked) {
                document.querySelectorAll('input[name="form-machine"]').forEach(cb => { if (cb !== e.target) cb.checked = false; });
            }
            appliquerEtatFormulaire();
        });
    }
    const debutInput = document.getElementById('form-debut');
    const finInput = document.getElementById('form-fin');
    if (debutInput && finInput) {
        debutInput.addEventListener('change', () => {
            if (idReservationEnEdition) return;
            const d = new Date(debutInput.value);
            if (isNaN(d.getTime())) return;
            const typesSel = typeof getTypeVolSelectionne === 'function' ? getTypeVolSelectionne() : [];
            const dureeMin = typesSel.includes('VI Planeur') ? 45 : (typesSel.includes('VI Moteur') ? 60 : 120);
            finInput.value = formaterDateHeureLocal(new Date(d.getTime() + dureeMin * 60000));
            verifierAlertesReservation();
        });
    }
    const maintenanceCbInput = document.getElementById('form-maintenance');
    if (maintenanceCbInput) {
        maintenanceCbInput.addEventListener('change', () => {
            if (maintenanceCbInput.checked) {
                document.querySelectorAll('input[name="form-type-vol"]').forEach(cb => { cb.checked = false; });
            }
            appliquerEtatFormulaire();
        });
    }
    const changerButeeCb = document.getElementById('form-changer-butee');
    if (changerButeeCb) {
        changerButeeCb.addEventListener('change', () => {
            const g = document.getElementById('group-nouvelle-butee');
            if (g) g.style.display = changerButeeCb.checked ? 'block' : 'none';
            if (changerButeeCb.checked) {
                const a = parseFloat(String(document.getElementById('form-ancienne-butee').value).replace(',', '.')) || 0;
                const n = document.getElementById('form-nouvelle-butee');
                if (n && !n.value) n.value = a + 50;
            }
        });
    }
    const instructeurSelect = document.getElementById('form-instructeur');
    if (instructeurSelect) {
        instructeurSelect.addEventListener('change', (e) => {
            if (e.target.value && e.target.value.trim() !== '') {
                const cbInstruction = document.querySelector('input[name="form-type-vol"][value="Instruction"]');
                if (cbInstruction) cbInstruction.checked = true;
                appliquerEtatFormulaire();
            }
        });
    }
    if (modal && !modal.dataset.alertesListener) {
        modal.dataset.alertesListener = '1';
        ['input', 'change'].forEach(type => document.addEventListener(type, (e) => {
            if (e.target && e.target.closest && e.target.closest('#reservation-modal')) verifierAlertesReservation();
        }, true));
        document.addEventListener('click', (e) => {
            if (e.target && e.target.closest && e.target.closest('#reservation-modal .nr-stepper')) setTimeout(verifierAlertesReservation, 0);
        }, true);
        new MutationObserver(() => {
            if (modal.style.display === 'flex') alerteInstructeurDemandee = false;
        }).observe(modal, { attributes: true, attributeFilter: ['style'] });
    }
    window.ouvrirModaleNouvelleReservation = async function(options = {}) {
        console.log('[PLANNING] ouvrir appelée', options);
        idReservationEnEdition = null;
        if (titleModal) titleModal.textContent = "Nouvelle Réservation";
        if (btnDelete) btnDelete.style.display = 'none';
        if (groupCommentaires) groupCommentaires.style.display = 'none';
        if (formReservation) formReservation.reset();
        if (listeAvionsCache.length > 0) populerMachinesCases(listeAvionsCache);
        const annee = dateAffichee.getFullYear();
        const mois = (dateAffichee.getMonth() + 1).toString().padStart(2, '0');
        const jour = dateAffichee.getDate().toString().padStart(2, '0');
        const dateBase = `${annee}-${mois}-${jour}`;
        const debutInput = document.getElementById('form-debut');
        const finInput = document.getElementById('form-fin');
        if (debutInput) {
            if (options.heureDebut !== undefined) {
                const hh = Math.floor(options.heureDebut);
                const mm = Math.round((options.heureDebut - hh) * 60);
                debutInput.value = `${dateBase}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
            } else {
                const maintenant = new Date();
                debutInput.value = formaterPourInput(new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), maintenant.getHours() + 1, 0));
            }
        }
        if (finInput && debutInput && debutInput.value) {
            const d = new Date(debutInput.value);
            d.setMinutes(d.getMinutes() + (options.dureeMinutes || 120));
            finInput.value = formaterPourInput(d);
        }
        if (document.getElementById('form-estimation')) document.getElementById('form-estimation').value = '1.0';
        if (typeof peuplerInstructeursSelect === 'function') await peuplerInstructeursSelect();
        if (typeof peuplerPiloteSelect === 'function') await peuplerPiloteSelect();
        if (options.type === 'VI Planeur') {
            const sel = document.getElementById('form-pilote');
            if (sel) {
                if (!Array.from(sel.options).some(o => o.value === '')) {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = '-- Aucun --';
                    sel.insertBefore(opt, sel.firstChild);
                }
                sel.value = '';
            }
        }
        if (options.type) {
            document.querySelectorAll('input[name="form-type-vol"]').forEach(cb => { cb.checked = cb.value === options.type; });
        }
        if (options.instructeur) {
            const sel = document.getElementById('form-instructeur');
            if (sel) {
                const match = Array.from(sel.options).find(o => o.value === options.instructeur || correspondanceNom(o.value, options.instructeur));
                if (match) sel.value = match.value;
                sel.dispatchEvent(new Event('maj-affichage'));
            }
        }
        appliquerEtatFormulaire();
        console.log('[PLANNING] modal', modal);
        if (modal) modal.style.display = 'flex';
    }

    if (btnOpenModal && modal) {
        btnOpenModal.addEventListener('click', () => window.ouvrirModaleNouvelleReservation());
    }
    if (btnCloseModal) btnCloseModal.addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (e) => { if (modal && e.target === modal) modal.style.display = 'none'; });
    if (formReservation) {
        formReservation.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cbMaintSubmit = document.getElementById('form-maintenance');
            if (cbMaintSubmit && cbMaintSubmit.checked) {
                await enregistrerMaintenanceDepuisPlanning();
                return;
            }
            const typesVol = getTypeVolSelectionne();
            const besoinInstructeur = typesVol.includes('Instruction') && !typesVol.includes('VI Moteur') && !typesVol.includes('VI Planeur');
            const selInstructeur = document.getElementById('form-instructeur');
            if (besoinInstructeur && (!selInstructeur || !selInstructeur.value.trim())) {
                alerteInstructeurDemandee = true;
                verifierInstructeurObligatoire();
                const grpInst = document.getElementById('group-instructeur');
                if (grpInst) grpInst.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            const typesValidesAirtable = ['Local','Navigation','Vol de nuit','Instruction','VI Moteur','VI Planeur','Remorquage'];
            const typesFinaux = typesVol.filter(t => typesValidesAirtable.includes(t));
            const typesSupplementaires = typesVol.filter(t => !typesValidesAirtable.includes(t));
            const commentairesBase = (document.getElementById('form-commentaires') || {}).value || '';
            let commentairesFinal = commentairesBase.trim();
            if (typesSupplementaires.length) {
                const extra = typesSupplementaires.join(', ');
                commentairesFinal = commentairesFinal ? `${commentairesFinal}\n${extra}` : extra;
            }
            const piloteNom = document.getElementById('form-pilote').value.trim();
            const prenomPassager = document.getElementById('form-prenom-passager') ? document.getElementById('form-prenom-passager').value.trim() : '';
            const nomPassager = document.getElementById('form-passager') ? document.getElementById('form-passager').value.trim() : '';
            const passagerNom = `${prenomPassager} ${nomPassager}`.trim();
            const telephone = document.getElementById('form-telephone') ? document.getElementById('form-telephone').value.trim() : '';

            // Vérification solde et validités
            const selPiloteEdit = document.getElementById('form-pilote');
            const piloteNomEdit = (selPiloteEdit && selPiloteEdit.selectedIndex >= 0) ? (selPiloteEdit.options[selPiloteEdit.selectedIndex].textContent || '').trim() : '';
            const piloteIdEdit = selPiloteEdit ? selPiloteEdit.value.trim() : '';
            if (piloteNomEdit && typeof getSoldePilote === 'function') {
                const solde = await getSoldePilote(piloteNomEdit);
                if (solde <= -500) {
                    const soldeText = solde.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const msg = `<p>Le compte pilote de <strong>${escapeHtml(piloteNomEdit)}</strong> est à <strong>${escapeHtml(soldeText)} €</strong>.</p><p style="margin-top:8px;">Le plafond autorisé est de <strong>-500 €</strong>. La modification est impossible avant de recréditer le compte.</p>`;
                    afficherModaleAlerte('Compte pilote insuffisant', msg, '💳');
                    return;
                }
            }
            if (typeof chargerValiditesAccueil === 'function') {
                try {
                    const validites = await chargerValiditesAccueil();
                    if (validites && validites.items) {
                        const invalides = validites.items.filter(i => i.ok === false);
                        if (invalides.length) {
                            const liste = invalides.map(i => `<li>${escapeHtml(i.label)}</li>`).join('');
                            const msg = `<p>Les validités suivantes ne sont pas à jour :</p><ul style="margin:10px 0; padding-left:20px;">${liste}</ul>`;
                            afficherModaleAlerte('Validités à mettre à jour', msg, '🛡️');
                        }
                    }
                } catch (err) {
                    console.warn('Vérification des validités avant réservation:', err);
                }
            }

            const localDebut = new Date(document.getElementById('form-debut').value);
            const localFin = new Date(document.getElementById('form-fin').value);
            if (isNaN(localDebut.getTime()) || isNaN(localFin.getTime()) || localFin <= localDebut) {
                verifierFinAvantDebut();
                return;
            }
            const dateDebut = localDebut.toISOString();
            const dateFin = localFin.toISOString();
            const isVIPlaneur = typesVol.includes('VI Planeur');
            const isVIMoteur = typesVol.includes('VI Moteur');
            const isVI = isVIPlaneur || isVIMoteur;
            const instructeur = document.getElementById('form-instructeur') ? document.getElementById('form-instructeur').value.trim() : '';
            let machineNom = 'Tous';
            let typeMachineSel = '';
            if (isVIMoteur || !isVI) {
                const selectedMachine = getMachineSelectionnee();
                const avion = (listeAvionsCache || []).find(a => a.id === selectedMachine);
                machineNom = (avion && avion.fields && (avion.fields['Immatriculation'] || avion.fields['Nom'])) || selectedMachine || 'Tous';
                typeMachineSel = (avion && avion.fields && avion.fields['Type'] || '').toString().trim().toLowerCase();
            } else if (isVIPlaneur) {
                typeMachineSel = 'planeur';
            }
            // Avertissement non bloquant : documents de la machine perimes a la date du vol
            if (!isVIPlaneur && machineNom && machineNom !== 'Tous') {
                await verifierDocumentsAeronefAvantReservation(machineNom, localDebut);
            }
            if (instructeur && typeof verifierConflitDisponibiliteInstructeur === 'function') {
                const conflit = await verifierConflitDisponibiliteInstructeur(instructeur, localDebut, localFin, machineNom, typeMachineSel);
                const libelleDisc = typeMachineSel === 'avion' ? 'en avion' : typeMachineSel === 'ulm' ? 'en ULM' : typeMachineSel === 'planeur' ? 'en planeur' : '';
                const msg = `L'instructeur n'est pas disponible${libelleDisc ? ' ' + libelleDisc : ''} sur ce créneau. Voulez-vous quand même réserver ?`;
                if (conflit && !confirm(msg)) return;
            }
            if (isVI) {
                if (!prenomPassager || !nomPassager) {
                    alert("Le prénom et le nom du passager sont obligatoires.");
                    return;
                }
                if (!telephone) {
                    alert("Le téléphone du passager est obligatoire.");
                    return;
                }
                const emailPassager = document.getElementById('form-email') ? document.getElementById('form-email').value.trim() : '';
                const bonCadeau = document.getElementById('form-bon') ? document.getElementById('form-bon').value.trim() : '';
                const commentaire = document.getElementById('form-commentaires').value.trim();
                const commentaireVI = typesSupplementaires.length
                    ? (commentaire ? `${commentaire}\n${typesSupplementaires.join(', ')}` : typesSupplementaires.join(', '))
                    : commentaire;
                if (!idReservationEnEdition) {
                    // Creation unifiee dans VI Creneaux : token, mails et decalage passager fonctionnent
                    if (!isVIPlaneur && !getMachineSelectionnee()) {
                        alert("Veuillez sélectionner une machine.");
                        return;
                    }
                    const pad2 = n => String(n).padStart(2, '0');
                    const dateStr = `${localDebut.getFullYear()}-${pad2(localDebut.getMonth() + 1)}-${pad2(localDebut.getDate())}`;
                    const hDebut = `${pad2(localDebut.getHours())}:${pad2(localDebut.getMinutes())}`;
                    const hFin = `${pad2(localFin.getHours())}:${pad2(localFin.getMinutes())}`;
                    const typeVI = isVIPlaneur ? 'VIP' : (machineNom === 'F-JVIO' ? 'VIULM' : 'VIA');
                    const champsCreneau = {
                        'Statut': 'Réservé',
                        'Prénom': prenomPassager,
                        'Nom': nomPassager,
                        'Email': emailPassager,
                        'Téléphone': telephone,
                        'Pilote': piloteIdEdit ? piloteNomEdit : '',
                        'Commentaire': commentaireVI,
                        'Bon cadeau': bonCadeau,
                        'Token': 'tok' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14),
                        'Date réservation': new Date().toISOString()
                    };
                    try {
                        const formJour = `DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${dateStr}'`;
                        const resJour = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}?filterByFormula=${encodeURIComponent(formJour)}&pageSize=100`, { headers }, API_CACHE_TTL, true);
                        const dataJour = await resJour.json();
                        const toMin = h => { const p = (h || '00:00').split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); };
                        const dMin = toMin(hDebut);
                        const fMin = toMin(hFin);
                        const memeType = (dataJour.records || []).filter(r => {
                            const f = r.fields || {};
                            return f['Statut'] !== 'Annulé' && (f['Type'] || 'VI') === typeVI;
                        });
                        const identique = memeType.find(r => r.fields['Heure début'] === hDebut && r.fields['Heure fin'] === hFin);
                        const chevauches = memeType.filter(r => toMin(r.fields['Heure début']) < fMin && toMin(r.fields['Heure fin']) > dMin);
                        let response;
                        if (identique) {
                            if ((identique.fields['Statut'] || 'Disponible') !== 'Disponible') {
                                alert(`Un créneau ${typeVI} existe déjà le ${dateStr} de ${hDebut} à ${hFin} (statut : ${identique.fields['Statut']}).`);
                                return;
                            }
                            if (!confirm(`Un créneau ${typeVI} disponible existe déjà le ${dateStr} de ${hDebut} à ${hFin}.\nLe vol sera réservé sur ce créneau existant. Continuer ?`)) return;
                            response = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}`, {
                                method: 'PATCH',
                                headers: headers,
                                body: JSON.stringify({ records: [{ id: identique.id, fields: champsCreneau }] })
                            });
                        } else {
                            const occupes = chevauches.filter(r => (r.fields['Statut'] || 'Disponible') !== 'Disponible');
                            if (occupes.length) {
                                const liste = occupes.map(r => `${r.fields['Heure début']} - ${r.fields['Heure fin']} (${r.fields['Statut']})`).join(', ');
                                alert(`⚠️ Ce vol empiète sur des créneaux déjà occupés :\n${liste}\nChoisis un autre horaire.`);
                                return;
                            }
                            if (chevauches.length) {
                                const liste = chevauches.map(r => `${r.fields['Heure début']} - ${r.fields['Heure fin']}`).join(', ');
                                if (!confirm(`⚠️ Ce vol empiète sur ${chevauches.length} créneau(x) libre(s) :\n${liste}\n\nContinuer ? Les créneaux libres chevauchés seront supprimés.`)) return;
                                for (const r of chevauches) {
                                    await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}/${r.id}`, { method: 'DELETE', headers });
                                }
                                champsCreneau['Créneaux remplacés'] = JSON.stringify(chevauches.map(r => ({
                                    'Date': r.fields['Date'], 'Heure début': r.fields['Heure début'],
                                    'Heure fin': r.fields['Heure fin'], 'Type': r.fields['Type']
                                })));
                            }
                            response = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}`, {
                                method: 'POST',
                                headers: headers,
                                body: JSON.stringify({ records: [{ fields: { 'Date': dateStr, 'Heure début': hDebut, 'Heure fin': hFin, 'Type': typeVI, ...champsCreneau } }] })
                            });
                        }
                        if (response.ok) {
                            modal.style.display = 'none';
                            formReservation.reset();
                            setAfficherVIPPlaneur(true);
                            if (typeof enregistrerAudit === 'function') {
                                enregistrerAudit('Création vol d\'initiation', typeVI, `Passager : ${passagerNom} | ${dateStr} ${hDebut} - ${hFin}`, 'Initiation');
                            }
                            await chargerDonneesPlanning(true);
                            await chargerVolsInitiation();
                        } else {
                            const d = await response.json().catch(() => ({}));
                            alert(d.error?.message || 'Erreur lors de la création du vol d\'initiation.');
                        }
                    } catch (error) {
                        console.error(error);
                        alert('Erreur lors de la création du vol d\'initiation.');
                    }
                    return;
                }
                if (isVIPlaneur) {
                    const auteurNom = currentUser ? `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() : '';
                    const recordData = { fields: { "Nom": passagerNom, "Pilote": piloteNom, "Auteur": auteurNom, "Téléphone": telephone, "Date de début": dateDebut, "Date de fin": dateFin, "Commentaire": commentaireVI } };
                    try {
                        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Planeur')}`, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({ records: [recordData] })
                        });
                        if (response.ok) {
                            modal.style.display = 'none';
                            formReservation.reset();
                            setAfficherVIPPlaneur(true);
                            chargerDonneesPlanning(true);
                        }
                    } catch (error) {
                        console.error(error);
                    }
                    return;
                }
                const machineId = getMachineSelectionnee();
                if (!machineId) {
                    alert("Veuillez sélectionner une machine.");
                    return;
                }
                const recordData = {
                    fields: {
                        "Type de vol": typesFinaux.length ? typesFinaux : ['Local'],
                        "Machine": [machineId],
                        "Pilote": piloteNom,
                        "Instructeur": instructeur,
                        "Passager": passagerNom,
                        "Téléphone": telephone,
                        "Email": emailPassager,
                        "Bon cadeau": bonCadeau,
                        "Date de début": dateDebut,
                        "Date de fin": dateFin,
                        "Commentaires VI": commentairesFinal,
                        "Temps estimé": 1
                    }
                };
                let url = `${API_BASE}/${encodeURIComponent('Réservations')}`;
                let methode = idReservationEnEdition ? 'PATCH' : 'POST';
                if (idReservationEnEdition) recordData.id = idReservationEnEdition;
                try {
                    const response = await cachedFetch(url, {
                        method: methode,
                        headers: headers,
                        body: JSON.stringify({ records: [recordData] })
                    });
                    if (response.ok) {
                        modal.style.display = 'none';
                        formReservation.reset();
                        idReservationEnEdition = null;
                        const dateJour = document.getElementById('form-debut').value.split('T')[0];
                        await chargerDonneesPlanning(true);
                        await mettreAJourStatutCreneauxConflit(dateJour, machineId);
                        await chargerVolsInitiation();
                        const viewAeronefs = document.getElementById('view-aeronefs');
                        if (viewAeronefs && viewAeronefs.style.display !== 'none') {
                            chargerSuiviAeronef();
                        }
                    }
                } catch (error) {
                    console.error(error);
                }
                return;
            }
            if (!piloteNom) {
                alert("Le nom du pilote est obligatoire.");
                return;
            }
            const machineId = getMachineSelectionnee();
            if (!machineId) {
                alert("Veuillez sélectionner une machine.");
                return;
            }
            const tempsEstime = parseFloat(document.getElementById('form-estimation').value) || 0;
            const recordData = {
                fields: {
                    "Type de vol": typesFinaux.length ? typesFinaux : ['Local'],
                    "Machine": [machineId],
                    "Pilote": piloteNom,
                    "Instructeur": instructeur,
                    "Date de début": dateDebut,
                    "Date de fin": dateFin,
                    "Commentaires VI": commentairesFinal,
                    "Temps estimé": tempsEstime
                }
            };
            let url = `${API_BASE}/${encodeURIComponent('Réservations')}`;
            let methode = idReservationEnEdition ? 'PATCH' : 'POST';
            if (idReservationEnEdition) recordData.id = idReservationEnEdition;
            try {
                const response = await cachedFetch(url, {
                    method: methode,
                    headers: headers,
                    body: JSON.stringify({ records: [recordData] })
                });
                if (response.ok) {
                    const resData = await response.json();
                    const resaId = resData.records?.[0]?.id || idReservationEnEdition || '';
                    const action = idReservationEnEdition ? 'Modification de réservation' : 'Création de réservation';
                    const avion = (listeAvionsCache || []).find(a => a.id === machineId);
                    const machineNom = (avion && avion.fields && (avion.fields['Immatriculation'] || avion.fields['Nom'])) || machineId;
                    const resaOriginale = idReservationEnEdition ? (listeReservationsCache || []).find(r => r.id === idReservationEnEdition) : null;
                    const ancienDebut = resaOriginale?.fields?.['Date de début'] || '';
                    const ancienFin = resaOriginale?.fields?.['Date de fin'] || '';
                    const piloteNomAudit = nomUtilisateurDepuisId(piloteNom, listeMembresCache) || piloteNom;
                    const details = idReservationEnEdition
                        ? `Pilote : ${piloteNomAudit} | Type : ${typesVol} | Ancien : ${ancienDebut.slice(0,16).replace('T',' ')} - ${ancienFin.slice(0,16).replace('T',' ')} → Nouveau : ${dateDebut.slice(0,16).replace('T',' ')} - ${dateFin.slice(0,16).replace('T',' ')}`
                        : `Pilote : ${piloteNomAudit} | Type : ${typesVol} | ${dateDebut.slice(0,16).replace('T',' ')} - ${dateFin.slice(0,16).replace('T',' ')}`;
                    if (typeof enregistrerAudit === 'function') {
                        console.log('Tentative log audit réservation', { piloteNom, machineNom, resaId, action });
                        await enregistrerAudit(action, machineNom, details, 'Planning');
                    }
                    modal.style.display = 'none';
                    formReservation.reset();
                    idReservationEnEdition = null;
                    const dateJour = document.getElementById('form-debut').value.split('T')[0];
                    await chargerDonneesPlanning(true);
                    await mettreAJourStatutCreneauxConflit(dateJour, machineId);
                    await chargerVolsInitiation();
                    const viewAeronefs = document.getElementById('view-aeronefs');
                    if (viewAeronefs && viewAeronefs.style.display !== 'none') {
                        chargerSuiviAeronef();
                    }
                } else {
                    const data = await response.json().catch(() => ({}));
                    console.error('Échec sauvegarde réservation:', response.status, data.error?.message || data);
                }
            } catch (error) {
                console.error(error);
            }
        });
    }
    if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
            if (!idReservationEnEdition) return;
            const cache = Array.isArray(listeReservationsCache) ? listeReservationsCache : ((listeReservationsCache && listeReservationsCache.records) || []);
            const resa = cache.find(r => r.id === idReservationEnEdition);
            const resaMachine = (resa && resa.fields && resa.fields['Machine'] || [])[0];
            const resaDate = resa && resa.fields && resa.fields['Date de début'] ? formaterDateISO(new Date(resa.fields['Date de début'])) : null;
            if (!confirm("Es-tu sûr de vouloir supprimer cette réservation ?")) return;
            try {
                const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('Réservations')}?records[]=${idReservationEnEdition}`, {
                    method: 'DELETE',
                    headers: headers
                });
                if (response.ok) {
                    const resaPilote = nomUtilisateurDepuisId(resa?.fields?.['Pilote'], listeMembresCache);
                    const resaDebut = resa?.fields?.['Date de début'] || '';
                    const resaFin = resa?.fields?.['Date de fin'] || '';
                    const avion = (listeAvionsCache || []).find(a => a.id === resaMachine);
                    const machineNom = (avion && avion.fields && (avion.fields['Immatriculation'] || avion.fields['Nom'])) || resaMachine;
                    if (typeof enregistrerAudit === 'function') {
                        await enregistrerAudit('Suppression de réservation', machineNom, `Pilote : ${resaPilote} | ${resaDebut.slice(0,16).replace('T',' ')} - ${resaFin.slice(0,16).replace('T',' ')}`, 'Planning');
                    }
                    modal.style.display = 'none';
                    formReservation.reset();
                    idReservationEnEdition = null;
                    await chargerDonneesPlanning(true);
                    if (resaDate && resaMachine) {
                        await mettreAJourStatutCreneauxConflit(resaDate, resaMachine);
                        await chargerVolsInitiation();
                    }
                    const viewAeronefs = document.getElementById('view-aeronefs');
                    if (viewAeronefs && viewAeronefs.style.display !== 'none') {
                        chargerSuiviAeronef();
                    }
                } else {
                    const data = await response.json().catch(() => ({}));
                    console.error('Échec suppression réservation:', response.status, data.error?.message || data);
                }
            } catch (error) {
                console.error(error);
            }
        });
    }
    initGestionnaireModaleVIPlaneur();
}

function ouvrirModaleCreationDepuisGrille(avionId, heureDebutClic) {
    if (!modal) return;
    idReservationEnEdition = null;
    if (titleModal) titleModal.textContent = "Nouvelle Réservation";
    if (btnDelete) btnDelete.style.display = 'none';
    if (groupCommentaires) groupCommentaires.style.display = 'none';
    if (formReservation) formReservation.reset();
    if (listeAvionsCache.length > 0) populerMachinesCases(listeAvionsCache);
    selectionnerMachine(avionId);
    appliquerEtatFormulaire();
    const annee = dateAffichee.getFullYear();
    const mois = (dateAffichee.getMonth() + 1).toString().padStart(2, '0');
    const jour = dateAffichee.getDate().toString().padStart(2, '0');
    document.getElementById('form-debut').value = `${annee}-${mois}-${jour}T${heureDebutClic.toString().padStart(2, '0')}:00`;
    document.getElementById('form-fin').value = `${annee}-${mois}-${jour}T${((heureDebutClic + 2) % 24).toString().padStart(2, '0')}:00`;
    document.getElementById('form-estimation').value = '1.0';
    if (typeof peuplerPiloteSelect === 'function') peuplerPiloteSelect();
    verifierAlertesReservation();
    modal.style.display = 'flex';
}

async function ouvrirModaleEdition(vol, avionIdOuImmat) {
    if (!modal) return;
    const typesVolEdit = Array.isArray(vol.fields?.['Type de vol']) ? vol.fields['Type de vol'] : [vol.fields?.['Type de vol']].filter(Boolean);
    const estVI = typesVolEdit.some(t => ['VI Moteur', 'VI Planeur', "Vol d'Initiation", "Vol d'Initiation (VI)"].includes(t));
    if (!estVI && !peutBougerReservations() && !estProprietaireReservation(vol)) {
        ouvrirModaleInformation(vol);
        return;
    }
    idReservationEnEdition = vol.id;
    if (titleModal) titleModal.textContent = "Modifier la Réservation";
    if (btnDelete) btnDelete.style.display = 'block';
    if (listeAvionsCache.length > 0) {
        populerMachinesCases(listeAvionsCache);
    }
    const typeVol = vol.fields['Type de vol'] || 'Vol Classique';
    cocherTypeVol(typeVol);
    if (typeof peuplerInstructeursSelect === 'function') await peuplerInstructeursSelect();
    if (typeof chargerListeMembresCache === 'function') await chargerListeMembresCache();
    const sel = document.getElementById('form-instructeur');
    if (sel) {
        const saved = vol.fields['Instructeur'];
        let nom = '';
        if (saved) {
            const idInstructeur = Array.isArray(saved) ? saved[0] : saved;
            if (typeof idInstructeur === 'string' && idInstructeur.startsWith('rec')) {
                const found = (typeof listeInstructeursCache !== 'undefined' ? listeInstructeursCache : []).find(i => i.id === idInstructeur);
                nom = found ? found.nomComplet : nomUtilisateurDepuisId(idInstructeur, typeof listeMembresCache !== 'undefined' ? listeMembresCache : []);
            } else {
                nom = String(idInstructeur).trim();
            }
        }
        if (nom && !nom.startsWith('rec')) {
            const options = Array.from(sel.options);
            const match = options.find(o => o.value && typeof correspondanceNom === 'function' && correspondanceNom(o.value, nom));
            if (match) {
                sel.value = match.value;
            } else {
                if (!options.some(o => o.value === nom)) {
                    const opt = document.createElement('option');
                    opt.value = nom;
                    opt.textContent = nom;
                    sel.appendChild(opt);
                }
                sel.value = nom;
            }
        } else {
            sel.value = '';
        }
        sel.dispatchEvent(new Event('maj-affichage'));
    }
    if (typeof peuplerPiloteSelect === 'function') {
        const piloteId = Array.isArray(vol.fields['Pilote']) ? vol.fields['Pilote'][0] : vol.fields['Pilote'];
        await peuplerPiloteSelect(piloteId || null);
    }
    let idTargetMachine = null;
    if (vol.fields && vol.fields['Machine'] && vol.fields['Machine'].length > 0) {
        const rawMachine = vol.fields['Machine'][0];
        if (typeof rawMachine === 'string' && rawMachine.startsWith('rec')) {
            idTargetMachine = rawMachine;
        }
    }
    if (!idTargetMachine && avionIdOuImmat) {
        const targetStr = avionIdOuImmat.toString().trim().toUpperCase();
        const avionTrouve = listeAvionsCache.find(a => {
            const immat = (a.fields['Immatriculation'] || a.fields['Nom'] || '').toString().trim().toUpperCase();
            return a.id.toUpperCase() === targetStr || immat === targetStr;
        });
        if (avionTrouve) {
            idTargetMachine = avionTrouve.id;
        } else {
            idTargetMachine = avionIdOuImmat;
        }
    }
    if (idTargetMachine) {
        selectionnerMachine(idTargetMachine);
    }
    document.getElementById('form-commentaires').value = vol.fields['Commentaires VI'] || '';
    const nomCompletPassager = (vol.fields['Passager'] || '').toString().trim();
    const partiesPassager = nomCompletPassager.split(/\s+/).filter(Boolean);
    if (document.getElementById('form-prenom-passager')) document.getElementById('form-prenom-passager').value = partiesPassager.length > 1 ? partiesPassager[0] : '';
    if (document.getElementById('form-passager')) document.getElementById('form-passager').value = partiesPassager.length > 1 ? partiesPassager.slice(1).join(' ') : nomCompletPassager;
    if (document.getElementById('form-telephone')) document.getElementById('form-telephone').value = vol.fields['Téléphone'] || '';
    if (document.getElementById('form-email')) document.getElementById('form-email').value = vol.fields['Email'] || '';
    if (document.getElementById('form-bon')) document.getElementById('form-bon').value = vol.fields['Bon cadeau'] || '';
    document.getElementById('form-estimation').value = vol.fields['Temps estimé'] || '';
    document.getElementById('form-debut').value = formaterPourInput(new Date(vol.fields['Date de début']));
    document.getElementById('form-fin').value = formaterPourInput(new Date(vol.fields['Date de fin']));
    appliquerEtatFormulaire();
    modal.style.display = 'flex';
}

function ouvrirModaleCreationDepuisGrilleDate(avionId, heureDebutClic, dateCible) {
    if (!modal) return;
    idReservationEnEdition = null;
    if (titleModal) titleModal.textContent = "Nouvelle Réservation";
    if (btnDelete) btnDelete.style.display = 'none';
    if (groupCommentaires) groupCommentaires.style.display = 'none';
    if (formReservation) formReservation.reset();
    if (listeAvionsCache.length > 0) populerMachinesCases(listeAvionsCache);
    selectionnerMachine(avionId);
    appliquerEtatFormulaire();
    const annee = dateCible.getFullYear();
    const mois = (dateCible.getMonth() + 1).toString().padStart(2, '0');
    const jour = dateCible.getDate().toString().padStart(2, '0');
    document.getElementById('form-debut').value = `${annee}-${mois}-${jour}T${heureDebutClic.toString().padStart(2, '0')}:00`;
    document.getElementById('form-fin').value = `${annee}-${mois}-${jour}T${((heureDebutClic + 2) % 24).toString().padStart(2, '0')}:00`;
    document.getElementById('form-estimation').value = '1.0';
    if (typeof peuplerPiloteSelect === 'function') peuplerPiloteSelect();
    verifierAlertesReservation();
    modal.style.display = 'flex';
}

function ouvrirModaleInformation(vol) {
    const infoModal = document.getElementById('reservation-info-modal');
    const content = document.getElementById('reservation-info-content');
    if (!infoModal || !content || !vol || !vol.fields) return;
    const f = vol.fields;
    const pilote = nomUtilisateurDepuisId(f['Pilote'], listeMembresCache) || '—';
    let machine = f['Machine'] || '—';
    if (Array.isArray(machine) && machine.length > 0) {
        const raw = machine[0];
        if (typeof raw === 'string' && raw.startsWith('rec')) {
            const avion = (listeAvionsCache || []).find(a => a.id === raw);
            machine = avion ? (avion.fields['Immatriculation'] || avion.fields['Nom'] || raw) : raw;
        } else {
            machine = raw;
        }
    }
    const type = Array.isArray(f['Type de vol']) ? f['Type de vol'].join(', ') : (f['Type de vol'] || '—');
    const instructeurRaw = f['Instructeur'];
    let instructeur = '—';
    if (instructeurRaw) {
        const idInstructeur = Array.isArray(instructeurRaw) ? instructeurRaw[0] : instructeurRaw;
        if (typeof listeInstructeursCache !== 'undefined' && listeInstructeursCache.length) {
            const found = listeInstructeursCache.find(i => i.id === idInstructeur || i.nomComplet === idInstructeur);
            instructeur = found ? found.nomComplet : idInstructeur;
        } else {
            instructeur = idInstructeur;
        }
    }
    const debut = f['Date de début'] ? formaterDateHeureLocal(new Date(f['Date de début'])) : '—';
    const fin = f['Date de fin'] ? formaterDateHeureLocal(new Date(f['Date de fin'])) : '—';
    const duree = f['Temps estimé'] || '—';
    const commentaires = f['Commentaires'] || f['Commentaires VI'] || '';
    content.innerHTML = `
        <p><strong>Pilote :</strong> ${pilote}</p>
        <p><strong>Machine :</strong> ${machine}</p>
        <p><strong>Type de vol :</strong> ${type}</p>
        <p><strong>Instructeur :</strong> ${instructeur}</p>
        <p><strong>Début :</strong> ${debut}</p>
        <p><strong>Fin :</strong> ${fin}</p>
        <p><strong>Durée estimée :</strong> ${duree}</p>
        ${commentaires ? `<p><strong>Commentaires :</strong> ${commentaires}</p>` : ''}
    `;
    infoModal.style.display = 'flex';
}

function initBoutonsNavigation() {
    if (document.getElementById('btn-prev')) {
        document.getElementById('btn-prev').addEventListener('click', () => {
            dateAffichee.setDate(dateAffichee.getDate() - 1);
            listeReservationsCache = [];
            mettreAJourDateAffichee();
            chargerDonneesPlanning();
            if (typeof rafraichirMiniCalendrier === 'function') rafraichirMiniCalendrier();
            if (typeof chargerEvenementsJour === 'function') chargerEvenementsJour();
        });
    }
    if (document.getElementById('btn-next')) {
        document.getElementById('btn-next').addEventListener('click', () => {
            dateAffichee.setDate(dateAffichee.getDate() + 1);
            listeReservationsCache = [];
            mettreAJourDateAffichee();
            chargerDonneesPlanning();
            if (typeof rafraichirMiniCalendrier === 'function') rafraichirMiniCalendrier();
            if (typeof chargerEvenementsJour === 'function') chargerEvenementsJour();
        });
    }
    const currentDateEl = document.getElementById('current-date');
    if (currentDateEl) {
        currentDateEl.style.cursor = 'pointer';
        currentDateEl.title = 'Cliquer pour choisir une date';
        currentDateEl.addEventListener('click', async () => {
            const iso = await demanderDateModal(dateAffichee);
            if (iso) {
                const [y, m, d] = iso.split('-').map(Number);
                if (d && m && y) {
                    dateAffichee = new Date(y, m - 1, d, 12, 0, 0);
                    listeReservationsCache = [];
                    mettreAJourDateAffichee();
                    chargerDonneesPlanning();
                    if (typeof rafraichirMiniCalendrier === 'function') rafraichirMiniCalendrier();
                    if (typeof chargerEvenementsJour === 'function') chargerEvenementsJour();
                }
            }
        });
    }
    const btnToggleVIP = document.getElementById('btn-toggle-vi-planeur');
    if (btnToggleVIP) {
        btnToggleVIP.addEventListener('click', () => {
            setAfficherVIPPlaneur(!afficherVIPPlaneur);
            chargerDonneesPlanning(false, false);
        });
    }
    const btnLegende = document.getElementById('btn-legende-couleurs');
    if (btnLegende) {
        btnLegende.addEventListener('click', () => {
            const item = (color, label) => `<div class="legende-ligne"><span class="legende-pastille" style="background:${color};"></span><span>${label}</span></div>`;
            const rond = (color, label) => `<div class="legende-ligne"><span class="legende-pastille" style="background:${color}; width:14px; height:14px; border-radius:50%; border-left:none; margin:0 6px;"></span><span>${label}</span></div>`;
            afficherModaleAlerte('Légende des couleurs', `
                ${item('#ff6e40', 'Réservation')}
                ${item('#3b82f6', 'Instruction / avec instructeur')}
                ${item('#eab308', 'Remorquage')}
                ${item('#e11d48', "Vol d'initiation (pilote attribué)")}
                ${item('#00adb5', "Vol d'initiation à pourvoir")}
                ${item('#8e44ad', 'VI Planeur')}
                ${item('#10b981', 'Mes réservations')}
                ${item('#475569', 'Vol effectué (carnet de route)')}
                <hr class="legende-separateur">
                ${item('rgba(34,197,94,0.45)', 'Instructeur disponible')}
                ${item('rgba(239,68,68,0.45)', 'Instructeur indisponible')}
                <hr class="legende-separateur">
                <div class="legende-ligne"><span class="legende-pastille" style="background:repeating-linear-gradient(45deg, rgba(30,61,89,.4), rgba(30,61,89,.4) 4px, rgba(30,61,89,.15) 4px, rgba(30,61,89,.15) 8px); border-left-color:rgba(30,61,89,.6);"></span><span>Nuit aéronautique</span></div>
                ${item('rgba(135,175,215,0.45)', 'Aube / crépuscule civil')}
                <hr class="legende-separateur">
                ${rond('#2ecc71', 'Machine : potentiel OK (> 10h)')}
                ${rond('#f39c12', 'Machine : alerte révision (≤ 10h)')}
                ${rond('#e74c3c', 'Machine : potentiel épuisé (≤ 0h)')}
            `, 'ℹ️');
        });
    }
}

// --- FONCTIONS POUR L'ONGLET VOL D'INITIATION ---
function getNomMachine(machineId) {
    if (!machineId) return '';
    const avion = (listeAvionsCache || []).find(a => a.id === machineId);
    return avion ? (avion.fields['Immatriculation'] || avion.fields['Nom'] || 'Inconnu') : '';
}

function estUtilisateurCourant(nom) {
    if (!nom || typeof currentUser === 'undefined' || !currentUser) return false;
    const n = nom.toString().trim();
    const current = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
    if (!current) return false;
    const formater = typeof formaterNomPilote === 'function' ? formaterNomPilote : x => x;
    return formater(n).toLowerCase() === current.toLowerCase();
}

function normaliserVolsInitiation() {
    const vols = [];
    listeVolsInitiationCache.forEach(record => {
        const source = record.source;
        const debut = new Date(record.debut);
        const fin = new Date(record.fin);
        if (isNaN(debut) || isNaN(fin)) return;
        const heureDebut = `${String(debut.getHours()).padStart(2, '0')}:${String(debut.getMinutes()).padStart(2, '0')}`;
        const heureFin = `${String(fin.getHours()).padStart(2, '0')}:${String(fin.getMinutes()).padStart(2, '0')}`;
        const pilote = (record.pilote || '').toString().trim();
        const statut = record.statut;
        let conflit = false;
        let categorie;
        if (source === 'creneau') {
            if (statut === 'Disponible' || statut === 'Bloqué') {
                categorie = 'creneaux';
                if (statut === 'Disponible') {
                    if (record.type === 'VIP') {
                        conflit = (listeVolsInitiationCache || []).some(other => other.source === 'planeur' && new Date(other.debut) < fin && new Date(other.fin) > debut);
                    } else if (record.type === 'VIULM' || record.type === 'VIA') {
                        const expectedImmat = record.type === 'VIULM' ? 'F-JVIO' : 'F-GASB';
                        conflit = (listeReservationsConflits || []).some(r => {
                            const machineId = (r.fields['Machine'] || [])[0];
                            const avion = (listeAvionsCache || []).find(a => a.id === machineId);
                            const immat = (avion ? (avion.fields['Immatriculation'] || '') : '').toString().trim().toUpperCase();
                            if (immat !== expectedImmat) return false;
                            const resDebut = new Date(r.fields['Date de début']);
                            const resFin = new Date(r.fields['Date de fin']);
                            return resDebut < fin && resFin > debut;
                        });
                    }
                }
            } else if (statut === 'Réservé') {
                categorie = pilote ? 'pris' : 'apourvoir';
            } else {
                return; // Annulé
            }
        } else {
            categorie = pilote ? 'pris' : 'apourvoir';
        }
        const dateStr = debut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        let classe = categorie;
        if (categorie === 'creneaux') classe = (statut === 'Bloqué' || conflit) ? 'bloque' : 'disponible';
        vols.push({
            ...record,
            heureDebut,
            heureFin,
            dateStr,
            categorie,
            classe
        });
    });
    return vols.sort((a, b) => new Date(a.debut) - new Date(b.debut));
}

function normaliserRechercheVI(s) {
    return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9@.+-]/g, '');
}

function afficherVolsInitiation() {
    const container = document.getElementById('initiation-list');
    if (!container) return;
    const maintenant = new Date();
    const terme = normaliserRechercheVI(document.getElementById('recherche-vi') ? document.getElementById('recherche-vi').value : '');
    const vols = normaliserVolsInitiation().filter(v => {
        if (!filtreTypesInitiation.includes(v.type)) return false;
        if (terme) {
            if (!v.passager && !v.email && !v.telephone) return false;
            const cible = normaliserRechercheVI(`${v.passager || ''} ${v.email || ''} ${v.telephone || ''}`);
            return cible.includes(terme);
        }
        const passe = new Date(v.debut) < maintenant;
        if (filtreInitiationActif === 'archives') return passe;
        return !passe && v.categorie === filtreInitiationActif;
    });
    const estArchive = filtreInitiationActif === 'archives';
    if (vols.length === 0) {
        const messages = {
            apourvoir: 'Aucun vol d\'initiation à pourvoir.',
            pris: 'Aucun vol d\'initiation déjà pris.',
            creneaux: 'Aucun créneau disponible.',
            archives: 'Aucun créneau passé.'
        };
        const message = terme ? 'Aucune réservation ne correspond à cette recherche.' : (messages[filtreInitiationActif] || 'Aucun vol.');
        container.innerHTML = `<div class="initiation-empty">${message}</div>`;
        return;
    }
    container.innerHTML = '';
    const regrouperParJour = filtreInitiationActif === 'creneaux';
    if (regrouperParJour) {
        const barre = document.createElement('div');
        barre.className = 'initiation-selection-barre';
        barre.innerHTML = `
            <label><input type="checkbox" id="creneau-tout"> Tout</label>
            <span id="creneau-sel-compteur">0 sélectionné(s)</span>
            <button type="button" id="btn-suppr-selection" class="btn-supprimer-selection" disabled>Supprimer la sélection</button>`;
        container.appendChild(barre);
    }
    if (filtreInitiationActif === 'archives' && hasRoleGestionVI()) {
        const sansPassager = vols.filter(v => !v.passager);
        const barreArch = document.createElement('div');
        barreArch.className = 'initiation-selection-barre';
        barreArch.innerHTML = `
            <span>🧹 ${sansPassager.length} vol(s) sans passager</span>
            <button type="button" id="btn-purge-archives" class="btn-supprimer-selection" ${sansPassager.length ? '' : 'disabled'}>Supprimer les vols sans passager</button>`;
        container.appendChild(barreArch);
        const btnPurge = barreArch.querySelector('#btn-purge-archives');
        if (btnPurge) btnPurge.addEventListener('click', () => nettoyerArchivesVI(vols));
    }
    let dernierJourAffiche = '';
    vols.forEach(vol => {
        if (regrouperParJour && vol.dateStr !== dernierJourAffiche) {
            dernierJourAffiche = vol.dateStr;
            const titreJour = document.createElement('div');
            titreJour.className = 'initiation-jour-titre';
            titreJour.textContent = `📅 ${vol.dateStr}`;
            container.appendChild(titreJour);
        }
        const isAdminCreneaux = vol.categorie === 'creneaux';
        const isAPourvoir = vol.categorie === 'apourvoir';
        const isPris = vol.categorie === 'pris';
        const typeText = vol.type || (vol.source === 'planeur' ? 'Planeur' : (vol.source === 'moteur' ? 'Moteur' : 'VI'));
        let piloteText;
        let nomClient;
        if (vol.classe === 'bloque') {
            piloteText = '🔒 Créneau bloqué';
            nomClient = `Créneau ${typeText} — conflit machine`;
        } else if (isAdminCreneaux) {
            piloteText = '🕓 Créneau disponible';
            nomClient = `Créneau ${typeText}`;
        } else if (isAPourvoir) {
            piloteText = '👤 À pourvoir';
            nomClient = vol.passager || 'Passager non renseigné';
        } else {
            piloteText = `👤 Pilote : ${formaterNomPilote(vol.pilote)}`;
            nomClient = vol.passager || 'Passager non renseigné';
        }
        const machineText = vol.source === 'moteur' && vol.machineName ? `🛩️ ${vol.machineName}<br>` : '';
        const peutSInscrire = !estArchive && isAPourvoir && hasRolePiloteVI() && piloteAutoriseSurTypeVI((currentUser || {}).roles || [], vol.type);
        const boutonSInscrire = peutSInscrire ? `<button class="btn-reserver-initiation" data-id="${vol.id}" data-source="${vol.source}">S'inscrire</button>` : '';
        const rolesInscrireAutre = ['Super admin', 'Gestion VI', 'Instructeur avion', 'Instructeur planeur', 'Instructeur ULM'];
        const peutInscrireAutre = !estArchive && isAPourvoir && (currentUser?.roles || []).some(r => rolesInscrireAutre.includes(r));
        const volData = encodeURIComponent(JSON.stringify({ id: vol.id, source: vol.source, type: vol.type }));
        const boutonInscrireAutre = peutInscrireAutre ? `<button class="btn-reserver-initiation" data-inscrire-autre="1" data-id="${vol.id}" data-source="${vol.source}" data-vol="${volData}">Inscrire autre</button>` : '';
        const caseSelection = regrouperParJour && vol.categorie === 'creneaux'
            ? `<input type="checkbox" class="creneau-check" data-id="${vol.id}" title="Sélectionner pour suppression groupée">` : '';
        const gestionVI = hasRoleGestionVI();
        const peutGerer = !estArchive && (isAPourvoir || isPris) && peutGererVolVI(vol);
        const boutonLiberer = peutGerer
            ? `<button class="btn-liberer-initiation" title="Retirer le passager et remettre le créneau à disposition">Libérer</button>` : '';
        const boutonDecaler = (peutGerer && vol.passager)
            ? `<button class="btn-decaler-initiation" title="Déplacer cette réservation sur un autre créneau">Décaler le vol</button>` : '';
        const boutonPilote = (!estArchive && isPris && vol.pilote && (gestionVI || hasRolePiloteVI()))
            ? `<button class="btn-pilote-initiation" title="Changer le pilote attribué à ce vol">Changer de pilote</button>` : '';
        const boutonSupprimer = gestionVI
            ? `<button class="btn-supprimer-initiation" title="Supprimer">✕</button>` : '';
        const card = document.createElement('div');
        const classeType = `type-${(vol.type || 'vi').toLowerCase()}`;
        card.className = `initiation-card ${vol.classe} ${classeType}`;
        if (isAdminCreneaux) {
            card.classList.add('initiation-card-compact');
            card.innerHTML = `
                <div class="initiation-info initiation-info-compact">
                    <h4>🎯 ${typeText}</h4>
                    <p>📅 ${vol.dateStr} • ${vol.heureDebut} - ${vol.heureFin}</p>
                </div>
                <div class="initiation-meta">
                    <strong>${piloteText}</strong>
                    ${caseSelection}
                    ${boutonSupprimer}
                </div>
            `;
        } else {
            card.innerHTML = `
                <div class="initiation-info">
                    <h4>🎯 ${typeText} — ${nomClient}</h4>
                    <p>📅 ${vol.dateStr} • ${vol.heureDebut} - ${vol.heureFin}</p>
                    <p>${machineText}📞 ${vol.telephone || 'Non renseigné'}</p>
                    ${vol.commentaire ? `<p style="margin-top:6px; font-style:italic;">💬 ${vol.commentaire}</p>` : ''}
                </div>
                <div class="initiation-meta">
                    <strong>${piloteText}</strong>
                    ${boutonSInscrire}
                    ${boutonInscrireAutre}
                    ${boutonPilote}
                    ${boutonDecaler}
                    ${boutonLiberer}
                    ${boutonSupprimer}
                </div>
            `;
        }
        const btnLiberer = card.querySelector('.btn-liberer-initiation');
        if (btnLiberer) btnLiberer.addEventListener('click', (e) => {
            e.stopPropagation();
            libererCreneauVI(vol);
        });
        if (isAdminCreneaux) {
            card.style.cursor = 'pointer';
            card.title = 'Cliquer pour réserver ce créneau au nom d\'un passager';
            card.addEventListener('click', (e) => {
                if (e.target.closest('button, input')) return;
                ouvrirResaAdminVI(vol);
            });
        }
        const btnDecaler = card.querySelector('.btn-decaler-initiation');
        if (btnDecaler) btnDecaler.addEventListener('click', async (e) => {
            e.stopPropagation();
            await decalerVolVI(vol);
        });
        const btnPilote = card.querySelector('.btn-pilote-initiation');
        if (btnPilote) btnPilote.addEventListener('click', (e) => {
            e.stopPropagation();
            ouvrirChoixPiloteVI(vol);
        });
        const btnSupprCard = card.querySelector('.btn-supprimer-initiation');
        if (btnSupprCard) btnSupprCard.addEventListener('click', (e) => {
            e.stopPropagation();
            supprimerVolInitiation(vol);
        });
        container.appendChild(card);
    });
    if (regrouperParJour) {
        const cbs = [...container.querySelectorAll('.creneau-check')];
        const tout = container.querySelector('#creneau-tout');
        const btnSel = container.querySelector('#btn-suppr-selection');
        const compteur = container.querySelector('#creneau-sel-compteur');
        const maj = () => {
            const n = cbs.filter(c => c.checked).length;
            if (compteur) compteur.textContent = `${n} sélectionné(s)`;
            if (btnSel) btnSel.disabled = n === 0;
            if (tout) tout.checked = n > 0 && n === cbs.length;
        };
        cbs.forEach(c => c.addEventListener('change', maj));
        if (tout) tout.addEventListener('change', () => { cbs.forEach(c => c.checked = tout.checked); maj(); });
        if (btnSel) btnSel.addEventListener('click', () => supprimerCreneauxSelection(cbs.filter(c => c.checked).map(c => c.dataset.id)));
    }
}

async function decalerVolVI(vol) {
    if (!peutGererVolVI(vol)) return;
    if (vol.source !== 'creneau') {
        const tokenConverti = await convertirVolEnCreneauVI(vol);
        if (!tokenConverti) return;
        window.open(`${URL_RESERVER_VI}?token=${encodeURIComponent(tokenConverti)}&decalage=1`, '_blank');
        return;
    }
    let token = vol.token;
    if (!token) {
        token = 'tok' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
        try {
            const r = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ records: [{ id: vol.id, fields: { 'Token': token } }] })
            });
            if (!r.ok) { alert('Impossible de préparer le lien de décalage.'); return; }
            vol.token = token;
        } catch (err) {
            alert('Impossible de préparer le lien de décalage.');
            return;
        }
    }
    window.open(`${URL_RESERVER_VI}?token=${encodeURIComponent(token)}&decalage=1`, '_blank');
}

let volActionsVI = null;
function ouvrirActionsVI(vol) {
    const modal = document.getElementById('vi-actions-modal');
    if (!modal || !vol) return;
    const debut = new Date(vol.debut);
    const fin = new Date(vol.fin);
    const pad2 = n => String(n).padStart(2, '0');
    volActionsVI = {
        id: vol.id,
        source: vol.source,
        passager: vol.passager || '',
        pilote: (vol.pilote || '').toString().trim(),
        telephone: vol.telephone || '',
        commentaire: vol.commentaire || '',
        token: vol.token || '',
        type: vol.type || 'VI',
        machineName: vol.machineName || '',
        debut: vol.debut,
        fin: vol.fin,
        dateStr: debut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
        heureDebut: `${pad2(debut.getHours())}:${pad2(debut.getMinutes())}`,
        heureFin: `${pad2(fin.getHours())}:${pad2(fin.getMinutes())}`
    };
    const titre = document.getElementById('vi-actions-titre');
    const info = document.getElementById('vi-actions-info');
    if (titre) titre.textContent = `${volActionsVI.type} — ${volActionsVI.passager || 'Passager non renseigné'}`;
    if (info) info.textContent = `${volActionsVI.dateStr} • ${volActionsVI.heureDebut} - ${volActionsVI.heureFin}${volActionsVI.pilote ? ' • Pilote : ' + formaterNomPilote(volActionsVI.pilote) : ' • À pourvoir'}`;
    const aPourvoir = !volActionsVI.pilote;
    const gestionVI = hasRoleGestionVI();
    const elInscrire = document.getElementById('vi-act-inscrire');
    const elInscrireAutre = document.getElementById('vi-act-inscrire-autre');
    const elDecaler = document.getElementById('vi-act-decaler');
    const elLiberer = document.getElementById('vi-act-liberer');
    const elSupprimer = document.getElementById('vi-act-supprimer');
    if (elInscrire) elInscrire.style.display = (aPourvoir && hasRolePiloteVI() && piloteAutoriseSurTypeVI((currentUser || {}).roles || [], volActionsVI.type)) ? '' : 'none';
    const rolesInscrireAutre = ['Super admin', 'Gestion VI', 'Instructeur avion', 'Instructeur planeur', 'Instructeur ULM'];
    if (elInscrireAutre) elInscrireAutre.style.display = (aPourvoir && (currentUser?.roles || []).some(r => rolesInscrireAutre.includes(r))) ? '' : 'none';
    const peutGererCeVol = peutGererVolVI(volActionsVI);
    if (elDecaler) elDecaler.style.display = (peutGererCeVol && volActionsVI.passager) ? '' : 'none';
    if (elLiberer) elLiberer.style.display = peutGererCeVol ? '' : 'none';
    if (elSupprimer) elSupprimer.style.display = gestionVI ? '' : 'none';
    modal.style.display = 'flex';
}

async function convertirVolEnCreneauVI(vol) {
    const debut = new Date(vol.debut);
    const fin = new Date(vol.fin);
    if (isNaN(debut.getTime()) || isNaN(fin.getTime())) {
        alert('Dates du vol invalides, décalage impossible.');
        return null;
    }
    const pad2 = n => String(n).padStart(2, '0');
    const dateStr = `${debut.getFullYear()}-${pad2(debut.getMonth() + 1)}-${pad2(debut.getDate())}`;
    const hDebut = `${pad2(debut.getHours())}:${pad2(debut.getMinutes())}`;
    const hFin = `${pad2(fin.getHours())}:${pad2(fin.getMinutes())}`;
    let typeVI = vol.type;
    if (!['VIP', 'VIA', 'VIULM'].includes(typeVI)) {
        typeVI = vol.source === 'planeur' ? 'VIP' : ((vol.machineName || '') === 'F-JVIO' ? 'VIULM' : 'VIA');
    }
    const parties = (vol.passager || '').trim().split(/\s+/).filter(Boolean);
    const champs = {
        'Statut': 'Réservé',
        'Prénom': parties.length > 1 ? parties[0] : '',
        'Nom': parties.length > 1 ? parties.slice(1).join(' ') : (parties[0] || ''),
        'Email': vol.email || '',
        'Téléphone': vol.telephone || '',
        'Pilote': (vol.pilote || '').toString().trim(),
        'Commentaire': vol.commentaire || '',
        'Token': 'tok' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14),
        'Date réservation': new Date().toISOString()
    };
    try {
        const formJour = `DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${dateStr}'`;
        const resJour = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}?filterByFormula=${encodeURIComponent(formJour)}&pageSize=100`, { headers }, API_CACHE_TTL, true);
        const dataJour = await resJour.json();
        const toMin = h => { const p = (h || '00:00').split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); };
        const dMin = toMin(hDebut);
        const fMin = toMin(hFin);
        const memeType = (dataJour.records || []).filter(r => {
            const f = r.fields || {};
            return f['Statut'] !== 'Annulé' && (f['Type'] || 'VI') === typeVI;
        });
        const existant = memeType.find(r => r.fields['Heure début'] === hDebut && r.fields['Heure fin'] === hFin);
        const chevauches = memeType.filter(r => toMin(r.fields['Heure début']) < fMin && toMin(r.fields['Heure fin']) > dMin);
        let ok = false;
        if (existant) {
            if ((existant.fields['Statut'] || 'Disponible') !== 'Disponible') {
                alert(`Un créneau ${typeVI} existe déjà à cet horaire (statut : ${existant.fields['Statut']}). Décalage impossible.`);
                return null;
            }
            const r = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ records: [{ id: existant.id, fields: champs }] })
            });
            ok = r.ok;
        } else {
            const occupes = chevauches.filter(r => (r.fields['Statut'] || 'Disponible') !== 'Disponible');
            if (occupes.length) {
                const liste = occupes.map(r => `${r.fields['Heure début']} - ${r.fields['Heure fin']} (${r.fields['Statut']})`).join(', ');
                alert(`⚠️ Ce vol empiète sur des créneaux déjà occupés :\n${liste}\nDécalage impossible.`);
                return null;
            }
            if (chevauches.length) {
                const liste = chevauches.map(r => `${r.fields['Heure début']} - ${r.fields['Heure fin']}`).join(', ');
                if (!confirm(`⚠️ Ce vol empiète sur ${chevauches.length} créneau(x) libre(s) :\n${liste}\n\nContinuer ? Les créneaux libres chevauchés seront supprimés.`)) return null;
                for (const r of chevauches) {
                    await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}/${r.id}`, { method: 'DELETE', headers });
                }
                champs['Créneaux remplacés'] = JSON.stringify(chevauches.map(r => ({
                    'Date': r.fields['Date'], 'Heure début': r.fields['Heure début'],
                    'Heure fin': r.fields['Heure fin'], 'Type': r.fields['Type']
                })));
            }
            const r = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ records: [{ fields: { 'Date': dateStr, 'Heure début': hDebut, 'Heure fin': hFin, 'Type': typeVI, ...champs } }] })
            });
            if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                alert(d.error?.message || 'Impossible de préparer le lien de décalage.');
                return null;
            }
            ok = true;
        }
        if (!ok) {
            alert('Impossible de préparer le lien de décalage.');
            return null;
        }
        const ancienneTable = vol.source === 'moteur' ? 'Réservations' : 'VI Planeur';
        await cachedFetch(`${API_BASE}/${encodeURIComponent(ancienneTable)}/${vol.id}`, { method: 'DELETE', headers });
        if (typeof enregistrerAudit === 'function') {
            enregistrerAudit('Conversion VI en créneau', typeVI, `Passager : ${vol.passager || ''} | ${dateStr} ${hDebut} - ${hFin}`, 'Initiation');
        }
        await chargerVolsInitiation();
        await chargerDonneesPlanning(true);
        return champs['Token'];
    } catch (err) {
        console.error(err);
        alert('Impossible de préparer le lien de décalage.');
        return null;
    }
}

async function nettoyerArchivesVI(vols) {
    const cibles = (vols || []).filter(v => !v.passager && v.id);
    if (!cibles.length) return;
    if (!confirm(`Supprimer définitivement ${cibles.length} vol(s) sans passager des archives ?`)) return;
    const parTable = {};
    cibles.forEach(v => {
        const table = v.source === 'moteur' ? 'Réservations' : (v.source === 'creneau' ? 'VI Créneaux' : 'VI Planeur');
        (parTable[table] = parTable[table] || []).push(v.id);
    });
    try {
        for (const [table, ids] of Object.entries(parTable)) {
            const qs = ids.map(id => `records[]=${encodeURIComponent(id)}`).join('&');
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(table)}?${qs}`, {
                method: 'DELETE',
                headers
            });
            if (!res.ok) throw new Error('Suppression échouée');
        }
        if (typeof enregistrerAudit === 'function') {
            const pilote = nomPiloteCourant();
            await enregistrerAudit('Purge archives VI', 'VI', `Pilote : ${pilote} | ${cibles.length} vol(s) sans passager supprimés`, 'Initiation');
        }
        if (typeof chargerVolsInitiation === 'function') await chargerVolsInitiation();
        if (typeof chargerDonneesPlanning === 'function') await chargerDonneesPlanning();
    } catch (error) {
        console.error(error);
        alert('Erreur lors de la suppression.');
    }
}

async function supprimerCreneauxSelection(ids) {
    if (!hasRoleGestionVI()) return;
    if (!ids || !ids.length) return;
    if (!confirm(`Supprimer ${ids.length} créneau(x) sélectionné(s) ?`)) return;
    try {
        const qs = ids.map(id => `records[]=${encodeURIComponent(id)}`).join('&');
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}?${qs}`, {
            method: 'DELETE',
            headers
        });
        if (res.ok) {
            if (typeof enregistrerAudit === 'function') {
                const pilote = nomPiloteCourant();
                await enregistrerAudit('Suppression créneaux VI', 'VI', `Pilote : ${pilote} | Nombre : ${ids.length}`, 'Initiation');
            }
            if (typeof chargerVolsInitiation === 'function') await chargerVolsInitiation();
            if (typeof chargerDonneesPlanning === 'function') await chargerDonneesPlanning();
        } else {
            alert('Erreur lors de la suppression.');
        }
    } catch (error) {
        console.error(error);
        alert('Erreur lors de la suppression.');
    }
}

async function libererCreneauVI(vol) {
    if (!peutGererVolVI(vol)) return;
    if (!vol || !vol.id) return;
    const table = vol.source === 'moteur' ? 'Réservations' : (vol.source === 'creneau' ? 'VI Créneaux' : 'VI Planeur');
    const champs = vol.source === 'creneau'
        ? { 'Statut': 'Disponible', 'Prénom': null, 'Nom': null, 'Email': null, 'Téléphone': null, 'Bon cadeau': null, 'Token': null, 'Date réservation': null }
        : (vol.source === 'planeur' ? { 'Nom': null, 'Téléphone': null } : { 'Passager': null, 'Téléphone': null });
    const detail = [vol.passager, vol.dateStr, `${vol.heureDebut || ''} - ${vol.heureFin || ''}`].filter(Boolean).join(' • ');
    afficherModaleConfirmation(
        'Libérer ce créneau ?',
        `<p><strong>${escapeHtml(detail || 'Créneau')}</strong></p><p>Les informations du passager seront effacées et le créneau redeviendra disponible.</p>`,
        async () => {
            try {
                const response = await cachedFetch(`${API_BASE}/${encodeURIComponent(table)}`, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({ records: [{
                        id: vol.id,
                        fields: champs
                    }] })
                });
                if (response.ok) {
                    if (typeof enregistrerAudit === 'function') {
                        const pilote = nomPiloteCourant();
                        await enregistrerAudit('Libération créneau VI', vol.type || 'VI', `Pilote : ${pilote} | ${detail}`, 'Initiation');
                    }
                    if (typeof chargerVolsInitiation === 'function') await chargerVolsInitiation();
                    if (typeof chargerDonneesPlanning === 'function') await chargerDonneesPlanning();
                } else {
                    afficherModaleAlerte('Erreur', '<p>La libération a échoué.</p>', '⚠️');
                }
            } catch (error) {
                console.error(error);
                afficherModaleAlerte('Erreur', '<p>La libération a échoué.</p>', '⚠️');
            }
        }
    );
}

let volPiloteModale = null;
async function ouvrirChoixPiloteVI(vol) {
    const modal = document.getElementById('vi-pilote-modal');
    if (!modal) return;
    volPiloteModale = vol;
    const info = document.getElementById('vi-pilote-info');
    if (info) info.textContent = `${vol.passager || 'Créneau'} — ${vol.dateStr} • ${vol.heureDebut} - ${vol.heureFin}`;
    await peuplerSelectPilotesVI((vol.pilote || '').toString().trim(), 'vi-pilote-select', vol.type);
    modal.style.display = 'flex';
}

async function validerChoixPiloteVI() {
    const vol = volPiloteModale;
    const sel = document.getElementById('vi-pilote-select');
    if (!vol || !sel) return;
    const nom = sel.value || null;
    if (nom) {
        const membreChoisi = (listeMembresCache || []).find(m => {
            const f = m.fields || {};
            const nc = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
            return nc === nom || (typeof correspondanceNom === 'function' && correspondanceNom(nc, nom));
        });
        if (membreChoisi && !piloteAutoriseSurTypeVI((membreChoisi.fields || {})['Rôles'] || [], vol.type)) {
            alert('Ce pilote n\'est pas instructeur de la discipline de ce vol.');
            return;
        }
    }
    const table = vol.source === 'moteur' ? 'Réservations' : (vol.source === 'creneau' ? 'VI Créneaux' : 'VI Planeur');
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(table)}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ records: [{ id: vol.id, fields: { 'Pilote': nom } }] })
        });
        if (!res.ok) throw new Error('Echec');
        document.getElementById('vi-pilote-modal').style.display = 'none';
        if (typeof enregistrerAudit === 'function') {
            await enregistrerAudit('Changement pilote VI', vol.type || 'VI', `Pilote : ${nomPiloteCourant()} | Nouveau pilote : ${nom || 'Aucun'} | ${vol.dateStr} ${vol.heureDebut}-${vol.heureFin}`, 'Initiation');
        }
        await chargerVolsInitiation();
        if (typeof chargerDonneesPlanning === 'function') await chargerDonneesPlanning();
    } catch (e) {
        console.error(e);
        alert('Erreur lors de l\'attribution du pilote.');
    }
}

let volResaAdmin = null;
function ouvrirResaAdminVI(vol) {
    const modal = document.getElementById('vi-resa-modal');
    if (!modal) return;
    volResaAdmin = vol;
    const info = document.getElementById('vi-resa-info');
    if (info) info.textContent = `${vol.type || 'VI'} — ${vol.dateStr} • ${vol.heureDebut} - ${vol.heureFin}`;
    ['prenom', 'nom', 'email', 'tel', 'bon'].forEach(k => {
        const el = document.getElementById('vi-resa-' + k);
        if (el) el.value = '';
    });
    modal.style.display = 'flex';
}

async function validerResaAdminVI(e) {
    if (e) e.preventDefault();
    const vol = volResaAdmin;
    if (!vol) return;
    const prenom = document.getElementById('vi-resa-prenom').value.trim();
    const nom = document.getElementById('vi-resa-nom').value.trim();
    const email = document.getElementById('vi-resa-email').value.trim();
    const tel = document.getElementById('vi-resa-tel').value.trim();
    const bon = document.getElementById('vi-resa-bon').value.trim();
    if (!prenom || !nom || !email || !tel) {
        alert('Prénom, nom, email et téléphone sont obligatoires.');
        return;
    }
    const token = 'tok' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ records: [{ id: vol.id, fields: {
                'Statut': 'Réservé',
                'Prénom': prenom,
                'Nom': nom,
                'Email': email,
                'Téléphone': tel,
                'Bon cadeau': bon,
                'Token': token,
                'Date réservation': new Date().toISOString()
            }}] })
        });
        if (!res.ok) throw new Error('Echec');
        document.getElementById('vi-resa-modal').style.display = 'none';
        if (typeof enregistrerAudit === 'function') {
            await enregistrerAudit('Réservation créneau VI (admin)', vol.type || 'VI', `Passager : ${prenom} ${nom} | Email : ${email} | Tél. : ${tel} | 📅 ${vol.dateStr} • 🕐 ${vol.heureDebut} - ${vol.heureFin}`, 'Initiation');
        }
        await chargerVolsInitiation();
        if (typeof chargerDonneesPlanning === 'function') await chargerDonneesPlanning();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la réservation.');
    }
}

async function chargerVolsInitiation() {
    const container = document.getElementById('initiation-list');
    if (container) container.innerHTML = "<div class='loading'>Chargement des vols d'initiation...</div>";
    try {
        const urlVIPlaneur = `${API_BASE}/${encodeURIComponent('VI Planeur')}?pageSize=100&sort[0][field]=${encodeURIComponent('Date de début')}&sort[0][direction]=asc`;
        const resVI = await cachedFetch(urlVIPlaneur, { headers });
        const dataVI = await resVI.json();
        const typeFormula = `OR(FIND('VI Moteur', {Type de vol}), FIND("Vol d'Initiation", {Type de vol}), FIND("Vol d'Initiation (VI)", {Type de vol}))`;
        const urlReservations = `${API_BASE}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(typeFormula)}&pageSize=100&sort[0][field]=${encodeURIComponent('Date de début')}&sort[0][direction]=asc`;
        const resResa = await cachedFetch(urlReservations, { headers });
        const dataResa = await resResa.json();
        const urlCreneaux = `${API_BASE}/${encodeURIComponent('VI Créneaux')}?pageSize=100&sort[0][field]=Date&sort[0][direction]=asc&sort[1][field]=${encodeURIComponent('Heure début')}&sort[1][direction]=asc`;
        const resCreneaux = await cachedFetch(urlCreneaux, { headers });
        const dataCreneaux = await resCreneaux.json();
        listeVolsInitiationCache = [];
        (dataVI.records || []).forEach(vol => {
            if (!vol.fields) return;
            const debutRaw = vol.fields['Date de début'];
            if (!debutRaw) return;
            listeVolsInitiationCache.push({
                id: vol.id,
                source: 'planeur',
                type: 'VIP',
                passager: vol.fields['Nom'],
                pilote: vol.fields['Pilote'],
                telephone: vol.fields['Téléphone'],
                debut: debutRaw,
                fin: vol.fields['Date de fin'],
                commentaire: vol.fields['Commentaire'],
                machineName: ''
            });
        });
        (dataResa.records || []).forEach(vol => {
            if (!vol.fields) return;
            const types = Array.isArray(vol.fields['Type de vol']) ? vol.fields['Type de vol'] : [vol.fields['Type de vol']];
            if (!types.includes('VI Moteur') && !types.includes("Vol d'Initiation") && !types.includes("Vol d'Initiation (VI)")) return;
            const debutRaw = vol.fields['Date de début'];
            if (!debutRaw) return;
            const machineIds = vol.fields['Machine'] || [];
            const machineName = getNomMachine(machineIds[0]);
            const typeMoteur = machineName === 'F-JVIO' ? 'VIULM' : (machineName === 'F-GASB' ? 'VIA' : 'Moteur');
            listeVolsInitiationCache.push({
                id: vol.id,
                source: 'moteur',
                type: typeMoteur,
                passager: vol.fields['Passager'],
                pilote: vol.fields['Pilote'],
                telephone: vol.fields['Téléphone'],
                debut: debutRaw,
                fin: vol.fields['Date de fin'],
                commentaire: vol.fields['Commentaires VI'],
                machine: machineIds[0],
                machineName: machineName
            });
        });
        (dataCreneaux.records || []).forEach(vol => {
            if (!vol.fields) return;
            const dateRaw = vol.fields['Date'];
            if (!dateRaw) return;
            const statut = vol.fields['Statut'] || 'Disponible';
            if (statut === 'Annulé') return;
            const passager = statut === 'Réservé' ? `${vol.fields['Prénom'] || ''} ${vol.fields['Nom'] || ''}`.trim() : null;
            listeVolsInitiationCache.push({
                id: vol.id,
                source: 'creneau',
                type: vol.fields['Type'] || 'VI',
                statut: statut,
                passager: passager,
                pilote: (vol.fields['Pilote'] || '').toString().trim() || null,
                telephone: vol.fields['Téléphone'] || '',
                email: vol.fields['Email'] || '',
                bonCadeau: vol.fields['Bon cadeau'] || '',
                token: vol.fields['Token'] || '',
                debut: dateRaw + 'T' + (vol.fields['Heure début'] || '00:00') + ':00',
                fin: dateRaw + 'T' + (vol.fields['Heure fin'] || '00:00') + ':00',
                commentaire: vol.fields['Commentaire'] || '',
                machineName: ''
            });
        });
        const creneauxDates = listeVolsInitiationCache.filter(r => r.source === 'creneau' && r.statut === 'Disponible').map(r => r.debut.split('T')[0]);
        if (creneauxDates.length) {
            creneauxDates.sort();
            const dateMin = creneauxDates[0];
            const dateMax = creneauxDates[creneauxDates.length - 1];
            const formulaConflit = `AND(DATETIME_FORMAT({Date de début},'YYYY-MM-DD')<='${dateMax}', DATETIME_FORMAT({Date de fin},'YYYY-MM-DD')>='${dateMin}', OR(FIND('F-JVIO', ARRAYJOIN({Machine},',')), FIND('F-GASB', ARRAYJOIN({Machine},','))))`;
            const urlConflit = `${API_BASE}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(formulaConflit)}&pageSize=100`;
            try {
                const resConflit = await cachedFetch(urlConflit, { headers });
                const dataConflit = await resConflit.json();
                if (!resConflit.ok) throw new Error(dataConflit.error?.message || 'Erreur Airtable');
                listeReservationsConflits = dataConflit.records || [];
            } catch (err) { console.error('Erreur chargement réservations conflit:', err); listeReservationsConflits = []; }
        } else {
            listeReservationsConflits = [];
        }
        afficherVolsInitiation();
    } catch (error) {
        console.error(error);
        if (container) container.innerHTML = "<div class='initiation-empty'>Erreur lors du chargement.</div>";
    }
}

function initGestionnaireVolsInitiation() {
    const btnLegendeVI = document.getElementById('btn-legende-vi');
    if (btnLegendeVI) {
        btnLegendeVI.addEventListener('click', () => {
            const item = (color, label) => `<div class="legende-ligne"><span class="legende-pastille" style="background:${color};"></span><span>${label}</span></div>`;
            const bouton = (label, desc) => `<div class="legende-ligne"><span style="font-weight:700; color:#1e3d59; min-width:130px;">${label}</span><span>${desc}</span></div>`;
            afficherModaleAlerte('Légende', `
                ${item('#00adb5', 'VIP / créneau disponible')}
                ${item('#f59e0b', 'VIULM (F-JVIO)')}
                ${item('#3f51b5', 'VIA (F-GASB) / vol attribué')}
                ${item('#f97316', 'Vol à pourvoir')}
                <div class="legende-ligne"><span class="legende-pastille" style="background:repeating-linear-gradient(45deg, #e2e8f0, #e2e8f0 4px, #f1f5f9 4px, #f1f5f9 8px); border-left-color:#cbd5e1;"></span><span>Créneau bloqué / conflit machine</span></div>
                <hr class="legende-separateur">
                ${bouton('S\'inscrire', 'Se positionner comme pilote sur un vol à pourvoir')}
                ${bouton('Inscrire autre', 'Attribuer un autre pilote au vol à pourvoir')}
                ${bouton('Changer de pilote', 'Remplacer le pilote déjà attribué au vol')}
                ${bouton('Décaler le vol', 'Déplacer la réservation sur un autre créneau')}
                ${bouton('Libérer', 'Retirer le passager et remettre le créneau à disposition')}
                ${bouton('✕', 'Supprimer le vol ou le créneau (Gestion VI)')}
                ${bouton('☐', 'Sélectionner le créneau pour une suppression groupée')}
            `, 'ℹ️');
        });
    }
    const btnDispos = document.getElementById('btn-initiation-dispos');
    const btnPris = document.getElementById('btn-initiation-pris');
    const btnCreneaux = document.getElementById('btn-initiation-creneaux');
    const btnArchives = document.getElementById('btn-initiation-archives');
    const list = document.getElementById('initiation-list');
    if (btnCreneaux && hasRoleGestionVI()) btnCreneaux.style.display = 'inline-block';

    function setFiltre(valeur) {
        filtreInitiationActif = valeur;
        document.querySelectorAll('.initiation-tab').forEach(b => b.classList.remove('active'));
        const map = { apourvoir: 'btn-initiation-dispos', pris: 'btn-initiation-pris', creneaux: 'btn-initiation-creneaux', archives: 'btn-initiation-archives' };
        const activeBtn = document.getElementById(map[valeur] || '');
        if (activeBtn) activeBtn.classList.add('active');
        afficherVolsInitiation();
    }

    if (btnDispos) btnDispos.addEventListener('click', () => setFiltre('apourvoir'));
    if (btnPris) btnPris.addEventListener('click', () => setFiltre('pris'));
    if (btnCreneaux) btnCreneaux.addEventListener('click', () => setFiltre('creneaux'));
    if (btnArchives) btnArchives.addEventListener('click', () => setFiltre('archives'));

    const inputRecherche = document.getElementById('recherche-vi');
    if (inputRecherche) inputRecherche.addEventListener('input', afficherVolsInitiation);

    function setFiltreTypes() {
        filtreTypesInitiation = Array.from(document.querySelectorAll('.initiation-filter-btn.active')).map(btn => btn.dataset.type);
        afficherVolsInitiation();
    }
    const typeFilterBtns = document.querySelectorAll('.initiation-filter-btn');
    if (typeFilterBtns.length) {
        typeFilterBtns.forEach(btn => btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            setFiltreTypes();
        }));
        setFiltreTypes();
    }

    if (list) {
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-reserver-initiation');
            if (btn) {
                e.stopPropagation();
                if (btn.dataset.inscrireAutre === '1') {
                    if (typeof ouvrirInscrireAutre === 'function') {
                        ouvrirInscrireAutre('Initiation', decodeURIComponent(btn.dataset.vol));
                    }
                } else {
                    reserverVolInitiation(btn.dataset.id, btn.dataset.source);
                }
            }
        });
    }
    initGestionnaireChoixModifier();

    const modalPilote = document.getElementById('vi-pilote-modal');
    if (modalPilote) {
        const fermerPilote = () => { modalPilote.style.display = 'none'; };
        const closePilote = modalPilote.querySelector('.close-modal-vi-pilote');
        if (closePilote) closePilote.addEventListener('click', fermerPilote);
        window.addEventListener('click', (e) => { if (e.target === modalPilote) fermerPilote(); });
        const btnAnnulerPilote = document.getElementById('btn-vi-pilote-annuler');
        if (btnAnnulerPilote) btnAnnulerPilote.addEventListener('click', fermerPilote);
        const btnValiderPilote = document.getElementById('btn-vi-pilote-valider');
        if (btnValiderPilote) btnValiderPilote.addEventListener('click', validerChoixPiloteVI);
    }

    const modalResa = document.getElementById('vi-resa-modal');
    if (modalResa) {
        const fermerResa = () => { modalResa.style.display = 'none'; };
        const closeResa = modalResa.querySelector('.close-modal-vi-resa');
        if (closeResa) closeResa.addEventListener('click', fermerResa);
        window.addEventListener('click', (e) => { if (e.target === modalResa) fermerResa(); });
        const btnAnnulerResa = document.getElementById('btn-vi-resa-annuler');
        if (btnAnnulerResa) btnAnnulerResa.addEventListener('click', fermerResa);
        const formResa = document.getElementById('vi-resa-form');
        if (formResa) formResa.addEventListener('submit', validerResaAdminVI);
    }

    const modalActions = document.getElementById('vi-actions-modal');
    if (modalActions) {
        const fermerActions = () => { modalActions.style.display = 'none'; volActionsVI = null; };
        const closeActions = modalActions.querySelector('.close-modal-vi-actions');
        if (closeActions) closeActions.addEventListener('click', fermerActions);
        window.addEventListener('click', (e) => { if (e.target === modalActions) fermerActions(); });
        const btnInscrire = document.getElementById('vi-act-inscrire');
        if (btnInscrire) btnInscrire.addEventListener('click', () => {
            const v = volActionsVI;
            fermerActions();
            if (v) reserverVolInitiation(v.id, v.source);
        });
        const btnInscrireAutre = document.getElementById('vi-act-inscrire-autre');
        if (btnInscrireAutre) btnInscrireAutre.addEventListener('click', () => {
            const v = volActionsVI;
            fermerActions();
            if (v && typeof ouvrirInscrireAutre === 'function') {
                ouvrirInscrireAutre('Initiation', JSON.stringify({ id: v.id, source: v.source, type: v.type }));
            }
        });
        const btnDecalerAct = document.getElementById('vi-act-decaler');
        if (btnDecalerAct) btnDecalerAct.addEventListener('click', async () => {
            const v = volActionsVI;
            fermerActions();
            if (v) await decalerVolVI(v);
        });
        const btnLibererAct = document.getElementById('vi-act-liberer');
        if (btnLibererAct) btnLibererAct.addEventListener('click', () => {
            const v = volActionsVI;
            fermerActions();
            if (v) libererCreneauVI(v);
        });
        const btnSupprAct = document.getElementById('vi-act-supprimer');
        if (btnSupprAct) btnSupprAct.addEventListener('click', () => {
            const v = volActionsVI;
            fermerActions();
            if (v) supprimerVolInitiation(v);
        });
    }
}

function editerVolInitiation(vol) {
    if (vol.source === 'planeur') {
        const volEdit = {
            id: vol.id,
            fields: {
                'Nom': vol.passager,
                'Pilote': vol.pilote,
                'Auteur': vol.auteur,
                'Téléphone': vol.telephone,
                'Date de début': vol.debut,
                'Date de fin': vol.fin,
                'Commentaire': vol.commentaire
            }
        };
        ouvrirModaleEditionVIPlaneur(volEdit);
    } else if (vol.source === 'moteur') {
        const volEdit = {
            id: vol.id,
            fields: {
                'Type de vol': ['VI Moteur'],
                'Machine': [vol.machine],
                'Pilote': vol.pilote,
                'Passager': vol.passager,
                'Téléphone': vol.telephone,
                'Date de début': vol.debut,
                'Date de fin': vol.fin,
                'Commentaires VI': vol.commentaire,
                'Temps estimé': 1
            }
        };
        ouvrirModaleEdition(volEdit, vol.machine);
    } else if (vol.source === 'creneau') {
        ouvrirModaleChoixModifierCreneau(vol);
    }
}

async function supprimerVolInitiation(vol) {
    if (!hasRoleGestionVI()) return;
    if (!vol || !vol.id) return;
    const table = vol.source === 'moteur' ? 'Réservations' : (vol.source === 'creneau' ? 'VI Créneaux' : 'VI Planeur');
    const detail = [vol.passager, vol.dateStr, `${vol.heureDebut || ''} - ${vol.heureFin || ''}`].filter(Boolean).join(' • ');
    afficherModaleConfirmation(
        'Supprimer ce vol d\'initiation ?',
        `<p><strong>${escapeHtml(detail || 'Vol d\'initiation')}</strong></p><p>Cette action est définitive.</p>`,
        async () => {
            try {
                const response = await cachedFetch(`${API_BASE}/${encodeURIComponent(table)}/${vol.id}`, {
                    method: 'DELETE',
                    headers: headers
                });
                if (response.ok) {
                    if (typeof chargerVolsInitiation === 'function') await chargerVolsInitiation();
                    if (typeof chargerDonneesPlanning === 'function') await chargerDonneesPlanning(true);
                } else {
                    afficherModaleAlerte('Erreur', '<p>La suppression a échoué.</p>', '⚠️');
                }
            } catch (error) {
                console.error(error);
                afficherModaleAlerte('Erreur', '<p>La suppression a échoué.</p>', '⚠️');
            }
        }
    );
}

async function supprimerCreneauVI(vol) {
    if (!hasRoleGestionVI()) return;
    if (!vol || !vol.id) return;
    const table = vol._table || 'VI Créneaux';
    if (!confirm('Es-tu sûr de vouloir supprimer ce créneau ?')) return;
    try {
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent(table)}?records[]=${vol.id}`, {
            method: 'DELETE',
            headers: headers
        });
        if (response.ok) {
            const modal = document.getElementById('vi-choix-modifier');
            if (modal) modal.style.display = 'none';
            if (typeof chargerVolsInitiation === 'function') await chargerVolsInitiation();
            if (typeof chargerDonneesPlanning === 'function') await chargerDonneesPlanning();
            volChoixCreneau = null;
        }
    } catch (error) {
        console.error(error);
        alert('Erreur lors de la suppression.');
    }
}

function ouvrirModaleChoixModifierCreneau(vol) {
    const modal = document.getElementById('vi-choix-modifier');
    if (!modal) return;
    volChoixCreneau = vol;
    const info = document.getElementById('vi-choix-info');
    const btnPassager = document.getElementById('btn-modifier-comme-passager');
    const btnSupprimer = document.getElementById('btn-supprimer-creneau');
    const aUnPassager = !!(vol.passager && vol.token);
    if (btnPassager) btnPassager.style.display = aUnPassager ? '' : 'none';
    if (btnSupprimer) btnSupprimer.style.display = hasRoleGestionVI() ? '' : 'none';
    if (info) {
        info.innerHTML = aUnPassager
            ? `Modifier le créneau de <strong>${escapeHtml(vol.passager)}</strong> ?`
            : `Modifier le créneau <strong>${escapeHtml(vol.type || 'VI')}</strong> du ${escapeHtml(vol.dateStr || '')} (${vol.heureDebut} - ${vol.heureFin}) ?`;
    }
    modal.style.display = 'flex';
}

function initGestionnaireChoixModifier() {
    const modal = document.getElementById('vi-choix-modifier');
    const btnPassager = document.getElementById('btn-modifier-comme-passager');
    const btnException = document.getElementById('btn-modifier-exception');
    const btnSupprimer = document.getElementById('btn-supprimer-creneau');
    const btnClose = document.querySelector('.close-modal-vi-choix');
    if (btnClose && modal) btnClose.addEventListener('click', () => modal.style.display = 'none');
    if (window && modal) window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    if (btnPassager) {
        btnPassager.addEventListener('click', () => {
            if (!volChoixCreneau || !volChoixCreneau.token) {
                alert('Aucun token passager trouvé pour ce créneau. Utilisez la modification exceptionnelle.');
                return;
            }
            window.open(`${URL_RESERVER_VI}?token=${encodeURIComponent(volChoixCreneau.token)}`, '_blank');
            if (modal) modal.style.display = 'none';
        });
    }
    if (btnException) {
        btnException.addEventListener('click', () => {
            if (modal) modal.style.display = 'none';
            if (volChoixCreneau) ouvrirModaleEditionVICreneau(volChoixCreneau);
        });
    }
    if (btnSupprimer) {
        btnSupprimer.addEventListener('click', () => {
            if (volChoixCreneau) supprimerCreneauVI(volChoixCreneau);
        });
    }
}

async function reserverVolInitiation(id, source) {
    const nomPilote = nomPiloteCourant();
    if (!nomPilote) { alert('Connecte-toi pour réserver ce vol.'); return; }
    if (source === 'creneau' && !hasRolePiloteVI()) {
        alert('Seuls les pilotes VI peuvent s\'inscrire sur un créneau réservé.');
        return;
    }
    const volInit = (listeVolsInitiationCache || []).find(v => v.id === id);
    if (!piloteAutoriseSurTypeVI((currentUser || {}).roles || [], volInit ? volInit.type : null)) {
        alert('Ce type de vol d\'initiation est réservé aux instructeurs de la discipline concernée.');
        return;
    }
    const tableName = source === 'planeur' ? 'VI Planeur' : (source === 'creneau' ? 'VI Créneaux' : 'Réservations');
    try {
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent(tableName)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id, fields: { "Pilote": nomPilote.trim() } }] })
        });
        if (response.ok) {
            const vol = (listeVolsInitiationCache || []).find(v => v.id === id);
            const dateVol = vol?.debut ? vol.debut.slice(0,16).replace('T',' ') : '';
            const finVol = vol?.fin ? vol.fin.slice(0,16).replace('T',' ') : '';
            if (typeof enregistrerAudit === 'function') {
                await enregistrerAudit('Inscription vol d\'initiation', source, `Pilote : ${nomPilote} | ${dateVol} - ${finVol}`, 'Initiation');
            }
            chargerVolsInitiation();
            chargerDonneesPlanning(true);
        } else {
            alert('Erreur lors de la réservation du vol.');
        }
    } catch (error) {
        console.error(error);
        alert('Erreur lors de la réservation du vol.');
    }
}

function timeToMinutes(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    return h * 60 + m;
}

function hasRoleGestionVI() {
    if (!currentUser) return false;
    const roles = currentUser.roles || [];
    return roles.includes('Gestion VI') || roles.includes('Super admin');
}

function peutGererVolVI(vol) {
    if (hasRoleGestionVI()) return true;
    if (!hasRolePiloteVI() || !vol) return false;
    const pilote = (vol.pilote || '').toString().trim();
    if (!pilote) return false;
    return typeof estUtilisateurCourant === 'function' && estUtilisateurCourant(pilote);
}

function hasRolePiloteVI() {
    if (!currentUser) return false;
    const roles = currentUser.roles || [];
    return roles.includes('Pilote VI');
}

const ROLE_INSTRUCTEUR_PAR_TYPE_VI = { VIP: 'Instructeur planeur', VIA: 'Instructeur avion', VIULM: 'Instructeur ULM' };

// Un membre instructeur ne peut être pilote d'un VI que sur sa discipline :
// Instructeur avion -> VIA, Instructeur ULM -> VIULM, Instructeur planeur -> VIP.
// Un Pilote VI sans rôle instructeur n'est pas restreint.
function piloteAutoriseSurTypeVI(rolesMembre, typeVI) {
    const roles = Array.isArray(rolesMembre) ? rolesMembre : [rolesMembre].filter(Boolean);
    if (!roles.some(r => /instructeur/i.test((r || '').toString()))) return true;
    const requis = ROLE_INSTRUCTEUR_PAR_TYPE_VI[(typeVI || '').toString().toUpperCase().trim()];
    if (!requis) return true;
    return roles.includes(requis);
}

function updateGestionVI() {
    const toolbar = document.getElementById('gestion-vi-toolbar');
    const btnToggle = document.getElementById('btn-creneaux-vi-toggle');
    const autorise = hasRoleGestionVI();
    if (btnToggle) {
        btnToggle.style.display = autorise ? '' : 'none';
        if (!btnToggle.dataset.ready) {
            btnToggle.dataset.ready = '1';
            btnToggle.addEventListener('click', () => {
                if (!toolbar) return;
                const ouvert = toolbar.style.display === 'block';
                toolbar.style.display = ouvert ? 'none' : 'block';
                btnToggle.classList.toggle('active', !ouvert);
            });
        }
    }
    if (toolbar && !autorise) { toolbar.style.display = 'none'; if (btnToggle) btnToggle.classList.remove('active'); }
    const tabCreneaux = document.getElementById('btn-initiation-creneaux');
    if (tabCreneaux) tabCreneaux.style.display = autorise ? 'inline-block' : 'none';
}

const listeDatesGV = [];

function getDatesCreneauxVI() {
    const dates = [...listeDatesGV];
    const d = document.getElementById('gv-date')?.value || '';
    if (d && !dates.includes(d)) dates.push(d);
    return dates.sort();
}

function majChipsDatesGV() {
    const cont = document.getElementById('gv-dates-chips');
    if (!cont) return;
    cont.innerHTML = '';
    [...listeDatesGV].sort().forEach(d => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'gv-date-chip';
        chip.title = 'Retirer cette date';
        chip.textContent = new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ✕';
        chip.addEventListener('click', () => {
            const i = listeDatesGV.indexOf(d);
            if (i !== -1) listeDatesGV.splice(i, 1);
            majChipsDatesGV();
            genererApercuCreneauxVI();
        });
        cont.appendChild(chip);
    });
}

function initGestionCreneauxVI() {
    updateGestionVI();
    const form = document.getElementById('form-creneaux-vi');
    if (form) {
        form.addEventListener('submit', creerCreneauxVI);
        form.addEventListener('reset', () => {
            listeDatesGV.length = 0;
            setTimeout(() => { majChipsDatesGV(); genererApercuCreneauxVI(); }, 0);
        });
    }
    const btnAddDate = document.getElementById('gv-date-add');
    if (btnAddDate) {
        btnAddDate.addEventListener('click', () => {
            const input = document.getElementById('gv-date');
            const d = input?.value;
            if (!d) return;
            if (!listeDatesGV.includes(d)) listeDatesGV.push(d);
            input.value = '';
            majChipsDatesGV();
            genererApercuCreneauxVI();
        });
    }
    const selType = document.getElementById('gv-type');
    if (selType) {
        selType.addEventListener('change', () => {
            const defs = selType.value === 'VIP'
                ? { d: '14:30', f: '18:15', n: 5 }
                : { d: '10:00', f: '12:00', n: 2 };
            const elD = document.getElementById('gv-debut');
            const elF = document.getElementById('gv-fin');
            const elN = document.getElementById('gv-nombre');
            if (elD) elD.value = defs.d;
            if (elF) elF.value = defs.f;
            if (elN) elN.value = defs.n;
            genererApercuCreneauxVI();
        });
    }
    ['gv-type','gv-date','gv-debut','gv-fin','gv-nombre'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', genererApercuCreneauxVI);
    });
    majChipsDatesGV();
    genererApercuCreneauxVI();
}

function genererApercuCreneauxVI() {
    const apercu = document.getElementById('gv-apercu');
    const type = document.getElementById('gv-type')?.value || '';
    const dates = getDatesCreneauxVI();
    const debut = document.getElementById('gv-debut')?.value || '';
    const fin = document.getElementById('gv-fin')?.value || '';
    const nombre = parseInt(document.getElementById('gv-nombre')?.value, 10);
    if (!type || !dates.length || !debut || !fin || !nombre) {
        if (apercu) apercu.innerHTML = 'Remplis les champs pour voir l\'aperçu des créneaux.';
        return [];
    }
    const debutMin = timeToMinutes(debut);
    const finMin = timeToMinutes(fin);
    if (finMin <= debutMin) {
        if (apercu) apercu.innerHTML = 'L\'heure de fin doit être après l\'heure de début.';
        return [];
    }
    const totalMin = finMin - debutMin;
    const duree = totalMin / nombre;
    const records = [];
    const groupes = [];
    dates.forEach(date => {
        const lignes = [];
        for (let i = 0; i < nombre; i++) {
            const start = Math.round(debutMin + i * duree);
            const end = (i === nombre - 1) ? finMin : Math.round(start + duree);
            records.push({
                fields: {
                    'Date': date,
                    'Heure début': minutesToTimeString(start),
                    'Heure fin': minutesToTimeString(end),
                    'Type': type,
                    'Statut': 'Disponible'
                }
            });
            const slotMin = end - start;
            lignes.push(`Créneau ${i + 1} : <strong>${minutesToTimeString(start)} - ${minutesToTimeString(end)}</strong> (${slotMin} min)`);
        }
        groupes.push({ date, lignes });
    });
    if (apercu) {
        apercu.innerHTML = `<div style="margin-bottom:4px;font-weight:bold;">Aperçu : ${records.length} créneau(x) sur ${dates.length} date(s)</div>` +
            groupes.map(g => {
                const dateStr = new Date(g.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
                return `<div style="margin-top:6px;"><strong style="text-transform:capitalize;">${dateStr}</strong><ul style="margin:2px 0 0; padding-left:18px; line-height:1.5;">${g.lignes.map(l => `<li>${l}</li>`).join('')}</ul></div>`;
            }).join('');
    }
    return records;
}

async function creerCreneauxVI(e) {
    e.preventDefault();
    const type = document.getElementById('gv-type')?.value;
    const dates = getDatesCreneauxVI();
    const debut = document.getElementById('gv-debut')?.value;
    const fin = document.getElementById('gv-fin')?.value;
    if (!type || !dates.length || !debut || !fin) {
        alert('Choisis au moins une date ainsi que le type, le début et la fin.');
        return;
    }
    const records = genererApercuCreneauxVI();
    if (!records || records.length === 0) {
        alert('Aucun créneau ne tient dans l\'intervalle.');
        return;
    }
    try {
        const ors = dates.map(d => `DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${d}'`).join(', ');
        const formConflit = dates.length > 1 ? `OR(${ors})` : ors;
        const resExist = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}?filterByFormula=${encodeURIComponent(formConflit)}&pageSize=100`, { headers }, API_CACHE_TTL, true);
        const dataExist = await resExist.json();
        const existants = (dataExist.records || []).filter(r => {
            const f = r.fields || {};
            return f['Statut'] !== 'Annulé' && (f['Type'] || 'VI') === type;
        });
        const conflits = existants.filter(r => {
            const f = r.fields || {};
            const dEx = (f['Date'] || '').slice(0, 10);
            const dbEx = timeToMinutes(f['Heure début'] || '00:00');
            const fnEx = timeToMinutes(f['Heure fin'] || '00:00');
            return records.some(rec =>
                rec.fields['Date'] === dEx &&
                timeToMinutes(rec.fields['Heure début']) < fnEx &&
                timeToMinutes(rec.fields['Heure fin']) > dbEx
            );
        });
        if (conflits.length) {
            const lignes = conflits.map(r => {
                const f = r.fields || {};
                const dTxt = new Date((f['Date'] || '').slice(0, 10) + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
                return `• ${dTxt} ${f['Heure début']} - ${f['Heure fin']} (${f['Statut'] || 'Disponible'})`;
            }).join('\n');
            alert(`Création impossible : ${conflits.length} créneau(x) ${type} existant(s) empiètent sur cette plage :\n\n${lignes}\n\nSupprime d'abord ces créneaux (onglet « Créneaux dispos » ou « Archives »), puis recrée ce lot.`);
            return;
        }
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la vérification des créneaux existants : ' + err.message);
        return;
    }
    try {
        for (let i = 0; i < records.length; i += 10) {
            const batch = records.slice(i, i + 10);
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent('VI Créneaux')}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ records: batch })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        }
        if (typeof enregistrerAudit === 'function') {
            const pilote = nomPiloteCourant();
            await enregistrerAudit('Création créneaux VI', type, `Pilote : ${pilote} | Dates : ${dates.join(', ')} | Nombre : ${records.length} | ${debut} - ${fin}`, 'Initiation');
        }
        alert(`${records.length} créneau(x) créé(s) sur ${dates.length} date(s).`);
        document.getElementById('form-creneaux-vi').reset();
        if (typeof chargerVolsInitiation === 'function') chargerVolsInitiation();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la création : ' + err.message);
    }
}

setInterval(actualiserLigneHeureCourante, 60000);
actualiserLigneHeureCourante();

// Rafraichissement auto des donnees quand on revient sur l'onglet
// (ex. retour de reserver-vi.html apres un decalage de VI).
let dernierRefreshRetour = 0;
function rafraichirDonneesAuRetour() {
    const maintenant = Date.now();
    if (maintenant - dernierRefreshRetour < 3000) return;
    dernierRefreshRetour = maintenant;
    Object.keys(API_CACHE).forEach(k => delete API_CACHE[k]);
    if (typeof chargerVolsInitiation === 'function') chargerVolsInitiation();
    if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false, true);
    if (typeof chargerPresencesPlaneur === 'function') chargerPresencesPlaneur();
    if (typeof chargerPresencesClub === 'function') chargerPresencesClub();
    if (typeof chargerEvenementsJour === 'function') chargerEvenementsJour();
    const vueMessagerie = document.getElementById('view-messagerie');
    if (vueMessagerie && vueMessagerie.style.display !== 'none' && typeof chargerMessagerie === 'function') chargerMessagerie();
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rafraichirDonneesAuRetour();
});
window.addEventListener('pageshow', (e) => {
    if (e.persisted) rafraichirDonneesAuRetour();
});