/* ==========================================================================
   BASE DOCUMENTAIRE
   ========================================================================== */

const TABLE_DOCUMENTS = 'Documents';
const TABLE_DOSSIERS = 'Dossiers';
let documentsCache = [];
let dossiersCache = [];

function isDocumentaliste() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    const roles = currentUser.roles || [];
    return roles.includes('Documentaliste') || roles.includes('Super admin');
}

function appliquerAccesDocumentaire() {
    const toolbar = document.getElementById('documents-toolbar');
    if (toolbar) toolbar.style.display = isDocumentaliste() ? 'flex' : 'none';
}

function initDocuments() {
    const btnNewPdf = document.getElementById('btn-new-pdf');
    const btnNewDossier = document.getElementById('btn-new-dossier');
    const btnCancelDoc = document.getElementById('btn-cancel-document');
    const btnCancelDossier = document.getElementById('btn-cancel-dossier');
    const form = document.getElementById('form-document');
    const formDossier = document.getElementById('form-dossier');

    appliquerAccesDocumentaire();
    if (btnNewPdf) btnNewPdf.addEventListener('click', () => ouvrirFormDocument(null, 'PDF'));
    if (btnNewDossier) btnNewDossier.addEventListener('click', ouvrirFormDossier);
    if (btnCancelDoc) btnCancelDoc.addEventListener('click', cacherFormDocument);
    if (btnCancelDossier) btnCancelDossier.addEventListener('click', cacherFormDossier);
    if (form) form.addEventListener('submit', enregistrerDocument);
    if (formDossier) formDossier.addEventListener('submit', enregistrerDossier);
}

async function chargerDossiers() {
    try {
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOSSIERS)}?sort[0][field]=Nom&sort[0][direction]=asc`, { headers });
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
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOSSIERS)}`, {
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

async function chargerDocuments() {
    const list = document.getElementById('documents-list');
    if (!list) return;
    list.innerHTML = '<p>Chargement...</p>';
    try {
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOCUMENTS)}?sort[0][field]=Titre&sort[0][direction]=asc`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        documentsCache = data.records || [];
        afficherDocuments(documentsCache);
    } catch (err) {
        console.error(err);
        if (list) list.innerHTML = `<p style="color:red;">Erreur de chargement : ${err.message}</p>`;
    }
}

function afficherDocuments(records) {
    const list = document.getElementById('documents-list');
    if (!list) return;
    if (!records.length) {
        list.innerHTML = '<p>Aucun document pour le moment.</p>';
        return;
    }
    const grouped = records.reduce((acc, rec) => {
        const dossier = rec.fields['Dossier'] || 'Autre';
        if (!acc[dossier]) acc[dossier] = [];
        acc[dossier].push(rec);
        return acc;
    }, {});
    list.innerHTML = Object.keys(grouped).sort().map(dossier => `
        <div style="margin-bottom:20px;">
            <h3 style="color:#1e3d59; border-bottom:1px solid #cbd5e1; padding-bottom:6px; margin-bottom:10px;">${dossier}</h3>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
                ${grouped[dossier].map(rec => creerCarteDocument(rec)).join('')}
            </div>
        </div>
    `).join('');
}

function creerCarteDocument(rec) {
    const f = rec.fields || {};
    const canEdit = isDocumentaliste();
    const isPdf = (f['Type'] || '').toLowerCase() === 'pdf';
    const badge = isPdf ? '<span style="background:#fee2e2; color:#b91c1c; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:600; margin-left:8px;">PDF</span>' : '';
    const label = isPdf ? 'Ouvrir le PDF ↗' : 'Ouvrir le document ↗';
    return `
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:12px;">
            <h4 style="margin:0 0 6px; color:#0f172a;">${f['Titre'] || 'Sans titre'}${badge}</h4>
            <p style="margin:0 0 10px; font-size:13px; color:#475569; min-height:1.2em;">${f['Description'] || ''}</p>
            <a href="${f['Lien'] || '#'}" target="_blank" rel="noopener" style="color:#166534; text-decoration:underline; font-size:13px; word-break:break-all;">${label}</a>
            ${canEdit ? `<div style="margin-top:10px; display:flex; gap:6px;">
                <button type="button" class="btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="ouvrirFormDocument('${rec.id}', '${(f['Type'] || 'Lien').replace(/'/g, "\\'")}')">Modifier</button>
                <button type="button" class="btn-delete" style="padding:4px 10px; font-size:12px;" onclick="supprimerDocument('${rec.id}')">Supprimer</button>
            </div>` : ''}
        </div>
    `;
}

function ouvrirFormDocument(id = null, type = 'Lien') {
    const form = document.getElementById('form-document');
    const formContainer = document.getElementById('documents-form');
    const title = document.getElementById('documents-form-title');
    const inputId = document.getElementById('document-id');
    const inputType = document.getElementById('document-type');
    const inputLien = document.getElementById('document-lien');
    const labelLien = document.getElementById('document-lien-label');
    const helpLien = document.getElementById('document-lien-help');
    const select = document.getElementById('document-dossier');
    if (!form || !formContainer) return;
    form.reset();
    inputId.value = id || '';
    inputType.value = 'PDF';
    if (labelLien) labelLien.textContent = 'Lien du PDF';
    if (inputLien) { inputLien.placeholder = 'https://.../fichier.pdf'; inputLien.required = true; }
    if (helpLien) helpLien.style.display = 'block';
    if (title) title.textContent = id ? 'Modifier le PDF' : 'Ajouter un PDF';
    chargerDossiers().then(() => {
        if (id) {
            const rec = documentsCache.find(d => d.id === id);
            if (rec) {
                const f = rec.fields;
                document.getElementById('document-titre').value = f['Titre'] || '';
                if (select) select.dataset.selected = f['Dossier'] || '';
                populerDossiers();
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
    const type = document.getElementById('document-type').value;
    const titre = document.getElementById('document-titre').value.trim();
    const dossier = document.getElementById('document-dossier').value.trim();
    const lien = document.getElementById('document-lien').value.trim();
    const description = document.getElementById('document-description').value.trim();

    if (!titre || !lien) { alert('Le titre et le lien sont obligatoires.'); return; }
    if (!dossier) { alert('Veuillez choisir un dossier.'); return; }

    if (type === 'PDF') {
        try {
            const url = new URL(lien);
            if (!url.pathname.toLowerCase().endsWith('.pdf')) {
                alert('Le lien doit pointer vers un fichier PDF (extension .pdf).');
                return;
            }
        } catch (err) {
            alert(`Le lien n'est pas valide.`);
            return;
        }
    }

    const fields = {
        'Titre': titre,
        'Dossier': dossier,
        'Lien': lien,
        'Description': description,
        'Type': type
    };
    if (!id) {
        fields['Auteur'] = currentUser ? `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() : '';
    }

    try {
        const method = id ? 'PATCH' : 'POST';
        const urlApi = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOCUMENTS)}`;
        const payload = id ? { records: [{ id, fields }] } : { records: [{ fields }] };
        const res = await fetch(urlApi, { method, headers, body: JSON.stringify(payload) });
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
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_DOCUMENTS)}?records[]=${encodeURIComponent(id)}`, { method: 'DELETE', headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        await chargerDocuments();
    } catch (err) {
        console.error(err);
        alert(`Erreur lors de la suppression : ${err.message}`);
    }
}

document.addEventListener('DOMContentLoaded', initDocuments);
