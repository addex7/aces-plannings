/* ==========================================================================
   CARNET DE ROUTE - SAISIE ET CONSULTATION DES VOLS
   ========================================================================== */

// Table dédiée au carnet de route "pilote".
// La table "Carnet de route" existante est conservée pour le suivi horamètre/maintenance.
const TABLE_CARNET_ROUTE = 'Carnet de route Pilotes';

let listeVolsCarnetCache = [];
let idCarnetEnEdition = null;
let machineCarnetSelectionnee = 'F-GASB';
const IMMATS_PLANEURS = ['F-CEJX', 'F-CDYX', 'F-CITT', 'F-CEGV', 'F-CBNA', 'F-CEQJ', 'F-CDVN', 'F-CFRK', 'F-CHDT', 'F-CEQZ', 'F-CESL'];
const REMOQUES_PLANEURS = IMMATS_PLANEURS.map(i => `Remorque ${i}`);
const MACHINES_PLANEUR_REMOQUE = [...IMMATS_PLANEURS, ...REMOQUES_PLANEURS];

function calculerTempsDeVol(horametreDepart, horametreArrivee, heureDepart, heureArrivee) {
    // Priorité aux horamètres si les deux sont renseignés
    if (horametreDepart && horametreArrivee) {
        const dep = parseFloat(horametreDepart);
        const arr = parseFloat(horametreArrivee);
        if (!isNaN(dep) && !isNaN(arr) && arr >= dep) {
            const minutes = Math.round((arr - dep) * 60);
            const hrs = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return `${String(hrs).padStart(2, '0')}h${String(mins).padStart(2, '0')}`;
        }
    }
    // Sinon, calcul à partir des heures UTC
    if (!heureDepart || !heureArrivee) return '';
    const [hD, mD] = heureDepart.split(':').map(Number);
    const [hA, mA] = heureArrivee.split(':').map(Number);
    if (isNaN(hD) || isNaN(mD) || isNaN(hA) || isNaN(mA)) return '';
    let minutes = (hA * 60 + mA) - (hD * 60 + mD);
    if (minutes < 0) minutes += 24 * 60;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hrs).padStart(2, '0')}h${String(mins).padStart(2, '0')}`;
}

async function ouvrirModaleCarnet(recordId = null, machineImmat = null) {
    const modal = document.getElementById('carnet-modal');
    const form = document.getElementById('carnet-form');
    const titre = modal ? modal.querySelector('h3') : null;
    if (!modal || !form) return;
    form.reset();
    idCarnetEnEdition = recordId || null;
    const btnDelete = document.getElementById('btn-delete-carnet');
    const dateInput = document.getElementById('carnet-date');
    const selectMachine = document.getElementById('carnet-machine');
    const selectFiltre = document.getElementById('carnet-machine-filtre');
    const departInput = document.getElementById('carnet-depart');
    const arriveeInput = document.getElementById('carnet-arrivee');
    const heureDepart = document.getElementById('carnet-heure-depart');
    const heureArrivee = document.getElementById('carnet-heure-arrivee');
    const decollages = document.getElementById('carnet-decollages');
    const atterrissages = document.getElementById('carnet-atterrissages');
    const piloteInput = document.getElementById('carnet-pilote');
    const piloteLabel = document.getElementById('carnet-pilote-label');
    if (titre) titre.textContent = recordId ? 'Modifier un vol' : (machineImmat ? 'Nouvelle observation' : 'Saisir un vol');
    if (btnDelete) btnDelete.style.display = recordId ? 'inline-block' : 'none';
    if (dateInput) dateInput.value = new Date().toLocaleDateString('en-CA');
    if (departInput) departInput.value = 'LFOY';
    if (arriveeInput) arriveeInput.value = 'LFOY';

    const piloteDefaut = (typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim());
    if (piloteInput) piloteInput.value = piloteDefaut;
    if (piloteLabel) piloteLabel.textContent = piloteDefaut;

    await peuplerInstructeursSelect(recordId ? (listeVolsCarnetCache.find(r => r.id === recordId)?.fields['Instructeur'] || '') : '');

    if (machineImmat) {
        form.dataset.mode = 'observation';
        if (heureDepart) heureDepart.value = '00:00';
        if (heureArrivee) heureArrivee.value = '00:00';
        if (decollages) decollages.value = '0';
        if (atterrissages) atterrissages.value = '0';
        if (selectMachine && selectMachine.querySelector(`option[value="${machineImmat}"]`)) selectMachine.value = machineImmat;
        const obs = document.getElementById('carnet-observations');
        setTimeout(() => { if (obs) obs.focus(); }, 50);
    } else {
        form.dataset.mode = 'vol';
        if (selectMachine && selectFiltre && selectMachine.querySelector(`option[value="${selectFiltre.value}"]`)) {
            selectMachine.value = selectFiltre.value;
        }
    }
    document.getElementById('carnet-id').value = recordId || '';
    if (recordId) {
        const record = listeVolsCarnetCache.find(r => r.id === recordId);
        if (record && record.fields) remplirFormulaireCarnet(record.fields);
    } else if (selectMachine && form.dataset.mode !== 'observation') {
        mettreAJourDonneesDepartDefaut(selectMachine.value);
    }
    modal.style.display = 'flex';
}

function fermerModaleCarnet() {
    const modal = document.getElementById('carnet-modal');
    if (modal) modal.style.display = 'none';
    idCarnetEnEdition = null;
    const btnDelete = document.getElementById('btn-delete-carnet');
    if (btnDelete) btnDelete.style.display = 'none';
}

function remplirFormulaireCarnet(f) {
    const pilote = f['Pilote'] || (typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim());
    document.getElementById('carnet-date').value = f['Date'] ? (f['Date'].split('T')[0] || '') : '';
    const piloteInput = document.getElementById('carnet-pilote');
    if (piloteInput) piloteInput.value = pilote;
    const piloteLabel = document.getElementById('carnet-pilote-label');
    if (piloteLabel) piloteLabel.textContent = pilote;
    const instSel = document.getElementById('carnet-instructeur');
    if (instSel) instSel.value = f['Instructeur'] || '';
    document.getElementById('carnet-machine').value = f['Machine'] || 'F-GASB';
    document.getElementById('carnet-depart').value = f['Départ'] || 'LFOY';
    document.getElementById('carnet-arrivee').value = f['Arrivée'] || 'LFOY';
    document.getElementById('carnet-heure-depart').value = f['Heure départ'] || '';
    document.getElementById('carnet-heure-arrivee').value = f['Heure arrivée'] || '';
    document.getElementById('carnet-nature').value = f['Nature'] || 'Autre';
    document.getElementById('carnet-carburant-depart').value = f['Carburant départ'] || '';
    document.getElementById('carnet-carburant-arrivee').value = f['Carburant arrivée'] || '';
    document.getElementById('carnet-huile-depart').value = f['Huile départ'] || '';
    document.getElementById('carnet-huile-arrivee').value = f['Huile arrivée'] || '';
    document.getElementById('carnet-horametre-depart').value = f['Horamètre départ'] || '';
    document.getElementById('carnet-horametre-arrivee').value = f['Horamètre arrivée'] || '';
    document.getElementById('carnet-observations').value = f['Observations'] || '';
    document.getElementById('carnet-decollages').value = (f['Décollages'] === 0 || f['Décollages']) ? f['Décollages'] : '1';
    document.getElementById('carnet-atterrissages').value = (f['Atterrissages'] === 0 || f['Atterrissages']) ? f['Atterrissages'] : '1';
    const fonctions = (f['Fonction'] || '').split('/').map(x => x.trim());
    document.querySelectorAll('input[name="carnet-fonction"]').forEach(cb => {
        cb.checked = fonctions.includes(cb.value);
    });
    const inputHArrivee = document.getElementById('carnet-horametre-arrivee');
    if (inputHArrivee && !inputHArrivee.value) mettreAJourHorametreArrivee();
}

let listeInstructeursCache = [];

async function peuplerInstructeursSelect(instructeur = '') {
    const sel = document.getElementById('carnet-instructeur');
    if (!sel) return;
    const ROLES_INSTRUCTEUR = ['Instructeur avion', 'Instructeur planeur', 'Instructeur ULM'];
    try {
        if (!listeInstructeursCache.length) {
            const table = typeof TABLE_UTILISATEURS !== 'undefined' ? TABLE_UTILISATEURS : 'Utilisateurs';
            const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?sort[0][field]=Nom&sort[0][direction]=asc&pageSize=100`, { headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message);
            listeInstructeursCache = (data.records || []).filter(r => {
                const roles = Array.isArray(r.fields?.['Rôles']) ? r.fields['Rôles'] : [r.fields?.['Rôles']].filter(Boolean);
                return roles.some(role => ROLES_INSTRUCTEUR.includes(role));
            });
        }
        const noneOption = sel.querySelector('option[value=""]');
        sel.innerHTML = noneOption ? noneOption.outerHTML : '<option value="">-- Aucun --</option>';
        listeInstructeursCache.forEach(r => {
            const f = r.fields || {};
            const nomComplet = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim() || 'Instructeur';
            const opt = document.createElement('option');
            opt.value = nomComplet;
            opt.textContent = nomComplet;
            if (instructeur && (nomComplet === instructeur || f['Nom'] === instructeur || f['Prénom'] === instructeur)) opt.selected = true;
            sel.appendChild(opt);
        });
        if (instructeur) sel.value = instructeur;
    } catch (err) {
        console.error('Erreur chargement instructeurs:', err);
        sel.innerHTML = `<option value="">-- Aucun --</option>${instructeur ? `<option value="${escHtml(instructeur)}">${escHtml(instructeur)}</option>` : ''}`;
    }
}

