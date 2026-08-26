/* ==========================================================================
   ACCUEIL PILOTE - TABLEAU DE BORD
   ========================================================================== */

const ACCUEIL_TABLE_RESERVATIONS = 'Réservations';
const ACCUEIL_TABLE_MAINTENANCE = 'Maintenance';
const ACCUEIL_TABLE_AERONEFS = 'Aéronefs';

function initAccueilPilote() {
    const tab = document.getElementById('tab-accueil');
    const btnPlanning = document.getElementById('accueil-btn-planning');
    const btnCarnet = document.getElementById('accueil-btn-carnet');
    const btnCompte = document.getElementById('accueil-btn-compte');

    if (tab) tab.addEventListener('click', chargerAccueilPilote);
    if (btnPlanning) btnPlanning.addEventListener('click', () => {
        dateAffichee = new Date();
        dateAffichee.setHours(12, 0, 0, 0);
        mettreAJourDateAffichee();
        chargerDonneesPlanning();
        const t = document.getElementById('tab-planning');
        if (t) t.click();
    });
    if (btnCarnet) btnCarnet.addEventListener('click', () => {
        const t = document.getElementById('tab-carnet');
        if (t) t.click();
    });
    if (btnCompte) btnCompte.addEventListener('click', () => {
        const t = document.getElementById('tab-comptes');
        if (t) t.click();
    });
}

