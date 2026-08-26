/* ==========================================================================
   AÉRONEFS - SUIVI DU POTENTIEL ET MAINTENANCE
   ========================================================================== */

function genererFriseHeuresSuivi() {
    const container = document.getElementById('timeline-hours-suivi');
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

function injecterControlesDateSuivi() {
    const selectMachine = document.getElementById('select-machine-suivi');
    if (!selectMachine) return;

    selectMachine.style.cssText = `
        background-color: #1e3d59;
        color: #ffffff;
        border: none;
        border-radius: 6px;
        padding: 8px 16px;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        outline: none;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        transition: background-color 0.2s ease;
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        padding-right: 32px;
        background-image: url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
    `;

    selectMachine.onmouseenter = () => selectMachine.style.backgroundColor = '#162d42';
    selectMachine.onmouseleave = () => selectMachine.style.backgroundColor = '#1e3d59';

    let containerControles = document.getElementById('container-date-suivi');
    if (!containerControles) {
        containerControles = document.createElement('div');
        containerControles.id = 'container-date-suivi';
        containerControles.className = 'date-picker-container';
        
        containerControles.style.cssText = `
            background-color: #f5f0e1;
            border-radius: 20px;
            padding: 5px 12px;
            display: inline-flex;
            align-items: center;
            gap: 12px;
            font-weight: bold;
            font-size: 14px;
        `;

        containerControles.innerHTML = `
            <button id="btn-suivi-prev" class="btn-nav" style="background:none; border:none; cursor:pointer; font-size:15px; color:#1e3d59;">◀</button>
            <span id="current-date-suivi" class="date-display" style="font-weight:600; font-size:14px; color:#1e3d59; cursor:pointer;" title="Cliquer pour choisir une date"></span>
            <button id="btn-suivi-next" class="btn-nav" style="background:none; border:none; cursor:pointer; font-size:15px; color:#1e3d59;">▶</button>
        `;

        selectMachine.parentNode.insertBefore(containerControles, selectMachine);

        const btnPrev = document.getElementById('btn-suivi-prev');
        const btnNext = document.getElementById('btn-suivi-next');
        const dateSuiviEl = document.getElementById('current-date-suivi');

        btnPrev.addEventListener('click', () => {
            dateAffichee.setDate(dateAffichee.getDate() - 1);
            mettreAJourDateAffichee();
            chargerSuiviAeronef();
        });

        btnNext.addEventListener('click', () => {
            dateAffichee.setDate(dateAffichee.getDate() + 1);
            mettreAJourDateAffichee();
            chargerSuiviAeronef();
        });

        if (dateSuiviEl) {
            dateSuiviEl.addEventListener('click', () => {
                const annee = dateAffichee.getFullYear();
                const mois = (dateAffichee.getMonth() + 1).toString().padStart(2, '0');
                const jour = dateAffichee.getDate().toString().padStart(2, '0');
                const datePrompt = prompt("Aller à la date (JJ/MM/AAAA) :", `${jour}/${mois}/${annee}`);
                if (datePrompt) {
                    const [d, m, y] = datePrompt.split('/').map(Number);
                    if (d && m && y) {
                        dateAffichee = new Date(y, m - 1, d, 12, 0, 0);
                        mettreAJourDateAffichee();
                        chargerSuiviAeronef();
                    }
                }
            });
        }
    }

    mettreAJourDateAffichee();
}

function parseTempsDeVol(tempsStr) {
    if (!tempsStr) return NaN;
    const match = String(tempsStr).trim().match(/^(\d+)h(\d{2})$/i);
    if (!match) return NaN;
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    return h + m / 60;
}

function ouvrirModaleMaintenance(record = null) {
    const modal = document.getElementById('maintenance-modal');
    const select = document.getElementById('select-machine-suivi');
    let machine;
    if (record && record.fields && record.fields['Machine']) {
        machine = (listeAvionsCache || []).find(m => m.fields && m.fields['Immatriculation'] === record.fields['Machine']);
    }
    if (!machine) {
        machine = (listeAvionsCache || []).find(m => {
            if (!m.fields) return false;
            return m.id === select.value || m.fields['Immatriculation'] === select.value;
        });
    }
    if (!machine && select && select.selectedIndex >= 0) {
        const selectedOption = select.options[select.selectedIndex];
        if (selectedOption) {
            machine = { id: select.value, fields: { Immatriculation: selectedOption.textContent } };
        }
    }
    if (!machine || !machine.fields) return;

    const f = record ? record.fields : {};
    const dateMaint = f['Date'] ? new Date(f['Date']) : new Date();
    const dateStr = dateMaint.getFullYear() + '-' + String(dateMaint.getMonth() + 1).padStart(2, '0') + '-' + String(dateMaint.getDate()).padStart(2, '0');
    const heureStr = String(dateMaint.getHours()).padStart(2, '0') + ':' + String(dateMaint.getMinutes()).padStart(2, '0');

    document.getElementById('maintenance-id').value = record ? record.id : '';
    document.getElementById('maintenance-machine-id').value = machine.id;
    document.getElementById('maintenance-machine-immat').value = machine.fields['Immatriculation'] || '';
    document.getElementById('maintenance-date').value = dateStr;
    document.getElementById('maintenance-heure').value = heureStr;
    document.getElementById('maintenance-duree').value = f['durée'] !== undefined ? f['durée'] : '1';
    const butee = parseFloat(String(machine.fields['Prochaine Butée'] || '').replace(',', '.')) || 0;
    document.getElementById('maintenance-ancienne-butee').value = f['Ancienne butée'] !== undefined ? f['Ancienne butée'] : butee;
    document.getElementById('maintenance-nouvelle-butee').value = f['Nouvelle Butée'] !== undefined ? f['Nouvelle Butée'] : '';
    if (modal) modal.style.display = 'flex';
}

function fermerModaleMaintenance() {
    const modal = document.getElementById('maintenance-modal');
    if (modal) modal.style.display = 'none';
    const form = document.getElementById('maintenance-form');
    if (form) form.reset();
}

async function enregistrerMaintenance(e) {
    e.preventDefault();
    const maintenanceId = document.getElementById('maintenance-id').value;
    const immat = document.getElementById('maintenance-machine-immat').value;
    const avionId = document.getElementById('maintenance-machine-id').value;
    const date = document.getElementById('maintenance-date').value;
    const heure = document.getElementById('maintenance-heure').value;
    const duree = parseFloat(String(document.getElementById('maintenance-duree').value).replace(',', '.'));
    const ancienneButee = parseFloat(String(document.getElementById('maintenance-ancienne-butee').value).replace(',', '.'));
    const nouvelleButee = parseFloat(String(document.getElementById('maintenance-nouvelle-butee').value).replace(',', '.'));

    if (!immat || !date || !heure || isNaN(duree) || isNaN(ancienneButee) || isNaN(nouvelleButee)) return;

    const dateTime = new Date(`${date}T${heure}`);
    const isoDate = isNaN(dateTime.getTime()) ? `${date}T${heure}` : dateTime.toISOString();

    try {
        const fieldsObj = {
            'Machine': immat,
            'Date': isoDate,
            'Ancienne butée': ancienneButee,
            'Nouvelle Butée': nouvelleButee,
            'durée': duree
        };
        const method = maintenanceId ? 'PATCH' : 'POST';
        const url = maintenanceId
            ? `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Maintenance')}/${maintenanceId}`
            : `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Maintenance')}`;
        const resMaint = await cachedFetch(url, { method, headers, body: JSON.stringify({ fields: fieldsObj }) });
        if (!resMaint.ok) {
            throw new Error(await resMaint.text());
        }

        const maintenancesRes = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Maintenance')}?filterByFormula=${encodeURIComponent(`{Machine}='${immat}'`)}`, { headers });
        const maintenancesData = await maintenancesRes.json();
        const maintenancesMachine = (maintenancesData.records || []).sort((a, b) => new Date(a.fields['Date']) - new Date(b.fields['Date']));
        const derniereMaintenance = maintenancesMachine[maintenancesMachine.length - 1];
        const nouvelleButeeAvion = derniereMaintenance ? parseFloat(String(derniereMaintenance.fields['Nouvelle Butée'] || '').replace(',', '.')) : nouvelleButee;

        const resAvion = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}/${avionId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
                fields: {
                    'Prochaine Butée': nouvelleButeeAvion
                }
            })
        });
        if (!resAvion.ok) {
            throw new Error(await resAvion.text());
        }

        if (typeof enregistrerAudit === 'function') {
            const action = maintenanceId ? 'Modification maintenance' : 'Création maintenance';
            const dateStr = isoDate.slice(0,16).replace('T',' ');
            await enregistrerAudit(action, immat, `Date : ${dateStr} | Durée : ${duree}h | Butée : ${nouvelleButee}`, 'Maintenance');
        }

        await notifierReservationsSurMaintenance(immat, dateTime, duree);
        fermerModaleMaintenance();
        chargerSuiviAeronef();
    } catch (err) {
        console.error(err);
        alert("Erreur lors de l'enregistrement de la maintenance.");
    }
}

