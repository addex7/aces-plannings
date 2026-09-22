/* ==========================================================================
   PLANNING INSTRUCTEUR - VUE 14 JOURS
   ========================================================================== */

const TABLE_RESERVATIONS = 'Réservations';

let dateInstructeurSuivi = new Date();
let instructeurSelectionne = '';
let activiteSelectionnee = '';
let dragDispo = null;

function peutModifierDisposInstructeur(nom) {
    const cible = nom || instructeurSelectionne;
    if (!cible) return false;
    return typeof estUtilisateurCourant === 'function' && estUtilisateurCourant(cible);
}

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
    let html = '<optgroup label="Vue par activité">';
    [['avion', '✈️ Avion'], ['ULM', '🛩️ ULM'], ['planeur', '🪂 Planeur']].forEach(([v, l]) => {
        html += `<option value="__act:${v}" ${activiteSelectionnee === v ? 'selected' : ''}>${l} — tous les instructeurs</option>`;
    });
    html += '</optgroup><optgroup label="Par instructeur">';
    instructeurs.forEach(u => {
        html += `<option value="${u.nomComplet}" ${!activiteSelectionnee && u.nomComplet === instructeurSelectionne ? 'selected' : ''}>${u.nomComplet}</option>`;
    });
    html += '</optgroup>';
    sel.innerHTML = html;
}

function initPlanningInstructeur() {
    initBoutonDisponibiliteInstructeur();
    const btnPrev = document.getElementById('btn-instructeur-prev');
    const btnNext = document.getElementById('btn-instructeur-next');
    const dateEl = document.getElementById('current-date-instructeur');
    const sel = document.getElementById('select-instructeur-suivi');

    if (!btnPrev || !btnNext || !dateEl || !sel) return;

    if (!instructeurSelectionne && currentUser && typeof estInstructeur === 'function' && estInstructeur()) {
        const nomComplet = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
        if (nomComplet) instructeurSelectionne = nomComplet;
    }

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
            if (sel.value.startsWith('__act:')) {
                activiteSelectionnee = sel.value.slice(6);
            } else {
                activiteSelectionnee = '';
                instructeurSelectionne = sel.value;
            }
            chargerSuiviInstructeur();
        });
        sel.dataset.ready = '1';
    }

    if (!window.__dragDispoInit) {
        window.addEventListener('mouseup', finaliserDragDisponibilite);
        window.__dragDispoInit = true;
    }

    peuplerSelectInstructeurSuivi().then(() => {
        if (!instructeurSelectionne && sel.options.length > 0) {
            const premierePers = Array.from(sel.options).find(o => !o.value.startsWith('__act:'));
            if (premierePers) {
                sel.value = premierePers.value;
                instructeurSelectionne = sel.value;
            }
        }
        if (instructeurSelectionne || activiteSelectionnee) chargerSuiviInstructeur();
    });
}

async function chargerDisposInstructeurPlage(start, end) {
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    const formula = `AND(DATETIME_FORMAT({Date},'YYYY-MM-DD')>='${startStr}', DATETIME_FORMAT({Date},'YYYY-MM-DD')<='${endStr}')`;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DISPONIBILITES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers }, API_CACHE_TTL, true);
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
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_RESERVATIONS)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers });
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

