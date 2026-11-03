/* ==========================================================================
   APPLICATION DE GESTION AÉROCLUB - POINT D'ENTRÉE PRINCIPAL
   ========================================================================== */

let currentUser = null;

// Configuration API (globale pour tous les modules)
// Backend auto-heberge sur le VPS OVH (PostgreSQL + facade compatible Airtable)
// API_TOKEN = jeton PUBLIC restreint : lecture VI/Aeronefs/Reservations et
// parcours d'invitation uniquement. Apres connexion, headers.Authorization
// porte le jeton de session personnel (droits selon les roles du membre).
const API_TOKEN = '487b83e3d804b74ba432d76a5fe4fcb3a8fae00cd4714c0ec2582403b3b55efb';
const AIRTABLE_PAT = API_TOKEN;
const API_BASE = 'https://vps-1a4fbee9.vps.ovh.net/v0/glide2000';
const AUTH_BASE = API_BASE.slice(0, API_BASE.lastIndexOf('/')) + '/auth';
const TABLE_NOTIFICATIONS = 'Notifications';
const headers = { 
    Authorization: `Bearer ${AIRTABLE_PAT}`,
    'Content-Type': 'application/json'
};

// Requetes retenues jusqu'a la decision d'authentification (showApp/showLogin
// appellent authPrete — voir attendreAuthPret dans utils.js). Securite :
// ne jamais bloquer indefiniment.
window._authPret = false;
setTimeout(() => { if (typeof authPrete === 'function') authPrete(); }, 30000);

// Bascule l'app sur le jeton de session personnel (ou retour au jeton public).
function definirTokenSession(token) {
    headers.Authorization = token ? `Bearer ${token}` : `Bearer ${API_TOKEN}`;
    if (token) localStorage.setItem('acesSession', token);
    else localStorage.removeItem('acesSession');
    if (typeof viderApiCache === 'function') viderApiCache();
}

// ==========================================================================
// JOURNAL DES ERREURS JS -> serveur (table erreurs_client, vue dans l'audit)
// ==========================================================================
const erreursVues = new Set();
let erreursEnvoyees = 0;

function journaliserErreur(detail) {
    try {
        if (erreursEnvoyees >= 10) return;
        const cle = `${detail.message}|${detail.source}`;
        if (erreursVues.has(cle)) return;
        erreursVues.add(cle);
        erreursEnvoyees++;
        fetch(`${API_BASE}/log-erreur`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': headers.Authorization },
            body: JSON.stringify(detail),
            keepalive: true
        }).catch(() => {});
    } catch (e) { /* le journal ne doit jamais casser l'app */ }
}

window.addEventListener('error', (e) => {
    if (!e.message || e.message === 'Script error.') return;
    // Ignore les scripts tiers (CDN emailjs...) : pas notre code.
    if (e.filename && !e.filename.includes(location.host)) return;
    journaliserErreur({
        message: String(e.message).slice(0, 500),
        source: `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`.slice(0, 300),
        pile: ((e.error && e.error.stack) || '').slice(0, 4000),
        url: location.pathname.slice(0, 300)
    });
});

window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const msg = r instanceof Error ? r.message : String(r);
    if (!msg || /AbortError/i.test(msg)) return;
    journaliserErreur({
        message: msg.slice(0, 500),
        source: 'promesse non interceptée',
        pile: ((r && r.stack) || '').slice(0, 4000),
        url: location.pathname.slice(0, 300)
    });
});

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
    // Boutons precedente/suivante du navigateur : revenir a la vue
    // Glide 2000 enregistree dans l'historique (pushState dans activerTab).
    window.addEventListener('popstate', (e) => {
        let tabId = e.state && e.state.tabId;
        if (!tabId && location.hash.length > 1) {
            const h = location.hash.slice(1).replace(/^view-/, '');
            tabId = 'tab-' + (h === 'accueil-pilote' ? 'accueil' : h);
        }
        const t = tabId ? document.getElementById(tabId) : null;
        if (t) { window._navRetourHistorique = true; t.click(); }
    });
    // Lien profond : #view-xxx (ou #xxx) ouvre directement la vue.
    if (location.hash.length > 1) {
        const h = location.hash.slice(1).replace(/^view-/, '');
        const tabId = 'tab-' + (h === 'accueil-pilote' ? 'accueil' : h);
        const t = document.getElementById(tabId);
        if (t) {
            window._navRetourHistorique = true;
            t.click();
            try { history.replaceState({ tabId }, '', location.hash); } catch (e) {}
        }
    }
    initGestionCreneauxVI();
    initCarnetRoute();
    initSidebarToggle();
    initSidebarResize();
    initEvenements();
    if (typeof initFormation === 'function') initFormation();
    initComptesPilotes();
    initNotifications();
    adapterTableauxPetitEcran();
});