function calculerTempsReelReservation(carnets, machine, dateDebut, dateFin, pilote) {
    const jour = dateDebut.getFullYear() + '-' +
        String(dateDebut.getMonth() + 1).padStart(2, '0') + '-' +
        String(dateDebut.getDate()).padStart(2, '0');
    const immat = (machine || '').toString().trim().toUpperCase();
    const resStartMin = dateDebut.getHours() * 60 + dateDebut.getMinutes();
    const resEndMin = dateFin.getHours() * 60 + dateFin.getMinutes();
    const offsetMin = dateDebut.getTimezoneOffset();
    let total = 0;
    let trouve = false;
    for (const c of carnets || []) {
        const f = c.fields || {};
        if (!f['Machine'] || f['Machine'].toString().trim().toUpperCase() !== immat) continue;
        if (!f['Date'] || f['Date'] !== jour) continue;
        if (!f['Temps de vol'] || !f['Heure départ'] || !f['Heure arrivée']) continue;

        const [hD, mD] = f['Heure départ'].split(':').map(Number);
        const [hA, mA] = f['Heure arrivée'].split(':').map(Number);
        if (isNaN(hD) || isNaN(mD) || isNaN(hA) || isNaN(mA)) continue;

        const depUtcMin = hD * 60 + mD;
        const arrUtcMin = hA * 60 + mA;
        const depLocalMin = depUtcMin - offsetMin;
        const arrLocalMin = arrUtcMin - offsetMin;
        const depNorm = ((depLocalMin % 1440) + 1440) % 1440;
        const arrNorm = ((arrLocalMin % 1440) + 1440) % 1440;

        if (arrNorm <= resStartMin || depNorm >= resEndMin) continue;

        const t = parseTempsDeVol(f['Temps de vol']);
        if (!isNaN(t)) {
            total += t;
            trouve = true;
        }
    }
    return trouve ? total : null;
}

