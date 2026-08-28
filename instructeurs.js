const TABLE_DISPONIBILITES = 'Disponibilités instructeurs';
const ROLES_INSTRUCTEUR = ['Instructeur avion', 'Instructeur ULM'];
let afficherDisposInstructeurs = false;
let disposInstructeursCache = [];
let listeInstructeursCache = [];

function normaliserNom(n) {
    return (n || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function correspondanceNom(a, b) {
    const na = normaliserNom(a);
    const nb = normaliserNom(b);
    if (!na || !nb) return false;
    return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

function trouverTrigrammeInstructeur(nom) {
    if (!nom) return '';
    const u = listeInstructeursCache.find(x => correspondanceNom(x.nomComplet, nom));
    if (u && u.trigramme) return u.trigramme;
    if (currentUser && currentUser.trigramme && correspondanceNom(currentUser.prenom + ' ' + currentUser.nom, nom)) return currentUser.trigramme;
    return '';
}

function estInstructeur() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    const roles = currentUser.roles || [];
    return roles.some(r => (r || '').toString().trim().toLowerCase().includes('instructeur'));
}

function estInstructeurParNom(nom) {
    if (!nom) return false;
    const u = listeInstructeursCache.find(x => `${x.prenom || ''} ${x.nom || ''}`.trim().toLowerCase() === nom.toLowerCase());
    return u ? (u.roles || []).some(r => (r || '').toString().trim().toLowerCase().includes('instructeur')) : false;
}

function initBoutonDisponibiliteInstructeur() {
    const headerRow = document.querySelector('#view-instructeur header > div');
    if (!headerRow) return;
    const ref = document.getElementById('select-instructeur-suivi');
    const visible = (estInstructeur() || (typeof isSuperAdmin === 'function' && isSuperAdmin())) ? 'inline-block' : 'none';

    if (!document.getElementById('btn-gerer-dispos')) {
        const btnGerer = document.createElement('button');
        btnGerer.id = 'btn-gerer-dispos';
        btnGerer.className = 'btn-toggle';
        btnGerer.textContent = 'Gérer mes dispos';
        btnGerer.addEventListener('click', ouvrirModaleGererDispos);
        if (ref) {
            ref.parentNode.insertBefore(btnGerer, ref.nextSibling);
        } else {
            headerRow.appendChild(btnGerer);
        }
        btnGerer.style.display = visible;
    }

    if (!document.getElementById('btn-declarer-disponibilite')) {
        const btnDecl = document.createElement('button');
        btnDecl.id = 'btn-declarer-disponibilite';
        btnDecl.className = 'btn-primary';
        btnDecl.textContent = '+ Déclarer mes dispos';
        btnDecl.addEventListener('click', ouvrirModaleDisponibilite);
        const gerer = document.getElementById('btn-gerer-dispos');
        if (ref) {
            ref.parentNode.insertBefore(btnDecl, gerer ? gerer.nextSibling : ref.nextSibling);
        } else {
            headerRow.appendChild(btnDecl);
        }
        btnDecl.style.display = visible;
    }
    attacherListenersGererDispos();
}

function attacherListenersGererDispos() {
    const modal = document.getElementById('gerer-dispos-modal');
    if (!modal) return;
    const close = modal.querySelector('.close-modal-gerer-dispos');
    if (close) close.addEventListener('click', fermerModaleGererDispos);
    if (!modal.dataset.gererInstruit) {
        modal.addEventListener('click', (e) => { if (e.target === modal) fermerModaleGererDispos(); });
        modal.dataset.gererInstruit = '1';
    }
}

function initDisponibilitesInstructeurs() {
    const headerActions = document.querySelector('#view-planning .header-actions');
    if (!headerActions) return;

    if (!document.getElementById('btn-toggle-dispos-instructeurs')) {
        const btnToggle = document.createElement('button');
        btnToggle.id = 'btn-toggle-dispos-instructeurs';
        btnToggle.className = 'btn-toggle';
        btnToggle.title = 'Afficher/Masquer les disponibilités';
        btnToggle.textContent = 'Dispos instructeurs';
        btnToggle.addEventListener('click', basculerDisposInstructeurs);
        const ref = document.getElementById('btn-toggle-vi-planeur');
        headerActions.insertBefore(btnToggle, ref);
    }

    const btnToggle = document.getElementById('btn-toggle-dispos-instructeurs');
    if (btnToggle) btnToggle.style.display = 'inline-block';

    mettreAJourBoutonDisposInstructeurs();
    attacherListenersModaleDisponibilite();
    attacherListenersSuiviInstructeur();
    chargerListeInstructeurs().then(() => { if (document.getElementById('form-instructeur')) peuplerInstructeursSelect(); });
}

function mettreAJourBoutonDisposInstructeurs() {
    const btn = document.getElementById('btn-toggle-dispos-instructeurs');
    if (btn) btn.classList.toggle('active', afficherDisposInstructeurs);
}

function basculerDisposInstructeurs() {
    afficherDisposInstructeurs = !afficherDisposInstructeurs;
    mettreAJourBoutonDisposInstructeurs();
    if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false);
}

function attacherListenersModaleDisponibilite() {
    const modal = document.getElementById('disponibilite-instructeur-modal');
    if (!modal) return;
    const close = modal.querySelector('.close-modal-disponibilite');
    if (close) close.addEventListener('click', fermerModaleDisponibilite);
    modal.addEventListener('click', (e) => { if (e.target === modal) fermerModaleDisponibilite(); });
    const form = document.getElementById('form-disponibilite-instructeur');
    if (form && !form.dataset.instruit) {
        form.dataset.instruit = '1';
        form.addEventListener('submit', enregistrerDisponibilite);
    }
}

function attacherListenersSuiviInstructeur() {
    const modal = document.getElementById('instructeur-suivi-modal');
    if (!modal) return;
    const close = modal.querySelector('.close-modal-instructeur-suivi');
    if (close) close.addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

function ouvrirModaleDisponibilite() {
    const modal = document.getElementById('disponibilite-instructeur-modal');
    const form = document.getElementById('form-disponibilite-instructeur');
    if (!modal || !form) return;
    form.dataset.recordId = '';
    form.dataset.recordInstructeur = '';
    const d = dateAffichee || new Date();
    document.getElementById('dispo-date').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    document.getElementById('dispo-debut').value = '09:00';
    document.getElementById('dispo-fin').value = '11:00';
    const machineSel = document.getElementById('dispo-machine');
    if (machineSel) {
        let html = '<option value="Tous">Tous</option>';
        (listeAvionsCache || []).forEach(a => {
            const nom = a.fields && (a.fields['Immatriculation'] || a.fields['Nom']);
            if (nom) html += `<option value="${nom}">${nom}</option>`;
        });
        machineSel.innerHTML = html;
    }
    document.getElementById('dispo-disponible').checked = true;
    modal.style.display = 'flex';
}

function fermerModaleDisponibilite() {
    const modal = document.getElementById('disponibilite-instructeur-modal');
    if (modal) modal.style.display = 'none';
}

function editerDisponibilite(record) {
    const modal = document.getElementById('disponibilite-instructeur-modal');
    const form = document.getElementById('form-disponibilite-instructeur');
    if (!modal || !form) return;
    const f = record.fields || {};
    form.dataset.recordId = record.id;
    form.dataset.recordInstructeur = f['Instructeur'] || '';
    document.getElementById('dispo-date').value = f['Date'] || '';
    document.getElementById('dispo-debut').value = f['Heure début'] || '09:00';
    document.getElementById('dispo-fin').value = f['Heure fin'] || '11:00';
    const machineSel = document.getElementById('dispo-machine');
    if (machineSel) {
        let html = '<option value="Tous">Tous</option>';
        (listeAvionsCache || []).forEach(a => {
            const nom = a.fields && (a.fields['Immatriculation'] || a.fields['Nom']);
            if (nom) html += `<option value="${nom}">${nom}</option>`;
        });
        machineSel.innerHTML = html;
        if (f['Machine'] && (f['Machine'] === 'Tous' || machineSel.querySelector(`option[value="${f['Machine']}"]`))) {
            machineSel.value = f['Machine'];
        } else if (f['Machine']) {
            const opt = document.createElement('option');
            opt.value = f['Machine'];
            opt.textContent = f['Machine'];
            machineSel.appendChild(opt);
            machineSel.value = f['Machine'];
        }
    }
    document.getElementById('dispo-disponible').checked = f['Disponible'] !== false;
    fermerModaleGererDispos();
    modal.style.display = 'flex';
}

async function supprimerDisponibilite(record) {
    const f = record.fields || {};
    const dateFr = new Date(f['Date'] + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!confirm(`Supprimer la disponibilité du ${dateFr} de ${f['Heure début']} à ${f['Heure fin']} ?`)) return;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DISPONIBILITES)}/${record.id}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error('Erreur Airtable');
        if (typeof enregistrerAudit === 'function') {
            const nom = f['Instructeur'] || '';
            await enregistrerAudit('Suppression disponibilité', nom, `Instructeur : ${nom} | Date : ${f['Date'] || ''} | ${f['Heure début'] || ''} - ${f['Heure fin'] || ''} | Machine : ${f['Machine'] || ''}`, 'Instructeur');
        }
        if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false);
        if (typeof chargerSuiviInstructeur === 'function') await chargerSuiviInstructeur();
        await ouvrirModaleGererDispos();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la suppression : ' + (err.message || ''));
    }
}

