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
    if (btnNewPdf) btnNewPdf.addEventListener('click', () => {
        const c = document.getElementById('documents-form');
        if (c && c.style.display === 'block') cacherFormDocument();
        else ouvrirFormDocument(null);
    });
    if (btnNewDossier) btnNewDossier.addEventListener('click', () => {
        const c = document.getElementById('dossier-form');
        if (c && c.style.display === 'block') cacherFormDossier();
        else ouvrirFormDossier();
    });
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

// Charge toutes les pages d'une table (pagination Airtable offset)
async function chargerTousEnregistrements(urlBase, forceRefresh = false) {
    const tous = [];
    let offset = '';
    do {
        const sep = urlBase.includes('?') ? '&' : '?';
        const res = await cachedFetch(`${urlBase}${sep}pageSize=100${offset ? `&offset=${offset}` : ''}`, { headers }, API_CACHE_TTL, forceRefresh);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        tous.push(...(data.records || []));
        offset = data.offset || '';
    } while (offset);
    return tous;
}

async function chargerDossiers(forceRefresh = false) {
    try {
        dossiersCache = await chargerTousEnregistrements(`${API_BASE}/${encodeURIComponent(TABLE_DOSSIERS)}?sort[0][field]=Nom&sort[0][direction]=asc`, forceRefresh);
        populerDossiers();
    } catch (err) {
        console.error(err);
    }
}

function populerDossiers() {
    const select = document.getElementById('document-dossier');
    if (!select) return;
    const selCat = select.dataset.catSelectionnee || '';
    const selSous = select.dataset.sousSelectionne || '';
    select.innerHTML = '<option value="">-- Choisir un dossier --</option>';

    const arbre = construireArbreDocs((documentsCache || []).filter(rec => !estDocumentMembre(rec)));
    const triFr = (a, b) => a.localeCompare(b, 'fr');
    const ajouterOption = (label, cat, sous) => {
        const opt = document.createElement('option');
        opt.textContent = label;
        opt.dataset.cat = cat;
        opt.dataset.sous = sous;
        if (cat === selCat && sous === selSous) opt.selected = true;
        select.appendChild(opt);
    };
    const descendre = (node, chemin) => {
        Object.keys(node.sous).sort(triFr).forEach(nom => {
            const c = chemin.concat(nom);
            ajouterOption('\u00A0'.repeat(3 * (c.length - 1)) + '\u21B3 ' + nom, c[0], c.slice(1).join('/'));
            descendre(node.sous[nom], c);
        });
    };
    Object.keys(arbre).sort(triFr).forEach(cat => {
        ajouterOption(cat, cat, '');
        descendre(arbre[cat], [cat]);
    });
    ajouterOption('Autre', 'Autre', '');
}

// Chemin complet du dossier courant (« Cat » , « Cat/S1/S2 »…), '' a la racine ou dans une machine
function dossierCourantBibliotheque() {
    if ((docsNavChemin[0] || '').startsWith('⚙️ ')) return '';
    return docsNavChemin.join('/');
}

// Renommage en cours : { nom, parent } ou null (mode creation)
let dossierEnRenommage = null;

function ouvrirFormDossier() {
    const formContainer = document.getElementById('dossier-form');
    const form = document.getElementById('form-dossier');
    const input = document.getElementById('dossier-nom');
    const title = document.getElementById('dossier-form-title');
    if (!formContainer) return;
    if (form) form.reset();
    dossierEnRenommage = null;
    const cat = dossierCourantBibliotheque();
    if (title) title.textContent = cat ? `Nouveau sous-dossier dans « ${docsNavChemin.join(' › ')} »` : 'Nouveau dossier';
    const btnSubmit = form ? form.querySelector('button[type="submit"]') : null;
    if (btnSubmit) btnSubmit.textContent = 'Créer';
    cacherFormDocument();
    formContainer.style.display = 'block';
    if (input) input.focus();
}

