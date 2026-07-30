/* ==========================================================================
   PLANNING - GESTION DES RÉSERVATIONS ET PLANNING
   ========================================================================== */

// Les variables globales sont définies dans app.js
let afficherVIPPlaneur = false;
let idVIEPlaneurEnEdition = null;
let listeVolsInitiationCache = [];
let filtreInitiationActif = 'dispos';

function parseTempsDeVol(tempsStr) {
    if (!tempsStr) return NaN;
    const match = String(tempsStr).trim().match(/^(\d+)h(\d{2})$/i);
    if (!match) return NaN;
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    return h + m / 60;
}

// --- FONCTION POUR METTRE À JOUR L'HORAMÈTRE ---
async function mettreAJourHorametreAeronef(avionId, heuresAjoutees) {
    try {
        const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}/${avionId}`, {
            headers: headers
        });
        const avion = await response.json();

        if (!avion.fields || avion.fields['Horamètre actuel'] === undefined) {
            console.error("Horamètre non trouvé pour l'aéronef:", avionId);
            return;
        }

        const nouvelHorametre = parseFloat(avion.fields['Horamètre actuel']) + parseFloat(heuresAjoutees);

        const updateResponse = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}/${avionId}`, {
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

        const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Carnet de route')}`, {
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

// --- FONCTION POUR OUVRIR LA MODALE DE MODIFICATION ---
function ouvrirModaleModification(reservationId) {
    if (!reservationId) return;

    // Trouver la réservation dans le cache
    const reservation = listeReservationsCache.records.find(r => r.id === reservationId);
    if (!reservation || !reservation.fields) {
        alert("Réservation introuvable.");
        return;
    }

    // Remplir le formulaire avec les données de la réservation
    const form = document.getElementById('form-reservation');
    if (!form) return;

    // Remplir les champs du formulaire
    form['form-debut'].value = reservation.fields['Date de début'] ? new Date(reservation.fields['Date de début']).toISOString().slice(0, 16) : '';
    form['form-fin'].value = reservation.fields['Date de fin'] ? new Date(reservation.fields['Date de fin']).toISOString().slice(0, 16) : '';

    // Remplir le pilote (si c'est un ID, il faudra le convertir en nom)
    if (reservation.fields['Pilote']) {
        form['form-pilote'].value = reservation.fields['Pilote'].join(', '); // Supposons que c'est un tableau d'IDs
    }

    // Remplir la machine
    if (reservation.fields['Machine']) {
        form['form-machine'].value = reservation.fields['Machine'].join(', '); // Supposons que c'est un tableau d'IDs
    }

    // Remplir le type de vol
    form['form-type-vol'].value = reservation.fields['Type de vol'] || 'Vol Classique';

    // Stocker l'ID de la réservation en cours d'édition
    idReservationEnEdition = reservationId;

    // Afficher la modale
    const modal = document.getElementById('modal-reservation');
    if (modal) {
        modal.style.display = 'block';
    }
}

// --- FONCTION POUR SAUVEGARDER UNE RÉSERVATION ---
async function sauvegarderReservation() {
    const form = document.getElementById('form-reservation');
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

    // Récupérer le pilote (si c'est un nouveau pilote, il faudra le créer)
    const piloteNom = reservationData['form-pilote'];
    let piloteId = null;

    // TODO: Ajouter la logique pour créer un nouveau pilote si nécessaire
    piloteId = "recPilote123"; // À remplacer par la logique réelle

    // Calculer la durée du vol en heures
    const heureDebut = new Date(reservationData['form-debut']);
    const heureFin = new Date(reservationData['form-fin']);
    const dureeHeures = (heureFin - heureDebut) / (1000 * 60 * 60);

    try {
        if (idReservationEnEdition) {
            // METTRE À JOUR UNE RÉSERVATION EXISTANTE
            const updateResponse = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}/${idReservationEnEdition}`, {
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
            const reservationResponse = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}`, {
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
            await mettreAJourHorametreAeronef(avionId, dureeHeures);
            await ajouterAuCarnetDeRoute(avionId, piloteId, dureeHeures);
        }

        // Rafraîchir les données
        chargerDonneesPlanning();

        // Fermer la modale
        const modal = document.getElementById('modal-reservation');
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
    if (!confirm("Es-tu sûr de vouloir supprimer cette réservation ?")) return;

    try {
        const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?records[]=${idReservationEnEdition}`, {
            method: 'DELETE',
            headers: headers
        });

        if (response.ok) {
            // TODO: Annuler la mise à jour de l'horamètre

            // Rafraîchir les données
            chargerDonneesPlanning();

            // Fermer la modale
            const modal = document.getElementById('modal-reservation');
            if (modal) modal.style.display = 'none';
            document.getElementById('form-reservation').reset();
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
    if (modalTitle) modalTitle.textContent = "Modifier VI Planeur";
    if (btnDeleteVI) btnDeleteVI.style.display = 'block';
    if (!modal) return;
    idVIEPlaneurEnEdition = vol.id;
    document.getElementById('form-vi-nom').value = (vol.fields['Nom'] || '').toString().trim();
    document.getElementById('form-vi-debut').value = formaterPourInput(new Date(vol.fields['Date de début']));
    document.getElementById('form-vi-fin').value = formaterPourInput(new Date(vol.fields['Date de fin']));
    document.getElementById('form-vi-pilote').value = (vol.fields['Pilote'] || '').toString().trim();
    document.getElementById('form-vi-commentaire').value = (vol.fields['Commentaire'] || '').toString().trim();
    modal.style.display = 'flex';
}

function afficherLigneVIPlaneur(volsVIP, rowsContainer, soleil) {
    if (!afficherVIPPlaneur) return;
    const rowDiv = document.createElement('div');
    rowDiv.className = 'timeline-row vi-planeur-row';
    const machineCell = document.createElement('div');
    machineCell.className = 'machine-cell';
    machineCell.textContent = 'VI Planeur';
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
        gridBg.appendChild(gridBlock);
    }

    volsVIP.forEach(vol => {
        if (!vol.fields) return;
        const nom = (vol.fields['Nom'] || '').toString().trim();
        const pilote = (vol.fields['Pilote'] || '').toString().trim();
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
                const classePilote = pilote ? 'vi-avec-pilote' : 'vi-sans-pilote';
                barresDiv.className = `reservation-bar ${classePilote}`;
                barresDiv.style.left = `${(heureDebut / 24) * 100}%`;
                barresDiv.style.width = `${(duree / 24) * 100}%`;
                const libelle = pilote ? `🎯 VIP (${formaterNomPilote(pilote)})` : '🎯 VI DISPONIBLE';
                barresDiv.innerHTML = `<strong>${libelle}</strong>`;
                barresDiv.title = vol.fields['Commentaire'] || '';
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
                barresDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isResizing || isDraggingBar) return;
                    ouvrirModaleEditionVIPlaneur(vol);
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
        if (forceRefresh || listeAvionsCache.length === 0) {
            const resAvions = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}`, { headers });
            const dataAvions = await resAvions.json();
            if (dataAvions.records) listeAvionsCache = dataAvions.records;
        }
        if (forceRefresh || listeReservationsCache.length === 0) {
            const urlReservations = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')<='${debutJour}', DATETIME_FORMAT({Date de fin}, 'YYYY-MM-DD')>='${debutJour}')`)}`;
            const resReservations = await fetch(urlReservations, { headers });
            const dataReservations = await resReservations.json();
            if (dataReservations.records) listeReservationsCache = dataReservations.records;
        }
        const urlVIPlaneur = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}?filterByFormula=DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')='${debutJour}'`;
        const resVIPlaneur = await fetch(urlVIPlaneur, { headers });
        const dataVIPlaneur = await resVIPlaneur.json();
        const volsVIP = (dataVIPlaneur.records || []).filter(vol => {
            if (!vol.fields) return false;
            const debutRaw = vol.fields['Date de début'];
            if (!debutRaw) return false;
            const dateVol = new Date(debutRaw);
            return dateVol.getFullYear() === dateAffichee.getFullYear() &&
                   dateVol.getMonth() === dateAffichee.getMonth() &&
                   dateVol.getDate() === dateAffichee.getDate();
        });
        const urlCarnetPilotes = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Carnet de route Pilotes')}`;
        const resCarnetPilotes = await fetch(urlCarnetPilotes, { headers });
        const dataCarnetPilotes = await resCarnetPilotes.json();
        const carnetsPilotes = (dataCarnetPilotes.records || []).filter(r => {
            const f = r.fields || {};
            return String(f['Date'] || '').startsWith(debutJour);
        });
        const urlMaintenance = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Maintenance')}`;
        const resMaintenance = await fetch(urlMaintenance, { headers });
        const dataMaintenance = await resMaintenance.json();
        const maintenancesJour = (dataMaintenance.records || []).filter(r => {
            const f = r.fields || {};
            return String(f['Date'] || '').startsWith(debutJour);
        });
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
            const volsAvion = listeReservationsCache.filter(res => {
                if (!res.fields) return false;
                const linkAvion = res.fields['Machine'] || [];
                const debutRaw = res.fields['Date de début'];
                const finRaw = res.fields['Date de fin'];
                if (!linkAvion.includes(avionId) || !debutRaw || !finRaw) return false;
                const dateVol = new Date(debutRaw);
                const dateFin = new Date(finRaw);
                return dateVol < dayEnd && dateFin > dayStart;
            });
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
                const piloteNom = vol.fields['Pilote'] || '';
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
                        barresDiv.style.left = `${(heureDebut / 24) * 100}%`;
                        barresDiv.style.width = `${(duree / 24) * 100}%`;
                        barresDiv.style.boxSizing = 'border-box';
                        barresDiv.style.borderLeft = '5px solid #1e3d59';
                        barresDiv.style.borderTopLeftRadius = '4px';
                        barresDiv.style.borderBottomLeftRadius = '4px';
                        barresDiv.style.zIndex = '5';
                        if (duree <= 2) {
                            barresDiv.classList.add('short-reservation');
                        }
                        let libelleEntete = piloteFormate || 'Pilote non défini';
                        const typesVol = Array.isArray(typeVol) ? typeVol : [typeVol];
                        const isVIMoteur = typesVol.includes('VI Moteur');
                        const isAncienVI = typesVol.includes("Vol d'Initiation") || typesVol.includes("Vol d'Initiation (VI)");
                        if (isVIMoteur || isAncienVI) {
                            if (!piloteNom || piloteNom.trim() === "") {
                                barresDiv.classList.add('vi-sans-pilote');
                                libelleEntete = isVIMoteur ? "🎯 VI Moteur dispo" : "🎯 VI DISPONIBLE";
                            } else {
                                barresDiv.classList.add('vi-avec-pilote');
                                libelleEntete = isVIMoteur ? `🎯 VI Moteur (${piloteFormate})` : `🎯 VI (${piloteFormate})`;
                            }
                        }
                        barresDiv.innerHTML = `<strong>${libelleEntete}</strong>`;
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
                        barresDiv.addEventListener('mouseenter', () => { barresDiv.style.zIndex = '100'; });
                        barresDiv.addEventListener('mouseleave', () => { barresDiv.style.zIndex = '5'; });
                        gridBg.appendChild(barresDiv);
                        barresInfos.push({ bar: barresDiv, debut: heureDebut, fin: heureFin, vol });
                    }
                }
            });
            // Détection et affichage des conflits de superposition
            for (let i = 0; i < barresInfos.length; i++) {
                for (let j = i + 1; j < barresInfos.length; j++) {
                    const a = barresInfos[i];
                    const b = barresInfos[j];
                    const chevauchementDebut = Math.max(a.debut, b.debut);
                    const chevauchementFin = Math.min(a.fin, b.fin);
                    if (chevauchementFin > chevauchementDebut) {
                        const dureeConflit = chevauchementFin - chevauchementDebut;
                        function ajouterOverlayConflit(barInfo) {
                            const dureeBar = barInfo.fin - barInfo.debut;
                            const overlay = document.createElement('div');
                            overlay.className = 'conflit-overlay';
                            overlay.style.position = 'absolute';
                            overlay.style.top = '0';
                            overlay.style.left = `${((chevauchementDebut - barInfo.debut) / dureeBar) * 100}%`;
                            overlay.style.width = `${(dureeConflit / dureeBar) * 100}%`;
                            overlay.style.height = '100%';
                            overlay.style.backgroundColor = 'rgba(255, 255, 0, 0.55)';
                            overlay.style.pointerEvents = 'none';
                            overlay.style.zIndex = '1';
                            overlay.style.border = '1px dashed #c0392b';
                            overlay.style.display = 'flex';
                            overlay.style.alignItems = 'center';
                            overlay.style.justifyContent = 'center';
                            overlay.title = `Conflit horaire de ${convertirHeureEnHHMM(chevauchementDebut)} à ${convertirHeureEnHHMM(chevauchementFin)}`;
                            overlay.innerHTML = `<span style="font-size:14px; pointer-events:none;">⚠️</span>`;
                            barInfo.bar.insertBefore(overlay, barInfo.bar.firstChild);
                        }
                        ajouterOverlayConflit(a);
                        ajouterOverlayConflit(b);
                        a.bar.title = (a.bar.title ? a.bar.title + ' | ' : '') + 'Conflit horaire détecté';
                        b.bar.title = (b.bar.title ? b.bar.title + ' | ' : '') + 'Conflit horaire détecté';
                    }
                }
            }
            const immatAvion = (avion.fields['Immatriculation'] || '').toString().trim().toUpperCase();
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
                        const pilote = f['Pilote'] || '';
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
            const maintenanceAvion = maintenancesJour.find(m => {
                const f = m.fields || {};
                return (f['Machine'] || '').toString().trim().toUpperCase() === immatAvion;
            });
            if (maintenanceAvion) {
                const maintenanceDate = new Date(maintenanceAvion.fields['Date']);
                const heureMaint = maintenanceDate.getHours() + (maintenanceDate.getMinutes() / 60);
                const left = (heureMaint / 24) * 100;
                const duree = parseFloat(maintenanceAvion.fields['durée']) || 1;
                const widthPct = Math.min((duree / 24) * 100, 100 - left);
                const maintenanceBubble = document.createElement('div');
                maintenanceBubble.style.cssText = `
                    position: absolute;
                    top: 5px;
                    left: ${left}%;
                    width: ${widthPct}%;
                    min-width: 18px;
                    height: 25px;
                    background-color: rgba(124, 58, 237, 0.7);
                    border-radius: 3px;
                    cursor: pointer;
                    overflow: hidden;
                    color: white;
                    font-size: 10px;
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 4;
                    pointer-events: auto;
                `;
                maintenanceBubble.textContent = widthPct > 12 ? '🔧 Maintenance' : '🔧';
                const butee = maintenanceAvion.fields['Nouvelle Butée'] || '';
                const heureStr = maintenanceDate.getHours().toString().padStart(2, '0') + ':' + maintenanceDate.getMinutes().toString().padStart(2, '0');
                maintenanceBubble.title = `Maintenance à ${heureStr} (${duree}h) - Nouvelle butée : ${butee}`;
                maintenanceBubble.addEventListener('click', (e) => {
                    e.stopPropagation();
                    ouvrirModaleMaintenance(maintenanceAvion);
                });
                gridBg.appendChild(maintenanceBubble);
            }
            rowsContainer.appendChild(rowDiv);
        });
        if (autoActiverVIP && volsVIP.length > 0) afficherVIPPlaneur = true;
        mettreAJourBoutonVIPPlaneur();
        afficherLigneVIPlaneur(volsVIP, rowsContainer, soleil);
        await chargerPresencesPlaneur();
        await chargerPresencesClub();
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
        const heureStr = h.toString().padStart(2, '0') + ':00';
        const div = document.createElement('div');
        div.className = 'hour-cell-header';
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

