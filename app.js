/* ==========================================================================
   APPLICATION DE GESTION AÉROCLUB - POINT D'ENTRÉE PRINCIPAL
   ========================================================================== */

let currentUser = null;

// Configuration API (globale pour tous les modules)
// Backend auto-heberge sur le VPS OVH (PostgreSQL + facade compatible Airtable)
const API_TOKEN = '487b83e3d804b74ba432d76a5fe4fcb3a8fae00cd4714c0ec2582403b3b55efb';
const AIRTABLE_PAT = API_TOKEN;
const API_BASE = 'https://vps-1a4fbee9.vps.ovh.net/v0/glide2000';
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
    initSidebarResize();
    initEvenements();
    initComptesPilotes();
    initNotifications();
    afficherAvertissementMobile();
    Promise.all([
        chargerDonneesPlanning(),
        chargerPresencesClub()
    ]).catch(err => console.error('Erreur chargement initial:', err));
});

// Détection téléphone / tablette : le site n'est pas encore optimisé
// pour ces plateformes — on affiche un message informatif au chargement.
function estAppareilMobileOuTablette() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPod|iPad|Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return true;
    // iPadOS 13+ se présente comme un Mac : on le reconnaît au tactile multipoint
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
    // Repli : appareil dont le pointeur principal est tactile avec un petit écran
    const tactilePrincipal = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return !!tactilePrincipal && Math.min(screen.width, screen.height) < 1024;
}

function afficherAvertissementMobile() {
    if (!estAppareilMobileOuTablette()) return;
    const modal = document.getElementById('mobile-warning-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    const fermer = () => { modal.style.display = 'none'; };
    const btnOk = document.getElementById('btn-mobile-warning-ok');
    if (btnOk) btnOk.addEventListener('click', fermer);
    modal.addEventListener('click', (e) => { if (e.target === modal) fermer(); });
}

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

const SIDEBAR_W_KEY = 'aces-sidebar-width';
const SIDEBAR_W_MIN = 140;
const SIDEBAR_W_MAX = 500;
const SIDEBAR_W_BASE = 170;

function applySidebarWidth(w) {
    const layout = document.querySelector('.app-layout');
    const sidebar = document.querySelector('.sidebar');
    if (!layout || !sidebar) return;
    w = Math.round(Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, w)));
    // zoom redimensionne aussi le texte/contenu ; sans support, on joue sur la largeur
    if (window.CSS && CSS.supports && CSS.supports('zoom', '1')) {
        layout.style.setProperty('--sb-w', SIDEBAR_W_BASE + 'px');
        sidebar.style.zoom = (w / SIDEBAR_W_BASE).toFixed(4);
    } else {
        layout.style.setProperty('--sb-w', w + 'px');
        sidebar.style.zoom = '';
    }
    layout.style.setProperty('--sb-edge', w + 'px');
    try { localStorage.setItem(SIDEBAR_W_KEY, String(w)); } catch (e) {}
}