// Lance une seule fois, depuis showApp() — apres la restauration du jeton de
// session. Au DOMContentLoaded, headers porte encore le jeton public restreint
// VI : toute lecture d'une table non publique (Evenements, Presences...)
// renverrait 403.
let chargementInitialFait = false;
function chargerDonneesInitiales() {
    if (chargementInitialFait) return;
    chargementInitialFait = true;
    Promise.all([
        chargerDonneesPlanning(),
        chargerPresencesClub()
    ]).catch(err => console.error('Erreur chargement initial:', err));
    if (typeof chargerProchainsEvenements === 'function') chargerProchainsEvenements();
    if (typeof chargerEvenementsJour === 'function') chargerEvenementsJour();
}

function initSidebarToggle() {
    const toggle = document.getElementById('sidebar-toggle');
    const layout = document.querySelector('.app-layout');
    if (!toggle || !layout) return;
    const estPetitEcran = () => window.matchMedia && window.matchMedia('(max-width: 1024px)').matches;
    const fermerSidebar = () => {
        layout.classList.add('sidebar-collapsed');
        toggle.textContent = '❯';
        toggle.title = 'Afficher le menu';
    };
    // Sur tablette la sidebar passe en superposition : repliee par defaut,
    // elle se referme au choix d'un menu ou a un tap sur le contenu.
    if (estPetitEcran()) fermerSidebar();
    toggle.addEventListener('click', () => {
        const collapsed = layout.classList.toggle('sidebar-collapsed');
        toggle.textContent = collapsed ? '❯' : '❮';
        toggle.title = collapsed ? 'Afficher le menu' : 'Masquer le menu';
    });
    const sidebar = layout.querySelector('.sidebar');
    const main = layout.querySelector('.main-content');
    if (main) main.addEventListener('click', () => { if (estPetitEcran()) fermerSidebar(); });
    if (sidebar) sidebar.addEventListener('click', (e) => {
        if (estPetitEcran() && e.target.closest('.nav-sub li, .nav-btn')) fermerSidebar();
    });
}