async function chargerSuiviAeronef() {
    if (typeof appliquerAccesMaintenanceEtDocuments === 'function') appliquerAccesMaintenanceEtDocuments();
    const tbody = document.getElementById('suivi-table-body');
    const selectMachine = document.getElementById('select-machine-suivi');
    if (!tbody || !selectMachine) return;

    injecterControlesDateSuivi();

    const valSelectionnee = selectMachine.value ? selectMachine.value.trim().toUpperCase() : '';
    tbody.innerHTML = "<tr><td colspan='2' style='padding:15px;'>Chargement des données...</td></tr>";

    try {
        const [resMachines, resReservations, resCarnet] = await Promise.all([
            fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}`, { headers }),
            fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}`, { headers }),
            fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Carnet de route Pilotes')}`, { headers })
        ]);

        const dataMachines = await resMachines.json();
        const dataReservations = await resReservations.json();
        const dataCarnet = await resCarnet.json();
        const carnetsPilotes = dataCarnet.records || [];

        let maintenanceRecords = [];
        try {
            const resMaintenance = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Maintenance')}`, { headers });
            const dataMaintenance = await resMaintenance.json();
            maintenanceRecords = dataMaintenance.records || [];
        } catch (err) {
            console.warn('Erreur chargement Maintenance:', err);
        }

        const recordsMachines = dataMachines.records || [];
        listeAvionsCache = recordsMachines;
        populerSelectAvions(recordsMachines);

        const machineActuelle = recordsMachines.find(m => {
            if (!m.fields) return false;
            const immat = (m.fields['Immatriculation'] || '').toString().trim().toUpperCase();
            return m.id === selectMachine.value || immat === valSelectionnee || m.id === valSelectionnee;
        }) || recordsMachines[0];

        const dateDepart = new Date(dateAffichee);
        const immatMachine = machineActuelle && machineActuelle.fields && machineActuelle.fields['Immatriculation'] 
            ? machineActuelle.fields['Immatriculation'] 
            : valSelectionnee;

        const horametreActuelAeronef = (machineActuelle && machineActuelle.fields && machineActuelle.fields['Horamètre actuel'] !== undefined && machineActuelle.fields['Horamètre actuel'] !== null && machineActuelle.fields['Horamètre actuel'] !== '')
            ? parseFloat(String(machineActuelle.fields['Horamètre actuel']).replace(',', '.')) || 0
            : 0;

        const horametreActuelPilotes = (carnetsPilotes || []).reduce((max, c) => {
            const f = c.fields || {};
            if (!f['Machine'] || f['Machine'].toString().trim().toUpperCase() !== immatMachine.toString().trim().toUpperCase()) return max;
            const h = parseFloat(String(f['Horamètre arrivée'] || '').replace(',', '.'));
            return !isNaN(h) && h > max ? h : max;
        }, 0);

        const horametreActuel = horametreActuelPilotes > 0 ? horametreActuelPilotes : horametreActuelAeronef;

        let potentielCourant = 0;
        if (machineActuelle && machineActuelle.fields) {
            const f = machineActuelle.fields;
            if (f['Potentiel restant'] !== undefined && f['Potentiel restant'] !== null && f['Potentiel restant'] !== '') {
                potentielCourant = parseFloat(f['Potentiel restant']) || 0;
            } else if (f['Prochaine Butée'] !== undefined && horametreActuel !== undefined) {
                const butee = parseFloat(String(f['Prochaine Butée']).replace(',', '.')) || 0;
                potentielCourant = butee - horametreActuel;
            } else {
                const val = f['Potentiel'] !== undefined ? f['Potentiel'] : f['Potentiel Heures'];
                potentielCourant = parseFloat(val) || 0;
            }
        }

        let potentielInitial = 0;

        const dateDepartStr = dateDepart.getFullYear() + '-' +
            String(dateDepart.getMonth() + 1).padStart(2, '0') + '-' +
            String(dateDepart.getDate()).padStart(2, '0');
        const maintenances = maintenanceRecords.filter(m => {
            const f = m.fields || {};
            return (f['Machine'] || '').toString().trim().toUpperCase() === immatMachine.toUpperCase();
        }).sort((a, b) => new Date(a.fields['Date']) - new Date(b.fields['Date']));
        const dateDepartMinuit = new Date(dateDepart.getFullYear(), dateDepart.getMonth(), dateDepart.getDate());
        const dateFin14 = new Date(dateDepartMinuit);
        dateFin14.setDate(dateDepartMinuit.getDate() + 14);
        const tousLesVolsSorte = (dataReservations.records || []).filter(res => {
            if (!res.fields || !res.fields['Machine'] || !res.fields['Date de début'] || !res.fields['Date de fin']) return false;

            const machinesLiees = Array.isArray(res.fields['Machine']) ? res.fields['Machine'] : [res.fields['Machine']];

            const estAssigne = machinesLiees.some(m => {
                const mStr = m.toString().trim().toUpperCase();
                return mStr === machineActuelle.id.toUpperCase() || 
                       mStr === immatMachine.toUpperCase() || 
                       mStr === valSelectionnee;
            });

            if (!estAssigne) return false;

            const resStart = new Date(res.fields['Date de début']);
            const resEnd = new Date(res.fields['Date de fin']);
            return resStart < dateFin14 && resEnd > dateDepartMinuit;
        }).sort((a, b) => new Date(a.fields['Date de début']) - new Date(b.fields['Date de début']));

        tbody.innerHTML = '';
        const SEUIL_ALERTE = 10.0;

        for (let i = 0; i < 14; i++) {
            const dateJour = new Date(dateDepart);
            dateJour.setDate(dateDepart.getDate() + i);
            const dateJourStr = dateJour.getFullYear() + '-' +
                String(dateJour.getMonth() + 1).padStart(2, '0') + '-' +
                String(dateJour.getDate()).padStart(2, '0');

            const year = dateJour.getFullYear();
            const month = dateJour.getMonth();
            const day = dateJour.getDate();

            const startOfDay = new Date(year, month, day);
            const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
            const volsDuJour = tousLesVolsSorte.filter(res => {
                const resStart = new Date(res.fields['Date de début']);
                const resEnd = new Date(res.fields['Date de fin']);
                return resStart < endOfDay && resEnd > startOfDay;
            });

            const maintenancesAvantJour = maintenances.filter(m => {
                const mDate = String(m.fields['Date'] || '').slice(0, 10);
                return mDate <= dateJourStr;
            });
            let buteeJour;
            if (maintenancesAvantJour.length > 0) {
                buteeJour = parseFloat(String(maintenancesAvantJour[maintenancesAvantJour.length - 1].fields['Nouvelle Butée'] || '').replace(',', '.')) || 0;
            } else if (maintenances.length > 0) {
                buteeJour = parseFloat(String(maintenances[0].fields['Ancienne butée'] || '').replace(',', '.')) || 0;
            } else {
                buteeJour = parseFloat(String((machineActuelle.fields || {})['Prochaine Butée'] || '').replace(',', '.')) || 0;
            }

            const tempsCarnetDepuisJour = (carnetsPilotes || []).reduce((sum, c) => {
                const f = c.fields || {};
                if (!f['Machine'] || f['Machine'].toString().trim().toUpperCase() !== immatMachine.toUpperCase()) return sum;
                if (!f['Date'] || f['Date'] < dateJourStr) return sum;
                const t = parseTempsDeVol(f['Temps de vol']);
                return sum + (isNaN(t) ? 0 : t);
            }, 0);
            const horametreJour = horametreActuel - tempsCarnetDepuisJour;
            potentielCourant = buteeJour - horametreJour;
            if (i === 0) potentielInitial = potentielCourant;

            const dayNum = day.toString().padStart(2, '0');
            const monthNum = (month + 1).toString().padStart(2, '0');
            const dateFormatee = `${dayNum}/${monthNum}/${year}`;

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
            hoursLayer.style.cssText = 'position: absolute; top:0; left:0; width:100%; height:100%; display:flex; z-index: 2;';
            for (let h = 0; h < 24; h++) {
                const gridBlock = document.createElement('div');
                gridBlock.style.cssText = 'flex: 1; border-right: 1px solid rgba(203, 213, 225, 0.4); height: 100%; cursor: pointer;';
                
                const currentHour = h;
                const currentDateObj = new Date(dateJour);
                
                gridBlock.addEventListener('click', (e) => {
                    if (isResizing || isDraggingBar) {
                        e.stopPropagation();
                        return;
                    }
                    ouvrirModaleCreationDepuisGrilleDate(machineActuelle.id, currentHour, currentDateObj);
                });

                hoursLayer.appendChild(gridBlock);
            }
            gridBg.appendChild(hoursLayer);

            const volsLayer = document.createElement('div');
            volsLayer.style.cssText = 'position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; pointer-events: none;';

            volsDuJour.forEach(vol => {
                if (!vol.fields || !vol.fields['Date de début'] || !vol.fields['Date de fin']) return;

                const dateDebut = new Date(vol.fields['Date de début']);
                const dateFin = new Date(vol.fields['Date de fin']);
                const segmentDebut = new Date(Math.max(dateDebut.getTime(), startOfDay.getTime()));
                const segmentFin = new Date(Math.min(dateFin.getTime(), endOfDay.getTime()));
                let heureDebut = segmentDebut.getHours() + (segmentDebut.getMinutes() / 60);
                let heureFin = segmentFin.getHours() + (segmentFin.getMinutes() / 60);
                if (segmentFin.getTime() >= endOfDay.getTime()) heureFin = 24;
                const duree = heureFin - heureDebut;

                const totalDuree = (dateFin - dateDebut) / 3600000;
                const dureeSegment = (segmentFin - segmentDebut) / 3600000;
                const dureePrévue = parseFloat(vol.fields['Temps estimé'] || vol.fields['Heures estimées'] || totalDuree) || totalDuree;
                let dureeUtilisee = dureePrévue;
                if (totalDuree > 1 / 60) {
                    dureeUtilisee = dureePrévue * (dureeSegment / totalDuree);
                }

                if (segmentDebut < new Date()) {
                    const totalReel = calculerTempsReelReservation(carnetsPilotes, immatMachine, segmentDebut, segmentFin, vol.fields['Pilote']);
                    if (totalReel !== null) {
                        dureeUtilisee = totalReel;
                    }
                }

                const potentielAvantVol = potentielCourant;
                potentielCourant -= dureeUtilisee;

                if (duree > 0) {
                    const piloteNom = vol.fields['Pilote'] || '';
                    const piloteFormate = formaterNomPilote(piloteNom);
                    const barresDiv = document.createElement('div');
                    
                    let bgColor = '#10b981';

                    if (potentielCourant <= 0) {
                        bgColor = '#dc2626';
                    } else if (potentielAvantVol <= SEUIL_ALERTE || potentielCourant <= SEUIL_ALERTE) {
                        bgColor = '#eab308';
                    } else {
                        bgColor = '#10b981';
                    }

                    const labelPotentiel = `${potentielCourant.toFixed(1)}h`;

                    barresDiv.style.cssText = `
                        position: absolute;
                        top: 4px;
                        bottom: 4px;
                        left: ${(heureDebut / 24) * 100}%;

                        width: ${(duree / 24) * 100}%;
                        background-color: ${bgColor};
                        color: white;
                        border-radius: 4px;
                        border-left: 5px solid #1e3d59;
                        border-top-left-radius: 6px;
                        border-bottom-left-radius: 6px;
                        box-sizing: border-box;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        font-size: 11px;
                        font-weight: 600;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                        cursor: pointer;
                        overflow: hidden;
                        white-space: nowrap;
                        padding: 0 6px;
                        pointer-events: auto;
                    `;

                    barresDiv.innerHTML = `<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${piloteFormate || 'Réservé'}</span><span style="font-size:10px; font-weight:700; opacity:0.95; flex-shrink:0; margin-left:4px;">${labelPotentiel}</span>`;

                    const handleLeft = document.createElement('div');
                    handleLeft.className = 'resize-handle resize-handle-left';
                    const handleRight = document.createElement('div');
                    handleRight.className = 'resize-handle resize-handle-right';
                    barresDiv.appendChild(handleLeft);
                    barresDiv.appendChild(handleRight);

                    handleLeft.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        initierResize(e, vol.id, gridBg, barresDiv, 'gauche', heureDebut, heureFin, dateJour);
                    });
                    handleRight.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        initierResize(e, vol.id, gridBg, barresDiv, 'droite', heureDebut, heureFin, dateJour);
                    });

                    barresDiv.addEventListener('mousedown', (e) => {
                        if (e.target.classList.contains('resize-handle')) return;
                        e.stopPropagation();
                        initierDeplacementBarre(e, vol.id, machineActuelle.id, gridBg, barresDiv, heureDebut, duree, dateJour);
                    });
                    
                    barresDiv.addEventListener('click', (e) => {
                    e.stopPropagation(); 
                    if (isDraggingBar) return;
                    ouvrirModaleEdition(vol, machineActuelle.id);
                    });

                    volsLayer.appendChild(barresDiv);
                }
            });

            const maintenanceDuJour = maintenances.find(m => {
                const mDate = String(m.fields['Date'] || '').slice(0, 10);
                return mDate === dateJourStr;
            });
            if (maintenanceDuJour) {
                const maintenanceDate = new Date(maintenanceDuJour.fields['Date']);
                const heureMaint = maintenanceDate.getHours() + (maintenanceDate.getMinutes() / 60);
                const left = (heureMaint / 24) * 100;
                const duree = parseFloat(maintenanceDuJour.fields['durée']) || 1;
                const widthPct = Math.min((duree / 24) * 100, 100 - left);
                const maintenanceBubble = document.createElement('div');
                maintenanceBubble.style.cssText = `
                    position: absolute;
                    top: 9px;
                    left: ${left}%;
                    width: ${widthPct}%;
                    height: 25px;
                    background-color: rgba(124, 58, 237, 0.7);
                    border-radius: 3px;
                    z-index: 4;
                    cursor: pointer;
                    overflow: hidden;
                    color: white;
                    font-size: 10px;
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                maintenanceBubble.textContent = widthPct > 12 ? '🔧 Maintenance' : '🔧';
                const butee = maintenanceDuJour.fields['Nouvelle Butée'] || '';
                const heureStr = maintenanceDate.getHours().toString().padStart(2, '0') + ':' + maintenanceDate.getMinutes().toString().padStart(2, '0');
                maintenanceBubble.title = `Maintenance à ${heureStr} (${duree}h) - Nouvelle butée : ${butee}`;
                maintenanceBubble.addEventListener('click', (e) => {
                    e.stopPropagation();
                    ouvrirModaleMaintenance(maintenanceDuJour);
                });
                gridBg.appendChild(maintenanceBubble);
            }

            gridBg.appendChild(volsLayer);
            tdPlanning.appendChild(gridBg);

            const volsCarnetJour = carnetsPilotes.filter(c => {
                const f = c.fields || {};
                if (!f['Machine'] || f['Machine'].toString().trim().toUpperCase() !== immatMachine.toUpperCase()) return false;
                return f['Date'] === dateJourStr;
            }).sort((a, b) => String(a.fields['Heure départ'] || '').localeCompare(String(b.fields['Heure départ'] || '')));

            if (volsCarnetJour.length > 0) {
                const carnetContainer = document.createElement('div');
                carnetContainer.style.cssText = 'margin-top: 6px; position: relative; height: 10px;';
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
                    const offsetHeures = -dateJour.getTimezoneOffset() / 60;
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
                tdPlanning.appendChild(carnetContainer);
            }

            tr.appendChild(tdPlanning);
            tbody.appendChild(tr);
        }

        const titreDoc = document.getElementById('aeronef-suivi-title');
        if (titreDoc) {
            titreDoc.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>Prévisionnel sur 14 jours</span>
                    <div style="font-size: 14px; font-weight: normal;">
                        Potentiel actuel : <strong>${potentielInitial.toFixed(1)} h</strong>
                    </div>
                </div>
            `;
        }

        if (immatMachine && typeof chargerDocumentsAeronef === 'function') {
            chargerDocumentsAeronef(immatMachine, true);
        }

    } catch (err) {
        console.error(err);
        tbody.innerHTML = "<tr><td colspan='2' style='padding:15px; color:red;'>Erreur lors du calcul du potentiel.</td></tr>";
    }
}

