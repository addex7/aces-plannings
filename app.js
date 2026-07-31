/* ==========================================================================
   APPLICATION DE GESTION AÉROCLUB - POINT D'ENTRÉE PRINCIPAL
   ========================================================================== */

// Configuration API Airtable (globale pour tous les modules)
const AIRTABLE_PAT = 'patbX51fRBLO4v35h.e116a6e20d699408c3a49d07137099bbaf3fe23e734767dea63fa5d890508fff';
const BASE_ID = 'appufjvD3gYG6H44n';
const headers = { 
    Authorization: `Bearer ${AIRTABLE_PAT}`,
    'Content-Type': 'application/json'
};

// Variables globales partagées entre tous les modules
let dateAffichee = new Date('2026-07-14T12:00:00');
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
    chargerDonneesPlanning();
    chargerPresencesClub();
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