function initierDeplacementBarre(e, volId, avionId, gridBg, barresDiv, heureDebutInitiale, dureeVol, callbackMiseAJour, tableName = 'Réservations') {
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
            ghost.style.width = `${(dureeVol / 24) * 100}%`;
            ghost.style.left = `${(heureDebutInitiale / 24) * 100}%`;
            const hDebutStr = convertirHeureEnHHMM(heureDebutInitiale);
            const hFinStr = convertirHeureEnHHMM(heureDebutInitiale + dureeVol);
            ghost.innerHTML = `<span>${hDebutStr} - ${hFinStr}</span>`;
            gridBg.appendChild(ghost);
        }
        const xPos = evt.clientX - rectGrid.left;
        let pourcentageX = Math.max(0, Math.min(1, xPos / rectGrid.width));
        let nouvelleHeureDebut = pourcentageX * 24;
        nouvelleHeureDebut = Math.round(nouvelleHeureDebut * 4) / 4;
        if (nouvelleHeureDebut + dureeVol > 24) {
            nouvelleHeureDebut = 24 - dureeVol;
        }
        ghost.style.left = `${(nouvelleHeureDebut / 24) * 100}%`;
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
            let heureFinale = Math.round((pourcentageFin * 24) * 4) / 4;
            if (heureFinale + dureeVol > 24) heureFinale = 24 - dureeVol;
            if (typeof sauvegarderDeplacementVol === 'function') {
                sauvegarderDeplacementVol(volId, avionId, heureFinale, dureeVol, tableName);
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

function initierResize(e, reservationId, parentGrid, barElement, bord, hDebutInitiale, hFinInitiale, dateCibleVol, tableName = 'Réservations') {
    e.preventDefault();
    isResizing = true;
    barElement.style.opacity = '0.3';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.mozUserSelect = 'none';
    const rectGrid = parentGrid.getBoundingClientRect();
    const ghostBar = document.createElement('div');
    ghostBar.className = 'ghost-bar-preview';
    ghostBar.innerHTML = `<span style="font-size:11px; font-weight:bold; color:#1e3d59; display:block; text-align:center; margin-top:15px;"></span>`;
    ghostBar.style.left = `${(hDebutInitiale / 24) * 100}%`;
    ghostBar.style.width = `${((hFinInitiale - hDebutInitiale) / 24) * 100}%`;
    parentGrid.appendChild(ghostBar);
    let hDebFinale = hDebutInitiale;
    let hFinFinale = hFinInitiale;
    function onMouseMove(moveEvent) {
        const xRelatif = moveEvent.clientX - rectGrid.left;
        let pourcentage = xRelatif / rectGrid.width;
        pourcentage = Math.max(0, Math.min(1, pourcentage));
        let heureCalculee = Math.round(pourcentage * 24 * 4) / 4;
        if (bord === 'gauche') {
            if (heureCalculee >= hFinInitiale) heureCalculee = hFinInitiale - 0.25;
            hDebFinale = heureCalculee;
        } else {
            if (heureCalculee <= hDebutInitiale) heureCalculee = hDebutInitiale + 0.25;
            hFinFinale = heureCalculee;
        }
        ghostBar.style.left = `${(hDebFinale / 24) * 100}%`;
        ghostBar.style.width = `${((hFinFinale - hDebFinale) / 24) * 100}%`;
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
            await appliquerChangementDuree(reservationId, hDebFinale, hFinFinale, dateCibleVol, tableName);
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

async function appliquerChangementDuree(reservationId, hDeb, hFin, dateCible, tableName = 'Réservations') {
    const referenceDate = dateCible ? new Date(dateCible) : dateAffichee;
    const annee = referenceDate.getFullYear();
    const mois = referenceDate.getMonth();
    const jour = referenceDate.getDate();
    const dateDebut = new Date(annee, mois, jour, Math.floor(hDeb), (hDeb % 1) * 60, 0);
    const dateFin = new Date(annee, mois, jour, Math.floor(hFin), (hFin % 1) * 60, 0);
    try {
        const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id: reservationId, fields: { "Date de début": dateDebut.toISOString(), "Date de fin": dateFin.toISOString() } }] })
        });
        if (response.ok) {
            await chargerDonneesPlanning(true);
            const viewAeronefs = document.getElementById('view-aeronefs');
            if (viewAeronefs && viewAeronefs.style.display !== 'none') {
                chargerSuiviAeronef();
            }
        }
    } catch (error) {
        console.error(error);
    }
}