function initNavigationTabs() {
    const tabPlanning = document.getElementById('tab-planning');
    const tabAeronefs = document.getElementById('tab-aeronefs');
    const tabInitiation = document.getElementById('tab-initiation');
    const tabInstructeur = document.getElementById('tab-instructeur');
    const tabCarnet = document.getElementById('tab-carnet');
    const tabMembres = document.getElementById('tab-membres');
    const tabDocuments = document.getElementById('tab-documents');
    const tabComptes = document.getElementById('tab-comptes');
    const tabAudit = document.getElementById('tab-audit');
    const viewPlanning = document.getElementById('view-planning');
    const viewAeronefs = document.getElementById('view-aeronefs');
    const viewInitiation = document.getElementById('view-initiation');
    const viewInstructeur = document.getElementById('view-instructeur');
    const viewCarnet = document.getElementById('view-carnet');
    const viewMembres = document.getElementById('view-membres');
    const viewDocuments = document.getElementById('view-documents');
    const viewComptes = document.getElementById('view-comptes');
    const viewAudit = document.getElementById('view-audit');
    const viewAccueilMembre = document.getElementById('view-accueil-membre');
    const viewMessagerie = document.getElementById('view-messagerie');

    function activerTab(tab, vue) {
        [tabPlanning, tabAeronefs, tabInitiation, tabInstructeur, tabCarnet, tabMembres, tabDocuments, tabComptes, tabAudit, tabMessagerie].forEach(t => { if (t) t.classList.remove('active'); });
        [viewPlanning, viewAeronefs, viewInitiation, viewInstructeur, viewCarnet, viewMembres, viewDocuments, viewComptes, viewAudit, viewAccueilMembre, viewMessagerie].forEach(v => { if (v) v.style.display = 'none'; });
        if (tab) tab.classList.add('active');
        if (vue) vue.style.display = 'block';
        // Ouvrir le groupe contenant l'onglet actif, fermer les autres groupes déroulants
        document.querySelectorAll('.nav-group:not(.nav-group-standalone)').forEach(g => g.classList.remove('open'));
        const groupe = tab ? tab.closest('.nav-group') : null;
        if (groupe) groupe.classList.add('open');
    }

    if (tabPlanning) {
        tabPlanning.addEventListener('click', () => {
            activerTab(tabPlanning, viewPlanning);
        });
    }

    if (tabAeronefs) {
        tabAeronefs.addEventListener('click', () => {
            activerTab(tabAeronefs, viewAeronefs);
            injecterControlesDateSuivi();
            chargerSuiviAeronef();
        });
    }

    if (tabInstructeur) {
        tabInstructeur.addEventListener('click', () => {
            activerTab(tabInstructeur, viewInstructeur);
            if (typeof initPlanningInstructeur === 'function') initPlanningInstructeur();
            if (typeof chargerSuiviInstructeur === 'function') chargerSuiviInstructeur();
        });
    }

    if (tabInitiation) {
        tabInitiation.addEventListener('click', () => {
            activerTab(tabInitiation, viewInitiation);
            chargerVolsInitiation();
        });
    }

    if (tabCarnet) {
        tabCarnet.addEventListener('click', () => {
            activerTab(tabCarnet, viewCarnet);
            chargerCarnetRoute();
        });
    }

    if (tabMembres) {
        tabMembres.addEventListener('click', () => {
            if (isSuperAdmin()) {
                activerTab(tabMembres, viewMembres);
                if (typeof chargerUtilisateurs === 'function') chargerUtilisateurs();
            } else {
                activerTab(tabMembres, viewAccueilMembre);
                if (typeof chargerAccueilMembre === 'function') chargerAccueilMembre(currentUser ? currentUser.id : null);
            }
        });
    }

    if (tabDocuments) {
        tabDocuments.addEventListener('click', () => {
            activerTab(tabDocuments, viewDocuments);
            if (typeof chargerDocuments === 'function') chargerDocuments();
        });
    }

    if (tabComptes) {
        tabComptes.addEventListener('click', () => {
            activerTab(tabComptes, viewComptes);
            if (typeof chargerComptesPilotes === 'function') chargerComptesPilotes();
        });
    }

    if (tabAudit) {
        tabAudit.addEventListener('click', () => {
            activerTab(tabAudit, viewAudit);
            if (typeof chargerAudit === 'function') chargerAudit(true);
        });
    }

    if (tabMessagerie) {
        tabMessagerie.addEventListener('click', () => {
            activerTab(tabMessagerie, viewMessagerie);
            if (typeof chargerMessagerie === 'function') chargerMessagerie();
        });
    }

    // Menus déroulants
    document.querySelectorAll('.nav-group-title').forEach(titre => {
        titre.addEventListener('click', () => {
            const groupe = titre.closest('.nav-group');
            if (groupe) groupe.classList.toggle('open');
        });
    });

    // Ouvrir le groupe contenant l'onglet actif au démarrage
    const ongletActif = document.querySelector('.nav-sub li.active');
    if (ongletActif) {
        const groupeActif = ongletActif.closest('.nav-group');
        if (groupeActif) groupeActif.classList.add('open');
    }
}

