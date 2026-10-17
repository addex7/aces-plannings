/* ==========================================================================
   FORMATION - SUIVI PEDAGOGIQUE ELEVE / INSTRUCTEUR
   Catalogue de formations (lecons + items), suivi par eleve (progression,
   minimas, documentation demandee), seances de vol debriefees et signees.
   ========================================================================== */

const TABLE_FORMATIONS = 'Formations';
const TABLE_FORMATIONS_SUIVIS = 'Formations Suivis';
const TABLE_FORMATIONS_SEANCES = 'Formations Séances';
const TABLE_CARNET_PILOTES = 'Carnet de route Pilotes';
const ROLES_FORMATION = ['Super admin', 'Instructeur avion', 'Instructeur ULM'];
const STATUTS_SUIVI = { OUVERTE: 'Ouverte', TERMINEE: 'Terminée', ARCHIVEE: 'Archivée' };

let formationsCache = [];
let suivisCache = null;
let seancesCache = null;
let suiviOuvertId = null;
let eleveAFormation = null; // null = inconnu
let membresFormationCache = [];
let recherchePilote = '';
let statsRenderSeq = 0;

// Heures decimales (centiemes) -> affichage h:mm (ex. 0.6 -> "0h36").
function hdvVersHmin(v) {
    const n = parseFloat(v) || 0;
    const h = Math.floor(n);
    const m = Math.round((n - h) * 60);
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h00`;
}

function formationJson(v, def) {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return def; }
}
function formationEncodeNom(nom) { return String(nom || '').replace(/'/g, "\\'"); }
function estInstructeurFormation() {
    return typeof roleAutorise === 'function' && roleAutorise(ROLES_FORMATION);
}
function idLecons(lecons) { return (lecons || []).map(l => String(l.id)); }

// ---------------------------------------------------------------------------
// ACCES : onglet visible pour instructeurs/admin, et pour tout eleve ayant
// (ou ayant eu) un suivi. Les suivis d'un eleve sont filtres cote serveur.
// ---------------------------------------------------------------------------
async function mettreAJourAccesFormation() {
    const tab = document.getElementById('tab-formation');
    if (!tab) return;
    if (!currentUser) { tab.style.display = 'none'; eleveAFormation = null; return; }
    if (estInstructeurFormation()) { eleveAFormation = true; tab.style.display = 'block'; return; }
    try {
        const suivis = await chargerSuivis();
        eleveAFormation = suivis.length > 0;
        tab.style.display = eleveAFormation ? 'block' : 'none';
    } catch (e) { tab.style.display = 'none'; }
}

// ---------------------------------------------------------------------------
// CHARGEMENT
// ---------------------------------------------------------------------------
async function chargerSuivis(force = false) {
    if (suivisCache && !force) return suivisCache;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SUIVIS)}?sort[0][field]=${encodeURIComponent('Date début')}&sort[0][direction]=desc&pageSize=100`;
    suivisCache = await fetchTousRecordsCache(url, { headers }, API_CACHE_TTL, force);
    return suivisCache;
}
async function chargerToutesSeances(force = false) {
    if (seancesCache && !force) return seancesCache;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}?sort[0][field]=Date&sort[0][direction]=asc&pageSize=100`;
    seancesCache = await fetchTousRecordsCache(url, { headers }, API_CACHE_TTL, force);
    return seancesCache;
}
async function chargerFormationsCatalogue(force = false) {
    if (formationsCache.length && !force) return formationsCache;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS)}?pageSize=100`;
    formationsCache = await fetchTousRecordsCache(url, { headers }, API_CACHE_TTL, force);
    return formationsCache;
}
// Vide les deux niveaux de cache : variables du module ET cache HTTP partage
// (apiFetch n'invalide pas le cache — contrairement a cachedFetch sur non-GET).
function invaliderFormationCache() {
    suivisCache = null;
    seancesCache = null;
    if (typeof viderApiCache === 'function') viderApiCache();
}