function mettreAJourDonneesDepartDefaut(machine) {
    const hInput = document.getElementById('carnet-horametre-depart');
    const tInput = document.getElementById('carnet-depart');
    const volsMachine = listeVolsCarnetCache
        .filter(r => (r.fields || {})['Machine'] === machine)
        .sort((a, b) => {
            const dateA = new Date(a.fields['Date'] || 0);
            const dateB = new Date(b.fields['Date'] || 0);
            if (dateB - dateA !== 0) return dateB - dateA;
            const timeA = new Date(a.createdTime || 0);
            const timeB = new Date(b.createdTime || 0);
            return timeB - timeA;
        });
    if (volsMachine.length > 0) {
        const dernier = volsMachine[0].fields || {};
        const arr = dernier['Horamètre arrivée'];
        if (hInput && arr !== undefined && arr !== null && arr !== '') {
            hInput.value = arr;
        }
        if (tInput && dernier['Arrivée']) {
            tInput.value = dernier['Arrivée'];
        }
    }
}

function formaterNombre(n) {
    if (n === null || n === undefined || n === '') return '';
    const parsed = parseFloat(n);
    return isNaN(parsed) ? '' : parsed.toLocaleString('fr-FR');
}

function afficherCarburant(v) {
    if (v === null || v === undefined || v === '') return '-';
    const val = String(v).trim();
    if (val.toUpperCase() === 'PC') return 'PC';
    if (val.toUpperCase().includes('PC')) return val;
    return formaterNombre(v) || '-';
}

