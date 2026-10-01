/* ==========================================================================
   CARNET DE VOL PILOTE
   Carnet de vol par pilote :
   - vols du club : derives a la volee des carnets de route machines
     (Carnet de route Pilotes + Carnet de route) — aucune donnee dupliquee,
     donc jamais de desynchronisation ni de doublon
   - vols exterieurs : saisies manuelles du pilote dans la table
     "Carnet de vol" (champs volontairement alignes sur ceux du carnet
     de route pour alimenter les calculs d'experience recente)
   ========================================================================== */

const TABLE_CARNET_VOL = 'Carnet de vol';
const TABLES_CARNETS_CLUB = ['Carnet de route Pilotes', 'Carnet de route'];

let cvPiloteCible = null;          // {id, prenom, nom}
let cvMembresCache = null;
let cvAeronefsMap = null;          // immat -> {modele, type}
let cvLignesManuelles = [];        // records bruts "Carnet de vol" du pilote affiche
let cvSelectPilotePret = false;

function cvPeutVoirAutres() {
    if (!currentUser) return false;
    const roles = currentUser.roles || [];
    return roles.includes('Super admin') || roles.includes('Instructeur avion') || roles.includes('Instructeur ULM');
}

function cvEstProprePilote(pilote) {
    if (!currentUser || !pilote) return false;
    return normaliserNom(`${pilote.prenom || ''} ${pilote.nom || ''}`) === normaliserNom(`${currentUser.prenom || ''} ${currentUser.nom || ''}`);
}

function cvPeutEditer(pilote) {
    return cvEstProprePilote(pilote) || (currentUser && (currentUser.roles || []).includes('Super admin'));
}

// --- DUREES / FORMATS ------------------------------------------------------

function cvParseDureeTexte(texte) {
    const t = (texte || '').toString().trim().toLowerCase();
    if (!t) return 0;
    let m = t.match(/^(\d+)\s*h\s*(\d{1,2})?$/);          // 1h30 / 1h
    if (m) return parseInt(m[1], 10) * 60 + (parseInt(m[2] || '0', 10));
    m = t.match(/^(\d{1,2}):(\d{2})$/);                   // 1:30
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    m = t.match(/^(\d+)(?:[.,](\d+))?$/);                 // 1.5 (heures decimales)
    if (m) return Math.round(parseFloat(m[0].replace(',', '.')) * 60);
    return 0;
}

function cvDureeAutoMinutes(f, machine) {
    // Priorite horametre (F-JVIO : format H.MM)
    const hD = f['Horamètre départ'], hA = f['Horamètre arrivée'];
    if (hD !== undefined && hD !== null && hD !== '' && hA !== undefined && hA !== null && hA !== '') {
        if (machine === 'F-JVIO') {
            const d = typeof horametreVersMinutes === 'function' ? horametreVersMinutes(hD) : null;
            const a = typeof horametreVersMinutes === 'function' ? horametreVersMinutes(hA) : null;
            if (d !== null && a !== null && a >= d) return a - d;
        } else {
            const d = parseFloat(String(hD).replace(',', '.'));
            const a = parseFloat(String(hA).replace(',', '.'));
            if (!isNaN(d) && !isNaN(a) && a >= d) return Math.round((a - d) * 60);
        }
    }
    if (!f['Heure départ'] || !f['Heure arrivée']) return 0;
    const [hd, md] = String(f['Heure départ']).split(':').map(Number);
    const [ha, ma] = String(f['Heure arrivée']).split(':').map(Number);
    if ([hd, md, ha, ma].some(isNaN)) return 0;
    let mins = (ha * 60 + ma) - (hd * 60 + md);
    if (mins < 0) mins += 24 * 60;
    return mins;
}

function cvFormaterMinutes(mins) {
    mins = Math.round(mins || 0);
    if (!mins) return '—';
    if (typeof formaterDureeMinutes === 'function') return formaterDureeMinutes(mins);
    return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
}

