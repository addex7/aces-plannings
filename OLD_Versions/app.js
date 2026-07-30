/* ==========================================================================
   APP.JS - Interface Utilisateur & Interactions
   ========================================================================== */

import { LFOY_LAT, LFOY_LON } from './config.js';
import * as API from './api.js';

let dateAffichee = new Date('2026-07-14T12:00:00');
let listeAvionsCache = []; 
let idReservationEnEdition = null; 
let isResizing = false; 
let isDraggingBar = false;

// --- FORMATAGE DU NOM DU PILOTE ---
function formaterNomPilote(nomComplet) {
    if (!nomComplet) return '';
    const chaine = nomComplet.trim();
    if (!chaine) return '';

    if (chaine.startsWith('🎯') || chaine.startsWith('VI')) {
        return chaine;
    }

    const parties = chaine.split(/\s+/);
    if (parties.length === 1) return parties[0];

    let prenom = '';
    let nom = '';

    if (parties[0] === parties[0].toUpperCase() && parties[0].length > 1) {
        nom = parties[0];
        prenom = parties.slice(1).join(' ');
    } else {
        prenom = parties[0];
        nom = parties.slice(1).join(' ');
    }

    return `${prenom} ${nom.charAt(0).toUpperCase()}.`;
}

// --- CALCUL ASTRONOMIQUE DES HEURES SOLAIRES (LFOY) ---
function calculerSoleilLFOY(date) {
    const lat = LFOY_LAT;
    const lon = LFOY_LON;
    
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);
    const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
    
    const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
    let cosHA = Math.cos(90.833 * Math.PI / 180) / (Math.cos(lat * Math.PI / 180) * Math.cos(decl)) - Math.tan(lat * Math.PI / 180) * Math.tan(decl);
    cosHA = Math.min(1, Math.max(-1, cosHA));
    
    const ha = Math.acos(cosHA);
    const haDeg = ha * 180 / Math.PI;
    const offsetHeures = -date.getTimezoneOffset() / 60;
    const sunriseUTC = 720 - 4 * (lon + haDeg) - eqtime;
    const sunsetUTC = 720 - 4 * (lon - haDeg) - eqtime;
    const srDecimal = (sunriseUTC / 60) + offsetHeures; 
    const ssDecimal = (sunsetUTC / 60) + offsetHeures;  
    return {
        aubeAero: srDecimal - 0.5,       
        leverSoleil: srDecimal,          
        coucherSoleil: ssDecimal,        
        crepusculeAero: ssDecimal + 0.5  
    };
}

function genererFondNuitHTML(dateCible) {
    const soleil = calculerSoleilLFOY(dateCible);
    const pctFinNuitMatin = (Math.max(0, soleil.leverSoleil) / 24) * 100;
    const pctFinNuitAeroMatin = (Math.max(0, soleil.aubeAero) / 24) * 100;
    const pctDebutNuitAeroSoir = (Math.min(24, soleil.crepusculeAero) / 24) * 100;
    const pctDebutNuitSoir = (Math.min(24, soleil.coucherSoleil) / 24) * 100;

    return `
        <div class="night-overlay-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;">
            <div style="position: absolute; left: 0%; width: ${pctFinNuitAeroMatin}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.12), rgba(30, 61, 89, 0.12) 6px, rgba(240, 244, 248, 0.4) 6px, rgba(240, 244, 248, 0.4) 12px);">
            </div>
            <div style="position: absolute; left: ${pctFinNuitAeroMatin}%; width: ${pctFinNuitMatin - pctFinNuitAeroMatin}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.22), rgba(30, 61, 89, 0.22) 6px, rgba(186, 215, 233, 0.45) 6px, rgba(186, 215, 233, 0.45) 12px); 
                        border-right: 1px dashed #1e3d59;">
            </div>
            <div style="position: absolute; left: ${pctDebutNuitSoir}%; width: ${pctDebutNuitAeroSoir - pctDebutNuitSoir}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.22), rgba(30, 61, 89, 0.22) 6px, rgba(186, 215, 233, 0.45) 6px, rgba(186, 215, 233, 0.45) 12px); 
                        border-left: 1px dashed #1e3d59;">
            </div>
            <div style="position: absolute; left: ${pctDebutNuitAeroSoir}%; width: ${100 - pctDebutNuitAeroSoir}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.12), rgba(30, 61, 89, 0.12) 6px, rgba(240, 244, 248, 0.4) 6px, rgba(240, 244, 248, 0.4) 12px);">
            </div>
        </div>
    `;
}

