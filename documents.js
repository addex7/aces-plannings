/* ==========================================================================
   BASE DOCUMENTAIRE
   ========================================================================== */

const TABLE_DOCUMENTS = 'Documents';
const TABLE_DOSSIERS = 'Dossiers';
let documentsCache = [];
let dossiersCache = [];
let documentsAeronefsBibliothequeCache = {};

function isDocumentaliste() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    const roles = currentUser.roles || [];
    return roles.includes('Documentaliste') || roles.includes('Super admin');
}

function estDocumentMembre(rec) {
    if (!rec || !rec.fields) return false;
    return rec.fields['Description'] === 'Justificatif membre';
}

function appliquerAccesDocumentaire() {
    const toolbar = document.getElementById('documents-toolbar');
    const tab = document.getElementById('tab-documents');
    if (toolbar) toolbar.style.display = isDocumentaliste() ? 'flex' : 'none';
    if (tab) tab.style.display = 'block';
}

function initDocuments() {
    const btnNewPdf = document.getElementById('btn-new-pdf');
    const btnNewDossier = document.getElementById('btn-new-dossier');
    const btnCancelDoc = document.getElementById('btn-cancel-document');
    const btnCancelDossier = document.getElementById('btn-cancel-dossier');
    const form = document.getElementById('form-document');
    const formDossier = document.getElementById('form-dossier');
    const inputFichier = document.getElementById('document-fichier');
    const btnSubmit = form ? form.querySelector('button[type="submit"]') : null;

    appliquerAccesDocumentaire();
    if (btnNewPdf) btnNewPdf.addEventListener('click', () => ouvrirFormDocument(null));
    if (btnNewDossier) btnNewDossier.addEventListener('click', ouvrirFormDossier);
    if (inputFichier) inputFichier.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Envoi en cours...'; }
        const inputLien = document.getElementById('document-lien');
        try {
            const url = await uploaderFichierDocument(file);
            if (inputLien) inputLien.value = url;
            inputFichier.value = '';
        } catch (err) {
            console.error(err);
            alert('Erreur lors de l\'upload : ' + err.message);
        } finally {
            if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Enregistrer'; }
        }
    });
    if (btnCancelDoc) btnCancelDoc.addEventListener('click', cacherFormDocument);
    if (btnCancelDossier) btnCancelDossier.addEventListener('click', cacherFormDossier);
    if (form) form.addEventListener('submit', enregistrerDocument);
    if (formDossier) formDossier.addEventListener('submit', enregistrerDossier);
}

async function chargerDossiers() {
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOSSIERS)}?sort[0][field]=Nom&sort[0][direction]=asc`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        dossiersCache = data.records || [];
        populerDossiers();
    } catch (err) {
        console.error(err);
    }
}

function populerDossiers() {
    const select = document.getElementById('document-dossier');
    if (!select) return;
    const current = select.dataset.selected || '';
    select.innerHTML = '<option value="">-- Choisir un dossier --</option>';
    dossiersCache.forEach(rec => {
        const nom = rec.fields['Nom'] || '';
        if (!nom) return;
        const opt = document.createElement('option');
        opt.value = nom;
        opt.textContent = nom;
        if (nom === current) opt.selected = true;
        select.appendChild(opt);
    });
    const autre = document.createElement('option');
    autre.value = 'Autre';
    autre.textContent = 'Autre';
    if ('Autre' === current) autre.selected = true;
    select.appendChild(autre);
}

function ouvrirFormDossier() {
    const formContainer = document.getElementById('dossier-form');
    const form = document.getElementById('form-dossier');
    const input = document.getElementById('dossier-nom');
    if (!formContainer) return;
    if (form) form.reset();
    cacherFormDocument();
    formContainer.style.display = 'block';
    if (input) input.focus();
}

function cacherFormDossier() {
    const formContainer = document.getElementById('dossier-form');
    if (formContainer) formContainer.style.display = 'none';
}

async function enregistrerDossier(e) {
    e.preventDefault();
    if (!isDocumentaliste()) { alert('Action réservée aux documentalistes.'); return; }
    const input = document.getElementById('dossier-nom');
    const nom = input ? input.value.trim() : '';
    if (!nom) { alert('Nom du dossier requis.'); return; }
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOSSIERS)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields: { 'Nom': nom } }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        if (input) input.value = '';
        cacherFormDossier();
        await chargerDossiers();
    } catch (err) {
        console.error(err);
        alert(`Erreur lors de la création du dossier : ${err.message}`);
    }
}

async function chargerDocumentsAeronefsBibliotheque() {
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS_AERONEFS)}?pageSize=100`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        const records = data.records || [];
        documentsAeronefsBibliothequeCache = records.reduce((acc, rec) => {
            const machine = rec.fields && rec.fields['Machine'];
            if (!machine) return acc;
            if (!acc[machine]) acc[machine] = [];
            acc[machine].push(rec);
            return acc;
        }, {});
    } catch (err) {
        console.error(err);
        documentsAeronefsBibliothequeCache = {};
    }
}

