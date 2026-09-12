/* ==========================================================================
   CARNET DE ROUTE - SAISIE ET CONSULTATION DES VOLS
   ========================================================================== */

// Table dédiée au carnet de route "pilote".
// La table "Carnet de route" existante est conservée pour le suivi horamètre/maintenance.
const TABLE_CARNET_ROUTE = 'Carnet de route Pilotes';

let listeVolsCarnetCache = [];
let idCarnetEnEdition = null;
let machineCarnetSelectionnee = 'F-GASB';
const IMMATS_PLANEURS = ['F-CEJX', 'F-CDYX', 'F-CITT', 'F-CEGV', 'F-CBNA', 'F-CEQJ', 'F-CDVN', 'F-CFRK', 'F-CHDT', 'F-CEQZ', 'F-CESL', 'F-CGOV'];
const REMOQUES_PLANEURS = [...IMMATS_PLANEURS.map(i => `Remorque ${i}`), 'Remorque SP98', 'Remorque 100LL'];
const MACHINES_PLANEUR_REMOQUE = [...IMMATS_PLANEURS, ...REMOQUES_PLANEURS];

function horametreVersMinutes(val) {
    const total = parseFloat(val);
    if (isNaN(total)) return null;
    const h = Math.floor(total);
    const m = Math.round((total - h) * 100);
    return h * 60 + m;
}