function genererFriseHeures() {
    ['timeline-hours', 'timeline-hours-suivi'].forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        container.innerHTML = ""; 
        for (let h = 0; h < 24; h++) {
            const div = document.createElement('div');
            div.className = 'hour-cell-header';
            div.innerHTML = `<span>${h.toString().padStart(2, '0')}:00</span>`;
            container.appendChild(div);
        }
    });
}

function mettreAJourDateAffichee() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = dateAffichee.toLocaleDateString('fr-FR', options);
    const chaineFormatted = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

    ['current-date', 'current-date-suivi'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = chaineFormatted;
    });
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

function formaterPourInput(dateObjet) {
    const tzoffset = dateObjet.getTimezoneOffset() * 60000;
    return (new Date(dateObjet - tzoffset)).toISOString().slice(0, 16);
}

function minutesToTimeString(totalMinutes) {
    let hrs = Math.floor(totalMinutes / 60) % 24;
    let mins = Math.round(totalMinutes % 60);
    if (mins === 60) { hrs = (hrs + 1) % 24; mins = 0; }
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

async function chargerDonneesPlanning() {
    const rowsContainer = document.getElementById('timeline-rows');
    if (!rowsContainer) return;
    rowsContainer.innerHTML = "<div class='loading'>Mise à jour du planning...</div>";
    
    try {
        const [recordsAvions, recordsReservations] = await Promise.all([
            API.fetchAeronefs(),
            API.fetchReservations()
        ]);

        rowsContainer.innerHTML = ""; 
        if (recordsAvions.length === 0) {
            rowsContainer.innerHTML = "<div class='loading'>Aucune donnée trouvée.</div>";
            return;
        }

        listeAvionsCache = recordsAvions;
        populerSelectAvions(listeAvionsCache);
        
        const soleil = calculerSoleilLFOY(dateAffichee);

        recordsAvions.forEach(avion => {
            if (!avion.fields) return; 
            const avionId = avion.id;
            const avionNom = avion.fields['Immatriculation'] || avion.fields['Nom'] || 'Sans nom';
            const rowDiv = document.createElement('div');
            rowDiv.className = 'timeline-row';

            const volsAvion = recordsReservations.filter(res => {
                if (!res.fields) return false; 
                const linkAvion = res.fields['Machine'] || [];
                const debutRaw = res.fields['Date de début'];
                if (!linkAvion.includes(avionId) || !debutRaw) return false;
                const dateVol = new Date(debutRaw);
                return dateVol.getFullYear() === dateAffichee.getFullYear() &&
                       dateVol.getMonth() === dateAffichee.getMonth() &&
                       dateVol.getDate() === dateAffichee.getDate();
            });

            let potentielInitial = avion.fields['Potentiel restant'] !== undefined ? parseFloat(avion.fields['Potentiel restant']) : 0;
            const totalHeuresEstimees = recordsReservations
                .filter(res => res.fields && res.fields['Machine'] && res.fields['Machine'].includes(avionId))
                .reduce((somme, res) => somme + (parseFloat(res.fields['Temps estimé']) || 0), 0);
            const potentielPredictif = potentielInitial - totalHeuresEstimees;
            
            let couleurStatus = "status-green";
            let textPotentiel = `Potentiel bon (${potentielPredictif.toFixed(1)}h restantes)`;
            
            if (potentielPredictif <= 5) {
                couleurStatus = "status-red";
                textPotentiel = `ARRÊT IMMINENT (${potentielPredictif.toFixed(1)}h restantes)`;
            } else if (potentielPredictif <= 15) {
                couleurStatus = "status-orange";
                textPotentiel = `Révision à prévoir (${potentielPredictif.toFixed(1)}h restantes)`;
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

            const zonesNuit = [
                { left: 0, width: aubeAeroPercent, class: 'night-aero' },
                { left: aubeAeroPercent, width: leverPercent - aubeAeroPercent, class: 'night-civil' },
                { left: coucherPercent, width: crepusculeAeroPercent - coucherPercent, class: 'night-civil' },
                { left: crepusculeAeroPercent, width: 100 - crepusculeAeroPercent, class: 'night-aero' }
            ];

            zonesNuit.forEach(z => {
                const div = document.createElement('div');
                div.className = `night-zone ${z.class}`;
                div.style.left = `${z.left}%`;
                div.style.width = `${z.width}%`;
                gridBg.appendChild(div);
            });

            for (let h = 0; h < 24; h++) {
                const gridBlock = document.createElement('div');
                gridBlock.className = 'grid-hour-block';
                gridBlock.addEventListener('click', (e) => {
                    if (isResizing || isDraggingBar) return;
                    ouvrirModaleCreationDepuisGrille(avionId, h);
                });
                gridBg.appendChild(gridBlock);
            }
            rowDiv.appendChild(gridBg);

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
                    let heureDebut = dateDebut.getHours() + (dateDebut.getMinutes() / 60);
                    let heureFin = dateFin.getHours() + (dateFin.getMinutes() / 60);
                    let duree = heureFin - heureDebut;
                    
                    if (duree > 0) {
                        const barresDiv = document.createElement('div');
                        barresDiv.className = 'reservation-bar';
                        barresDiv.style.left = `${(heureDebut / 24) * 100}%`; 
                        barresDiv.style.width = `${(duree / 24) * 100}%`;
                        
                        // Fix d'alignement avec border-box
                        barresDiv.style.boxSizing = 'border-box';
                        barresDiv.style.borderLeft = '5px solid #1e3d59';
                        barresDiv.style.borderTopLeftRadius = '4px';
                        barresDiv.style.borderBottomLeftRadius = '4px';

                        if (duree <= 2) barresDiv.classList.add('short-reservation');
                        
                        let libelleEntete = piloteFormate || 'Pilote non défini';
                        if (typeVol === "Vol d'Initiation" || typeVol === "Vol d'Initiation (VI)") {
                            if (!piloteNom || piloteNom.trim() === "") {
                                barresDiv.classList.add('vi-sans-pilote');
                                libelleEntete = "🎯 VI DISPONIBLE";
                            } else {
                                barresDiv.classList.add('vi-avec-pilote');
                                libelleEntete = `🎯 VI (${piloteFormate})`;
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
                            initierResize(e, vol.id, gridBg, barresDiv, 'gauche', heureDebut, heureFin);
                        });
                        handleRight.addEventListener('mousedown', (e) => {
                            e.stopPropagation();
                            initierResize(e, vol.id, gridBg, barresDiv, 'droite', heureDebut, heureFin);
                        });
                        barresDiv.addEventListener('mousedown', (e) => {
                            if (e.target.classList.contains('resize-handle')) return;
                            e.stopPropagation();
                            initierDeplacementBarre(e, vol.id, avionId, gridBg, barresDiv, heureDebut, duree);
                        });
                        barresDiv.addEventListener('click', (e) => {
                            e.stopPropagation(); 
                            if (isResizing || isDraggingBar) return;
                            ouvrirModaleEdition(vol, avionId);
                        });
                        gridBg.appendChild(barresDiv);
                    }
                }
            });
            rowsContainer.appendChild(rowDiv);
        });
        await chargerPresencesPlaneur();
    } catch (error) {
        console.error(error);
        rowsContainer.innerHTML = "<div class='loading'>Erreur de chargement des données.</div>";
    }
}

