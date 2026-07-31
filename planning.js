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

function formaterDateISO(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
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

async function mettreAJourStatutCreneauxConflit(dateJour, avionId) {
    const avion = (listeAvionsCache || []).find(a => a.id === avionId);
    const immat = avion ? (avion.fields['Immatriculation'] || '').toString().trim().toUpperCase() : '';
    const typeAttendu = immat === 'F-JVIO' ? 'VIULM' : (immat === 'F-GASB' ? 'VIA' : null);
    if (!typeAttendu) return;
    try {
        const urlCreneaux = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Créneaux')}?filterByFormula=DATETIME_FORMAT({Date},'YYYY-MM-DD')='${dateJour}'&pageSize=100&sort[0][field]=Date&sort[0][direction]=asc&sort[1][field]=${encodeURIComponent('Heure début')}&sort[1][direction]=asc`;
        const resCreneaux = await fetch(urlCreneaux, { headers });
        const dataCreneaux = await resCreneaux.json();
        const urlResa = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({Date de début},'YYYY-MM-DD')<='${dateJour}', DATETIME_FORMAT({Date de fin},'YYYY-MM-DD')>='${dateJour}', FIND('${immat}', ARRAYJOIN({Machine},',')))`)}&pageSize=100`;
        const resResa = await fetch(urlResa, { headers });
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
                await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Créneaux')}`, {
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
        const dateJour = formaterDateISO(heureDebut);
        await chargerDonneesPlanning();
        await mettreAJourStatutCreneauxConflit(dateJour, avionId);
        await chargerVolsInitiation();

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
    const cache = Array.isArray(listeReservationsCache) ? listeReservationsCache : (listeReservationsCache.records || []);
    const resa = cache.find(r => r.id === idReservationEnEdition);
    const resaMachine = (resa && resa.fields && resa.fields['Machine'] || [])[0];
    const resaDate = resa && resa.fields && resa.fields['Date de début'] ? formaterDateISO(new Date(resa.fields['Date de début'])) : null;
    if (!confirm("Es-tu sûr de vouloir supprimer cette réservation ?")) return;

    try {
        const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?records[]=${idReservationEnEdition}`, {
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
                const type = (vol.fields['Type'] || 'VI');
                const isCreneau = vol._table === 'VI Créneaux';
                const classePilote = pilote ? 'vi-avec-pilote' : 'vi-sans-pilote';
                barresDiv.className = `reservation-bar ${classePilote}`;
                barresDiv.style.left = `${(heureDebut / 24) * 100}%`;
                barresDiv.style.width = `${(duree / 24) * 100}%`;
                const libelle = pilote ? `🎯 ${type} (${formaterNomPilote(pilote)})` : `🎯 ${type} DISPONIBLE`;
                barresDiv.innerHTML = `<strong>${libelle}</strong>`;
                barresDiv.title = vol.fields['Commentaire'] || '';
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
                    barresDiv.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (isResizing || isDraggingBar) return;
                        ouvrirModaleEditionVIPlaneur(vol);
                    });
                }
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
        const trouverAvionParImmat = (immat) => (listeAvionsCache || []).find(a => (a.fields['Immatriculation'] || a.fields['Nom'] || '').toString().trim().toUpperCase() === immat.toUpperCase());
        const avionJVIO = trouverAvionParImmat('F-JVIO');
        const avionGASB = trouverAvionParImmat('F-GASB');
        const avionIdJVIO = avionJVIO ? avionJVIO.id : null;
        const avionIdGASB = avionGASB ? avionGASB.id : null;
        let creneauxVIMotor = [];
        if (forceRefresh || listeReservationsCache.length === 0) {
            const urlReservations = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')<='${debutJour}', DATETIME_FORMAT({Date de fin}, 'YYYY-MM-DD')>='${debutJour}')`)}`;
            const resReservations = await fetch(urlReservations, { headers });
            const dataReservations = await resReservations.json();
            if (dataReservations.records) listeReservationsCache = dataReservations.records;
        }
        const urlVIPlaneur = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}?filterByFormula=DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')='${debutJour}'`;
        const resVIPlaneur = await fetch(urlVIPlaneur, { headers });
        const dataVIPlaneur = await resVIPlaneur.json();
        let volsVIP = (dataVIPlaneur.records || []).filter(vol => {
            if (!vol.fields) return false;
            const debutRaw = vol.fields['Date de début'];
            if (!debutRaw) return false;
            const dateVol = new Date(debutRaw);
            return dateVol.getFullYear() === dateAffichee.getFullYear() &&
                   dateVol.getMonth() === dateAffichee.getMonth() &&
                   dateVol.getDate() === dateAffichee.getDate();
        });
        const urlVICreneaux = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Créneaux')}?filterByFormula=DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${debutJour}'`;
        const resVICreneaux = await fetch(urlVICreneaux, { headers });
        const dataVICreneaux = await resVICreneaux.json();
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
                        const passagerNom = (vol.fields['Passager'] || '').toString().trim();
                        const typesVol = Array.isArray(typeVol) ? typeVol : [typeVol];
                        const isVIMoteur = typesVol.includes('VI Moteur');
                        const isAncienVI = typesVol.includes("Vol d'Initiation") || typesVol.includes("Vol d'Initiation (VI)");
                        const isCreneau = vol._table === 'VI Créneaux';
                        let libelleEntete = piloteFormate || 'Pilote non défini';
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
            if (!idVIModale || tableVIModale !== 'VI Planeur') return;
            if (!confirm("Es-tu sûr de vouloir supprimer ce VI Planeur ?")) return;
            try {
                const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Planeur')}?records[]=${idVIModale}`, {
                    method: 'DELETE',
                    headers: headers
                });
                if (response.ok) {
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
                        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
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
                        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({ fields: newRecord.fields })
                        });
                        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
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
                    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
                        method: methode,
                        headers: headers,
                        body: JSON.stringify({ records: [recordData] })
                    });
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
            const affichage = document.getElementById('affichage-pilote');
            const pilote = nomPiloteCourant();
            if (document.getElementById('form-pilote')) document.getElementById('form-pilote').value = pilote;
            if (affichage) affichage.textContent = pilote;
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
                const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?records[]=${idReservationEnEdition}`, {
                    method: 'DELETE',
                    headers: headers
                });
                if (response.ok) {
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
    const affichage = document.getElementById('affichage-pilote');
    const pilote = nomPiloteCourant();
    if (document.getElementById('form-pilote')) document.getElementById('form-pilote').value = pilote;
    if (affichage) affichage.textContent = pilote;
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
    const affichage = document.getElementById('affichage-pilote');
    const pilote = vol.fields['Pilote'] || nomPiloteCourant();
    document.getElementById('form-pilote').value = pilote;
    if (affichage) affichage.textContent = pilote;
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
    const affichage = document.getElementById('affichage-pilote');
    const pilote = nomPiloteCourant();
    if (document.getElementById('form-pilote')) document.getElementById('form-pilote').value = pilote;
    if (affichage) affichage.textContent = pilote;
    modal.style.display = 'flex';
}

function initBoutonsNavigation() {
    if (document.getElementById('btn-prev')) {
        document.getElementById('btn-prev').addEventListener('click', () => {
            dateAffichee.setDate(dateAffichee.getDate() - 1);
            listeReservationsCache = [];
            mettreAJourDateAffichee();
            chargerDonneesPlanning();
            if (typeof rafraichirMiniCalendrier === 'function') rafraichirMiniCalendrier();
        });
    }
    if (document.getElementById('btn-next')) {
        document.getElementById('btn-next').addEventListener('click', () => {
            dateAffichee.setDate(dateAffichee.getDate() + 1);
            listeReservationsCache = [];
            mettreAJourDateAffichee();
            chargerDonneesPlanning();
            if (typeof rafraichirMiniCalendrier === 'function') rafraichirMiniCalendrier();
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
    const vols = normaliserVolsInitiation().filter(v => v.categorie === filtreInitiationActif && filtreTypesInitiation.includes(v.type));
    if (vols.length === 0) {
        const messages = {
            apourvoir: 'Aucun vol d\'initiation à pourvoir.',
            pris: 'Aucun vol d\'initiation déjà pris.',
            creneaux: 'Aucun créneau disponible.'
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
        const peutSInscrire = isAPourvoir && (vol.source === 'creneau' ? hasRolePiloteVI() : !!nomPiloteCourant());
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
        const resVI = await fetch(urlVIPlaneur, { headers });
        const dataVI = await resVI.json();
        const typeFormula = `OR(FIND('VI Moteur', {Type de vol}), FIND("Vol d'Initiation", {Type de vol}), FIND("Vol d'Initiation (VI)", {Type de vol}))`;
        const urlReservations = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(typeFormula)}&pageSize=100&sort[0][field]=${encodeURIComponent('Date de début')}&sort[0][direction]=asc`;
        const resResa = await fetch(urlReservations, { headers });
        const dataResa = await resResa.json();
        const urlCreneaux = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Créneaux')}?pageSize=100&sort[0][field]=Date&sort[0][direction]=asc&sort[1][field]=${encodeURIComponent('Heure début')}&sort[1][direction]=asc`;
        const resCreneaux = await fetch(urlCreneaux, { headers });
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
                const resConflit = await fetch(urlConflit, { headers });
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
    const list = document.getElementById('initiation-list');
    if (btnCreneaux && hasRoleGestionVI()) btnCreneaux.style.display = 'inline-block';

    function setFiltre(valeur) {
        filtreInitiationActif = valeur;
        document.querySelectorAll('.initiation-tab').forEach(b => b.classList.remove('active'));
        const map = { apourvoir: 'btn-initiation-dispos', pris: 'btn-initiation-pris', creneaux: 'btn-initiation-creneaux' };
        const activeBtn = document.getElementById(map[valeur] || '');
        if (activeBtn) activeBtn.classList.add('active');
        afficherVolsInitiation();
    }

    if (btnDispos) btnDispos.addEventListener('click', () => setFiltre('apourvoir'));
    if (btnPris) btnPris.addEventListener('click', () => setFiltre('pris'));
    if (btnCreneaux) btnCreneaux.addEventListener('click', () => setFiltre('creneaux'));

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
            const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('VI Créneaux')}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ records: batch })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        }
        alert(`${records.length} créneau(x) créé(s).`);
        document.getElementById('form-creneaux-vi').reset();
        if (typeof chargerVolsInitiation === 'function') chargerVolsInitiation();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la création : ' + err.message);
    }
}