function fermerModaleGererDispos() {
    const modal = document.getElementById('gerer-dispos-modal');
    if (modal) modal.style.display = 'none';
}

async function ouvrirModaleGererDispos() {
    const modal = document.getElementById('gerer-dispos-modal');
    const list = document.getElementById('gerer-dispos-list');
    if (!modal || !list) return;
    let nom = '';
    if (currentUser) {
        nom = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    }
    if (!nom && typeof nomPiloteCourant === 'function') nom = nomPiloteCourant();
    if (!nom) { alert('Connecte-toi pour gérer tes disponibilités.'); return; }
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const formula = `AND({Instructeur}='${nom}', DATETIME_FORMAT({Date},'YYYY-MM-DD')>='${todayStr}')`;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DISPONIBILITES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&sort[0][field]=Date&sort[0][direction]=asc`;
    try {
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        const records = data.records || [];
        const now = new Date();
        const futurs = records.filter(r => {
            const f = r.fields || {};
            const fin = `${f['Date']}T${f['Heure fin'] || '00:00'}:00`;
            return new Date(fin) >= now;
        });
        if (futurs.length === 0) {
            list.innerHTML = '<p style="color:#64748b;">Aucune disponibilité à venir.</p>';
        } else {
            list.innerHTML = futurs.map(r => {
                const f = r.fields;
                const dateFr = new Date(f['Date'] + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
                const statut = f['Disponible'] === false ? '<span style="color:#ef4444;font-size:12px;">Indisponible</span>' : '<span style="color:#17b978;font-size:12px;">Disponible</span>';
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #e2e8f0;">
                        <div style="font-size:13px;">
                            <strong>${dateFr}</strong> — ${f['Heure début']} à ${f['Heure fin']}<br>
                            <span style="color:#64748b; font-size:12px;">${f['Machine'] || 'Tous'}</span> — ${statut}
                        </div>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <button class="btn-primary" data-id="${r.id}" data-action="edit" style="font-size:12px; padding:6px 10px;">Modifier</button>
                            <button data-id="${r.id}" data-action="delete" style="font-size:12px; padding:6px 10px; background:#ef4444; color:white; border:none; border-radius:6px; cursor:pointer;">Supprimer</button>
                        </div>
                    </div>
                `;
            }).join('');
            list.querySelectorAll('button[data-id]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = e.target.dataset.id;
                    const record = futurs.find(r => r.id === id);
                    if (!record) return;
                    const action = e.target.dataset.action;
                    if (action === 'delete') supprimerDisponibilite(record);
                    else editerDisponibilite(record);
                });
            });
        }
        modal.style.display = 'flex';
    } catch (err) {
        console.error(err);
        alert('Erreur lors du chargement : ' + (err.message || ''));
    }
}