function formaterDateAccueil(str) {
    if (!str) return null;
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function debutJourAccueil(d) {
    const j = new Date(d);
    j.setHours(0, 0, 0, 0);
    return j;
}

function estValideJusquaAccueil(str) {
    if (!str) return false;
    const d = new Date(str);
    if (isNaN(d.getTime())) return false;
    return debutJourAccueil(d) >= debutJourAccueil(new Date());
}

function dateIlYAMoisAccueil(mois) {
    const auj = new Date();
    return new Date(auj.getFullYear(), auj.getMonth() - mois, auj.getDate());
}

function dureeVolMinutesAccueil(f) {
    if (f['Horamètre départ'] !== undefined && f['Horamètre arrivée'] !== undefined) {
        const dep = parseFloat(f['Horamètre départ']);
        const arr = parseFloat(f['Horamètre arrivée']);
        if (!isNaN(dep) && !isNaN(arr) && arr >= dep) return Math.round((arr - dep) * 60);
    }
    if (!f['Heure départ'] || !f['Heure arrivée']) return 0;
    const [hD, mD] = f['Heure départ'].split(':').map(Number);
    const [hA, mA] = f['Heure arrivée'].split(':').map(Number);
    if (isNaN(hD) || isNaN(mD) || isNaN(hA) || isNaN(mA)) return 0;
    let minutes = (hA * 60 + mA) - (hD * 60 + mD);
    if (minutes < 0) minutes += 24 * 60;
    return minutes;
}

async function chargerAccueilPilote() {
    const container = document.getElementById('accueil-pilote-container');
    if (!container) return;
    if (!currentUser) {
        container.innerHTML = '<p class="carnet-empty">Veuillez vous connecter.</p>';
        return;
    }
    container.innerHTML = '<p class="carnet-empty">Chargement du tableau de bord...</p>';

    const [resas, solde, signalements, validites] = await Promise.all([
        chargerReservationsAccueil().catch(() => 0),
        chargerSoldeAccueil().catch(() => 0),
        chargerSignalementsAccueil().catch(() => []),
        chargerValiditesAccueil().catch(() => null)
    ]);

    const piloteNom = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() || 'Prénom NOM';

    const htmlResas = `
        <div class="ap-card ap-card-green">
            <div class="ap-card-header">
                <div class="ap-card-number">${resas}</div>
                <div class="ap-card-icon">📅</div>
            </div>
            <div class="ap-card-label">Réservation(s) à venir</div>
            <button type="button" id="accueil-btn-planning" class="btn-primary" style="width:100%; margin-top:12px;">Planning du jour</button>
        </div>`;

    const htmlVols = `
        <div class="ap-card ap-card-orange">
            <div class="ap-card-header">
                <div class="ap-card-number">-</div>
                <div class="ap-card-icon">✈️</div>
            </div>
            <div class="ap-card-label">Aucun vol connu</div>
            <button type="button" id="accueil-btn-carnet-retour" class="btn-primary" style="width:100%; margin-top:8px;">Retour de vol</button>
            <button type="button" id="accueil-btn-carnet" class="btn-secondary" style="width:100%; margin-top:8px;">Mes derniers vols</button>
        </div>`;

    const soldeClasse = solde >= 0 ? 'ap-card-blue' : (solde >= -300 ? 'ap-card-orange' : 'ap-card-red');
    const soldeDot = solde >= 0 ? 'pastille-verte' : (solde >= -300 ? 'pastille-orange' : 'pastille-rouge');
    const soldeText = solde.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

    const htmlSolde = `
        <div class="ap-card ${soldeClasse}">
            <div class="ap-card-header">
                <div class="ap-card-number">${soldeText}</div>
                <div class="ap-card-icon">💳</div>
            </div>
            <div class="ap-card-label">Solde corrigé de mon compte pilote</div>
            <button type="button" id="accueil-btn-compte" class="btn-primary" style="width:100%; margin-top:12px;">Consulter mon compte</button>
        </div>`;

    const htmlSignalements = `
        <div class="ap-card ap-card-white ap-card-wide">
            <h3>Signalements aéronefs en cours</h3>
            ${signalements.length ? `
                <div class="ap-signalements-list">
                    ${signalements.map(s => `
                        <div class="ap-signalement-row">
                            <span class="ap-signalement-machine">${escHtml(s.immat)}</span>
                            <span class="ap-signalement-count">${s.count} signalement(s)</span>
                        </div>
                    `).join('')}
                </div>
            ` : '<p class="carnet-empty">Aucun signalement en cours.</p>'}
        </div>`;

    const htmlValidites = `
        <div class="ap-card ap-card-white ap-card-wide">
            <h3>Mes validités & qualifications</h3>
            <div class="ap-validites-list">
                ${renderValidites(validites)}
            </div>
        </div>`;

    container.innerHTML = `
        <div class="accueil-pilote-header">
            <h2>Accueil pilote</h2>
            <p>Tableau de bord pilote de <strong id="accueil-pilote-nom">${escHtml(piloteNom)}</strong></p>
        </div>
        <div class="accueil-pilote-grid">
            ${htmlResas}
            ${htmlVols}
            ${htmlSolde}
            ${htmlSignalements}
            ${htmlValidites}
        </div>
    `;

    const btnPlanning = document.getElementById('accueil-btn-planning');
    if (btnPlanning) btnPlanning.addEventListener('click', () => {
        dateAffichee = new Date();
        dateAffichee.setHours(12, 0, 0, 0);
        mettreAJourDateAffichee();
        chargerDonneesPlanning();
        const t = document.getElementById('tab-planning');
        if (t) t.click();
    });

    const btnCarnet = document.getElementById('accueil-btn-carnet');
    const btnCarnetRetour = document.getElementById('accueil-btn-carnet-retour');
    if (btnCarnet) btnCarnet.addEventListener('click', () => {
        const t = document.getElementById('tab-carnet');
        if (t) t.click();
    });
    if (btnCarnetRetour) btnCarnetRetour.addEventListener('click', () => {
        const t = document.getElementById('tab-carnet');
        if (t) t.click();
        if (typeof ouvrirModaleNouveauCarnet === 'function') ouvrirModaleNouveauCarnet();
    });

    const btnCompte = document.getElementById('accueil-btn-compte');
    if (btnCompte) btnCompte.addEventListener('click', () => {
        const t = document.getElementById('tab-comptes');
        if (t) t.click();
    });
}

async function chargerReservationsAccueil() {
    const id = currentUser ? currentUser.id : '';
    if (!id) return 0;
    try {
        const formula = `AND(IS_AFTER({Date de fin}, NOW()), FIND('${id}', ARRAYJOIN({Pilote}, ',')) > 0)`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACCUEIL_TABLE_RESERVATIONS)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message);
        return (data.records || []).length;
    } catch (err) {
        console.error('Erreur chargement réservations accueil:', err);
        return 0;
    }
}

async function chargerSoldeAccueil() {
    const nom = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    if (!nom) return 0;
    if (typeof getSoldePilote === 'function') {
        return getSoldePilote(nom);
    }
    return 0;
}