async function supprimerDisposChevauchantes(dateStr, debutMin, finMin, nom, conserverRestes = false, discipline = '') {
    const selStart = debutMin;
    const selEnd = finMin;
    const formula = `DATETIME_FORMAT({Date},'YYYY-MM-DD')='${dateStr}'`;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DISPONIBILITES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers }, API_CACHE_TTL, true);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        const discLow = (discipline || '').toLowerCase();
        const records = (data.records || []).filter(r => {
            const f = r.fields || {};
            const nomOk = typeof correspondanceNom === 'function'
                ? correspondanceNom(f['Instructeur'], nom)
                : (f['Instructeur'] || '').toString().trim() === nom;
            if (!nomOk) return false;
            if (discLow) {
                const mach = (f['Machine'] || '').toString().trim().toLowerCase();
                if (mach && mach !== discLow) return false;
            }
            const [hs, ms] = String(f['Heure début'] || '00:00').split(':').map(Number);
            const [he, me] = String(f['Heure fin'] || '00:00').split(':').map(Number);
            const startMin = hs * 60 + (ms || 0);
            const endMin = (he * 60 + (me || 0)) || 1440;
            return !(endMin <= selStart || startMin >= selEnd);
        });
        const ids = records.map(r => r.id);
        for (let i = 0; i < ids.length; i += 10) {
            const batch = ids.slice(i, i + 10);
            const query = batch.map(id => `records[]=${encodeURIComponent(id)}`).join('&');
            await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DISPONIBILITES)}?${query}`, { method: 'DELETE', headers });
        }
        if (conserverRestes) {
            const aConserver = [];
            records.forEach(r => {
                const f = r.fields || {};
                const estDispo = f['Disponible'] === true || f['Disponible'] === 'true' || f['Disponible'] === 1 || f['Disponible'] === '1';
                if (!estDispo) return;
                const [hs, ms] = String(f['Heure début'] || '00:00').split(':').map(Number);
                const [he, me] = String(f['Heure fin'] || '00:00').split(':').map(Number);
                const recStart = hs * 60 + (ms || 0);
                const recEnd = (he * 60 + (me || 0)) || 1440;
                const machRec = (f['Machine'] || '').toString().trim();
                if (recStart < selStart) aConserver.push({ start: recStart, end: Math.min(selStart, recEnd), machine: machRec });
                if (recEnd > selEnd) aConserver.push({ start: Math.max(selEnd, recStart), end: recEnd, machine: machRec });
            });
            if (aConserver.length) {
                const newRecords = aConserver.map(iv => {
                    const hStart = Math.floor(iv.start / 60);
                    const mStart = iv.start % 60;
                    const hEnd = Math.floor(iv.end / 60);
                    const mEnd = iv.end % 60;
                    const debut = `${String(hStart).padStart(2, '0')}:${String(mStart).padStart(2, '0')}`;
                    const fin = iv.end === 1440 ? '00:00' : `${String(hEnd).padStart(2, '0')}:${String(mEnd).padStart(2, '0')}`;
                    return { fields: { 'Date': dateStr, 'Heure début': debut, 'Heure fin': fin, 'Machine': iv.machine || discipline || '', 'Disponible': true, 'Instructeur': nom } };
                });
                for (let i = 0; i < newRecords.length; i += 10) {
                    const batch = newRecords.slice(i, i + 10);
                    await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DISPONIBILITES)}`, { method: 'POST', headers, body: JSON.stringify({ records: batch }) });
                }
            }
        }
    } catch (err) { console.error('[SUPPRIMER DISPOS]', err); }
}