// --- DERIVATION D'UN VOL CLUB (carnet de route) -----------------------------
// Regles :
// - vol d'instruction (fonction EP/EX/FE ou nature Instruction/Examen)
//   => l'instructeur est commandant de bord
// - atterrissages jour/nuit et temps de nuit selon la nature du vol
// - temps "pilote en fonction" : P/PCdB => CdB, EP/EX/FE => double commande,
//   I/ICdB/FI => instructeur, PAX => passager (pas de temps comptable)
function cvDeriveVolClub(r, piloteNomComplet) {
    const f = r.fields || {};
    const machine = (f['Machine'] || '').toString().trim();
    const nature = (f['Nature'] || '').toString();
    const fonctions = (f['Fonction'] || '').split('/').map(s => s.trim().toUpperCase()).filter(Boolean);
    const pilote = (f['Pilote'] || piloteNomComplet || '').toString();
    const instructeur = (f['Instructeur'] || '').toString().trim();
    const duree = cvDureeAutoMinutes(f, machine);
    const att = parseInt(f['Atterrissages'], 10) || 1;
    const estNuit = /nuit/i.test(nature);

    const estInstruction = /instruction|examen/i.test(nature) ||
        fonctions.some(x => ['EP', 'EX', 'FE'].includes(x));
    const cdb = estInstruction ? (instructeur || pilote) : pilote;

    let cdbMin = 0, dcMin = 0, instrMin = 0;
    if (fonctions.some(x => ['I', 'ICDB', 'FI'].includes(x))) instrMin = duree;
    else if (fonctions.some(x => ['EP', 'EX', 'FE'].includes(x))) dcMin = duree;
    else if (fonctions.some(x => x === 'PAX')) { /* passager : rien */ }
    else cdbMin = duree;

    const aero = (cvAeronefsMap || {})[machine.toUpperCase()] || {};
    const mono = f['Monomoteur'] !== undefined
        ? !!f['Monomoteur']
        : (aero.type ? aero.type.toLowerCase() === 'avion' : null);

    return {
        origine: 'club',
        dureeMin: duree,
        obs: f['Observations'] || '',
        recId: r.id,
        date: f['Date'] || '',
        lieuDep: f['Départ'] || '', hDep: f['Heure départ'] || '',
        lieuArr: f['Arrivée'] || '', hArr: f['Heure arrivée'] || '',
        modele: aero.modele || '',
        immat: machine,
        mono,
        cdb,
        attJour: estNuit ? 0 : att,
        attNuit: estNuit ? att : 0,
        nuitMin: estNuit ? duree : 0,
        cdbMin, dcMin, instrMin
    };
}

function cvDeriveVolManuel(r) {
    const f = r.fields || {};
    let dureeMin = 0;
    if (f['Heure départ'] && f['Heure arrivée']) {
        const [hd, md] = String(f['Heure départ']).split(':').map(Number);
        const [ha, ma] = String(f['Heure arrivée']).split(':').map(Number);
        if (![hd, md, ha, ma].some(isNaN)) {
            dureeMin = (ha * 60 + ma) - (hd * 60 + md);
            if (dureeMin < 0) dureeMin += 24 * 60;
        }
    }
    if (!dureeMin) dureeMin = cvParseDureeTexte(f['Temps de vol']);
    return {
        origine: 'manuel',
        recId: r.id,
        dureeMin,
        obs: f['Observations'] || '',
        date: f['Date'] || '',
        lieuDep: f['Départ'] || f['Lieu départ'] || '',
        hDep: f['Heure départ'] || '',
        lieuArr: f['Arrivée'] || f['Lieu arrivée'] || '',
        hArr: f['Heure arrivée'] || '',
        modele: f['Modèle'] || '',
        immat: (f['Immatriculation'] || '').toString(),
        mono: !!f['Monomoteur'],
        cdb: f['Commandant de bord'] || '',
        attJour: parseInt(f['Atterrissages jour'], 10) || 0,
        attNuit: parseInt(f['Atterrissages nuit'], 10) || 0,
        nuitMin: parseInt(f['Temps nuit'], 10) || parseFloat(f['Temps nuit']) || 0,
        cdbMin: parseInt(f['Temps CdB'], 10) || 0,
        dcMin: parseInt(f['Temps DC'], 10) || 0,
        instrMin: parseInt(f['Temps instructeur'], 10) || 0
    };
}

// --- CHARGEMENT ------------------------------------------------------------