function formaterDureeMinutes(minutes) {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hrs).padStart(2, '0')}h${String(mins).padStart(2, '0')}`;
}

function calculerTempsDeVol(horametreDepart, horametreArrivee, heureDepart, heureArrivee, machine) {
    // F-JVIO : horamètre au format H.MM (ex. 1154.17 = 1154 h 17 min)
    if (horametreDepart && horametreArrivee && machine === 'F-JVIO') {
        const dep = horametreVersMinutes(horametreDepart);
        const arr = horametreVersMinutes(horametreArrivee);
        if (dep !== null && arr !== null && arr >= dep) {
            return formaterDureeMinutes(arr - dep);
        }
    }
    // Priorité aux horamètres si les deux sont renseignés (format décimal pour les autres machines)
    if (horametreDepart && horametreArrivee) {
        const dep = parseFloat(horametreDepart);
        const arr = parseFloat(horametreArrivee);
        if (!isNaN(dep) && !isNaN(arr) && arr >= dep) {
            const minutes = Math.round((arr - dep) * 60);
            return formaterDureeMinutes(minutes);
        }
    }
    // Sinon, calcul à partir des heures
    if (!heureDepart || !heureArrivee) return '';
    const [hD, mD] = heureDepart.split(':').map(Number);
    const [hA, mA] = heureArrivee.split(':').map(Number);
    if (isNaN(hD) || isNaN(mD) || isNaN(hA) || isNaN(mA)) return '';
    let minutes = (hA * 60 + mA) - (hD * 60 + mD);
    if (minutes < 0) minutes += 24 * 60;
    return formaterDureeMinutes(minutes);
}

function genererHeaderCarnet(isJVIO) {
    if (isJVIO) {
        return `
            <tr>
                <th rowspan="2">Date</th>
                <th colspan="2" class="sub-header">Équipage</th>
                <th rowspan="2" style="white-space: normal;">Fonction<br><small>P = Pilote<br>PCdB = PIL.+CdB<br>PAX = Passager<br>EP = Élève Pilote<br>I = Instructeur<br>ICdB = Instr.+CdB<br>EX = Examinateur...</small></th>
                <th rowspan="2" style="white-space: normal;">Nature du vol<br><small>local<br>voyage<br>REV<br>Instruction<br>VLO<br>VLD<br>Activité Particulière : (préciser laquelle)<br>autre,...</small></th>
                <th colspan="2" class="sub-header">Lieu<br><small>(LFxxxx ou OACI)</small></th>
                <th colspan="2" class="sub-header">Heures<br><small>(HH:mm en H.Loc)</small></th>
                <th colspan="2" class="sub-header">Cumul heures</th>
            </tr>
            <tr>
                <th>Nom 1</th>
                <th>Nom 2</th>
                <th>Départ</th>
                <th>Arrivée</th>
                <th>Départ</th>
                <th>Arrivée</th>
                <th>Horamètre arrivée</th>
                <th>Report</th>
            </tr>
        `;
    }
    return `
        <tr>
            <th rowspan="2">Date</th>
            <th rowspan="2">Équipage</th>
            <th rowspan="2">Fonction</th>
            <th colspan="2" class="sub-header">Lieu</th>
            <th colspan="2" class="sub-header">Heures</th>
            <th rowspan="2">Temps</th>
            <th rowspan="2">Nature</th>
            <th colspan="2" class="sub-header">Carburant</th>
            <th colspan="2" class="sub-header">Huile</th>
            <th rowspan="2">Observations</th>
            <th rowspan="2">Horamètre</th>
        </tr>
        <tr>
            <th>départ</th>
            <th>arrivée</th>
            <th>départ</th>
            <th>arrivée</th>
            <th>Départ</th>
            <th>Arr.</th>
            <th>Départ</th>
            <th>Arr.</th>
        </tr>
    `;
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
    const decAt = document.getElementById('carnet-decol-atterr');
    if (titre) titre.textContent = recordId ? 'Modifier un vol' : (machineImmat ? 'Nouvelle observation' : 'Saisir un vol');
    if (btnDelete) btnDelete.style.display = recordId ? 'inline-block' : 'none';
    if (dateInput) dateInput.value = new Date().toLocaleDateString('en-CA');
    if (departInput) departInput.value = 'LFOY';
    if (arriveeInput) arriveeInput.value = 'LFOY';

    const piloteDefaut = (typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim());
    const piloteCible = recordId ? (listeVolsCarnetCache.find(r => r.id === recordId)?.fields['Pilote'] || '') : piloteDefaut;
    await peuplerPilotesSelect(piloteCible);

    await peuplerInstructeursSelect(recordId ? (listeVolsCarnetCache.find(r => r.id === recordId)?.fields['Instructeur'] || '') : '');

    if (machineImmat) {
        form.dataset.mode = 'observation';
        if (heureDepart) heureDepart.value = '00:00';
        if (heureArrivee) heureArrivee.value = '00:00';
        if (decAt) decAt.value = '0';
        if (selectMachine && selectMachine.querySelector(`option[value="${machineImmat}"]`)) selectMachine.value = machineImmat;
        if (selectMachine) adapterFormulaireCarnet(machineImmat);
        const obs = document.getElementById('carnet-observations');
        setTimeout(() => { if (obs) obs.focus(); }, 50);
    } else {
        form.dataset.mode = 'vol';
        if (selectMachine && selectFiltre && selectMachine.querySelector(`option[value="${selectFiltre.value}"]`)) {
            selectMachine.value = selectFiltre.value;
        }
        if (selectMachine) adapterFormulaireCarnet(selectMachine.value);
    }
    document.getElementById('carnet-id').value = recordId || '';
    if (recordId) {
        const record = listeVolsCarnetCache.find(r => r.id === recordId);
        if (record && record.fields) remplirFormulaireCarnet(record.fields);
    } else if (selectMachine && form.dataset.mode !== 'observation') {
        mettreAJourDonneesDepartDefaut(selectMachine.value);
    }
    const sidebar = document.querySelector('.sidebar');
    const sidebarWidth = sidebar ? sidebar.getBoundingClientRect().width : 170;
    modal.style.setProperty('--carnet-modal-left', `${sidebarWidth}px`);
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
    const machine = f['Machine'] || 'F-GASB';
    document.getElementById('carnet-machine').value = machine;
    adapterFormulaireCarnet(machine);
    const piloteInput = document.getElementById('carnet-pilote');
    if (piloteInput) piloteInput.value = pilote;
    const instSel = document.getElementById('carnet-instructeur');
    if (instSel) instSel.value = f['Instructeur'] || '';
    document.getElementById('carnet-depart').value = f['Départ'] || 'LFOY';
    document.getElementById('carnet-arrivee').value = f['Arrivée'] || 'LFOY';
    document.getElementById('carnet-heure-depart').value = f['Heure départ'] || '';
    document.getElementById('carnet-heure-arrivee').value = f['Heure arrivée'] || '';
    const nature = document.getElementById('carnet-nature');
    if (nature) nature.value = f['Nature'] || 'Autre';
    if (machine !== 'F-JVIO') {
        document.getElementById('carnet-carburant-depart').value = f['Carburant départ'] || '';
        document.getElementById('carnet-carburant-arrivee').value = f['Carburant arrivée'] || '';
        document.getElementById('carnet-huile-depart').value = f['Huile départ'] || '';
        document.getElementById('carnet-huile-arrivee').value = f['Huile arrivée'] || '';
    }
    document.getElementById('carnet-horametre-depart').value = f['Horamètre départ'] || '';
    document.getElementById('carnet-horametre-arrivee').value = f['Horamètre arrivée'] || '';
    document.getElementById('carnet-observations').value = f['Observations'] || '';
    const decAt = document.getElementById('carnet-decol-atterr');
    if (decAt) decAt.value = (f['Décollages'] === 0 || f['Décollages']) ? f['Décollages'] : '1';
    const fonctions = (f['Fonction'] || '').split('/').map(x => x.trim());
    document.querySelectorAll('input[name="carnet-fonction"]').forEach(cb => {
        cb.checked = fonctions.includes(cb.value);
    });
    const inputHArrivee = document.getElementById('carnet-horametre-arrivee');
    if (inputHArrivee && !inputHArrivee.value) mettreAJourHorametreArrivee();
}

let carnetInstructeursCache = [];
let carnetPilotesCache = [];

async function peuplerPilotesSelect(pilote = '') {
    const sel = document.getElementById('carnet-pilote');
    if (!sel) return;
    const defaut = pilote || (typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim());
    const ROLES_INSTRUCTEUR = ['Instructeur avion', 'Instructeur planeur', 'Instructeur ULM'];
    const peutChoisir = currentUser && Array.isArray(currentUser.roles) && (
        currentUser.roles.includes('Super admin') ||
        currentUser.roles.some(r => ROLES_INSTRUCTEUR.includes(r))
    );
    try {
        if (peutChoisir && !carnetPilotesCache.length) {
            const table = typeof TABLE_UTILISATEURS !== 'undefined' ? TABLE_UTILISATEURS : 'Utilisateurs';
            const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?sort[0][field]=Nom&sort[0][direction]=asc&pageSize=100`, { headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message);
            carnetPilotesCache = (data.records || []).map(r => {
                const f = r.fields || {};
                return `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
            }).filter(Boolean);
        }
        const noms = peutChoisir ? [...carnetPilotesCache] : [];
        if (defaut && !noms.some(n => normaliserNom(n) === normaliserNom(defaut))) noms.push(defaut);
        sel.innerHTML = '';
        noms.forEach(nom => {
            const opt = document.createElement('option');
            opt.value = nom;
            opt.textContent = nom;
            sel.appendChild(opt);
        });
        sel.disabled = !peutChoisir;
        if (defaut) sel.value = defaut;
    } catch (err) {
        console.error('Erreur chargement pilotes:', err);
        sel.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = defaut;
        opt.textContent = defaut;
        sel.appendChild(opt);
        sel.disabled = !peutChoisir;
        sel.value = defaut;
    }
}

async function peuplerInstructeursSelect(instructeur = '') {
    const sel = document.getElementById('carnet-instructeur');
    if (!sel) return;
    const ROLES_INSTRUCTEUR = ['Instructeur avion', 'Instructeur planeur', 'Instructeur ULM'];
    try {
        if (!carnetInstructeursCache.length) {
            const table = typeof TABLE_UTILISATEURS !== 'undefined' ? TABLE_UTILISATEURS : 'Utilisateurs';
            const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?sort[0][field]=Nom&sort[0][direction]=asc&pageSize=100`, { headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message);
            carnetInstructeursCache = (data.records || []).filter(r => {
                const roles = Array.isArray(r.fields?.['Rôles']) ? r.fields['Rôles'] : [r.fields?.['Rôles']].filter(Boolean);
                return roles.some(role => ROLES_INSTRUCTEUR.includes(role));
            });
        }
        const noneOption = sel.querySelector('option[value=""]');
        sel.innerHTML = noneOption ? noneOption.outerHTML : '<option value="">-- Aucun --</option>';
        carnetInstructeursCache.forEach(r => {
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
    if (checked.includes('FE') || checked.includes('EX')) {
        if (select.querySelector('option[value="Examen"]')) select.value = 'Examen';
    } else if (checked.includes('FI') || checked.includes('I')) {
        if (select.querySelector('option[value="Instruction"]')) select.value = 'Instruction';
    }
}

const CARNET_JVIO_FONCTIONS = [
    { value: 'P', label: 'P = Pilote' },
    { value: 'PCdB', label: 'PCdB = PIL.+CdB' },
    { value: 'PAX', label: 'PAX = Passager' },
    { value: 'EP', label: 'EP = Élève pilote' },
    { value: 'I', label: 'I = Instructeur' },
    { value: 'ICdB', label: 'ICdB = Instr.+CdB' },
    { value: 'EX', label: 'EX = Examinateur' }
];

const CARNET_STD_FONCTIONS = [
    { value: 'P', label: 'P - Pilote' },
    { value: 'EP', label: 'EP - Élève pilote' },
    { value: 'FI', label: 'FI - Instructeur' },
    { value: 'FE', label: 'FE - Examinateur' }
];

const CARNET_JVIO_NATURES = ['Autre', 'local', 'voyage', 'REV', 'Instruction', 'VLO', 'VLD', 'Activité Particulière'];
const CARNET_STD_NATURES = ['Autre', 'Instruction', 'Examen'];

function adapterFormulaireCarnet(machine) {
    const isJVIO = machine === 'F-JVIO';
    const piloteLabel = document.getElementById('carnet-pilote-label');
    const instLabel = document.getElementById('carnet-instructeur-label');
    const hDepLabel = document.getElementById('carnet-heure-depart-label');
    const hArrLabel = document.getElementById('carnet-heure-arrivee-label');
    const fonctionGroup = document.getElementById('carnet-fonction-group');
    const fonctionLabel = document.getElementById('carnet-fonction-label');
    const nature = document.getElementById('carnet-nature');
    const carbuRow = document.getElementById('carnet-carburant-row');
    const huileRow = document.getElementById('carnet-huile-row');
    const instSel = document.getElementById('carnet-instructeur');

    if (piloteLabel) piloteLabel.textContent = isJVIO ? 'Équipage 1 :' : 'Pilote :';
    if (instLabel) instLabel.textContent = isJVIO ? 'Équipage 2 :' : 'Instructeur (si instruction) :';
    if (hDepLabel) hDepLabel.textContent = isJVIO ? 'Heure de départ (H.Loc) :' : 'Heure de départ (UTC) :';
    if (hArrLabel) hArrLabel.textContent = isJVIO ? 'Heure d\'arrivée (H.Loc) :' : 'Heure d\'arrivée (UTC) :';
    if (fonctionLabel) fonctionLabel.textContent = 'Fonction(s) à bord :';
    if (instSel) instSel.dataset.allowCustom = isJVIO ? '1' : '0';

    if (nature) {
        const options = isJVIO ? CARNET_JVIO_NATURES : CARNET_STD_NATURES;
        nature.innerHTML = options.map(v => `<option value="${v}">${v}</option>`).join('');
    }

    if (fonctionGroup) {
        const fonctions = isJVIO ? CARNET_JVIO_FONCTIONS : CARNET_STD_FONCTIONS;
        fonctionGroup.innerHTML = fonctions.map(f =>
            `<label class="checkbox-option"><input type="checkbox" name="carnet-fonction" value="${f.value}"> ${f.label}</label>`
        ).join('');
        fonctionGroup.querySelectorAll('input[name="carnet-fonction"]').forEach(cb => {
            cb.addEventListener('change', mettreAJourNatureParFonction);
        });
    }

    if (carbuRow) carbuRow.style.display = isJVIO ? 'none' : '';
    if (huileRow) huileRow.style.display = isJVIO ? 'none' : '';

    if (isJVIO) {
        ['carnet-carburant-depart', 'carnet-carburant-arrivee', 'carnet-huile-depart', 'carnet-huile-arrivee'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }
}

function afficherCarnet(records) {
    const tbody = document.getElementById('carnet-body');
    if (!tbody) return;
    const isJVIO = machineCarnetSelectionnee === 'F-JVIO';
    const table = tbody.closest('table');
    const thead = table ? table.querySelector('thead') : null;
    if (table) table.style.minWidth = isJVIO ? '950px' : '1100px';
    if (thead) thead.innerHTML = genererHeaderCarnet(isJVIO);
    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isJVIO ? 11 : 15}" class="carnet-empty">Aucun vol enregistré dans le carnet de route.</td></tr>`;
        return;
    }
    tbody.innerHTML = '';
    records.forEach(record => {
        const f = record.fields || {};
        const temps = machineCarnetSelectionnee === 'F-JVIO' || !f['Temps de vol']
            ? calculerTempsDeVol(f['Horamètre départ'], f['Horamètre arrivée'], f['Heure départ'], f['Heure arrivée'], machineCarnetSelectionnee)
            : f['Temps de vol'];
        const dateObj = f['Date'] ? new Date(f['Date']) : null;
        const dateStr = dateObj ? dateObj.toLocaleDateString('fr-FR') : '-';

        const tr = document.createElement('tr');
        tr.dataset.id = record.id;
        if (isJVIO) {
            tr.innerHTML = `
                <td>${dateStr}</td>
                <td>${f['Pilote'] || '-'}</td>
                <td>${f['Instructeur'] || '-'}</td>
                <td>${f['Fonction'] || '-'}</td>
                <td>${f['Nature'] || '-'}</td>
                <td>${f['Départ'] || '-'}</td>
                <td>${f['Arrivée'] || '-'}</td>
                <td>${f['Heure départ'] || ''}</td>
                <td>${f['Heure arrivée'] || ''}</td>
                <td>${formaterNombre(f['Horamètre arrivée']) || '-'}</td>
                <td>${temps || '-'}</td>
            `;
        } else {
            const equipage = [f['Pilote'], f['Instructeur']].filter(Boolean).join(' / ') || '-';
            const carburant = [formaterNombre(f['Carburant départ']), formaterNombre(f['Carburant arrivée'])].filter(v => v !== '').join(' / ') || '-';
            const huile = [formaterNombre(f['Huile départ']), formaterNombre(f['Huile arrivée'])].filter(v => v !== '').join(' / ') || '-';
            const horametre = [formaterNombre(f['Horamètre départ']), formaterNombre(f['Horamètre arrivée'])].filter(v => v !== '').join(' / ') || '-';
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
        }
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
    const btnDocs = document.getElementById('btn-documents-carnet');
    const recapDocs = document.getElementById('documents-carnet-recap');
    const alarme = document.getElementById('carnet-observation-alarme');
    const isJVIO = machineCarnetSelectionnee === 'F-JVIO';
    const colspan = isJVIO ? 11 : 15;

    if (machineCarnetSelectionnee === 'PLANEUR') {
        if (tableContainer) tableContainer.style.display = 'none';
        if (planeurContainer) planeurContainer.style.display = 'block';
        if (btnOuvrir) btnOuvrir.style.display = 'none';
        if (btnDocs) btnDocs.style.display = 'none';
        if (recapDocs) recapDocs.style.display = 'none';
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
    const peutGererDocs = (typeof peutGererDocumentsAeronef === 'function' && peutGererDocumentsAeronef());
    if (btnDocs) btnDocs.style.display = peutGererDocs ? 'inline-block' : 'none';
    if (alarme) alarme.style.display = 'none';
    const table = tbody ? tbody.closest('table') : null;
    const thead = table ? table.querySelector('thead') : null;
    if (table) table.style.minWidth = isJVIO ? '950px' : '1100px';
    if (thead) thead.innerHTML = genererHeaderCarnet(isJVIO);
    if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="carnet-empty">Chargement du carnet de route...</td></tr>`;
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
            if (typeof chargerDocumentsAeronef === 'function' && typeof afficherRecapDocumentsAeronef === 'function') {
                await chargerDocumentsAeronef(machineCarnetSelectionnee);
                afficherRecapDocumentsAeronef(machineCarnetSelectionnee, 'documents-carnet-list', 'documents-carnet-recap');
            }
        } else {
            console.error(data);
            if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="carnet-empty">Erreur lors du chargement du carnet.</td></tr>`;
        }
    } catch (error) {
        console.error(error);
        if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="carnet-empty">Erreur lors du chargement du carnet.</td></tr>`;
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
    const decAt = parseInt(document.getElementById('carnet-decol-atterr').value, 10) || 0;
    const decollages = decAt;
    const atterrissages = decAt;
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

    const temps = calculerTempsDeVol(horametreDepart, horametreArrivee, heureDepart, heureArrivee, machine);
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

function formaterImmatPlaneur(immat) {
    const parts = (immat || '').split(/\s(.+)/);
    if (parts.length < 2) return escHtml(immat);
    return `${escHtml(parts[0])} <span style="white-space:nowrap;">${escHtml(parts[1])}</span>`;
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
            box.innerHTML = `
                <h3>${formaterImmatPlaneur(immat)}</h3>
                <button type="button" class="btn-doc-planeur" title="Consulter les documents">Docs</button>
            `;
            box.addEventListener('click', () => ouvrirModaleCarnet(null, immat));
            const btnDoc = box.querySelector('.btn-doc-planeur');
            if (btnDoc) {
                btnDoc.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (typeof ouvrirModaleDocumentsAeronef === 'function') ouvrirModaleDocumentsAeronef(immat);
                });
            }
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
    const btnDocs = document.getElementById('btn-documents-carnet');
    if (btnDocs) btnDocs.addEventListener('click', () => {
        if (typeof ouvrirModaleDocumentsAeronef === 'function') ouvrirModaleDocumentsAeronef(machineCarnetSelectionnee);
    });
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

    const selectMachine = document.getElementById('carnet-machine');
    if (selectMachine) {
        selectMachine.addEventListener('change', () => adapterFormulaireCarnet(selectMachine.value));
        adapterFormulaireCarnet(selectMachine.value);
    }

    chargerCarnetRoute();
}
