/* ==========================================================================
   COMPTES PILOTES
   ==========================================================================
   Schéma Airtable attendu pour la table "Comptes Pilotes" :
   - Pilote          : singleLineText
   - Date            : date
   - Description     : singleLineText
   - Référence       : singleLineText
   - Prix            : number
   - Quantité        : number
   - Débit           : number
   - Crédit          : number
   - Source          : singleLineText  ("Import CSV" ou "Saisie pilote")
   - Statut          : singleLineText  ("Validé" ou "En attente")
   ========================================================================== */

const TABLE_COMPTES = 'Comptes Pilotes';
const TABLE_UTILISATEURS_COMPTES = 'Utilisateurs';
let utilisateursComptesCache = [];
let comptesPilotesCache = [];

function initComptesPilotes() {
    const btnImport = document.getElementById('comptes-csv-btn');
    const formRecette = document.getElementById('comptes-form-recette');
    const select = document.getElementById('comptes-pilote-select');

    if (btnImport) btnImport.addEventListener('click', importerCSVComptes);
    if (formRecette) formRecette.addEventListener('submit', enregistrerRecetteManuelle);
    if (select) select.addEventListener('change', chargerComptesPilotes);

    if (typeof appliquerAccesComptes === 'function') appliquerAccesComptes();
}

function appliquerAccesComptes() {
    const tab = document.getElementById('tab-comptes');
    const header = document.getElementById('comptes-header-actions');
    const connecte = typeof currentUser !== 'undefined' && currentUser;
    if (tab) tab.style.display = connecte ? 'block' : 'none';
    if (header) {
        header.style.display = (connecte && isTresorier()) ? 'flex' : 'none';
        header.style.gap = '10px';
        header.style.alignItems = 'center';
        header.style.flexWrap = 'wrap';
    }
}

function afficherVueComptes() {
    document.querySelectorAll('.view-section').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-sub li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll('.nav-group:not(.nav-group-standalone)').forEach(g => g.classList.remove('open'));

    const view = document.getElementById('view-comptes');
    const tab = document.getElementById('tab-comptes');
    if (view) view.style.display = 'block';
    if (tab) {
        tab.classList.add('active');
        const groupe = tab.closest('.nav-group');
        if (groupe) groupe.classList.add('open');
    }
}

function nomPiloteComptes(u) {
    return `${u.prenom || ''} ${u.nom || ''}`.trim();
}

function isTresorier() {
    return typeof currentUser !== 'undefined' && currentUser && (currentUser.roles || []).some(r => r === 'Trésorier' || r === 'Super admin');
}

async function chargerUtilisateursComptes() {
    if (utilisateursComptesCache.length) return;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS_COMPTES)}?fields%5B%5D=Pr%C3%A9nom&fields%5B%5D=Nom&filterByFormula=%7BActif%7D%3D1&pageSize%3D100`;
    const res = await cachedFetch(url, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Erreur lors du chargement des pilotes.');
    utilisateursComptesCache = data.records || [];
}

async function chargerComptesPilotes() {
    const view = document.getElementById('view-comptes');
    if (!view) return;
    const container = document.getElementById('comptes-list');
    const summary = document.getElementById('comptes-summary');
    const form = document.getElementById('comptes-form-recette');
    const select = document.getElementById('comptes-pilote-select');

    if (!currentUser) {
        if (container) container.innerHTML = '<p>Veuillez vous connecter.</p>';
        return;
    }

    try {
        if (isTresorier()) {
            await chargerUtilisateursComptes();
            peuplerSelectPilotes(select);
        }

        let piloteNom = nomPiloteComptes(currentUser);
        if (select && select.value) piloteNom = select.value;

        const records = await fetchComptes(piloteNom);
        comptesPilotesCache = records;
        afficherResume(records, summary, piloteNom);
        afficherTransactions(records, container);

        const isCurrent = !select || select.value === nomPiloteComptes(currentUser);
        if (form) form.style.display = isCurrent ? 'block' : 'none';
    } catch (err) {
        console.error(err);
        if (container) container.innerHTML = `<p style="color:#dc2626;">Erreur : ${err.message}</p>`;
    }
}

function peuplerSelectPilotes(select) {
    if (!select) return;
    const val = select.value;
    select.innerHTML = '<option value="">Choisir un pilote</option>';
    const noms = new Set();
    utilisateursComptesCache.forEach(r => {
        const f = r.fields || {};
        const nom = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
        if (nom && !noms.has(nom)) {
            noms.add(nom);
            const opt = document.createElement('option');
            opt.value = nom;
            opt.textContent = nom;
            select.appendChild(opt);
        }
    });
    if (val && [...select.options].some(o => o.value === val)) select.value = val;
    else {
        const current = nomPiloteComptes(currentUser);
        if (current && [...select.options].some(o => o.value === current)) select.value = current;
    }
}

async function fetchComptes(piloteNom) {
    if (!piloteNom) return [];
    const formula = `{Pilote}='${piloteNom.replace(/'/g, "\\'")}'`;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&sort[0][field]=Date&sort[0][direction]=asc`;
    const res = await cachedFetch(url, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Impossible de lire les comptes.');
    return data.records || [];
}