async function chargerDocuments() {
    const list = document.getElementById('documents-list');
    if (!list) return;
    list.innerHTML = '<p>Chargement...</p>';
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}?sort[0][field]=Titre&sort[0][direction]=asc`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        documentsCache = data.records || [];
        await chargerDocumentsAeronefsBibliotheque();
        afficherDocuments(documentsCache);
    } catch (err) {
        console.error(err);
        if (list) list.innerHTML = `<p style="color:red;">Erreur de chargement : ${err.message}</p>`;
    }
}

// Navigation « Finder » : chemin courant [categorie, sousDossier]
let docsNavChemin = [];

function docsEscAttr(s) {
    return (s || '').toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function docsTileDossier(nom, cle) {
    return `
        <div class="doc-tile" data-cle="${docsEscAttr(cle)}">
            <div class="doc-tile-icone">📁</div>
            <div class="doc-tile-nom">${nom}</div>
        </div>
    `;
}

function afficherDocuments(records) {
    const list = document.getElementById('documents-list');
    if (!list) return;
    const recordsVisibles = records.filter(rec => !estDocumentMembre(rec));
    const machines = Object.keys(documentsAeronefsBibliothequeCache || {}).sort();
    if (!recordsVisibles.length && !machines.length) {
        list.innerHTML = '<p>Aucun document pour le moment.</p>';
        return;
    }

    // Arborescence : categorie -> { sous-dossiers -> docs, docs racine }
    const arbre = {};
    recordsVisibles.forEach(rec => {
        const cat = (rec.fields || {})['Catégorie'] || 'Autre';
        const sous = (rec.fields || {})['Sous-dossier'] || '';
        if (!arbre[cat]) arbre[cat] = { sous: {}, docs: [] };
        if (sous) (arbre[cat].sous[sous] = arbre[cat].sous[sous] || []).push(rec);
        else arbre[cat].docs.push(rec);
    });
    const cats = Object.keys(arbre).sort();

    // Chemin encore valide ? (au cas ou un dossier aurait ete renomme)
    const cle0 = docsNavChemin[0];
    if (cle0 && !cle0.startsWith('⚙️ ') && !arbre[cle0]) docsNavChemin = [];
    else if (cle0 && cle0.startsWith('⚙️ ') && !machines.includes(cle0.slice(3))) docsNavChemin = [];
    if (docsNavChemin[1] && !(arbre[docsNavChemin[0]] || {}).sous?.[docsNavChemin[1]]) docsNavChemin = docsNavChemin.slice(0, 1);

    // Fil d'Ariane cliquable
    const miettes = [`<span class="docs-breadcrumb-item ${docsNavChemin.length ? 'docs-breadcrumb-lien' : ''}" data-idx="-1">📚 Bibliothèque</span>`]
        .concat(docsNavChemin.map((n, i) =>
            `<span class="docs-breadcrumb-sep">›</span><span class="docs-breadcrumb-item ${i < docsNavChemin.length - 1 ? 'docs-breadcrumb-lien' : ''}" data-idx="${i}">${docsEscAttr(n.startsWith('⚙️ ') ? n.slice(3) : n)}</span>`));
    const filAriane = `<div class="docs-breadcrumb">${miettes.join('')}</div>`;

    let contenu = '';
    const [cat, sous] = docsNavChemin;

    if (!cat) {
        // Racine : tuiles des categories + des machines
        const tuiles = cats.map(c => docsTileDossier(c, c)).join('') +
            machines.map(m => docsTileDossier(m, '⚙️ ' + m)).join('');
        contenu = `<div class="docs-tiles">${tuiles}</div>`;
    } else if (cat.startsWith('⚙️ ')) {
        // Dossier machine : mini-cartes avec pastille de validite
        contenu = docsHtmlMachine(cat.slice(3));
    } else if (!sous) {
        // Interieur d'une categorie : sous-dossiers en tuiles + documents
        const node = arbre[cat] || { sous: {}, docs: [] };
        const tuiles = Object.keys(node.sous).sort()
            .map(s => docsTileDossier(s, s)).join('');
        contenu = (tuiles ? `<div class="docs-tiles">${tuiles}</div>` : '') +
            docsHtmlCartes(node.docs);
    } else {
        // Interieur d'un sous-dossier : documents uniquement
        const node = arbre[cat] || { sous: {}, docs: [] };
        contenu = docsHtmlCartes(node.sous[sous] || []);
    }

    list.innerHTML = filAriane + contenu;

    // Tuiles : entrer dans le dossier
    list.querySelectorAll('.doc-tile').forEach(t => {
        t.addEventListener('click', () => {
            docsNavChemin = docsNavChemin.concat(t.dataset.cle);
            afficherDocuments(documentsCache);
        });
    });
    // Fil d'Ariane : remonter
    list.querySelectorAll('.docs-breadcrumb-lien').forEach(b => {
        b.addEventListener('click', () => {
            docsAllerA(parseInt(b.dataset.idx, 10));
        });
    });
}

function docsAllerA(index) {
    docsNavChemin = index === -1 ? [] : docsNavChemin.slice(0, index + 1);
    afficherDocuments(documentsCache);
}

function docsHtmlCartes(recs) {
    if (!recs.length) return '<p style="color:#94a3b8; font-size:13px;">Dossier vide.</p>';
    return `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">${recs.map(creerCarteDocument).join('')}</div>`;
}

