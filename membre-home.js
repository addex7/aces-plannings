/* ==========================================================================
   ACCUEIL MEMBRE - VALIDITES ET PROFIL
   ==========================================================================
   Les colonnes ci-dessous doivent exister dans la table Airtable "Utilisateurs".
   Pour "Photo" : prévoir un champ Texte (simple ou long) pour stocker le dataURL.
   ========================================================================== */

const MEMBRE_FIELDS = {
    COTISATION: 'Cotisation',
    LICENCE_FFVP: 'Licence FFVP',
    LICENCE_FFA: 'Licence FFA',
    LICENCE_FFPLUM: 'Licence FFPLUM',
    MEDICAL: 'Médical',
    LICENCE_SEP: 'Licence SEP',
    PHOTO: 'Photo'
};

const VALIDITES = [
    { label: 'Cotisation', field: MEMBRE_FIELDS.COTISATION },
    { label: 'Licence assurance FFVP', field: MEMBRE_FIELDS.LICENCE_FFVP },
    { label: 'Licence assurance FFA', field: MEMBRE_FIELDS.LICENCE_FFA },
    { label: 'Licence assurance FFPLUM', field: MEMBRE_FIELDS.LICENCE_FFPLUM },
    { label: 'Médical', field: MEMBRE_FIELDS.MEDICAL },
    { label: 'Licence SEP', field: MEMBRE_FIELDS.LICENCE_SEP }
];

function formaterDateFr(str) {
    if (!str) return null;
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function debutJour(d) {
    const j = new Date(d);
    j.setHours(0, 0, 0, 0);
    return j;
}

function estValideJusqua(str) {
    if (!str) return false;
    const d = new Date(str);
    if (isNaN(d.getTime())) return false;
    return debutJour(d) >= debutJour(new Date());
}

function pastille(ok, dateStr, texteRouge) {
    const couleur = ok ? 'pastille-verte' : 'pastille-rouge';
    const texte = ok ? 'À jour' : (dateStr ? 'Non à jour' : (texteRouge || 'Non renseigné'));
    const date = formaterDateFr(dateStr) || '-';
    return `<span class="pastille ${couleur}">${ok ? '✓' : '✕'} ${texte}</span><span class="validite-date">Valide jusqu'au : ${date}</span>`;
}

async function chargerAccueilMembre() {
    const container = document.getElementById('accueil-membre-container');
    if (!container) return;
    if (!currentUser) {
        container.innerHTML = '<p class="carnet-empty">Veuillez vous connecter pour voir votre profil.</p>';
        return;
    }
    container.innerHTML = '<p class="carnet-empty">Chargement du profil...</p>';
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${currentUser.id}`;
        const res = await cachedFetch(url, { headers }, 0, true);
        const record = await res.json();
        if (!res.ok) throw new Error(record.error?.message || 'Erreur');
        renderAccueilMembre(record.fields || {});
    } catch (err) {
        console.error('Erreur chargement accueil membre:', err);
        container.innerHTML = '<p class="carnet-empty">Impossible de charger le profil.</p>';
    }
}

function renderPhoto(fields) {
    const img = document.getElementById('accueil-photo');
    if (!img) return;
    const photoField = fields[MEMBRE_FIELDS.PHOTO];
    let src = '';
    if (Array.isArray(photoField) && photoField.length) {
        const att = photoField[0];
        src = att.url || att.thumbnails?.large?.url || att.thumbnails?.small?.url || '';
    } else if (typeof photoField === 'string' && photoField.trim()) {
        src = photoField;
    }
    if (!src) {
        const initiales = `${(currentUser.prenom || '').charAt(0)}${(currentUser.nom || '').charAt(0)}`.toUpperCase();
        img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initiales || 'User')}&background=random&size=128`;
        return;
    }
    img.src = src;
}