const btnMaintenance = document.getElementById('btn-maintenance');
if (btnMaintenance) btnMaintenance.addEventListener('click', () => ouvrirModaleMaintenance());

const formMaintenance = document.getElementById('maintenance-form');
if (formMaintenance) formMaintenance.addEventListener('submit', enregistrerMaintenance);

const closeMaintenance = document.getElementById('close-maintenance');
if (closeMaintenance) closeMaintenance.addEventListener('click', fermerModaleMaintenance);

// --- SUIVI DOCUMENTATION MACHINE ---
const TABLE_DOCUMENTS_AERONEFS = 'Documents Aéronefs';
const TYPES_DOCUMENTS_AERONEFS = [
    { code: 'CDN', nom: 'Certificat de Navigabilité', dateRequise: false },
    { code: 'CI', nom: 'Certificat d\'Immatriculation', dateRequise: false },
    { code: 'LSA', nom: 'Licence de station d\'aéronef', dateRequise: false },
    { code: 'M&B', nom: 'Masse et Centrage', dateRequise: false },
    { code: 'CEN', nom: 'Certificat d\'Examen de Navigabilité', dateRequise: true },
    { code: 'Assurance', nom: 'Assurance', dateRequise: true },
    { code: 'Accusé', nom: 'Accusé de réception de la déclaration d\'aptitude au vol d\'un ULM', dateRequise: true },
    { code: 'Autre', nom: 'Autre', dateRequise: false }
];
let documentsAeronefsParMachine = {};

function peutGererMaintenanceEtDocuments() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    const roles = currentUser.roles || [];
    return roles.includes('Mécanicien') || roles.includes('Mecanicien') || roles.includes('Super admin') || roles.includes('Super Admin');
}

function appliquerAccesMaintenanceEtDocuments() {
    const btnMaintenance = document.getElementById('btn-maintenance');
    const btnDocs = document.getElementById('btn-documents-aeronef');
    const acces = peutGererMaintenanceEtDocuments();
    if (btnMaintenance) btnMaintenance.style.display = acces ? '' : 'none';
    if (btnDocs) btnDocs.style.display = acces ? '' : 'none';
}