function calculerHorametreArrivee(machine, horametreDepart, heureDepart, heureArrivee) {
    if (!horametreDepart || !heureDepart || !heureArrivee) return null;
    if (machine === 'F-BLIO') return null;
    const [hD, mD] = heureDepart.split(':').map(Number);
    const [hA, mA] = heureArrivee.split(':').map(Number);
    if (isNaN(hD) || isNaN(mD) || isNaN(hA) || isNaN(mA)) return null;
    let minutes = (hA * 60 + mA) - (hD * 60 + mD);
    if (minutes < 0) minutes += 24 * 60;
    const dep = parseFloat(horametreDepart);
    if (isNaN(dep)) return null;
    if (machine === 'F-GASB') {
        const arr = dep + minutes / 60;
        return Math.round(arr * 100) / 100;
    }
    if (machine === 'F-JVIO') {
        const h = Math.floor(dep);
        const m = Math.round((dep - h) * 100);
        let total = h * 60 + m + minutes;
        const hArr = Math.floor(total / 60);
        const mArr = total % 60;
        return parseFloat((hArr + mArr / 100).toFixed(2));
    }
    return null;
}

function mettreAJourHorametreArrivee() {
    const machine = document.getElementById('carnet-machine').value;
    const hDep = document.getElementById('carnet-horametre-depart').value;
    const heureDep = document.getElementById('carnet-heure-depart').value;
    const heureArr = document.getElementById('carnet-heure-arrivee').value;
    const inputArr = document.getElementById('carnet-horametre-arrivee');
    if (!inputArr) return;
    const arr = calculerHorametreArrivee(machine, hDep, heureDep, heureArr);
    if (arr !== null) inputArr.value = arr;
}