async function chargerSignalementsAccueil() {
    try {
        const [resMachines, resMaintenance] = await Promise.all([
            cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACCUEIL_TABLE_AERONEFS)}?pageSize=100`, { headers }),
            cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACCUEIL_TABLE_MAINTENANCE)}?pageSize=100`, { headers })
        ]);
        const dataMachines = await resMachines.json();
        const dataMaintenance = await resMaintenance.json();
        if (!resMachines.ok || !resMaintenance.ok) throw new Error('Erreur');
        const machines = dataMachines.records || [];
        const maintenance = dataMaintenance.records || [];

        const counts = {};
        maintenance.forEach(m => {
            const f = m.fields || {};
            const statut = (f['Statut'] || '').toString().trim().toLowerCase();
            if (statut === 'résolu' || statut === 'clôturé' || statut === 'resolu' || statut === 'cloture') return;
            const machine = f['Machine'];
            const ids = Array.isArray(machine) ? machine : (machine ? [machine] : []);
            ids.forEach(mid => {
                if (!counts[mid]) counts[mid] = 0;
                counts[mid]++;
            });
        });

        const signalements = [];
        Object.keys(counts).forEach(mid => {
            const avion = machines.find(a => a.id === mid || (a.fields['Immatriculation'] || '').toString().trim().toUpperCase() === mid.toUpperCase());
            const immat = avion ? (avion.fields['Immatriculation'] || avion.fields['Nom'] || mid) : mid;
            signalements.push({ immat, count: counts[mid] });
        });
        return signalements.sort((a, b) => a.immat.localeCompare(b.immat));
    } catch (err) {
        console.error('Erreur chargement signalements accueil:', err);
        return [];
    }
}