function initSuiviDocumentsAeronefs() {
    const header = document.querySelector('#view-aeronefs .header');
    const btnMaintenance = document.getElementById('btn-maintenance');
    if (!header || !btnMaintenance) return;

    if (!document.getElementById('btn-documents-aeronef')) {
        const btn = document.createElement('button');
        btn.id = 'btn-documents-aeronef';
        btn.className = 'btn-primary';
        btn.textContent = 'Suivi documentation machine';
        btn.style.marginLeft = '8px';
        btn.addEventListener('click', ouvrirModaleDocumentsAeronef);
        btnMaintenance.parentNode.insertBefore(btn, btnMaintenance.nextSibling);
    }
    appliquerAccesMaintenanceEtDocuments();

    if (!document.getElementById('documents-aeronef-recap')) {
        const recap = document.createElement('div');
        recap.id = 'documents-aeronef-recap';
        recap.style.cssText = 'background: white; border-radius: 12px; padding: 12px 20px; margin: 15px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: none;';
        recap.innerHTML = '<h4 style="margin: 0 0 8px; color: #1e3d59; font-size: 13px;">Documents machine</h4><div id="documents-aeronef-list" style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px;"></div>';
        const whiteDiv = header.nextElementSibling;
        if (whiteDiv && whiteDiv.parentNode) {
            whiteDiv.parentNode.insertBefore(recap, whiteDiv);
        }
    }
    creerModaleDocumentsAeronef();
}