// Enveloppe les tableaux des vues dans un conteneur defilant horizontalement
// (inerte sur desktop ; .table-scroll n'agit que sous 1024px).
function adapterTableauxPetitEcran() {
    document.querySelectorAll('.view-section table').forEach(t => {
        if (t.parentElement && t.parentElement.classList.contains('table-scroll')) return;
        const wrap = document.createElement('div');
        wrap.className = 'table-scroll';
        t.parentNode.insertBefore(wrap, t);
        wrap.appendChild(t);
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
    const toutLu = document.getElementById('notifications-tout-lu');
    if (toutLu) toutLu.addEventListener('click', (e) => { e.stopPropagation(); marquerToutesNotificationsLues(); });
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
        // Tri côté client : Date puis createdTime en dernier recours
        // (les anciennes notifs n'ont pas d'heure dans Date).
        records.sort((a, b) => {
            const da = (a.fields || {})['Date'] || a.createdTime || '';
            const db = (b.fields || {})['Date'] || b.createdTime || '';
            if (da !== db) return da < db ? 1 : -1;
            const ca = a.createdTime || '';
            const cb = b.createdTime || '';
            return ca < cb ? 1 : (ca > cb ? -1 : 0);
        });
        afficherNotifications(records);
        const nonLues = records.filter(r => !(r.fields || {})['Lue']).length;
        if (count) {
            count.textContent = nonLues;
            count.style.display = nonLues > 0 ? 'inline' : 'none';
        }
        const toutLuBtn = document.getElementById('notifications-tout-lu');
        if (toutLuBtn) toutLuBtn.style.display = nonLues > 1 ? 'inline-block' : 'none';
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
        const dObj = f['Date'] ? new Date(f['Date']) : (r.createdTime ? new Date(r.createdTime) : null);
        const date = dObj
            ? `${dObj.toLocaleDateString('fr-FR')} ${dObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
            : '';
        const message = f['Message'] || '';
        const type = f['Type'] || 'info';
        const lue = f['Lue'];
        const cls = lue ? 'notification-lue' : 'notification-non-lue';
        const lignesMsg = message.split('\n').map(l => l.trim()).filter(Boolean);
        let corps;
        if (lignesMsg.length > 1) {
            const puces = lignesMsg.slice(1).map(l => `<li>${escHtml(l.replace(/^[•\-]\s*/, ''))}</li>`).join('');
            corps = `<p class="notification-message">${escHtml(lignesMsg[0])}</p><ul class="notification-list">${puces}</ul>`;
        } else {
            corps = `<p class="notification-message">${escHtml(message)}</p>`;
        }
        return `<div class="notification-item ${cls}" data-id="${escHtml(r.id)}">
            <div class="notification-meta"><span class="notification-type">${escHtml(type)}</span><span class="notification-date">${escHtml(date)}</span></div>
            ${corps}
        </div>`;
    }).join('');
    list.querySelectorAll('.notification-item').forEach(item => {
        item.addEventListener('click', () => {
            marquerNotificationLue(item.dataset.id);
            const rec = records.find(r => r.id === item.dataset.id);
            if (rec) naviguerDepuisNotification(rec.fields || {});
        });
    });
}

// Navigation depuis une notification : le champ "Lien" porte la cible
// au format "vue:parametre" (ex. "planning:2026-10-11", "aeronefs:", "messagerie:").
// Sans lien, on tente d'extraire une date du message pour aller au planning du jour.
function naviguerDepuisNotification(fields) {
    const lien = (fields['Lien'] || '').toString().trim();
    const message = (fields['Message'] || '').toString();
    const allerJourPlanning = (iso) => {
        const [y, m, j] = iso.split('-').map(Number);
        if (!y || !m || !j) return;
        dateAffichee = new Date(y, m - 1, j, 12, 0, 0);
        if (typeof mettreAJourDateAffichee === 'function') mettreAJourDateAffichee();
        if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning();
        if (typeof chargerPresencesPlaneur === 'function') chargerPresencesPlaneur();
        if (typeof chargerPresencesClub === 'function') chargerPresencesClub();
        if (typeof chargerEvenementsJour === 'function') chargerEvenementsJour();
        if (typeof rafraichirMiniCalendrier === 'function') rafraichirMiniCalendrier();
        const t = document.getElementById('tab-planning');
        if (t) t.click();
    };
    const allerVue = (tabId) => { const t = document.getElementById(tabId); if (t) t.click(); };

    if (lien) {
        const idx = lien.indexOf(':');
        const cible = idx >= 0 ? lien.slice(0, idx) : lien;
        const param = idx >= 0 ? lien.slice(idx + 1) : '';
        if (cible === 'planning') { if (param) allerJourPlanning(param); else allerVue('tab-planning'); return; }
        const vues = {
            'aeronefs': 'tab-aeronefs',
            'initiation': 'tab-initiation',
            'instructeur': 'tab-instructeur',
            'carnet': 'tab-carnet',
            'carnet-vol': 'tab-carnet-vol',
            'documents': 'tab-documents',
            'comptes': 'tab-comptes',
            'membres': 'tab-membres',
            'messagerie': 'tab-messagerie',
            'audit': 'tab-audit',
            'formation': 'tab-formation',
            'accueil': 'tab-accueil'
        };
        if (vues[cible]) allerVue(vues[cible]);
        return;
    }
    const mDate = message.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\b/);
    if (mDate) allerJourPlanning(`${mDate[3]}-${mDate[2].padStart(2, '0')}-${mDate[1].padStart(2, '0')}`);
}

// Marque toutes les notifications non lues du pilote courant, y compris
// celles au-dela des 20 affichees dans le panneau.
async function marquerToutesNotificationsLues() {
    const piloteNom = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    if (!piloteNom) return;
    const btn = document.getElementById('notifications-tout-lu');
    if (btn) btn.disabled = true;
    try {
        const formula = `AND({Pilote}='${piloteNom.replace(/'/g, "\\'")}', {Lue}=FALSE())`;
        const url = `${API_BASE}/${encodeURIComponent(TABLE_NOTIFICATIONS)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
        const nonLues = await fetchTousRecords(url, { headers });
        for (let i = 0; i < nonLues.length; i += 10) {
            const batch = nonLues.slice(i, i + 10).map(r => ({ id: r.id, fields: { Lue: true } }));
            await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_NOTIFICATIONS)}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ records: batch })
            });
        }
        await chargerNotifications();
    } catch (err) {
        console.error(err);
    } finally {
        if (btn) btn.disabled = false;
    }
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
                'Date': new Date().toISOString(),
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
   FERMETURE DES MODALES PAR CROIX
   Toute croix [class*="close-modal"] ou .modal-close-x ferme la .modal qui la
   contient — filet de securite pour les croix sans handler dedie. Une croix
   est injectee automatiquement dans les modales qui n'en ont pas.
   ========================================================================== */
document.addEventListener('click', (e) => {
    const croix = e.target.closest('.modal-close-x, [class*="close-modal"]');
    if (!croix) return;
    const modale = croix.closest('.modal');
    if (modale) modale.style.display = 'none';
});

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal .modal-content').forEach(content => {
        if (content.querySelector('[class*="close"]')) return;
        const croix = document.createElement('button');
        croix.type = 'button';
        croix.className = 'modal-close-x';
        croix.innerHTML = '&times;';
        croix.title = 'Fermer';
        content.prepend(croix);
    });
});

// Echap ferme la modale la plus haute (z-index max, puis derniere dans le DOM).
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const visibles = [...document.querySelectorAll('.modal')].filter(m => {
        const s = m.style.display;
        if (s === 'flex' || s === 'block') return true;
        if (s === 'none' || s === '') return false;
        return getComputedStyle(m).display !== 'none';
    });
    if (!visibles.length) return;
    const haut = visibles.reduce((a, b) => {
        const za = parseInt(getComputedStyle(a).zIndex) || 0;
        const zb = parseInt(getComputedStyle(b).zIndex) || 0;
        return zb >= za ? b : a;
    });
    const croix = haut.querySelector('.modal-close-x, [class*="close-modal"]');
    if (croix) croix.click();
    else haut.style.display = 'none';
});

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
    'view-carnet-vol': () => typeof chargerCarnetVol === 'function' && chargerCarnetVol(),
    'view-membres': () => typeof chargerUtilisateurs === 'function' && chargerUtilisateurs(),
    'view-documents': () => typeof chargerDocuments === 'function' && chargerDocuments(),
    'view-accueil-membre': () => typeof chargerAccueilMembre === 'function' && chargerAccueilMembre(
        (typeof membreSelectionne !== 'undefined' && membreSelectionne) ? membreSelectionne.id : (currentUser ? currentUser.id : null)),
    'view-comptes': () => typeof chargerComptesPilotes === 'function' && chargerComptesPilotes(),
    'view-audit': () => typeof chargerAudit === 'function' && chargerAudit(true),
    'view-messagerie': () => typeof chargerMessagerie === 'function' && chargerMessagerie(),
    'view-formation': () => typeof chargerFormation === 'function' && chargerFormation()
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
    // Seules les vues temps reel meritent un re-rendu periodique (resas qui
    // changent sous les yeux). Ailleurs on rafraichit juste les donnees en
    // cache : la page ne bouge JAMAIS — la vue se mettra a jour a la
    // prochaine navigation ou action de l'utilisateur.
    const VUES_TEMPS_REEL = new Set(['view-planning', 'view-initiation']);
    if (!VUES_TEMPS_REEL.has(vue.id)) return;
    const htmlAvant = vue.innerHTML;
    const snapshot = creerSnapshotVue(vue);
    // Positions de scroll a conserver : ancetres (persistants, par reference)
    // + elements internes (recrees, retrouves par cle tag#id.classe + rang).
    const ancetresScroll = [];
    for (let anc = vue.parentElement; anc; anc = anc.parentElement) {
        if (anc.scrollTop || anc.scrollLeft) ancetresScroll.push({ el: anc, top: anc.scrollTop, left: anc.scrollLeft });
    }
    const clesScroll = new Map();
    const cleEl = el => `${el.tagName}#${el.id || ''}.${typeof el.className === 'string' ? el.className : ''}`;
    const compteurs = {};
    vue.querySelectorAll('*').forEach(el => {
        if (!(el.scrollTop || el.scrollLeft)) return;
        const base = cleEl(el);
        const n = compteurs[base] = (compteurs[base] || 0) + 1;
        clesScroll.set(`${base}|${n}`, { top: el.scrollTop, left: el.scrollLeft });
    });
    const scrollWin = { x: window.scrollX, y: window.scrollY };
    const restaurerScroll = () => {
        window.scrollTo(scrollWin.x, scrollWin.y);
        ancetresScroll.forEach(p => {
            if (p.el.isConnected) { p.el.scrollTop = p.top; p.el.scrollLeft = p.left; }
        });
        // La section a pu etre recreee : on re-cible la vue actuellement visible.
        const vueCourante = vue.isConnected
            ? vue
            : [...document.querySelectorAll('.view-section')].find(v => v.style.display !== 'none') || vue;
        const cpts = {};
        vueCourante.querySelectorAll('*').forEach(el => {
            const base = cleEl(el);
            const n = cpts[base] = (cpts[base] || 0) + 1;
            const p = clesScroll.get(`${base}|${n}`);
            if (p) { el.scrollTop = p.top; el.scrollLeft = p.left; }
        });
    };
    let retire = false;
    const retirer = (immediat = false) => {
        if (retire) return;
        retire = true;
        if (immediat) { snapshot.remove(); return; }
        setTimeout(() => snapshot.remove(), 400);
    };
    Promise.resolve().then(fn).then(() => {
        restaurerScroll();
        // 2e passe apres le paint : rattrape un re-rendu tardif ou un reset de scroll.
        requestAnimationFrame(() => setTimeout(restaurerScroll, 120));
        // Contenu identique (cas le plus courant) : rien n'a change —
        // on retire le cache tout de suite pour ne pas figer la page.
        const vueCourante = vue.isConnected
            ? vue
            : [...document.querySelectorAll('.view-section')].find(v => v.style.display !== 'none') || vue;
        retirer(vueCourante.innerHTML === htmlAvant);
    }).catch(e => { console.warn('Actualisation auto:', e); retirer(); });
    // Filet de securite : ne jamais laisser le masque plus de 10 s
    setTimeout(retirer, 10000);
}

// Pas de refresh periodique : chaque onglet recharge ses donnees au clic,
// donc l'actualisation est masquee par la transition entre les vues.
// Au retour sur l'onglet du navigateur, seul le planning se re-rend —
// les autres vues ne recoivent qu'une invalidation de cache silencieuse.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - dernierRefreshAuto > REFRESH_AUTO_MIN_ECART_MS) rafraichirVueCourante();
});

// Un clic qui ne fait que SE TERMINER sur le fond d'une modale — par ex. une
// selection de texte commencee dans la modale et relachee dehors — ne doit
// pas la fermer. La fermeture par clic exterieur reste active quand la
// pression a bien commence sur le fond.
let modalDownTarget = null;
document.addEventListener('mousedown', e => { modalDownTarget = e.target; }, true);
document.addEventListener('click', e => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('modal') && modalDownTarget && modalDownTarget !== t) {
        e.stopImmediatePropagation();
        e.preventDefault();
    }
    modalDownTarget = null;
}, true);
// Un clic qui DEBUTE et se TERMINE sur le fond d'une modale la ferme, comme
// la croix. Le handler capture ci-dessus a deja neutralise les clics qui
// terminent une selection de texte commencee dans la modale. Les modales
// ayant leur propre fermeture au clic exterieur sont deja masquees quand ce
// handler s'execute : le check display === 'none' evite tout double effet.
document.addEventListener('click', e => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('modal')) return;
    if (getComputedStyle(t).display === 'none') return;
    t.style.display = 'none';
});