function parseMontantCompte(s) {
    if (s === undefined || s === null || s === '') return 0;
    const t = s.toString().trim().replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
}

function convertirDateFR(d) {
    const m = d.match(/^\d{2}\/\d{2}\/\d{4}$/);
    if (!m) return null;
    const [_, j, m_, a] = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return `${a}-${m_}-${j}`;
}

function afficherResume(records, summary, piloteNom) {
    let depenses = 0, recettes = 0, enAttente = 0, solde = 0;
    records.forEach(r => {
        const f = r.fields || {};
        const debit = parseMontantCompte(f['Débit']);
        const credit = parseMontantCompte(f['Crédit']);
        const source = f['Source'] || '';
        const statut = f['Statut'] || 'Validé';
        if (statut === 'En attente' && source === 'Saisie pilote' && credit > 0) {
            enAttente += credit;
            return;
        }
        if (statut !== 'Validé') return;
        if (debit > 0) { depenses += debit; solde -= debit; }
        if (credit > 0) { recettes += credit; solde += credit; }
    });

    let soldeClasse = 'positif';
    if (solde < 0) soldeClasse = 'negatif';
    else if (enAttente > 0) soldeClasse = 'attente';

    const html = `
        <div style="display:flex; flex-wrap:wrap; gap:15px; align-items:center;">
            <div class="comptes-solde ${soldeClasse}" style="font-size:24px; font-weight:bold;">
                Solde : ${solde.toFixed(2).replace('.', ',')} €
            </div>
            <div style="color:#dc2626; font-weight:600;">Dépenses : -${depenses.toFixed(2).replace('.', ',')} €</div>
            <div style="color:#16a34a; font-weight:600;">Recettes : +${recettes.toFixed(2).replace('.', ',')} €</div>
            ${enAttente > 0 ? `<div style="color:#f59e0b; font-weight:600;">Recettes en attente : +${enAttente.toFixed(2).replace('.', ',')} €</div>` : ''}
        </div>
        <h3 style="margin:15px 0 8px;">Transactions de ${escHtml(piloteNom)}</h3>
    `;
    if (summary) summary.innerHTML = html;
}