function creerModaleDocumentsAeronef() {
    if (document.getElementById('documents-aeronef-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'documents-aeronef-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px; max-height: 85vh; overflow-y: auto;">
            <span class="close-documents-aeronef">&times;</span>
            <h3 id="documents-aeronef-modal-title">Documents machine</h3>
            <div id="documents-aeronef-list-modal" style="margin: 15px 0;"></div>
            <form id="form-document-aeronef" style="display:none; margin-top:15px; border-top:1px solid #e2e8f0; padding-top:15px;">
                <input type="hidden" id="doc-aeronef-id">
                <input type="hidden" id="doc-aeronef-machine">
                <div class="form-group">
                    <label for="doc-aeronef-type">Type de document *</label>
                    <select id="doc-aeronef-type" required>
                        <option value="">-- Choisir --</option>
                        ${TYPES_DOCUMENTS_AERONEFS.map(t => `<option value="${t.code}">${t.nom}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" id="doc-aeronef-autre-group" style="display:none;">
                    <label for="doc-aeronef-autre-nom">Nom du document *</label>
                    <input type="text" id="doc-aeronef-autre-nom" placeholder="Nom du document" style="width:100%;">
                </div>
                <div class="form-group">
                    <label for="doc-aeronef-date">Date de validité</label>
                    <input type="date" id="doc-aeronef-date">
                </div>
                <div class="form-group">
                    <label for="doc-aeronef-fichier">Fichier</label>
                    <input type="file" id="doc-aeronef-fichier" style="padding:6px; border:1px solid #cbd5e1; border-radius:6px; width:100%; box-sizing:border-box;">
                    <span id="doc-aeronef-upload-status" style="font-size:12px; color:#64748b;"></span>
                </div>
                <div class="form-group">
                    <label for="doc-aeronef-lien">Lien / Référence</label>
                    <input type="url" id="doc-aeronef-lien" placeholder="https://..." style="width:100%;">
                </div>
                <div class="form-group" style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="doc-aeronef-actif" checked style="width:auto;">
                    <label for="doc-aeronef-actif" style="margin:0;">Actif</label>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-submit">Enregistrer</button>
                    <button type="button" id="doc-aeronef-cancel" class="btn-toggle">Annuler</button>
                </div>
            </form>
            <div class="form-actions" style="margin-top:15px;">
                <button type="button" id="btn-nouveau-doc-aeronef" class="btn-primary">+ Ajouter un document</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    const close = modal.querySelector('.close-documents-aeronef');
    if (close) close.addEventListener('click', fermerModaleDocumentsAeronef);
    modal.addEventListener('click', (e) => { if (e.target === modal) fermerModaleDocumentsAeronef(); });
    const btnNouveau = document.getElementById('btn-nouveau-doc-aeronef');
    if (btnNouveau) btnNouveau.addEventListener('click', () => ouvrirFormulaireDocumentAeronef(null));
    const form = document.getElementById('form-document-aeronef');
    if (form) form.addEventListener('submit', enregistrerDocumentAeronef);
    const btnCancel = document.getElementById('doc-aeronef-cancel');
    if (btnCancel) btnCancel.addEventListener('click', () => {
        form.style.display = 'none';
        document.getElementById('btn-nouveau-doc-aeronef').style.display = 'inline-block';
    });
    const selectType = document.getElementById('doc-aeronef-type');
    if (selectType) selectType.addEventListener('change', (e) => {
        const type = TYPES_DOCUMENTS_AERONEFS.find(t => t.code === e.target.value);
        const dateInput = document.getElementById('doc-aeronef-date');
        if (dateInput) {
            dateInput.required = type ? type.dateRequise : false;
            dateInput.style.opacity = type && !type.dateRequise ? '0.5' : '1';
        }
        const autreGroup = document.getElementById('doc-aeronef-autre-group');
        const autreInput = document.getElementById('doc-aeronef-autre-nom');
        if (autreGroup && autreInput) {
            const estAutre = e.target.value === 'Autre';
            autreGroup.style.display = estAutre ? 'block' : 'none';
            autreInput.required = estAutre;
            if (!estAutre) autreInput.value = '';
        }
    });

    const inputFichier = document.getElementById('doc-aeronef-fichier');
    if (inputFichier) inputFichier.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const status = document.getElementById('doc-aeronef-upload-status');
        const btnSubmit = form ? form.querySelector('button[type="submit"]') : null;
        if (status) status.textContent = 'Envoi en cours...';
        if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Envoi...'; }
        try {
            if (typeof uploaderFichierDocument !== 'function') throw new Error('Uploader non disponible');
            const url = await uploaderFichierDocument(file);
            document.getElementById('doc-aeronef-lien').value = url;
            if (status) status.textContent = 'Fichier importé.';
            inputFichier.value = '';
        } catch (err) {
            console.error(err);
            alert('Erreur lors de l\'upload : ' + (err.message || ''));
            if (status) status.textContent = 'Erreur d\'envoi.';
        } finally {
            if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Enregistrer'; }
        }
    });
}

function fermerModaleDocumentsAeronef() {
    const modal = document.getElementById('documents-aeronef-modal');
    if (modal) modal.style.display = 'none';
    const form = document.getElementById('form-document-aeronef');
    if (form) {
        form.reset();
        form.style.display = 'none';
        document.getElementById('doc-aeronef-id').value = '';
        document.getElementById('doc-aeronef-machine').value = '';
    }
    const btnNouveau = document.getElementById('btn-nouveau-doc-aeronef');
    if (btnNouveau) btnNouveau.style.display = 'inline-block';
}

async function ouvrirModaleDocumentsAeronef() {
    const selectMachine = document.getElementById('select-machine-suivi');
    const immat = selectMachine && selectMachine.options[selectMachine.selectedIndex] ? selectMachine.options[selectMachine.selectedIndex].textContent : '';
    const modal = document.getElementById('documents-aeronef-modal');
    const title = document.getElementById('documents-aeronef-modal-title');
    if (title) title.textContent = `Documents – ${immat}`;
    if (modal) modal.style.display = 'flex';
    await chargerDocumentsAeronef(immat, true);
    afficherListeDocumentsAeronef(immat);
}

function ouvrirFormulaireDocumentAeronef(record = null) {
    const form = document.getElementById('form-document-aeronef');
    const selectMachine = document.getElementById('select-machine-suivi');
    const immat = selectMachine && selectMachine.options[selectMachine.selectedIndex] ? selectMachine.options[selectMachine.selectedIndex].textContent : '';
    if (!form) return;
    form.style.display = 'block';
    document.getElementById('doc-aeronef-id').value = record ? record.id : '';
    document.getElementById('doc-aeronef-machine').value = immat;
    const typeSelect = document.getElementById('doc-aeronef-type');
    const autreInput = document.getElementById('doc-aeronef-autre-nom');
    const autreGroup = document.getElementById('doc-aeronef-autre-group');
    if (record) {
        const typeCode = record.fields['Type de document'] || '';
        const connu = TYPES_DOCUMENTS_AERONEFS.some(t => t.code === typeCode);
        if (connu) {
            typeSelect.value = typeCode;
            if (autreInput) autreInput.value = '';
            if (autreGroup) autreGroup.style.display = 'none';
        } else {
            typeSelect.value = 'Autre';
            if (autreInput) autreInput.value = typeCode;
            if (autreGroup) autreGroup.style.display = 'block';
        }
    } else {
        typeSelect.value = '';
        if (autreInput) autreInput.value = '';
        if (autreGroup) autreGroup.style.display = 'none';
    }
    document.getElementById('doc-aeronef-date').value = record ? (record.fields['Date de validité'] || '') : '';
    document.getElementById('doc-aeronef-lien').value = record ? (record.fields['Lien'] || '') : '';
    document.getElementById('doc-aeronef-actif').checked = record ? (record.fields['Activé'] !== false) : true;
    const inputFichier = document.getElementById('doc-aeronef-fichier');
    if (inputFichier) inputFichier.value = '';
    const status = document.getElementById('doc-aeronef-upload-status');
    if (status) status.textContent = '';
    const btnNouveau = document.getElementById('btn-nouveau-doc-aeronef');
    if (btnNouveau) btnNouveau.style.display = 'none';
    document.getElementById('doc-aeronef-type').dispatchEvent(new Event('change'));
}

async function chargerDocumentsAeronef(machine, forceRefresh = false) {
    if (!machine) {
        documentsAeronefsParMachine[machine] = [];
        return [];
    }
    if (!forceRefresh && documentsAeronefsParMachine[machine]) return documentsAeronefsParMachine[machine];
    try {
        const formula = `{Machine}='${machine}'`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOCUMENTS_AERONEFS)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
        const res = await cachedFetch(url, { headers }, API_CACHE_TTL, forceRefresh);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        const records = data.records || [];
        documentsAeronefsParMachine[machine] = records;
        afficherRecapDocumentsAeronef(machine);
        return records;
    } catch (err) {
        console.warn('Erreur chargement documents aéronef:', err);
        documentsAeronefsParMachine[machine] = [];
        return [];
    }
}

function afficherRecapDocumentsAeronef(machine) {
    const recap = document.getElementById('documents-aeronef-list');
    const container = document.getElementById('documents-aeronef-recap');
    if (!recap || !container) return;
    const records = (documentsAeronefsParMachine[machine] || []).filter(r => r.fields && r.fields['Activé'] !== false);
    if (records.length === 0) {
        container.style.display = 'none';
        return;
    }
    const now = new Date();
    const dans3mois = new Date();
    dans3mois.setMonth(dans3mois.getMonth() + 3);
    const aujourdhui = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    recap.innerHTML = records.map(r => {
        const f = r.fields || {};
        const type = TYPES_DOCUMENTS_AERONEFS.find(t => t.code === f['Type de document']) || { nom: f['Type de document'] };
        let couleur = '#10b981';
        let dateTxt = '';
        if (f['Date de validité']) {
            const dateValid = new Date(f['Date de validité'] + 'T00:00:00');
            dateTxt = ` – ${dateValid.toLocaleDateString('fr-FR')}`;
            if (dateValid < aujourdhui) couleur = '#dc2626';
            else if (dateValid < dans3mois) couleur = '#f97316';
        }
        const label = f['Lien']
            ? `<a href="${f['Lien']}" target="_blank" rel="noopener" style="color:#0f172a; text-decoration:underline;">${type.nom}${dateTxt}</a>`
            : `<span style="color:#0f172a;">${type.nom}${dateTxt}</span>`;
        return `
            <div style="display:flex; align-items:center; gap:6px; background:#f8fafc; padding: 4px 8px; border-radius: 6px; border: 1px solid #e2e8f0;">
                <span style="width:10px; height:10px; border-radius:50%; background:${couleur}; display:inline-block;"></span>
                ${label}
            </div>
        `;
    }).join('');
    container.style.display = 'block';
}

function afficherListeDocumentsAeronef(machine) {
    const list = document.getElementById('documents-aeronef-list-modal');
    if (!list) return;
    const records = (documentsAeronefsParMachine[machine] || []).sort((a, b) => (a.fields['Type de document'] || '').localeCompare(b.fields['Type de document'] || ''));
    if (records.length === 0) {
        list.innerHTML = '<p style="color:#64748b;">Aucun document enregistré pour cette machine.</p>';
        return;
    }
    list.innerHTML = records.map(r => {
        const f = r.fields || {};
        const type = TYPES_DOCUMENTS_AERONEFS.find(t => t.code === f['Type de document']) || { nom: f['Type de document'], dateRequise: false };
        const dateTxt = f['Date de validité'] ? `<br><span style="color:#64748b; font-size:12px;">Validité : ${new Date(f['Date de validité'] + 'T00:00:00').toLocaleDateString('fr-FR')}</span>` : '';
        const lien = f['Lien'] ? `<a href="${f['Lien']}" target="_blank" style="color:#1e3d59; font-size:12px; word-break:break-all;">Voir le document</a>` : '';
        const actif = f['Activé'] !== false;
        const toggleLabel = actif ? 'Désactiver' : 'Activer';
        const toggleColor = actif ? '#ef4444' : '#17b978';
        return `
            <div style="padding:10px; border-bottom:1px solid #e2e8f0;">
                <div style="font-size:13px;">
                    <strong>${type.nom}</strong>
                    ${dateTxt}
                    ${lien ? `<div>${lien}</div>` : ''}
                </div>
                <div style="display:flex; gap:6px; margin-top:8px;">
                    <button class="btn-primary" data-action="edit" data-id="${r.id}" style="font-size:12px; padding:6px 10px;">Modifier</button>
                    <button data-action="toggle" data-id="${r.id}" style="font-size:12px; padding:6px 10px; background:${toggleColor}; color:white; border:none; border-radius:6px; cursor:pointer;">${toggleLabel}</button>
                    <button data-action="delete" data-id="${r.id}" style="font-size:12px; padding:6px 10px; background:#ef4444; color:white; border:none; border-radius:6px; cursor:pointer;">Supprimer</button>
                </div>
            </div>
        `;
    }).join('');
    list.querySelectorAll('button[data-id]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            const action = e.target.dataset.action;
            const records = documentsAeronefsParMachine[machine] || [];
            const record = records.find(r => r.id === id);
            if (!record) return;
            if (action === 'edit') ouvrirFormulaireDocumentAeronef(record);
            else if (action === 'delete') supprimerDocumentAeronef(record);
            else if (action === 'toggle') toggleActifDocumentAeronef(record, !record.fields['Activé']);
        });
    });
}

async function enregistrerDocumentAeronef(e) {
    e.preventDefault();
    const form = document.getElementById('form-document-aeronef');
    const id = document.getElementById('doc-aeronef-id').value;
    const machine = document.getElementById('doc-aeronef-machine').value;
    let typeCode = document.getElementById('doc-aeronef-type').value;
    const autreNom = document.getElementById('doc-aeronef-autre-nom') ? document.getElementById('doc-aeronef-autre-nom').value.trim() : '';
    const date = document.getElementById('doc-aeronef-date').value;
    const lien = document.getElementById('doc-aeronef-lien').value;
    const actif = document.getElementById('doc-aeronef-actif').checked;
    if (!machine || !typeCode) { alert('La machine et le type de document sont requis.'); return; }
    if (typeCode === 'Autre') {
        if (!autreNom) { alert('Veuillez saisir un nom pour le document.'); return; }
        typeCode = autreNom;
    }
    const type = TYPES_DOCUMENTS_AERONEFS.find(t => t.code === document.getElementById('doc-aeronef-type').value);
    if (type && type.dateRequise && !date) { alert('La date de validité est requise pour ce type de document.'); return; }
    const fields = {
        'Machine': machine,
        'Type de document': typeCode,
        'Lien': lien,
        'Activé': actif
    };
    if (date) fields['Date de validité'] = date;
    try {
        const method = id ? 'PATCH' : 'POST';
        const url = id
            ? `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOCUMENTS_AERONEFS)}/${id}`
            : `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOCUMENTS_AERONEFS)}`;
        const body = id ? JSON.stringify({ fields }) : JSON.stringify({ records: [{ fields }] });
        const res = await cachedFetch(url, { method, headers, body });
        if (!res.ok) throw new Error(await res.text());
        const selectMachine = document.getElementById('select-machine-suivi');
        const immat = selectMachine && selectMachine.options[selectMachine.selectedIndex] ? selectMachine.options[selectMachine.selectedIndex].textContent : '';
        await chargerDocumentsAeronef(immat, true);
        afficherListeDocumentsAeronef(immat);
        afficherRecapDocumentsAeronef(immat);
        fermerModaleDocumentsAeronef();
        if (typeof chargerSuiviAeronef === 'function') chargerSuiviAeronef();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'enregistrement : ' + err.message);
    }
}

async function supprimerDocumentAeronef(record) {
    const f = record.fields || {};
    const type = TYPES_DOCUMENTS_AERONEFS.find(t => t.code === f['Type de document']) || { nom: f['Type de document'] };
    if (!confirm(`Supprimer le document "${type.nom}" ?`)) return;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOCUMENTS_AERONEFS)}/${record.id}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error('Erreur Airtable');
        const selectMachine = document.getElementById('select-machine-suivi');
        const immat = selectMachine && selectMachine.options[selectMachine.selectedIndex] ? selectMachine.options[selectMachine.selectedIndex].textContent : '';
        await chargerDocumentsAeronef(immat, true);
        afficherListeDocumentsAeronef(immat);
        afficherRecapDocumentsAeronef(immat);
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la suppression : ' + err.message);
    }
}

async function toggleActifDocumentAeronef(record, actif) {
    const fields = { 'Activé': actif };
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOCUMENTS_AERONEFS)}/${record.id}`, { method: 'PATCH', headers, body: JSON.stringify({ fields }) });
        if (!res.ok) throw new Error('Erreur Airtable');
        const selectMachine = document.getElementById('select-machine-suivi');
        const immat = selectMachine && selectMachine.options[selectMachine.selectedIndex] ? selectMachine.options[selectMachine.selectedIndex].textContent : '';
        await chargerDocumentsAeronef(immat, true);
        afficherListeDocumentsAeronef(immat);
        afficherRecapDocumentsAeronef(immat);
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la mise à jour : ' + err.message);
    }
}