function initierDeplacementBarre(e, reservationId, avionId, parentGrid, barElement, hDebutInitiale, duree) {
    e.preventDefault();
    isDraggingBar = false;
    const rectGrid = parentGrid.getBoundingClientRect();
    const rectBar = barElement.getBoundingClientRect();
    const dragOffsetX = e.clientX - rectBar.left;
    let ghostBar = null;
    let nvlHeureDebut = hDebutInitiale;
    const dureeMinutes = duree * 60;

    function onMouseMove(moveEvent) {
        if (!isDraggingBar) {
            isDraggingBar = true;
            barElement.style.opacity = '0.3';
            ghostBar = document.createElement('div');
            ghostBar.className = 'ghost-bar-preview';
            ghostBar.style.width = `${(duree / 24) * 100}%`;
            ghostBar.innerHTML = `<span style="font-size:11px; font-weight:bold; color:#1e3d59; display:block; text-align:center; margin-top:15px;"></span>`;
            parentGrid.appendChild(ghostBar);
        }
        let currentLeftPx = moveEvent.clientX - rectGrid.left - dragOffsetX;
        const maxLeftPx = rectGrid.width - rectBar.width;
        currentLeftPx = Math.max(0, Math.min(maxLeftPx, currentLeftPx));
        let totalMinutes = (currentLeftPx / rectGrid.width) * 1440;
        
        totalMinutes = Math.round(totalMinutes / 15) * 15;
        nvlHeureDebut = totalMinutes / 60;
        ghostBar.style.left = `${(nvlHeureDebut / 24) * 100}%`;
        ghostBar.querySelector('span').textContent = `${minutesToTimeString(totalMinutes)} - ${minutesToTimeString(totalMinutes + dureeMinutes)}`;
    }

    async function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        barElement.style.opacity = '1';
        if (ghostBar && ghostBar.parentNode) ghostBar.parentNode.removeChild(ghostBar);
        if (isDraggingBar && nvlHeureDebut !== hDebutInitiale) {
            await deplacerReservationViaDragAndDrop(reservationId, avionId, nvlHeureDebut, duree);
        }
        setTimeout(() => { isDraggingBar = false; }, 100);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function initierResize(e, reservationId, parentGrid, barElement, bord, hDebutInitiale, hFinInitiale) {
    e.preventDefault();
    isResizing = true;
    barElement.style.opacity = '0.3';
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
        let pourcentage = Math.max(0, Math.min(1, (moveEvent.clientX - rectGrid.left) / rectGrid.width));
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
        ghostBar.querySelector('span').textContent = `${minutesToTimeString(hDebFinale * 60)} - ${minutesToTimeString(hFinFinale * 60)}`;
    }

    async function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        barElement.style.opacity = '1';
        if (ghostBar.parentNode) ghostBar.parentNode.removeChild(ghostBar);
        if (hDebFinale !== hDebutInitiale || hFinFinale !== hFinInitiale) {
            await appliquerChangementDuree(reservationId, hDebFinale, hFinFinale);
        }
        setTimeout(() => { isResizing = false; }, 100);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

async function appliquerChangementDuree(reservationId, hDeb, hFin) {
    const d = dateAffichee;
    const dateDebut = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(hDeb), (hDeb % 1) * 60, 0);
    const dateFin = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(hFin), (hFin % 1) * 60, 0);
    
    const response = await API.updateReservationDates(reservationId, {
        "Date de début": dateDebut.toISOString(),
        "Date de fin": dateFin.toISOString()
    });
    if (response.ok) await chargerDonneesPlanning();
}