async function enregistrerDisponibilite(e) {
    e.preventDefault();
    let nom = '';
    if (currentUser) {
        nom = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    }
    if (!nom && typeof nomPiloteCourant === 'function') nom = nomPiloteCourant();
    if (!nom) { alert('Connecte-toi pour déclarer une disponibilité.'); return; }
    const date = document.getElementById('dispo-date').value;
    const debut = document.getElementById('dispo-debut').value;
    const fin = document.getElementById('dispo-fin').value;
    const machine = document.getElementById('dispo-machine').value;
    const dispo = document.getElementById('dispo-disponible').checked;
    if (!date || !debut || !fin) { alert('Remplis tous les champs.'); return; }
    if (debut >= fin) { alert('L\'heure de fin doit être après le début.'); return; }
    const form = document.getElementById('form-disponibilite-instructeur');
    const dispoId = form ? form.dataset.recordId : '';
    const fields = { 'Date': date, 'Heure début': debut, 'Heure fin': fin, 'Machine': machine, 'Disponible': dispo };
    if (!dispoId) fields['Instructeur'] = nom;
    const payload = { records: [{ ...(dispoId ? { id: dispoId } : {}), fields }] };
    const method = dispoId ? 'PATCH' : 'POST';
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DISPONIBILITES)}`, { method, headers, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        if (typeof enregistrerAudit === 'function') {
            const action = dispoId ? 'Modification disponibilité' : 'Création disponibilité';
            await enregistrerAudit(action, nom, `Instructeur : ${nom} | Date : ${date} | ${debut} - ${fin} | Machine : ${machine}`, 'Instructeur');
        }
        fermerModaleDisponibilite();
        if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false);
        if (typeof chargerSuiviInstructeur === 'function') await chargerSuiviInstructeur();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'enregistrement : ' + (err.message || ''));
    }
}

async function chargerDisponibilitesInstructeurs(dateCible, forceRefresh = false) {
    await chargerListeInstructeurs(forceRefresh);
    const dateStr = `${dateCible.getFullYear()}-${String(dateCible.getMonth() + 1).padStart(2, '0')}-${String(dateCible.getDate()).padStart(2, '0')}`;
    const formula = `DATETIME_FORMAT({Date},'YYYY-MM-DD')='${dateStr}'`;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DISPONIBILITES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
    try {
        console.log('[DISPOS] URL:', url);
        const res = await cachedFetch(url, { headers }, API_CACHE_TTL, forceRefresh);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        disposInstructeursCache = data.records || [];
        console.log('[DISPOS] records count:', disposInstructeursCache.length, 'for', dateStr);
        if (disposInstructeursCache.length) console.log('[DISPOS] first record:', disposInstructeursCache[0].fields);
    } catch (err) {
        console.error('[DISPOS] error:', err);
        disposInstructeursCache = [];
    }
    return disposInstructeursCache;
}

function afficherLignesInstructeurs(rowsContainer, soleil, disposFournis, reservationsFournis) {
    if (!afficherDisposInstructeurs) return;
    if (!listeInstructeursCache.length) return;
    const dispos = disposFournis || disposInstructeursCache;
    const reservations = reservationsFournis || [];
    console.log('[DISPOS] afficherLignes - liste:', listeInstructeursCache.map(u => u.nomComplet), 'dispos:', dispos.length, 'resas:', reservations.length);
    const instructeurs = [...new Set(listeInstructeursCache.map(u => u.nomComplet))].sort();
    const s = soleil || { aubeAero: 0, leverSoleil: 0, coucherSoleil: 24, crepusculeAero: 24 };
    const aubeAeroPercent = (Math.max(0, s.aubeAero) / 24) * 100;
    const leverPercent = (Math.max(0, s.leverSoleil) / 24) * 100;
    const coucherPercent = (Math.min(24, s.coucherSoleil) / 24) * 100;
    const crepusculeAeroPercent = (Math.min(24, s.crepusculeAero) / 24) * 100;

    function ajouterZoneNuit(grid, left, width, classe) {
        const div = document.createElement('div');
        div.className = `night-zone ${classe}`;
        div.style.left = left;
        div.style.width = width;
        grid.appendChild(div);
    }

    instructeurs.forEach(nom => {
        const disposPerso = dispos.filter(r => correspondanceNom(r.fields['Instructeur'], nom));
        const rowDiv = document.createElement('div');
        rowDiv.className = 'timeline-row instructeur-dispo-row';
        const machineCell = document.createElement('div');
        machineCell.className = 'machine-cell';
        const nomSpan = document.createElement('span');
        nomSpan.className = 'instructeur-nom';
        nomSpan.textContent = nom;
        nomSpan.addEventListener('click', () => {
            if (typeof instructeurSelectionne !== 'undefined') instructeurSelectionne = nom;
            if (typeof dateInstructeurSuivi !== 'undefined') {
                dateInstructeurSuivi = new Date(dateAffichee || new Date());
                dateInstructeurSuivi.setHours(12, 0, 0, 0);
            }
            console.log('[INSTRUCTEUR CLICK]', nom, typeof window.ouvrirModaleNouvelleReservation);
            if (typeof window.ouvrirModaleNouvelleReservation === 'function') {
                window.ouvrirModaleNouvelleReservation({ type: 'Instruction', instructeur: nom });
            }
        });
        machineCell.appendChild(nomSpan);
        rowDiv.appendChild(machineCell);
        const gridBg = document.createElement('div');
        gridBg.className = 'hours-grid-background dispo-grid';

        ajouterZoneNuit(gridBg, '0%', `${aubeAeroPercent}%`, 'night-aero');
        ajouterZoneNuit(gridBg, `${aubeAeroPercent}%`, `${leverPercent - aubeAeroPercent}%`, 'night-civil');
        ajouterZoneNuit(gridBg, `${coucherPercent}%`, `${crepusculeAeroPercent - coucherPercent}%`, 'night-civil');
        ajouterZoneNuit(gridBg, `${crepusculeAeroPercent}%`, `${100 - crepusculeAeroPercent}%`, 'night-aero');

        const dispoParHeure = new Array(24).fill('red');
        disposPerso.forEach(d => {
            const f = d.fields || {};
            const [hStart, mStart] = String(f['Heure début'] || '00:00').split(':').map(Number);
            const [hEnd, mEnd] = String(f['Heure fin'] || '00:00').split(':').map(Number);
            const startMin = hStart * 60 + (mStart || 0);
            const endMin = hEnd * 60 + (mEnd || 0);
            const estDispo = f['Disponible'] === true || f['Disponible'] === 'true' || f['Disponible'] === 1 || f['Disponible'] === '1';
            for (let m = 0; m < 1440; m += 60) {
                const h = m / 60;
                if (m < startMin || m + 60 > endMin) continue;
                if (estDispo) dispoParHeure[h] = 'green';
            }
        });

        for (let h = 0; h < 24; h++) {
            const block = document.createElement('div');
            block.className = 'grid-hour-block';
            block.style.flex = LARGEURS_HEURES[h];
            const overlay = document.createElement('div');
            overlay.className = `dispo-hour-overlay dispo-${dispoParHeure[h]}`;
            block.appendChild(overlay);
            gridBg.appendChild(block);
        }

        const resasPerso = reservations.filter(r => {
            const f = r.fields || {};
            const nomInstructeur = (typeof nomUtilisateurDepuisId === 'function') ? nomUtilisateurDepuisId(f['Instructeur'], listeMembresCache) : (f['Instructeur'] || '');
            const nomPilote = (typeof nomUtilisateurDepuisId === 'function') ? nomUtilisateurDepuisId(f['Pilote'], listeMembresCache) : (f['Pilote'] || '');
            return correspondanceNom(nomInstructeur, nom) || correspondanceNom(nomPilote, nom);
        });
        const barresInfos = [];
        resasPerso.forEach(r => {
            const f = r.fields || {};
            const type = (f['Type'] || f['Type de vol'] || 'Vol Classique');
            const typesVol = Array.isArray(type) ? type : [type];
            const piloteNom = (typeof nomUtilisateurDepuisId === 'function') ? nomUtilisateurDepuisId(f['Pilote'], listeMembresCache) : (f['Pilote'] || '');
            const instructeurNom = (typeof nomUtilisateurDepuisId === 'function') ? nomUtilisateurDepuisId(f['Instructeur'], listeMembresCache) : (f['Instructeur'] || '');
            const passagerNom = (f['Passager'] || f['Nom'] || '').toString().trim();
            const machineIds = Array.isArray(f['Machine']) ? f['Machine'] : [f['Machine']].filter(Boolean);
            const machineId = machineIds[0];
            const avion = (typeof listeAvionsCache !== 'undefined' ? listeAvionsCache : []).find(a => a.id === machineId);
            const immat = (avion && (avion.fields['Immatriculation'] || avion.fields['Nom'] || '')) || machineId || '';
            const debut = new Date(f['Date de début']);
            const fin = new Date(f['Date de fin']);
            if (isNaN(debut.getTime()) || isNaN(fin.getTime())) return;
            let heureDebut = debut.getHours() + debut.getMinutes() / 60;
            let heureFin = fin.getHours() + fin.getMinutes() / 60;
            if (debut.getDate() !== dateAffichee.getDate() || debut.getMonth() !== dateAffichee.getMonth() || debut.getFullYear() !== dateAffichee.getFullYear()) heureDebut = 0;
            if (fin.getDate() !== dateAffichee.getDate() || fin.getMonth() !== dateAffichee.getMonth() || fin.getFullYear() !== dateAffichee.getFullYear()) heureFin = 24;
            heureDebut = Math.max(0, Math.min(24, heureDebut));
            heureFin = Math.max(0, Math.min(24, heureFin));
            const duree = heureFin - heureDebut;
            if (duree <= 0) return;
            const barresDiv = document.createElement('div');
            barresDiv.className = 'reservation-bar';
            if (duree <= 2) barresDiv.classList.add('short-reservation');
            const piloteFormate = (typeof formaterNomPilote === 'function') ? formaterNomPilote(piloteNom) : piloteNom;
            const isVIMoteur = typesVol.includes('VI Moteur');
            const isAncienVI = typesVol.includes("Vol d'Initiation") || typesVol.includes("Vol d'Initiation (VI)");
            const isInstruction = typesVol.includes('Instruction');
            const isCreneau = r._table === 'VI Créneaux';
            const estMoi = (typeof estUtilisateurCourant === 'function') && (estUtilisateurCourant(piloteNom) || estUtilisateurCourant(instructeurNom));
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
            barresDiv.title = `${libelleEntete} — ${immat}`;
            barresDiv.innerHTML = `<strong>${libelleEntete}</strong>`;
            barresDiv.addEventListener('click', (e) => { e.stopPropagation(); if (typeof ouvrirModaleModification === 'function') ouvrirModaleModification(r.id); });
            gridBg.appendChild(barresDiv);
            barresInfos.push({ bar: barresDiv, debut: heureDebut, fin: heureFin });
        });

        afficherConflitsReservations(barresInfos);

        rowDiv.appendChild(gridBg);
        rowsContainer.appendChild(rowDiv);
    });
}

function ouvrirSuiviInstructeur(nom) {
    const modal = document.getElementById('instructeur-suivi-modal');
    if (!modal) return;
    document.getElementById('instructeur-suivi-nom').textContent = nom;
    const tbody = document.getElementById('instructeur-suivi-body');
    if (tbody) {
        tbody.innerHTML = '';
        const start = new Date(dateAffichee);
        start.setHours(0, 0, 0, 0);
        for (let i = 0; i < 14; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const tr = document.createElement('tr');
            tr.dataset.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            tr.innerHTML = `<td>${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</td><td class="instructeur-suivi-day"></td>`;
            tbody.appendChild(tr);
        }
    }
    modal.style.display = 'flex';
    chargerSuiviInstructeur14Jours(nom, start);
}

async function chargerSuiviInstructeur14Jours(nom, start) {
    const end = new Date(start);
    end.setDate(start.getDate() + 14);
    end.setHours(23, 59, 59, 999);
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    const formula = `AND({Instructeur}='${nom.replace(/'/g, "\\'")}', DATETIME_FORMAT({Date},'YYYY-MM-DD')>='${startStr}', DATETIME_FORMAT({Date},'YYYY-MM-DD')<='${endStr}')`;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DISPONIBILITES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=200`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        const records = data.records || [];
        document.querySelectorAll('#instructeur-suivi-body tr').forEach(tr => {
            const cell = tr.querySelector('td:nth-child(2)');
            if (!cell) return;
            cell.innerHTML = '';
            const dateTr = tr.dataset.date;
            const dispos = records.filter(r => {
                const f = r.fields || {};
                const d = f['Date'] ? new Date(f['Date']).toISOString().split('T')[0] : '';
                return d === dateTr;
            });
            const blocks = [];
            for (let h = 0; h < 24; h++) blocks.push('red');
            dispos.forEach(d => {
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
            blocks.forEach(c => {
                const d = document.createElement('div');
                d.className = `dispo-hour dispo-${c}`;
                cell.appendChild(d);
            });
        });
    } catch (err) { console.error(err); }
}