async function chargerVolsEleve(nomEleve) {
    const formula = encodeURIComponent(`{Pilote}='${formationEncodeNom(nomEleve)}'`);
    const url = `${API_BASE}/${encodeURIComponent(TABLE_CARNET_PILOTES)}?filterByFormula=${formula}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;
    return fetchTousRecordsCache(url, { headers });
}

// ---------------------------------------------------------------------------
// PROGRESSION
// ---------------------------------------------------------------------------
function seancesDuSuivi(suiviId) {
    return (seancesCache || [])
        .filter(s => String(s.fields['Suivi']) === String(suiviId))
        .sort((a, b) => String(a.fields['Date'] || '').localeCompare(String(b.fields['Date'] || '')) || String(a.id).localeCompare(String(b.id)));
}
// Dernier etat connu de chaque item : 'acquis' | 'encours' | 'arefaire'.
// Compat : anciens champs 'Items validés' -> acquis, 'Items reportés' -> arefaire.
const ETATS_ITEM = { acquis: '✅', encours: '🟡', arefaire: '🔄' };
function etatsItemsSuivi(suiviId) {
    const etats = new Map();
    seancesDuSuivi(suiviId).forEach(s => {
        formationJson(s.fields['Items reportés'], []).forEach(x => etats.set(`${x.lecon}:${x.item}`, 'arefaire'));
        formationJson(s.fields['Items validés'], []).forEach(x => etats.set(`${x.lecon}:${x.item}`, 'acquis'));
        formationJson(s.fields['Items'], []).forEach(x => etats.set(`${x.lecon}:${x.item}`, x.etat));
    });
    return etats;
}
function itemsValidesSuivi(suiviId) {
    const etats = etatsItemsSuivi(suiviId);
    const ok = new Set();
    const leconsValidees = new Set();
    etats.forEach((v, k) => { if (v === 'acquis') ok.add(k); });
    seancesDuSuivi(suiviId).forEach(s => {
        if (s.fields['Leçon validée']) leconsValidees.add(String(s.fields['Leçon']));
    });
    return { ok, leconsValidees, etats };
}
// Items actuellement "a refaire" (dernier etat connu).
function itemsReportesEnAttente(suiviId) {
    const res = [];
    etatsItemsSuivi(suiviId).forEach((etat, cle) => {
        if (etat === 'arefaire') { const [lecon, item] = cle.split(':'); res.push({ lecon, item: parseInt(item, 10), etat }); }
    });
    return res;
}
function progressionSuivi(suivi) {
    const lecons = formationJson(suivi.fields['Lecons'], []);
    const { ok, leconsValidees, etats } = itemsValidesSuivi(suivi.id);
    let total = 0, faits = 0;
    lecons.forEach(l => {
        const items = l.items || [];
        items.forEach((_, i) => { total++; if (ok.has(`${l.id}:${i}`)) faits++; });
        // Une lecon est validee quand tous ses items sont acquis (auto)
        if (items.length && items.every((_, i) => ok.has(`${l.id}:${i}`))) leconsValidees.add(String(l.id));
    });
    return { total, faits, pct: total ? Math.round(faits * 100 / total) : 0, ok, leconsValidees, etats, lecons };
}
function couleurProgression(pct) {
    if (pct >= 100) return '#16a34a';
    if (pct >= 66) return '#22c55e';
    if (pct >= 33) return '#f59e0b';
    return '#dc2626';
}
function barreProgression(pct, hauteur = 14) {
    const c = couleurProgression(pct);
    return `<div class="formation-progress" style="height:${hauteur}px;">
        <div class="formation-progress-fill" style="width:${pct}%;background:${c};"></div>
        <span class="formation-progress-txt">${pct}%</span>
    </div>`;
}
function statutBadge(statut) {
    const m = { 'Ouverte': ['#dcfce7', '#166534'], 'Terminée': ['#dbeafe', '#1e40af'], 'Archivée': ['#f1f5f9', '#475569'] };
    const [bg, fg] = m[statut] || m['Ouverte'];
    return `<span class="formation-badge" style="background:${bg};color:${fg};">${escapeHtml(statut || 'Ouverte')}</span>`;
}
function libelleItem(suivi, x) {
    const lecon = formationJson(suivi.fields['Lecons'], []).find(l => String(l.id) === String(x.lecon));
    return lecon ? { leconTitre: lecon.titre, texte: (lecon.items || [])[x.item] || '?' } : { leconTitre: '?', texte: '?' };
}
// Boutons d'action dans l'en-tete de la page (a droite, comme les autres vues)
function majActionsEntete(html) {
    const zone = document.getElementById('formation-header-actions');
    if (!zone) return;
    zone.innerHTML = html || '';
    zone.style.display = html ? 'flex' : 'none';
}

// ---------------------------------------------------------------------------
// VUE PRINCIPALE
// ---------------------------------------------------------------------------
async function chargerFormation() {
    const zone = document.getElementById('formation-contenu');
    if (!zone || !currentUser) return;
    zone.innerHTML = '<div class="loading" style="padding:30px;text-align:center;color:#94a3b8;">Chargement…</div>';
    const instructeur = estInstructeurFormation();
    try {
        const [suivis] = await Promise.all([
            chargerSuivis(),
            chargerToutesSeances(),
            instructeur ? chargerFormationsCatalogue() : Promise.resolve([])
        ]);
        if (suiviOuvertId) { if (!enEditionSeance) renderDetailSuivi(); return; }
        majActionsEntete(instructeur ? `
            <input type="search" id="formation-recherche-pilote" class="formation-recherche" placeholder="🔍 Rechercher un pilote…" value="${escapeHtml(recherchePilote)}">
            <button class="btn-primary" data-formation-action="nouveau-suivi">Attribuer une formation</button>
            <button class="btn-primary" data-formation-action="gerer-catalogue">📚 Formations</button>` : '');
        zone.innerHTML = instructeur ? renderVueInstructeur(suivis) : renderVueEleve(suivis);
    } catch (e) {
        console.error(e);
        zone.innerHTML = '<div class="loading" style="padding:30px;text-align:center;color:#b91c1c;">Erreur de chargement.</div>';
    }
}

function renderVueInstructeur(suivis) {
    return `<div id="formation-liste-suivis">${renderListeSuivis(filtrerSuivis(suivis))}</div>`;
}

function filtrerSuivis(suivis) {
    const q = recherchePilote.trim().toLowerCase();
    if (!q) return suivis;
    return suivis.filter(s =>
        String(s.fields['Élève nom'] || '').toLowerCase().includes(q) ||
        String(s.fields['Formation titre'] || '').toLowerCase().includes(q));
}

function renderListeSuivis(suivis) {
    const ouverts = suivis.filter(s => (s.fields['Statut'] || 'Ouverte') === 'Ouverte');
    const termines = suivis.filter(s => s.fields['Statut'] === 'Terminée');
    const archives = suivis.filter(s => s.fields['Statut'] === 'Archivée');
    const carte = s => {
        const f = s.fields;
        const p = progressionSuivi(s);
        return `<div class="formation-carte" data-formation-action="ouvrir" data-sid="${s.id}">
            <div class="formation-carte-tete">
                <strong>${escapeHtml(f['Élève nom'] || 'Élève')}</strong>
                ${statutBadge(f['Statut'] || 'Ouverte')}
            </div>
            <div class="formation-carte-sub">${escapeHtml(f['Formation titre'] || '')} — depuis le ${escapeHtml(f['Date début'] || '?')}</div>
            ${barreProgression(p.pct)}
            <div class="formation-carte-sub">${p.faits}/${p.total} items</div>
        </div>`;
    };
    if (!suivis.length) return `<div class="formation-vide">${recherchePilote.trim() ? 'Aucun résultat pour cette recherche.' : 'Aucune formation en cours — attribuez-en une.'}</div>`;
    return `
        <h3 class="formation-section-titre">Formations en cours (${ouverts.length})</h3>
        <div class="formation-grille">${ouverts.map(carte).join('') || '<div class="formation-vide">Aucune formation en cours correspondante.</div>'}</div>
        ${termines.length ? `<h3 class="formation-section-titre">Terminées</h3><div class="formation-grille">${termines.map(carte).join('')}</div>` : ''}
        ${archives.length ? `<h3 class="formation-section-titre">Archivées</h3><div class="formation-grille">${archives.map(carte).join('')}</div>` : ''}
    `;
}

function renderVueEleve(suivis) {
    if (!suivis.length) return '<div class="formation-vide">Aucune formation ne vous a été attribuée pour le moment.</div>';
    const actives = suivis.filter(s => (s.fields['Statut'] || 'Ouverte') === 'Ouverte');
    const anciennes = suivis.filter(s => (s.fields['Statut'] || 'Ouverte') !== 'Ouverte');
    const carteResume = s => {
        const f = s.fields;
        const p = progressionSuivi(s);
        return `<div class="formation-carte" data-formation-action="ouvrir" data-sid="${s.id}">
            <div class="formation-carte-tete"><strong>${escapeHtml(f['Formation titre'] || 'Formation')}</strong>${statutBadge(f['Statut'])}</div>
            <div class="formation-carte-sub">Instructeur : ${escapeHtml(f['Instructeur'] || '—')}</div>
            ${barreProgression(p.pct)}
        </div>`;
    };
    return `
        ${actives.map(carteResume).join('')}
        ${anciennes.length ? `<h3 class="formation-section-titre">Formations passées</h3><div class="formation-grille">${anciennes.map(carteResume).join('')}</div>` : ''}
    `;
}

// ---------------------------------------------------------------------------
// DETAIL D'UN SUIVI
// ---------------------------------------------------------------------------
function ouvrirSuivi(suiviId) {
    suiviOuvertId = suiviId;
    enEditionSeance = false;
    renderDetailSuivi();
}

async function renderDetailSuivi() {
    const zone = document.getElementById('formation-contenu');
    if (!zone) return;
    // Apres une ecriture, suivisCache et seancesCache ont ete invalides
    // (null) : les recharger sinon le detail retombe sur la liste et
    // les compteurs passent a zero.
    await Promise.all([chargerSuivis(), chargerToutesSeances()]);
    const suivi = (suivisCache || []).find(s => s.id === suiviOuvertId);
    if (!suivi) { suiviOuvertId = null; chargerFormation(); return; }
    const f = suivi.fields;
    const instructeur = estInstructeurFormation();
    const p = progressionSuivi(suivi);
    const statut = f['Statut'] || 'Ouverte';
    // Formation terminee ou archivee : figee, consultation uniquement.
    const gele = statut !== 'Ouverte';
    const minimas = formationJson(f['Minimas'], {});
    const docs = formationJson(f['Documentation'], []);

    // Comptage des vols depuis le debut de la formation (asynchrone, non bloquant)
    const statsVolsId = `formation-stats-${suivi.id}`;

    const boutonsInstructeur = instructeur ? `
        ${!gele ? `<button class="btn-primary" data-formation-action="seance" data-sid="${suivi.id}">✈️ Nouvelle séance</button>
        <button class="btn-primary" id="btn-terminer-suivi" disabled title="Vérification des prérequis…" data-formation-action="terminer" data-sid="${suivi.id}">🏁 Terminer</button>` : ''}
        ${statut !== 'Archivée' ? `<button class="btn-primary" data-formation-action="archiver" data-sid="${suivi.id}">🗄 Archiver</button>` : `<button class="btn-primary" data-formation-action="rouvrir" data-sid="${suivi.id}">↩️ Désarchiver</button>`}
        ${!gele ? `<button class="btn-primary" data-formation-action="suppr-suivi" data-sid="${suivi.id}">🗑 Supprimer</button>` : ''}` : '';
    majActionsEntete(`
        <button class="btn-primary" data-formation-action="retour">← Retour</button>
        <button class="btn-primary" data-formation-action="fiche" data-sid="${suivi.id}">👤 Fiche élève</button>
        ${boutonsInstructeur}`);

    // Regroupement des lecons par phase (groupe), comme le livret BLN.
    let dernierGroupe = '';
    const leconsHtml = p.lecons.map((l, idx) => {
        const g = l.groupe || '';
        const entete = g !== dernierGroupe && g ? `<h5 class="formation-phase-titre">${escapeHtml(g)}</h5>` : '';
        dernierGroupe = g;
        return entete + renderLecon(suivi, l, idx, p, instructeur);
    }).join('');

    // Modules theoriques du suivi (valides un par un avec date).
    const modules = formationJson(f['Modules'], []);
    const modulesHtml = modules.length ? `
        <div class="formation-docs">${modules.map(mo => {

            const fait = !!mo.statut;
            const zone = (instructeur && !fait && !gele) ? `
                <input type="date" id="module-date-${escapeHtml(mo.id)}" value="${new Date().toISOString().slice(0, 10)}" title="Date de validation" class="module-date-input">
                <button class="btn-primary" style="padding:4px 10px;font-size:12px;" data-formation-action="module-valide" data-sid="${suivi.id}" data-mid="${escapeHtml(mo.id)}">Valider</button>` : '';
            return `<div class="formation-doc module-ligne">
                <span class="module-titre">${fait ? '✅' : '⬜'} ${escapeHtml(mo.titre)}</span>
                <span class="module-actions">${fait ? `<span class="formation-carte-sub" style="white-space:nowrap;">validé le ${escapeHtml(mo.date || '')}</span>` : ''}${zone}</span></div>`;
        }).join('')}</div>` : '<div class="formation-vide">Aucun module.</div>';
    const ressources = formationJson(f['Ressources'], []);
    const ressourcesHtml = ressources.length ? `
        <h5 class="formation-phase-titre">📚 Documentation de la formation</h5>
        <div class="formation-docs">${ressources.map(r => {
            const lien = urlSure(r.lien || '');
            return `<div class="formation-doc">${lien
                ? `<a href="${lien}" target="_blank" rel="noopener">🔗 ${escapeHtml(r.titre || r.lien)}</a>`
                : `<span>🔗 ${escapeHtml(r.titre || '')}</span>`}</div>`;
        }).join('')}</div>` : '';
    const docsHtml = docs.length
        ? `<div class="formation-docs">${docs.map(d => renderDoc(suivi, d, instructeur, gele)).join('')}</div>`
        : '<div class="formation-vide">Aucun document demandé.</div>';

    // Colonnes : theorique | documents | minimas (progression auto sur les seances)
    const trioHtml = `
        <div class="formation-trio">
            <div class="formation-col">
                <h4 class="formation-col-titre">📖 Formation théorique</h4>
                ${modulesHtml}
            </div>
            <div class="formation-col">
                <h4 class="formation-col-titre" style="display:flex;align-items:center;justify-content:space-between;">📋 Documents demandés
                    ${instructeur && !gele ? `<button class="btn-secondary" style="padding:2px 8px;font-size:11px;" title="Demander un document supplémentaire" data-formation-action="doc-add" data-sid="${suivi.id}">＋</button>` : ''}
                </h4>
                ${docsHtml}
            </div>
            <div class="formation-col">
                <h4 class="formation-col-titre">⏱ Minimas requis</h4>
                <div id="${statsVolsId}" class="formation-minimas">Comptage des vols…</div>
                ${instructeur && !gele ? `<button class="btn-secondary" style="margin-top:8px;padding:4px 8px;font-size:11px;" data-formation-action="credit-add" data-sid="${suivi.id}">＋ Ajouter un vol / des heures</button>` : ''}
                ${ressourcesHtml}
            </div>
        </div>`;

    zone.innerHTML = `
        <div class="formation-entete">
            <div>
                <h3 style="margin:0;">${escapeHtml(f['Formation titre'] || 'Formation')} ${statutBadge(statut)}</h3>
                <div class="formation-carte-sub">
                    Élève : <strong>${escapeHtml(f['Élève nom'] || '—')}</strong> ·
                    Instructeur : ${escapeHtml(f['Instructeur'] || '—')} ·
                    depuis le ${escapeHtml(f['Date début'] || '?')}
                    ${f['Date fin'] ? ` → ${escapeHtml(f['Date fin'])}` : ''}
                </div>
            </div>
            <div style="min-width:220px;">${barreProgression(p.pct, 20)}<div class="formation-carte-sub" style="text-align:right;">${p.faits}/${p.total} items validés</div></div>
        </div>
        ${trioHtml}
        <div class="formation-duo">
            <div>
                <h4 class="formation-sub-titre">📚 Formation pratique</h4>
                ${leconsHtml || '<div class="formation-vide">Aucune leçon définie.</div>'}
            </div>
            <div>
                <h4 class="formation-sub-titre">✈️ Journal des séances</h4>
                ${seancesDuSuivi(suivi.id).map(s => renderSeance(s, instructeur, gele)).join('') || '<div class="formation-vide">Aucune séance enregistrée.</div>'}
            </div>
        </div>
    `;

    // Statistiques vols vs minimas + verrouillage du bouton Terminer.
    // Si un autre render a eu lieu entre-temps, on ignore cette reponse
    // (elle repose sur un suivi potentiellement perime).
    const seq = ++statsRenderSeq;
    calculerStatsSuivi(suivi).then(stats => {
        if (seq !== statsRenderSeq) return;
        const el = document.getElementById(statsVolsId);
        if (el) el.innerHTML = renderMinimasHtml(stats, minimas, suivi, instructeur && !gele);
        const btn = document.getElementById('btn-terminer-suivi');
        if (btn) {
            const manques = manquesTerminaison(suivi, minimas, p, stats);
            btn.disabled = manques.length > 0;
            btn.title = manques.length
                ? `Prérequis restants :\n• ${manques.join('\n• ')}`
                : 'Tous les prérequis sont validés';
        }
    });
}

// Compteurs du suivi : HDV par type + atterrissages depuis les seances,
// total heures/vols depuis les seances + le carnet de l'eleve depuis la
// date de debut (un vol lie a une seance n'est compte qu'une fois).
async function calculerStatsSuivi(suivi) {
    const seances = seancesDuSuivi(suivi.id);
    let dc = 0, solo = 0, simu = 0, att = 0;
    seances.forEach(s => {
        dc += parseFloat(s.fields['HDV DC']) || 0;
        solo += parseFloat(s.fields['HDV solo']) || 0;
        simu += parseFloat(s.fields['HDV simu']) || 0;
        att += parseInt(s.fields['Atterrissages'], 10) || 0;
    });
    let nbVols = 0, heures = 0;
    const volsComptesIds = new Set();
    const nomEleve = suivi.fields['Élève nom'] || '';
    if (nomEleve) {
        try {
            const vols = await chargerVolsEleve(nomEleve);
            const debut = suivi.fields['Date début'] || '1900-01-01';
            const deduis = vols.filter(v => String(v.fields['Date'] || '') >= String(debut));
            nbVols = deduis.length;
            deduis.forEach(v => {
                volsComptesIds.add(String(v.id));
                heures += (typeof dureeVolMinutes === 'function' ? dureeVolMinutes(v.fields) : 0) / 60;
            });
        } catch (e) { console.error('Stats suivi:', e); }
    }
    // Les heures saisies dans les seances comptent dans le total — sauf
    // quand le vol lie est deja deduit du carnet (pas de double compte).
    seances.forEach(s => {
        const vid = String(s.fields['Vol'] || '');
        const h = (parseFloat(s.fields['HDV DC']) || 0) + (parseFloat(s.fields['HDV solo']) || 0) + (parseFloat(s.fields['HDV simu']) || 0);
        const natt = parseInt(s.fields['Atterrissages'], 10) || 0;
        if (vid && volsComptesIds.has(vid)) return;
        heures += h;
        if (!vid && (s.fields['Type'] || 'Vol') === 'Vol' && (h > 0 || natt > 0)) nbVols++;
    });
    // Credits manuels : heures/vols saisis a la main (vols hors carnet,
    // experience anterieure) — comptent dans les minimas.
    const credits = formationJson(suivi.fields['Crédits'], []);
    credits.forEach(c => {
        dc += parseFloat(c.dc) || 0;
        solo += parseFloat(c.solo) || 0;
        simu += parseFloat(c.simu) || 0;
        att += parseInt(c.att, 10) || 0;
        nbVols += parseInt(c.vols, 10) || 0;
        heures += parseFloat(c.heures) || 0;
    });
    return { dc, solo, simu, att, nbVols, heures, credits };
}

// Panneau des minimas : chaque exigence avec sa barre de progression,
// suivi des credits manuels (supprimables par l'instructeur).
function renderMinimasHtml(stats, minimas, suivi, instructeur) {
    const hTxt = v => { const h = Math.floor(v), m = Math.round((v - h) * 60); return `${h}h${String(m).padStart(2, '0')}`; };
    const ligne = (label, val, req, enHeures) => {
        const vTxt = enHeures ? hTxt(val) : val;
        const rTxt = req ? (enHeures ? hTxt(req) : req) : null;
        const pct = req ? Math.min(100, Math.round(val * 100 / req)) : null;
        const c = pct === null ? '' : couleurProgression(pct);
        return `<div class="mini-ligne">
            <div class="mini-tete"><span>${label}</span><strong>${vTxt}${rTxt ? ` / ${rTxt}` : ''}</strong></div>
            ${pct !== null ? `<div class="mini-bar"><div class="mini-bar-fill" style="width:${pct}%;background:${c};"></div></div>` : ''}
        </div>`;
    };
    const lignes = [
        ligne('Heures totales', stats.heures, Number(minimas.heures || 0), true),
        ligne('Vols', stats.nbVols, Number(minimas.vols || 0), false),
        ligne('Double commande', stats.dc, Number(minimas.heuresDC || 0), true),
        ligne('Solo', stats.solo, Number(minimas.heuresSolo || 0), true),
        stats.simu ? ligne('Simulateur', stats.simu, 0, true) : '',
        (stats.att || minimas.atterrissages) ? ligne('Atterrissages', stats.att, Number(minimas.atterrissages || 0), false) : ''
    ].filter(Boolean);
    const aDesHdv = stats.dc || stats.solo || stats.simu || stats.att;
    const hT = v => { const h = Math.floor(v), m = Math.round((v - h) * 60); return `${h}h${String(m).padStart(2, '0')}`; };
    const creditsHtml = (stats.credits || []).map(c => {
        const parts = [
            parseFloat(c.heures) ? hT(c.heures) : '',
            parseInt(c.vols, 10) ? `${c.vols} vol(s)` : '',
            parseFloat(c.dc) ? `DC ${hT(c.dc)}` : '',
            parseFloat(c.solo) ? `solo ${hT(c.solo)}` : '',
            parseFloat(c.simu) ? `simu ${hT(c.simu)}` : '',
            parseInt(c.att, 10) ? `${c.att} att.` : ''
        ].filter(Boolean).join(' · ');
        const del = instructeur
            ? `<span style="display:flex;gap:4px;flex-shrink:0;">
                <button class="btn-secondary" style="padding:2px 7px;font-size:11px;" title="Modifier ce crédit" data-formation-action="credit-edit" data-sid="${suivi.id}" data-cid="${escapeHtml(c.id)}">✏️</button>
                <button class="btn-secondary" style="padding:2px 7px;font-size:11px;color:#b91c1c;" title="Supprimer ce crédit" data-formation-action="credit-del" data-sid="${suivi.id}" data-cid="${escapeHtml(c.id)}">✕</button>
            </span>`
            : '';
        return `<div class="formation-doc mini-credit"><span>✋ ${escapeHtml(c.libelle || 'Crédit manuel')}</span><span class="formation-carte-sub">${escapeHtml(parts)}</span>${del}</div>`;
    }).join('');
    return lignes.join('') +
        creditsHtml +
        (aDesHdv ? '' : '<div class="formation-carte-sub">DC/solo/simu comptés depuis les séances.</div>') +
        (minimas.cas ? `<div class="formation-carte-sub" style="margin-top:6px;">Cas appliqué : « ${escapeHtml(minimas.cas)} »</div>` : '');
}

// Ce qui manque encore avant de pouvoir terminer le suivi :
// items pratiques, modules theoriques, documents et minimas.
function manquesTerminaison(suivi, minimas, p, stats) {
    const manques = [];
    const f = suivi.fields;
    if (p.total && p.faits < p.total) manques.push(`${p.total - p.faits} item(s) pratique(s) non acquis`);
    const modules = formationJson(f['Modules'], []);
    const restM = modules.filter(m => !m.statut).length;
    if (restM) manques.push(`${restM} module(s) théorique(s) à valider`);
    const today = new Date().toISOString().slice(0, 10);
    const docs = formationJson(f['Documentation'], []);
    const restD = docs.filter(d => d.statut !== 'Fourni' || (d.dateValidite && d.dateValidite < today)).length;
    if (restD) manques.push(`${restD} document(s) manquant(s) ou expiré(s)`);
    const req = (cle) => Number(minimas[cle] || 0);
    if (req('heures') && stats.heures < req('heures')) manques.push(`heures totales insuffisantes`);
    if (req('vols') && stats.nbVols < req('vols')) manques.push(`vols insuffisants`);
    if (req('heuresDC') && stats.dc < req('heuresDC')) manques.push(`heures en double commande insuffisantes`);
    if (req('heuresSolo') && stats.solo < req('heuresSolo')) manques.push(`heures solo insuffisantes`);
    if (req('atterrissages') && stats.att < req('atterrissages')) manques.push(`atterrissages insuffisants`);
    return manques;
}

function renderDoc(suivi, d, instructeur, gele) {
    const fourni = d.statut === 'Fourni';
    const today = new Date().toISOString().slice(0, 10);
    const expire = fourni && d.dateValidite && d.dateValidite < today;
    const infos = fourni
        ? `fourni le ${escapeHtml(d.dateFourni || '')}` + (d.dateValidite
            ? ` · <span style="color:${expire ? '#b91c1c' : '#166534'};">${expire ? 'expiré' : 'valable'} jusqu'au ${escapeHtml(d.dateValidite)}</span>` : '')
        : '';
    // Depot possible par l'eleve ET l'instructeur (remise en main propre),
    // ou choix d'un document deja present dans l'espace membre.
    // Suivi gele : consultation uniquement.
    const depot = (!fourni && !gele) ? `
        <div class="formation-doc-depot">
            <input type="file" id="doc-fichier-${escapeHtml(d.id)}" accept=".pdf,.jpg,.jpeg,.png" title="Joindre le document">
            <input type="date" id="doc-validite-${escapeHtml(d.id)}" title="Date de validité (optionnel)">
            <button class="btn-primary" style="padding:4px 10px;font-size:12px;" data-formation-action="doc-fourni" data-sid="${suivi.id}" data-doc="${escapeHtml(d.id)}">Envoyer</button>
            <button class="btn-secondary" style="padding:4px 10px;font-size:12px;" data-formation-action="doc-pick-membre" data-sid="${suivi.id}" data-doc="${escapeHtml(d.id)}" title="Choisir un document déjà présent dans l'espace membre">📁 Espace membre</button>
        </div>` : '';
    const titre = d.lien
        ? `<a href="${urlSure(d.lien)}" target="_blank" rel="noopener" title="Ouvrir la pièce jointe">${escapeHtml(d.titre)}</a>`
        : escapeHtml(d.titre);
    const actions = (instructeur && !gele) ? `
        <span style="display:flex; gap:4px;">
            <button class="btn-secondary" style="padding:2px 7px;font-size:11px;" data-formation-action="doc-rename" data-sid="${suivi.id}" data-doc="${escapeHtml(d.id)}" title="Remplacer le document fourni par un autre">✏️</button>
            <button class="btn-secondary" style="padding:2px 7px;font-size:11px;" data-formation-action="doc-del" data-sid="${suivi.id}" data-doc="${escapeHtml(d.id)}" title="${fourni ? 'Retirer la pièce jointe (la demande reste en attente)' : 'Supprimer cette demande de document'}">✕</button>
        </span>` : '';
    return `<div class="formation-doc" style="flex-wrap:wrap;">
        <span>${fourni ? '✅' : (d.prerequis ? '📋' : '📄')} ${titre}</span>
        <span class="formation-carte-sub">${infos}</span>
        ${actions}
        ${depot}
    </div>`;
}