async function getNomPiloteReservation(piloteField) {
    const id = Array.isArray(piloteField) ? piloteField[0] : piloteField;
    if (typeof id === 'string' && id.startsWith('rec')) {
        try {
            const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Utilisateurs')}/${id}`, { headers });
            const data = await res.json();
            if (res.ok && data.fields) {
                return `${data.fields['Prénom'] || ''} ${data.fields['Nom'] || ''}`.trim();
            }
        } catch (e) {
            console.error(e);
        }
    }
    return Array.isArray(piloteField) ? piloteField.join(' ') : (piloteField || '').toString().trim();
}

async function notifierReservationsSurMaintenance(immat, dateDebut, dureeHeures) {
    try {
        if (typeof creerNotification !== 'function') return;
        const dateFin = new Date(dateDebut.getTime() + dureeHeures * 3600000);
        const startDay = dateDebut.toISOString().slice(0, 10);
        const endDay = dateFin.toISOString().slice(0, 10);
        const heureDebut = dateDebut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const heureFin = dateFin.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const dateText = dateDebut.toLocaleDateString('fr-FR');
        const formula = `AND(FIND('${immat.replace(/'/g, "\\'")}', ARRAYJOIN({Machine}, ',')), DATETIME_FORMAT({Date de début}, 'YYYY-MM-DD')<='${endDay}', DATETIME_FORMAT({Date de fin}, 'YYYY-MM-DD')>='${startDay}')`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const records = data.records || [];
        for (const r of records) {
            const f = r.fields || {};
            if (!f['Date de début'] || !f['Date de fin']) continue;
            const resaStart = new Date(f['Date de début']);
            const resaEnd = new Date(f['Date de fin']);
            if (resaStart >= dateFin || resaEnd <= dateDebut) continue;
            const piloteNom = await getNomPiloteReservation(f['Pilote']);
            if (!piloteNom) continue;
            const message = `L'appareil ${immat} est programmé en maintenance le ${dateText} de ${heureDebut} à ${heureFin}. Votre réservation sur cet appareil risque d'être compromise.`;
            await creerNotification(piloteNom, message, 'warning');
        }
    } catch (err) {
        console.error('Erreur notification maintenance:', err);
    }
}

initSuiviDocumentsAeronefs();
