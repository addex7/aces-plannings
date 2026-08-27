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
let comptesShowAll = false;

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
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS_COMPTES)}?fields%5B%5D=Pr%C3%A9nom&fields%5B%5D=Nom&pageSize%3D100`;
    const res = await fetch(url, { headers });
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
        afficherDernierImport(records);
        afficherResume(records, summary, piloteNom);
        afficherTransactions(records, container, piloteNom);

        const isCurrent = !select || select.value === nomPiloteComptes(currentUser);
        const canEdit = isCurrent || isTresorier();
        if (form) form.style.display = canEdit ? 'block' : 'none';
    } catch (err) {
        console.error(err);
        if (container) container.innerHTML = `<p style="color:#dc2626;">Erreur : ${err.message}</p>`;
    }
}

function peuplerSelectPilotes(select) {
    if (!select) return;
    const val = select.value;
    select.innerHTML = '';
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
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&sort[0][field]=Date&sort[0][direction]=desc`;
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Impossible de lire les comptes.');
    const records = data.records || [];
    records.sort((a, b) => {
        const dateA = new Date(a.fields?.['Date'] || '1970-01-01');
        const dateB = new Date(b.fields?.['Date'] || '1970-01-01');
        if (dateB - dateA !== 0) return dateB - dateA;
        const descA = String(a.fields?.['Description'] || '');
        const descB = String(b.fields?.['Description'] || '');
        return descB.localeCompare(descA);
    });
    return records;
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