function renderLecon(suivi, lecon, idx, p, instructeur) {
    const items = lecon.items || [];
    const validee = p.leconsValidees.has(String(lecon.id));
    const itemsHtml = items.map((it, i) => {
        const cle = `${lecon.id}:${i}`;
        const etat = p.etats ? p.etats.get(cle) : null;
        const icone = ETATS_ITEM[etat] || '⬜';
        const cls = etat === 'acquis' ? 'formation-item-ok' : (etat === 'arefaire' ? 'formation-item-rep' : (etat === 'encours' ? 'formation-item-encours' : ''));
        return `<div class="formation-item ${cls}">${icone} ${escapeHtml(it)}</div>`;
    }).join('');
    return `
        <div class="formation-lecon ${validee ? 'formation-lecon-validee' : ''}">
            <div class="formation-lecon-tete">
                <strong>${validee ? '✅ ' : ''}Leçon ${idx + 1} — ${escapeHtml(lecon.titre || '')}</strong>
                ${lecon.objectif ? `<div class="formation-carte-sub">${escapeHtml(lecon.objectif)}</div>` : ''}
            </div>
            <div class="formation-items">${itemsHtml || '<div class="formation-carte-sub">Aucun item.</div>'}</div>
        </div>`;
}

function renderSeance(s, instructeur, gele) {
    const f = s.fields;
    const sigI = formationJson(f['Signature instructeur'], null);
    const sigE = formationJson(f['Signature élève'], null);
    const itemsNouveau = formationJson(f['Items'], []);
    const itemsOk = formationJson(f['Items validés'], []).length + itemsNouveau.filter(x => x.etat === 'acquis').length;
    const itemsEnCours = itemsNouveau.filter(x => x.etat === 'encours').length;
    const itemsRep = formationJson(f['Items reportés'], []).length + itemsNouveau.filter(x => x.etat === 'arefaire').length;
    const comptes = [`${itemsOk} acquis`, itemsEnCours ? `${itemsEnCours} en cours` : '', itemsRep ? `${itemsRep} à refaire` : ''].filter(Boolean).join(' · ');
    const vol = f['Vol libellé'] || '';
    // Date et immatriculation sont deja dans l'en-tete : on n'affiche
    // que le trajet (nouveau format "DEP→ARR", extraction pour l'ancien).
    const trajet = (vol.match(/\S+\s*→\s*\S+/) || [''])[0];
    const volAffiche = trajet || vol;
    // Numero de seance dans le suivi (ordre chronologique = "cours n°")
    const numero = seancesDuSuivi(f['Suivi']).findIndex(x => x.id === s.id) + 1;
    const iconesType = { 'Vol': '✈️', 'Simulateur': '🖥️', 'Théorique': '📖' };
    const typeSeance = f['Type'] || 'Vol';
    const hdv = [
        parseFloat(f['HDV DC']) ? `DC ${hdvVersHmin(f['HDV DC'])}` : '',
        parseFloat(f['HDV solo']) ? `Solo ${hdvVersHmin(f['HDV solo'])}` : '',
        parseFloat(f['HDV simu']) ? `Simu ${hdvVersHmin(f['HDV simu'])}` : '',
        parseInt(f['Atterrissages'], 10) ? `${f['Atterrissages']} att.` : ''
    ].filter(Boolean).join(' · ');
    const signer = (!gele && !instructeur && !sigE)
        ? `<button class="btn-primary" style="padding:4px 10px;font-size:12px;" data-formation-action="signer" data-sid="${s.id}">✍️ Signer</button>`
        : '';
    const outils = (instructeur && !gele) ? `
        <button class="btn-secondary" style="padding:2px 8px;font-size:12px;margin-left:auto;" title="Modifier la séance (signatures à refaire)" data-formation-action="seance-edit" data-sid="${escapeHtml(f['Suivi'])}" data-seid="${s.id}">✏️</button>
        <button class="btn-secondary" style="padding:2px 8px;font-size:12px;color:#b91c1c;" title="Supprimer la séance" data-formation-action="seance-del" data-seid="${s.id}">🗑</button>` : '';
    const sigs = `<div class="formation-signatures">
        ${sigI ? `<span class="sig-lien" data-formation-action="sig-voir" data-seid="${s.id}" data-qui="i" title="Voir la signature — ${escapeHtml(sigI.par)} le ${escapeHtml(sigI.date)}">✍️ Instructeur</span>` : '<span>⬜ Instructeur</span>'}
        ${sigE ? `<span class="sig-lien" data-formation-action="sig-voir" data-seid="${s.id}" data-qui="e" title="Voir la signature — ${escapeHtml(sigE.par)} le ${escapeHtml(sigE.date)}">✍️ Élève</span>` : '<span>⬜ Élève</span>'}
        ${signer}
    </div>`;
    return `
        <div class="formation-seance">
            <div class="formation-seance-tete">
                <strong>Séance n°${numero || '?'}</strong>
                <span class="formation-badge" style="background:#eff6ff;color:#1e40af;">${iconesType[typeSeance] || '✈️'} ${escapeHtml(typeSeance)}</span>
                <span class="formation-carte-sub">${escapeHtml(f['Date'] || '')}${f['Machine'] ? ` · ${escapeHtml(f['Machine'])}` : ''}</span>
                ${f['Leçon validée'] ? '<span class="formation-badge" style="background:#dcfce7;color:#166534;">Leçon validée</span>' : ''}
                ${outils}
            </div>
            ${volAffiche ? `<div class="formation-carte-sub">Vol : ${escapeHtml(volAffiche)}</div>` : ''}
            ${hdv ? `<div class="formation-carte-sub">⏱ ${escapeHtml(hdv)}</div>` : ''}
            ${f['Météo'] ? `<div class="formation-carte-sub">🌦 ${escapeHtml(f['Météo'])}</div>` : ''}
            ${comptes ? `<div class="formation-carte-sub">${escapeHtml(comptes)}</div>` : ''}
            ${f['Commentaire'] ? `<div class="formation-commentaire">${escapeHtml(f['Commentaire']).replace(/\n/g, '<br>')}</div>` : ''}
            ${sigs}
        </div>`;
}

// ---------------------------------------------------------------------------
// ACTIONS COMMUNES (delegation)
// ---------------------------------------------------------------------------
// Suivi gele : terminee ou archivee -> consultation uniquement.
function suiviFige(suivi) {
    return suivi && (suivi.fields['Statut'] || 'Ouverte') !== 'Ouverte';
}
// Actions interdites sur un suivi gele (modifications et suppressions).
const ACTIONS_FIGEES = new Set([
    'seance', 'item-etat', 'seance-save', 'seance-edit', 'seance-del',
    'doc-fourni', 'doc-add', 'doc-pick-membre', 'doc-rename', 'doc-del',
    'module-valide', 'credit-add', 'credit-edit', 'credit-del',
    'suppr-suivi', 'signer'
]);

document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-formation-action]');
    if (!el) return;
    const a = el.dataset.formationAction;
    const sid = el.dataset.sid;
    // Rien de modifiable sur un suivi gele : le suivi est retrouve par
    // son id ou via la seance concernee.
    if (ACTIONS_FIGEES.has(a)) {
        let sv = (suivisCache || []).find(x => x.id === sid);
        if (!sv) {
            const se = (seancesCache || []).find(x => x.id === sid || x.id === el.dataset.seid);
            const p2 = se && se.fields ? se.fields['Suivi'] : '';
            sv = (suivisCache || []).find(x => x.id === p2);
        }
        if (suiviFige(sv)) {
            alert('Cette formation est figée (terminée ou archivée) : consultation uniquement.');
            return;
        }
    }
    if (a === 'ouvrir') ouvrirSuivi(sid);
    else if (a === 'retour') {
        if (enEditionSeance) { enEditionSeance = false; renderDetailSuivi(); return; }
        suiviOuvertId = null;
        chargerFormation();
    }
    else if (a === 'nouveau-suivi') ouvrirModaleAttribuer();
    else if (a === 'gerer-catalogue') ouvrirGestionCatalogue();
    else if (a === 'seance') ouvrirPageSeance(sid);
    else if (a === 'item-etat') basculerEtatItem(el);
    else if (a === 'seance-save') enregistrerPageSeance();
    else if (a === 'seance-edit') ouvrirPageSeance(sid, el.dataset.seid);
    else if (a === 'seance-del') supprimerSeance(el.dataset.seid);
    else if (a === 'sig-voir') voirSignatureSeance(el.dataset.seid, el.dataset.qui);
    else if (a === 'doc-fourni') marquerDocumentFourni(sid, el.dataset.doc);
    else if (a === 'doc-add') ajouterDocumentDemande(sid);
    else if (a === 'doc-pick-membre') choisirDocumentMembre(sid, el.dataset.doc);
    else if (a === 'doc-rename') remplacerDocumentDemande(sid, el.dataset.doc);
    else if (a === 'doc-del') supprimerDocumentDemande(sid, el.dataset.doc);
    else if (a === 'credit-add') ouvrirModaleCredit(sid);
    else if (a === 'credit-edit') ouvrirModaleCredit(sid, el.dataset.cid);
    else if (a === 'credit-del') supprimerCredit(sid, el.dataset.cid);
    else if (a === 'module-valide') validerModule(sid, el.dataset.mid);
    else if (a === 'fiche') ouvrirFicheEleve(sid);
    else if (a === 'terminer') changerStatutSuivi(sid, 'Terminée');
    else if (a === 'archiver') changerStatutSuivi(sid, 'Archivée');
    else if (a === 'rouvrir') changerStatutSuivi(sid, 'Ouverte');
    else if (a === 'signer') signerSeance(sid);
    else if (a === 'editer-formation') ouvrirEditeurFormation(el.dataset.fid || null);
    else if (a === 'suppr-formation') supprimerFormation(el.dataset.fid);
    else if (a === 'masquer-formation') basculerMasqueeFormation(el.dataset.fid);
    else if (a === 'suppr-suivi') supprimerSuivi(sid);
    else if (a === 'lecon-suppr') el.closest('.formation-lecon-edit').remove();
    else if (a === 'mini-suppr') el.closest('.formation-mini-edit').remove();
    else if (a === 'lecon-add') ajouterBlocLecon();
});
// Le select vol de la page seance est cree dynamiquement : delegation change.
document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'seance-vol') prefillSeanceDepuisVol();
    // Fichier choisi pour une ressource : titre auto + icone coloree.
    if (e.target && e.target.classList.contains('ressource-fichier') && e.target.files[0]) {
        const bloc = e.target.closest('.formation-mini-edit');
        const titre = bloc && bloc.querySelector('.ressource-titre');
        if (titre && !titre.value.trim()) titre.value = e.target.files[0].name;
        e.target.parentElement.style.color = '#166534';
        e.target.parentElement.title = e.target.files[0].name;
    }
});

// Recherche pilote : on ne rerend que la liste pour conserver le focus.
document.addEventListener('input', (e) => {
    if (!e.target || e.target.id !== 'formation-recherche-pilote') return;
    recherchePilote = e.target.value;
    const liste = document.getElementById('formation-liste-suivis');
    if (liste) liste.innerHTML = renderListeSuivis(filtrerSuivis(suivisCache || []));
});

// ---------------------------------------------------------------------------
// SIGNATURE ELECTRONIQUE (identifiant + mot de passe du signataire)
// ---------------------------------------------------------------------------
// Le signataire prouve son identite avec ses identifiants du site : le
// serveur les verifie et renvoie son nom. Plus pratique qu'un trace au
// touchpad et autrement plus fiable.
function demanderSignatureElectronique(titre, identifiantSuggere) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.style.cssText = 'display:flex;z-index:1200;';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:400px;width:95%;">
                <h3>${escapeHtml(titre || 'Signature électronique')}</h3>
                <p style="font-size:13px;color:#64748b;margin:4px 0 10px;">La personne qui signe saisit son identifiant et son mot de passe du site.</p>
                <div class="form-group"><label for="sig-identifiant">Identifiant ou mail</label><input type="text" id="sig-identifiant" autocomplete="username" value="${escapeHtml(identifiantSuggere || '')}"></div>
                <div class="form-group"><label for="sig-mdp">Mot de passe</label><input type="password" id="sig-mdp" autocomplete="off"></div>
                <div id="sig-erreur" style="display:none;color:#b91c1c;font-size:13px;margin-top:6px;"></div>
                <div class="form-actions" style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end;">
                    <button type="button" class="btn-secondary" id="sig-annuler">Annuler</button>
                    <button type="button" class="btn-primary" id="sig-valider">✍️ Signer</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const fermer = v => { overlay.remove(); resolve(v); };
        const btn = overlay.querySelector('#sig-valider');
        const errEl = overlay.querySelector('#sig-erreur');
        const valider = async () => {
            const identifiant = overlay.querySelector('#sig-identifiant').value.trim();
            const motDePasse = overlay.querySelector('#sig-mdp').value;
            if (!identifiant || !motDePasse) { errEl.textContent = 'Identifiant et mot de passe requis.'; errEl.style.display = 'block'; return; }
            btn.disabled = true; btn.textContent = 'Vérification…';
            try {
                const res = await fetch(`${AUTH_BASE}/verify`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ identifiant, motDePasse })
                });
                const data = await res.json();
                if (!res.ok) {
                    errEl.textContent = data.error?.message || 'Identifiant ou mot de passe incorrect.';
                    errEl.style.display = 'block';
                    btn.disabled = false; btn.textContent = '✍️ Signer';
                    return;
                }
                fermer({
                    par: data.nom || identifiant,
                    date: new Date().toISOString().slice(0, 16).replace('T', ' '),
                    methode: 'electronique'
                });
            } catch (e) {
                errEl.textContent = 'Erreur de vérification, réessayez.';
                errEl.style.display = 'block';
                btn.disabled = false; btn.textContent = '✍️ Signer';
            }
        };
        btn.addEventListener('click', valider);
        overlay.querySelector('#sig-annuler').addEventListener('click', () => fermer(null));
        overlay.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); valider(); } });
        overlay.querySelector('#sig-mdp').focus();
    });
}

