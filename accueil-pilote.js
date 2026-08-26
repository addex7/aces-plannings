/* ==========================================================================
   ACCUEIL PILOTE - TABLEAU DE BORD
   ========================================================================== */

const ACCUEIL_TABLE_RESERVATIONS = 'Réservations';
const ACCUEIL_TABLE_SIGN = 'Signalements';
const ACCUEIL_TABLE_AERONEFS = 'Aéronefs';

function initAccueilPilote() {
    const tab = document.getElementById('tab-accueil');
    if (tab) tab.addEventListener('click', chargerAccueilPilote);
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

    const [resas, solde, signalements, validites, vols, messagesClub] = await Promise.all([
        chargerProchaineJournee().catch(() => ({ text: '-', date: null, label: 'Aucune inscription' })),
        chargerSoldeAccueil().catch(() => 0),
        chargerSignalementsAccueil().catch(() => []),
        chargerValiditesAccueil().catch(() => null),
        chargerDernierVol().catch(() => null),
        chargerMessagesClub().catch(() => [])
    ]);

    const piloteNom = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() || 'Prénom NOM';

    const htmlResas = `
        <div class="ap-card ap-card-green">
            <div class="ap-card-header">
                <div class="ap-card-number">${resas.text}</div>
                <div class="ap-card-icon">📅</div>
            </div>
            <div class="ap-card-label">${resas.label}</div>
            <button type="button" id="accueil-btn-planning" class="btn-primary" style="width:100%; margin-top:12px;">Voir le planning</button>
        </div>`;

    const htmlVols = vols ? `
        <div class="ap-card ap-card-orange">
            <div class="ap-card-header">
                <div class="ap-card-number">${vols.dateText}</div>
                <div class="ap-card-icon">✈️</div>
            </div>
            <div class="ap-card-label">${escHtml(vols.machine)} — ${escHtml(vols.duree)} ${vols.instructeur ? `— ${escHtml(vols.instructeur)}` : ''}</div>
            <button type="button" id="accueil-btn-carnet-retour" class="btn-primary" style="width:100%; margin-top:8px;">Retour de vol</button>
        </div>` : `
        <div class="ap-card ap-card-orange">
            <div class="ap-card-header">
                <div class="ap-card-number">-</div>
                <div class="ap-card-icon">✈️</div>
            </div>
            <div class="ap-card-label">Aucun vol connu</div>
            <button type="button" id="accueil-btn-carnet-retour" class="btn-primary" style="width:100%; margin-top:8px;">Retour de vol</button>
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
        <div class="ap-card ap-card-white ap-card-signalements">
            <h3>Signalements en cours</h3>
            ${signalements.length ? `
                <div class="ap-signalements-list">
                    ${signalements.map(s => `
                        <div class="ap-signalement-row" data-immat="${escHtml(s.immat)}" style="cursor:pointer;">
                            <span class="ap-signalement-machine">${escHtml(s.immat)}</span>
                            <span class="ap-signalement-count">${s.items.length} Signalement${s.items.length > 1 ? 's' : ''}</span>
                        </div>
                    `).join('')}
                </div>
            ` : '<p class="carnet-empty">Aucun signalement en cours.</p>'}
        </div>`;

    const htmlValidites = `
        <div class="ap-card ap-card-white">
            <h3>Mes validités & qualifications</h3>
            <div class="ap-validites-list">
                ${renderValidites(validites)}
            </div>
        </div>`;

    const htmlMessagesClub = renderMessagesClub(messagesClub);

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
            <div class="ap-bottom-row">
                ${htmlValidites}
                ${htmlMessagesClub}
            </div>
        </div>
    `;

    const btnPlanning = document.getElementById('accueil-btn-planning');
    if (btnPlanning) btnPlanning.addEventListener('click', () => {
        if (resas.date) {
            dateAffichee = new Date(resas.date);
            dateAffichee.setHours(12, 0, 0, 0);
        } else {
            dateAffichee = new Date();
            dateAffichee.setHours(12, 0, 0, 0);
        }
        mettreAJourDateAffichee();
        chargerDonneesPlanning();
        const t = document.getElementById('tab-planning');
        if (t) t.click();
    });

    const btnCarnetRetour = document.getElementById('accueil-btn-carnet-retour');
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

    container.querySelectorAll('.ap-signalement-row').forEach(row => {
        row.addEventListener('click', () => {
            const immat = row.dataset.immat;
            const grp = signalements.find(sg => sg.immat === immat);
            if (grp) ouvrirModaleSignalements(grp.immat, grp.items);
        });
    });

    const btnNew = container.querySelector('#ap-btn-new-msg');
    const formMsg = container.querySelector('#ap-message-form');
    const btnCancel = container.querySelector('#ap-msg-cancel');

    if (btnNew && formMsg) {
        btnNew.addEventListener('click', () => {
            formMsg.style.display = formMsg.style.display === 'none' ? 'block' : 'none';
        });
    }

    if (btnCancel && formMsg) {
        btnCancel.addEventListener('click', () => {
            formMsg.style.display = 'none';
            formMsg.reset();
        });
    }

    if (formMsg) {
        formMsg.addEventListener('submit', (e) => {
            e.preventDefault();
            const titre = container.querySelector('#ap-msg-titre')?.value || '';
            const corps = container.querySelector('#ap-msg-corps')?.value || '';
            posterMessageClub(titre, corps);
        });
    }
}

function ouvrirModaleSignalements(immat, items) {
    const existing = document.getElementById('ap-modal-signalements');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ap-modal-signalements';
    overlay.className = 'ap-modal-signalements';
    overlay.innerHTML = `
        <div class="ap-modal-signalements-content" role="dialog" aria-modal="true">
            <div class="ap-modal-signalements-header">
                <h3>Signalements — ${escHtml(immat)}</h3>
                <button type="button" class="ap-modal-signalements-close" aria-label="Fermer">&times;</button>
            </div>
            <div class="ap-modal-signalements-list">
                ${items.map(i => `
                    <div class="ap-modal-signalements-item">
                        <span class="ap-modal-signalements-desc">${escHtml(i.description)}</span>
                        <span class="ap-modal-signalements-etat">${escHtml(i.etat)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.ap-modal-signalements-close').addEventListener('click', () => overlay.remove());
}

async function chargerProchaineJournee() {
    if (!currentUser) return { text: '-', date: null, label: 'Aucune inscription' };
    const id = currentUser.id;
    const prenom = (currentUser.prenom || '').trim();
    const nom = (currentUser.nom || '').trim();
    const prenomLower = prenom.toLowerCase();
    const nomLower = nom.toLowerCase();
    const fullLower = `${prenomLower} ${nomLower}`.trim();
    const appartient = (field) => {
        const arr = Array.isArray(field) ? field : [field];
        return arr.some(v => {
            if (v === id) return true;
            if (typeof v === 'string') {
                const vl = v.toLowerCase();
                if (fullLower && vl.includes(fullLower)) return true;
                if (prenomLower && vl.includes(prenomLower)) return true;
                if (nomLower && vl.includes(nomLower)) return true;
            }
            return false;
        });
    };
    const inscritEv = (text) => {
        const t = (text || '').toString().toLowerCase();
        if (!t) return false;
        return (fullLower && t.includes(fullLower)) || (prenomLower && t.includes(prenomLower)) || (nomLower && t.includes(nomLower));
    };
    const sources = [
        { table: 'Réservations', dateField: 'Date de début', presence: (f) => appartient(f['Pilote']) || appartient(f['Pilote (texte)']) },
        { table: 'Présences Planeur', dateField: 'Date', presence: (f) => appartient(f['Nom du pilote']) || appartient(f['Pilote']) },
        { table: 'Présences Club', dateField: 'Date', presence: (f) => appartient(f['Nom du pilote']) || appartient(f['Pilote']) },
        { table: 'Événements', dateField: 'Date début', presence: (f) => inscritEv(f['Inscrits']) }
    ];
    const matches = [];
    for (const s of sources) {
        try {
            const nowFormula = s.table === 'Réservations'
                ? `IS_AFTER({${s.dateField}}, NOW())`
                : `IS_AFTER({${s.dateField}}, DATEADD(NOW(), -1, 'days'))`;
            const pageSize = 100;
            const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(s.table)}?filterByFormula=${encodeURIComponent(nowFormula)}&sort[0][field]=${encodeURIComponent(s.dateField)}&sort[0][direction]=asc&pageSize=${pageSize}`;
            const res = await cachedFetch(url, { headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message);
            (data.records || []).forEach(r => {
                if (s.presence(r.fields || {})) {
                    const dateStr = r.fields[s.dateField];
                    const d = new Date(dateStr);
                    if (!isNaN(d.getTime())) matches.push({ date: d, dateStr, source: s.table });
                }
            });
        } catch (err) {
            console.warn('Prochaine journée', s.table, err);
        }
    }
    matches.sort((a, b) => a.date - b.date);
    const next = matches[0];
    if (!next) return { text: '-', date: null, label: 'Aucune inscription' };
    return { text: formaterDateAccueil(next.dateStr), date: next.dateStr, label: 'Prochaine journée', source: next.source };
}

async function chargerSoldeAccueil() {
    const nom = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    if (!nom) return 0;
    if (typeof getSoldePilote === 'function') {
        return getSoldePilote(nom);
    }
    return 0;
}

async function chargerDernierVol() {
    if (!currentUser) return null;
    const table = typeof TABLE_CARNET_ROUTE !== 'undefined' ? TABLE_CARNET_ROUTE : 'Carnet de route Pilotes';
    const prenom = (currentUser.prenom || '').toLowerCase();
    const nom = (currentUser.nom || '').toLowerCase();
    const id = currentUser.id;
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?sort[0][field]=Date&sort[0][direction]=desc&pageSize=50`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message);

        const estUnVol = (f) => {
            const hDep = (f['Heure départ'] || '').toString().trim();
            const hArr = (f['Heure arrivée'] || '').toString().trim();
            if (!hDep || !hArr || hDep === '00:00' || hArr === '00:00') return false;
            const dec = parseInt(f['Décollages'], 10);
            const att = parseInt(f['Atterrissages'], 10);
            return !isNaN(dec) && dec > 0 && !isNaN(att) && att > 0;
        };

        const records = (data.records || []).slice().sort((a, b) => {
            const dA = new Date(a.fields['Date'] || 0);
            const dB = new Date(b.fields['Date'] || 0);
            if (dB - dA !== 0) return dB - dA;
            const cA = new Date(a.createdTime || 0);
            const cB = new Date(b.createdTime || 0);
            return cB - cA;
        });

        const correspond = (field) => {
            const arr = Array.isArray(field) ? field : [field];
            return arr.some(v => {
                if (v === id) return true;
                if (typeof v === 'string') {
                    const vl = v.toLowerCase();
                    if (prenom && vl.includes(prenom)) return true;
                    if (nom && vl.includes(nom)) return true;
                }
                return false;
            });
        };

        for (const r of records) {
            const f = r.fields || {};
            const match = correspond(f['Pilote']) || correspond(f['Instructeur']);
            if (match && estUnVol(f)) {
                const duree = dureeVolMinutesAccueil(f);
                const h = Math.floor(duree / 60);
                const m = duree % 60;
                const dureeText = duree > 0 ? `${h}h${String(m).padStart(2, '0')}` : '-';
                return {
                    date: f['Date'],
                    dateText: formaterDateAccueil(f['Date']),
                    machine: f['Machine'] || '?',
                    duree: dureeText,
                    instructeur: f['Instructeur'] || '',
                    pilote: f['Pilote'] || ''
                };
            }
        }
        return null;
    } catch (err) {
        console.error('Erreur chargement dernier vol:', err);
        return null;
    }
}

async function chargerSignalementsAccueil() {
    const tableCarnet = typeof TABLE_CARNET_ROUTE !== 'undefined' ? TABLE_CARNET_ROUTE : 'Carnet de route Pilotes';
    try {
        const formula = `AND(TRIM({Observations}) != '', {Statut observation} != 'Observation traitée')`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableCarnet)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message);

        const records = (data.records || []).map(r => {
            const f = r.fields || {};
            const immat = (f['Machine'] || '').toString().trim() || '?';
            const description = (f['Observations'] || '').toString().trim() || 'Signalement';
            const etat = (f['Statut observation'] || 'Non pris en compte').toString().trim();
            return { immat, description, etat };
        }).sort((a, b) => a.immat.localeCompare(b.immat));

        const groups = {};
        records.forEach(s => {
            if (!groups[s.immat]) groups[s.immat] = { immat: s.immat, items: [] };
            groups[s.immat].items.push({ description: s.description, etat: s.etat });
        });
        return Object.values(groups).sort((a, b) => a.immat.localeCompare(b.immat));
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

    let html = data.items.filter(item => item.actif !== false).map(item => {
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

async function chargerMessagesClub() {
    if (!currentUser) return [];
    const table = typeof TABLE_MESSAGERIE !== 'undefined' ? TABLE_MESSAGERIE : 'Messagerie';
    const nom = typeof nomCompletCourant === 'function' ? nomCompletCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    if (!nom) return [];
    try {
        const formula = `FIND('Tous', {Destinataire}) > 0`;
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=5`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        return data.records || [];
    } catch (err) {
        console.error('Erreur chargement messages club:', err);
        return [];
    }
}