function initSidebarResize() {
    const layout = document.querySelector('.app-layout');
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.querySelector('.sidebar');
    if (!layout || !resizer || !sidebar) return;

    try {
        const saved = parseFloat(localStorage.getItem(SIDEBAR_W_KEY));
        if (saved && !isNaN(saved)) applySidebarWidth(saved);
    } catch (e) {}

    let dragging = false;
    resizer.addEventListener('pointerdown', (e) => {
        dragging = true;
        layout.classList.add('sidebar-resizing');
        resizer.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    resizer.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        applySidebarWidth(e.clientX - layout.getBoundingClientRect().left);
    });
    const stop = (e) => {
        if (!dragging) return;
        dragging = false;
        layout.classList.remove('sidebar-resizing');
        try { resizer.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    resizer.addEventListener('pointerup', stop);
    resizer.addEventListener('pointercancel', stop);
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
    const piloteNom = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    if (!list) return;
    try {
        const formula = `{Pilote}='${piloteNom.replace(/'/g, "\\'")}'`;
        const url = `${API_BASE}/${encodeURIComponent(TABLE_NOTIFICATIONS)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=20`;
        const res = await apiFetch(url, { headers });
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
        const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_NOTIFICATIONS)}/${recordId}`, {
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
                'Pilote': typeof formaterNomPilote === 'function' ? formaterNomPilote(piloteNom) : piloteNom,
                'Message': message,
                'Type': type,
                'Date': new Date().toISOString().slice(0, 10),
                'Lue': false,
                'Lien': lien
            }
        }]
    };
    await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_NOTIFICATIONS)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
}

/* ==========================================================================
   ACTUALISATION AUTOMATIQUE DE LA VUE COURANTE
   Recharge les donnees de la vue affichee toutes les 60 s et au retour de
   focus sur l'onglet, sans intervention de l'utilisateur. Suspendu quand
   une modale est ouverte, un champ est modifie ou un glisser-deposer est
   en cours (pour ne pas detruire une saisie).
   ========================================================================== */
const REFRESH_AUTO_INTERVAL_MS = 60000;
const REFRESH_AUTO_MIN_ECART_MS = 15000;
let dernierRefreshAuto = 0;

const RAFRAICHSSEURS_VUES = {
    'view-accueil-pilote': () => typeof chargerAccueilPilote === 'function' && chargerAccueilPilote(),
    'view-planning': () => typeof chargerDonneesPlanning === 'function' && chargerDonneesPlanning(true, false, true),
    'view-initiation': () => typeof chargerVolsInitiation === 'function' && chargerVolsInitiation(),
    'view-aeronefs': () => typeof chargerSuiviAeronef === 'function' && chargerSuiviAeronef(),
    'view-instructeur': () => typeof chargerSuiviInstructeur === 'function' && chargerSuiviInstructeur(),
    'view-carnet': () => typeof chargerCarnetRoute === 'function' && chargerCarnetRoute(),
    'view-membres': () => typeof chargerUtilisateurs === 'function' && chargerUtilisateurs(),
    'view-documents': () => typeof chargerDocuments === 'function' && chargerDocuments(),
    'view-accueil-membre': () => typeof chargerAccueilMembre === 'function' && chargerAccueilMembre(
        (typeof membreSelectionne !== 'undefined' && membreSelectionne) ? membreSelectionne.id : (currentUser ? currentUser.id : null)),
    'view-comptes': () => typeof chargerComptesPilotes === 'function' && chargerComptesPilotes(),
    'view-audit': () => typeof chargerAudit === 'function' && chargerAudit(true),
    'view-messagerie': () => typeof chargerMessagerie === 'function' && chargerMessagerie()
};

function saisieEnCours(vue) {
    const ae = document.activeElement;
    if (ae && (['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName) || ae.isContentEditable)) return true;
    // Modale ouverte ?
    if ([...document.querySelectorAll('.modal')].some(m => m.style.display === 'flex' || m.style.display === 'block')) return true;
    const saving = document.getElementById('saving-overlay');
    if (saving && saving.style.display && saving.style.display !== 'none') return true;
    // Glisser-deposer / redimensionnement planning
    if ((typeof isDraggingBar !== 'undefined' && isDraggingBar) || (typeof isResizing !== 'undefined' && isResizing)) return true;
    // Champ modifie par l'utilisateur dans la vue courante (brouillon, filtre...)
    if (vue) {
        const champsModifies = [...vue.querySelectorAll('input, textarea, select')].some(el => {
            if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
            if (el.type === 'button' || el.type === 'submit' || el.type === 'file' || el.type === 'hidden') return false;
            return el.value !== el.defaultValue;
        });
        if (champsModifies) return true;
    }
    return false;
}

// Instantane fige de la vue posee en overlay pendant le refresh auto :
// le contenu se recharge en dessous puis le masque est retire (pas de
// flash « Chargement... »). Le clone est en fin de <body>, donc les
// getElementById continuent de cibler la vraie vue (document order).
function creerSnapshotVue(vue) {
    const r = vue.getBoundingClientRect();
    const clone = vue.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    const bg = getComputedStyle(document.body).backgroundColor || '#f4f6f9';
    clone.style.cssText = `position:fixed;z-index:500;top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px;margin:0;overflow:hidden;background:${bg};pointer-events:none;`;
    document.body.appendChild(clone);
    // Reproduit la position de scroll des sous-elements scrollables
    const orig = vue.querySelectorAll('*');
    const copie = clone.querySelectorAll('*');
    for (let i = 0; i < orig.length; i++) {
        if (orig[i].scrollTop) copie[i].scrollTop = orig[i].scrollTop;
        if (orig[i].scrollLeft) copie[i].scrollLeft = orig[i].scrollLeft;
    }
    return clone;
}

function rafraichirVueCourante() {
    if (!currentUser || document.hidden) return;
    const vue = [...document.querySelectorAll('.view-section')].find(v => v.style.display !== 'none');
    if (!vue) return;
    const fn = RAFRAICHSSEURS_VUES[vue.id];
    if (!fn || saisieEnCours(vue)) return;
    dernierRefreshAuto = Date.now();
    if (typeof viderApiCache === 'function') viderApiCache();
    const snapshot = creerSnapshotVue(vue);
    let retire = false;
    const retirer = () => {
        if (retire) return;
        retire = true;
        setTimeout(() => snapshot.remove(), 400);
    };
    Promise.resolve().then(fn).then(retirer).catch(e => { console.warn('Actualisation auto:', e); retirer(); });
    // Filet de securite : ne jamais laisser le masque plus de 10 s
    setTimeout(retirer, 10000);
}

setInterval(rafraichirVueCourante, REFRESH_AUTO_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - dernierRefreshAuto > REFRESH_AUTO_MIN_ECART_MS) rafraichirVueCourante();
});