async function enregistrerPlageDisponibilite(dateStr, debutMin, finMin, dispo, discipline = '', nomCible = '') {
    const nom = nomCible || instructeurSelectionne || (typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '');
    if (!nom) { alert('Aucun instructeur sélectionné.'); return; }
    if (typeof estUtilisateurCourant === 'function' && !estUtilisateurCourant(nom)) { alert("Seul l'instructeur concerné peut modifier ses disponibilités."); return; }
    await supprimerDisposChevauchantes(dateStr, debutMin, finMin, nom, !dispo, discipline);
    if (!dispo) {
        if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false);
        if (typeof chargerSuiviInstructeur === 'function') await chargerSuiviInstructeur();
        return;
    }
    const fmtMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const debut = fmtMin(debutMin);
    const fin = finMin >= 1440 ? '23:59' : fmtMin(finMin);
    const fields = { 'Date': dateStr, 'Heure début': debut, 'Heure fin': fin, 'Machine': discipline || '', 'Disponible': dispo, 'Instructeur': nom };
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DISPONIBILITES)}`, { method: 'POST', headers, body: JSON.stringify({ records: [{ fields }] }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        if (typeof enregistrerAudit === 'function') await enregistrerAudit('Création disponibilité', nom, `Instructeur : ${nom} | Date : ${dateStr} | ${debut} - ${fin} | Disponible`, 'Instructeur');
        if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false);
        if (typeof chargerSuiviInstructeur === 'function') await chargerSuiviInstructeur();
    } catch (err) {
        console.error(err);
        alert('Erreur : ' + (err.message || ''));
    }
}

function mettreAJourSurlignementDrag() {
    if (!dragDispo || !dragDispo.actif) return;
    const hStart = parseInt(dragDispo.start.dataset.slot, 10);
    const hEnd = parseInt(dragDispo.end.dataset.slot, 10);
    const date = dragDispo.start.dataset.date;
    const hMin = Math.min(hStart, hEnd);
    const hMax = Math.max(hStart, hEnd);
    document.querySelectorAll('.grid-hour-block').forEach(el => {
        const h = parseInt(el.dataset.slot, 10);
        const discOk = !dragDispo.discipline || el.dataset.discipline === dragDispo.discipline;
        const nomOk = !dragDispo.nom || el.dataset.nom === dragDispo.nom;
        const isIn = discOk && nomOk && el.dataset.date === date && h >= hMin && h <= hMax;
        el.style.outline = isIn ? '2px solid #1e3d59' : '';
    });
}

function finaliserDragDisponibilite() {
    if (!dragDispo || !dragDispo.actif) return;
    const start = dragDispo.start;
    const end = dragDispo.end;
    const dispo = dragDispo.dispo;
    const nomCible = dragDispo.nom || '';
    dragDispo = null;
    document.querySelectorAll('.grid-hour-block').forEach(el => { el.style.outline = ''; });
    if (start.dataset.date !== end.dataset.date) return;
    if (start.dataset.discipline !== end.dataset.discipline) return;
    if ((start.dataset.nom || '') !== (end.dataset.nom || '')) return;
    const hStart = parseInt(start.dataset.slot, 10);
    const hEnd = parseInt(end.dataset.slot, 10);
    const sDebut = Math.min(hStart, hEnd);
    const sFin = Math.max(hStart, hEnd);
    enregistrerPlageDisponibilite(start.dataset.date, sDebut * 30, (sFin + 1) * 30, dispo, start.dataset.discipline || '', nomCible);
}

function disciplinesInstructeur(nom) {
    let roles = [];
    const u = (typeof listeInstructeursCache !== 'undefined' ? listeInstructeursCache : [])
        .find(x => typeof correspondanceNom === 'function' ? correspondanceNom(x.nomComplet, nom) : x.nomComplet === nom);
    if (u) roles = u.roles || [];
    if (!roles.length && currentUser && typeof correspondanceNom === 'function'
        && correspondanceNom(`${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim(), nom)) {
        roles = currentUser.roles || [];
    }
    const d = [];
    if (roles.includes('Instructeur avion')) d.push('avion');
    if (roles.includes('Instructeur ULM')) d.push('ULM');
    if (roles.includes('Instructeur planeur')) d.push('planeur');
    return d.length ? d : ['avion'];
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
    inner.style.cssText = 'display: block; position: relative; height: 100%; width: 100%;';

    ajouterFondNuit(inner, dateJour);

    const disciplines = disciplinesInstructeur(nom);
    const nbLignes = disciplines.length;
    const stack = document.createElement('div');
    stack.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; z-index:2;';

    const peutModifier = peutModifierDisposInstructeur();
    disciplines.forEach((disc, idx) => {
        const ligne = document.createElement('div');
        ligne.style.cssText = `position:relative; height:${100 / nbLignes}%; display:flex;` + (idx < nbLignes - 1 ? 'border-bottom:1px dashed #cbd5e1; box-sizing:border-box;' : '');

        const lab = document.createElement('div');
        lab.className = 'dispo-discipline-label';
        lab.textContent = disc === 'avion' ? 'Avion' : (disc === 'ULM' ? 'ULM' : 'Planeur');
        ligne.appendChild(lab);

        const blocks = new Array(48).fill('red');
        const discLow = disc.toLowerCase();
        disposJour.forEach(d => {
            const f = d.fields || {};
            if (typeof dispoConcerneDiscipline === 'function' && !dispoConcerneDiscipline(f['Machine'], discLow)) return;
            const [hStart, mStart] = String(f['Heure début'] || '00:00').split(':').map(Number);
            const [hEnd, mEnd] = String(f['Heure fin'] || '00:00').split(':').map(Number);
            const startMin = hStart * 60 + (mStart || 0);
            const endMin = hEnd * 60 + (mEnd || 0);
            const estDispo = f['Disponible'] === true || f['Disponible'] === 'true' || f['Disponible'] === 1 || f['Disponible'] === '1';
            for (let s = 0; s < 48; s++) {
                if (s * 30 < startMin || (s + 1) * 30 > endMin) continue;
                blocks[s] = estDispo ? 'green' : 'red';
            }
        });

        for (let s = 0; s < 48; s++) {
            const d = document.createElement('div');
            d.className = 'grid-hour-block';
            d.style.flex = LARGEURS_HEURES[Math.floor(s / 2)] / 2;
            d.style.cursor = peutModifier ? 'pointer' : 'default';
            d.style.userSelect = 'none';
            d.dataset.date = dateStr;
            d.dataset.slot = s;
            d.dataset.dispo = blocks[s];
            d.dataset.discipline = disc;
            if (peutModifier) {
                d.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    dragDispo = { start: d, end: d, actif: true, dispo: d.dataset.dispo !== 'green', discipline: disc };
                    mettreAJourSurlignementDrag();
                });
                d.addEventListener('mouseenter', () => {
                    if (!dragDispo || !dragDispo.actif) return;
                    dragDispo.end = d;
                    mettreAJourSurlignementDrag();
                });
            }
            const overlay = document.createElement('div');
            overlay.className = `dispo-hour-overlay dispo-${blocks[s]}`;
            d.appendChild(overlay);
            ligne.appendChild(d);
        }
        stack.appendChild(ligne);
    });
    inner.appendChild(stack);

    tdCell.appendChild(inner);

    ajouterBarresJour(reservationsJour, dateJour, inner, nom, '8px', '30px');
    tr.appendChild(tdCell);
}