async function cvChargerAeronefs() {
    if (cvAeronefsMap) return;
    cvAeronefsMap = {};
    try {
        const records = await fetchTousRecords(`${API_BASE}/${encodeURIComponent('Aéronefs')}?pageSize=100`, { headers });
        records.forEach(r => {
            const f = r.fields || {};
            const immat = (f['Immatriculation'] || f['Nom'] || '').toString().trim().toUpperCase();
            if (immat) cvAeronefsMap[immat] = { modele: f['Modèle'] || '', type: (f['Type'] || '').toString() };
        });
    } catch (err) {
        console.error('Erreur chargement aéronefs (carnet de vol):', err);
    }
}

async function cvChargerMembres() {
    if (cvMembresCache) return cvMembresCache;
    const records = await fetchTousRecords(`${API_BASE}/${encodeURIComponent('Utilisateurs')}?pageSize=100`, { headers });
    cvMembresCache = records
        .map(r => ({ id: r.id, prenom: (r.fields || {})['Prénom'] || '', nom: (r.fields || {})['Nom'] || '' }))
        .filter(m => (m.prenom || m.nom))
        .sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom, 'fr'));
    return cvMembresCache;
}

async function cvPeuplerSelectPilotes() {
    const select = document.getElementById('carnet-vol-pilote-select');
    const label = document.getElementById('carnet-vol-pilote-label');
    if (!select) return;
    const membres = await cvChargerMembres();
    select.innerHTML = membres.map(m =>
        `<option value="${m.id}">${m.prenom} ${m.nom}</option>`).join('');
    if (!cvSelectPilotePret) {
        select.addEventListener('change', () => {
            const m = membres.find(x => x.id === select.value);
            if (m) { cvPiloteCible = m; chargerCarnetVol(); }
        });
        cvSelectPilotePret = true;
    }
    select.style.display = '';
    if (label) label.style.display = '';
    // Selection courante : pilote cible sinon soi-meme
    const cible = cvPiloteCible || { id: currentUser.id, prenom: currentUser.prenom, nom: currentUser.nom };
    cvPiloteCible = membres.find(m => m.id === cible.id) ||
        membres.find(m => normaliserNom(`${m.prenom} ${m.nom}`) === normaliserNom(`${currentUser.prenom || ''} ${currentUser.nom || ''}`)) ||
        cible;
    select.value = cvPiloteCible.id || '';
}

