const TABLE_DISPONIBILITES = 'Disponibilités instructeurs';
const ROLES_INSTRUCTEUR = ['Instructeur avion', 'Instructeur ULM'];
let afficherDisposInstructeurs = false;
let disposInstructeursCache = [];
let listeInstructeursCache = [];

function estInstructeur() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    const roles = currentUser.roles || [];
    return ROLES_INSTRUCTEUR.some(r => roles.includes(r));
}

function estInstructeurParNom(nom) {
    if (!nom) return false;
    const u = listeInstructeursCache.find(x => `${x.prenom || ''} ${x.nom || ''}`.trim().toLowerCase() === nom.toLowerCase());
    return u ? ROLES_INSTRUCTEUR.some(r => (u.roles || []).includes(r)) : false;
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
        const ref = document.getElementById('btn-add-reservation');
        headerActions.insertBefore(btnToggle, ref);
    }

    if (!document.getElementById('btn-declarer-disponibilite')) {
        const btnDecl = document.createElement('button');
        btnDecl.id = 'btn-declarer-disponibilite';
        btnDecl.className = 'btn-primary';
        btnDecl.textContent = '+ Déclarer mes dispos';
        btnDecl.addEventListener('click', ouvrirModaleDisponibilite);
        const ref = document.getElementById('btn-add-reservation');
        headerActions.insertBefore(btnDecl, ref);
    }

    const btnToggle = document.getElementById('btn-toggle-dispos-instructeurs');
    if (btnToggle) btnToggle.style.display = 'inline-block';
    const btnDecl = document.getElementById('btn-declarer-disponibilite');
    if (btnDecl) btnDecl.style.display = (estInstructeur() || (typeof isSuperAdmin === 'function' && isSuperAdmin())) ? 'inline-block' : 'none';

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
    if (!modal) return;
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

async function enregistrerDisponibilite(e) {
    e.preventDefault();
    const nom = (typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '');
    if (!nom) { alert('Connecte-toi pour déclarer une disponibilité.'); return; }
    const date = document.getElementById('dispo-date').value;
    const debut = document.getElementById('dispo-debut').value;
    const fin = document.getElementById('dispo-fin').value;
    const machine = document.getElementById('dispo-machine').value;
    const dispo = document.getElementById('dispo-disponible').checked;
    if (!date || !debut || !fin) { alert('Remplis tous les champs.'); return; }
    if (debut >= fin) { alert('L\'heure de fin doit être après le début.'); return; }
    const payload = { records: [{ fields: { 'Instructeur': nom, 'Date': date, 'Heure début': debut, 'Heure fin': fin, 'Machine': machine, 'Disponible': dispo } }] };
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DISPONIBILITES)}`, { method: 'POST', headers, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        fermerModaleDisponibilite();
        if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false);
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'enregistrement : ' + (err.message || ''));
    }
}

async function chargerDisponibilitesInstructeurs(dateCible) {
    await chargerListeInstructeurs();
    const dateStr = `${dateCible.getFullYear()}-${String(dateCible.getMonth() + 1).padStart(2, '0')}-${String(dateCible.getDate()).padStart(2, '0')}`;
    const formula = `DATETIME_FORMAT({Date},'YYYY-MM-DD')='${dateStr}'`;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DISPONIBILITES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        disposInstructeursCache = data.records || [];
    } catch (err) {
        console.error(err);
        disposInstructeursCache = [];
    }
    return disposInstructeursCache;
}

function afficherLignesInstructeurs(rowsContainer, soleil) {
    if (!afficherDisposInstructeurs) return;
    if (!listeInstructeursCache.length) return;
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
        const dispos = disposInstructeursCache.filter(r => (r.fields['Instructeur'] || '').toString().trim() === nom);
        const rowDiv = document.createElement('div');
        rowDiv.className = 'timeline-row instructeur-dispo-row';
        const machineCell = document.createElement('div');
        machineCell.className = 'machine-cell';
        const nomSpan = document.createElement('span');
        nomSpan.className = 'instructeur-nom';
        nomSpan.textContent = nom;
        nomSpan.addEventListener('click', () => ouvrirSuiviInstructeur(nom));
        machineCell.appendChild(nomSpan);
        rowDiv.appendChild(machineCell);
        const gridBg = document.createElement('div');
        gridBg.className = 'hours-grid-background dispo-grid';

        ajouterZoneNuit(gridBg, '0%', `${aubeAeroPercent}%`, 'night-aero');
        ajouterZoneNuit(gridBg, `${aubeAeroPercent}%`, `${leverPercent - aubeAeroPercent}%`, 'night-civil');
        ajouterZoneNuit(gridBg, `${coucherPercent}%`, `${crepusculeAeroPercent - coucherPercent}%`, 'night-civil');
        ajouterZoneNuit(gridBg, `${crepusculeAeroPercent}%`, `${100 - crepusculeAeroPercent}%`, 'night-aero');

        const dispoParHeure = new Array(24).fill('red');
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
                if (estDispo) dispoParHeure[h] = 'green';
            }
        });

        for (let h = 0; h < 24; h++) {
            const block = document.createElement('div');
            block.className = 'grid-hour-block';
            const overlay = document.createElement('div');
            overlay.className = `dispo-hour-overlay dispo-${dispoParHeure[h]}`;
            block.appendChild(overlay);
            gridBg.appendChild(block);
        }
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

async function chargerListeInstructeurs() {
    if (listeInstructeursCache.length) return;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}?pageSize=100`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        listeInstructeursCache = (data.records || []).map(r => {
            const f = r.fields || {};
            const prenom = f['Prénom'] || '';
            const nom = f['Nom'] || '';
            const roles = Array.isArray(f['Rôles']) ? f['Rôles'] : [f['Rôles']].filter(Boolean);
            return { prenom, nom, nomComplet: `${prenom} ${nom}`.trim(), roles };
        }).filter(u => u.nomComplet && u.roles.some(r => ROLES_INSTRUCTEUR.includes((r || '').trim())));
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
    const dates = Array.from(jours).map(j => `DATETIME_FORMAT({Date},'YYYY-MM-DD')='${j}'`);
    const formula = `AND({Instructeur}='${nom.replace(/'/g, "\\'")}', OR(${dates.join(',')}))`;
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
                const d = f['Date'] ? new Date(f['Date']).toISOString().split('T')[0] : '';
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