// Identifiant du compte de l'eleve (lien Utilisateurs du suivi) pour
// pre-remplir la modale de signature quand l'instructeur fait signer.
async function identifiantEleve(suivi) {
    const eleveId = ((suivi.fields || {})['Élève'] || [])[0];
    if (!eleveId) return '';
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS)}/${eleveId}`, { headers });
        const data = await res.json();
        return res.ok ? ((data.fields || {})['Identifiant'] || '') : '';
    } catch (e) { return ''; }
}

async function signerSeance(seanceId) {
    const sig = await demanderSignatureElectronique('Signature électronique — vos identifiants', currentUser ? currentUser.identifiant : '');
    if (!sig) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ records: [{ id: seanceId, fields: { 'Signature élève': sig } }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
        invaliderFormationCache();
        await chargerToutesSeances(true);
        if (suiviOuvertId) renderDetailSuivi(); else chargerFormation();
    } catch (e) { console.error(e); alert('Erreur lors de la signature.'); }
}

// Affiche le detail d'une signature (auteur, date, methode, image).
function voirSignatureSeance(seanceId, qui) {
    const s = (seancesCache || []).find(x => x.id === seanceId);
    if (!s) return;
    const sig = formationJson(qui === 'i' ? s.fields['Signature instructeur'] : s.fields['Signature élève'], null);
    if (!sig) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.cssText = 'display:flex;z-index:1200;';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width:420px;">
            <h3 style="margin-top:0;">✍️ Signature ${qui === 'i' ? 'instructeur' : 'élève'}</h3>
            <p style="margin:6px 0;"><strong>${escapeHtml(sig.par || '—')}</strong><br>
            <span style="color:#64748b;font-size:13px;">le ${escapeHtml(sig.date || '')}${sig.methode === 'electronique' ? ' · signature électronique (identifiants vérifiés)' : ''}</span></p>
            ${sig.image ? `<img src="${sig.image}" alt="Signature" style="max-width:100%;border:1px solid #e2e8f0;border-radius:8px;">` : ''}
            <div class="form-actions" style="margin-top:12px;display:flex;justify-content:flex-end;">
                <button type="button" class="btn-secondary" id="sig-voir-fermer">Fermer</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const fermer = () => overlay.remove();
    overlay.querySelector('#sig-voir-fermer').addEventListener('click', fermer);
    overlay.addEventListener('click', e => { if (e.target === overlay) fermer(); });
}

// ---------------------------------------------------------------------------
// GESTION DU STATUT ET DE LA DOCUMENTATION D'UN SUIVI
// ---------------------------------------------------------------------------
async function patchSuivi(suiviId, fields) {
    const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SUIVIS)}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ records: [{ id: suiviId, fields }] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
    invaliderFormationCache();
    await chargerSuivis(true);
}

async function changerStatutSuivi(suiviId, statut) {
    const labels = { 'Terminée': 'marquer cette formation comme terminée ?', 'Archivée': 'archiver cette formation ?', 'Ouverte': 'rouvrir cette formation ?' };
    if (!(await confirmerAction(`Voulez-vous ${labels[statut] || 'changer le statut ?'}`, { okLabel: 'Confirmer', icone: '🎓' }))) return;
    try {
        const fields = { 'Statut': statut };
        if (statut !== 'Ouverte') fields['Date fin'] = new Date().toISOString().slice(0, 10);
        await patchSuivi(suiviId, fields);
        if (suiviOuvertId) renderDetailSuivi(); else chargerFormation();
    } catch (e) { console.error(e); alert('Erreur lors du changement de statut.'); }
}

// L'eleve depose un document demande : fichier facultatif (upload /v0/upload)
// + date de validite. Le serveur n'autorise l'eleve qu'a completer les items
// existants (longueur et titres conserves — verifie cote backend).
async function marquerDocumentFourni(suiviId, docId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const inputFichier = document.getElementById(`doc-fichier-${docId}`);
    const inputValidite = document.getElementById(`doc-validite-${docId}`);
    const docTitre = (formationJson(suivi.fields['Documentation'], []).find(d => String(d.id) === String(docId)) || {}).titre || '';
    const dv = inputValidite ? inputValidite.value : '';
    // Pour les documents a echeance (medical, SEP, instructeur...), la
    // date de fin de validite est requise et reportee sur la fiche membre.
    if (champValiditePourTitre(docTitre) && !dv) {
        alert('La date de fin de validité est requise pour ce document.');
        return;
    }
    let lien = '';
    try {
        if (inputFichier && inputFichier.files && inputFichier.files[0]) {
            lien = await uploaderFichierDocument(inputFichier.files[0]);
        }
    } catch (e) { alert('Erreur lors de l\'upload : ' + e.message); return; }
    const docs = formationJson(suivi.fields['Documentation'], []).map(d =>
        String(d.id) === String(docId) ? {
            ...d, statut: 'Fourni',
            dateFourni: new Date().toISOString().slice(0, 10),
            dateValidite: dv,
            lien: lien || d.lien || ''
        } : d);
    try {
        await patchSuivi(suiviId, { 'Documentation': docs });
        await reporterValiditeMembre(suivi, dv, docTitre);
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la mise à jour.'); }
}

// Documents deja deposes dans l'espace membre (table Documents,
// sous-dossier = nom complet du membre), hors archives.
async function chargerDocsEspaceMembre(nomComplet) {
    const n = (nomComplet || '').replace(/"/g, '\\"');
    const formula = `FIND(UPPER("${n}"), UPPER({Sous-dossier})) > 0`;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}?filterByFormula=${encodeURIComponent(formula)}`;
    const records = await fetchTousRecordsCache(url, { headers });
    return records.filter(r => !(r.fields || {})['Archivé']).map(r => ({
        id: r.id,
        titre: (r.fields || {})['Titre'] || 'Document',
        lien: (r.fields || {})['Lien'] || '',
        dateValidite: (r.fields || {})['Date de validité'] || ''
    }));
}

// Modale de choix dans une liste : resolve l'id choisi ou null.
function choisirDansListe(titre, items) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '20000';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:480px;">
                <h3 style="margin-top:0; color:#1e3d59;">${escapeHtml(titre)}</h3>
                <div style="display:flex; flex-direction:column; gap:8px; max-height:320px; overflow-y:auto;">
                    ${items.map(it => `<button type="button" class="btn-secondary" style="text-align:left;" data-choix="${it.id}">📄 ${escapeHtml(it.label)}</button>`).join('')}
                </div>
                <div style="display:flex; justify-content:flex-end; margin-top:14px;">
                    <button type="button" class="nr-btn-cancel" id="choix-liste-cancel">Annuler</button>
                </div>
            </div>`;
        const fermer = v => { overlay.remove(); resolve(v); };
        overlay.querySelectorAll('[data-choix]').forEach(b => b.addEventListener('click', () => fermer(b.dataset.choix)));
        overlay.querySelector('#choix-liste-cancel').addEventListener('click', () => fermer(null));
        overlay.addEventListener('click', e => { if (e.target === overlay) fermer(null); });
        document.body.appendChild(overlay);
    });
}

// Complete un document demande en piochant un fichier deja present
// dans l'espace membre de l'eleve (pas de re-upload).
async function choisirDocumentMembre(suiviId, docId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const nomEleve = suivi.fields['Élève nom'] || '';
    let docsMembre = [];
    try { docsMembre = await chargerDocsEspaceMembre(nomEleve); }
    catch (e) { console.error(e); }
    if (!docsMembre.length) { alert(`Aucun document dans l'espace membre de ${nomEleve}.`); return; }
    const choix = await choisirDansListe(`Documents de l'espace membre — ${nomEleve}`, docsMembre.map(d => ({ id: d.id, label: d.titre })));
    if (!choix) return;
    const doc = docsMembre.find(d => d.id === choix);
    if (!doc || !doc.lien) { alert('Ce document n\'a pas de fichier joint.'); return; }
    const inputValidite = document.getElementById(`doc-validite-${docId}`);
    let dvReporte = '';
    const titreDemande = (formationJson(suivi.fields['Documentation'], []).find(d => String(d.id) === String(docId)) || {}).titre || doc.titre || '';
    const docs = formationJson(suivi.fields['Documentation'], []).map(d => {
        if (String(d.id) !== String(docId)) return d;
        const dv = (inputValidite && inputValidite.value) || doc.dateValidite || d.dateValidite || '';
        dvReporte = dv;
        return {
            ...d, statut: 'Fourni',
            dateFourni: new Date().toISOString().slice(0, 10),
            dateValidite: dv,
            lien: doc.lien,
            srcDocId: doc.id
        };
    });
    if (champValiditePourTitre(titreDemande) && !dvReporte) {
        alert('La date de fin de validité est requise pour ce document.');
        return;
    }
    try {
        await patchSuivi(suiviId, { 'Documentation': docs });
        await reporterValiditeMembre(suivi, dvReporte, titreDemande);
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la mise à jour.'); }
}

// Type de document deduit du titre -> champ de validite de la fiche membre.
function champValiditePourTitre(titre) {
    const t = (titre || '').toLowerCase();
    if (t.includes('instructeur ulm')) return 'Date de validité instructeur ULM';
    if (t.includes('instructeur')) return 'Date de validité instructeur';
    if (t.includes('médical') || t.includes('medical')) return 'Médical';
    if (t.includes('sep')) return 'Licence SEP';
    if (t.includes('autorisation parentale')) return 'Date de validité autorisation parentale';
    return '';
}

// Reporte la date de fin de validite sur la case correspondante de la
// fiche membre de l'eleve (silencieux si pas le droit ou pas d'eleve lie).
async function reporterValiditeMembre(suivi, dateValidite, titre) {
    const champ = champValiditePourTitre(titre);
    const eleveId = (suivi.fields['Élève'] || [])[0];
    if (!champ || !dateValidite || !eleveId) return;
    try {
        await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS)}/${eleveId}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ fields: { [champ]: dateValidite } })
        });
    } catch (e) { console.warn('Report de validité sur la fiche membre:', e); }
}

// L'instructeur peut demander un document supplementaire en cours de
// formation : ajoute a la liste Documentation du suivi.
async function ajouterDocumentDemande(suiviId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const titre = await demanderSaisie('Document à demander à l\'élève', '', { placeholder: 'Ex : copie de la licence', okLabel: 'Demander' });
    if (!titre || !titre.trim()) return;
    const docs = formationJson(suivi.fields['Documentation'], []);
    docs.push({ id: `d${Date.now()}`, titre: titre.trim(), statut: 'Demandé', dateDemande: new Date().toISOString().slice(0, 10) });
    try {
        await patchSuivi(suiviId, { 'Documentation': docs });
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de l\'ajout.'); }
}

// Remplace le document fourni : nouveau fichier uploade ou choix d'un
// document deja present dans l'espace membre de l'eleve.
async function remplacerDocumentDemande(suiviId, docId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const doc = formationJson(suivi.fields['Documentation'], []).find(d => String(d.id) === String(docId));
    if (!doc) return;
    const mode = await choisirDansListe(`Document « ${doc.titre || ''} »`, [
        { id: 'upload', label: '📎 Envoyer un nouveau fichier' },
        { id: 'membre', label: '📁 Choisir dans l\'espace membre de l\'élève' }
    ]);
    if (!mode) return;
    if (mode === 'membre') { await choisirDocumentMembre(suiviId, docId); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png';
    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            const lien = await uploaderFichierDocument(file);
            const docs = formationJson(suivi.fields['Documentation'], []).map(d =>
                String(d.id) === String(docId) ? {
                    ...d, statut: 'Fourni',
                    dateFourni: new Date().toISOString().slice(0, 10),
                    lien, srcDocId: undefined
                } : d);
            await patchSuivi(suiviId, { 'Documentation': docs });
            renderDetailSuivi();
        } catch (e) { console.error(e); alert('Erreur lors de l\'upload : ' + (e.message || '')); }
    });
    input.click();
}