async function sauvegarderDeplacementVol(volId, avionId, nouvelleHeureDebut, dureeVol, tableName = 'Réservations') {
    const annee = dateAffichee.getFullYear();
    const mois = dateAffichee.getMonth();
    const jour = dateAffichee.getDate();
    const hInteger = Math.floor(nouvelleHeureDebut);
    const mInteger = Math.round((nouvelleHeureDebut % 1) * 60);
    const nouvelleDateDebut = new Date(annee, mois, jour, hInteger, mInteger, 0);
    const nouvelleDateFin = new Date(nouvelleDateDebut.getTime() + (dureeVol * 60 * 60 * 1000));
    try {
        const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id: volId, fields: { "Date de début": nouvelleDateDebut.toISOString(), "Date de fin": nouvelleDateFin.toISOString() } }] })
        });
        if (response.ok) {
            await chargerDonneesPlanning(true);
            const viewAeronefs = document.getElementById('view-aeronefs');
            if (viewAeronefs && viewAeronefs.style.display !== 'none') {
                chargerSuiviAeronef();
            }
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
        if (labelCommentaires) labelCommentaires.textContent = 'Commentaire :';
        if (groupCommentaires) groupCommentaires.style.display = 'block';
        if (inputEstimation) inputEstimation.required = false;
        return;
    }

    if (labelPilote) labelPilote.textContent = 'Nom du Pilote :';
    if (inputPilote) {
        inputPilote.placeholder = 'Ex: Jean Dupont';
        inputPilote.required = true;
    }
    if (labelCommentaires) labelCommentaires.textContent = 'Commentaires & Contacts VI :';
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
            if (!idVIEPlaneurEnEdition) return;
            if (!confirm("Es-tu sûr de vouloir supprimer ce VI Planeur ?")) return;
            try {
                const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}?records[]=${idVIEPlaneurEnEdition}`, {
                    method: 'DELETE',
                    headers: headers
                });
                if (response.ok) {
                    modal.style.display = 'none';
                    form.reset();
                    idVIEPlaneurEnEdition = null;
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
            const nom = document.getElementById('form-vi-nom').value.trim();
            const dateDebut = new Date(document.getElementById('form-vi-debut').value).toISOString();
            const dateFin = new Date(document.getElementById('form-vi-fin').value).toISOString();
            const pilote = document.getElementById('form-vi-pilote').value.trim();
            const commentaire = document.getElementById('form-vi-commentaire').value.trim();
            if (!nom) return;
            const recordData = { fields: { "Nom": nom, "Date de début": dateDebut, "Date de fin": dateFin, "Pilote": pilote, "Commentaire": commentaire } };
            let methode = 'POST';
            if (idVIEPlaneurEnEdition) {
                recordData.id = idVIEPlaneurEnEdition;
                methode = 'PATCH';
            }
            try {
                const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}`, {
                    method: methode,
                    headers: headers,
                    body: JSON.stringify({ records: [recordData] })
                });
                if (response.ok) {
                    modal.style.display = 'none';
                    form.reset();
                    idVIEPlaneurEnEdition = null;
                    afficherVIPPlaneur = true;
                    mettreAJourBoutonVIPPlaneur();
                    chargerDonneesPlanning(true);
                }
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
        label.className = 'checkbox-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'form-machine';
        input.value = avion.id;
        input.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.querySelectorAll('input[name="form-machine"]').forEach(cb => { if (cb !== e.target) cb.checked = false; });
            }
        });
        const text = document.createTextNode(avion.fields['Immatriculation'] || avion.fields['Nom'] || 'Sans nom');
        label.appendChild(input);
        label.appendChild(text);
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
            appliquerEtatFormulaire();
        });
    }
    if (machineGroup) {
        machineGroup.addEventListener('change', (e) => {
            if (e.target.name !== 'form-machine') return;
            if (e.target.checked) {
                document.querySelectorAll('input[name="form-machine"]').forEach(cb => { if (cb !== e.target) cb.checked = false; });
            }
        });
    }
    if (btnOpenModal && modal) {
        btnOpenModal.addEventListener('click', () => {
            idReservationEnEdition = null;
            if (titleModal) titleModal.textContent = "Nouvelle Réservation";
            if (btnDelete) btnDelete.style.display = 'none';
            if (groupCommentaires) groupCommentaires.style.display = 'none';
            if (formReservation) formReservation.reset();
            if (listeAvionsCache.length > 0) populerMachinesCases(listeAvionsCache);
            const annee = dateAffichee.getFullYear();
            const mois = (dateAffichee.getMonth() + 1).toString().padStart(2, '0');
            const jour = dateAffichee.getDate().toString().padStart(2, '0');
            if (document.getElementById('form-debut')) document.getElementById('form-debut').value = `${annee}-${mois}-${jour}T09:00`;
            if (document.getElementById('form-fin')) document.getElementById('form-fin').value = `${annee}-${mois}-${jour}T11:00`;
            if (document.getElementById('form-estimation')) document.getElementById('form-estimation').value = '1.0';
            appliquerEtatFormulaire();
            modal.style.display = 'flex';
        });
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
            const dateDebut = new Date(document.getElementById('form-debut').value).toISOString();
            const dateFin = new Date(document.getElementById('form-fin').value).toISOString();
            const isVIPlaneur = typesVol.includes('VI Planeur');
            const isVIMoteur = typesVol.includes('VI Moteur');
            const isVI = isVIPlaneur || isVIMoteur;
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
                        const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}`, {
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
                    const response = await fetch(url, {
                        method: methode,
                        headers: headers,
                        body: JSON.stringify({ records: [recordData] })
                    });
                    if (response.ok) {
                        modal.style.display = 'none';
                        formReservation.reset();
                        idReservationEnEdition = null;
                        chargerDonneesPlanning(true);
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
                const response = await fetch(url, {
                    method: methode,
                    headers: headers,
                    body: JSON.stringify({ records: [recordData] })
                });
                if (response.ok) {
                    modal.style.display = 'none';
                    formReservation.reset();
                    idReservationEnEdition = null;
                    chargerDonneesPlanning(true);
                    const viewAeronefs = document.getElementById('view-aeronefs');
                    if (viewAeronefs && viewAeronefs.style.display !== 'none') {
                        chargerSuiviAeronef();
                    }
                }
            } catch (error) {
                console.error(error);
            }
        });
    }
    if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
            if (!idReservationEnEdition) return;
            if (!confirm("Es-tu sûr de vouloir supprimer cette réservation ?")) return;
            try {
                const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?records[]=${idReservationEnEdition}`, {
                    method: 'DELETE',
                    headers: headers
                });
                if (response.ok) {
                    modal.style.display = 'none';
                    formReservation.reset();
                    idReservationEnEdition = null;
                    chargerDonneesPlanning(true);
                    const viewAeronefs = document.getElementById('view-aeronefs');
                    if (viewAeronefs && viewAeronefs.style.display !== 'none') {
                        chargerSuiviAeronef();
                    }
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
    modal.style.display = 'flex';
}