function docsHtmlMachine(machine) {
    const docs = (documentsAeronefsBibliothequeCache[machine] || []).filter(r => r.fields && r.fields['Activé'] !== false);
    if (!docs.length) return '<p style="color:#94a3b8; font-size:13px;">Aucun document actif.</p>';
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);
    const dans3mois = new Date(aujourdhui);
    dans3mois.setMonth(dans3mois.getMonth() + 3);
    const cartes = docs.map(r => {
        const f = r.fields || {};
        const type = (typeof TYPES_DOCUMENTS_AERONEFS !== 'undefined' ? TYPES_DOCUMENTS_AERONEFS.find(t => t.code === f['Type de document']) : null) || { nom: f['Type de document'] };
        let couleur = '#10b981';
        let dateTxt = '';
        if (f['Date de validité']) {
            const dateValid = new Date(f['Date de validité'] + 'T00:00:00');
            dateTxt = ` – ${dateValid.toLocaleDateString('fr-FR')}`;
            if (dateValid < aujourdhui) couleur = '#dc2626';
            else if (dateValid < dans3mois) couleur = '#f97316';
        }
        const label = f['Lien']
            ? `<a href="${f['Lien']}" target="_blank" rel="noopener" style="color:#0f172a; text-decoration:underline;">${type.nom}${dateTxt}</a>`
            : `<span style="color:#0f172a;">${type.nom}${dateTxt}</span>`;
        return `
            <div style="display:flex; align-items:center; gap:6px; background:#f8fafc; padding: 4px 8px; border-radius: 6px; border: 1px solid #e2e8f0;">
                <span style="width:10px; height:10px; border-radius:50%; background:${couleur}; display:inline-block;"></span>
                ${label}
            </div>
        `;
    }).join('');
    return `<div style="display:flex; flex-wrap:wrap; gap:8px; font-size:12px;">${cartes}</div>`;
}