function ouvrirFormRenommerDossier(nom, parent) {
    if (!isDocumentaliste()) { alert('Action réservée aux documentalistes.'); return; }
    const formContainer = document.getElementById('dossier-form');
    const input = document.getElementById('dossier-nom');
    const title = document.getElementById('dossier-form-title');
    if (!formContainer || !input) return;
    dossierEnRenommage = { nom, parent };
    input.value = nom;
    if (title) title.textContent = parent ? `Renommer le sous-dossier « ${nom} »` : `Renommer le dossier « ${nom} »`;
    const form = document.getElementById('form-dossier');
    const btnSubmit = form ? form.querySelector('button[type="submit"]') : null;
    if (btnSubmit) btnSubmit.textContent = 'Enregistrer';
    cacherFormDocument();
    formContainer.style.display = 'block';
    input.focus();
    input.select();
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
    if (nom.includes('/')) { alert('Le nom ne peut pas contenir le caractère « / ».'); return; }
    if (dossierEnRenommage) {
        const { nom: ancien, parent } = dossierEnRenommage;
        dossierEnRenommage = null;
        await renommerDossierBiblio(ancien, nom, parent);
        return;
    }
    const parent = dossierCourantBibliotheque();
    const fields = { 'Nom': nom };
    if (parent) fields['Parent'] = parent;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOSSIERS)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        if (input) input.value = '';
        cacherFormDossier();
        await chargerDossiers();
        if (typeof documentsCache !== 'undefined') afficherDocuments(documentsCache);
    } catch (err) {
        console.error(err);
        alert(`Erreur lors de la création du dossier : ${err.message}`);
    }
}

// Chemins utilitaires : parent = chemin complet du dossier parent ('' = racine)
function docsCheminsCible(nom, parent) {
    const parentSegs = parent ? parent.split('/') : [];
    const cible = parentSegs.concat(nom).join('/');
    return {
        parentSegs,
        cible,
        catRacine: parentSegs[0] || '',
        sousParent: parentSegs.slice(1).join('/'),
        sousCible: parentSegs.concat(nom).slice(1).join('/')
    };
}

// Renvoie true si le document est dans le dossier cible ou l'un de ses descendants
function docsDocDansBranche(f, chemins) {
    if (!chemins.parent) {
        return f['Catégorie'] === chemins.cible;
    }
    const docSous = f['Sous-dossier'] || '';
    return f['Catégorie'] === chemins.catRacine &&
        (docSous === chemins.sousCible || docSous.startsWith(chemins.sousCible + '/'));
}

// Renvoie true si l'enregistrement Dossiers est le dossier cible ou un descendant
function docsDossierDansBranche(f, chemins) {
    const p = f['Parent'] || '';
    return (p === chemins.parent && f['Nom'] === chemins.nom)
        || p === chemins.cible
        || p.startsWith(chemins.cible + '/');
}