// Sur un document fourni, retire la piece jointe et repasse la demande
// en attente ; sur une demande sans piece, supprime la demande.
async function supprimerDocumentDemande(suiviId, docId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const doc = formationJson(suivi.fields['Documentation'], []).find(d => String(d.id) === String(docId));
    if (!doc) return;
    const fourni = doc.statut === 'Fourni';
    const ok = await confirmerAction(fourni
        ? `Retirer la pièce jointe de « ${doc.titre || ''} » ? La demande repassera en attente.`
        : `Supprimer la demande de document « ${doc.titre || ''} » ?`,
        { okLabel: fourni ? 'Retirer' : 'Supprimer' });
    if (!ok) return;
    const docs = fourni
        ? formationJson(suivi.fields['Documentation'], []).map(d =>
            String(d.id) === String(docId) ? {
                ...d, statut: 'Demandé',
                dateFourni: undefined, dateValidite: undefined,
                lien: undefined, srcDocId: undefined, archive: undefined
            } : d)
        : formationJson(suivi.fields['Documentation'], []).filter(d => String(d.id) !== String(docId));
    try {
        await patchSuivi(suiviId, { 'Documentation': docs });
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la suppression.'); }
}

// Validation d'un module theorique par l'instructeur (date de la séance/emargement).
async function validerModule(suiviId, moduleId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const input = document.getElementById(`module-date-${moduleId}`);
    const date = (input && input.value) || new Date().toISOString().slice(0, 10);
    const modules = formationJson(suivi.fields['Modules'], []).map(mo =>
        String(mo.id) === String(moduleId) ? { ...mo, statut: true, date } : mo);
    try {
        await patchSuivi(suiviId, { 'Modules': modules });
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la validation.'); }
}

// ---------------------------------------------------------------------------
// FICHE ELEVE (etat civil + contact d'urgence — livret GEN 1)
// L'eleve peut completer sa propre fiche (auto-edition verifiee cote serveur).
// ---------------------------------------------------------------------------
// Recupere la fiche membre (Utilisateurs) de l'eleve du suivi, pour
// synchroniser les infos communes : naissance, lieu, telephone, mail, adresse.
async function membreDuSuivi(suivi) {
    const eleveId = (suivi.fields['Élève'] || [])[0];
    if (!eleveId) return null;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent('Utilisateurs')}/${eleveId}`, { headers });
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}
// Champs partages entre la fiche eleve (Etat civil) et la fiche membre.
const CHAMPS_FICHE_MEMBRE = [
    ['naissance', 'Date de naissance'], ['lieuNaissance', 'Lieu de naissance'],
    ['telephone', 'Téléphone'], ['email', 'Mail'], ['adresse', 'Adresse'],
    ['urgenceNom', 'Contact urgence nom'], ['urgenceTel', 'Contact urgence téléphone']
];

async function ouvrirFicheEleve(suiviId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const ec = formationJson(suivi.fields['Etat civil'], {}) || {};
    const membre = await membreDuSuivi(suivi);
    const mf = (membre && membre.fields) || {};
    // La valeur du suivi prime si remplie ; sinon on prend la fiche membre.
    const pick = (cle) => {
        const e = ec[cle];
        if (e !== undefined && e !== null && String(e).trim() !== '') return e;
        const m = CHAMPS_FICHE_MEMBRE.find(([c]) => c === cle);
        return m ? (mf[m[1]] || '') : '';
    };
    const set = (id, v) => { document.getElementById(id).value = v || ''; };
    set('fiche-naissance', pick('naissance')); set('fiche-lieu-naissance', pick('lieuNaissance'));
    set('fiche-telephone', pick('telephone'));
    set('fiche-email', pick('email')); set('fiche-adresse', pick('adresse'));
    set('fiche-urgence-nom', pick('urgenceNom')); set('fiche-urgence-tel', pick('urgenceTel'));
    const overlay = document.getElementById('modale-formation-fiche');
    overlay.dataset.sid = suiviId;
    // Suivi gele : la fiche reste consultable mais non modifiable.
    const gele = suiviFige(suivi);
    overlay.querySelectorAll('#form-formation-fiche input').forEach(i => { i.disabled = gele; });
    const submit = overlay.querySelector('#form-formation-fiche button[type="submit"]');
    if (submit) submit.style.display = gele ? 'none' : '';
    overlay.style.display = 'flex';
}

async function enregistrerFiche(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-fiche');
    if (suiviFige((suivisCache || []).find(s => s.id === overlay.dataset.sid))) {
        alert('Cette formation est figée : la fiche n\'est plus modifiable.');
        return;
    }
    const val = id => document.getElementById(id).value.trim();
    const ec = {
        naissance: document.getElementById('fiche-naissance').value,
        lieuNaissance: val('fiche-lieu-naissance'),
        telephone: val('fiche-telephone'), email: val('fiche-email'), adresse: val('fiche-adresse'),
        urgenceNom: val('fiche-urgence-nom'), urgenceTel: val('fiche-urgence-tel')
    };
    const suiviId = overlay.dataset.sid;
    try {
        await patchSuivi(suiviId, { 'Etat civil': ec });
        // Retour de la sync : les champs communs sont aussi reportes sur la
        // fiche membre (possible pour l'eleve lui-meme et le Super admin).
        const suivi = suivisCache.find(s => s.id === suiviId);
        const eleveId = suivi ? (suivi.fields['Élève'] || [])[0] : null;
        if (eleveId && (eleveId === (currentUser && currentUser.id) || isSuperAdmin())) {
            const fields = {};
            CHAMPS_FICHE_MEMBRE.forEach(([cle, champ]) => { fields[champ] = ec[cle] || null; });
            await cachedFetch(`${API_BASE}/${encodeURIComponent('Utilisateurs')}/${eleveId}`, {
                method: 'PATCH', headers, body: JSON.stringify({ fields })
            }).catch(() => {});
        }
        overlay.style.display = 'none';
    } catch (err) { console.error(err); alert('Erreur lors de l\'enregistrement de la fiche.'); }
}

// ---------------------------------------------------------------------------
// CREDITS MANUELS (heures/vols ajoutes a la main dans les minimas)
// ---------------------------------------------------------------------------
function ouvrirModaleCredit(suiviId, creditId) {
    const overlay = document.getElementById('modale-formation-credit');
    if (!overlay) return;
    overlay.dataset.sid = suiviId;
    overlay.dataset.cid = creditId || '';
    document.getElementById('form-formation-credit').reset();
    const edition = !!creditId;
    document.getElementById('credit-modal-titre').textContent = edition ? '✋ Modifier le vol / les heures' : '✋ Ajouter un vol / des heures';
    document.getElementById('credit-submit').textContent = edition ? 'Enregistrer' : 'Ajouter';
    if (edition) {
        const suivi = suivisCache.find(s => s.id === suiviId);
        const c = suivi && formationJson(suivi.fields['Crédits'], []).find(x => String(x.id) === String(creditId));
        if (!c) return;
        document.getElementById('credit-libelle').value = c.libelle || '';
        document.getElementById('credit-heures').value = c.heures || '';
        document.getElementById('credit-vols').value = c.vols || '';
        document.getElementById('credit-dc').value = c.dc || '';
        document.getElementById('credit-solo').value = c.solo || '';
        document.getElementById('credit-simu').value = c.simu || '';
        document.getElementById('credit-att').value = c.att || '';
    }
    overlay.style.display = 'flex';
}

async function enregistrerCredit(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-credit');
    const suiviId = overlay.dataset.sid;
    const creditId = overlay.dataset.cid || '';
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const num = id => parseFloat(document.getElementById(id).value) || 0;
    const saisie = {
        libelle: document.getElementById('credit-libelle').value.trim(),
        heures: num('credit-heures'), vols: num('credit-vols'),
        dc: num('credit-dc'), solo: num('credit-solo'), simu: num('credit-simu'),
        att: num('credit-att')
    };
    let credits = formationJson(suivi.fields['Crédits'], []).slice();
    if (creditId) {
        credits = credits.map(c => String(c.id) === String(creditId) ? { ...c, ...saisie } : c);
    } else {
        credits.push({ id: `c${Date.now()}`, ...saisie });
    }
    try {
        await patchSuivi(suiviId, { 'Crédits': credits });
        overlay.style.display = 'none';
        renderDetailSuivi();
    } catch (err) { console.error(err); alert('Erreur lors de l\'enregistrement.'); }
}

async function supprimerCredit(suiviId, creditId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const credits = formationJson(suivi.fields['Crédits'], []).filter(c => String(c.id) !== String(creditId));
    try {
        await patchSuivi(suiviId, { 'Crédits': credits });
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la suppression.'); }
}

// ---------------------------------------------------------------------------
// MODALE ATTRIBUTION D'UNE FORMATION A UN ELEVE
// ---------------------------------------------------------------------------
async function ouvrirModaleAttribuer() {
    const overlay = document.getElementById('modale-formation-attribuer');
    const selEleve = document.getElementById('attribuer-eleve');
    const selForm = document.getElementById('attribuer-formation');
    // Liste des membres actifs
    let membres = (typeof listeMembresCache !== 'undefined' && listeMembresCache.length) ? listeMembresCache : null;
    if (!membres) {
        const url = `${API_BASE}/${encodeURIComponent('Utilisateurs')}?pageSize=100`;
        membres = await fetchTousRecordsCache(url, { headers });
    }
    membresFormationCache = membres;
    const actifs = membres.filter(m => m.fields && m.fields['Actif'] !== false && `${m.fields['Prénom'] || ''}${m.fields['Nom'] || ''}`.trim());
    actifs.sort((a, b) => `${a.fields['Prénom']} ${a.fields['Nom']}`.localeCompare(`${b.fields['Prénom']} ${b.fields['Nom']}`));
    selEleve.innerHTML = '<option value="">— Choisir un élève —</option>' +
        actifs.map(m => `<option value="${m.id}">${escapeHtml(`${m.fields['Prénom'] || ''} ${m.fields['Nom'] || ''}`.trim())}</option>`).join('');
    const formations = formationsTriees().filter(f => f.fields['Actif'] !== false && !f.fields['Masquée']);
    selForm.innerHTML = '<option value="">— Choisir une formation —</option>' +
        formations.map(f => `<option value="${f.id}">${escapeHtml(f.fields['Titre'] || 'Formation')}</option>`).join('');
    document.getElementById('attribuer-date').value = new Date().toISOString().slice(0, 10);
    const cbTerminee = document.getElementById('attribuer-terminee');
    const pdfGroupe = document.getElementById('attribuer-pdf-groupe');
    if (cbTerminee) { cbTerminee.checked = false; cbTerminee.onchange = () => { pdfGroupe.style.display = cbTerminee.checked ? 'block' : 'none'; }; }
    if (pdfGroupe) pdfGroupe.style.display = 'none';
    const pdfInput = document.getElementById('attribuer-pdf');
    if (pdfInput) pdfInput.value = '';
    majCasAttribution();
    overlay.style.display = 'flex';
}

// Cas de figure d'une formation : nouveau format (cas[]) ou ancien licencie.
function casDeFormation(formation) {
    const m = formationJson(formation && formation.fields['Minimas'], {}) || {};
    if (Array.isArray(m.cas)) return m.cas;
    if (m.heuresLicencie || m.volsLicencie) return [{ nom: 'Déjà licencié', heures: m.heuresLicencie || 0, vols: m.volsLicencie || 0 }];
    return [];
}
function majCasAttribution() {
    const formId = document.getElementById('attribuer-formation').value;
    const formation = formationsCache.find(f => f.id === formId);
    const groupe = document.getElementById('attribuer-cas-groupe');
    const sel = document.getElementById('attribuer-cas');
    const cas = formation ? casDeFormation(formation) : [];
    groupe.style.display = cas.length ? 'block' : 'none';
    sel.innerHTML = '<option value="">Minimas standard</option>' +
        cas.map((c, i) => `<option value="${i}">${escapeHtml(c.nom)} — ${c.heures || 0}h / ${c.vols || 0} vols</option>`).join('');
}

async function enregistrerAttribution(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-attribuer');
    const eleveId = document.getElementById('attribuer-eleve').value;
    const formId = document.getElementById('attribuer-formation').value;
    const dateDebut = document.getElementById('attribuer-date').value;
    const casIdx = document.getElementById('attribuer-cas').value;
    if (!eleveId || !formId || !dateDebut) { alert('Choisissez un élève, une formation et une date.'); return; }
    const membre = membresFormationCache.find(m => m.id === eleveId);
    const formation = formationsCache.find(f => f.id === formId);
    if (!formation) { alert('Formation introuvable.'); return; }
    const ff = formation.fields;
    const nomEleve = membre ? `${membre.fields['Prénom'] || ''} ${membre.fields['Nom'] || ''}`.trim() : eleveId;
    const min = formationJson(ff['Minimas'], {}) || {};
    const cas = casDeFormation(formation);
    const choisi = casIdx !== '' ? cas[parseInt(casIdx, 10)] : null;
    const minimas = {
        heures: choisi ? (choisi.heures ?? 0) : (min.heures ?? 0),
        vols: choisi ? (choisi.vols ?? 0) : (min.vols ?? 0),
        heuresDC: choisi ? (choisi.heuresDC ?? 0) : (min.heuresDC ?? 0),
        heuresSolo: choisi ? (choisi.heuresSolo ?? 0) : (min.heuresSolo ?? 0),
        atterrissages: choisi ? (choisi.atterrissages ?? 0) : (min.atterrissages ?? 0)
    };
    if (choisi) minimas.cas = choisi.nom;
    // Les prerequis du catalogue deviennent les documents demandes a l'eleve.
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const importTerminee = document.getElementById('attribuer-terminee')?.checked;
    const pdfInput = document.getElementById('attribuer-pdf');
    let livretLien = '';
    if (importTerminee) {
        const fichier = pdfInput && pdfInput.files && pdfInput.files[0];
        if (!fichier) { alert('Choisissez le PDF du livret de formation.'); return; }
        try { livretLien = await uploaderFichierDocument(fichier); }
        catch (err) { alert('Erreur lors de l\'upload du livret : ' + (err.message || err)); return; }
    }
    const documentation = importTerminee
        ? [{ id: `d${Date.now()}`, titre: `Livret importé — ${(pdfInput.files[0] || {}).name || 'livret.pdf'}`, statut: 'Fourni', dateFourni: aujourdhui, lien: livretLien }]
        : formationJson(ff['Prerequis'], []).map((p, i) => ({
            id: `d${Date.now()}_${i}`, titre: p.titre, statut: 'Demandé', dateDemande: aujourdhui, prerequis: true
        }));
    const fields = {
        'Élève': [eleveId],
        'Élève nom': nomEleve,
        'Instructeur': `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim(),
        'Formation': [formId],
        'Formation titre': ff['Titre'] || '',
        'Discipline': ff['Discipline'] || '',
        'Lecons': formationJson(ff['Lecons'], []),
        'Minimas': minimas,
        'Ressources': formationJson(ff['Ressources'], []),
        'Modules': formationJson(ff['Modules'], []).map((m, i) => ({ id: `m${Date.now()}_${i}`, titre: m.titre, statut: false, date: '' })),
        'Etat civil': { telephone: (membre && membre.fields['Téléphone']) || '', email: (membre && membre.fields['Mail']) || '' },
        'Statut': importTerminee ? 'Terminée' : 'Ouverte',
        'Date début': dateDebut,
        'Documentation': documentation
    };
    if (importTerminee) fields['Date fin'] = aujourdhui;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SUIVIS)}`, {
            method: 'POST', headers, body: JSON.stringify({ records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
        overlay.style.display = 'none';
        invaliderFormationCache();
        await chargerSuivis(true);
        chargerFormation();
    } catch (err) { console.error(err); alert('Erreur lors de l\'attribution.'); }
}

// ---------------------------------------------------------------------------
// CATALOGUE DES FORMATIONS (creation / edition lecons + items)
// ---------------------------------------------------------------------------
// Catalogue trie par titre ; les formations masquees passent en fin de liste.
function formationsTriees() {
    return (formationsCache || []).slice().sort((a, b) =>
        String(a.fields['Titre'] || '').localeCompare(String(b.fields['Titre'] || ''), 'fr', { sensitivity: 'base' }) ||
        String(a.id).localeCompare(String(b.id)));
}

function ouvrirGestionCatalogue() {
    const overlay = document.getElementById('modale-formation-catalogue');
    const liste = document.getElementById('catalogue-liste');
    const visibles = formationsTriees().filter(f => !f.fields['Masquée']);
    const masquees = formationsTriees().filter(f => f.fields['Masquée']);
    const ligne = (f, masquee) => {
        const lecons = formationJson(f.fields['Lecons'], []);
        return `<div class="formation-doc catalogue-ligne" ${masquee ? 'style="opacity:0.55;"' : ''}>
            <span class="catalogue-ligne-titre"><strong>${escapeHtml(f.fields['Titre'] || '')}</strong> <span class="formation-carte-sub">${escapeHtml(f.fields['Discipline'] || '')} · ${lecons.length} leçon(s)${masquee ? ' · masquée' : ''}</span></span>
            <span class="catalogue-ligne-actions">
                <button class="btn-secondary" style="padding:4px 10px;font-size:12px;" data-formation-action="editer-formation" data-fid="${f.id}">✏️ Modifier</button>
                <button class="btn-secondary" style="padding:4px 10px;font-size:12px;" title="${masquee ? 'Réafficher' : 'Masquer'}" data-formation-action="masquer-formation" data-fid="${f.id}">${masquee ? '👁' : '🚫'}</button>
                <button class="btn-secondary" style="padding:4px 10px;font-size:12px;color:#b91c1c;" data-formation-action="suppr-formation" data-fid="${f.id}">🗑</button>
            </span>
        </div>`;
    };
    liste.innerHTML =
        visibles.map(f => ligne(f, false)).join('') +
        (masquees.length ? `<h5 class="formation-phase-titre">Masquées</h5>` + masquees.map(f => ligne(f, true)).join('') : '')
        || '<div class="formation-vide">Aucune formation au catalogue.</div>';
    overlay.style.display = 'flex';
}

// Masquer/reafficher une formation du catalogue (elle reste utilisable
// dans les suivis existants mais disparait de la liste d'attribution).
async function basculerMasqueeFormation(fid) {
    const f = formationsCache.find(x => x.id === fid);
    if (!f) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS)}/${fid}`, {
            method: 'PATCH', headers, body: JSON.stringify({ fields: { 'Masquée': !f.fields['Masquée'] } })
        });
        if (!res.ok) throw new Error(await res.text());
        invaliderFormationCache();
        await chargerFormationsCatalogue(true);
        ouvrirGestionCatalogue();
    } catch (e) { console.error(e); alert('Erreur lors de la mise à jour.'); }
}