async function deplacerReservationViaDragAndDrop(reservationId, nouvelleMachineId, nouvelleHeureDebut, dureeOriginale) {
    const d = dateAffichee;
    const hInteger = Math.floor(nouvelleHeureDebut);
    const mInteger = Math.round((nouvelleHeureDebut % 1) * 60);
    const nouvelleDateDebut = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hInteger, mInteger, 0);
    const nouvelleDateFin = new Date(nouvelleDateDebut.getTime() + (dureeOriginale * 3600000));
    
    const response = await API.updateReservationDates(reservationId, {
        "Machine": [nouvelleMachineId],
        "Date de début": nouvelleDateDebut.toISOString(),
        "Date de fin": nouvelleDateFin.toISOString()
    });
    if (response.ok) await chargerDonneesPlanning();
}

let modal, groupCommentaires, btnDelete, titleModal, formReservation;
function initGestionnaireModale() {
    modal = document.getElementById('reservation-modal');
    groupCommentaires = document.getElementById('group-commentaires-vi');
    btnDelete = document.getElementById('btn-delete-reservation');
    titleModal = document.getElementById('modal-title');
    formReservation = document.getElementById('reservation-form');
    
    const selectTypeVol = document.getElementById('form-type-vol');
    const btnOpenModal = document.getElementById('btn-add-reservation');
    const btnCloseModal = document.querySelector('.close-modal');

    if (selectTypeVol && groupCommentaires) {
        selectTypeVol.addEventListener('change', () => {
            groupCommentaires.style.display = (selectTypeVol.value.includes("Initiation")) ? 'block' : 'none';
        });
    }

    if (btnOpenModal && modal) {
        btnOpenModal.addEventListener('click', () => {
            idReservationEnEdition = null; 
            if (titleModal) titleModal.textContent = "Nouvelle Réservation";
            if (btnDelete) btnDelete.style.display = 'none'; 
            if (groupCommentaires) groupCommentaires.style.display = 'none';
            if (formReservation) formReservation.reset();
            if (listeAvionsCache.length > 0) populerSelectAvions(listeAvionsCache);
            
            const annee = dateAffichee.getFullYear();
            const mois = (dateAffichee.getMonth() + 1).toString().padStart(2, '0');
            const jour = dateAffichee.getDate().toString().padStart(2, '0');
            
            if (document.getElementById('form-debut')) document.getElementById('form-debut').value = `${annee}-${mois}-${jour}T09:00`;
            if (document.getElementById('form-fin')) document.getElementById('form-fin').value = `${annee}-${mois}-${jour}T11:00`;
            if (document.getElementById('form-estimation')) document.getElementById('form-estimation').value = '1.0';
            modal.style.display = 'flex';
        });
    }

    if (btnCloseModal) btnCloseModal.addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (e) => { if (modal && e.target === modal) modal.style.display = 'none'; });

    if (formReservation) {
        formReservation.addEventListener('submit', async (e) => {
            e.preventDefault();
            const typeVol = document.getElementById('form-type-vol').value;
            const piloteNom = document.getElementById('form-pilote').value.trim();
            if (typeVol === "Vol Classique" && !piloteNom) {
                alert("Le nom du pilote est obligatoire pour un vol classique.");
                return;
            }

            const recordData = {
                fields: {
                    "Type de vol": typeVol,
                    "Machine": [document.getElementById('form-machine').value],
                    "Pilote": piloteNom, 
                    "Date de début": new Date(document.getElementById('form-debut').value).toISOString(),
                    "Date de fin": new Date(document.getElementById('form-fin').value).toISOString(),
                    "Commentaires VI": typeVol.includes("Initiation") ? document.getElementById('form-commentaires').value : "",
                    "Temps estimé": parseFloat(document.getElementById('form-estimation').value) || 0
                }
            };

            if (idReservationEnEdition) recordData.id = idReservationEnEdition;

            const response = await API.saveReservation(recordData, !!idReservationEnEdition);
            if (response.ok) {
                modal.style.display = 'none';
                formReservation.reset();
                idReservationEnEdition = null;
                chargerDonneesPlanning();
                if (document.getElementById('view-aeronefs')?.style.display !== 'none') chargerSuiviAeronef();
            }
        });
    }

    if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
            if (!idReservationEnEdition || !confirm("Es-tu sûr de vouloir supprimer cette réservation ?")) return;
            const response = await API.deleteReservation(idReservationEnEdition);
            if (response.ok) {
                modal.style.display = 'none';
                formReservation.reset();
                idReservationEnEdition = null;
                chargerDonneesPlanning(); 
                if (document.getElementById('view-aeronefs')?.style.display !== 'none') chargerSuiviAeronef();
            }
        });
    }
}