function ajouterBarresJour(reservationsJour, dateJour, conteneur, filtreNom, barTop, barHeight) {
    const barresInfos = [];
    reservationsJour.forEach(r => {
        const f = r.fields || {};
        const type = (f['Type'] || f['Type de vol'] || 'Vol Classique');
        const typesVol = Array.isArray(type) ? type : [type];
        const piloteNom = (typeof nomUtilisateurDepuisId === 'function') ? nomUtilisateurDepuisId(f['Pilote'], listeMembresCache) : (f['Pilote'] || '');
        const instructeurNom = (typeof nomUtilisateurDepuisId === 'function') ? nomUtilisateurDepuisId(f['Instructeur'], listeMembresCache) : (f['Instructeur'] || '');
        const passagerNom = (f['Passager'] || f['Nom'] || '').toString().trim();
        if (filtreNom && typeof correspondanceNom === 'function'
            && !correspondanceNom(piloteNom, filtreNom) && !correspondanceNom(instructeurNom, filtreNom)) return;
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

        const machineIds = Array.isArray(f['Machine']) ? f['Machine'] : [f['Machine']].filter(Boolean);
        const machineId = machineIds[0];
        const avion = (typeof listeAvionsCache !== 'undefined' ? listeAvionsCache : []).find(a => a.id === machineId);
        const immat = (avion && (avion.fields['Immatriculation'] || avion.fields['Nom'] || '')) || machineId || '';
        const piloteFormate = (typeof formaterNomPilote === 'function') ? formaterNomPilote(piloteNom) : piloteNom;
        const isVIMoteur = typesVol.includes('VI Moteur');
        const isAncienVI = typesVol.includes("Vol d'Initiation") || typesVol.includes("Vol d'Initiation (VI)");
        const isInstruction = typesVol.includes('Instruction');
        const isCreneau = r._table === 'VI Créneaux';
        const estMoi = (typeof estUtilisateurCourant === 'function') && (estUtilisateurCourant(piloteNom) || estUtilisateurCourant(instructeurNom));

        const barresDiv = document.createElement('div');
        barresDiv.className = 'reservation-bar';
        if (duree <= 2) barresDiv.classList.add('short-reservation');
        if (estMoi) barresDiv.classList.add('ma-reservation');
        let libelleEntete = piloteFormate || 'Pilote non défini';
        if (instructeurNom) {
            barresDiv.classList.add('reservation-avec-instructeur');
            const trigramme = trouverTrigrammeInstructeur(instructeurNom);
            if (trigramme) libelleEntete += ` — ${trigramme}`;
            libelleEntete += ' (Instruction)';
        }
        if (isVIMoteur || isAncienVI) {
            if (!piloteNom || piloteNom.trim() === '') {
                barresDiv.classList.add('vi-sans-pilote');
                const suffix = passagerNom || 'dispo';
                libelleEntete = isVIMoteur ? `🎯 VI Moteur — ${suffix}` : `🎯 VI — ${suffix}`;
            } else {
                barresDiv.classList.add('vi-avec-pilote');
                libelleEntete = isVIMoteur ? `🎯 VI Moteur (${piloteFormate})` : `🎯 VI (${piloteFormate})`;
            }
        } else if (isCreneau || (f['Type'] && !isInstruction)) {
            barresDiv.classList.add('vi-avec-pilote');
            libelleEntete = piloteFormate ? `🎯 ${type} (${piloteFormate})` : `🎯 ${type} DISPONIBLE`;
        }
        barresDiv.style.left = `${positionHeure(heureDebut)}%`;
        barresDiv.style.width = `${positionHeure(heureFin) - positionHeure(heureDebut)}%`;
        barresDiv.style.top = barTop;
        barresDiv.style.height = barHeight;
        barresDiv.title = `${libelleEntete} — ${immat}`;
        barresDiv.innerHTML = `<strong>${libelleEntete}</strong>`;
        barresDiv.addEventListener('click', (e) => { e.stopPropagation(); if (typeof ouvrirModaleModification === 'function') ouvrirModaleModification(r.id); });
        conteneur.appendChild(barresDiv);
        barresInfos.push({ bar: barresDiv, debut: heureDebut, fin: heureFin });
    });

    afficherConflitsReservations(barresInfos);
}

