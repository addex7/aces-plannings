/* ==========================================================================
   PLANNING - GESTION DES RÉSERVATIONS ET PLANNING
   ========================================================================== */

// Les variables globales sont définies dans app.js
let afficherVIPPlaneur = false;
let idVIModale = null;
let tableVIModale = null;
let volChoixCreneau = null;
let volVIModale = null;
const URL_RESERVER_VI = 'https://addex7.github.io/aces-plannings/reserver-vi.html';
let listeVolsInitiationCache = [];
let listeReservationsConflits = [];
let filtreInitiationActif = 'apourvoir';
let filtreTypesInitiation = ['VIP', 'VIULM', 'VIA'];
let listeMembresCache = [];

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

function formaterDateISO(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// --- FONCTION POUR METTRE À JOUR L'HORAMÈTRE ---
async function mettreAJourHorametreAeronef(avionId, heuresAjoutees) {
    try {
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}/${avionId}`, {
            headers: headers
        });
        const avion = await response.json();

        if (!avion.fields || avion.fields['Horamètre actuel'] === undefined) {
            console.error("Horamètre non trouvé pour l'aéronef:", avionId);
            return;
        }

        const nouvelHorametre = parseFloat(avion.fields['Horamètre actuel']) + parseFloat(heuresAjoutees);

        const updateResponse = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}/${avionId}`, {
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

        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Carnet de route')}`, {
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
        const urlCreneaux = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Créneaux')}?filterByFormula=DATETIME_FORMAT({Date},'YYYY-MM-DD')='${dateJour}'&pageSize=100&sort[0][field]=Date&sort[0][direction]=asc&sort[1][field]=${encodeURIComponent('Heure début')}&sort[1][direction]=asc`;
        const resCreneaux = await cachedFetch(urlCreneaux, { headers });
        const dataCreneaux = await resCreneaux.json();
        const urlResa = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({Date de début},'YYYY-MM-DD')<='${dateJour}', DATETIME_FORMAT({Date de fin},'YYYY-MM-DD')>='${dateJour}', FIND('${immat}', ARRAYJOIN({Machine},',')))`)}&pageSize=100`;
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
                await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Créneaux')}`, {
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
    if (form['form-instructeur']) {
        const savedInstructeur = reservation.fields['Instructeur'];
        let nomInstructeur = '';
        if (savedInstructeur) {
            const idInstructeur = Array.isArray(savedInstructeur) ? savedInstructeur[0] : savedInstructeur;
            if (typeof listeInstructeursCache !== 'undefined' && listeInstructeursCache.length) {
                const found = listeInstructeursCache.find(i => i.id === idInstructeur || i.nomComplet === idInstructeur);
                nomInstructeur = found ? found.nomComplet : idInstructeur;
            } else {
                nomInstructeur = idInstructeur.toString().trim();
            }
        }
        const options = Array.from(form['form-instructeur'].options);
        const match = nomInstructeur && options.find(o => o.value && typeof correspondanceNom === 'function' && correspondanceNom(o.value, nomInstructeur));
        form['form-instructeur'].value = match ? match.value : (options.some(o => o.value === nomInstructeur) ? nomInstructeur : '');
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
            const updateResponse = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}/${idReservationEnEdition}`, {
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
            const reservationResponse = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}`, {
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
    const rolesAutorises = ['Super admin', 'Instructeur avion', 'Instructeur ULM', 'Instructeur planeur'];
    const aRoleAutorise = (currentUser && Array.isArray(currentUser.roles) && currentUser.roles.some(r => rolesAutorises.includes(r))) || false;
    if (!estProprietaire && !aRoleAutorise) {
        alert("Tu n'as pas le droit de supprimer cette réservation.");
        return;
    }

    if (!confirm("Es-tu sûr de vouloir supprimer cette réservation ?")) return;

    try {
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?records[]=${idReservationEnEdition}`, {
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

function ouvrirModaleEditionVIPlaneur(vol) {
    const modal = document.getElementById('vi-planeur-modal');
    const modalTitle = modal ? modal.querySelector('h3') : null;
    const btnDeleteVI = document.getElementById('btn-delete-vi-planeur');
    const groupTelephone = document.getElementById('group-vi-telephone');
    const groupStatut = document.getElementById('group-vi-statut');
    if (modalTitle) modalTitle.textContent = "Modifier VI Planeur";
    if (btnDeleteVI) btnDeleteVI.style.display = 'block';
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
    document.getElementById('form-vi-pilote').value = (vol.fields['Pilote'] || '').toString().trim();
    document.getElementById('form-vi-commentaire').value = (vol.fields['Commentaire'] || '').toString().trim();
    modal.style.display = 'flex';
}

function ouvrirModaleEditionVICreneau(vol) {
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
    document.getElementById('form-vi-pilote').value = (vol.pilote || '').toString().trim();
    document.getElementById('form-vi-commentaire').value = (vol.commentaire || '').toString().trim();
    modal.style.display = 'flex';
}

function afficherLigneVIPlaneur(volsVIP, rowsContainer, soleil) {
    if (!afficherVIPPlaneur) return;
    const rowDiv = document.createElement('div');
    rowDiv.className = 'timeline-row vi-planeur-row';
    const machineCell = document.createElement('div');
    machineCell.className = 'machine-cell';
    machineCell.textContent = 'VI Planeur';
    machineCell.style.cursor = 'pointer';
    machineCell.addEventListener('click', () => {
        if (typeof ouvrirModaleNouvelleReservation === 'function') ouvrirModaleNouvelleReservation({ type: 'VI Planeur', dureeMinutes: 45 });
    });
    rowDiv.appendChild(machineCell);

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

    for (let h = 0; h < 24; h++) {
        const gridBlock = document.createElement('div');
        gridBlock.className = 'grid-hour-block';
        gridBlock.style.flex = LARGEURS_HEURES[h];
        gridBg.appendChild(gridBlock);
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
                barresDiv.style.left = `${positionHeure(heureDebut)}%`;
                barresDiv.style.width = `${positionHeure(heureFin) - positionHeure(heureDebut)}%`;
                const libelle = pilote ? `🎯 ${type} (${formaterNomPilote(pilote)})` : `🎯 ${type} DISPONIBLE`;
                barresDiv.innerHTML = `<strong>${libelle}</strong>`;
                const debutStr = convertirHeureEnHHMM(heureDebut);
                const finStr = convertirHeureEnHHMM(heureFin);
                barresDiv.title = [
                    `Type : ${type}`,
                    `Nom : ${nom}`,
                    `Pilote : ${formaterNomPilote(pilote) || '—'}`,
                    `Horaires : ${debutStr} - ${finStr}`,
                    `Téléphone : ${vol.fields['Téléphone'] || '—'}`,
                    `Commentaire : ${vol.fields['Commentaire'] || '—'}`
                ].join('\n');
                if (!isCreneau) {
                    const handleLeft = document.createElement('div');
                    handleLeft.className = 'resize-handle resize-handle-left';
                    const handleRight = document.createElement('div');
                    handleRight.className = 'resize-handle resize-handle-right';
                    barresDiv.appendChild(handleLeft);
                    barresDiv.appendChild(handleRight);
                    handleLeft.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        initierResize(e, vol.id, gridBg, barresDiv, 'gauche', heureDebut, heureFin, null, 'VI Planeur');
                    });
                    handleRight.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        initierResize(e, vol.id, gridBg, barresDiv, 'droite', heureDebut, heureFin, null, 'VI Planeur');
                    });
                    barresDiv.addEventListener('mousedown', (e) => {
                        if (e.target.classList.contains('resize-handle')) return;
                        e.stopPropagation();
                        initierDeplacementBarre(e, vol.id, null, gridBg, barresDiv, heureDebut, duree, null, 'VI Planeur');
                    });
                }
                barresDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isResizing || isDraggingBar) return;
                    const volPourEdition = {
                        source: isCreneau ? 'creneau' : 'planeur',
                        id: vol.id,
                        passager: nom,
                        pilote: pilote,
                        telephone: vol.fields['Téléphone'] || '',
                        debut: vol.fields['Date de début'],
                        fin: vol.fields['Date de fin'],
                        commentaire: vol.fields['Commentaire'] || '',
                        token: vol.fields['Token'] || '',
                        type: type
                    };
                    editerVolInitiation(volPourEdition);
                });
                barresDiv.addEventListener('mouseenter', () => { barresDiv.style.zIndex = '100'; });
                barresDiv.addEventListener('mouseleave', () => { barresDiv.style.zIndex = '5'; });
                gridBg.appendChild(barresDiv);
            }
        }
    });

    rowDiv.appendChild(gridBg);
    rowsContainer.appendChild(rowDiv);
}

// --- FONCTION POUR CHARGER ET AFFICHER LES DONNÉES DU PLANNING ---
async function chargerDonneesPlanning(forceRefresh = false, autoActiverVIP = true) {
    const rowsContainer = document.getElementById('timeline-rows');
    if (!rowsContainer) return;
    rowsContainer.innerHTML = "<div class='loading'>Mise à jour du planning...</div>";
    const debutJour = dateAffichee.toISOString().split('T')[0];
    try {
        await chargerListeMembresCache();
        if (forceRefresh || listeAvionsCache.length === 0) {
            const resAvions = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}`, { headers });
            const dataAvions = await resAvions.json();
            if (dataAvions.records) listeAvionsCache = dataAvions.records;
        }
        const trouverAvionParImmat = (immat) => (listeAvionsCache || []).find(a => (a.fields['Immatriculation'] || a.fields['Nom'] || '').toString().trim().toUpperCase() === immat.toUpperCase());
        const avionJVIO = trouverAvionParImmat('F-JVIO');
        const avionGASB = trouverAvionParImmat('F-GASB');
        const avionIdJVIO = avionJVIO ? avionJVIO.id : null;
        const avionIdGASB = avionGASB ? avionGASB.id : null;
        let creneauxVIMotor = [];
        const urlReservations = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')<='${debutJour}', DATETIME_FORMAT({Date de fin}, 'YYYY-MM-DD')>='${debutJour}')`)}`;
        const urlVIPlaneur = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}?filterByFormula=DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')='${debutJour}'`;
        const urlVICreneaux = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Créneaux')}?filterByFormula=DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${debutJour}'`;

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
            if (statut === 'Annulé') return null;
            const dateRaw = f['Date'];
            if (!dateRaw) return null;
            const dateVol = new Date(dateRaw + 'T00:00:00');
            if (dateVol.getFullYear() !== dateAffichee.getFullYear() ||
                dateVol.getMonth() !== dateAffichee.getMonth() ||
                dateVol.getDate() !== dateAffichee.getDate()) return null;
            const passager = f['Prénom'] && f['Nom'] ? `${f['Prénom']} ${f['Nom']}`.trim() : '';
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
                fields: {
                    'Type de vol': ['VI Moteur'],
                    'Passager': nom,
                    'Pilote': pilote,
                    'Téléphone': f['Téléphone'] || '',
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
        const urlCarnetPilotes = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Carnet de route Pilotes')}?filterByFormula=${encodeURIComponent(formulaJour)}`;
        const urlMaintenance = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Maintenance')}?filterByFormula=${encodeURIComponent(formulaJour)}`;
        const [resCarnetPilotes, resMaintenance] = await Promise.all([
            cachedFetch(urlCarnetPilotes, { headers }, API_CACHE_TTL, forceRefresh),
            cachedFetch(urlMaintenance, { headers }, API_CACHE_TTL, forceRefresh)
        ]);
        const [dataCarnetPilotes, dataMaintenance] = await Promise.all([
            resCarnetPilotes.json(),
            resMaintenance.json()
        ]);
        const carnetsPilotes = dataCarnetPilotes.records || [];
        const maintenancesJour = dataMaintenance.records || [];
        rowsContainer.innerHTML = "";
        if (listeAvionsCache.length === 0) {
            rowsContainer.innerHTML = "<div class='loading'>Aucun aéronef trouvé.</div>";
            return;
        }
        populerSelectAvions(listeAvionsCache);
        const soleil = calculerSoleilLFOY(dateAffichee);
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
            let potentielInitial = avion.fields['Potentiel restant'] !== undefined ? parseFloat(avion.fields['Potentiel restant']) : 0;
            const totalHeuresEstimees = listeReservationsCache
                .filter(res => res.fields && res.fields['Machine'] && res.fields['Machine'].includes(avionId))
                .reduce((somme, res) => somme + (parseFloat(res.fields['Temps estimé']) || 0), 0);
            const potentielPredictif = potentielInitial - totalHeuresEstimees;
            let couleurStatus = "status-green";
            let textPotentiel = `Potentiel net estimé : ${potentielPredictif.toFixed(1)}h`;
            if (potentielPredictif <= 5) {
                couleurStatus = "status-red";
                textPotentiel = `ARRÊT IMMINENT (${potentielPredictif.toFixed(1)}h restantes)`;
            } else if (potentielPredictif <= 15) {
                couleurStatus = "status-orange";
                textPotentiel = `Révision à prévoir (${potentielPredictif.toFixed(1)}h restantes)`;
            } else {
                couleurStatus = "status-green";
                textPotentiel = `Potentiel bon (${potentielPredictif.toFixed(1)}h restantes)`;
            }
            const machineCell = document.createElement('div');
            machineCell.className = 'machine-cell';
            const badgeMaint = document.createElement('span');
            badgeMaint.className = `maintenance-status ${couleurStatus}`;
            badgeMaint.setAttribute('data-tooltip', textPotentiel);
            machineCell.appendChild(badgeMaint);
            machineCell.appendChild(document.createTextNode(avionNom));
            rowDiv.appendChild(machineCell);
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
                gridBg.appendChild(gridBlock);
            }
            const contentWrapper = document.createElement('div');
            contentWrapper.style.cssText = 'display: flex; flex-direction: column; flex: 1;';
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
                        const passagerNom = (vol.fields['Passager'] || '').toString().trim();
                        const instructeurNom = nomUtilisateurDepuisId(vol.fields['Instructeur'], listeMembresCache);
                        const typesVol = Array.isArray(typeVol) ? typeVol : [typeVol];
                        const isVIMoteur = typesVol.includes('VI Moteur');
                        const isAncienVI = typesVol.includes("Vol d'Initiation") || typesVol.includes("Vol d'Initiation (VI)");
                        const isCreneau = vol._table === 'VI Créneaux';
                        const isInstruction = typesVol.includes('Instruction');
                        const estMoi = estUtilisateurCourant(piloteNom) || estUtilisateurCourant(instructeurNom);
                        if (estMoi) barresDiv.classList.add('ma-reservation');
                        let libelleEntete = piloteFormate || 'Pilote non défini';
                        if (instructeurNom) {
                            barresDiv.classList.add('reservation-avec-instructeur');
                            const trigramme = trouverTrigrammeInstructeur(instructeurNom);
                            if (trigramme) libelleEntete += ` — ${trigramme}`;
                            libelleEntete += ' (Instruction)';
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
                        if (isCreneau) {
                            barresDiv.title = (vol.fields['Commentaires VI'] || '') + (passagerNom ? '\nPassager : ' + passagerNom : '');
                        }
                        barresDiv.innerHTML = `<strong>${libelleEntete}</strong>`;
                        if (!isCreneau) {
                            const handleLeft = document.createElement('div');
                            handleLeft.className = 'resize-handle resize-handle-left';
                            const handleRight = document.createElement('div');
                            handleRight.className = 'resize-handle resize-handle-right';
                            barresDiv.appendChild(handleLeft);
                            barresDiv.appendChild(handleRight);
                            handleLeft.addEventListener('mousedown', (e) => {
                                e.stopPropagation();
                                initierResize(e, vol.id, gridBg, barresDiv, 'gauche', heureDebut, heureFin, null);
                            });
                            handleRight.addEventListener('mousedown', (e) => {
                                e.stopPropagation();
                                initierResize(e, vol.id, gridBg, barresDiv, 'droite', heureDebut, heureFin, null);
                            });
                            barresDiv.addEventListener('mousedown', (e) => {
                                if (e.target.classList.contains('resize-handle')) return;
                                e.stopPropagation();
                                initierDeplacementBarre(e, vol.id, avionId, gridBg, barresDiv, heureDebut, duree, null);
                            });
                            barresDiv.addEventListener('click', (e) => {
                                e.stopPropagation();
                                if (isResizing || isDraggingBar) return;
                                ouvrirModaleEdition(vol, avionId);
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
                    maintDiv.style.zIndex = '10';
                    maintDiv.title = `Maintenance ${mImmat} — ${hDebut.toFixed(2)}h à ${hFin.toFixed(2)}h`;
                    if (dureeM >= 1) maintDiv.textContent = 'Maintenance';
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
                    const offsetHeures = -dateAffichee.getTimezoneOffset() / 60;
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
                        const left = (heureDepartCarnetLocal / 24) * 100;
                        const widthPct = Math.max((dureeCarnet / 24) * 100, 1.0);
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
        if (autoActiverVIP && volsVIP.length > 0) afficherVIPPlaneur = true;
        mettreAJourBoutonVIPPlaneur();
        afficherLigneVIPlaneur(volsVIP, rowsContainer, soleil);
        if (typeof afficherLignesInstructeurs === 'function') afficherLignesInstructeurs(rowsContainer, soleil, disposInstructeurs, [...listeReservationsCache, ...volsVIP, ...creneauxVIMotor]);
        await chargerPresencesPlaneur();
        await chargerPresencesClub();
        actualiserLigneHeureCourante();
    } catch (error) {
        console.error(error);
        rowsContainer.innerHTML = "<div class='loading'>Erreur de chargement des données.</div>";
    }
}

function genererFriseHeures() {
    const container = document.getElementById('timeline-hours');
    if (!container) return;
    container.innerHTML = "";
    for (let h = 0; h < 24; h++) {
        const heureStr = h + 'h';
        const div = document.createElement('div');
        div.className = 'hour-cell-header';
        div.style.flex = LARGEURS_HEURES[h];
        div.innerHTML = `<span>${heureStr}</span>`;
        container.appendChild(div);
    }
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
        selectSuivi.addEventListener('change', () => chargerSuiviAeronef());
    }
}

function peutBougerReservations() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    const roles = currentUser.roles || [];
    const allowed = ['super admin', 'instructeur avion', 'instructeur planeur', 'instructeur ulm'];
    return roles.some(r => allowed.includes((r || '').toString().toLowerCase().trim()));
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
            const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}?sort[0][field]=Nom&sort[0][direction]=asc&pageSize=100`, { headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || 'Erreur');
            listeMembresCache = data.records || [];
        }
        sel.innerHTML = '<option value="">-- Choisir un pilote --</option>';
        listeMembresCache.forEach(r => {
            const f = r.fields || {};
            const nomComplet = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim() || 'Membre';
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.textContent = nomComplet;
            if (piloteSelectionne && (r.id === piloteSelectionne || nomComplet === piloteSelectionne)) opt.selected = true;
            else if (!piloteSelectionne && r.id === monId) opt.selected = true;
            sel.appendChild(opt);
        });
        if (piloteSelectionne) sel.value = piloteSelectionne;
        else if (monId) sel.value = monId;
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
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}?sort[0][field]=Nom&sort[0][direction]=asc&pageSize=100`, { headers });
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
    line.style.display = 'block';
    const heureDec = now.getHours() + (now.getMinutes() / 60);
    line.style.left = `calc(90px + (100% - 90px) * ${positionHeure(heureDec) / 100})`;
}