function ouvrirModaleCreationDepuisGrille(avionId, heureDebutClic) {
    if (!modal) return;
    idReservationEnEdition = null; 
    if (titleModal) titleModal.textContent = "Nouvelle Réservation";
    if (btnDelete) btnDelete.style.display = 'none'; 
    if (groupCommentaires) groupCommentaires.style.display = 'none';
    if (formReservation) formReservation.reset();
    if (listeAvionsCache.length > 0) populerSelectAvions(listeAvionsCache);
    
    document.getElementById('form-machine').value = avionId;
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
    if (listeAvionsCache.length > 0) populerSelectAvions(listeAvionsCache);

    const typeVol = vol.fields['Type de vol'] || 'Vol Classique';
    document.getElementById('form-type-vol').value = typeVol;
    document.getElementById('form-pilote').value = vol.fields['Pilote'] || '';

    let idTargetMachine = vol.fields?.['Machine']?.[0];
    if (!idTargetMachine && avionIdOuImmat) {
        const targetStr = avionIdOuImmat.toString().trim().toUpperCase();
        const avionTrouve = listeAvionsCache.find(a => (a.fields['Immatriculation'] || '').toUpperCase() === targetStr || a.id.toUpperCase() === targetStr);
        idTargetMachine = avionTrouve ? avionTrouve.id : avionIdOuImmat;
    }

    if (idTargetMachine) document.getElementById('form-machine').value = idTargetMachine;
    document.getElementById('form-commentaires').value = vol.fields['Commentaires VI'] || '';
    document.getElementById('form-estimation').value = vol.fields['Temps estimé'] || '';
    if (groupCommentaires) groupCommentaires.style.display = typeVol.includes("Initiation") ? 'block' : 'none';
    
    document.getElementById('form-debut').value = formaterPourInput(new Date(vol.fields['Date de début']));
    document.getElementById('form-fin').value = formaterPourInput(new Date(vol.fields['Date de fin']));
    modal.style.display = 'flex';
}