function instructeursPourDiscipline(discipline) {
    const roleMap = { avion: 'Instructeur avion', ulm: 'Instructeur ULM', planeur: 'Instructeur planeur' };
    const role = roleMap[(discipline || '').toLowerCase()];
    if (!role) return [];
    return (typeof listeInstructeursCache !== 'undefined' ? listeInstructeursCache : [])
        .filter(u => (u.roles || []).includes(role))
        .sort((a, b) => (a.nomComplet || '').localeCompare(b.nomComplet || ''));
}

function rendreLigneActivite(tr, dateJour, disposJour, reservationsJour, discipline) {
    const dateStr = `${dateJour.getFullYear()}-${String(dateJour.getMonth() + 1).padStart(2, '0')}-${String(dateJour.getDate()).padStart(2, '0')}`;
    const tdDate = document.createElement('td');
    tdDate.style.cssText = 'padding: 12px 10px; font-weight: bold; color: #1e3d59; vertical-align: middle;';
    tdDate.textContent = dateJour.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    tr.appendChild(tdDate);

    const instructeurs = instructeursPourDiscipline(discipline);
    const nbLignes = Math.max(1, instructeurs.length);
    const tdCell = document.createElement('td');
    tdCell.style.cssText = `padding: 4px; height: ${Math.max(46, nbLignes * 20)}px; vertical-align: middle;`;

    const inner = document.createElement('div');
    inner.style.cssText = 'display: block; position: relative; height: 100%; width: 100%;';
    ajouterFondNuit(inner, dateJour);

    const stack = document.createElement('div');
    stack.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; z-index:2;';

    const discLow = (discipline || '').toLowerCase();
    if (!instructeurs.length) {
        const ligne = document.createElement('div');
        ligne.style.cssText = 'position:relative; height:100%; display:flex; align-items:center; color:#94a3b8; font-size:11px; padding-left:8px;';
        ligne.textContent = 'Aucun instructeur pour cette activité';
        stack.appendChild(ligne);
    }
    instructeurs.forEach((u, idx) => {
        const nom = u.nomComplet;
        const ligne = document.createElement('div');
        ligne.style.cssText = `position:relative; height:${100 / nbLignes}%; display:flex; overflow:hidden;` + (idx < nbLignes - 1 ? 'border-bottom:1px dashed #cbd5e1; box-sizing:border-box;' : '');

        const lab = document.createElement('div');
        lab.className = 'dispo-discipline-label';
        lab.textContent = u.trigramme || (u.prenom || nom);
        ligne.appendChild(lab);

        const blocks = new Array(48).fill('red');
        disposJour.forEach(d => {
            const f = d.fields || {};
            if (typeof correspondanceNom === 'function' && !correspondanceNom(f['Instructeur'], nom)) return;
            if (typeof dispoConcerneDiscipline === 'function' && !dispoConcerneDiscipline(f['Machine'], discLow)) return;
            const [hStart, mStart] = String(f['Heure début'] || '00:00').split(':').map(Number);
            const [hEnd, mEnd] = String(f['Heure fin'] || '00:00').split(':').map(Number);
            const startMin = hStart * 60 + (mStart || 0);
            const endMin = (hEnd * 60 + (mEnd || 0)) || 1440;
            const estDispo = f['Disponible'] === true || f['Disponible'] === 'true' || f['Disponible'] === 1 || f['Disponible'] === '1';
            for (let s = 0; s < 48; s++) {
                if (s * 30 < startMin || (s + 1) * 30 > endMin) continue;
                blocks[s] = estDispo ? 'green' : 'red';
            }
        });

        const peutModifier = peutModifierDisposInstructeur(nom);
        for (let s = 0; s < 48; s++) {
            const d = document.createElement('div');
            d.className = 'grid-hour-block';
            d.style.flex = LARGEURS_HEURES[Math.floor(s / 2)] / 2;
            d.style.cursor = peutModifier ? 'pointer' : 'default';
            d.style.userSelect = 'none';
            d.dataset.date = dateStr;
            d.dataset.slot = s;
            d.dataset.dispo = blocks[s];
            d.dataset.discipline = discipline;
            d.dataset.nom = nom;
            if (peutModifier) {
                d.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    dragDispo = { start: d, end: d, actif: true, dispo: d.dataset.dispo !== 'green', discipline, nom };
                    mettreAJourSurlignementDrag();
                });
                d.addEventListener('mouseenter', () => {
                    if (!dragDispo || !dragDispo.actif) return;
                    dragDispo.end = d;
                    mettreAJourSurlignementDrag();
                });
            }
            const overlay = document.createElement('div');
            overlay.className = `dispo-hour-overlay dispo-${blocks[h]}`;
            d.appendChild(overlay);
            ligne.appendChild(d);
        }
        ajouterBarresJour(reservationsJour, dateJour, ligne, nom, '1px', 'calc(100% - 2px)');
        stack.appendChild(ligne);
    });
    inner.appendChild(stack);
    tdCell.appendChild(inner);
    tr.appendChild(tdCell);
}