function initierDeplacementBarre(e, volId, avionId, gridBg, barresDiv, heureDebutInitiale, dureeVol, callbackMiseAJour, tableName = 'Réservations', record = null) {
    e.preventDefault();
    const resa = record || (listeReservationsCache || []).find(r => r.id === volId);
    if (tableName !== 'Maintenance' && !peutBougerReservations() && !estProprietaireReservation(resa)) return;
    let aBouge = false;
    let ghost = null;
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
        ghost.style.left = `${positionHeure(nouvelleHeureDebut)}%`;
        const hDebutStr = convertirHeureEnHHMM(nouvelleHeureDebut);
        const hFinStr = convertirHeureEnHHMM(nouvelleHeureDebut + dureeVol);
        ghost.innerHTML = `<span>${hDebutStr} - ${hFinStr}</span>`;
    }
    function onMouseUp(evt) {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        barresDiv.style.opacity = '1';
        if (aBouge) {
            if (ghost) ghost.remove();
            const xPosFinal = evt.clientX - rectGrid.left;
            let pourcentageFin = Math.max(0, Math.min(1, xPosFinal / rectGrid.width));
            let heureFinale = Math.round(positionHeureInverse(pourcentageFin * 100) * 4) / 4;
            if (heureFinale + dureeVol > 24) heureFinale = 24 - dureeVol;
            if (typeof sauvegarderDeplacementVol === 'function') {
                sauvegarderDeplacementVol(volId, avionId, heureFinale, dureeVol, tableName, record, callbackMiseAJour);
            }
        }
        setTimeout(() => {
            isDraggingBar = false;
            document.body.style.userSelect = '';
            document.body.style.webkitUserSelect = '';
            document.body.style.mozUserSelect = '';
        }, 100);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}