async function chargerPresencesPlaneur() {
    const listInst = document.getElementById('list-instructeurs');
    const listElev = document.getElementById('list-eleves');
    const listPilo = document.getElementById('list-pilotes'); 
    if (!listInst || !listElev || !listPilo) return;
    listInst.innerHTML = ""; listElev.innerHTML = ""; listPilo.innerHTML = "";

    const data = await API.fetchPresencesPlaneur(dateAffichee.toISOString().split('T')[0]);
    data.forEach(rec => {
        const li = document.createElement('li');
        li.innerHTML = `<span>- ${rec.fields['Nom du pilote'] || 'Anonyme'}</span> <button class="btn-remove-presence" data-id="${rec.id}">❌</button>`;
        li.querySelector('button').addEventListener('click', () => desinscrirePlaneur(rec.id));
        
        const role = rec.fields['Rôle'];
        if (role === 'Instructeur') listInst.appendChild(li);
        if (role === 'Élève') listElev.appendChild(li);
        if (role === 'Pilote') listPilo.appendChild(li); 
    });
}

window.sinscrirePlaneur = async function(role) {
    const nomPilote = prompt(`Entrez le nom du ${role.toLowerCase()} à inscrire :`);
    if (!nomPilote || !nomPilote.trim()) return;
    const response = await API.addPresencePlaneur(nomPilote.trim(), role, dateAffichee.toISOString().split('T')[0]);
    if (response.ok) await chargerPresencesPlaneur();
};

async function desinscrirePlaneur(recordId) {
    if (!confirm("Voulez-vous supprimer cette inscription ?")) return;
    const response = await API.removePresencePlaneur(recordId);
    if (response.ok) await chargerPresencesPlaneur();
}

function initBoutonsNavigation() {
    document.getElementById('btn-prev')?.addEventListener('click', () => {
        dateAffichee.setDate(dateAffichee.getDate() - 1);
        mettreAJourDateAffichee();
        chargerDonneesPlanning();
    });
    document.getElementById('btn-next')?.addEventListener('click', () => {
        dateAffichee.setDate(dateAffichee.getDate() + 1);
        mettreAJourDateAffichee();
        chargerDonneesPlanning();
    });
}

function injecterControlesDateSuivi() {
    const selectMachine = document.getElementById('select-machine-suivi');
    if (!selectMachine) return;

    selectMachine.style.cssText = `
        background-color: #1e3d59; color: #ffffff; border: none; border-radius: 6px; padding: 8px 16px;
        font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; outline: none;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1); appearance: none; -webkit-appearance: none; padding-right: 32px;
        background-image: url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: right 12px center;
    `;

    let containerControles = document.getElementById('container-date-suivi');
    if (!containerControles) {
        containerControles = document.createElement('div');
        containerControles.id = 'container-date-suivi';
        containerControles.style.cssText = `background-color: #f1f3f5; border: 1px solid #ced4da; border-radius: 6px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 8px;`;
        containerControles.innerHTML = `
            <button id="btn-suivi-prev" style="background:none; border:none; cursor:pointer; font-size:14px; color:#1e3d59;">◀</button>
            <span id="current-date-suivi" style="font-weight:600; font-size:14px; color:#1e3d59;"></span>
            <button id="btn-suivi-next" style="background:none; border:none; cursor:pointer; font-size:14px; color:#1e3d59;">▶</button>
        `;
        selectMachine.parentNode.insertBefore(containerControles, selectMachine);

        document.getElementById('btn-suivi-prev').addEventListener('click', () => {
            dateAffichee.setDate(dateAffichee.getDate() - 1);
            mettreAJourDateAffichee();
            chargerSuiviAeronef();
        });
        document.getElementById('btn-suivi-next').addEventListener('click', () => {
            dateAffichee.setDate(dateAffichee.getDate() + 1);
            mettreAJourDateAffichee();
            chargerSuiviAeronef();
        });
    }
    mettreAJourDateAffichee();
}