// Renomme un dossier (parent='') ou un sous-dossier (parent=chemin complet) et
// propage le nouveau nom aux documents et sous-dossiers rattaches.
async function renommerDossierBiblio(ancien, nouveau, parent) {
    if (!isDocumentaliste()) { alert('Action réservée aux documentalistes.'); return; }
    if (nouveau === ancien) { cacherFormDossier(); return; }
    if (nouveau.includes('/')) {
        alert('Le nom ne peut pas contenir le caractère « / ».');
        dossierEnRenommage = { nom: ancien, parent };
        return;
    }
    const chemins = { ...docsCheminsCible(ancien, parent), parent, nom: ancien };
    const nouvelleCible = parent ? `${parent}/${nouveau}` : nouveau;
    const sousNouveau = chemins.parentSegs.concat(nouveau).slice(1).join('/');
    const doublon = (documentsCache || []).some(r => {
        const f = r.fields || {};
        return parent
            ? (f['Catégorie'] === chemins.catRacine && (f['Sous-dossier'] || '') === sousNouveau)
            : (f['Catégorie'] === nouveau);
    }) || (dossiersCache || []).some(r => {
        const f = r.fields || {};
        return (f['Parent'] || '') === parent && f['Nom'] === nouveau;
    });
    if (doublon) {
        alert(`« ${nouveau} » existe déjà à cet emplacement.`);
        dossierEnRenommage = { nom: ancien, parent };
        return;
    }
    try {
        const docsConcernes = (documentsCache || []).filter(r => docsDocDansBranche(r.fields || {}, chemins));
        for (const rec of docsConcernes) {
            const docSous = (rec.fields || {})['Sous-dossier'] || '';
            const fields = parent
                ? { 'Sous-dossier': sousNouveau + docSous.slice(chemins.sousCible.length) }
                : { 'Catégorie': nouveau };
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}/${rec.id}`, {
                method: 'PATCH', headers, body: JSON.stringify({ fields })
            });
            if (!res.ok) throw new Error('Erreur lors de la mise à jour d\'un document');
        }
        const dossiersAMaj = (dossiersCache || []).filter(r => docsDossierDansBranche(r.fields || {}, chemins));
        for (const rec of dossiersAMaj) {
            const f = rec.fields || {};
            const p = f['Parent'] || '';
            const fields = (p === parent && f['Nom'] === ancien)
                ? { 'Nom': nouveau }
                : { 'Parent': nouvelleCible + p.slice(chemins.cible.length) };
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOSSIERS)}/${rec.id}`, {
                method: 'PATCH', headers, body: JSON.stringify({ fields })
            });
            if (!res.ok) throw new Error('Erreur lors du renommage du dossier');
        }
        const cheminStr = docsNavChemin.join('/');
        if (cheminStr === chemins.cible || cheminStr.startsWith(chemins.cible + '/')) {
            docsNavChemin = chemins.parentSegs.concat(nouveau, docsNavChemin.slice(chemins.parentSegs.length + 1));
        }
        cacherFormDossier();
        await Promise.all([chargerDossiers(), chargerDocuments()]);
    } catch (err) {
        console.error(err);
        dossierEnRenommage = { nom: ancien, parent };
        alert(`Erreur lors du renommage : ${err.message}`);
    }
}

// Deplace un dossier et toute sa branche sous un nouveau parent
// (nouveauParent='' = racine). Documents et sous-dossiers suivent.
async function deplacerDossierBiblio(nom, ancienParent, nouveauParent) {
    if (!isDocumentaliste()) { alert('Action réservée aux documentalistes.'); return; }
    if (nouveauParent.startsWith('⚙️ ')) return;
    const chemins = { ...docsCheminsCible(nom, ancienParent), parent: ancienParent, nom };
    if (nouveauParent === chemins.cible || nouveauParent.startsWith(chemins.cible + '/') || nouveauParent === ancienParent) return;
    const nouveauParentSegs = nouveauParent ? nouveauParent.split('/') : [];
    const sousCibleNouv = nouveauParentSegs.slice(1).concat(nom).join('/');
    const nouvCat = nouveauParentSegs[0] || '';
    const doublon = (documentsCache || []).some(r => {
        const f = r.fields || {};
        return nouveauParent
            ? (f['Catégorie'] === nouvCat && (f['Sous-dossier'] || '') === sousCibleNouv)
            : (f['Catégorie'] === nom);
    }) || (dossiersCache || []).some(r => {
        const f = r.fields || {};
        return (f['Parent'] || '') === nouveauParent && f['Nom'] === nom;
    });
    if (doublon) { alert(`Un dossier « ${nom} » existe déjà à cet emplacement.`); return; }
    const destination = nouveauParent ? `« ${nouveauParent.split('/').pop()} »` : 'la racine de la bibliothèque';
    if (!confirm(`Déplacer « ${nom} » vers ${destination} ?`)) return;
    try {
        const sousAncienSegs = chemins.parentSegs.slice(1).concat(nom);
        const nouvelleCible = nouveauParent ? `${nouveauParent}/${nom}` : nom;
        const docsConcernes = (documentsCache || []).filter(r => docsDocDansBranche(r.fields || {}, chemins));
        for (const rec of docsConcernes) {
            const docSousSegs = ((rec.fields || {})['Sous-dossier'] || '').split('/').filter(Boolean);
            const suffix = ancienParent ? docSousSegs.slice(sousAncienSegs.length) : docSousSegs;
            const newPath = nouveauParentSegs.concat(nom, suffix);
            const fields = { 'Catégorie': newPath[0], 'Sous-dossier': newPath.slice(1).join('/') };
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}/${rec.id}`, {
                method: 'PATCH', headers, body: JSON.stringify({ fields })
            });
            if (!res.ok) throw new Error('Erreur lors du déplacement d\'un document');
        }
        const dossiersAMaj = (dossiersCache || []).filter(r => docsDossierDansBranche(r.fields || {}, chemins));
        for (const rec of dossiersAMaj) {
            const f = rec.fields || {};
            const p = f['Parent'] || '';
            const fields = (p === ancienParent && f['Nom'] === nom)
                ? { 'Parent': nouveauParent }
                : { 'Parent': nouvelleCible + p.slice(chemins.cible.length) };
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOSSIERS)}/${rec.id}`, {
                method: 'PATCH', headers, body: JSON.stringify({ fields })
            });
            if (!res.ok) throw new Error('Erreur lors du déplacement du dossier');
        }
        const cheminStr = docsNavChemin.join('/');
        if (cheminStr === chemins.cible || cheminStr.startsWith(chemins.cible + '/')) {
            docsNavChemin = nouveauParentSegs.concat(nom, docsNavChemin.slice(chemins.parentSegs.length + 1));
        }
        await Promise.all([chargerDossiers(), chargerDocuments()]);
    } catch (err) {
        console.error(err);
        alert(`Erreur lors du déplacement : ${err.message}`);
    }
}