function initierResize(e, reservationId, parentGrid, barElement, bord, hDebutInitiale, hFinInitiale, dateCibleVol, tableName = 'Réservations', record = null) {
    e.preventDefault();
    const resa = record || (listeReservationsCache || []).find(r => r.id === reservationId);
    if (tableName !== 'Maintenance' && !peutBougerReservations() && !estProprietaireReservation(resa)) return;
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
        ghostBar.style.left = `${positionHeure(hDebFinale)}%`;
        ghostBar.style.width = `${positionHeure(hFinFinale) - positionHeure(hDebFinale)}%`;
        const txtStart = minutesToTimeString(hDebFinale * 60);
        const txtEnd = minutesToTimeString(hFinFinale * 60);
        ghostBar.querySelector('span').textContent = `${txtStart} - ${txtEnd}`;
    }
    async function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        barElement.style.opacity = '1';
        if (ghostBar.parentNode) ghostBar.parentNode.removeChild(ghostBar);
        if (hDebFinale !== hDebutInitiale || hFinFinale !== hFinInitiale) {
            await appliquerChangementDuree(reservationId, hDebFinale, hFinFinale, dateCibleVol, tableName, record);
        }
        setTimeout(() => {
            isResizing = false;
            document.body.style.userSelect = '';
            document.body.style.webkitUserSelect = '';
            document.body.style.mozUserSelect = '';
        }, 100);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