function afficherTransactions(records, container) {
    if (!container) return;
    if (!records.length) { container.innerHTML = '<p>Aucune transaction enregistrée.</p>'; return; }

    let html = `<table style="width:100%; border-collapse:collapse; font-size:14px;">
        <thead>
            <tr style="text-align:left; border-bottom:2px solid #e2e8f0;">
                <th style="padding:8px;">Date</th>
                <th style="padding:8px;">Description</th>
                <th style="padding:8px;">Référence</th>
                <th style="padding:8px; text-align:right;">Montant</th>
            </tr>
        </thead>
        <tbody>`;

    records.forEach(r => {
        const f = r.fields || {};
        const date = f['Date'] ? new Date(f['Date']).toLocaleDateString('fr-FR') : '';
        const desc = f['Description'] || '';
        const ref = f['Référence'] || '';
        const debit = parseMontantCompte(f['Débit']);
        const credit = parseMontantCompte(f['Crédit']);
        const source = f['Source'] || '';
        const statut = f['Statut'] || 'Validé';

        let montant = '', cls = '';
        if (debit > 0) {
            montant = `-${debit.toFixed(2).replace('.', ',')} €`;
            cls = 'debit';
        } else if (credit > 0) {
            montant = `+${credit.toFixed(2).replace('.', ',')} €`;
            cls = (source === 'Saisie pilote' && statut === 'En attente') ? 'attente' : 'credit';
        }

        html += `<tr class="comptes-row ${cls}" style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:8px; white-space:nowrap;">${escHtml(date)}</td>
            <td style="padding:8px;">${escHtml(desc)}</td>
            <td style="padding:8px; color:#64748b;">${escHtml(ref)}</td>
            <td style="padding:8px; text-align:right; font-weight:600;">${escHtml(montant)}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function escHtml(s) {
    return (s || '').toString().replace(/[&<"']/g, c => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function importerCSVComptes() {
    const input = document.getElementById('comptes-csv-input');
    const file = input && input.files[0];
    if (!file) { alert('Veuillez sélectionner un fichier CSV.'); return; }

    const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const arr = e.target.result;
            try {
                resolve(new TextDecoder('utf-8', { fatal: true }).decode(arr));
            } catch (_) {
                resolve(new TextDecoder('windows-1252').decode(arr));
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
    try {
        const extraits = parserCSVComptes(text);
        if (!extraits.length) { alert('Aucun extrait de compte trouvé dans ce fichier.'); return; }

        await chargerUtilisateursComptes();

        for (const ex of extraits) {
            const pilote = trouverPiloteParNom(ex.nom);
            if (!pilote) {
                console.warn('Pilote non trouvé dans Glide 2000 :', ex.nom);
                continue;
            }

            const f = pilote.fields || {};
            const piloteNom = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();

            await supprimerImportCSV(piloteNom);

            const matched = new Set();
            for (const t of ex.transactions) {
                if (t.credit > 0) {
                    const validee = await validerRecetteManuelle(piloteNom, t.credit);
                    if (validee) matched.add(t);
                }
            }

            await creerImportCSV(piloteNom, ex.transactions.filter(t => !matched.has(t)));
        }

        alert('Import CSV terminé.');
        input.value = '';
        await chargerComptesPilotes();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'import CSV : ' + err.message);
    }
}

function parserCSVComptes(text) {
    const lignes = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const extraits = [];
    let courant = null;
    let inTransactions = false;

    for (let i = 0; i < lignes.length; i++) {
        const l = lignes[i];
        if (l.startsWith('Extrait du compte')) {
            courant = { nom: '', transactions: [] };
            extraits.push(courant);
            inTransactions = false;
            let j = i + 1;
            while (j < lignes.length && !lignes[j].startsWith('Date;')) j++;
            const nomLigne = (j > i + 1 && lignes[j - 1]) ? lignes[j - 1] : '';
            const nomParts = nomLigne.split(';').map(c => c.trim()).filter(Boolean);
            courant.nom = nomParts.pop() || '';
        } else if (l.startsWith('Date;')) {
            inTransactions = true;
        } else if (l.startsWith('Solde au') || l.startsWith('Solde avant le')) {
            inTransactions = false;
        } else if (inTransactions && courant) {
            const cols = l.split(';').map(c => c.trim());
            if (cols.length < 7) continue;

            const dateIso = convertirDateFR(cols[0]);
            if (!dateIso) continue;

            const debit = parseMontantCompte(cols[5]);
            const credit = parseMontantCompte(cols[6]);

            courant.transactions.push({
                dateIso,
                description: cols[1] || '',
                reference: cols[2] || '',
                prix: parseMontantCompte(cols[3]),
                quantite: parseMontantCompte(cols[4]),
                debit,
                credit
            });
        }
    }
    return extraits;
}

function trouverPiloteParNom(csvNom) {
    if (!csvNom) return null;
    const parts = csvNom.split(/\s+/).filter(Boolean).map(p => p.toLowerCase());
    if (parts.length < 2) return null;
    return utilisateursComptesCache.find(r => {
        const f = r.fields || {};
        const prenom = (f['Prénom'] || '').toLowerCase().trim();
        const nom = (f['Nom'] || '').toLowerCase().trim();
        return parts.includes(prenom) && parts.includes(nom);
    });
}

async function supprimerImportCSV(piloteNom) {
    const formula = `AND({Pilote}='${piloteNom.replace(/'/g, "\\'")}', {Source}='Import CSV')`;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
    const res = await cachedFetch(url, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Erreur suppression anciennes lignes.');

    const ids = (data.records || []).map(r => r.id);
    if (!ids.length) return;

    for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        const params = batch.map(id => `records[]=${encodeURIComponent(id)}`).join('&');
        const del = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}?${params}`, {
            method: 'DELETE',
            headers
        });
        const delData = await del.json();
        if (!del.ok) throw new Error(delData.error?.message || 'Erreur suppression.');
    }
}

async function validerRecetteManuelle(piloteNom, montant) {
    const formula = `AND({Pilote}='${piloteNom.replace(/'/g, "\\'")}', {Source}='Saisie pilote', {Statut}='En attente', {Crédit}=${montant})`;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=1`;
    const res = await cachedFetch(url, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Erreur validation recette.');

    const record = (data.records || [])[0];
    if (record) {
        const patch = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}/${record.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { 'Statut': 'Validé' } })
        });
        const patchData = await patch.json();
        if (!patch.ok) throw new Error(patchData.error?.message || 'Erreur validation recette.');
    }
    return !!record;
}