// Supprime un dossier (parent='') ou un sous-dossier (parent=chemin complet).
// Les documents ne sont jamais supprimes : ils remontent dans le dossier
// parent (sous-dossier) ou basculent dans « Autre » (dossier racine).
async function supprimerDossierBiblio(nom, parent) {
    if (!isDocumentaliste()) { alert('Action réservée aux documentalistes.'); return; }
    const chemins = { ...docsCheminsCible(nom, parent), parent, nom };
    const docsConcernes = (documentsCache || []).filter(r => docsDocDansBranche(r.fields || {}, chemins));
    const quoi = parent ? `le sous-dossier « ${nom} »` : `le dossier « ${nom} »`;
    const destination = parent ? `ils seront remontés dans « ${parent.split('/').pop()} »` : 'ils seront déplacés dans « Autre »';
    const msg = docsConcernes.length
        ? `Supprimer ${quoi} ?\n\nIl contient ${docsConcernes.length} document(s) : ${destination}.`
        : `Supprimer ${quoi} ?`;
    if (!confirm(msg)) return;
    try {
        for (const rec of docsConcernes) {
            const fields = parent
                ? { 'Sous-dossier': chemins.sousParent }
                : { 'Catégorie': 'Autre', 'Sous-dossier': '' };
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}/${rec.id}`, {
                method: 'PATCH', headers, body: JSON.stringify({ fields })
            });
            if (!res.ok) throw new Error('Erreur lors du déplacement d\'un document');
        }
        const aSupprimer = (dossiersCache || []).filter(r => docsDossierDansBranche(r.fields || {}, chemins));
        for (const rec of aSupprimer) {
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DOSSIERS)}/${rec.id}`, { method: 'DELETE', headers });
            if (!res.ok) throw new Error('Erreur lors de la suppression du dossier');
        }
        const cheminStr = docsNavChemin.join('/');
        if (cheminStr === chemins.cible || cheminStr.startsWith(chemins.cible + '/')) {
            docsNavChemin = chemins.parentSegs;
        }
        await Promise.all([chargerDossiers(), chargerDocuments()]);
    } catch (err) {
        console.error(err);
        alert(`Erreur lors de la suppression : ${err.message}`);
    }
}