async function chargerListeInstructeurs(forceRefresh = false) {
    if (!forceRefresh && listeInstructeursCache.length) return;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}?pageSize=100`, { headers }, API_CACHE_TTL, forceRefresh);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        listeInstructeursCache = (data.records || []).map(r => {
            const f = r.fields || {};
            const prenom = f['Prénom'] || '';
            const nom = f['Nom'] || '';
            const roles = Array.isArray(f['Rôles']) ? f['Rôles'] : [f['Rôles']].filter(Boolean);
            return { id: r.id, prenom, nom, nomComplet: `${prenom} ${nom}`.trim(), trigramme: (f['Trigramme'] || '').toString().trim(), roles };
        }).filter(u => u.nomComplet && u.roles.some(r => (r || '').toString().trim().toLowerCase().includes('instructeur')));
    } catch (err) { console.error(err); }
}

async function peuplerInstructeursSelect() {
    const sel = document.getElementById('form-instructeur');
    if (!sel) return;
    await chargerListeInstructeurs();
    if (!listeInstructeursCache.length && estInstructeur() && currentUser) {
        const nomComplet = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
        if (nomComplet) listeInstructeursCache = [{ prenom: currentUser.prenom, nom: currentUser.nom, nomComplet, roles: currentUser.roles || [] }];
    }
    let html = '<option value="">-- Aucun --</option>';
    listeInstructeursCache.forEach(u => { html += `<option value="${u.nomComplet}">${u.nomComplet}</option>`; });
    sel.innerHTML = html;
}

async function verifierConflitDisponibiliteInstructeur(nom, dateDebut, dateFin, machine) {
    if (!nom) return false;
    const jours = new Set();
    const d = new Date(dateDebut);
    const f = new Date(dateFin);
    while (d <= f) {
        jours.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        d.setDate(d.getDate() + 1);
    }
    const prenom = nom.split(' ')[0] || nom;
    const dates = Array.from(jours).map(j => `DATETIME_FORMAT({Date},'YYYY-MM-DD')='${j}'`);
    const formula = `AND(SEARCH('${prenom.replace(/'/g, "\\'")}', {Instructeur}) > 0, OR(${dates.join(',')}))`;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DISPONIBILITES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        const records = data.records || [];
        for (let t = new Date(dateDebut); t < dateFin; t.setMinutes(t.getMinutes() + 5)) {
            const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
            const min = t.getHours() * 60 + t.getMinutes();
            const dispos = records.filter(r => {
                const f = r.fields || {};
                if (!correspondanceNom(f['Instructeur'], nom)) return false;
                const d = (f['Date'] || '').toString().slice(0, 10);
                if (d !== iso) return false;
                const m = (f['Machine'] || '').toString().trim();
                if (m !== 'Tous' && m !== machine) return false;
                const [hStart, mStart] = String(f['Heure début'] || '00:00').split(':').map(Number);
                const [hEnd, mEnd] = String(f['Heure fin'] || '00:00').split(':').map(Number);
                const startMin = hStart * 60 + (mStart || 0);
                const endMin = hEnd * 60 + (mEnd || 0);
                return min >= startMin && min < endMin;
            });
            const estDispo = dispos.some(r => r.fields['Disponible'] === true || r.fields['Disponible'] === 'true' || r.fields['Disponible'] === 1 || r.fields['Disponible'] === '1');
            if (!estDispo) return true;
        }
        return false;
    } catch (err) { console.error(err); return false; }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDisponibilitesInstructeurs);
} else {
    initDisponibilitesInstructeurs();
}