async function chargerValiditesAccueil() {
    if (!currentUser) return null;
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${currentUser.id}`;
        const res = await cachedFetch(url, { headers }, 0, true);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message);
        const f = data.fields || {};

        const suivisActifs = Array.isArray(f['Suivis actifs']) ? f['Suivis actifs'] : (f['Suivis actifs'] ? [f['Suivis actifs']] : []);
        const estSuivi = (label) => suivisActifs.length ? suivisActifs.includes(label) : true;

        const cotisationOk = estValideJusquaAccueil(f['Cotisation']);

        const assuranceFields = ['Licence FFVP', 'Licence FFA', 'Licence FFPLUM'];
        const assuranceDates = assuranceFields.map(k => f[k]).filter(Boolean);
        const assuranceOk = assuranceDates.some(d => estValideJusquaAccueil(d));

        const medicalOk = estValideJusquaAccueil(f['Médical']);

        const licenceActive = estSuivi('Licence SEP');
        const licenceOk = licenceActive ? estValideJusquaAccueil(f['Licence SEP']) : null;

        const laplActive = estSuivi('LAPL');
        const initiationActive = estSuivi('Pilote vol initiation avion');

        const experiences = await chargerExperiencesAccueil(!!f['Pilote CPL']);

        return {
            items: [
                { label: 'Cotisation', ok: cotisationOk, date: f['Cotisation'] },
                { label: 'Licence assurance', ok: assuranceOk, date: assuranceDates[0] },
                { label: 'Médical', ok: medicalOk, date: f['Médical'] },
                { label: 'Licence SEP', ok: licenceOk, date: f['Licence SEP'], actif: licenceActive },
                { label: 'Expérience récente (1 vol / 3 mois)', ok: experiences.recent, detail: experiences.recentDetail },
                { label: 'Emport de passager (3 décollages / 3 atterrissages)', ok: experiences.passager, detail: experiences.passagerDetail },
                { label: 'LAPL', ok: laplActive ? experiences.lapl : null, detail: experiences.laplDetail, actif: laplActive },
                { label: 'Vol d\'initiation', ok: initiationActive ? experiences.initiation : null, detail: experiences.initiationDetail, actif: initiationActive },
            ],
            solde: await chargerSoldeAccueil()
        };
    } catch (err) {
        console.error('Erreur chargement validités accueil:', err);
        return null;
    }
}

async function chargerExperiencesAccueil(cpl = false) {
    const tableCarnet = typeof TABLE_CARNET_ROUTE !== 'undefined' ? TABLE_CARNET_ROUTE : 'Carnet de route Pilotes';
    const prenom = (currentUser.prenom || '').replace(/"/g, '\\"');
    const nom = (currentUser.nom || '').replace(/"/g, '\\"');
    const mois24 = dateIlYAMoisAccueil(24);
    const dateMin = `${mois24.getFullYear()}-${String(mois24.getMonth() + 1).padStart(2, '0')}-${String(mois24.getDate()).padStart(2, '0')}`;
    const formula = `AND(OR(FIND(UPPER("${prenom}"), UPPER({Pilote})) > 0, FIND(UPPER("${nom}"), UPPER({Pilote})) > 0), IS_AFTER({Date}, "${dateMin}"))`;
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableCarnet)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;

    let records = [];
    let offset = '';
    try {
        do {
            const url = baseUrl + (offset ? `&offset=${offset}` : '');
            const res = await cachedFetch(url, { headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message);
            records = records.concat(data.records || []);
            offset = data.offset || '';
        } while (offset);
    } catch (err) {
        console.error('Erreur chargement expériences accueil:', err);
        return { recent: false, passager: false, lapl: false, initiation: false };
    }

    const auj = new Date();
    const limite3m = dateIlYAMoisAccueil(3);
    const limite12m = dateIlYAMoisAccueil(12);
    const limite24m = dateIlYAMoisAccueil(24);

    let dernierVol = null;
    let decollages3m = 0, atterrissages3m = 0;
    let minutes24m = 0, decollages24m = 0, atterrissages24m = 0, instruction1h = false;
    let minutes12m = 0;

    records.forEach(r => {
        const f = r.fields || {};
        if (!f['Date']) return;
        const d = new Date(f['Date']);
        if (d < limite24m) return;
        if (!dernierVol || d > dernierVol) dernierVol = d;
        const duree = dureeVolMinutesAccueil(f);
        const dec = parseInt(f['Décollages'], 10) || 1;
        const att = parseInt(f['Atterrissages'], 10) || 1;

        if (d >= limite3m) {
            decollages3m += dec;
            atterrissages3m += att;
        }
        if (d >= limite24m) {
            minutes24m += duree;
            decollages24m += dec;
            atterrissages24m += att;
            const inst = (f['Instructeur'] || '').toString().trim();
            if (inst && duree >= 60) instruction1h = true;
        }
        if (d >= limite12m) {
            minutes12m += duree;
        }
    });

    const h24 = Math.floor(minutes24m / 60);
    const m24 = minutes24m % 60;
    const h12 = Math.floor(minutes12m / 60);
    const m12 = minutes12m % 60;

    let recentOk = false;
    let recentDetail = 'Aucun vol dans les 3 derniers mois';
    if (dernierVol && dernierVol >= limite3m) {
        recentOk = true;
        recentDetail = `Dernier vol : ${formaterDateAccueil(dernierVol.toISOString())}`;
    }

    const passagerOk = decollages3m >= 3 && atterrissages3m >= 3;
    const passagerDetail = `${decollages3m} décollages, ${atterrissages3m} atterrissages / 3`;

    const laplOk = minutes24m >= 12 * 60 && decollages24m >= 12 && atterrissages24m >= 12 && instruction1h;
    const laplDetail = `${h24}h${String(m24).padStart(2, '0')} / 12h00 — ${decollages24m} décollages / 12 — ${atterrissages24m} atterrissages / 12 — 1h instructeur : ${instruction1h ? 'oui' : 'non'}`;

    const initiationOk = passagerOk && (cpl || minutes12m >= 25 * 60);
    const initiationDetail = cpl
        ? `Pilote CPL — ${h12}h${String(m12).padStart(2, '0')} sur 12 mois`
        : `${h12}h${String(m12).padStart(2, '0')} / 25h00 sur 12 mois — emport passager : ${passagerOk ? 'oui' : 'non'}`;

    return { recent: recentOk, recentDetail, passager: passagerOk, passagerDetail, lapl: laplOk, laplDetail, initiation: initiationOk, initiationDetail };
}

function renderValidites(data) {
    if (!data || !data.items) return '<p class="carnet-empty">Impossible de charger les validités.</p>';
    const soldeDot = data.solde >= 0 ? 'pastille-verte' : (data.solde >= -300 ? 'pastille-orange' : 'pastille-rouge');
    const soldeText = data.solde.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    const soldeLabel = data.solde >= 0 ? 'Compte positif' : (data.solde >= -300 ? 'Compte à surveiller' : 'Compte négatif');

    let html = data.items.map(item => {
        let dot, label;
        if (item.actif === false) {
            dot = 'pastille-grise';
            label = `${item.label} — Non suivi`;
        } else if (item.ok === null) {
            dot = 'pastille-grise';
            label = `${item.label} — Non renseigné`;
        } else if (item.ok) {
            dot = 'pastille-verte';
            label = `✓ ${item.label} — À jour`;
        } else {
            dot = 'pastille-rouge';
            label = `✕ ${item.label} — Non à jour`;
        }
        const detail = item.detail || (item.date ? `Valide jusqu'au : ${formaterDateAccueil(item.date) || '-'}` : '');
        return `
            <div class="ap-validite-row">
                <span class="ap-pastille ${dot}"></span>
                <span class="ap-validite-label">${escHtml(label)}</span>
                ${detail ? `<span class="ap-validite-detail">${escHtml(detail)}</span>` : ''}
            </div>
        `;
    }).join('');

    html += `
        <div class="ap-validite-row">
            <span class="ap-pastille ${soldeDot}"></span>
            <span class="ap-validite-label">${escHtml(soldeLabel)}</span>
            <span class="ap-validite-detail">${escHtml(soldeText)}</span>
        </div>`;

    return html;
}

document.addEventListener('DOMContentLoaded', initAccueilPilote);