function blocLeconHtml(lecon, idx) {
    const itemsTxt = (lecon.items || []).join('\n');
    return `<div class="formation-lecon-edit" data-lecon-id="${escapeHtml(lecon.id || '')}">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <strong style="font-size:13px;">Leçon ${idx + 1}</strong>
            <input type="text" class="lecon-titre" placeholder="Titre de la leçon *" value="${escapeHtml(lecon.titre || '')}" style="flex:1;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
            <button type="button" class="btn-secondary" style="padding:4px 8px;color:#b91c1c;" data-formation-action="lecon-suppr">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
            <input type="text" class="lecon-objectif" placeholder="Objectif (optionnel)" value="${escapeHtml(lecon.objectif || '')}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
            <input type="text" class="lecon-groupe" placeholder="Phase (optionnel, ex : Phase 1 — Maniabilité)" value="${escapeHtml(lecon.groupe || '')}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
        </div>
        <textarea class="lecon-items" rows="3" placeholder="Un item par ligne : ex. « Tenir le cap ±10° »" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-family:inherit;">${escapeHtml(itemsTxt)}</textarea>
    </div>`;
}
function ajouterBlocLecon() {
    const zone = document.getElementById('editeur-lecons');
    const idx = zone.querySelectorAll('.formation-lecon-edit').length;
    const div = document.createElement('div');
    div.innerHTML = blocLeconHtml({ id: '', titre: '', objectif: '', items: [] }, idx);
    zone.appendChild(div.firstElementChild);
}

// Cas de figure de minimas (ex : "deja licencié ULM") — nom libre, multiples.
function blocCasHtml(cas) {
    const inp = (cls, ph, v) => `<input type="number" class="${cls}" min="0" step="0.5" placeholder="${ph}" title="${ph}" value="${v ?? ''}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;min-width:0;">`;
    return `<div class="formation-mini-edit" style="display:grid;grid-template-columns:1.6fr repeat(5,0.7fr) auto;gap:6px;margin-bottom:6px;align-items:center;">
        <input type="text" class="cas-nom" placeholder="Nom du cas (ex : déjà licencié ULM)" value="${escapeHtml(cas.nom || '')}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;min-width:0;">
        ${inp('cas-heures', 'Heures', cas.heures)}${inp('cas-vols', 'Vols', cas.vols)}${inp('cas-hdc', 'h double cmd', cas.heuresDC)}${inp('cas-hsolo', 'h solo', cas.heuresSolo)}${inp('cas-att', 'Atterrissages', cas.atterrissages)}
        <button type="button" class="btn-secondary" style="padding:4px 8px;color:#b91c1c;" data-formation-action="mini-suppr">✕</button>
    </div>`;
}
function blocModuleHtml(m) {
    return `<div class="formation-mini-edit" style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
        <input type="text" class="module-titre" placeholder="Module théorique (ex : Réglementation)" value="${escapeHtml(m.titre || '')}" style="flex:1;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
        <button type="button" class="btn-secondary" style="padding:4px 8px;color:#b91c1c;" data-formation-action="mini-suppr">✕</button>
    </div>`;
}
function blocPrerequisHtml(p) {
    return `<div class="formation-mini-edit" style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
        <input type="text" class="prerequis-titre" placeholder="Document à fournir (ex : certificat médical)" value="${escapeHtml(p.titre || '')}" style="flex:1;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
        <button type="button" class="btn-secondary" style="padding:4px 8px;color:#b91c1c;" data-formation-action="mini-suppr">✕</button>
    </div>`;
}
function blocRessourceHtml(r) {
    const nomFichier = (r.lien || '').startsWith('/uploads/') ? r.lien.split('/').pop() : '';
    return `<div class="formation-mini-edit" style="display:grid;grid-template-columns:1fr 1.4fr auto auto;gap:6px;margin-bottom:6px;align-items:center;">
        <input type="text" class="ressource-titre" placeholder="Titre du lien" value="${escapeHtml(r.titre || '')}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
        <input type="url" class="ressource-lien" placeholder="https://… ou /uploads/…" value="${escapeHtml(r.lien || '')}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
        <label class="btn-secondary" style="padding:4px 8px;font-size:12px;cursor:pointer;white-space:nowrap;" title="${escapeHtml(nomFichier || 'Joindre un fichier (uploadé au moment de l’enregistrement)')}">📎<input type="file" class="ressource-fichier" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.odt,.txt" style="display:none;"></label>
        <button type="button" class="btn-secondary" style="padding:4px 8px;color:#b91c1c;" data-formation-action="mini-suppr">✕</button>
    </div>`;
}
function ajouterBlocMini(zoneId, html) {
    const zone = document.getElementById(zoneId);
    const div = document.createElement('div');
    div.innerHTML = html;
    zone.appendChild(div.firstElementChild);
}

// Canevas officiel du livret de progression PPL(A) (phases, exercices,
// modules theoriques, prerequis, minimas 45h/25DC/10 solo).
const CANEVAS_PPL = {
    titre: 'PPL(A)',
    discipline: 'Avion',
    description: 'Livret de progression PPL(A) — formation théorique et pratique.',
    minimas: { heures: 45, vols: 0, heuresDC: 25, heuresSolo: 10, atterrissages: 0 },
    modules: ['Réglementation', 'Performance humaine', 'Météorologie', 'Communication', 'Connaissance générale de l’aéronef', 'Principes du vol', 'Navigation', 'Performances et préparation du vol', 'Procédures opérationnelles'].map(titre => ({ titre })),
    prerequis: ['Copie d’une pièce d’identité (carte d’identité ou passeport valide)', 'Attestation parentale signée (si mineur)', 'Copie du certificat médical (requis avant tout vol solo supervisé)', 'Copie de licences éventuellement détenues', 'Attestation de réussite aux examens théoriques PPL(A)'].map(titre => ({ titre })),
    lecons: [
        { id: '1A', titre: 'Maniabilité (bases)', groupe: 'Phase 1 — Maniabilité', objectif: 'Acquis avant autorisation solo', items: ['1a Familiarisation avec l’avion', '1b Exercices de secours et d’urgence', '2 Préparation pour le vol et actions après vol', '3 Familiarisation au vol : exercices en vol', '4 Effets des gouvernes', '5a Roulage au sol', '5b Urgences : panne de freins et de direction', '6 Vol horizontal rectiligne', '7 Vol en montée', '8 Vol en descente', '9 Virages'] },
        { id: '1B', titre: 'Maniabilité (avancée)', groupe: 'Phase 1 — Maniabilité', objectif: '', items: ['10a Vol lent', '10b Décrochage (2 h min sur les décrochages et l’autorotation)', '11 Évitement de l’autorotation'] },
        { id: '1C', titre: 'Tours de piste', groupe: 'Phase 1 — Maniabilité', objectif: 'Acquis avant autorisation solo', items: ['12 Décollage et montée vers la branche vent arrière', '13 Circuit, approche et atterrissage', '12/13 Urgences'] },
        { id: '1D', titre: 'Premier solo', groupe: 'Phase 1 — Maniabilité', objectif: '', items: ['14a Premier solo — tour de piste', '14b Solo — local'] },
        { id: '2A', titre: 'Perfectionnement', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: '', items: ['15 Perfectionnement du virage', '16 Atterrissage forcé moteur réduit', '17 Atterrissage de précaution'] },
        { id: '2B', titre: 'Navigation', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: 'Acquis avant navigation solo', items: ['18a Navigation', '18b Problèmes de navigation à basse altitude et par visibilité réduite', '18c Radionavigation'] },
        { id: '2C', titre: 'Pilotage sans visibilité (VSV)', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: '', items: ['19 Pilotage de base aux instruments'] },
        { id: '2D', titre: 'Navigation solo supervisé', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: 'Min 5 h dont une nav de 150 NM avec arrêts complets sur 2 aérodromes différents du départ', items: ['Navigation en vol solo supervisé — 5 h min dont 150 NM'] },
        { id: '3A', titre: 'Révisions PPL', groupe: 'Phase 3 — Révisions PPL', objectif: '', items: ['Révision « PPL(A) »'] },
        { id: '3B', titre: 'Présentation à l’examen pratique', groupe: 'Phase 3 — Révisions PPL', objectif: 'Certificat théorique de moins de 2 ans requis', items: ['Présentation à l’examen pratique « PPL(A) »'] }
    ],
    ressources: []
};

// Canevas officiel du livret de progression LAPL(A) (REV 1 V2,
// 13/03/2023 — canevas ANPI accepte DSAC).
const CANEVAS_LAPL = {
    titre: 'LAPL(A)',
    discipline: 'Avion',
    description: 'Livret de progression LAPL(A) — formation théorique et pratique (canevas ANPI, REV 1 V2 du 13/03/2023). Conditions d’expérience minimales : 30 h de vol totales dont 15 h en double commande et 6 h en solo supervisé (dont 3 h en navigation et une navigation de 80 NM min comprenant un arrêt complet sur un aérodrome différent du départ). Aucune heure de simulateur n’est prise en compte.',
    minimas: { heures: 30, vols: 0, heuresDC: 15, heuresSolo: 6, atterrissages: 0 },
    modules: ['Réglementation', 'Performance humaine', 'Météorologie', 'Communication', 'Connaissance générale de l’aéronef', 'Principes du vol', 'Navigation', 'Performances et préparation du vol', 'Procédures opérationnelles'].map(titre => ({ titre })),
    prerequis: ['Copie d’une pièce d’identité (carte d’identité ou passeport valide)', 'Attestation parentale signée des représentants légaux (si mineur)', 'Copie du certificat médical (requis avant tout vol solo supervisé)', 'Copie de licences éventuellement détenues sur d’autres catégories d’aéronefs', 'Attestation de réussite aux examens théoriques LAPL(A)'].map(titre => ({ titre })),
    lecons: [
        { id: '1A', titre: 'Maniabilité (bases)', groupe: 'Phase 1 — Maniabilité', objectif: 'Acquis avant autorisation solo', items: ['1a Familiarisation avec l’avion', '1b Exercices de secours et d’urgence', '2 Préparation pour le vol et actions après vol', '3 Familiarisation au vol : exercices en vol', '4 Effets des gouvernes', '5a Roulage au sol', '5b Urgences : panne de freins et de direction', '6 Vol horizontal rectiligne', '7 Vol en montée', '8 Vol en descente', '9 Virages'] },
        { id: '1B', titre: 'Maniabilité (avancée)', groupe: 'Phase 1 — Maniabilité', objectif: 'Acquis avant autorisation solo', items: ['10a Vol lent', '10b Décrochage', '11 Évitement de l’autorotation'] },
        { id: '1C', titre: 'Tours de piste', groupe: 'Phase 1 — Maniabilité', objectif: 'Acquis avant autorisation solo', items: ['12 Décollage et montée vers la branche vent arrière', '13 Circuit, approche et atterrissage', '12/13 Urgences'] },
        { id: '1D', titre: 'Premier solo', groupe: 'Phase 1 — Maniabilité', objectif: 'Phases 1A, 1B et 1C acquises au préalable', items: ['14a Premier solo — tour de piste', '14b Solo — local'] },
        { id: '2A', titre: 'Perfectionnement', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: 'Phases 1A–1D et 2A terminées avant éventuelle ABL', items: ['15 Perfectionnement du virage', '16 Atterrissage forcé moteur réduit', '17 Atterrissage de précaution'] },
        { id: '2B', titre: 'Navigation', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: 'Acquis avant navigation solo', items: ['18a Navigation', '18b Problèmes de navigation à basse altitude et par visibilité réduite', '18c Radionavigation'] },
        { id: '2C', titre: 'Navigation solo supervisé', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: 'Min 3 h dont une navigation de 80 NM min comprenant 2 étapes avec arrêts complets', items: ['Navigation en vol solo supervisé — 3 h min dont 80 NM'] },
        { id: '3A', titre: 'Révisions LAPL', groupe: 'Phase 3 — Révisions LAPL', objectif: '', items: ['Révision « LAPL(A) »'] },
        { id: '3B', titre: 'Présentation à l’examen pratique', groupe: 'Phase 3 — Révisions LAPL', objectif: 'Certificat théorique LAPL(A) de moins de 2 ans + expérience minimale requis', items: ['Présentation à l’examen pratique « LAPL(A) »'] }
    ],
    ressources: []
};

// Livret stagiaire « lâché machine » (v1) — standardisation du suivi
// avant lâché sur un nouveau type d'avion.
const CANEVAS_LACHE = {
    titre: 'Lâché machine',
    discipline: 'Avion',
    description: 'Livret stagiaire lâché machine — standardise et suit l’avancement de chaque stagiaire en vue d’un lâché machine (inspiré des livrets de progression SNPI, non approuvé). Le jour du lâché machine, l’indiquer clairement dans le contenu de la séance.',
    minimas: { heures: 0, vols: 0, heuresDC: 0, heuresSolo: 0, atterrissages: 0 },
    modules: [],
    prerequis: ['Licence en cours de validité', 'Certificat médical en cours de validité'].map(titre => ({ titre })),
    lecons: [
        { id: 'T', titre: 'Briefing avant vol', groupe: 'Briefing avant vol', objectif: 'T1, T2 et T6 uniquement si le pilote est un nouveau membre de l’association', items: ['T1 Accès aux hangars, aux papiers, etc. (*)', 'T2 Utilisation du logiciel de réservation de l’avion (*)', 'T3 Sortie, entrée dans le hangar et nettoyage de l’avion', 'T4 Mise en route sur le tarmac', 'T5 Limitations (charge, centrage, distance décollage/atterrissage, carte carburant)', 'T6 Présentation du secteur et des particularités de la plateforme (*)'] },
        { id: 'S', titre: 'En secteur', groupe: 'Exercices de maniabilité', objectif: '', items: ['1 Familiarisation avec l’avion', '2 Virages (30 et 45 degrés)', '3 Vol lent', '4 Décrochage', '5 Virage engagé'] },
        { id: 'TdP', titre: 'Tour de piste', groupe: 'Exercices de maniabilité', objectif: '', items: ['6 2 TDP dont 1 basse hauteur', '7 Pannes de volets', '8 Panne moteur en montée initiale', '9 PTE', '10 Remise de gaz (plancher de stabilisation 100 ft AGL)'] },
        { id: 'L', titre: 'Lâché machine', groupe: 'Lâché', objectif: 'Indiquer clairement le lâché dans le contenu de la séance', items: ['Lâché machine'] }
    ],
    ressources: []
};

