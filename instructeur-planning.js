/* ==========================================================================
   PLANNING INSTRUCTEUR - VUE 14 JOURS
   ========================================================================== */

const TABLE_RESERVATIONS = 'Réservations';

let dateInstructeurSuivi = new Date();
let instructeurSelectionne = '';

function genererFriseHeuresInstructeur() {
    const container = document.getElementById('timeline-hours-instructeur');
    if (!container) return;
    container.innerHTML = '';
    for (let h = 0; h < 24; h++) {
        const div = document.createElement('div');
        div.className = 'hour-cell-header';
        div.style.flex = LARGEURS_HEURES[h];
        div.innerHTML = `<span>${h}h</span>`;
        container.appendChild(div);
    }
}

function mettreAJourDateInstructeur() {
    const el = document.getElementById('current-date-instructeur');
    if (!el) return;
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    el.textContent = dateInstructeurSuivi.toLocaleDateString('fr-FR', options);
}

async function peuplerSelectInstructeurSuivi() {
    const sel = document.getElementById('select-instructeur-suivi');
    if (!sel) return;
    if (typeof chargerListeInstructeurs === 'function') await chargerListeInstructeurs();
    let instructeurs = (typeof listeInstructeursCache !== 'undefined') ? listeInstructeursCache : [];
    if (!instructeurs.length && typeof estInstructeur === 'function' && estInstructeur() && currentUser) {
        const nomComplet = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
        if (nomComplet) instructeurs = [{ nomComplet }];
    }
    let html = '<option value="">-- Sélectionner un instructeur --</option>';
    instructeurs.forEach(u => {
        html += `<option value="${u.nomComplet}" ${u.nomComplet === instructeurSelectionne ? 'selected' : ''}>${u.nomComplet}</option>`;
    });
    sel.innerHTML = html;
}

function initPlanningInstructeur() {
    initBoutonDisponibiliteInstructeur();
    const btnPrev = document.getElementById('btn-instructeur-prev');
    const btnNext = document.getElementById('btn-instructeur-next');
    const dateEl = document.getElementById('current-date-instructeur');
    const sel = document.getElementById('select-instructeur-suivi');

    if (!btnPrev || !btnNext || !dateEl || !sel) return;

    genererFriseHeuresInstructeur();
    mettreAJourDateInstructeur();

    if (!btnPrev.dataset.ready) {
        btnPrev.addEventListener('click', () => {
            dateInstructeurSuivi.setDate(dateInstructeurSuivi.getDate() - 1);
            mettreAJourDateInstructeur();
            chargerSuiviInstructeur();
        });
        btnPrev.dataset.ready = '1';
    }

    if (!btnNext.dataset.ready) {
        btnNext.addEventListener('click', () => {
            dateInstructeurSuivi.setDate(dateInstructeurSuivi.getDate() + 1);
            mettreAJourDateInstructeur();
            chargerSuiviInstructeur();
        });
        btnNext.dataset.ready = '1';
    }

    if (!dateEl.dataset.ready) {
        dateEl.addEventListener('click', () => {
            const annee = dateInstructeurSuivi.getFullYear();
            const mois = (dateInstructeurSuivi.getMonth() + 1).toString().padStart(2, '0');
            const jour = dateInstructeurSuivi.getDate().toString().padStart(2, '0');
            const datePrompt = prompt('Aller à la date (JJ/MM/AAAA) :', `${jour}/${mois}/${annee}`);
            if (datePrompt) {
                const [d, m, y] = datePrompt.split('/').map(Number);
                if (d && m && y) {
                    dateInstructeurSuivi = new Date(y, m - 1, d, 12, 0, 0);
                    mettreAJourDateInstructeur();
                    chargerSuiviInstructeur();
                }
            }
        });
        dateEl.dataset.ready = '1';
    }

    if (!sel.dataset.ready) {
        sel.addEventListener('change', () => {
            instructeurSelectionne = sel.value;
            chargerSuiviInstructeur();
        });
        sel.dataset.ready = '1';
    }

    peuplerSelectInstructeurSuivi().then(() => {
        if (!instructeurSelectionne && sel.options.length > 0) {
            sel.value = sel.options[0].value;
            instructeurSelectionne = sel.value;
        }
        if (instructeurSelectionne) chargerSuiviInstructeur();
    });
}

