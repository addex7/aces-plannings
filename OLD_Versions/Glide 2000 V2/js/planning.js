// js/planning.js
async function initPlanningView() {
    const planningContainer = document.getElementById('planning-view-content');
    if (!planningContainer) return;

    planningContainer.innerHTML = `<p style="padding: 20px; font-style: italic;">Chargement du planning...</p>`;

    const [avions, reservations, presences] = await Promise.all([
        fetchAirtableData('Aéronefs'),
        fetchAirtableData('Réservations'),
        fetchAirtableData('Présences Planeur')
    ]);

    listeAvionsCache = avions;
    reservationsCache = reservations;
    window.presencesCache = presences; 

    let html = `
        <div class="view-header">
            <h1>Planning des Vols</h1>
            <div class="date-navigator">
                <button onclick="changerDate(-1)">◄</button>
                <input type="date" id="date-picker-input" value="${dateAffichee}" onchange="selectionnerDateDirecte(this.value)" style="border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; font-weight: bold; font-family: inherit; font-size: 0.9rem; cursor: pointer; padding: 4px 8px; color: #1e293b;">
                <button onclick="changerDate(1)">►</button>
            </div>
            <button class="btn-primary" onclick="ouvrirModalReservation()">+ Nouvelle Réservation</button>
        </div>

        <div class="planning-card">
            <div class="timeline-header">
                <div class="plane-col-header">Aéronef</div>
    `;

    for (let h = 0; h < 24; h++) {
        let heureStr = h < 10 ? `0${h}:00` : `${h}:00`;
        html += `<div class="hour-col">${heureStr}</div>`;
    }
    html += `</div>`;

    if (!avions || avions.length === 0) {
        html += `<div style="padding: 20px; text-align: center; color: #64748b;">Aucun aéronef trouvé dans Airtable.</div>`;
    } else {
        avions.forEach(avion => {
            let f = avion.fields;
            let immat = f.Immatriculation || 'AVION';
            let statut = f.Statut || 'Disponible';
            let dotClass = statut.includes('Disponible') ? 'dot-green' : 'dot-red';

            // Motif hachuré style ancienne interface pour les heures de nuit (00h-06h et 22h-24h)
            let backgroundTracksHtml = '';
            for (let h = 0; h < 24; h++) {
                let leftPercent = (h / 24) * 100;
                let widthPercent = (1 / 24) * 100;
                
                let backgroundStyle = '';
                if (h < 6 || h >= 22) {
                    backgroundStyle = 'background: repeating-linear-gradient(45deg, #e2e8f0, #e2e8f0 6px, #cbd5e1 6px, #cbd5e1 12px); opacity: 0.7;';
                }

                let styleHtml = `position: absolute; left: ${leftPercent}%; width: ${widthPercent}%; top: 0; bottom: 0; z-index: 1; pointer-events: none; ${backgroundStyle}`;
                backgroundTracksHtml += `<div style="${styleHtml}"></div>`;
            }

            let slotsHtml = '';
            if (reservations && reservations.length > 0) {
                reservations.forEach(res => {
                    let rf = res.fields;
                    let avionRes = rf.Machine || rf.Aéronef || '';
                    let dateDebutStr = rf['Date de début'] || '';
                    let dateFinStr = rf['Date de fin'] || '';

                    let correspondAvion = false;
                    if (Array.isArray(avionRes)) {
                        correspondAvion = avionRes.includes(avion.id) || avionRes.includes(immat);
                    } else {
                        correspondAvion = avionRes.includes(immat);
                    }

                    if (correspondAvion && dateDebutStr.startsWith(dateAffichee)) {
                        let timePartDeb = dateDebutStr.split('T')[1] || '00:00';
                        let partsDeb = timePartDeb.split(':');
                        let hDeb = parseInt(partsDeb[0], 10) || 0;
                        let mDeb = parseInt(partsDeb[1], 10) || 0;

                        let hFin = hDeb + 1;
                        let mFin = mDeb;
                        if (dateFinStr) {
                            let timePartFin = dateFinStr.split('T')[1] || '00:00';
                            let partsFin = timePartFin.split(':');
                            hFin = parseInt(partsFin[0], 10) || 0;
                            mFin = parseInt(partsFin[1], 10) || 0;
                        }

                        let heureDebutDecimal = hDeb + mDeb / 60;
                        let heureFinDecimal = hFin + mFin / 60;
                        if (heureFinDecimal <= heureDebutDecimal) heureFinDecimal = 24;

                        let leftPercent = (heureDebutDecimal / 24) * 100;
                        let widthPercent = Math.max(((heureFinDecimal - heureDebutDecimal) / 24) * 100, 2);

                        let pilote = rf['Pilote'] || rf['Nom du pilote'] || rf['Client'] || 'Réservé';
                        let recordId = res.id;

                        slotsHtml += `
                            <div class="reservation-pill" onclick="ouvrirModalEditionReservation('${recordId}')" style="position: absolute; left: ${leftPercent}%; width: ${widthPercent}%; top: 6px; bottom: 6px; background: #f97316 !important; color: #ffffff !important; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 500; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; display: flex; align-items: center; border: none; border-left: 4px solid #1e3a8a !important; z-index: 2; cursor: pointer;" title="Modifier : ${pilote}">
                                ${pilote}
                            </div>
                        `;
                    }
                });
            }

            html += `
                <div class="planning-row-item" style="display: grid; grid-template-columns: 140px repeat(24, 1fr); align-items: center; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                    <div class="plane-info"><span class="${dotClass}"></span> ${immat}</div>
                    <div class="slots-grid-track" style="position: relative; grid-column: span 24; height: 38px; background: repeating-linear-gradient(90deg, transparent, transparent calc(100% / 24), #f1f5f9 calc(100% / 24), #f1f5f9 calc(100% / 24) + 1px);">
                        ${backgroundTracksHtml}
                        ${slotsHtml}
                    </div>
                </div>
            `;
        });
    }

    html += `</div>`;

    // Présences Planeur (avec le design d'origine à boutons de lien en bas)
    let instructeursHtml = '';
    let elevesHtml = '';
    let pilotesHtml = '';

    if (presences && presences.length > 0) {
        presences.forEach(p => {
            let f = p.fields;
            let nom = f['Nom du pilote'] || 'Anonyme';
            let role = f['Rôle'] || '';
            let dateP = f['Date'] || '';
            let recordId = p.id;

            if (dateP === dateAffichee) {
                let item = `
                    <div class="presence-item" style="margin-bottom: 8px; font-size: 0.9rem; display: flex; justify-content: space-between; align-items: flex-start; background: #fff; padding: 6px 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <div>
                            <div><strong>• ${nom}</strong></div>
                        </div>
                        <button onclick="supprimerPresence('${recordId}')" title="Supprimer" style="background: none; border: none; color: #ef4444; font-weight: bold; font-size: 1rem; cursor: pointer; padding: 0 4px; line-height: 1;">&times;</button>
                    </div>
                `;
                if (role === 'Instructeur') instructeursHtml += item;
                else if (role === 'Élève') elevesHtml += item;
                else pilotesHtml += item;
            }
        });
    }

    function genererBoitePresence(titre, roleCible, contenuItems) {
        return `
            <div class="presence-box" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 1rem; color: #1e293b; border-bottom: 2px solid #cbd5e1; padding-bottom: 6px; text-align: center;">${titre}</h3>
                    <div style="margin-bottom: 16px; min-height: 50px;">
                        ${contenuItems || '<p class="empty-presence" style="color: #94a3b8; font-style: italic; font-size: 0.85rem; text-align: center;">Aucun inscrit</p>'}
                    </div>
                </div>
                <div style="text-align: center;">
                    <a href="#" onclick="event.preventDefault(); ouvrirModalPresence('${roleCible}')" style="color: #0284c7; font-size: 0.85rem; font-weight: 500; text-decoration: underline;">+ S'inscrire comme ${titre.slice(0, -1)}</a>
                </div>
            </div>
        `;
    }

    html += `
        <div class="presences-card" style="margin-top: 24px; background: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <h2 style="margin-top: 0; margin-bottom: 16px; font-size: 1.25rem; color: #0f172a;">Présences Planeur</h2>
            <div class="presences-container" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
                ${genererBoitePresence('Instructeurs', 'Instructeur', instructeursHtml)}
                ${genererBoitePresence('Élèves', 'Élève', elevesHtml)}
                ${genererBoitePresence('Pilotes', 'Pilote', pilotesHtml)}
            </div>
        </div>

        <!-- MODALE D'INSCRIPTION PRÉSENCE -->
        <div id="modal-presence" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center;">
            <div style="background: white; padding: 24px; border-radius: 8px; width: 350px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h3 id="modal-presence-title" style="margin-top: 0; margin-bottom: 16px; color: #1e293b;">Inscription Présence</h3>
                
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 4px; color: #475569;">Rôle</label>
                <select id="presence-role-select" style="width: 100%; padding: 8px; margin-bottom: 12px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9rem;">
                    <option value="Instructeur">Instructeur</option>
                    <option value="Élève">Élève</option>
                    <option value="Pilote">Pilote</option>
                </select>

                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 4px; color: #475569;">Nom du pilote</label>
                <input type="text" id="presence-nom-input" placeholder="Ex: Jean Dupont" style="width: 100%; padding: 8px; margin-bottom: 20px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">

                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button onclick="fermerModalPresence()" style="background: #e2e8f0; color: #1e293b; border: none; padding: 8px 12px; border-radius: 4px; font-size: 0.85rem; cursor: pointer;">Annuler</button>
                    <button onclick="validerInscriptionPresence()" style="background: #0284c7; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 0.85rem; font-weight: 500; cursor: pointer;">S'inscrire</button>
                </div>
            </div>
        </div>

        <!-- MODALE MODIFICATION / SUPPRESSION RÉSERVATION -->
        <div id="modal-edit-reservation" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center;">
            <div style="background: white; padding: 24px; border-radius: 8px; width: 380px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h3 style="margin-top: 0; margin-bottom: 16px; color: #1e293b;">Modifier la Réservation</h3>
                <input type="hidden" id="edit-res-id">

                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 4px; color: #475569;">Nom du pilote / Client</label>
                <input type="text" id="edit-res-pilote" style="width: 100%; padding: 8px; margin-bottom: 12px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">

                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 4px; color: #475569;">Début</label>
                <input type="datetime-local" id="edit-res-debut" style="width: 100%; padding: 8px; margin-bottom: 12px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">

                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 4px; color: #475569;">Fin</label>
                <input type="datetime-local" id="edit-res-fin" style="width: 100%; padding: 8px; margin-bottom: 20px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">

                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <button onclick="supprimerReservationActuelle()" style="background: #fee2e2; color: #dc2626; border: none; padding: 8px 12px; border-radius: 4px; font-size: 0.85rem; font-weight: 500; cursor: pointer;">Supprimer</button>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="fermerModalEditReservation()" style="background: #e2e8f0; color: #1e293b; border: none; padding: 8px 12px; border-radius: 4px; font-size: 0.85rem; cursor: pointer;">Annuler</button>
                        <button onclick="validerModificationReservation()" style="background: #0284c7; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 0.85rem; font-weight: 500; cursor: pointer;">Enregistrer</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    planningContainer.innerHTML = html;
}

function changerDate(delta) {
    let d = new Date(dateAffichee);
    d.setDate(d.getDate() + delta);
    dateAffichee = d.toISOString().split('T')[0];
    initPlanningView();
}

function selectionnerDateDirecte(nouvelleDate) {
    if (nouvelleDate) {
        dateAffichee = nouvelleDate;
        initPlanningView();
    }
}

function ouvrirModalPresence(roleParDefaut) {
    let modal = document.getElementById('modal-presence');
    let selectRole = document.getElementById('presence-role-select');
    let inputNom = document.getElementById('presence-nom-input');

    if (modal && selectRole) {
        selectRole.value = roleParDefaut;
        if (inputNom) inputNom.value = '';
        modal.style.display = 'flex';
    }
}

function fermerModalPresence() {
    let modal = document.getElementById('modal-presence');
    if (modal) modal.style.display = 'none';
}

async function validerInscriptionPresence() {
    let role = document.getElementById('presence-role-select').value;
    let nom = document.getElementById('presence-nom-input').value.trim();

    if (!nom) {
        alert("Veuillez entrer un nom.");
        return;
    }

    try {
        await createAirtableRecord('Présences Planeur', {
            'Nom du pilote': nom,
            'Rôle': role,
            'Date': dateAffichee
        });

        fermerModalPresence();
        initPlanningView();
    } catch (error) {
        console.error("Erreur détaillée :", error);
        alert("Erreur Airtable : " + (error.message || error));
    }
}

async function supprimerPresence(idRecord) {
    if (confirm("Voulez-vous vraiment supprimer cette inscription ?")) {
        try {
            await deleteAirtableRecord('Présences Planeur', idRecord);
            initPlanningView();
        } catch (error) {
            console.error("Erreur lors de la suppression :", error);
            alert("Erreur lors de la suppression : " + error.message);
        }
    }
}

function ouvrirModalEditionReservation(recordId) {
    const reservation = reservationsCache.find(r => r.id === recordId);
    if (!reservation) return;

    let f = reservation.fields;
    document.getElementById('edit-res-id').value = recordId;
    document.getElementById('edit-res-pilote').value = f['Pilote'] || f['Nom du pilote'] || f['Client'] || '';
    
    if (f['Date de début']) {
        document.getElementById('edit-res-debut').value = f['Date de début'].slice(0, 16);
    }
    if (f['Date de fin']) {
        document.getElementById('edit-res-fin').value = f['Date de fin'].slice(0, 16);
    }

    document.getElementById('modal-edit-reservation').style.display = 'flex';
}

function fermerModalEditReservation() {
    document.getElementById('modal-edit-reservation').style.display = 'none';
}

async function validerModificationReservation() {
    let recordId = document.getElementById('edit-res-id').value;
    let pilote = document.getElementById('edit-res-pilote').value.trim();
    let debut = document.getElementById('edit-res-debut').value;
    let fin = document.getElementById('edit-res-fin').value;

    if (!pilote) {
        alert("Le nom du pilote ne peut pas être vide.");
        return;
    }

    try {
        await updateAirtableRecord('Réservations', recordId, {
            'Pilote': pilote,
            'Date de début': debut ? new Date(debut).toISOString() : undefined,
            'Date de fin': fin ? new Date(fin).toISOString() : undefined
        });

        fermerModalEditReservation();
        initPlanningView();
    } catch (error) {
        console.error("Erreur modification réservation :", error);
        alert("Erreur lors de la modification : " + error.message);
    }
}

async function supprimerReservationActuelle() {
    let recordId = document.getElementById('edit-res-id').value;
    if (confirm("Voulez-vous vraiment supprimer cette réservation ?")) {
        try {
            await deleteAirtableRecord('Réservations', recordId);
            fermerModalEditReservation();
            initPlanningView();
        } catch (error) {
            console.error("Erreur suppression réservation :", error);
            alert("Erreur lors de la suppression : " + error.message);
        }
    }
}