async function appliquerChangementDuree(reservationId, hDeb, hFin, dateCible, tableName = 'Réservations', record = null) {
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
    if (isMaintenance && record) {
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
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id: reservationId, fields: fieldsPatch }] })
        });
        if (response.ok) {
            const resData = await response.json();
            const resaId = resData.records?.[0]?.id || reservationId || '';
            const resa = (listeReservationsCache || []).find(r => r.id === reservationId);
            const pilote = Array.isArray(resa?.fields?.['Pilote']) ? resa.fields['Pilote'][0] : (resa?.fields?.['Pilote'] || '');
            const machine = Array.isArray(resa?.fields?.['Machine']) ? resa.fields['Machine'][0] : (resa?.fields?.['Machine'] || tableName);
            const avion = (listeAvionsCache || []).find(a => a.id === machine);
            const machineNom = (avion && avion.fields && (avion.fields['Immatriculation'] || avion.fields['Nom'])) || machine;
            const ancienDebut = resa?.fields?.['Date de début'] || '';
            const ancienFin = resa?.fields?.['Date de fin'] || '';
            if (typeof enregistrerAudit === 'function') {
                const message = `Nouveau : ${dateDebutOut.toISOString().slice(0,16).replace('T',' ')} - ${dateFinOut.toISOString().slice(0,16).replace('T',' ')}`;
                if (isMaintenance) {
                    await enregistrerAudit('Modification maintenance (durée)', tableName, message, 'Maintenance');
                } else {
                    await enregistrerAudit('Modification de réservation (durée)', machineNom, `Pilote : ${pilote} | Début initial : ${ancienDebut.slice(0,16).replace('T',' ')} | Fin initiale : ${ancienFin.slice(0,16).replace('T',' ')} | ${message}`, 'Planning');
                }
            }
            await chargerDonneesPlanning(true);
            const viewAeronefs = document.getElementById('view-aeronefs');
            if (viewAeronefs && viewAeronefs.style.display !== 'none') {
                chargerSuiviAeronef();
            }
        } else {
            const data = await response.json().catch(() => ({}));
            console.error('Échec modification durée:', response.status, data.error?.message || data);
        }
    } catch (error) {
        console.error(error);
    }
}