async function chargerDisposInstructeurPlage(start, end) {
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    const formula = `AND(DATETIME_FORMAT({Date},'YYYY-MM-DD')>='${startStr}', DATETIME_FORMAT({Date},'YYYY-MM-DD')<='${endStr}')`;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DISPONIBILITES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers }, API_CACHE_TTL, true);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        console.log('[INSTRUCTEUR DISPOS] records:', data.records ? data.records.length : 0);
        return data.records || [];
    } catch (err) { console.error('[INSTRUCTEUR DISPOS] erreur:', err); return []; }
}

async function chargerReservationsInstructeurPlage(nom, start, end) {
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    const prenom = (nom.split(' ')[0] || nom).replace(/'/g, "\\'");
    const formula = `AND(OR(SEARCH('${prenom}', {Instructeur}) > 0, SEARCH('${prenom}', {Pilote}) > 0), DATETIME_FORMAT({Date de début},'YYYY-MM-DD')<='${endStr}', DATETIME_FORMAT({Date de fin},'YYYY-MM-DD')>='${startStr}')`;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_RESERVATIONS)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        const records = data.records || [];
        if (!Array.isArray(listeReservationsCache)) listeReservationsCache = [];
        records.forEach(r => {
            const i = listeReservationsCache.findIndex(x => x.id === r.id);
            if (i >= 0) listeReservationsCache[i] = r;
            else listeReservationsCache.push(r);
        });
        return records;
    } catch (err) { console.error(err); return []; }
}

function ajouterFondNuit(cellule, dateJour) {
    if (typeof genererFondNuitHTML !== 'function') return;
    cellule.insertAdjacentHTML('afterbegin', genererFondNuitHTML(dateJour));
}

function rendreLigneInstructeur(tr, dateJour, disposJour, reservationsJour, nom) {
    const dateStr = `${dateJour.getFullYear()}-${String(dateJour.getMonth() + 1).padStart(2, '0')}-${String(dateJour.getDate()).padStart(2, '0')}`;
    const tdDate = document.createElement('td');
    tdDate.style.cssText = 'padding: 12px 10px; font-weight: bold; color: #1e3d59; vertical-align: middle;';
    tdDate.textContent = dateJour.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    tr.appendChild(tdDate);

    const tdCell = document.createElement('td');
    tdCell.style.cssText = 'padding: 4px; height: 46px; vertical-align: middle;';

    const inner = document.createElement('div');
    inner.style.cssText = 'display: flex; position: relative; height: 100%; width: 100%;';

    const blocks = [];
    for (let h = 0; h < 24; h++) blocks.push('red');
    disposJour.forEach(d => {
        const f = d.fields || {};
        const [hStart, mStart] = String(f['Heure début'] || '00:00').split(':').map(Number);
        const [hEnd, mEnd] = String(f['Heure fin'] || '00:00').split(':').map(Number);
        const startMin = hStart * 60 + (mStart || 0);
        const endMin = hEnd * 60 + (mEnd || 0);
        const estDispo = f['Disponible'] === true || f['Disponible'] === 'true' || f['Disponible'] === 1 || f['Disponible'] === '1';
        for (let m = 0; m < 1440; m += 60) {
            const h = m / 60;
            if (m < startMin || m + 60 > endMin) continue;
            blocks[h] = estDispo ? 'green' : 'red';
        }
    });

    for (let h = 0; h < 24; h++) {
        const d = document.createElement('div');
        d.className = 'grid-hour-block';
        d.style.flex = LARGEURS_HEURES[h];
        const overlay = document.createElement('div');
        overlay.className = `dispo-hour-overlay dispo-${blocks[h]}`;
        d.appendChild(overlay);
        inner.appendChild(d);
    }

    ajouterFondNuit(inner, dateJour);

    tdCell.appendChild(inner);

    const barresInfos = [];
    reservationsJour.forEach(r => {
        const f = r.fields || {};
        const debut = new Date(f['Date de début']);
        const fin = new Date(f['Date de fin']);
        if (isNaN(debut.getTime()) || isNaN(fin.getTime())) return;
        let heureDebut = debut.getHours() + debut.getMinutes() / 60;
        let heureFin = fin.getHours() + fin.getMinutes() / 60;
        if (debut.getDate() !== dateJour.getDate() || debut.getMonth() !== dateJour.getMonth() || debut.getFullYear() !== dateJour.getFullYear()) heureDebut = 0;
        if (fin.getDate() !== dateJour.getDate() || fin.getMonth() !== dateJour.getMonth() || fin.getFullYear() !== dateJour.getFullYear()) heureFin = 24;
        heureDebut = Math.max(0, Math.min(24, heureDebut));
        heureFin = Math.max(0, Math.min(24, heureFin));
        const duree = heureFin - heureDebut;
        if (duree <= 0) return;

        const isInstructeur = typeof correspondanceNom === 'function' && correspondanceNom(f['Instructeur'], nom);
        const machineIds = Array.isArray(f['Machine']) ? f['Machine'] : [f['Machine']].filter(Boolean);
        const machineId = machineIds[0];
        const avion = (typeof listeAvionsCache !== 'undefined' ? listeAvionsCache : []).find(a => a.id === machineId);
        const immat = (avion && (avion.fields['Immatriculation'] || avion.fields['Nom'] || '')) || machineId || '';
        const pilote = (f['Pilote'] || '').toString().trim();

        const barresDiv = document.createElement('div');
        barresDiv.className = 'reservation-bar';
        if (isInstructeur) {
            barresDiv.classList.add('reservation-avec-instructeur');
            barresDiv.classList.add('reservation-instruction');
        }
        if (duree <= 1) barresDiv.classList.add('short-reservation');
        barresDiv.style.left = `${positionHeure(heureDebut)}%`;
        barresDiv.style.width = `${positionHeure(heureFin) - positionHeure(heureDebut)}%`;
        barresDiv.style.top = '8px';
        barresDiv.style.height = '30px';
        barresDiv.title = `${pilote} — ${immat}${isInstructeur ? ' (Instruction)' : ''}`;
        const libelle = duree > 1 ? `${immat}` : '';
        barresDiv.innerHTML = `<strong>${libelle}</strong>`;
        barresDiv.addEventListener('click', (e) => { e.stopPropagation(); if (typeof ouvrirModaleModification === 'function') ouvrirModaleModification(r.id); });
        inner.appendChild(barresDiv);
        barresInfos.push({ bar: barresDiv, debut: heureDebut, fin: heureFin });
    });

    afficherConflitsReservations(barresInfos);

    tr.appendChild(tdCell);
}