async function cvChargerVolsClub(pilote) {
    const pre = (pilote.prenom || '').replace(/"/g, '\\"');
    const nom = (pilote.nom || '').replace(/"/g, '\\"');
    const formula = `AND({Pilote} != '', FIND(UPPER("${pre}"), UPPER({Pilote})) > 0, FIND(UPPER("${nom}"), UPPER({Pilote})) > 0)`;
    const tous = [];
    for (const table of TABLES_CARNETS_CLUB) {
        try {
            const url = `${API_BASE}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;
            tous.push(...await fetchTousRecords(url, { headers }));
        } catch (err) {
            console.error(`Erreur lecture ${table}:`, err);
        }
    }
    return tous;
}

async function cvChargerVolsManuels(pilote) {
    const pre = (pilote.prenom || '').replace(/"/g, '\\"');
    const nom = (pilote.nom || '').replace(/"/g, '\\"');
    const formula = `AND({Pilote} != '', FIND(UPPER("${pre}"), UPPER({Pilote})) > 0, FIND(UPPER("${nom}"), UPPER({Pilote})) > 0)`;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_CARNET_VOL)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;
    return await fetchTousRecords(url, { headers });
}

// --- RENDU ------------------------------------------------------------------

function cvEscape(s) {
    return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cvFormaterDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return cvEscape(dateStr);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function chargerCarnetVol() {
    const body = document.getElementById('carnet-vol-body');
    if (!body || !currentUser) return;
    const nomEl = document.getElementById('carnet-vol-pilote-nom');
    const btnAdd = document.getElementById('btn-ajouter-vol-manuel');

    body.innerHTML = '<tr><td colspan="15" class="carnet-empty">Chargement du carnet de vol...</td></tr>';

    if (cvPeutVoirAutres()) {
        await cvPeuplerSelectPilotes();
    } else {
        cvPiloteCible = { id: currentUser.id, prenom: currentUser.prenom, nom: currentUser.nom };
    }

    const nomComplet = `${cvPiloteCible.prenom || ''} ${cvPiloteCible.nom || ''}`.trim();
    if (nomEl) nomEl.textContent = nomComplet;
    if (btnAdd) btnAdd.style.display = cvPeutEditer(cvPiloteCible) ? '' : 'none';

    try {
        await cvChargerAeronefs();
        const [volsClub, volsManuels] = await Promise.all([
            cvChargerVolsClub(cvPiloteCible),
            cvChargerVolsManuels(cvPiloteCible).catch(err => { console.error('Erreur carnet de vol manuel:', err); return []; })
        ]);
        cvLignesManuelles = volsManuels;

        const lignes = volsClub
            // Seuls les vols sur une machine referencee dans "Aeronefs"
            // comptent : le carnet de route contient aussi des lignes
            // planeurs / remorques / engins au sol (tracteur tondeuse...)
            .filter(r => {
                const immat = ((r.fields || {})['Machine'] || '').toString().trim().toUpperCase();
                return !!(cvAeronefsMap || {})[immat];
            })
            .map(r => cvDeriveVolClub(r, nomComplet))
            .concat(volsManuels.map(cvDeriveVolManuel))
            .filter(l => l.date)
            .sort((a, b) => {
                const d = (b.date || '').localeCompare(a.date || '');
                if (d) return d;
                return (b.hDep || '').localeCompare(a.hDep || '');
            });

        if (!lignes.length) {
            body.innerHTML = `<tr><td colspan="15" class="carnet-empty">Aucun vol dans le carnet de ${cvEscape(nomComplet)}.</td></tr>`;
            return;
        }

        const editable = cvPeutEditer(cvPiloteCible);
        body.innerHTML = lignes.map(l => {
            const hdvMono = l.mono ? cvFormaterMinutes(l.dureeMin) : '—';
            const badge = l.origine === 'manuel'
                ? '<span class="cv-badge cv-badge-manuel">Manuel</span>'
                : '<span class="cv-badge cv-badge-club">Club</span>';
            const obsIcon = l.obs ? ` <span class="cv-obs" title="${cvEscape(l.obs)}">📝</span>` : '';
            const actions = (l.origine === 'manuel' && editable)
                ? ` <button type="button" class="cv-btn-edit" data-id="${l.recId}" title="Modifier">✏️</button>
                    <button type="button" class="cv-btn-del" data-id="${l.recId}" title="Supprimer">🗑️</button>`
                : '';
            return `<tr class="${l.origine === 'manuel' ? 'cv-ligne-manuelle' : ''}">
                <td>${cvFormaterDate(l.date)}</td>
                <td>${cvEscape(l.lieuDep)}</td>
                <td>${cvEscape(l.hDep)}</td>
                <td>${cvEscape(l.lieuArr)}</td>
                <td>${cvEscape(l.hArr)}</td>
                <td>${cvEscape(l.modele)}</td>
                <td>${cvEscape(l.immat)}</td>
                <td>${hdvMono}</td>
                <td>${cvEscape(l.cdb)}</td>
                <td>${l.attJour || '—'}</td>
                <td>${l.attNuit || '—'}</td>
                <td>${cvFormaterMinutes(l.nuitMin)}</td>
                <td>${cvFormaterMinutes(l.cdbMin)}</td>
                <td>${cvFormaterMinutes(l.dcMin)}</td>
                <td>${cvFormaterMinutes(l.instrMin)}</td>
                <td class="cv-origine">${badge}${obsIcon}${actions}</td>
            </tr>`;
        }).join('');

        // Totaux
        const t = lignes.reduce((acc, l) => {
            acc.attJ += l.attJour; acc.attN += l.attNuit; acc.nuit += l.nuitMin;
            acc.cdb += l.cdbMin; acc.dc += l.dcMin; acc.instr += l.instrMin;
            if (l.mono) acc.mono += l.dureeMin;
            return acc;
        }, { attJ: 0, attN: 0, nuit: 0, cdb: 0, dc: 0, instr: 0, mono: 0 });
        body.innerHTML += `<tr class="cv-totaux">
            <td colspan="7"><strong>Total — ${lignes.length} vol(s)</strong></td>
            <td><strong>${cvFormaterMinutes(t.mono)}</strong></td>
            <td></td>
            <td><strong>${t.attJ}</strong></td><td><strong>${t.attN}</strong></td>
            <td><strong>${cvFormaterMinutes(t.nuit)}</strong></td>
            <td><strong>${cvFormaterMinutes(t.cdb)}</strong></td>
            <td><strong>${cvFormaterMinutes(t.dc)}</strong></td>
            <td><strong>${cvFormaterMinutes(t.instr)}</strong></td>
            <td></td>
        </tr>`;

        body.querySelectorAll('.cv-btn-edit').forEach(b => b.addEventListener('click', () => cvOuvrirModalEdition(b.dataset.id)));
        body.querySelectorAll('.cv-btn-del').forEach(b => b.addEventListener('click', () => cvSupprimerVol(b.dataset.id)));
    } catch (err) {
        console.error('Erreur chargement carnet de vol:', err);
        body.innerHTML = '<tr><td colspan="15" class="carnet-empty">Erreur de chargement du carnet de vol.</td></tr>';
    }
}

// --- SAISIE MANUELLE ---------------------------------------------------------

function cvViderModal() {
    document.getElementById('cv-vol-id').value = '';
    document.getElementById('cv-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('cv-modele').value = '';
    document.getElementById('cv-immat').value = '';
    document.getElementById('cv-monomoteur').checked = true;
    document.getElementById('cv-lieu-depart').value = '';
    document.getElementById('cv-heure-depart').value = '';
    document.getElementById('cv-lieu-arrivee').value = '';
    document.getElementById('cv-heure-arrivee').value = '';
    document.getElementById('cv-fonction').value = 'CdB';
    document.getElementById('cv-cdb').value = `${cvPiloteCible.prenom || ''} ${cvPiloteCible.nom || ''}`.trim();
    document.getElementById('cv-decollages').value = 1;
    document.getElementById('cv-att-jour').value = 1;
    document.getElementById('cv-att-nuit').value = 0;
    document.getElementById('cv-temps-nuit').value = '';
    document.getElementById('cv-observations').value = '';
    document.getElementById('carnet-vol-modal-title').textContent = 'Ajouter un vol extérieur';
}

function cvOuvrirModalEdition(recId) {
    const rec = cvLignesManuelles.find(r => r.id === recId);
    if (!rec) return;
    const f = rec.fields || {};
    document.getElementById('cv-vol-id').value = recId;
    document.getElementById('cv-date').value = (f['Date'] || '').slice(0, 10);
    document.getElementById('cv-modele').value = f['Modèle'] || '';
    document.getElementById('cv-immat').value = f['Immatriculation'] || '';
    document.getElementById('cv-monomoteur').checked = !!f['Monomoteur'];
    document.getElementById('cv-lieu-depart').value = f['Départ'] || f['Lieu départ'] || '';
    document.getElementById('cv-heure-depart').value = f['Heure départ'] || '';
    document.getElementById('cv-lieu-arrivee').value = f['Arrivée'] || f['Lieu arrivée'] || '';
    document.getElementById('cv-heure-arrivee').value = f['Heure arrivée'] || '';
    const fonction = (parseInt(f['Temps DC'], 10) || 0) > 0 ? 'DC' : ((parseInt(f['Temps instructeur'], 10) || 0) > 0 ? 'Instr' : 'CdB');
    document.getElementById('cv-fonction').value = fonction;
    document.getElementById('cv-cdb').value = f['Commandant de bord'] || '';
    document.getElementById('cv-decollages').value = parseInt(f['Décollages'], 10) || 0;
    document.getElementById('cv-att-jour').value = parseInt(f['Atterrissages jour'], 10) || 0;
    document.getElementById('cv-att-nuit').value = parseInt(f['Atterrissages nuit'], 10) || 0;
    const nuitMin = parseInt(f['Temps nuit'], 10) || 0;
    document.getElementById('cv-temps-nuit').value = nuitMin ? cvFormaterMinutes(nuitMin) : '';
    document.getElementById('cv-observations').value = f['Observations'] || '';
    document.getElementById('carnet-vol-modal-title').textContent = 'Modifier un vol extérieur';
    document.getElementById('carnet-vol-modal').style.display = 'flex';
}

async function cvSupprimerVol(recId) {
    if (!confirm('Supprimer ce vol de votre carnet ?')) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_CARNET_VOL)}/${recId}`, {
            method: 'DELETE', headers
        });
        if (!res.ok) throw new Error(await res.text());
        chargerCarnetVol();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la suppression du vol.');
    }
}

function initCarnetVol() {
    const modal = document.getElementById('carnet-vol-modal');
    const form = document.getElementById('carnet-vol-form');
    const btnAdd = document.getElementById('btn-ajouter-vol-manuel');
    const closeBtn = document.getElementById('close-carnet-vol');
    if (!modal || !form) return;

    if (closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

    if (btnAdd) btnAdd.addEventListener('click', () => {
        cvViderModal();
        modal.style.display = 'flex';
    });

    // Fonction DC : le CdB est l'instructeur -> placeholder explicite
    const selFonction = document.getElementById('cv-fonction');
    if (selFonction) selFonction.addEventListener('change', () => {
        const cdb = document.getElementById('cv-cdb');
        if (selFonction.value === 'DC') {
            cdb.placeholder = "Nom de l'instructeur (CdB)";
            const moi = `${cvPiloteCible.prenom || ''} ${cvPiloteCible.nom || ''}`.trim();
            if (normaliserNom(cdb.value) === normaliserNom(moi)) cdb.value = '';
        } else {
            cdb.placeholder = 'Nom du CdB';
            if (!cdb.value.trim()) cdb.value = `${cvPiloteCible.prenom || ''} ${cvPiloteCible.nom || ''}`.trim();
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const recId = document.getElementById('cv-vol-id').value;
        const hD = document.getElementById('cv-heure-depart').value;
        const hA = document.getElementById('cv-heure-arrivee').value;
        const [hd, md] = hD.split(':').map(Number);
        const [ha, ma] = hA.split(':').map(Number);
        let duree = (ha * 60 + ma) - (hd * 60 + md);
        if (duree < 0) duree += 24 * 60;

        const fonction = document.getElementById('cv-fonction').value;
        const attJ = parseInt(document.getElementById('cv-att-jour').value, 10) || 0;
        const attN = parseInt(document.getElementById('cv-att-nuit').value, 10) || 0;
        const nuitMin = cvParseDureeTexte(document.getElementById('cv-temps-nuit').value);
        const cdbNom = document.getElementById('cv-cdb').value.trim() ||
            `${cvPiloteCible.prenom || ''} ${cvPiloteCible.nom || ''}`.trim();

        // Champs alignes sur le carnet de route pour alimenter directement
        // les calculs d'experience recente (Heure depart/arrivee, Decollages,
        // Atterrissages total, Instructeur pour la regle "1h avec instructeur").
        const fields = {
            'Pilote': `${cvPiloteCible.prenom || ''} ${cvPiloteCible.nom || ''}`.trim(),
            'Date': document.getElementById('cv-date').value,
            'Départ': document.getElementById('cv-lieu-depart').value.trim(),
            'Heure départ': hD,
            'Arrivée': document.getElementById('cv-lieu-arrivee').value.trim(),
            'Heure arrivée': hA,
            'Modèle': document.getElementById('cv-modele').value.trim(),
            'Immatriculation': document.getElementById('cv-immat').value.trim().toUpperCase(),
            'Monomoteur': document.getElementById('cv-monomoteur').checked,
            'Commandant de bord': cdbNom,
            'Décollages': parseInt(document.getElementById('cv-decollages').value, 10) || 0,
            'Atterrissages': attJ + attN,
            'Atterrissages jour': attJ,
            'Atterrissages nuit': attN,
            'Temps nuit': nuitMin,
            'Temps de vol': cvFormaterMinutes(duree) === '—' ? '' : cvFormaterMinutes(duree),
            'Temps CdB': fonction === 'CdB' ? duree : 0,
            'Temps DC': fonction === 'DC' ? duree : 0,
            'Temps instructeur': fonction === 'Instr' ? duree : 0,
            'Instructeur': fonction === 'DC' ? cdbNom : '',
            'Observations': document.getElementById('cv-observations').value.trim(),
            'Origine': 'Manuel'
        };

        try {
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_CARNET_VOL)}${recId ? '/' + recId : ''}`, {
                method: recId ? 'PATCH' : 'POST',
                headers,
                body: JSON.stringify({ fields })
            });
            if (!res.ok) throw new Error(await res.text());
            modal.style.display = 'none';
            chargerCarnetVol();
        } catch (err) {
            console.error(err);
            alert('Erreur lors de l\'enregistrement du vol.');
        }
    });
}

initCarnetVol();