function mettreAJourNatureParFonction() {
    const select = document.getElementById('carnet-nature');
    if (!select) return;
    const checked = Array.from(document.querySelectorAll('input[name="carnet-fonction"]:checked')).map(cb => cb.value);
    if (checked.includes('FE')) select.value = 'Examen';
    else if (checked.includes('FI')) select.value = 'Instruction';
}

function afficherCarnet(records) {
    const tbody = document.getElementById('carnet-body');
    if (!tbody) return;
    if (!records || records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="15" class="carnet-empty">Aucun vol enregistré dans le carnet de route.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    records.forEach(record => {
        const f = record.fields || {};
        const equipage = [f['Pilote'], f['Instructeur']].filter(Boolean).join(' / ') || '-';
        const temps = f['Temps de vol'] || calculerTempsDeVol(f['Horamètre départ'], f['Horamètre arrivée'], f['Heure départ'], f['Heure arrivée']);
        const dateObj = f['Date'] ? new Date(f['Date']) : null;
        const dateStr = dateObj ? dateObj.toLocaleDateString('fr-FR') : '-';
        const carburant = [formaterNombre(f['Carburant départ']), formaterNombre(f['Carburant arrivée'])].filter(v => v !== '').join(' / ') || '-';
        const huile = [formaterNombre(f['Huile départ']), formaterNombre(f['Huile arrivée'])].filter(v => v !== '').join(' / ') || '-';
        const horametre = [formaterNombre(f['Horamètre départ']), formaterNombre(f['Horamètre arrivée'])].filter(v => v !== '').join(' / ') || '-';

        const tr = document.createElement('tr');
        tr.dataset.id = record.id;
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${equipage}</td>
            <td>${f['Fonction'] || '-'}</td>
            <td>${f['Départ'] || '-'}</td>
            <td>${f['Arrivée'] || '-'}</td>
            <td>${f['Heure départ'] || ''}</td>
            <td>${f['Heure arrivée'] || ''}</td>
            <td>${temps || '-'}</td>
            <td>${f['Nature'] || '-'}</td>
            <td>${afficherCarburant(f['Carburant départ'])}</td>
            <td>${afficherCarburant(f['Carburant arrivée'])}</td>
            <td>${formaterNombre(f['Huile départ']) || '-'}</td>
            <td>${formaterNombre(f['Huile arrivée']) || '-'}</td>
            <td>${(f['Observations'] || '').trim() || '-'}</td>
            <td>${horametre}</td>
        `;
        tr.addEventListener('click', () => ouvrirModaleCarnet(record.id));
        tbody.appendChild(tr);
    });
}

function afficherAlarmeObservation(records) {
    const alarme = document.getElementById('carnet-observation-alarme');
    if (!alarme) return;
    if (!records || records.length === 0) {
        alarme.style.display = 'none';
        return;
    }
    const avecObs = records.filter(r => {
        const f = r.fields || {};
        const m = f['Machine'];
        const matchMachine = !machineCarnetSelectionnee
            || (machineCarnetSelectionnee === 'PLANEUR'
                ? MACHINES_PLANEUR_REMOQUE.includes(m)
                : m === machineCarnetSelectionnee);
        return (f['Observations'] || '').trim() !== '' && matchMachine;
    }).sort((a, b) => new Date(a.fields['Date']) - new Date(b.fields['Date']));
    if (avecObs.length === 0) {
        alarme.style.display = 'none';
        return;
    }
    alarme.style.display = 'flex';
    alarme.style.cssText = `
        background-color: rgba(253, 224, 71, 0.25);
        border-left: 4px solid #eab308;
        color: #854d0e;
        padding: 10px 14px;
        border-radius: 6px;
        margin: 10px 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 13px;
    `;
    const btnsHtml = `
        <button class="btn-statut-obs" data-statut="Pris en compte" style="padding: 4px 8px; border: 1px solid #854d0e; background: transparent; color: #854d0e; border-radius: 4px; cursor: pointer; font-size: 12px;">Pris en compte</button>
        <button class="btn-statut-obs" data-statut="En cours de traitement" style="padding: 4px 8px; border: 1px solid #854d0e; background: transparent; color: #854d0e; border-radius: 4px; cursor: pointer; font-size: 12px;">En cours</button>
        <button class="btn-statut-obs" data-statut="Observation traitée" style="padding: 4px 8px; border: 1px solid #854d0e; background: transparent; color: #854d0e; border-radius: 4px; cursor: pointer; font-size: 12px;">Traité</button>
    `;
    let html = '';
    avecObs.forEach(obs => {
        const f = obs.fields || {};
        const dateObj = f['Date'] ? new Date(f['Date']) : null;
        const dateStr = dateObj ? dateObj.toLocaleDateString('fr-FR') : '-';
        const statut = (f['Statut observation'] || 'Non pris en compte').toString();
        html += `
            <div data-record-id="${obs.id}" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid rgba(180, 83, 9, 0.2);">
                <div>
                    <strong>🛠️ ${f['Machine'] || ''} — ${dateStr}</strong> — ${(f['Observations'] || '').trim()}
                    <span class="obs-statut" style="font-style: italic; margin-left: 8px; color: #92400e;">(${statut})</span>
                </div>
                <div class="obs-btns" style="display: flex; gap: 6px; flex-shrink: 0;">${btnsHtml}</div>
            </div>
        `;
    });
    alarme.innerHTML = html;
    alarme.querySelectorAll('.btn-statut-obs').forEach(btn => {
        const recordId = btn.closest('[data-record-id]')?.dataset.recordId;
        btn.addEventListener('click', () => mettreAJourStatutObservation(recordId, btn.dataset.statut));
    });
}

async function mettreAJourStatutObservation(recordId, statut) {
    try {
        const fields = { 'Statut observation': statut };
        if (statut === 'Observation traitée') {
            fields['Observations'] = '';
        }
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CARNET_ROUTE)}/${recordId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields })
        });
        if (!res.ok) throw new Error(await res.text());
        chargerCarnetRoute();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la mise à jour du statut.');
    }
}

async function chargerCarnetRoute() {
    const tbody = document.getElementById('carnet-body');
    const tableContainer = document.querySelector('.carnet-table-container');
    const planeurContainer = document.getElementById('carnet-planeur-container');
    const btnOuvrir = document.getElementById('btn-ouvrir-carnet');
    const alarme = document.getElementById('carnet-observation-alarme');

    if (machineCarnetSelectionnee === 'PLANEUR') {
        if (tableContainer) tableContainer.style.display = 'none';
        if (planeurContainer) planeurContainer.style.display = 'block';
        if (btnOuvrir) btnOuvrir.style.display = 'none';
        if (tbody) tbody.innerHTML = '';
        try {
            const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CARNET_ROUTE)}?sort[0][field]=Date&sort[0][direction]=asc`;
            const response = await cachedFetch(url, { headers });
            const data = await response.json();
            if (response.ok) {
                listeVolsCarnetCache = data.records || [];
                afficherAlarmeObservation(listeVolsCarnetCache);
            } else {
                if (alarme) alarme.style.display = 'none';
                console.error(data);
            }
        } catch (error) {
            console.error(error);
            if (alarme) alarme.style.display = 'none';
        }
        return;
    }

    if (tableContainer) tableContainer.style.display = 'block';
    if (planeurContainer) planeurContainer.style.display = 'none';
    if (btnOuvrir) btnOuvrir.style.display = 'inline-block';
    if (alarme) alarme.style.display = 'none';
    if (tbody) tbody.innerHTML = '<tr><td colspan="15" class="carnet-empty">Chargement du carnet de route...</td></tr>';
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CARNET_ROUTE)}?sort[0][field]=Date&sort[0][direction]=asc`;
        const response = await cachedFetch(url, { headers });
        const data = await response.json();
        if (response.ok) {
            listeVolsCarnetCache = data.records || [];
            await nettoyerCarnetRouteMaintenance(machineCarnetSelectionnee);
            const volsMachine = listeVolsCarnetCache.filter(r => {
                const f = r.fields || {};
                return !machineCarnetSelectionnee || f['Machine'] === machineCarnetSelectionnee;
            }).sort((a, b) => new Date(a.fields['Date']) - new Date(b.fields['Date']));
            afficherCarnet(volsMachine);
            afficherAlarmeObservation(volsMachine);
            await synchroniserHorametreAeronef(machineCarnetSelectionnee, volsMachine);
        } else {
            console.error(data);
            if (tbody) tbody.innerHTML = '<tr><td colspan="15" class="carnet-empty">Erreur lors du chargement du carnet.</td></tr>';
        }
    } catch (error) {
        console.error(error);
        if (tbody) tbody.innerHTML = '<tr><td colspan="15" class="carnet-empty">Erreur lors du chargement du carnet.</td></tr>';
    }
}

async function synchroniserVolMaintenance(machine, date, pilote, horametreArrivee) {
    const h = parseFloat(String(horametreArrivee).replace(',', '.'));
    if (isNaN(h)) return;
    try {
        const urlBaseAeronefs = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}`;
        const filter = `?filterByFormula=${encodeURIComponent(`{Immatriculation}='${machine}'`)}`;
        const resA = await cachedFetch(urlBaseAeronefs + filter, { headers });
        const dataA = await resA.json();
        if (!dataA.records || dataA.records.length === 0) return;
        const avionId = dataA.records[0].id;

        const dateObj = new Date(`${date}T00:00:00`);
        const dateISO = isNaN(dateObj.getTime()) ? date : dateObj.toISOString();

        const urlCarnet = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Carnet de route')}`;
        await cachedFetch(urlCarnet, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                fields: {
                    'Machine': [avionId],
                    'Pilote': pilote,
                    'Nouvel Horamètre': h,
                    'Date du vol': dateISO
                }
            })
        });
    } catch (e) {
        console.error(e);
    }
}