async function chargerReservationsPlage(start, end) {
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    const formula = `AND(DATETIME_FORMAT({Date de début},'YYYY-MM-DD')<='${endStr}', DATETIME_FORMAT({Date de fin},'YYYY-MM-DD')>='${startStr}')`;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_RESERVATIONS)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur API');
        return data.records || [];
    } catch (err) { console.error(err); return []; }
}

async function basculerDisponibiliteHeure(dateStr, heure, estDisponible) {
    if (!instructeurSelectionne && typeof nomPiloteCourant === 'function') instructeurSelectionne = nomPiloteCourant();
    if (!instructeurSelectionne) { alert('Aucun instructeur sélectionné.'); return; }
    if (!peutModifierDisposInstructeur()) { alert("Seul l'instructeur concerné peut modifier ses disponibilités."); return; }
    const nom = instructeurSelectionne;
    const debut = `${String(heure).padStart(2, '0')}:00`;
    const fin = heure < 23 ? `${String(heure + 1).padStart(2, '0')}:00` : '23:59';
    const dispo = !estDisponible;
    const fields = { 'Date': dateStr, 'Heure début': debut, 'Heure fin': fin, 'Machine': '', 'Disponible': dispo, 'Instructeur': nom };
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DISPONIBILITES)}`, { method: 'POST', headers, body: JSON.stringify({ records: [{ fields }] }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        if (typeof enregistrerAudit === 'function') await enregistrerAudit('Bascule disponibilité', nom, `Instructeur : ${nom} | Date : ${dateStr} | ${debut} - ${fin} | ${dispo ? 'Disponible' : 'Indisponible'}`, 'Instructeur');
        if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false);
        if (typeof chargerSuiviInstructeur === 'function') await chargerSuiviInstructeur();
    } catch (err) {
        console.error(err);
        alert('Erreur : ' + (err.message || ''));
    }
}

async function chargerSuiviInstructeur() {
    const tbody = document.getElementById('instructeur-table-body');
    if (!tbody) return;

    const sel = document.getElementById('select-instructeur-suivi');
    const selAct = document.getElementById('select-activite-suivi');
    const activite = selAct ? selAct.value : activiteSelectionnee;
    activiteSelectionnee = activite;
    if (!activite) {
        if (!instructeurSelectionne && sel && sel.value) instructeurSelectionne = sel.value;
        if (!instructeurSelectionne) {
            tbody.innerHTML = '<tr><td colspan="2" style="padding:15px;">Sélectionnez un instructeur pour afficher son planning.</td></tr>';
            return;
        }
        if (sel && sel.value !== instructeurSelectionne) sel.value = instructeurSelectionne;
    }

    tbody.innerHTML = '<tr><td colspan="2" style="padding:15px;">Chargement...</td></tr>';

    const start = new Date(dateInstructeurSuivi);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 14);
    end.setHours(23, 59, 59, 999);

    const [dispos, reservations] = await Promise.all([
        chargerDisposInstructeurPlage(start, end),
        activite ? chargerReservationsPlage(start, end) : chargerReservationsInstructeurPlage(instructeurSelectionne, start, end)
    ]);

    tbody.innerHTML = '';
    for (let i = 0; i < 14; i++) {
        const dateJour = new Date(start);
        dateJour.setDate(start.getDate() + i);
        const dateJourStr = `${dateJour.getFullYear()}-${String(dateJour.getMonth() + 1).padStart(2, '0')}-${String(dateJour.getDate()).padStart(2, '0')}`;

        const disposJour = dispos.filter(r => {
            const f = r.fields || {};
            const d = f['Date'] ? new Date(f['Date']).toISOString().split('T')[0] : '';
            if (d !== dateJourStr) return false;
            if (activite) return true;
            return typeof correspondanceNom === 'function'
                ? correspondanceNom(f['Instructeur'], instructeurSelectionne)
                : (f['Instructeur'] || '').toString().trim() === instructeurSelectionne;
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
        if (activite) rendreLigneActivite(tr, dateJour, disposJour, reservationsJour, activite);
        else rendreLigneInstructeur(tr, dateJour, disposJour, reservationsJour, instructeurSelectionne);
        tbody.appendChild(tr);
    }
}