function creerCarteDocument(rec) {
    const f = rec.fields || {};
    const canEdit = isDocumentaliste();
    return `
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:12px;">
            <h4 style="margin:0 0 6px; color:#0f172a;">${f['Titre'] || 'Sans titre'}</h4>
            <p style="margin:0 0 10px; font-size:13px; color:#475569; min-height:1.2em;">${f['Description'] || ''}</p>
            <a href="${f['Lien'] || '#'}" target="_blank" rel="noopener" style="color:#166534; text-decoration:underline; font-size:13px; word-break:break-all;">Ouvrir le document ↗</a>
            ${canEdit ? `<div style="margin-top:10px; display:flex; gap:6px;">
                <button type="button" class="btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="ouvrirFormDocument('${rec.id}')">Modifier</button>
                <button type="button" class="btn-delete" style="padding:4px 10px; font-size:12px;" onclick="supprimerDocument('${rec.id}')">Supprimer</button>
            </div>` : ''}
        </div>
    `;
}

async function uploaderFichierDocument(file) {
    const uploadBase = API_BASE.slice(0, API_BASE.lastIndexOf('/'));
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${uploadBase}/upload`, {
        method: 'POST',
        headers: { Authorization: headers.Authorization },
        body: formData
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error((data.error && data.error.message) || `Erreur upload (${res.status})`);
    return data.url;
}

function ouvrirFormDocument(id = null) {
    const form = document.getElementById('form-document');
    const formContainer = document.getElementById('documents-form');
    const title = document.getElementById('documents-form-title');
    const inputId = document.getElementById('document-id');
    const select = document.getElementById('document-dossier');
    if (!form || !formContainer) return;
    form.reset();
    inputId.value = id || '';
    if (title) title.textContent = id ? 'Modifier le document' : 'Ajouter un document';
    chargerDossiers().then(() => {
        if (id) {
            const rec = documentsCache.find(d => d.id === id);
            if (rec) {
                const f = rec.fields;
                document.getElementById('document-titre').value = f['Titre'] || '';
                if (select) select.dataset.selected = f['Catégorie'] || '';
                populerDossiers();
                document.getElementById('document-sous-dossier').value = f['Sous-dossier'] || '';
                document.getElementById('document-lien').value = f['Lien'] || '';
                document.getElementById('document-description').value = f['Description'] || '';
            }
        } else {
            if (select) select.dataset.selected = '';
            populerDossiers();
            const input = document.getElementById('document-titre');
            if (input) input.focus();
        }
    });
    cacherFormDossier();
    formContainer.style.display = 'block';
}

function cacherFormDocument() {
    const formContainer = document.getElementById('documents-form');
    if (formContainer) formContainer.style.display = 'none';
}

async function enregistrerDocument(e) {
    e.preventDefault();
    if (!isDocumentaliste()) { alert('Action réservée aux documentalistes.'); return; }

    const id = document.getElementById('document-id').value;
    const titre = document.getElementById('document-titre').value.trim();
    const dossier = document.getElementById('document-dossier').value.trim();
    const sousDossier = document.getElementById('document-sous-dossier').value.trim();
    const lien = document.getElementById('document-lien').value.trim();
    const description = document.getElementById('document-description').value.trim();

    if (!titre || !lien) { alert('Le titre et le lien sont obligatoires.'); return; }
    if (!dossier) { alert('Veuillez choisir un dossier.'); return; }

    const fields = {
        'Titre': titre,
        'Catégorie': dossier,
        'Lien': lien,
        'Description': description
    };
    if (sousDossier) fields['Sous-dossier'] = sousDossier;
    if (!id) {
        fields['Auteur'] = currentUser ? `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() : '';
    }

    try {
        const method = id ? 'PATCH' : 'POST';
        const urlApi = `${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}`;
        const payload = id ? { records: [{ id, fields }] } : { records: [{ fields }] };
        const res = await cachedFetch(urlApi, { method, headers, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        cacherFormDocument();
        await chargerDocuments();
    } catch (err) {
        console.error(err);
        alert(`Erreur lors de l'enregistrement : ${err.message}`);
    }
}

async function supprimerDocument(id) {
    if (!isDocumentaliste()) { alert('Action réservée aux documentalistes.'); return; }
    if (!confirm('Supprimer ce document ?')) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}?records[]=${encodeURIComponent(id)}`, { method: 'DELETE', headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        await chargerDocuments();
    } catch (err) {
        console.error(err);
        alert(`Erreur lors de la suppression : ${err.message}`);
    }
}

document.addEventListener('DOMContentLoaded', initDocuments);