// Formulaire de prorogation SEP(T)/TMG par expérience — maintien de
// compétence (ANPI, conforme guide DSAC/PN/LIC 120169, V1.2 30/10/2015).
const CANEVAS_SEP = {
    titre: 'Prorogation SEP(T) / TMG',
    discipline: 'Avion',
    description: 'Formation de maintien de compétence pour la prorogation des qualifications de classe SEP(T) et TMG (formulaire ANPI V1.2, conforme au guide DSAC/PN/LIC 120169). Formation minimale : 1 h de vol, 1 vol — la DGAC préconise un vol unique d’au moins 1 h. Critères de performance (niveau PPL) : altitude ±150 ft, cap ±10°, vitesse décollage/approche +15/−5 kt, autres phases ±15 kt. Une fois terminé : renseigner SIGEBEL, imprimer l’extrait nominatif, mettre à jour le triptyque.',
    minimas: { heures: 1, vols: 1, heuresDC: 0, heuresSolo: 0, atterrissages: 0 },
    modules: ['TEM (gestion des menaces et des erreurs)', 'Prise de décision face à des conditions météorologiques dégradées', 'Vol non intentionnel en conditions IMC', 'Capacités de navigation'].map(titre => ({ titre })),
    prerequis: ['Licence avec qualification SEP(T)/TMG en cours de validité', 'Certificat médical en cours de validité'].map(titre => ({ titre })),
    lecons: [
        { id: 'DEP', titre: 'Départ', groupe: 'Maintien de compétence', objectif: '', items: ['Vérifications avant le démarrage (internes)', 'Démarrage du moteur normal, défaillances', 'Roulage', 'Vérification avant le départ : point fixe moteur', 'Montée : pente max / vario max, virages sur cap, mise en palier'] },
        { id: 'MAN', titre: 'Maniabilité', groupe: 'Maintien de compétence', objectif: '', items: ['Virages serrés (360° gauche/droite à 45° d’inclinaison)', 'Décrochages / approches du décrochage et récupération', 'Maniement du pilote automatique / directeur de vol (si applicable)'] },
        { id: 'NAV', titre: 'Navigation VFR en route', groupe: 'Maintien de compétence', objectif: 'Recommandée si expérience < 10 étapes dans les 24 derniers mois', items: ['Plan de vol, navigation à l’estime (DR) et lecture de cartes', 'Maintien de l’altitude, du cap et de la vitesse', 'Orientation, planification et revue des ETA', 'Utilisation du radioguidage (si applicable)', 'Gestion du vol (journal de bord, vérifications de routine)'] },
        { id: 'APP', titre: 'Approche et atterrissage', groupe: 'Maintien de compétence', objectif: '', items: ['Procédure d’arrivée sur aérodrome', 'Atterrissage normal', 'Atterrissage sans volets', 'Manœuvre de remise des gaz'] },
        { id: 'URG', titre: 'Procédures inhabituelles et d’urgence', groupe: 'Maintien de compétence', objectif: '', items: ['Décollage interrompu à une vitesse raisonnable', 'Panne moteur simulée après le décollage', 'Atterrissage forcé simulé sans puissance'] }
    ],
    ressources: []
};

function appliquerCanevas(c) {
    const deja = document.getElementById('edit-formation-titre').value.trim();
    if (deja && !confirm(`Remplacer le contenu actuel par le canevas « ${c.titre} » ?`)) return;
    document.getElementById('edit-formation-titre').value = c.titre;
    document.getElementById('edit-formation-discipline').value = c.discipline;
    document.getElementById('edit-formation-description').value = c.description;
    document.getElementById('edit-formation-heures').value = c.minimas.heures;
    document.getElementById('edit-formation-vols').value = c.minimas.vols || '';
    document.getElementById('edit-formation-hdc').value = c.minimas.heuresDC;
    document.getElementById('edit-formation-hsolo').value = c.minimas.heuresSolo;
    document.getElementById('edit-formation-att').value = c.minimas.atterrissages || '';
    document.getElementById('editeur-cas').innerHTML = (c.cas || []).map(blocCasHtml).join('');
    document.getElementById('editeur-modules').innerHTML = c.modules.map(blocModuleHtml).join('');
    document.getElementById('editeur-prerequis').innerHTML = c.prerequis.map(blocPrerequisHtml).join('');
    document.getElementById('editeur-ressources').innerHTML = c.ressources.map(blocRessourceHtml).join('');
    document.getElementById('editeur-lecons').innerHTML = c.lecons.map(blocLeconHtml).join('');
}

function ouvrirEditeurFormation(formationId) {
    const overlay = document.getElementById('modale-formation-editeur');
    const form = formationId ? formationsCache.find(f => f.id === formationId) : null;
    overlay.dataset.fid = form ? form.id : '';
    document.getElementById('edit-formation-titre').value = form ? (form.fields['Titre'] || '') : '';
    document.getElementById('edit-formation-discipline').value = form ? (form.fields['Discipline'] || 'Avion') : 'Avion';
    document.getElementById('edit-formation-description').value = form ? (form.fields['Description'] || '') : '';
    const m = form ? formationJson(form.fields['Minimas'], {}) : {};
    document.getElementById('edit-formation-heures').value = m.heures ?? '';
    document.getElementById('edit-formation-vols').value = m.vols ?? '';
    document.getElementById('edit-formation-hdc').value = m.heuresDC ?? '';
    document.getElementById('edit-formation-hsolo').value = m.heuresSolo ?? '';
    document.getElementById('edit-formation-att').value = m.atterrissages ?? '';
    // Cas de figure : nouveau format (m.cas) ou migration de l'ancien
    // (heuresLicencie/volsLicencie -> un cas "Deja licencié").
    const cas = Array.isArray(m.cas) ? m.cas
        : (m.heuresLicencie || m.volsLicencie ? [{ nom: 'Déjà licencié', heures: m.heuresLicencie || 0, vols: m.volsLicencie || 0 }] : []);
    document.getElementById('editeur-cas').innerHTML = cas.map(blocCasHtml).join('');
    const modules = form ? formationJson(form.fields['Modules'], []) : [];
    document.getElementById('editeur-modules').innerHTML = modules.map(blocModuleHtml).join('');
    const prerequis = form ? formationJson(form.fields['Prerequis'], []) : [];
    document.getElementById('editeur-prerequis').innerHTML = prerequis.map(blocPrerequisHtml).join('');
    const ressources = form ? formationJson(form.fields['Ressources'], []) : [];
    document.getElementById('editeur-ressources').innerHTML = ressources.map(blocRessourceHtml).join('');
    const lecons = form ? formationJson(form.fields['Lecons'], []) : [{ id: 'l1', titre: '', objectif: '', items: [] }];
    document.getElementById('editeur-lecons').innerHTML = lecons.map((l, i) => blocLeconHtml(l, i)).join('');
    document.getElementById('titre-modale-formation').textContent = form ? 'Modifier la formation' : 'Nouvelle formation';
    overlay.style.display = 'flex';
}

async function enregistrerFormationEdit(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-editeur');
    const fid = overlay.dataset.fid;
    const titre = document.getElementById('edit-formation-titre').value.trim();
    if (!titre) { alert('Le titre est obligatoire.'); return; }
    const blocs = [...document.querySelectorAll('#editeur-lecons .formation-lecon-edit')];
    const lecons = blocs.map((b, i) => ({
        id: b.dataset.leconId || `l${Date.now()}_${i}`,
        titre: b.querySelector('.lecon-titre').value.trim(),
        objectif: b.querySelector('.lecon-objectif').value.trim(),
        groupe: b.querySelector('.lecon-groupe').value.trim(),
        items: b.querySelector('.lecon-items').value.split('\n').map(s => s.trim()).filter(Boolean)
    })).filter(l => l.titre || l.items.length);
    const num = (b, c, entier) => { const v = entier ? parseInt(b.querySelector(c).value, 10) : parseFloat(b.querySelector(c).value); return v || 0; };
    const cas = [...document.querySelectorAll('#editeur-cas .formation-mini-edit')].map(b => ({
        nom: b.querySelector('.cas-nom').value.trim(),
        heures: num(b, '.cas-heures'), vols: num(b, '.cas-vols', true),
        heuresDC: num(b, '.cas-hdc'), heuresSolo: num(b, '.cas-hsolo'), atterrissages: num(b, '.cas-att', true)
    })).filter(c => c.nom);
    const modules = [...document.querySelectorAll('#editeur-modules .formation-mini-edit')]
        .map(b => ({ titre: b.querySelector('.module-titre').value.trim() }))
        .filter(m => m.titre);
    const prerequis = [...document.querySelectorAll('#editeur-prerequis .formation-mini-edit')]
        .map(b => ({ titre: b.querySelector('.prerequis-titre').value.trim() }))
        .filter(p => p.titre);
    const ressources = [];
    for (const b of document.querySelectorAll('#editeur-ressources .formation-mini-edit')) {
        const fichier = b.querySelector('.ressource-fichier').files[0];
        let lien = b.querySelector('.ressource-lien').value.trim();
        let titre = b.querySelector('.ressource-titre').value.trim();
        if (fichier) {
            try { lien = await uploaderFichierDocument(fichier); }
            catch (err) { alert(`Échec de l'envoi de « ${fichier.name} » : ${err.message}`); return; }
            if (!titre) titre = fichier.name;
        }
        if (titre || lien) ressources.push({ titre, lien });
    }
    const fields = {
        'Titre': titre,
        'Discipline': document.getElementById('edit-formation-discipline').value,
        'Description': document.getElementById('edit-formation-description').value.trim(),
        'Minimas': {
            heures: parseFloat(document.getElementById('edit-formation-heures').value) || 0,
            vols: parseInt(document.getElementById('edit-formation-vols').value, 10) || 0,
            heuresDC: parseFloat(document.getElementById('edit-formation-hdc').value) || 0,
            heuresSolo: parseFloat(document.getElementById('edit-formation-hsolo').value) || 0,
            atterrissages: parseInt(document.getElementById('edit-formation-att').value, 10) || 0,
            cas
        },
        'Modules': modules,
        'Prerequis': prerequis,
        'Ressources': ressources,
        'Lecons': lecons,
        'Actif': true
    };
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS)}`, {
            method: fid ? 'PATCH' : 'POST', headers,
            body: JSON.stringify(fid ? { records: [{ id: fid, fields }] } : { records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
        overlay.style.display = 'none';
        await chargerFormationsCatalogue(true);
        ouvrirGestionCatalogue();
    } catch (err) { console.error(err); alert('Erreur lors de l\'enregistrement.'); }
}

// Suppression d'un suivi : efface aussi ses seances (par lots de 10).
async function supprimerSuivi(sid) {
    const suivi = (suivisCache || []).find(s => s.id === sid);
    const seances = seancesDuSuivi(sid);
    const f = suivi ? suivi.fields : {};
    if (!(await confirmerSuppression(
        `Supprimer définitivement la formation « ${f['Formation titre'] || ''} » de ${f['Élève nom'] || 'cet élève'} ?` +
        (seances.length ? `\nLes ${seances.length} séance(s) associée(s) seront aussi supprimées.` : '') +
        `\nPréférez l'archivage pour conserver l'historique.`
    ))) return;
    try {
        for (let i = 0; i < seances.length; i += 10) {
            const q = seances.slice(i, i + 10).map(s => `records[]=${encodeURIComponent(s.id)}`).join('&');
            const r = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}?${q}`, { method: 'DELETE', headers });
            if (!r.ok) throw new Error(await r.text());
        }
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SUIVIS)}?records[]=${encodeURIComponent(sid)}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error(await res.text());
        invaliderFormationCache();
        suiviOuvertId = null;
        chargerFormation();
    } catch (e) { console.error(e); alert('Erreur lors de la suppression.'); }
}

async function supprimerFormation(fid) {
    if (!(await confirmerSuppression('Supprimer cette formation du catalogue ?\nLes suivis en cours conservent leur copie des leçons.'))) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS)}?records[]=${fid}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error(await res.text());
        await chargerFormationsCatalogue(true);
        ouvrirGestionCatalogue();
    } catch (e) { console.error(e); alert('Erreur lors de la suppression.'); }
}

// ---------------------------------------------------------------------------
// PAGE SEANCE (debrief plein ecran : arbre complet a gauche, formulaire a droite)
// Chaque item est marque d'un etat : acquis / en cours / a refaire.
// ---------------------------------------------------------------------------
let seanceEnCours = null; // { suiviId, vols }
let seanceEtats = new Map(); // 'lecon:item' -> 'acquis'|'encours'|'arefaire'
let enEditionSeance = false; // empeche l'auto-refresh de re-rendre le detail
let seanceEditionId = null; // null = creation, sinon id de la seance modifiee