function afficherDernierImport(records) {
    const lastImportEl = document.getElementById('comptes-last-import');
    if (!lastImportEl) return;
    const lastImport = records
        .filter(r => (r.fields?.['Source'] || '') === 'Import CSV' && r.createdTime)
        .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))[0];
    if (lastImport) {
        const d = new Date(lastImport.createdTime);
        lastImportEl.textContent = `· Dernier import CSV : ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
        lastImportEl.style.display = '';
    } else {
        lastImportEl.style.display = 'none';
    }
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

    const soldeFinal = solde + enAttente;

    const html = `
        <div class="comptes-summary-card">
            <div class="comptes-summary-item">
                <div class="comptes-summary-icon solde-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/></svg>
                </div>
                <div>
                    <div class="comptes-summary-label">SOLDE FINAL</div>
                    <div class="comptes-summary-value solde-val">${soldeFinal.toFixed(2).replace('.', ',')} €</div>
                </div>
            </div>
            <div class="comptes-summary-item">
                <div class="comptes-summary-icon depense-icon"><span>&#8595;</span></div>
                <div>
                    <div class="comptes-summary-label">DÉPENSES</div>
                    <div class="comptes-summary-value depense-val">-${depenses.toFixed(2).replace('.', ',')} €</div>
                </div>
            </div>
            <div class="comptes-summary-item">
                <div class="comptes-summary-icon recette-icon"><span>&#8593;</span></div>
                <div>
                    <div class="comptes-summary-label">RECETTES VALIDÉES</div>
                    <div class="comptes-summary-value recette-val">+${recettes.toFixed(2).replace('.', ',')} €</div>
                </div>
            </div>
        </div>
    `;
    if (summary) summary.innerHTML = html;
}

function afficherTransactions(records, container, piloteNom, showAll = comptesShowAll) {
    if (!container) return;
    if (!records.length) { container.innerHTML = '<p class="comptes-vide">Aucune transaction enregistrée.</p>'; return; }

    const displayRecords = showAll ? records : records.slice(0, 5);
    const hasMore = records.length > 5;

    const rows = displayRecords.map(r => {
        const f = r.fields || {};
        const date = f['Date'] ? new Date(f['Date']).toLocaleDateString('fr-FR') : '';
        const desc = f['Description'] || '';
        const ref = f['Référence'] || '';
        const debit = parseMontantCompte(f['Débit']);
        const credit = parseMontantCompte(f['Crédit']);
        const source = f['Source'] || '';
        const statut = f['Statut'] || 'Validé';

        let montant = '', cls = '', arrow = '';
        if (debit > 0) {
            montant = `-${debit.toFixed(2).replace('.', ',')} €`;
            cls = 'debit';
            arrow = '&#8595;';
        } else if (credit > 0) {
            montant = `+${credit.toFixed(2).replace('.', ',')} €`;
            cls = (source === 'Saisie pilote' && statut === 'En attente') ? 'attente' : 'credit';
            arrow = '&#8593;';
        }

        const isManuel = source === 'Saisie pilote' && statut === 'En attente';
        const deleteBtn = isManuel ? `<button type="button" class="comptes-delete" data-id="${escHtml(r.id)}" title="Supprimer">&times;</button>` : '';
        return `<tr class="comptes-row ${cls}">
            <td class="comptes-date">${escHtml(date)}</td>
            <td class="comptes-desc">${escHtml(stripOrdre(desc))}</td>
            <td class="comptes-ref">${escHtml(ref)}</td>
            <td class="comptes-montant">${arrow}<span class="comptes-montant-valeur">${escHtml(montant)}</span>${deleteBtn}</td>
        </tr>`;
    }).join('');

    const html = `
        <div class="comptes-list-header">
            <h3 class="comptes-list-title">Transactions de ${escHtml(piloteNom)}</h3>
            <button type="button" class="comptes-export-btn" id="comptes-export-csv">Exporter en CSV</button>
        </div>
        <table class="comptes-table">
            <thead><tr><th>Date</th><th>Description</th><th>Référence</th><th>Montant</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        ${hasMore ? `<div class="comptes-list-footer"><button type="button" class="comptes-voir-toutes" id="comptes-toggle-rows">Voir toutes les transactions <span>&#8595;</span></button></div>` : ''}
    `;
    container.innerHTML = html;

    const exportBtn = container.querySelector('#comptes-export-csv');
    if (exportBtn) exportBtn.addEventListener('click', () => exporterCSVComptes(records, piloteNom));

    const toggleBtn = container.querySelector('#comptes-toggle-rows');
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
        comptesShowAll = !comptesShowAll;
        afficherTransactions(records, container, piloteNom, comptesShowAll);
    });

    container.querySelectorAll('.comptes-delete').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
            if (!confirm('Supprimer cette recette manuelle ?')) return;
            const id = ev.currentTarget.dataset.id;
            try {
                await supprimerRecetteManuelle(id);
                await chargerComptesPilotes();
            } catch (err) {
                console.error(err);
                alert('Erreur : ' + err.message);
            }
        });
    });
}

function exporterCSVComptes(records, piloteNom) {
    if (!records.length) return;
    const lignes = ['Date;Description;Référence;Débit;Crédit'];
    records.forEach(r => {
        const f = r.fields || {};
        const date = f['Date'] || '';
        const desc = stripOrdre(f['Description'] || '').replace(/;/g, ' ');
        const ref = (f['Référence'] || '').replace(/;/g, ' ');
        const debit = f['Débit'] || 0;
        const credit = f['Crédit'] || 0;
        lignes.push(`${date};${desc};${ref};${debit};${credit}`);
    });
    const csv = '\uFEFF' + lignes.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compte_${(piloteNom || 'pilote').replace(/\s+/g, '_')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function stripOrdre(s) {
    return String(s || '').replace(/^~#\d{4}~/, '');
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

    const loading = document.getElementById('comptes-loading');
    if (loading) loading.style.display = 'flex';
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

            for (const t of ex.transactions) {
                if (t.credit > 0) {
                    await validerRecetteManuelle(piloteNom, t.credit, t.dateIso);
                }
            }

            await creerImportCSV(piloteNom, ex.transactions);
        }

        // Import terminé sans alerte
        input.value = '';
        await chargerComptesPilotes();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'import CSV : ' + err.message);
    } finally {
        if (loading) loading.style.display = 'none';
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
            const nomLigne = lignes[i + 1] || '';
            courant.nom = nomLigne.replace(/\s+/g, ' ').trim();
        } else if (l.startsWith('Date;')) {
            inTransactions = true;
        } else if (l.startsWith('Solde avant le')) {
            inTransactions = false;
            const sCols = l.split(';').map(c => c.trim());
            if (sCols.length >= 4 && courant) {
                const sDate = convertirDateFR(sCols[1]);
                const sType = (sCols[2] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const sMontant = Math.abs(parseMontantCompte(sCols[3]));
                if (sDate && sMontant > 0) {
                    const isDebit = sType.includes('debit') || sType.includes('debiteur');
                    courant.transactions.push({
                        dateIso: sDate,
                        description: 'Solde initial au ' + sDate,
                        reference: '',
                        prix: 0,
                        quantite: 0,
                        debit: isDebit ? sMontant : 0,
                        credit: isDebit ? 0 : sMontant,
                        ordre: courant.transactions.length
                    });
                }
            }
        } else if (l.startsWith('Solde au')) {
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
                credit,
                ordre: courant.transactions.length
            });
        }
    }
    return extraits;
}

function trouverPiloteParNom(csvNom) {
    if (!csvNom) return null;
    const parts = csvNom.split(/[\s;]+/).filter(Boolean).map(p => p.toLowerCase().trim());
    if (parts.length < 1) return null;
    return utilisateursComptesCache.find(r => {
        const f = r.fields || {};
        const prenom = (f['Prénom'] || '').toLowerCase().trim();
        const nom = (f['Nom'] || '').toLowerCase().trim();
        if (!prenom || !nom) return false;
        const nomOK = parts.includes(nom);
        const prenomOK = parts.includes(prenom) || parts.some(p => p[0] === prenom[0]);
        return nomOK && prenomOK;
    });
}

async function supprimerImportCSV(piloteNom) {
    const formula = `AND({Pilote}='${piloteNom.replace(/'/g, "\\'")}', {Source}='Import CSV')`;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Erreur suppression anciennes lignes.');

    const ids = (data.records || []).map(r => r.id);
    if (!ids.length) return;

    for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        const params = batch.map(id => `records[]=${encodeURIComponent(id)}`).join('&');
        const del = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}?${params}`, {
            method: 'DELETE',
            headers
        });
        const delData = await del.json();
        if (!del.ok) throw new Error(delData.error?.message || 'Erreur suppression.');
    }
}

async function validerRecetteManuelle(piloteNom, montant, dateIso) {
    const formula = `AND({Pilote}='${piloteNom.replace(/'/g, "\\'")}', {Source}='Saisie pilote', {Crédit}=${montant}, DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${dateIso}')`;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=1`;
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Erreur validation recette.');

    const record = (data.records || [])[0];
    if (record) {
        await supprimerRecetteManuelle(record.id, false);
    }
    return false;
}