async function sauvegarderDeplacementVol(volId, avionId, nouvelleHeureDebut, dureeVol, tableName = 'Réservations', record = null, dateCible = null) {
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
        const startOfDay = new Date(annee, mois, jour, 0, 0, 0);
        const hOriginal = Math.max(0, Math.min(24, (mStart.getTime() - startOfDay.getTime()) / 3600000));
        const deltaHeures = nouvelleHeureDebut - hOriginal;
        const newStart = new Date(mStart.getTime() + deltaHeures * 3600000);
        const newEnd = new Date(mEnd.getTime() + deltaHeures * 3600000);
        fieldsPatch = { "Date": newStart.toISOString(), "durée": (newEnd - newStart) / 3600000 };
        dateDebutOut = newStart;
        dateFinOut = newEnd;
    } else if (isMaintenance) {
        fieldsPatch = { "Date": nouvelleDateDebut.toISOString(), "durée": dureeVol };
    } else {
        fieldsPatch = { "Date de début": nouvelleDateDebut.toISOString(), "Date de fin": nouvelleDateFin.toISOString() };
    }
    try {
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id: volId, fields: fieldsPatch }] })
        });
        if (response.ok) {
            const resData = await response.json();
            const resaId = resData.records?.[0]?.id || volId || '';
            const resa = (listeReservationsCache || []).find(r => r.id === volId);
            const pilote = Array.isArray(resa?.fields?.['Pilote']) ? resa.fields['Pilote'][0] : (resa?.fields?.['Pilote'] || '');
            const machine = Array.isArray(resa?.fields?.['Machine']) ? resa.fields['Machine'][0] : (resa?.fields?.['Machine'] || avionId);
            const avion = (listeAvionsCache || []).find(a => a.id === machine);
            const machineNom = (avion && avion.fields && (avion.fields['Immatriculation'] || avion.fields['Nom'])) || machine;
            const ancienDebut = resa?.fields?.['Date de début'] || '';
            const ancienFin = resa?.fields?.['Date de fin'] || '';
            if (typeof enregistrerAudit === 'function') {
                const message = `Nouveau : ${dateDebutOut.toISOString().slice(0,16).replace('T',' ')} - ${dateFinOut.toISOString().slice(0,16).replace('T',' ')}`;
                if (isMaintenance) {
                    await enregistrerAudit('Modification maintenance (déplacement)', tableName, message, 'Maintenance');
                } else {
                    await enregistrerAudit('Modification de réservation (déplacement)', machineNom, `Pilote : ${pilote} | Début initial : ${ancienDebut.slice(0,16).replace('T',' ')} | Fin initiale : ${ancienFin.slice(0,16).replace('T',' ')} | ${message}`, 'Planning');
                }
            }
            await chargerDonneesPlanning(true);
            const viewAeronefs = document.getElementById('view-aeronefs');
            if (viewAeronefs && viewAeronefs.style.display !== 'none') {
                chargerSuiviAeronef();
            }
        } else {
            const data = await response.json().catch(() => ({}));
            console.error('Échec déplacement réservation:', response.status, data.error?.message || data);
        }
    } catch (error) {
        console.error(error);
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
    const labelPilote = document.getElementById('label-pilote');
    const labelCommentaires = document.getElementById('label-commentaires');

    const typeSelectionne = getTypeVolSelectionne();
    const isVIPlaneur = typeSelectionne.includes('VI Planeur');
    const isVIMoteur = typeSelectionne.includes('VI Moteur');
    const isVI = isVIPlaneur || isVIMoteur;

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

    if (groupMachine) groupMachine.style.display = isVIPlaneur ? 'none' : 'block';
    if (groupEstimation) groupEstimation.style.display = isVI ? 'none' : 'block';
    if (groupPassager) groupPassager.style.display = isVI ? 'block' : 'none';
    if (groupTelephone) groupTelephone.style.display = isVI ? 'block' : 'none';

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

    if (isVI) {
        if (labelPilote) labelPilote.textContent = 'Nom du Pilote (optionnel) :';
        if (inputPilote) {
            inputPilote.placeholder = 'Ex: Jean Dupont';
            inputPilote.required = false;
        }
        if (labelCommentaires) labelCommentaires.textContent = 'COMMENTAIRES';
        if (groupCommentaires) groupCommentaires.style.display = 'block';
        if (inputEstimation) inputEstimation.required = false;
        return;
    }

    if (labelPilote) labelPilote.textContent = 'Nom du Pilote :';
    if (inputPilote) {
        inputPilote.placeholder = 'Ex: Jean Dupont';
        inputPilote.required = true;
    }
    if (labelCommentaires) labelCommentaires.textContent = 'COMMENTAIRES';
    if (groupCommentaires) groupCommentaires.style.display = 'none';
    if (inputEstimation) inputEstimation.required = true;
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
                const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}?records[]=${idVIModale}`, {
                    method: 'DELETE',
                    headers: headers
                });
                if (response.ok) {
                    if (typeof enregistrerAudit === 'function') {
                        const pilote = volVIModale?.pilote || '';
                        const dateVol = volVIModale?.debut ? volVIModale.debut.slice(0,16).replace('T',' ') : '';
                        const finVol = volVIModale?.fin ? volVIModale.fin.slice(0,16).replace('T',' ') : '';
                        await enregistrerAudit('Suppression VI Planeur', 'VI Planeur', `Pilote : ${pilote} | ${dateVol} - ${finVol}`, 'Initiation');
                    }
                    modal.style.display = 'none';
                    form.reset();
                    idVIModale = null;
                    tableVIModale = null;
                    afficherVIPPlaneur = false;
                    mettreAJourBoutonVIPPlaneur();
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
                        await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
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
                        await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({ fields: newRecord.fields })
                        });
                        await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
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
                    await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
                        method: methode,
                        headers: headers,
                        body: JSON.stringify({ records: [recordData] })
                    });
                }
                if (typeof enregistrerAudit === 'function') {
                    const action = idVIModale ? 'Modification' : 'Création';
                    const typeCible = table === 'VI Créneaux' ? 'Créneau VI' : 'VI Planeur';
                    await enregistrerAudit(`${action} ${typeCible}`, typeCible, `Pilote : ${pilote} | Passager : ${nomComplet} | ${dateDebut.slice(0,16).replace('T',' ')} - ${dateFin.slice(0,16).replace('T',' ')}`, 'Initiation');
                }
                modal.style.display = 'none';
                form.reset();
                idVIModale = null;
                tableVIModale = null;
                volVIModale = null;
                if (table === 'VI Planeur') {
                    afficherVIPPlaneur = true;
                    mettreAJourBoutonVIPPlaneur();
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
        });
        const check = document.createElement('span');
        check.className = 'nr-check';
        const icon = document.createElement('span');
        icon.className = 'nr-icon';
        icon.textContent = '✈️';
        const txt = document.createElement('span');
        txt.className = 'nr-label';
        txt.textContent = avion.fields['Immatriculation'] || avion.fields['Nom'] || 'Sans nom';
        label.appendChild(input);
        label.appendChild(check);
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
            if (value === 'VI Planeur' || value === 'VI Moteur') {
                document.querySelectorAll('input[name="form-type-vol"]').forEach(cb => { if (cb !== e.target) cb.checked = false; });
            } else {
                if (value === 'Local') {
                    document.querySelectorAll('input[name="form-type-vol"][value="Navigation"]').forEach(cb => cb.checked = false);
                } else if (value === 'Navigation') {
                    document.querySelectorAll('input[name="form-type-vol"][value="Local"]').forEach(cb => cb.checked = false);
                }
            }
            if (value === 'VI Moteur') {
                const debutInput = document.getElementById('form-debut');
                const finInput = document.getElementById('form-fin');
                if (debutInput && finInput && debutInput.value) {
                    const d = new Date(debutInput.value);
                    d.setHours(d.getHours() + 1);
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
    window.ouvrirModaleNouvelleReservation = async function(options = {}) {
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
        if (document.getElementById('form-debut')) document.getElementById('form-debut').value = `${dateBase}T09:00`;
        if (document.getElementById('form-fin')) {
            const d = new Date(`${dateBase}T09:00`);
            d.setMinutes(d.getMinutes() + (options.dureeMinutes || 120));
            document.getElementById('form-fin').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
        if (document.getElementById('form-estimation')) document.getElementById('form-estimation').value = '1.0';
        if (typeof peuplerInstructeursSelect === 'function') await peuplerInstructeursSelect();
        if (typeof peuplerPiloteSelect === 'function') await peuplerPiloteSelect();
        if (options.type) {
            document.querySelectorAll('input[name="form-type-vol"]').forEach(cb => { cb.checked = cb.value === options.type; });
        }
        if (options.instructeur) {
            const sel = document.getElementById('form-instructeur');
            if (sel) {
                const match = Array.from(sel.options).find(o => o.value === options.instructeur || correspondanceNom(o.value, options.instructeur));
                if (match) sel.value = match.value;
            }
        }
        appliquerEtatFormulaire();
        modal.style.display = 'flex';
    }

    if (btnOpenModal && modal) {
        btnOpenModal.addEventListener('click', () => window.ouvrirModaleNouvelleReservation());
    }
    if (btnCloseModal) btnCloseModal.addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (e) => { if (modal && e.target === modal) modal.style.display = 'none'; });
    if (formReservation) {
        formReservation.addEventListener('submit', async (e) => {
            e.preventDefault();
            const typesVol = getTypeVolSelectionne();
            const piloteNom = document.getElementById('form-pilote').value.trim();
            const passagerNom = document.getElementById('form-passager') ? document.getElementById('form-passager').value.trim() : '';
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
            const dateDebut = localDebut.toISOString();
            const dateFin = localFin.toISOString();
            const isVIPlaneur = typesVol.includes('VI Planeur');
            const isVIMoteur = typesVol.includes('VI Moteur');
            const isVI = isVIPlaneur || isVIMoteur;
            const instructeur = document.getElementById('form-instructeur') ? document.getElementById('form-instructeur').value.trim() : '';
            let machineNom = 'Tous';
            if (isVIMoteur || !isVI) {
                const selectedMachine = getMachineSelectionnee();
                const avion = (listeAvionsCache || []).find(a => a.id === selectedMachine);
                machineNom = (avion && avion.fields && (avion.fields['Immatriculation'] || avion.fields['Nom'])) || selectedMachine || 'Tous';
            }
            if (instructeur && typeof verifierConflitDisponibiliteInstructeur === 'function') {
                const conflit = await verifierConflitDisponibiliteInstructeur(instructeur, localDebut, localFin, machineNom);
                if (conflit && !confirm("L'instructeur n'est pas disponible sur ce créneau. Voulez-vous quand même réserver ?")) return;
            }
            if (isVI) {
                if (!passagerNom) {
                    alert("Le nom du passager est obligatoire.");
                    return;
                }
                if (!telephone) {
                    alert("Le téléphone du passager est obligatoire.");
                    return;
                }
                const commentaire = document.getElementById('form-commentaires').value.trim();
                if (isVIPlaneur) {
                    const recordData = { fields: { "Nom": passagerNom, "Pilote": piloteNom, "Téléphone": telephone, "Date de début": dateDebut, "Date de fin": dateFin, "Commentaire": commentaire } };
                    try {
                        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}`, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({ records: [recordData] })
                        });
                        if (response.ok) {
                            modal.style.display = 'none';
                            formReservation.reset();
                            afficherVIPPlaneur = true;
                            mettreAJourBoutonVIPPlaneur();
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
                        "Type de vol": typesVol,
                        "Machine": [machineId],
                        "Pilote": piloteNom,
                        "Instructeur": instructeur,
                        "Passager": passagerNom,
                        "Téléphone": telephone,
                        "Date de début": dateDebut,
                        "Date de fin": dateFin,
                        "Commentaires VI": "",
                        "Temps estimé": 1
                    }
                };
                let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}`;
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
            const commentaires = document.getElementById('form-commentaires').value;
            const tempsEstime = parseFloat(document.getElementById('form-estimation').value) || 0;
            const recordData = {
                fields: {
                    "Type de vol": typesVol,
                    "Machine": [machineId],
                    "Pilote": piloteNom,
                    "Instructeur": instructeur,
                    "Date de début": dateDebut,
                    "Date de fin": dateFin,
                    "Commentaires VI": "",
                    "Temps estimé": tempsEstime
                }
            };
            let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}`;
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
                    const details = idReservationEnEdition
                        ? `Pilote : ${piloteNom} | Type : ${typesVol} | Ancien : ${ancienDebut.slice(0,16).replace('T',' ')} - ${ancienFin.slice(0,16).replace('T',' ')} → Nouveau : ${dateDebut.slice(0,16).replace('T',' ')} - ${dateFin.slice(0,16).replace('T',' ')}`
                        : `Pilote : ${piloteNom} | Type : ${typesVol} | ${dateDebut.slice(0,16).replace('T',' ')} - ${dateFin.slice(0,16).replace('T',' ')}`;
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
                const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?records[]=${idReservationEnEdition}`, {
                    method: 'DELETE',
                    headers: headers
                });
                if (response.ok) {
                    const resaPilote = Array.isArray(resa?.fields?.['Pilote']) ? resa.fields['Pilote'][0] : (resa?.fields?.['Pilote'] || '');
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
    modal.style.display = 'flex';
}

async function ouvrirModaleEdition(vol, avionIdOuImmat) {
    if (!modal) return;
    if (!peutBougerReservations() && !estProprietaireReservation(vol)) {
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
    const sel = document.getElementById('form-instructeur');
    if (sel) {
        const saved = vol.fields['Instructeur'];
        let nom = '';
        if (saved) {
            const idInstructeur = Array.isArray(saved) ? saved[0] : saved;
            if (typeof listeInstructeursCache !== 'undefined' && listeInstructeursCache.length) {
                const found = listeInstructeursCache.find(i => i.id === idInstructeur || i.nomComplet === idInstructeur);
                nom = found ? found.nomComplet : idInstructeur;
            } else {
                nom = idInstructeur.toString().trim();
            }
        }
        const options = Array.from(sel.options);
        const match = nom && options.find(o => o.value && typeof correspondanceNom === 'function' && correspondanceNom(o.value, nom));
        sel.value = match ? match.value : (options.some(o => o.value === nom) ? nom : '');
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
    if (document.getElementById('form-passager')) document.getElementById('form-passager').value = vol.fields['Passager'] || '';
    if (document.getElementById('form-telephone')) document.getElementById('form-telephone').value = vol.fields['Téléphone'] || '';
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
        currentDateEl.addEventListener('click', () => {
            const annee = dateAffichee.getFullYear();
            const mois = (dateAffichee.getMonth() + 1).toString().padStart(2, '0');
            const jour = dateAffichee.getDate().toString().padStart(2, '0');
            const datePrompt = prompt("Aller à la date (JJ/MM/AAAA) :", `${jour}/${mois}/${annee}`);
            if (datePrompt) {
                const [d, m, y] = datePrompt.split('/').map(Number);
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
            afficherVIPPlaneur = !afficherVIPPlaneur;
            mettreAJourBoutonVIPPlaneur();
            chargerDonneesPlanning(false, false);
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

function afficherVolsInitiation() {
    const container = document.getElementById('initiation-list');
    if (!container) return;
    const maintenant = new Date();
    const vols = normaliserVolsInitiation().filter(v => {
        if (!filtreTypesInitiation.includes(v.type)) return false;
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
        const message = messages[filtreInitiationActif] || 'Aucun vol.';
        container.innerHTML = `<div class="initiation-empty">${message}</div>`;
        return;
    }
    container.innerHTML = '';
    vols.forEach(vol => {
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
        const peutSInscrire = !estArchive && isAPourvoir && (vol.source === 'creneau' ? hasRolePiloteVI() : !!nomPiloteCourant());
        const boutonSInscrire = peutSInscrire ? `<button class="btn-reserver-initiation" data-id="${vol.id}" data-source="${vol.source}">S'inscrire</button>` : '';
        const card = document.createElement('div');
        card.className = `initiation-card ${vol.classe}`;
        card.innerHTML = `
            <div class="initiation-info">
                <h4>🎯 Vol d'Initiation ${typeText} — ${nomClient}</h4>
                <p>📅 ${vol.dateStr} • ${vol.heureDebut} - ${vol.heureFin}</p>
                <p>${machineText}📞 ${vol.telephone || 'Non renseigné'}</p>
                ${vol.commentaire ? `<p style="margin-top:6px; font-style:italic;">💬 ${vol.commentaire}</p>` : ''}
            </div>
            <div class="initiation-meta">
                <strong>${piloteText}</strong>
                ${boutonSInscrire}
            </div>
        `;
        if (hasRoleGestionVI()) {
            card.style.cursor = 'pointer';
            card.title = 'Cliquer pour modifier';
            card.addEventListener('click', (e) => {
                if (e.target.closest('.btn-reserver-initiation')) return;
                editerVolInitiation(vol);
            });
        }
        container.appendChild(card);
    });
}