async function creerImportCSV(piloteNom, transactions) {
    const records = transactions.map(t => ({
        fields: {
            'Pilote': piloteNom,
            'Date': t.dateIso,
            'Description': t.description,
            'Référence': t.reference,
            'Prix': t.prix,
            'Quantité': t.quantite,
            'Débit': t.debit,
            'Crédit': t.credit,
            'Source': 'Import CSV',
            'Statut': 'Validé'
        }
    }));

    for (let i = 0; i < records.length; i += 10) {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: records.slice(i, i + 10) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur création lignes.');
    }
}

async function enregistrerRecetteManuelle(e) {
    e.preventDefault();
    if (!currentUser) return;

    const date = document.getElementById('comptes-recette-date').value;
    const desc = document.getElementById('comptes-recette-desc').value.trim();
    const montant = parseFloat(document.getElementById('comptes-recette-montant').value);

    if (!date || !desc || !montant || montant <= 0) {
        alert('Veuillez saisir une date, une description et un montant positif.');
        return;
    }

    const piloteNom = nomPiloteComptes(currentUser);
    const body = {
        records: [{
            fields: {
                'Pilote': piloteNom,
                'Date': date,
                'Description': desc,
                'Référence': '',
                'Prix': 0,
                'Quantité': 0,
                'Débit': 0,
                'Crédit': montant,
                'Source': 'Saisie pilote',
                'Statut': 'En attente'
            }
        }]
    };

    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');

        alert('Recette enregistrée. Elle apparaît en orange en attente de validation par le trésorier.');
        e.target.reset();
        await chargerComptesPilotes();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'enregistrement : ' + err.message);
    }
}

async function getSoldePilote(piloteNom) {
    if (!piloteNom) return 0;
    try {
        const records = await fetchComptes(piloteNom);
        return records.reduce((s, r) => {
            const f = r.fields || {};
            if ((f['Statut'] || 'Validé') !== 'Validé') return s;
            const debit = parseMontantCompte(f['Débit']);
            const credit = parseMontantCompte(f['Crédit']);
            return s + credit - debit;
        }, 0);
    } catch (err) {
        console.error(err);
        return 0;
    }
}

async function pilotePeutReserver(piloteNom) {
    const solde = await getSoldePilote(piloteNom);
    return solde >= 0;
}