async function chargerDocumentsAeronefsBibliotheque(forceRefresh = false) {
    try {
        const records = await chargerTousEnregistrements(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS_AERONEFS)}`, forceRefresh);
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
        documentsCache = await chargerTousEnregistrements(`${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}?sort[0][field]=Titre&sort[0][direction]=asc`);
        await Promise.all([chargerDossiers(), chargerDocumentsAeronefsBibliotheque()]);
        afficherDocuments(documentsCache);
    } catch (err) {
        console.error(err);
        if (list) list.innerHTML = `<p style="color:red;">Erreur de chargement : ${err.message}</p>`;
    }
}

// Navigation « Finder » : chemin courant, profondeur illimitee
// [categorie, sousDossier, sousSousDossier, ...]
let docsNavChemin = [];
let docsDragEnCours = false;

function docsAssurerNoeud(arbre, chemin) {
    let n = null;
    chemin.filter(Boolean).forEach(seg => {
        const cont = n ? n.sous : arbre;
        if (!cont[seg]) cont[seg] = { sous: {}, docs: [] };
        n = cont[seg];
    });
    return n;
}

function docsNoeudCourant(arbre, chemin) {
    let n = null;
    for (const seg of chemin) {
        const cont = n ? n.sous : arbre;
        if (!cont[seg]) return null;
        n = cont[seg];
    }
    return n;
}

// Arbre de la bibliotheque : Dossiers (Nom + Parent = chemin complet du parent)
// + chemins Catégorie/Sous-dossier des documents (Sous-dossier = chemin « A/B/… »)
function construireArbreDocs(recordsVisibles) {
    const arbre = {};
    (dossiersCache || []).forEach(rec => {
        const f = rec.fields || {};
        const nom = (f['Nom'] || '').trim();
        if (!nom) return;
        const parent = (f['Parent'] || '').trim();
        docsAssurerNoeud(arbre, parent ? parent.split('/').concat(nom) : [nom]);
    });
    (recordsVisibles || []).forEach(rec => {
        const f = rec.fields || {};
        const cat = f['Catégorie'] || 'Autre';
        const sous = (f['Sous-dossier'] || '').split('/').filter(Boolean);
        docsAssurerNoeud(arbre, [cat].concat(sous)).docs.push(rec);
    });
    return arbre;
}

function docsEscAttr(s) {
    return (s || '').toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function docsTileDossier(nom, cle, parent = '') {
    const modifiable = isDocumentaliste() && !cle.startsWith('⚙️ ');
    const titreSuppr = parent ? `Supprimer le sous-dossier « ${nom} »` : `Supprimer le dossier « ${nom} »`;
    const titreRen = parent ? `Renommer le sous-dossier « ${nom} »` : `Renommer le dossier « ${nom} »`;
    return `
        <div class="doc-tile" data-cle="${docsEscAttr(cle)}"${modifiable ? ' draggable="true"' : ''}>
            ${modifiable ? `<button type="button" class="doc-tile-ren" data-ren-nom="${docsEscAttr(cle)}" data-ren-parent="${docsEscAttr(parent)}" title="${docsEscAttr(titreRen)}">✏️</button>` : ''}
            ${modifiable ? `<button type="button" class="doc-tile-del" data-del-nom="${docsEscAttr(cle)}" data-del-parent="${docsEscAttr(parent)}" title="${docsEscAttr(titreSuppr)}">✕</button>` : ''}
            <div class="doc-tile-icone"><img src="dossier.png?v=2" alt="" class="doc-tile-img" onerror="this.outerHTML='&#128193;'"></div>
            <div class="doc-tile-nom">${nom}</div>
        </div>
    `;
}

function afficherDocuments(records) {
    const list = document.getElementById('documents-list');
    if (!list) return;
    const recordsVisibles = records.filter(rec => !estDocumentMembre(rec));
    const machines = Object.keys(documentsAeronefsBibliothequeCache || {}).sort();
    if (!recordsVisibles.length && !machines.length && !(dossiersCache || []).length) {
        list.innerHTML = '<p>Aucun document pour le moment.</p>';
        return;
    }

    // Arborescence a profondeur illimitee ; dossiers vides inclus
    const arbre = construireArbreDocs(recordsVisibles);
    const cats = Object.keys(arbre).sort();

    // Chemin encore valide ? (au cas ou un dossier aurait ete renomme/supprime)
    const valides = [];
    let noeud = null;
    for (const seg of docsNavChemin) {
        if (!noeud) {
            if (seg.startsWith('⚙️ ')) { if (machines.includes(seg.slice(3))) valides.push(seg); break; }
            if (!arbre[seg]) break;
            noeud = arbre[seg];
        } else {
            if (!noeud.sous[seg]) break;
            noeud = noeud.sous[seg];
        }
        valides.push(seg);
    }
    docsNavChemin = valides;

    // Fil d'Ariane cliquable
    const miettes = [`<span class="docs-breadcrumb-item ${docsNavChemin.length ? 'docs-breadcrumb-lien' : ''}" data-idx="-1">📚 Bibliothèque</span>`]
        .concat(docsNavChemin.map((n, i) =>
            `<span class="docs-breadcrumb-sep">›</span><span class="docs-breadcrumb-item ${i < docsNavChemin.length - 1 ? 'docs-breadcrumb-lien' : ''}" data-idx="${i}">${docsEscAttr(n.startsWith('⚙️ ') ? n.slice(3) : n)}</span>`));
    const filAriane = `<div class="docs-breadcrumb">${miettes.join('')}</div>`;

    let contenu = '';
    const cat = docsNavChemin[0];

    if (!cat) {
        // Racine : tuiles des categories + des machines
        const tuiles = cats.map(c => docsTileDossier(c, c, '')).join('') +
            machines.map(m => docsTileDossier(m, '⚙️ ' + m)).join('');
        contenu = `<div class="docs-tiles">${tuiles}</div>`;
    } else if (cat.startsWith('⚙️ ')) {
        // Dossier machine : mini-cartes avec pastille de validite
        contenu = docsHtmlMachine(cat.slice(3));
    } else {
        // Interieur d'un dossier : sous-dossiers en tuiles + documents
        const node = docsNoeudCourant(arbre, docsNavChemin) || { sous: {}, docs: [] };
        const cheminParent = docsNavChemin.join('/');
        const tuiles = Object.keys(node.sous).sort()
            .map(s => docsTileDossier(s, s, cheminParent)).join('');
        contenu = (tuiles ? `<div class="docs-tiles">${tuiles}</div>` : '') +
            (node.docs.length || !tuiles ? docsHtmlCartes(node.docs) : '');
    }

    list.innerHTML = filAriane + contenu;

    // Tuiles : entrer dans le dossier
    list.querySelectorAll('.doc-tile').forEach(t => {
        t.addEventListener('click', (e) => {
            if (docsDragEnCours || e.target.closest('.doc-tile-del, .doc-tile-ren')) return;
            docsNavChemin = docsNavChemin.concat(t.dataset.cle);
            afficherDocuments(documentsCache);
        });
    });
    // Tuiles : glisser-deposer pour deplacer un dossier
    // Le dossier transporte est passe par dataTransfer car « dragend » peut se
    // declencher AVANT « drop » sur certains navigateurs (tuileSource serait deja null)
    let tuileSource = null;
    const nettoyerDrag = () => {
        list.querySelectorAll('.doc-tile.dragging, .doc-tile.dragover, .docs-breadcrumb-item.dragover')
            .forEach(x => x.classList.remove('dragging', 'dragover'));
    };
    const chargeUtileDepot = (e) => {
        let info = null;
        try { info = JSON.parse(e.dataTransfer.getData('text/plain') || 'null'); } catch {}
        if (!info && tuileSource) info = { nom: tuileSource.dataset.delNom, parent: tuileSource.dataset.delParent || '' };
        return info;
    };
    const cibleDepot = (e, cheminCible) => {
        const info = chargeUtileDepot(e);
        if (!info || !info.nom || cheminCible.startsWith('⚙️ ')) return;
        deplacerDossierBiblio(info.nom, info.parent || '', cheminCible);
    };
    list.querySelectorAll('.doc-tile[draggable="true"]').forEach(t => {
        t.addEventListener('dragstart', (e) => {
            tuileSource = t;
            docsDragEnCours = true;
            t.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify({
                nom: t.dataset.delNom || '',
                parent: t.dataset.delParent || ''
            }));
        });
        t.addEventListener('dragend', () => {
            nettoyerDrag();
            setTimeout(() => { docsDragEnCours = false; tuileSource = null; }, 0);
        });
    });
    list.querySelectorAll('.doc-tile').forEach(t => {
        t.addEventListener('dragover', (e) => {
            if (!docsDragEnCours || t === tuileSource || (t.dataset.cle || '').startsWith('⚙️ ')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            t.classList.add('dragover');
        });
        t.addEventListener('dragleave', () => t.classList.remove('dragover'));
        t.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            t.classList.remove('dragover');
            if (t === tuileSource) return;
            cibleDepot(e, docsNavChemin.concat(t.dataset.cle).join('/'));
        });
    });
    // Fil d'Ariane : cible de depot pour remonter un dossier d'un ou plusieurs niveaux
    list.querySelectorAll('.docs-breadcrumb-item').forEach(b => {
        b.addEventListener('dragover', (e) => {
            if (!docsDragEnCours || (docsNavChemin[0] || '').startsWith('⚙️ ')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            b.classList.add('dragover');
        });
        b.addEventListener('dragleave', () => b.classList.remove('dragover'));
        b.addEventListener('drop', (e) => {
            e.preventDefault();
            b.classList.remove('dragover');
            const idx = parseInt(b.dataset.idx, 10);
            cibleDepot(e, idx === -1 ? '' : docsNavChemin.slice(0, idx + 1).join('/'));
        });
    });
    // Tuiles : suppression d'un dossier / sous-dossier
    list.querySelectorAll('.doc-tile-del').forEach(b => {
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            supprimerDossierBiblio(b.dataset.delNom, b.dataset.delParent || '');
        });
    });
    // Tuiles : renommage d'un dossier / sous-dossier
    list.querySelectorAll('.doc-tile-ren').forEach(b => {
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            ouvrirFormRenommerDossier(b.dataset.renNom, b.dataset.renParent || '');
        });
    });
    // Fil d'Ariane : remonter
    list.querySelectorAll('.docs-breadcrumb-lien').forEach(b => {
        b.addEventListener('click', () => {
            docsAllerA(parseInt(b.dataset.idx, 10));
        });
    });

    // Bouton contextualise : dossier a la racine, sous-dossier a l'interieur
    const btnDossier = document.getElementById('btn-new-dossier');
    if (btnDossier) {
        const dansMachine = (docsNavChemin[0] || '').startsWith('⚙️ ');
        btnDossier.style.display = dansMachine ? 'none' : '';
        btnDossier.textContent = docsNavChemin.length ? 'Nouveau sous-dossier' : 'Nouveau dossier';
    }
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
    const canEdit = typeof peutGererDocumentsAeronef === 'function' && peutGererDocumentsAeronef();
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);
    const dans3mois = new Date(aujourdhui);
    dans3mois.setMonth(dans3mois.getMonth() + 3);
    const cartes = docs.map(r => {
        const f = r.fields || {};
        const type = (typeof TYPES_DOCUMENTS_AERONEFS !== 'undefined' ? TYPES_DOCUMENTS_AERONEFS.find(t => t.code === f['Type de document']) : null) || { nom: f['Type de document'] };
        let couleur = '#10b981';
        let dateTxt = 'Sans date de validité';
        if (f['Date de validité']) {
            const dateValid = new Date(f['Date de validité'] + 'T00:00:00');
            const dateStr = dateValid.toLocaleDateString('fr-FR');
            if (dateValid < aujourdhui) { couleur = '#dc2626'; dateTxt = `Expiré le ${dateStr}`; }
            else if (dateValid < dans3mois) { couleur = '#f97316'; dateTxt = `Expire le ${dateStr}`; }
            else dateTxt = `Valide jusqu'au ${dateStr}`;
        }
        const lien = f['Lien']
            ? `<a href="${f['Lien']}" target="_blank" rel="noopener" style="color:#166534; text-decoration:underline; font-size:13px;">Ouvrir le document ↗</a>`
            : `<span style="font-size:13px; color:#94a3b8;">Aucun fichier lié</span>`;
        return `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:12px; display:flex; flex-direction:column;">
                <h4 style="margin:0 0 6px; color:#0f172a; display:flex; align-items:center; gap:8px;">
                    <span style="width:10px; height:10px; border-radius:50%; background:${couleur}; display:inline-block; flex-shrink:0;"></span>
                    ${type.nom}
                </h4>
                <p style="margin:0 0 10px; font-size:13px; color:#475569; min-height:1.2em;">${dateTxt}</p>
                <div style="margin-top:auto;">
                    ${lien}
                    ${canEdit ? `<div style="margin-top:10px; display:flex; gap:6px;">
                        <button type="button" class="btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="modifierDocumentAeronefBiblio('${r.id}', '${docsEscAttr(machine)}')">Modifier</button>
                        <button type="button" class="btn-delete" style="padding:4px 10px; font-size:12px;" onclick="supprimerDocumentAeronefBiblio('${r.id}', '${docsEscAttr(machine)}')">Supprimer</button>
                    </div>` : ''}
                </div>
            </div>
        `;
    }).join('');
    return `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">${cartes}</div>`;
}