async function chargerVolsInitiation() {
    const dateEl = document.getElementById('current-date-initiation');
    if (dateEl) dateEl.textContent = 'Vue globale';
    const container = document.getElementById('initiation-list');
    if (container) container.innerHTML = "<div class='loading'>Chargement des vols d'initiation...</div>";
    try {
        const urlVIPlaneur = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}?pageSize=100&sort[0][field]=${encodeURIComponent('Date de début')}&sort[0][direction]=asc`;
        const resVI = await cachedFetch(urlVIPlaneur, { headers });
        const dataVI = await resVI.json();
        const typeFormula = `OR(FIND('VI Moteur', {Type de vol}), FIND("Vol d'Initiation", {Type de vol}), FIND("Vol d'Initiation (VI)", {Type de vol}))`;
        const urlReservations = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(typeFormula)}&pageSize=100&sort[0][field]=${encodeURIComponent('Date de début')}&sort[0][direction]=asc`;
        const resResa = await cachedFetch(urlReservations, { headers });
        const dataResa = await resResa.json();
        const urlCreneaux = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Créneaux')}?pageSize=100&sort[0][field]=Date&sort[0][direction]=asc&sort[1][field]=${encodeURIComponent('Heure début')}&sort[1][direction]=asc`;
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
            const urlConflit = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(formulaConflit)}&pageSize=100`;
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

    function setFiltreTypes() {
        filtreTypesInitiation = Array.from(document.querySelectorAll('input[name="initiation-type-filtre"]:checked')).map(cb => cb.value);
        afficherVolsInitiation();
    }
    const typeCheckboxes = document.querySelectorAll('input[name="initiation-type-filtre"]');
    if (typeCheckboxes.length) {
        typeCheckboxes.forEach(cb => cb.addEventListener('change', setFiltreTypes));
        setFiltreTypes();
    }

    if (list) {
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-reserver-initiation');
            if (btn) {
                e.stopPropagation();
                reserverVolInitiation(btn.dataset.id, btn.dataset.source);
            }
        });
    }
    initGestionnaireChoixModifier();
}

function editerVolInitiation(vol) {
    if (!hasRoleGestionVI()) return;
    if (vol.source === 'planeur') {
        const volEdit = {
            id: vol.id,
            fields: {
                'Nom': vol.passager,
                'Pilote': vol.pilote,
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

async function supprimerCreneauVI(vol) {
    if (!vol || !vol.id) return;
    const table = vol._table || 'VI Créneaux';
    if (!confirm('Es-tu sûr de vouloir supprimer ce créneau ?')) return;
    try {
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?records[]=${vol.id}`, {
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
    if (info) info.innerHTML = `Modifier le créneau de <strong>${escapeHtml(vol.passager || '')}</strong> ?`;
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
    const tableName = source === 'planeur' ? 'VI Planeur' : (source === 'creneau' ? 'VI Créneaux' : 'Réservations');
    try {
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`, {
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

function hasRolePiloteVI() {
    if (!currentUser) return false;
    const roles = currentUser.roles || [];
    return roles.includes('Pilote VI') || roles.includes('Super admin') || roles.includes('Gestion VI');
}

function updateGestionVI() {
    const toolbar = document.getElementById('gestion-vi-toolbar');
    if (toolbar) toolbar.style.display = hasRoleGestionVI() ? 'block' : 'none';
    const tabCreneaux = document.getElementById('btn-initiation-creneaux');
    if (tabCreneaux) tabCreneaux.style.display = hasRoleGestionVI() ? 'inline-block' : 'none';
}

function initGestionCreneauxVI() {
    updateGestionVI();
    const form = document.getElementById('form-creneaux-vi');
    if (form) {
        form.addEventListener('submit', creerCreneauxVI);
    }
}

async function creerCreneauxVI(e) {
    e.preventDefault();
    const type = document.getElementById('gv-type').value;
    const date = document.getElementById('gv-date').value;
    const debut = document.getElementById('gv-debut').value;
    const fin = document.getElementById('gv-fin').value;
    const dureeMin = parseInt(document.getElementById('gv-duree').value, 10);
    const nombre = parseInt(document.getElementById('gv-nombre').value, 10);
    if (!type || !date || !debut || !fin || !dureeMin || !nombre) {
        alert('Tous les champs sont requis.');
        return;
    }
    const debutMin = timeToMinutes(debut);
    const finMin = timeToMinutes(fin);
    if (finMin <= debutMin) {
        alert('L\'heure de fin doit être après l\'heure de début.');
        return;
    }
    const maxSlots = Math.floor((finMin - debutMin) / dureeMin);
    const slots = Math.min(nombre, maxSlots);
    if (slots <= 0) {
        alert('Aucun créneau ne tient dans l\'intervalle.');
        return;
    }
    const records = [];
    for (let i = 0; i < slots; i++) {
        const start = debutMin + i * dureeMin;
        const end = start + dureeMin;
        records.push({
            fields: {
                'Date': date,
                'Heure début': minutesToTimeString(start),
                'Heure fin': minutesToTimeString(end),
                'Type': type,
                'Statut': 'Disponible'
            }
        });
    }
    try {
        for (let i = 0; i < records.length; i += 10) {
            const batch = records.slice(i, i + 10);
            const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Créneaux')}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ records: batch })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        }
        if (typeof enregistrerAudit === 'function') {
            const pilote = nomPiloteCourant();
            await enregistrerAudit('Création créneaux VI', type, `Pilote : ${pilote} | Date : ${date} | Nombre : ${records.length} | ${debut} - ${fin}`, 'Initiation');
        }
        alert(`${records.length} créneau(x) créé(s).`);
        document.getElementById('form-creneaux-vi').reset();
        if (typeof chargerVolsInitiation === 'function') chargerVolsInitiation();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la création : ' + err.message);
    }
}

setInterval(actualiserLigneHeureCourante, 60000);
actualiserLigneHeureCourante();