async function soumettreCarnetRoute(event) {
    event.preventDefault();
    const date = document.getElementById('carnet-date').value;
    const pilote = document.getElementById('carnet-pilote').value.trim();
    const instructeur = document.getElementById('carnet-instructeur').value.trim();
    const decollages = parseInt(document.getElementById('carnet-decollages').value, 10) || 0;
    const atterrissages = parseInt(document.getElementById('carnet-atterrissages').value, 10) || 0;
    const fonction = Array.from(document.querySelectorAll('input[name="carnet-fonction"]:checked')).map(cb => cb.value).join('/');
    const machine = document.getElementById('carnet-machine').value;
    const depart = document.getElementById('carnet-depart').value.trim();
    const arrivee = document.getElementById('carnet-arrivee').value.trim();
    const heureDepart = document.getElementById('carnet-heure-depart').value;
    const heureArrivee = document.getElementById('carnet-heure-arrivee').value;
    const nature = document.getElementById('carnet-nature').value;
    const carburantDepart = document.getElementById('carnet-carburant-depart').value;
    const carburantArrivee = document.getElementById('carnet-carburant-arrivee').value;
    const huileDepart = document.getElementById('carnet-huile-depart').value;
    const huileArrivee = document.getElementById('carnet-huile-arrivee').value;
    const horametreDepart = document.getElementById('carnet-horametre-depart').value;
    const horametreArrivee = document.getElementById('carnet-horametre-arrivee').value;
    const observations = document.getElementById('carnet-observations').value.trim();

    const ancienRecord = idCarnetEnEdition ? listeVolsCarnetCache.find(r => r.id === idCarnetEnEdition) : null;

    const temps = calculerTempsDeVol(horametreDepart, horametreArrivee, heureDepart, heureArrivee);
    const numeric = (val) => {
        if (val === '' || val === null || val === undefined) return null;
        const n = parseFloat(val);
        return isNaN(n) ? null : n;
    };
    const valeurCarburant = (val) => {
        const v = (val || '').trim();
        if (v === '') return null;
        if (v.toUpperCase().includes('PC')) return v;
        const n = parseFloat(v.replace(',', '.'));
        const isPureNumber = /^[0-9]*[.,]?[0-9]+$/.test(v.replace(/\s/g, ''));
        return isPureNumber && !isNaN(n) ? n : v;
    };

    const fields = {
        "Date": date,
        "Pilote": pilote,
        "Instructeur": instructeur || '',
        "Fonction": fonction,
        "Machine": machine,
        "Départ": depart,
        "Arrivée": arrivee,
        "Heure départ": heureDepart,
        "Heure arrivée": heureArrivee,
        "Temps de vol": temps,
        "Décollages": decollages,
        "Atterrissages": atterrissages,
        "Nature": nature,
        "Carburant départ": valeurCarburant(carburantDepart),
        "Carburant arrivée": valeurCarburant(carburantArrivee),
        "Huile départ": numeric(huileDepart),
        "Huile arrivée": numeric(huileArrivee),
        "Horamètre départ": numeric(horametreDepart),
        "Horamètre arrivée": numeric(horametreArrivee),
        "Observations": observations
    };

    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CARNET_ROUTE)}${idCarnetEnEdition ? '/' + idCarnetEnEdition : ''}`;
        const response = await cachedFetch(url, {
            method: idCarnetEnEdition ? 'PATCH' : 'POST',
            headers: headers,
            body: JSON.stringify({ fields })
        });
        const result = await response.json();
        if (response.ok) {
            if (idCarnetEnEdition && ancienRecord && ancienRecord.fields) {
                const af = ancienRecord.fields;
                if (af['Machine'] && af['Date'] && af['Horamètre arrivée'] !== undefined && af['Horamètre arrivée'] !== null && af['Horamètre arrivée'] !== '') {
                    await supprimerVolMaintenance(af['Machine'], af['Date'], af['Horamètre arrivée']);
                }
            }
            await synchroniserVolMaintenance(machine, date, pilote, fields['Horamètre arrivée']);
            fermerModaleCarnet();
            chargerCarnetRoute();
        } else {
            console.error(result);
            const msg = result && result.error && result.error.message ? result.error.message : 'Vérifiez la console pour le détail.';
            alert('Erreur lors de l\'enregistrement du vol : ' + msg);
        }
    } catch (error) {
        console.error(error);
        alert('Erreur lors de l\'enregistrement du vol.');
    }
}

async function supprimerCarnetRoute() {
    if (!idCarnetEnEdition) return;
    if (!confirm('Supprimer ce vol du carnet de route ?')) return;
    const record = listeVolsCarnetCache.find(r => r.id === idCarnetEnEdition);
    const f = record && record.fields ? record.fields : {};
    const machine = f['Machine'] || '';
    const date = f['Date'] || '';
    const horArr = f['Horamètre arrivée'];
    try {
        if (machine && date && horArr !== undefined && horArr !== null && horArr !== '') {
            await supprimerVolMaintenance(machine, date, horArr);
        }
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CARNET_ROUTE)}/${idCarnetEnEdition}`, {
            method: 'DELETE',
            headers: headers
        });
        if (response.ok) {
            fermerModaleCarnet();
            chargerCarnetRoute();
        } else {
            const err = await response.text();
            console.error(err);
            alert('Erreur lors de la suppression.');
        }
    } catch (error) {
        console.error(error);
        alert('Erreur lors de la suppression.');
    }
}