function initNavigationTabs() {
    const tabPlanning = document.getElementById('tab-planning');
    const tabAeronefs = document.getElementById('tab-aeronefs');
    const viewPlanning = document.getElementById('view-planning');
    const viewAeronefs = document.getElementById('view-aeronefs');

    if (tabPlanning && tabAeronefs) {
        tabPlanning.addEventListener('click', () => {
            tabPlanning.classList.add('active');
            tabAeronefs.classList.remove('active');
            if (viewPlanning) viewPlanning.style.display = 'block';
            if (viewAeronefs) viewAeronefs.style.display = 'none';
        });

        tabAeronefs.addEventListener('click', () => {
            tabAeronefs.classList.add('active');
            tabPlanning.classList.remove('active');
            if (viewPlanning) viewPlanning.style.display = 'none';
            if (viewAeronefs) viewAeronefs.style.display = 'block';
            injecterControlesDateSuivi();
            chargerSuiviAeronef();
        });
    }
}

async function chargerSuiviAeronef() {
    const tbody = document.getElementById('suivi-table-body');
    const selectMachine = document.getElementById('select-machine-suivi');
    if (!tbody || !selectMachine) return;

    injecterControlesDateSuivi();
    const valSelectionnee = selectMachine.value ? selectMachine.value.trim().toUpperCase() : '';
    tbody.innerHTML = "<tr><td colspan='2' style='padding:15px;'>Chargement des données...</td></tr>";

    try {
        const [recordsMachines, recordsReservations] = await Promise.all([
            API.fetchAeronefs(),
            API.fetchReservations()
        ]);

        listeAvionsCache = recordsMachines;
        const machineActuelle = recordsMachines.find(m => {
            const immat = (m.fields?.['Immatriculation'] || '').toUpperCase();
            return m.id === selectMachine.value || immat === valSelectionnee || m.id === valSelectionnee;
        }) || recordsMachines[0];

        let potentielCourant = parseFloat(machineActuelle?.fields?.['Potentiel restant'] || 0);
        const potentielInitial = potentielCourant;
        const immatMachine = machineActuelle?.fields?.['Immatriculation'] || valSelectionnee;

        const dateDepart = new Date(dateAffichee);
        const tousLesVolsSorte = recordsReservations.filter(res => {
            if (!res.fields?.['Machine']) return false;
            const machinesLiees = Array.isArray(res.fields['Machine']) ? res.fields['Machine'] : [res.fields['Machine']];
            const estAssigne = machinesLiees.some(m => {
                const mStr = m.toString().toUpperCase();
                return mStr === machineActuelle.id.toUpperCase() || mStr === immatMachine.toUpperCase() || mStr === valSelectionnee;
            });
            if (!estAssigne) return false;
            return new Date(res.fields['Date de début']) >= new Date(dateDepart.getFullYear(), dateDepart.getMonth(), dateDepart.getDate());
        }).sort((a, b) => new Date(a.fields['Date de début']) - new Date(b.fields['Date de début']));

        tbody.innerHTML = '';

        for (let i = 0; i < 14; i++) {
            const dateJour = new Date(dateDepart);
            dateJour.setDate(dateDepart.getDate() + i);

            const volsDuJour = tousLesVolsSorte.filter(res => {
                const d = new Date(res.fields['Date de début']);
                return d.getFullYear() === dateJour.getFullYear() && d.getMonth() === dateJour.getMonth() && d.getDate() === dateJour.getDate();
            });

            const dateFormatee = `${dateJour.getDate().toString().padStart(2, '0')}/${(dateJour.getMonth() + 1).toString().padStart(2, '0')}/${dateJour.getFullYear()}`;

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #e2e8f0';

            const tdDate = document.createElement('td');
            tdDate.style.cssText = 'padding: 12px 10px; font-weight: bold; color: #1e3d59; vertical-align: middle;';
            tdDate.textContent = dateFormatee;
            tr.appendChild(tdDate);

            const tdPlanning = document.createElement('td');
            tdPlanning.style.cssText = 'padding: 8px 10px; vertical-align: middle; position: relative;';

            const gridBg = document.createElement('div');
            gridBg.style.cssText = 'position: relative; height: 42px; width: 100%; display: flex; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden;';
            gridBg.innerHTML = genererFondNuitHTML(dateJour);

            const hoursLayer = document.createElement('div');
            hoursLayer.style.cssText = 'position: absolute; top:0; left:0; width:100%; height:100%; display:flex; pointer-events:none; z-index: 2;';
            for (let h = 0; h < 24; h++) {
                const gridBlock = document.createElement('div');
                gridBlock.style.cssText = 'flex: 1; border-right: 1px solid rgba(203, 213, 225, 0.4); height: 100%;';
                hoursLayer.appendChild(gridBlock);
            }
            gridBg.appendChild(hoursLayer);

            const volsLayer = document.createElement('div');
            volsLayer.style.cssText = 'position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3;';

            volsDuJour.forEach(vol => {
                if (!vol.fields?.['Date de début'] || !vol.fields?.['Date de fin']) return;

                const dateDebut = new Date(vol.fields['Date de début']);
                const dateFin = new Date(vol.fields['Date de fin']);
                const heureDebut = dateDebut.getHours() + (dateDebut.getMinutes() / 60);
                const heureFin = dateFin.getHours() + (dateFin.getMinutes() / 60);
                const dureePrévue = parseFloat(vol.fields['Temps estimé'] || (heureFin - heureDebut));

                const potentielAvantVol = potentielCourant;
                potentielCourant -= dureePrévue;

                if (heureFin - heureDebut > 0) {
                    let bgColor = '#10b981'; // Vert
                    if (potentielCourant <= 0) bgColor = '#dc2626'; // Rouge
                    else if (potentielAvantVol <= 10.0 || potentielCourant <= 10.0) bgColor = '#eab308'; // Jaune

                    const barresDiv = document.createElement('div');
                    barresDiv.style.cssText = `
                        position: absolute; top: 4px; bottom: 4px;
                        left: ${(heureDebut / 24) * 100}%; width: ${((heureFin - heureDebut) / 24) * 100}%;
                        background-color: ${bgColor}; color: white; border-radius: 4px;
                        border-left: 5px solid #1e3d59; border-top-left-radius: 6px; border-bottom-left-radius: 6px;
                        box-sizing: border-box; display: flex; align-items: center; justify-content: center;
                        font-size: 11px; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                        cursor: pointer; overflow: hidden; white-space: nowrap; padding: 0 4px;
                    `;

                    barresDiv.innerHTML = `<span>${formaterNomPilote(vol.fields['Pilote']) || 'Réservé'}</span>`;
                    barresDiv.addEventListener('click', (e) => {
                        e.stopPropagation();
                        ouvrirModaleEdition(vol, machineActuelle.id);
                    });

                    volsLayer.appendChild(barresDiv);
                }
            });

            gridBg.appendChild(volsLayer);
            tdPlanning.appendChild(gridBg);
            tr.appendChild(tdPlanning);
            tbody.appendChild(tr);
        }

        const titreDoc = document.getElementById('aeronef-suivi-title');
        if (titreDoc) {
            const couleurFin = potentielCourant <= 0 ? '#dc2626' : (potentielCourant <= 10 ? '#d97706' : '#16a34a');
            titreDoc.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>Prévisionnel sur 14 jours</span>
                    <div style="font-size: 14px; font-weight: normal;">
                        Potentiel actuel : <strong>${potentielInitial.toFixed(1)} h</strong> ➔ 
                        Estimé à J+14 : <strong style="color: ${couleurFin};">${potentielCourant.toFixed(1)} h</strong>
                    </div>
                </div>
            `;
        }

    } catch (err) {
        console.error(err);
        tbody.innerHTML = "<tr><td colspan='2' style='padding:15px; color:red;'>Erreur lors du calcul du potentiel.</td></tr>";
    }
}

// --- INITIALISATION DU DOM ---
document.addEventListener('DOMContentLoaded', () => {
    genererFriseHeures();
    mettreAJourDateAffichee();
    initBoutonsNavigation();
    initGestionnaireModale();
    initNavigationTabs();
    chargerDonneesPlanning();
});