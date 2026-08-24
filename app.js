/* ==========================================================================
   APPLICATION DE GESTION AÉROCLUB - POINT D'ENTRÉE PRINCIPAL
   ========================================================================== */

// Configuration API Airtable (globale pour tous les modules)
const AIRTABLE_PAT = 'patbX51fRBLO4v35h.e116a6e20d699408c3a49d07137099bbaf3fe23e734767dea63fa5d890508fff';
const BASE_ID = 'appufjvD3gYG6H44n';
const TABLE_NOTIFICATIONS = 'Notifications';
const headers = { 
    Authorization: `Bearer ${AIRTABLE_PAT}`,
    'Content-Type': 'application/json'
};

// Variables globales partagées entre tous les modules
let dateAffichee = new Date();
dateAffichee.setHours(12, 0, 0, 0);
let listeAvionsCache = []; 
let listeReservationsCache = [];
let idReservationEnEdition = null; 
let isResizing = false; 
let isDraggingBar = false;

// Variables globales pour la modale
let modal, groupCommentaires, btnDelete, titleModal, formReservation;

// --- INITIALISATION AU CHARGEMENT DU DOM ---
document.addEventListener('DOMContentLoaded', () => {
    genererFriseHeures();
    genererFriseHeuresSuivi();
    mettreAJourDateAffichee();
    initBoutonsNavigation();
    initGestionnaireModale();
    initNavigationTabs();
    initGestionnaireVolsInitiation();
    initGestionCreneauxVI();
    initCarnetRoute();
    initSidebarToggle();
    initEvenements();
    initComptesPilotes();
    initNotifications();
    Promise.all([
        chargerDonneesPlanning(),
        chargerPresencesClub()
    ]).catch(err => console.error('Erreur chargement initial:', err));
});

function initSidebarToggle() {
    const toggle = document.getElementById('sidebar-toggle');
    const layout = document.querySelector('.app-layout');
    if (!toggle || !layout) return;
    toggle.addEventListener('click', () => {
        const collapsed = layout.classList.toggle('sidebar-collapsed');
        toggle.textContent = collapsed ? '❯' : '❮';
        toggle.title = collapsed ? 'Afficher le menu' : 'Masquer le menu';
    });
}

function escHtml(s) {
    return (s || '').toString().replace(/[&<"']/g, c => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initNotifications() {
    const bell = document.getElementById('notifications-bell');
    const panel = document.getElementById('notifications-panel');
    const close = document.getElementById('notifications-close');
    if (bell && panel) {
        bell.addEventListener('click', () => {
            const visible = panel.style.display !== 'none';
            panel.style.display = visible ? 'none' : 'block';
            if (!visible) chargerNotifications();
        });
    }
    if (close && panel) close.addEventListener('click', () => panel.style.display = 'none');
    document.addEventListener('click', (e) => {
        if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
            panel.style.display = 'none';
        }
    });
}

async function chargerNotifications() {
    if (!currentUser) return;
    const list = document.getElementById('notifications-list');
    const count = document.getElementById('notifications-count');
    const piloteNom = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    if (!list) return;
    try {
        const formula = `{Pilote}='${piloteNom.replace(/'/g, "\\'")}'`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NOTIFICATIONS)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=20`;
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const records = data.records || [];
        afficherNotifications(records);
        const nonLues = records.filter(r => !(r.fields || {})['Lue']).length;
        if (count) {
            count.textContent = nonLues;
            count.style.display = nonLues > 0 ? 'inline' : 'none';
        }
    } catch (err) {
        console.error(err);
        list.innerHTML = '<p class="notifications-vide">Impossible de charger les notifications.</p>';
    }
}

function afficherNotifications(records) {
    const list = document.getElementById('notifications-list');
    if (!list) return;
    if (!records.length) {
        list.innerHTML = '<p class="notifications-vide">Aucune notification.</p>';
        return;
    }
    list.innerHTML = records.map(r => {
        const f = r.fields || {};
        const date = f['Date'] ? new Date(f['Date']).toLocaleDateString('fr-FR') : '';
        const message = f['Message'] || '';
        const type = f['Type'] || 'info';
        const lue = f['Lue'];
        const cls = lue ? 'notification-lue' : 'notification-non-lue';
        return `<div class="notification-item ${cls}" data-id="${escHtml(r.id)}">
            <div class="notification-meta"><span class="notification-type">${escHtml(type)}</span><span class="notification-date">${escHtml(date)}</span></div>
            <p class="notification-message">${escHtml(message)}</p>
        </div>`;
    }).join('');
    list.querySelectorAll('.notification-item').forEach(item => {
        item.addEventListener('click', () => marquerNotificationLue(item.dataset.id));
    });
}

async function marquerNotificationLue(recordId) {
    try {
        const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NOTIFICATIONS)}/${recordId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { Lue: true } })
        });
        if (!res.ok) throw new Error();
        await chargerNotifications();
    } catch (err) {
        console.error(err);
    }
}

async function creerNotification(piloteNom, message, type = 'info', lien = '') {
    const body = {
        records: [{
            fields: {
                'Pilote': piloteNom,
                'Message': message,
                'Type': type,
                'Date': new Date().toISOString().slice(0, 10),
                'Lue': false,
                'Lien': lien
            }
        }]
    };
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NOTIFICATIONS)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
}