function peutEcrireMessagesClub() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    const banal = ['Membre', 'Pilote', 'Aucun', ''];
    const roles = currentUser.roles || [];
    if (roles.length === 0) return false;
    return roles.some(r => r && !banal.includes(r));
}

async function posterMessageClub(titre, corps) {
    if (!titre.trim() || !corps.trim()) return;
    const table = typeof TABLE_MESSAGERIE !== 'undefined' ? TABLE_MESSAGERIE : 'Messagerie';
    const expediteur = typeof nomCompletCourant === 'function' ? nomCompletCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    const date = new Date().toISOString().split('T')[0];
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                records: [{
                    fields: {
                        'Date': date,
                        'Expéditeur': expediteur,
                        'Destinataire': 'Tous',
                        'Objet': titre.trim(),
                        'Corps': corps.trim(),
                        'Lu': false
                    }
                }]
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        if (typeof chargerAccueilPilote === 'function') await chargerAccueilPilote();
    } catch (err) {
        console.error('Erreur publication message club:', err);
        alert('Impossible de publier le message.');
    }
}

function renderMessagesClub(records) {
    const messages = (records || []).map(r => {
        const f = r.fields || {};
        const date = f['Date'] ? formaterDateAccueil(f['Date']) : '';
        const expediteur = f['Expéditeur'] || '';
        const objet = f['Objet'] || '(sans objet)';
        const corps = f['Corps'] || '';
        return { id: r.id, date, expediteur, objet, corps };
    });
    const list = messages.length ? messages.map(m => `
        <div class="ap-message-item" style="padding:10px 0; border-bottom:1px solid #e2e8f0;">
            <div class="ap-message-title">${escHtml(m.objet)}</div>
            <div class="ap-message-meta">
                <span>${escHtml(m.expediteur)}</span>
                <span>${escHtml(m.date)}</span>
            </div>
            <div class="ap-message-body">${escHtml(m.corps).replace(/\n/g, '<br>')}</div>
        </div>
    `).join('') : '<p class="carnet-empty">Aucun message.</p>';
    const afficherForm = peutEcrireMessagesClub();
    return `
        <div class="ap-card ap-card-white ap-card-messages">
            <h3 class="ap-messages-header">
                <span>Messages club</span>
                ${afficherForm ? '<button type="button" id="ap-btn-new-msg" class="ap-btn-new-msg" title="Nouveau message">+</button>' : ''}
            </h3>
            <div class="ap-messages-list">
                ${list}
            </div>
            ${afficherForm ? `
            <form id="ap-message-form" class="ap-message-form" style="display:none;">
                <input type="text" id="ap-msg-titre" class="ap-msg-input" placeholder="Titre" required>
                <textarea id="ap-msg-corps" class="ap-msg-textarea" placeholder="Corps du message..." required rows="3"></textarea>
                <div class="ap-msg-actions">
                    <button type="submit" class="ap-msg-submit">Publier</button>
                    <button type="button" id="ap-msg-cancel" class="ap-msg-cancel">Annuler</button>
                </div>
            </form>` : ''}
        </div>`;
}

document.addEventListener('DOMContentLoaded', initAccueilPilote);