function ouvrirModaleEdition(vol, avionIdOuImmat) {
    if (!modal) return;
    idReservationEnEdition = vol.id;
    if (titleModal) titleModal.textContent = "Modifier la Réservation";
    if (btnDelete) btnDelete.style.display = 'block';
    if (listeAvionsCache.length > 0) {
        populerMachinesCases(listeAvionsCache);
    }
    const typeVol = vol.fields['Type de vol'] || 'Vol Classique';
    cocherTypeVol(typeVol);
    document.getElementById('form-pilote').value = vol.fields['Pilote'] || '';
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
    modal.style.display = 'flex';
}

function initBoutonsNavigation() {
    if (document.getElementById('btn-prev')) {
        document.getElementById('btn-prev').addEventListener('click', () => {
            dateAffichee.setDate(dateAffichee.getDate() - 1);
            listeReservationsCache = [];
            mettreAJourDateAffichee();
            chargerDonneesPlanning();
        });
    }
    if (document.getElementById('btn-next')) {
        document.getElementById('btn-next').addEventListener('click', () => {
            dateAffichee.setDate(dateAffichee.getDate() + 1);
            listeReservationsCache = [];
            mettreAJourDateAffichee();
            chargerDonneesPlanning();
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

function normaliserVolsInitiation() {
    const vols = [];
    listeVolsInitiationCache.forEach(record => {
        const source = record.source;
        const debut = new Date(record.debut);
        const fin = new Date(record.fin);
        const heureDebut = `${String(debut.getHours()).padStart(2, '0')}:${String(debut.getMinutes()).padStart(2, '0')}`;
        const heureFin = `${String(fin.getHours()).padStart(2, '0')}:${String(fin.getMinutes()).padStart(2, '0')}`;
        const pilote = (record.pilote || '').toString().trim();
        const isDisponible = !pilote;
        const dateStr = debut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        vols.push({
            ...record,
            heureDebut,
            heureFin,
            dateStr,
            isDisponible,
            classe: isDisponible ? 'disponible' : 'pris'
        });
    });
    return vols.sort((a, b) => new Date(a.debut) - new Date(b.debut));
}

function afficherVolsInitiation() {
    const container = document.getElementById('initiation-list');
    if (!container) return;
    const vols = normaliserVolsInitiation().filter(v => filtreInitiationActif === 'dispos' ? v.isDisponible : !v.isDisponible);
    if (vols.length === 0) {
        const message = filtreInitiationActif === 'dispos' ? 'Aucun vol d\'initiation à pourvoir.' : 'Aucun vol d\'initiation pris.';
        container.innerHTML = `<div class="initiation-empty">${message}</div>`;
        return;
    }
    container.innerHTML = '';
    vols.forEach(vol => {
        const piloteText = vol.isDisponible ? '👤 À pourvoir' : `👤 Pilote : ${formaterNomPilote(vol.pilote)}`;
        const machineText = vol.source === 'moteur' && vol.machineName ? `🛩️ ${vol.machineName}<br>` : '';
        const typeText = vol.source === 'planeur' ? 'Planeur' : 'Moteur';
        const boutonReserver = vol.isDisponible ? `<button class="btn-reserver-initiation" data-id="${vol.id}" data-source="${vol.source}">Réserver</button>` : '';
        const card = document.createElement('div');
        card.className = `initiation-card ${vol.classe}`;
        card.innerHTML = `
            <div class="initiation-info">
                <h4>🎯 Vol d'Initiation ${typeText} — ${vol.passager || 'Passager non renseigné'}</h4>
                <p>📅 ${vol.dateStr} • ${vol.heureDebut} - ${vol.heureFin}</p>
                <p>${machineText}📞 ${vol.telephone || 'Non renseigné'}</p>
                ${vol.commentaire ? `<p style="margin-top:6px; font-style:italic;">💬 ${vol.commentaire}</p>` : ''}
            </div>
            <div class="initiation-meta">
                <strong>${piloteText}</strong>
                ${boutonReserver}
            </div>
        `;
        container.appendChild(card);
    });
}

async function chargerVolsInitiation() {
    const dateEl = document.getElementById('current-date-initiation');
    if (dateEl) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = dateAffichee.toLocaleDateString('fr-FR', options);
        dateEl.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    }
    const container = document.getElementById('initiation-list');
    if (container) container.innerHTML = "<div class='loading'>Chargement des vols d'initiation...</div>";
    const debutJour = dateAffichee.toISOString().split('T')[0];
    try {
        const urlVIPlaneur = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}?filterByFormula=DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')='${debutJour}'`;
        const resVI = await fetch(urlVIPlaneur, { headers });
        const dataVI = await resVI.json();
        const urlReservations = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')='${debutJour}'`;
        const resResa = await fetch(urlReservations, { headers });
        const dataResa = await resResa.json();
        listeVolsInitiationCache = [];
        (dataVI.records || []).forEach(vol => {
            if (!vol.fields) return;
            const debutRaw = vol.fields['Date de début'];
            if (!debutRaw) return;
            const dateVol = new Date(debutRaw);
            if (dateVol.getFullYear() !== dateAffichee.getFullYear() ||
                dateVol.getMonth() !== dateAffichee.getMonth() ||
                dateVol.getDate() !== dateAffichee.getDate()) return;
            listeVolsInitiationCache.push({
                id: vol.id,
                source: 'planeur',
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
            const dateVol = new Date(debutRaw);
            if (dateVol.getFullYear() !== dateAffichee.getFullYear() ||
                dateVol.getMonth() !== dateAffichee.getMonth() ||
                dateVol.getDate() !== dateAffichee.getDate()) return;
            const machineIds = vol.fields['Machine'] || [];
            const machineName = getNomMachine(machineIds[0]);
            listeVolsInitiationCache.push({
                id: vol.id,
                source: 'moteur',
                passager: vol.fields['Passager'],
                pilote: vol.fields['Pilote'],
                telephone: vol.fields['Téléphone'],
                debut: debutRaw,
                fin: vol.fields['Date de fin'],
                commentaire: vol.fields['Commentaires VI'],
                machineName: machineName
            });
        });
        afficherVolsInitiation();
    } catch (error) {
        console.error(error);
        if (container) container.innerHTML = "<div class='initiation-empty'>Erreur lors du chargement.</div>";
    }
}

function initGestionnaireVolsInitiation() {
    const btnDispos = document.getElementById('btn-initiation-dispos');
    const btnPris = document.getElementById('btn-initiation-pris');
    const list = document.getElementById('initiation-list');

    function setFiltre(valeur) {
        filtreInitiationActif = valeur;
        if (btnDispos) btnDispos.classList.toggle('active', valeur === 'dispos');
        if (btnPris) btnPris.classList.toggle('active', valeur === 'pris');
        afficherVolsInitiation();
    }

    if (btnDispos) btnDispos.addEventListener('click', () => setFiltre('dispos'));
    if (btnPris) btnPris.addEventListener('click', () => setFiltre('pris'));

    if (list) {
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-reserver-initiation');
            if (btn) reserverVolInitiation(btn.dataset.id, btn.dataset.source);
        });
    }
}

async function reserverVolInitiation(id, source) {
    const nomPilote = prompt('Votre nom (pilote) :');
    if (!nomPilote || !nomPilote.trim()) return;
    const tableName = source === 'planeur' ? 'VI Planeur' : 'Réservations';
    try {
        const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ records: [{ id, fields: { "Pilote": nomPilote.trim() } }] })
        });
        if (response.ok) {
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