async function ouvrirPageSeance(suiviId, seanceId) {
    const zone = document.getElementById('formation-contenu');
    const suivi = (suivisCache || []).find(s => s.id === suiviId);
    if (!zone || !suivi) return;
    suiviOuvertId = suiviId;
    enEditionSeance = true;
    seanceEditionId = seanceId || null;
    const edition = seanceId ? (seancesCache || []).find(s => s.id === seanceId) : null;
    const fe = edition ? edition.fields : {};

    // Etats pre-selectionnes en modification (nouveau champ Items,
    // sinon conversion des anciens valides/reportes).
    seanceEtats = new Map();
    if (edition) {
        const itemsN = formationJson(fe['Items'], []);
        if (itemsN.length) itemsN.forEach(x => seanceEtats.set(`${x.lecon}:${x.item}`, x.etat));
        else {
            formationJson(fe['Items validés'], []).forEach(x => seanceEtats.set(`${x.lecon}:${x.item}`, 'acquis'));
            formationJson(fe['Items reportés'], []).forEach(x => seanceEtats.set(`${x.lecon}:${x.item}`, 'arefaire'));
        }
    }

    majActionsEntete(`<button class="btn-secondary" data-formation-action="retour">← Annuler</button>`);

    const p = progressionSuivi(suivi);
    let dernierGroupe = '';
    const arbre = p.lecons.map((l, idx) => {
        const g = l.groupe || '';
        const entete = g !== dernierGroupe && g ? `<h5 class="formation-phase-titre">${escapeHtml(g)}</h5>` : '';
        dernierGroupe = g;
        const items = (l.items || []).map((it, i) => {
            const cle = `${l.id}:${i}`;
            const icone = ETATS_ITEM[p.etats.get(cle)] || '⬜';
            const sel = seanceEtats.get(cle);
            const on = e => sel === e ? ' ts-on' : '';
            return `<div class="seance-item-row" data-cle="${escapeHtml(cle)}">
                <span class="seance-item-libelle">${icone} ${escapeHtml(it)}</span>
                <span class="seance-tristate">
                    <button type="button" class="ts-btn ts-arefaire${on('arefaire')}" data-formation-action="item-etat" data-etat="arefaire">À refaire</button>
                    <button type="button" class="ts-btn ts-encours${on('encours')}" data-formation-action="item-etat" data-etat="encours">En cours</button>
                    <button type="button" class="ts-btn ts-acquis${on('acquis')}" data-formation-action="item-etat" data-etat="acquis">Acquis</button>
                </span>
            </div>`;
        }).join('');
        return `${entete}<div class="seance-lecon-bloc"><strong>Leçon ${idx + 1} — ${escapeHtml(l.titre || '')}</strong><div class="seance-lecon-items">${items}</div></div>`;
    }).join('');

    zone.innerHTML = `
    <div class="seance-page">
        <div class="seance-arbre">
            <div class="seance-arbre-titre">Items de la formation — état constaté lors de la séance</div>
            ${arbre || '<div class="formation-vide">Aucune leçon définie.</div>'}
        </div>
        <div class="seance-formulaire">
            ${edition ? `<div class="seance-edition-note">✏️ Modification — les signatures devront être refaites après enregistrement.</div>` : ''}
            <div class="seance-grid3">
                <div class="form-group">
                    <label for="seance-type">Type de séance</label>
                    <select id="seance-type">
                        <option value="Vol" ${fe['Type'] === 'Vol' ? 'selected' : ''}>Avion (vol)</option>
                        <option value="Simulateur" ${fe['Type'] === 'Simulateur' ? 'selected' : ''}>Simulateur</option>
                        <option value="Théorique" ${fe['Type'] === 'Théorique' ? 'selected' : ''}>Formation théorique</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="seance-machine">Machine / Simu</label>
                    <input type="text" id="seance-machine" placeholder="ex : C172, FNPT II" value="${escapeHtml(fe['Machine'] || '')}">
                </div>
                <div class="form-group">
                    <label for="seance-date">Date</label>
                    <input type="date" id="seance-date" value="${escapeHtml(fe['Date'] || new Date().toISOString().slice(0, 10))}">
                </div>
            </div>
            <div class="form-group">
                <label for="seance-vol">Vol associé</label>
                <select id="seance-vol"><option value="">Chargement des vols…</option></select>
            </div>
            <div class="seance-form-sous-titre">Heures de vol & atterrissages</div>
            <div class="seance-grid4">
                <div class="form-group">
                    <label for="seance-hdc">Double cmd</label>
                    <input type="number" id="seance-hdc" min="0" step="0.1" placeholder="h" value="${fe['HDV DC'] || ''}">
                </div>
                <div class="form-group">
                    <label for="seance-hsolo">Solo</label>
                    <input type="number" id="seance-hsolo" min="0" step="0.1" placeholder="h" value="${fe['HDV solo'] || ''}">
                </div>
                <div class="form-group">
                    <label for="seance-hsimu">Simulateur</label>
                    <input type="number" id="seance-hsimu" min="0" step="0.1" placeholder="h" value="${fe['HDV simu'] || ''}">
                </div>
                <div class="form-group">
                    <label for="seance-att">Atterrissages</label>
                    <input type="number" id="seance-att" min="0" step="1" value="${fe['Atterrissages'] || ''}">
                </div>
            </div>
            <div class="form-group">
                <label for="seance-meteo">Météo & infos opérationnelles</label>
                <input type="text" id="seance-meteo" placeholder="ex : BKN014 9999, vent N/NE 5-10 kt" value="${escapeHtml(fe['Météo'] || '')}">
            </div>
            <div class="form-group">
                <label for="seance-commentaire">Contenu de la séance & remarques pour l'élève</label>
                <textarea id="seance-commentaire" rows="5" placeholder="Points forts, points à retravailler…">${escapeHtml(fe['Commentaire'] || '')}</textarea>
            </div>
            <button type="button" class="btn-submit" style="width:100%;" data-formation-action="seance-save">${edition ? '✍️ Re-signer et enregistrer' : '✍️ Signer et enregistrer'}</button>
        </div>
    </div>`;

    // Vols de l'eleve en arriere-plan
    try {
        const vols = await chargerVolsEleve(suivi.fields['Élève nom'] || '');
        seanceEnCours = { suiviId, vols };
        const selVol = document.getElementById('seance-vol');
        if (selVol) {
            selVol.innerHTML = '<option value="">— Sans vol associé —</option>' + vols.slice(0, 40).map(v => {
                const f = v.fields;
                const lbl = `${f['Date'] || ''} · ${f['Départ'] || '?'}→${f['Arrivée'] || '?'} · ${f['Temps de vol'] || ''} · ${f['Machine'] || ''}`;
                return `<option value="${v.id}">${escapeHtml(lbl)}</option>`;
            }).join('');
            if (fe['Vol']) selVol.value = fe['Vol'];
        }
    } catch (e) {
        seanceEnCours = { suiviId, vols: [] };
        const selVol = document.getElementById('seance-vol');
        if (selVol) selVol.innerHTML = '<option value="">— Sans vol associé —</option>';
    }
}

// Bascule l'etat d'un item dans la page seance (reclic = deselection).
function basculerEtatItem(btn) {
    const row = btn.closest('.seance-item-row');
    if (!row) return;
    const cle = row.dataset.cle, etat = btn.dataset.etat;
    if (seanceEtats.get(cle) === etat) seanceEtats.delete(cle);
    else seanceEtats.set(cle, etat);
    row.querySelectorAll('.ts-btn').forEach(b => b.classList.toggle('ts-on', seanceEtats.get(cle) === b.dataset.etat));
}

// Pre-remplit la fiche seance depuis le vol choisi : HDV reparties selon la
// fonction (EP* = double commande, P = solo), atterrissages, machine, date.
function prefillSeanceDepuisVol() {
    if (!seanceEnCours) return;
    const selVol = document.getElementById('seance-vol');
    if (!selVol) return;
    const vol = selVol.value ? seanceEnCours.vols.find(v => v.id === selVol.value) : null;
    if (!vol) return;
    const f = vol.fields;
    const minutes = typeof dureeVolMinutes === 'function' ? dureeVolMinutes(f) : 0;
    const heures = Math.round(minutes / 60 * 10) / 10;
    const fonction = String(f['Fonction'] || '').toUpperCase();
    if (fonction.startsWith('EP')) {
        document.getElementById('seance-hdc').value = heures || '';
        document.getElementById('seance-hsolo').value = '';
    } else if (fonction === 'P' || fonction.startsWith('P/')) {
        document.getElementById('seance-hsolo').value = heures || '';
        document.getElementById('seance-hdc').value = '';
    }
    if (f['Atterrissages']) document.getElementById('seance-att').value = f['Atterrissages'];
    if (f['Machine']) document.getElementById('seance-machine').value = f['Machine'];
    if (f['Date']) document.getElementById('seance-date').value = f['Date'];
}

async function enregistrerPageSeance() {
    const suivi = (suivisCache || []).find(s => s.id === suiviOuvertId);
    if (!suivi) return;
    const items = [...seanceEtats.entries()].map(([cle, etat]) => {
        const [lecon, item] = cle.split(':');
        return { lecon, item: parseInt(item, 10), etat };
    });
    const selVol = document.getElementById('seance-vol');
    const volId = selVol ? selVol.value : '';
    const vol = volId && seanceEnCours ? seanceEnCours.vols.find(v => v.id === volId) : null;
    const volLibelle = vol ? `${vol.fields['Départ'] || '?'}→${vol.fields['Arrivée'] || '?'}` : '';
    const commentaire = document.getElementById('seance-commentaire').value.trim();
    const date = document.getElementById('seance-date').value || new Date().toISOString().slice(0, 10);
    if (!items.length && !(await confirmerAction('Aucun item coché — enregistrer la séance quand même ?', { okLabel: 'Enregistrer', icone: '✈️' }))) return;

    const sigInstr = await demanderSignatureElectronique('Signature de l\'instructeur — vos identifiants', currentUser ? currentUser.identifiant : '');
    if (!sigInstr) return;

    const hdv = id => parseFloat(document.getElementById(id).value) || 0;
    const fields = {
        'Suivi': String(suivi.id),
        'Élève': suivi.fields['Élève'] || [],
        'Élève nom': suivi.fields['Élève nom'] || '',
        'Leçon': '',
        'Vol': volId || '',
        'Vol libellé': volLibelle,
        'Date': date,
        'Type': document.getElementById('seance-type').value,
        'Machine': document.getElementById('seance-machine').value.trim(),
        'Météo': document.getElementById('seance-meteo').value.trim(),
        'HDV DC': hdv('seance-hdc'),
        'HDV solo': hdv('seance-hsolo'),
        'HDV simu': hdv('seance-hsimu'),
        'Atterrissages': parseInt(document.getElementById('seance-att').value, 10) || 0,
        'Commentaire': commentaire,
        'Items': items,
        'Signature instructeur': sigInstr
    };
    // En modification, la signature eleve est invalidee : l'eleve devra re-signer.
    if (seanceEditionId) fields['Signature élève'] = null;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}`, {
            method: seanceEditionId ? 'PATCH' : 'POST', headers,
            body: JSON.stringify(seanceEditionId
                ? { records: [{ id: seanceEditionId, fields }] }
                : { records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
        const seanceId = seanceEditionId || (data.records && data.records[0] && data.records[0].id) || '';
        const nomEleve = suivi.fields['Élève nom'] || '';
        // Si l'eleve est present, on peut recueillir sa signature tout
        // de suite ; sinon la signature sera demandee par notification.
        let eleveASigne = false;
        const signerMaintenant = await confirmerAction(
            `L'élève (${nomEleve || 'élève'}) peut-il signer la séance maintenant ?`,
            { okLabel: 'Faire signer', cancelLabel: 'Plus tard', icone: '✍️', danger: false });
        if (signerMaintenant && seanceId) {
            const idfEleve = await identifiantEleve(suivi);
            const sigEleve = await demanderSignatureElectronique(`Signature de l'élève — ${nomEleve} saisit ses identifiants`, idfEleve);
            if (sigEleve) {
                const resE = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}`, {
                    method: 'PATCH', headers,
                    body: JSON.stringify({ records: [{ id: seanceId, fields: { 'Signature élève': sigEleve } }] })
                });
                const dataE = await resE.json();
                if (!resE.ok) alert('Erreur lors de la signature élève : ' + (dataE.error ? dataE.error.message : ''));
                eleveASigne = resE.ok;
            }
        }
        seanceEtats = new Map();
        enEditionSeance = false;
        seanceEditionId = null;
        invaliderFormationCache();
        await chargerToutesSeances(true);
        renderDetailSuivi();
        // Pas de signature eleve recueillie : la demander par notification.
        if (!eleveASigne) {
            try {
                await creerNotification(
                    nomEleve,
                    `Une séance de formation « ${suivi.fields['Formation titre'] || ''} » du ${date} attend votre signature.`,
                    'formation', 'formation');
            } catch (e) { console.warn('Notification élève:', e); }
        }
    } catch (err) { console.error(err); alert('Erreur lors de l\'enregistrement de la séance.'); }
}

async function supprimerSeance(seanceId) {
    if (!(await confirmerSuppression('Supprimer cette séance ?\nLes items qu\'elle validait seront recalculés sur les autres séances.'))) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}?records[]=${encodeURIComponent(seanceId)}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error(await res.text());
        invaliderFormationCache();
        await chargerToutesSeances(true);
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la suppression.'); }
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
function initFormation() {
    const fermer = (id) => { const o = document.getElementById(id); if (o) o.style.display = 'none'; };
    const liaisons = [
        ['btn-close-formation-editeur', 'modale-formation-editeur'],
        ['btn-close-formation-attribuer', 'modale-formation-attribuer'],
        ['btn-close-formation-catalogue', 'modale-formation-catalogue'],
        ['btn-close-formation-fiche', 'modale-formation-fiche'],
        ['btn-close-formation-credit', 'modale-formation-credit']
    ];
    liaisons.forEach(([btn, mod]) => {
        const b = document.getElementById(btn);
        if (b) b.addEventListener('click', () => fermer(mod));
    });
    document.querySelectorAll('#modale-formation-editeur, #modale-formation-attribuer, #modale-formation-catalogue, #modale-formation-fiche, #modale-formation-credit')
        .forEach(o => o.addEventListener('click', (e) => { if (e.target === o) o.style.display = 'none'; }));
    const f1 = document.getElementById('form-formation-editeur');
    if (f1) f1.addEventListener('submit', enregistrerFormationEdit);
    const f2 = document.getElementById('form-formation-attribuer');
    if (f2) f2.addEventListener('submit', enregistrerAttribution);
    const f5 = document.getElementById('form-formation-fiche');
    if (f5) f5.addEventListener('submit', enregistrerFiche);
    const f6 = document.getElementById('form-formation-credit');
    if (f6) f6.addEventListener('submit', enregistrerCredit);
    const btnCat = document.getElementById('btn-formation-nouvelle');
    if (btnCat) btnCat.addEventListener('click', () => ouvrirEditeurFormation(null));
    const btnLecon = document.getElementById('btn-formation-lecon-add');
    if (btnLecon) btnLecon.addEventListener('click', ajouterBlocLecon);
    const btnCas = document.getElementById('btn-formation-cas-add');
    if (btnCas) btnCas.addEventListener('click', () => ajouterBlocMini('editeur-cas', blocCasHtml({})));
    const btnPre = document.getElementById('btn-formation-prerequis-add');
    if (btnPre) btnPre.addEventListener('click', () => ajouterBlocMini('editeur-prerequis', blocPrerequisHtml({})));
    const btnRes = document.getElementById('btn-formation-ressource-add');
    if (btnRes) btnRes.addEventListener('click', () => ajouterBlocMini('editeur-ressources', blocRessourceHtml({})));
    const btnMod = document.getElementById('btn-formation-module-add');
    if (btnMod) btnMod.addEventListener('click', () => ajouterBlocMini('editeur-modules', blocModuleHtml({})));
    [['btn-formation-canevas-ppl', CANEVAS_PPL], ['btn-formation-canevas-lapl', CANEVAS_LAPL],
     ['btn-formation-canevas-lache', CANEVAS_LACHE], ['btn-formation-canevas-sep', CANEVAS_SEP]]
        .forEach(([id, c]) => {
            const b = document.getElementById(id);
            if (b) b.addEventListener('click', () => appliquerCanevas(c));
        });
    const selForm = document.getElementById('attribuer-formation');
    if (selForm) selForm.addEventListener('change', majCasAttribution);
}