async function rafraichirBibliothequeDocsAeronefs() {
    const vue = document.getElementById('view-documents');
    if (!vue || vue.style.display === 'none') return;
    await chargerDocumentsAeronefsBibliotheque(true);
    afficherDocuments(documentsCache);
}

async function modifierDocumentAeronefBiblio(id, machine) {
    if (typeof peutGererDocumentsAeronef !== 'function' || !peutGererDocumentsAeronef()) return;
    const record = (documentsAeronefsBibliothequeCache[machine] || []).find(r => r.id === id);
    if (!record) return;
    if (typeof creerModaleDocumentsAeronef === 'function') creerModaleDocumentsAeronef();
    await ouvrirModaleDocumentsAeronef(machine);
    ouvrirFormulaireDocumentAeronef(record);
}

async function supprimerDocumentAeronefBiblio(id, machine) {
    if (typeof peutGererDocumentsAeronef !== 'function' || !peutGererDocumentsAeronef()) return;
    const record = (documentsAeronefsBibliothequeCache[machine] || []).find(r => r.id === id);
    if (!record) return;
    machineDocumentsCourante = machine;
    await supprimerDocumentAeronef(record);
}

function creerCarteDocument(rec) {
    const f = rec.fields || {};
    const canEdit = isDocumentaliste();
    return `
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:12px; display:flex; flex-direction:column;">
            <h4 style="margin:0 0 6px; color:#0f172a;">${f['Titre'] || 'Sans titre'}</h4>
            <p style="margin:0 0 10px; font-size:13px; color:#475569; min-height:1.2em;">${f['Description'] || ''}</p>
            <div style="margin-top:auto;">
                <a href="${f['Lien'] || '#'}" target="_blank" rel="noopener" style="color:#166534; text-decoration:underline; font-size:13px; word-break:break-all;">Ouvrir le document ↗</a>
                ${canEdit ? `<div style="margin-top:10px; display:flex; gap:6px;">
                    <button type="button" class="btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="ouvrirFormDocument('${rec.id}')">Modifier</button>
                    <button type="button" class="btn-delete" style="padding:4px 10px; font-size:12px;" onclick="supprimerDocument('${rec.id}')">Supprimer</button>
                </div>` : ''}
            </div>
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
                if (select) {
                    select.dataset.catSelectionnee = f['Catégorie'] || '';
                    select.dataset.sousSelectionne = f['Sous-dossier'] || '';
                }
                populerDossiers();
                document.getElementById('document-lien').value = f['Lien'] || '';
                document.getElementById('document-description').value = f['Description'] || '';
            }
        } else {
            if (select) {
                const cat = dossierCourantBibliotheque() ? docsNavChemin[0] : '';
                select.dataset.catSelectionnee = cat;
                select.dataset.sousSelectionne = cat ? docsNavChemin.slice(1).join('/') : '';
            }
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
    const selectDossier = document.getElementById('document-dossier');
    const optSel = selectDossier ? selectDossier.options[selectDossier.selectedIndex] : null;
    const dossier = (optSel && optSel.dataset.cat) || '';
    const sousDossier = (optSel && optSel.dataset.sous) || '';
    const lien = document.getElementById('document-lien').value.trim();
    const description = document.getElementById('document-description').value.trim();

    if (!titre || !lien) { alert('Le titre et le fichier sont obligatoires.'); return; }
    if (!dossier) { alert('Veuillez choisir un dossier.'); return; }

    const fields = {
        'Titre': titre,
        'Catégorie': dossier,
        'Sous-dossier': sousDossier,
        'Lien': lien,
        'Description': description
    };
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