function renderAccueilMembre(fields) {
    const container = document.getElementById('accueil-membre-container');
    if (!container) return;
    const nomEl = document.getElementById('accueil-nom');
    const rolesEl = document.getElementById('accueil-roles');
    if (nomEl) nomEl.textContent = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    if (rolesEl) rolesEl.textContent = (currentUser.roles || []).join(' · ') || 'Membre';
    const grid = VALIDITES.map(item => {
        const val = fields[item.field];
        const ok = estValideJusqua(val);
        return `
            <div class="validite-card">
                <div class="validite-label">${item.label}</div>
                <div class="validite-pill">${pastille(ok, val)}</div>
            </div>
        `;
    }).join('');
    container.innerHTML = `
        <div class="validite-grid">${grid}</div>
        <div class="validite-card validite-experience">
            <div class="validite-label">Expérience récente (1 vol dans les 3 derniers mois)</div>
            <div class="validite-pill" id="accueil-experience">${pastille(false, null, 'Chargement...')}</div>
        </div>
    `;
    renderPhoto(fields);
    chargerExperienceRecente();
}

async function chargerExperienceRecente() {
    const target = document.getElementById('accueil-experience');
    if (!target || !currentUser) return;
    try {
        const tableCarnet = typeof TABLE_CARNET_ROUTE !== 'undefined' ? TABLE_CARNET_ROUTE : 'Carnet de route Pilotes';
        const prenom = (currentUser.prenom || '').replace(/"/g, '\\"');
        const nom = (currentUser.nom || '').replace(/"/g, '\\"');
        const formula = `OR(FIND(UPPER("${prenom}"), UPPER({Pilote})) > 0, FIND(UPPER("${nom}"), UPPER({Pilote})) > 0)`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableCarnet)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=1`;
        const res = await cachedFetch(url, { headers }, 0, true);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const vol = (data.records || [])[0];
        if (!vol || !vol.fields['Date']) {
            target.innerHTML = pastille(false, null, 'Aucun vol dans les 3 derniers mois');
            return;
        }
        const dateVol = new Date(vol.fields['Date']);
        const debutAuj = debutJour(new Date());
        const debutVol = debutJour(dateVol);
        const nbJours = Math.floor((debutAuj - debutVol) / (1000 * 60 * 60 * 24));
        const limite = new Date(dateVol);
        limite.setMonth(limite.getMonth() + 3);
        let couleur, icone, texte;
        if (nbJours < 30) {
            couleur = 'pastille-orange';
            icone = '!';
            texte = 'Récent';
        } else if (nbJours < 90) {
            couleur = 'pastille-verte';
            icone = '✓';
            texte = 'À jour';
        } else {
            couleur = 'pastille-rouge';
            icone = '✕';
            texte = 'Non à jour';
        }
        target.innerHTML = `
            <span class="pastille ${couleur}">${icone} ${texte}</span>
            <span class="validite-date">Dernier vol : ${formaterDateFr(dateVol.toISOString())}</span>
            <span class="validite-date">Valide jusqu'au : ${formaterDateFr(limite.toISOString())}</span>
        `;
    } catch (err) {
        console.error('Erreur expérience récente:', err);
        target.innerHTML = pastille(false, null, 'Erreur de chargement');
    }
}

async function mettreAJourPhoto(dataURL) {
    if (!currentUser) return;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${currentUser.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { [MEMBRE_FIELDS.PHOTO]: dataURL } })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        renderPhoto(data.fields || {});
    } catch (err) {
        console.error('Erreur upload photo:', err);
        alert('Erreur lors de la sauvegarde de la photo. Vérifiez que le champ "Photo" est un champ Texte dans Airtable.');
    }
}

function redimensionnerImage(file, maxLargeur = 400, qualite = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = e => {
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ratio = Math.min(1, maxLargeur / img.width);
                canvas.width = Math.round(img.width * ratio);
                canvas.height = Math.round(img.height * ratio);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', qualite));
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function uploaderPhoto(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    try {
        const dataURL = await redimensionnerImage(file, 400, 0.7);
        if (dataURL.length > 90000) {
            alert('L\'image reste trop volumineuse après compression. Choisissez une photo plus légère (moins de 2 Mo idéalement).');
            return;
        }
        const preview = document.getElementById('accueil-photo');
        if (preview) preview.src = dataURL;
        await mettreAJourPhoto(dataURL);
    } catch (err) {
        console.error(err);
        alert('Erreur lors du traitement de l\'image.');
    }
    input.value = '';
}

function initAccueilMembre() {
    const input = document.getElementById('accueil-photo-input');
    if (input) input.addEventListener('change', uploaderPhoto);
}

document.addEventListener('DOMContentLoaded', initAccueilMembre);