async function chargerSuiviInstructeur() {
    const tbody = document.getElementById('instructeur-table-body');
    if (!tbody) return;

    const sel = document.getElementById('select-instructeur-suivi');
    if (!instructeurSelectionne && sel && sel.value) instructeurSelectionne = sel.value;
    if (!instructeurSelectionne) {
        tbody.innerHTML = '<tr><td colspan="2" style="padding:15px;">Sélectionnez un instructeur pour afficher son planning.</td></tr>';
        return;
    }
    if (sel && sel.value !== instructeurSelectionne) sel.value = instructeurSelectionne;

    tbody.innerHTML = '<tr><td colspan="2" style="padding:15px;">Chargement...</td></tr>';

    const start = new Date(dateInstructeurSuivi);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 14);
    end.setHours(23, 59, 59, 999);

    const [dispos, reservations] = await Promise.all([
        chargerDisposInstructeurPlage(start, end),
        chargerReservationsInstructeurPlage(instructeurSelectionne, start, end)
    ]);

    tbody.innerHTML = '';
    for (let i = 0; i < 14; i++) {
        const dateJour = new Date(start);
        dateJour.setDate(start.getDate() + i);
        const dateJourStr = `${dateJour.getFullYear()}-${String(dateJour.getMonth() + 1).padStart(2, '0')}-${String(dateJour.getDate()).padStart(2, '0')}`;

        const disposJour = dispos.filter(r => {
            const f = r.fields || {};
            const d = f['Date'] ? new Date(f['Date']).toISOString().split('T')[0] : '';
            const nomOk = typeof correspondanceNom === 'function'
                ? correspondanceNom(f['Instructeur'], instructeurSelectionne)
                : (f['Instructeur'] || '').toString().trim() === instructeurSelectionne;
            return d === dateJourStr && nomOk;
        });

        const reservationsJour = reservations.filter(r => {
            const f = r.fields || {};
            const resStart = new Date(f['Date de début']);
            const resEnd = new Date(f['Date de fin']);
            const dayStart = new Date(dateJour);
            const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
            return resStart < dayEnd && resEnd > dayStart;
        });

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #e2e8f0';
        rendreLigneInstructeur(tr, dateJour, disposJour, reservationsJour, instructeurSelectionne);
        tbody.appendChild(tr);
    }
}