async function getAvionId(machineImmat) {
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}?filterByFormula=${encodeURIComponent(`{Immatriculation}='${machineImmat}'`)}`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        if (data.records && data.records.length > 0) return data.records[0].id;
    } catch (e) { console.error(e); }
    return null;
}

async function supprimerVolMaintenance(machineImmat, date, horametreArrivee) {
    const avionId = await getAvionId(machineImmat);
    if (!avionId) return;
    const h = parseFloat(String(horametreArrivee).replace(',', '.'));
    if (isNaN(h)) return;
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Carnet de route')}?filterByFormula=${encodeURIComponent(`{Nouvel Horamètre}=${h}`)}`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        const records = (data.records || []).filter(r => {
            const f = r.fields || {};
            const m = f['Machine'];
            const machines = Array.isArray(m) ? m : [m];
            if (!machines.includes(avionId)) return false;
            if (!f['Date du vol']) return false;
            const d = new Date(f['Date du vol']).toISOString().split('T')[0];
            return d === date;
        });
        await Promise.all(records.map(rec => fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Carnet de route')}/${rec.id}`, {
            method: 'DELETE',
            headers
        })));
    } catch (e) { console.error(e); }
}

async function synchroniserHorametreAeronef(machineImmat, carnets) {
    const avionId = await getAvionId(machineImmat);
    if (!avionId) return;
    let records = carnets;
    if (!records) {
        try {
            const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CARNET_ROUTE)}?filterByFormula=${encodeURIComponent(`{Machine}='${machineImmat}'`)}`;
            const res = await cachedFetch(url, { headers });
            const data = await res.json();
            records = data.records || [];
        } catch (e) { console.error(e); return; }
    }
    const maxH = (records || []).reduce((max, c) => {
        const f = c.fields || {};
        const h = parseFloat(String(f['Horamètre arrivée'] || '').replace(',', '.'));
        return !isNaN(h) && h > max ? h : max;
    }, 0);
    if (maxH <= 0) return;
    try {
        await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}/${avionId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { 'Horamètre actuel': maxH } })
        });
    } catch (e) { console.error(e); }
}

async function nettoyerCarnetRouteMaintenance(machineImmat) {
    const avionId = await getAvionId(machineImmat);
    if (!avionId) return;
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Carnet de route')}`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        const records = (data.records || []).filter(r => {
            const f = r.fields || {};
            const m = f['Machine'];
            const machines = Array.isArray(m) ? m : [m];
            return machines.includes(avionId);
        });
        for (const rec of records) {
            const f = rec.fields || {};
            const h = parseFloat(String(f['Nouvel Horamètre'] || '').replace(',', '.'));
            if (isNaN(h)) continue;
            const d = f['Date du vol'] ? new Date(f['Date du vol']).toISOString().split('T')[0] : null;
            const correspond = listeVolsCarnetCache.some(r => {
                const pf = r.fields || {};
                if (pf['Machine'] !== machineImmat) return false;
                if (pf['Date'] !== d) return false;
                const ph = parseFloat(String(pf['Horamètre arrivée'] || '').replace(',', '.'));
                return !isNaN(ph) && Math.abs(ph - h) < 0.001;
            });
            if (!correspond) {
                await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Carnet de route')}/${rec.id}`, {
                    method: 'DELETE',
                    headers
                });
            }
        }
    } catch (e) { console.error(e); }
}