async function creerImportCSV(piloteNom, transactions) {
    const records = transactions.map(t => ({
        fields: {
            'Pilote': piloteNom,
            'Date': t.dateIso,
            'Description': '~#' + String(t.ordre || 0).padStart(4, '0') + '~' + t.description,
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
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}`, {
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

    const select = document.getElementById('comptes-pilote-select');
    const piloteNom = (select && select.value) ? select.value : nomPiloteComptes(currentUser);
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
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');

        // Recette enregistrée sans alerte
        if (typeof enregistrerAudit === 'function') {
            await enregistrerAudit('Versement compte pilote', piloteNom, `Pilote : ${piloteNom} | Date : ${date} | Montant : ${montant.toFixed(2).replace('.', ',')} € | ${desc}`, 'Comptes');
        }
        e.target.reset();
        await chargerComptesPilotes();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'enregistrement : ' + err.message);
    }
}

async function supprimerRecetteManuelle(recordId, audit = true) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_COMPTES)}/${recordId}`;
    let record = null;
    if (audit) {
        try {
            const recRes = await fetch(url, { headers });
            if (recRes.ok) record = await recRes.json();
        } catch (_) {}
    }
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || 'Erreur suppression.');
    }
    await res.json().catch(() => {});
    if (audit && record && typeof enregistrerAudit === 'function') {
        const f = record.fields || {};
        const montant = (parseFloat(f['Crédit']) || 0).toFixed(2).replace('.', ',');
        const pilote = f['Pilote'] || '';
        const date = f['Date'] || '';
        await enregistrerAudit('Suppression versement', pilote, `Pilote : ${pilote} | Date : ${date} | Montant : ${montant} €`, 'Comptes');
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
    return solde > -500;
}
