/* ==========================================================================
   JOURNAL D'AUDIT - LOG DES ACTIONS UTILISATEURS (superadmin)
   ========================================================================== */

const TABLE_AUDIT = 'Audit';
const FIELDS_AUDIT = {
    DATE: 'Date',
    UTILISATEUR: 'Utilisateur',
    ACTION: 'Action',
    CIBLE: 'Cible',
    DETAILS: 'Détails',
    MODULE: 'Module'
};

let auditRecordsCache = [];

function initAudit() {
    const search = document.getElementById('audit-search');
    const moduleFiltre = document.getElementById('audit-module-filtre');
    const reload = document.getElementById('audit-reload');

    if (reload) reload.addEventListener('click', () => chargerAudit(true));
    if (search) search.addEventListener('input', filtrerAudit);
    if (moduleFiltre) moduleFiltre.addEventListener('change', filtrerAudit);
}

async function enregistrerAudit(action, cible = '', details = '', module = '') {
    const utilisateur = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '';
    const body = {
        records: [{
            fields: {
                [FIELDS_AUDIT.DATE]: new Date().toISOString(),
                [FIELDS_AUDIT.UTILISATEUR]: utilisateur,
                [FIELDS_AUDIT.ACTION]: action,
                [FIELDS_AUDIT.CIBLE]: cible,
                [FIELDS_AUDIT.DETAILS]: details,
                [FIELDS_AUDIT.MODULE]: module
            }
        }]
    };
    try {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_AUDIT)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
    } catch (err) {
        console.error('Erreur enregistrement audit:', err);
    }
}

async function chargerAudit(force = false) {
    const tbody = document.getElementById('audit-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="carnet-empty">Chargement...</td></tr>';
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_AUDIT)}?sort[0][field]=${FIELDS_AUDIT.DATE}&sort[0][direction]=desc&pageSize=100`;
        const res = await cachedFetch(url, { headers }, 30000, force);
        const data = await res.json();
        if (!res.ok) {
            const message = data.error?.message || 'Erreur inconnue';
            if (res.status === 403 || res.status === 404) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="carnet-empty">La table "Audit" n\'existe pas ou n\'est pas accessible. Vérifie son nom et les permissions du token Airtable.</td></tr>';
            } else if (res.status === 422) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="carnet-empty">Paramètres de chargement invalides. Vérifie la configuration du journal.</td></tr>';
            } else {
                throw new Error(message);
            }
            return;
        }
        auditRecordsCache = data.records || [];
        filtrerAudit();
    } catch (err) {
        console.error(err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="carnet-empty">Erreur de chargement du journal : ${escHtml(err.message || 'inconnue')}</td></tr>`;
    }
}

function filtrerAudit() {
    const search = document.getElementById('audit-search');
    const moduleFiltre = document.getElementById('audit-module-filtre');
    const q = search ? (search.value || '').toLowerCase() : '';
    const m = moduleFiltre ? moduleFiltre.value : '';
    const filtre = auditRecordsCache.filter(r => {
        const f = r.fields || {};
        const texte = `${f[FIELDS_AUDIT.UTILISATEUR] || ''} ${f[FIELDS_AUDIT.ACTION] || ''} ${f[FIELDS_AUDIT.CIBLE] || ''} ${f[FIELDS_AUDIT.DETAILS] || ''}`.toLowerCase();
        const matchTexte = !q || texte.includes(q);
        const matchModule = !m || (f[FIELDS_AUDIT.MODULE] || '') === m;
        return matchTexte && matchModule;
    });
    afficherAudit(filtre);
}

function afficherAudit(records) {
    const tbody = document.getElementById('audit-body');
    if (!tbody) return;
    if (!records || records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="carnet-empty">Aucune action enregistrée.</td></tr>';
        return;
    }
    tbody.innerHTML = records.map(r => {
        const f = r.fields || {};
        const d = f[FIELDS_AUDIT.DATE] ? new Date(f[FIELDS_AUDIT.DATE]) : null;
        const dateHeure = d ? `${d.toLocaleDateString('fr-FR')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '-';
        return `
            <tr>
                <td class="audit-date">${escHtml(dateHeure)}</td>
                <td class="audit-user">${escHtml(f[FIELDS_AUDIT.UTILISATEUR] || '')}</td>
                <td class="audit-action">${escHtml(f[FIELDS_AUDIT.ACTION] || '')}</td>
                <td class="audit-target">${escHtml(f[FIELDS_AUDIT.CIBLE] || '')}</td>
                <td class="audit-detail">${escHtml(f[FIELDS_AUDIT.DETAILS] || '')}</td>
            </tr>
        `;
    }).join('');
}

document.addEventListener('DOMContentLoaded', initAudit);