function genererGrillesPlaneur() {
    const container = document.getElementById('carnet-planeur-container');
    if (!container) return;
    const createGrid = (items) => {
        const grid = document.createElement('div');
        grid.className = 'planeur-grid';
        items.forEach(immat => {
            const box = document.createElement('div');
            box.className = 'planeur-box';
            box.dataset.immat = immat;
            box.innerHTML = `<h3>${immat}</h3>`;
            box.addEventListener('click', () => ouvrirModaleCarnet(null, immat));
            grid.appendChild(box);
        });
        return grid;
    };
    container.innerHTML = '';
    const titrePlaneurs = document.createElement('h3');
    titrePlaneurs.className = 'planeur-section-title';
    titrePlaneurs.textContent = 'Planeurs';
    container.appendChild(titrePlaneurs);
    container.appendChild(createGrid(IMMATS_PLANEURS));
    const titreRemorques = document.createElement('h3');
    titreRemorques.className = 'planeur-section-title';
    titreRemorques.textContent = 'Remorques';
    titreRemorques.style.marginTop = '20px';
    container.appendChild(titreRemorques);
    container.appendChild(createGrid(REMOQUES_PLANEURS));
}

function initCarnetRoute() {
    const btnOuvrir = document.getElementById('btn-ouvrir-carnet');
    const btnFermer = document.querySelector('.close-modal-carnet');
    const btnDelete = document.getElementById('btn-delete-carnet');
    const modal = document.getElementById('carnet-modal');
    const form = document.getElementById('carnet-form');
    const selectFiltre = document.getElementById('carnet-machine-filtre');

    genererGrillesPlaneur();

    if (btnOuvrir) btnOuvrir.addEventListener('click', () => ouvrirModaleCarnet());
    if (btnFermer) btnFermer.addEventListener('click', fermerModaleCarnet);
    if (btnDelete) btnDelete.addEventListener('click', supprimerCarnetRoute);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) fermerModaleCarnet();
        });
    }
    if (form) form.addEventListener('submit', soumettreCarnetRoute);
    if (selectFiltre) {
        selectFiltre.addEventListener('change', (e) => {
            machineCarnetSelectionnee = e.target.value;
            chargerCarnetRoute();
        });
    }
    const champsCalculHora = ['carnet-machine', 'carnet-horametre-depart', 'carnet-heure-depart', 'carnet-heure-arrivee'];
    champsCalculHora.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', mettreAJourHorametreArrivee);
    });

    document.querySelectorAll('input[name="carnet-fonction"]').forEach(cb => {
        cb.addEventListener('change', mettreAJourNatureParFonction);
    });

    chargerCarnetRoute();
}
